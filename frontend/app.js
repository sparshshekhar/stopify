// app.js
// Talks to the Slotify backend (server.js) and updates the page.
// No frameworks — just plain fetch() calls and DOM updates.

const API = "http://localhost:4000/api";

// ── Load & render the slot grid ─────────────────────────────────────────
async function loadSlots() {
  const res = await fetch(`${API}/slots`);
  const slots = await res.json();

  const grid = document.getElementById("lotGrid");
  grid.innerHTML = "";

  let emptyCount = 0;
  slots.forEach((slot) => {
    if (slot.status === "empty") emptyCount++;

    const bay = document.createElement("div");
    bay.className = `bay ${slot.status}`;
    bay.innerHTML = `
      <span class="bay-icon">${slot.status === "occupied" ? "🚗" : "—"}</span>
      <span class="bay-number">${slot.number}</span>
    `;
    grid.appendChild(bay);
  });

  document.getElementById("statEmpty").textContent = emptyCount;
  document.getElementById("statOccupied").textContent = slots.length - emptyCount;
  document.getElementById("statTotal").textContent = slots.length;
}

// ── Load & render currently parked vehicles ─────────────────────────────
async function loadActiveSessions() {
  const res = await fetch(`${API}/sessions/active`);
  const sessions = await res.json();

  const body = document.getElementById("activeSessionsBody");

  if (sessions.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="empty-row">No vehicles parked right now.</td></tr>`;
    return;
  }

  body.innerHTML = sessions
    .map(
      (s) => `
      <tr>
        <td>${s.slot_number}</td>
        <td>${s.plate_number}</td>
        <td>${s.vehicle_type}</td>
        <td>${new Date(s.entry_time).toLocaleTimeString()}</td>
      </tr>
    `
    )
    .join("");
}

async function refreshAll() {
  await loadSlots();
  await loadActiveSessions();
}

// ── Entry form ───────────────────────────────────────────────────────────
document.getElementById("entryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const plateNumber = document.getElementById("entryPlate").value.trim();
  const vehicleType = document.getElementById("entryType").value;
  const resultBox = document.getElementById("entryResult");

  resultBox.innerHTML = "";
  try {
    const res = await fetch(`${API}/entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plateNumber, vehicleType }),
    });
    const data = await res.json();

    if (!res.ok) {
      resultBox.innerHTML = `<div class="result-card error">${data.error}</div>`;
      return;
    }

    resultBox.innerHTML = `
      <div class="result-card success">
        TICKET #${data.ticketId}<br/>
        SLOT ASSIGNED: <strong>${data.slotNumber}</strong><br/>
        ENTRY: ${new Date(data.entryTime).toLocaleTimeString()}
      </div>
    `;
    document.getElementById("entryForm").reset();
    refreshAll();
  } catch (err) {
    resultBox.innerHTML = `<div class="result-card error">Could not reach the server. Is it running?</div>`;
  }
});

// ── Exit form ────────────────────────────────────────────────────────────
document.getElementById("exitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const plateNumber = document.getElementById("exitPlate").value.trim();
  const resultBox = document.getElementById("exitResult");

  resultBox.innerHTML = "";
  try {
    const res = await fetch(`${API}/exit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plateNumber }),
    });
    const data = await res.json();

    if (!res.ok) {
      resultBox.innerHTML = `<div class="result-card error">${data.error}</div>`;
      return;
    }

    resultBox.innerHTML = `
      <div class="result-card success">
        TICKET #${data.ticketId} — SLOT ${data.slotNumber}<br/>
        AMOUNT DUE: <span class="amount">₹${data.amountDue}</span><br/>
        <button class="pay-btn" data-ticket="${data.ticketId}">Pay Now (UPI)</button>
      </div>
    `;
    document.getElementById("exitForm").reset();
    refreshAll();

    resultBox.querySelector(".pay-btn").addEventListener("click", async (ev) => {
      const ticketId = ev.target.getAttribute("data-ticket");
      ev.target.textContent = "Processing…";
      ev.target.disabled = true;

      const payRes = await fetch(`${API}/payments/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: Number(ticketId), method: "upi" }),
      });
      const payData = await payRes.json();

      if (!payRes.ok) {
        resultBox.innerHTML += `<div class="result-card error">${payData.error}</div>`;
        return;
      }

      resultBox.innerHTML = `
        <div class="result-card success">
          PAID ₹${payData.amountPaid}<br/>
          REF: ${payData.transactionRef}<br/>
          Thank you — drive safe!
        </div>
      `;
    });
  } catch (err) {
    resultBox.innerHTML = `<div class="result-card error">Could not reach the server. Is it running?</div>`;
  }
});

// ── Initial load + auto-refresh every 5s ────────────────────────────────
refreshAll();
setInterval(refreshAll, 5000);
