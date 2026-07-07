// server.js
// This is the "front door" of our backend. It listens for requests coming
// from a browser (or curl, or the frontend we'll build later) and talks to
// the database (via db.js) to answer them.

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const db = require("./db");
const { authenticateToken, requireAdmin } = require("./auth");

const app = express();
app.use(cors()); // allow the frontend (different origin) to call us
app.use(express.json()); // let us read JSON bodies sent in POST requests

const PORT = process.env.PORT || 4000;

// ── Pricing rules ───────────────────────────────────────────────────────
// First hour flat rate, then a cheaper rate per additional hour.
// Any part of an hour counts as a full hour (like a real parking meter).
function calculateFee(entryTime, exitTime, vehicleType) {
  const ms = new Date(exitTime) - new Date(entryTime);
  const hours = Math.max(1, Math.ceil(ms / (1000 * 60 * 60)));

  const firstHourRate = vehicleType === "bike" ? 10 : 20;
  const extraHourRate = vehicleType === "bike" ? 5 : 10;

  if (hours <= 1) return firstHourRate;
  return firstHourRate + (hours - 1) * extraHourRate;
}

// ── Health check ────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", database: "unreachable" });
  }
});

// ── POST /api/auth/signup ────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { name, identifier, password, adminCode } = req.body;

  if (!name || !identifier || !password) {
    return res
      .status(400)
      .json({ error: "name, identifier, and password are required" });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }

  const isEmail = identifier.includes("@");
  const role =
    adminCode && adminCode === process.env.ADMIN_SIGNUP_CODE ? "admin" : "user";

  try {
    const existing = await db.query(
      isEmail
        ? "SELECT id FROM users WHERE email = $1"
        : "SELECT id FROM users WHERE phone = $1",
      [identifier],
    );
    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "An account with this email/phone already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, role`,
      [
        name,
        isEmail ? identifier : null,
        isEmail ? null : identifier,
        passwordHash,
        role,
      ],
    );
    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res
      .status(201)
      .json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create account" });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res
      .status(400)
      .json({ error: "identifier and password are required" });
  }

  try {
    const result = await db.query(
      "SELECT id, name, password_hash, role FROM users WHERE email = $1 OR phone = $1",
      [identifier],
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email/phone or password" });
    }

    const user = result.rows[0];
    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: "Invalid email/phone or password" });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to log in" });
  }
});

// ── GET /api/slots ──────────────────────────────────────────────────────
app.get("/api/slots", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, number, status FROM slots ORDER BY id",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch slots" });
  }
});

// ── GET /api/sessions/active ────────────────────────────────────────────
app.get("/api/sessions/active", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.id, s.plate_number, s.vehicle_type, s.entry_time, sl.number AS slot_number
       FROM sessions s
       JOIN slots sl ON sl.id = s.slot_id
       WHERE s.status = 'active'
       ORDER BY s.entry_time`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch active sessions" });
  }
});

// ── POST /api/entry ─────────────────────────────────────────────────────
app.post("/api/entry", async (req, res) => {
  const { plateNumber, vehicleType } = req.body;

  if (!plateNumber) {
    return res.status(400).json({ error: "plateNumber is required" });
  }
  const type = vehicleType === "bike" ? "bike" : "car";

  try {
    const already = await db.query(
      "SELECT id FROM sessions WHERE plate_number = $1 AND status = 'active'",
      [plateNumber],
    );
    if (already.rows.length > 0) {
      return res.status(409).json({ error: "This vehicle is already parked" });
    }

    const freeSlot = await db.query(
      "SELECT id, number FROM slots WHERE status = 'empty' ORDER BY id LIMIT 1",
    );
    if (freeSlot.rows.length === 0) {
      return res.status(409).json({ error: "Parking lot is full" });
    }
    const slot = freeSlot.rows[0];

    const session = await db.query(
      `INSERT INTO sessions (plate_number, vehicle_type, slot_id)
       VALUES ($1, $2, $3)
       RETURNING id, plate_number, vehicle_type, slot_id, entry_time`,
      [plateNumber, type, slot.id],
    );
    await db.query(
      "UPDATE slots SET status = 'occupied', updated_at = now() WHERE id = $1",
      [slot.id],
    );

    res.status(201).json({
      ticketId: session.rows[0].id,
      plateNumber: session.rows[0].plate_number,
      vehicleType: session.rows[0].vehicle_type,
      slotNumber: slot.number,
      entryTime: session.rows[0].entry_time,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process entry" });
  }
});

// ── POST /api/exit ──────────────────────────────────────────────────────
app.post("/api/exit", async (req, res) => {
  const { plateNumber } = req.body;

  if (!plateNumber) {
    return res.status(400).json({ error: "plateNumber is required" });
  }

  try {
    const active = await db.query(
      `SELECT s.id, s.plate_number, s.vehicle_type, s.entry_time, s.slot_id, sl.number AS slot_number
       FROM sessions s
       JOIN slots sl ON sl.id = s.slot_id
       WHERE s.plate_number = $1 AND s.status = 'active'`,
      [plateNumber],
    );

    if (active.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "No active session found for this plate" });
    }

    const session = active.rows[0];
    const exitTime = new Date();
    const fee = calculateFee(
      session.entry_time,
      exitTime,
      session.vehicle_type,
    );

    await db.query(
      `UPDATE sessions
       SET exit_time = $1, fee_amount = $2, status = 'completed'
       WHERE id = $3`,
      [exitTime, fee, session.id],
    );
    await db.query(
      "UPDATE slots SET status = 'empty', updated_at = now() WHERE id = $1",
      [session.slot_id],
    );

    res.json({
      ticketId: session.id,
      plateNumber: session.plate_number,
      slotNumber: session.slot_number,
      entryTime: session.entry_time,
      exitTime,
      amountDue: fee,
      paymentStatus: "unpaid",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process exit" });
  }
});

// ── POST /api/payments/charge ───────────────────────────────────────────
// Body: { ticketId, method }
// Simulates a payment gateway: no real money moves, but this generates a
// real transaction record and marks the session as paid.
app.post("/api/payments/charge", async (req, res) => {
  const { ticketId, method } = req.body;
  const paymentMethod = method || "card";

  if (!ticketId) {
    return res.status(400).json({ error: "ticketId is required" });
  }

  try {
    const sessionResult = await db.query(
      "SELECT id, fee_amount, payment_status, status FROM sessions WHERE id = $1",
      [ticketId],
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    const session = sessionResult.rows[0];

    if (session.status !== "completed") {
      return res
        .status(400)
        .json({ error: "Vehicle hasn't exited yet — no bill to pay" });
    }
    if (session.payment_status === "paid") {
      return res.status(409).json({ error: "This ticket is already paid" });
    }

    const transactionRef =
      "TXN" +
      Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 1000);

    await db.query(
      `INSERT INTO payments (session_id, amount, method, transaction_ref)
       VALUES ($1, $2, $3, $4)`,
      [session.id, session.fee_amount, paymentMethod, transactionRef],
    );
    await db.query(
      "UPDATE sessions SET payment_status = 'paid' WHERE id = $1",
      [session.id],
    );

    res.status(201).json({
      ticketId: session.id,
      amountPaid: session.fee_amount,
      method: paymentMethod,
      transactionRef,
      paidAt: new Date(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process payment" });
  }
});

app.listen(PORT, () => {
  console.log(`Slotify backend running at http://localhost:${PORT}`);
});
