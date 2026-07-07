-- schema.sql
-- Run this once against your Postgres database to set up the parking system.
--   psql -U your_user -d your_database -f schema.sql

-- ── Slots ────────────────────────────────────────────────────────────────
-- One row per physical parking bay.
CREATE TABLE IF NOT EXISTS slots (
  id            SERIAL PRIMARY KEY,
  number        VARCHAR(10) UNIQUE NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'empty'
                CHECK (status IN ('empty', 'occupied')),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

-- ── Sessions ─────────────────────────────────────────────────────────────
-- One row per vehicle visit, from entry to exit.
CREATE TABLE IF NOT EXISTS sessions (
  id              SERIAL PRIMARY KEY,
  plate_number    VARCHAR(20) NOT NULL,
  vehicle_type    VARCHAR(10) NOT NULL DEFAULT 'car'
                  CHECK (vehicle_type IN ('car', 'bike')),
  slot_id         INTEGER NOT NULL REFERENCES slots(id),
  entry_time      TIMESTAMP NOT NULL DEFAULT now(),
  exit_time       TIMESTAMP,
  fee_amount      NUMERIC(10,2),
  payment_status  VARCHAR(10) NOT NULL DEFAULT 'unpaid'
                  CHECK (payment_status IN ('unpaid', 'paid')),
  status          VARCHAR(10) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed'))
);

-- Speeds up "is this plate already parked?" and "what's active in this slot?"
CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON sessions (plate_number)
  WHERE status = 'active';

-- ── Payments ─────────────────────────────────────────────────────────────
-- One row per successful payment transaction against a session.
CREATE TABLE IF NOT EXISTS payments (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER NOT NULL REFERENCES sessions(id),
  amount            NUMERIC(10,2) NOT NULL,
  method            VARCHAR(20) NOT NULL DEFAULT 'mock',
  transaction_ref   VARCHAR(50) UNIQUE NOT NULL,
  paid_at           TIMESTAMP NOT NULL DEFAULT now()
);

-- ── Seed slots ───────────────────────────────────────────────────────────
-- Creates 20 bays: A01 ... A20. Safe to re-run (won't duplicate).
INSERT INTO slots (number, status)
SELECT 'A' || LPAD(gs::text, 2, '0'), 'empty'
FROM generate_series(1, 20) AS gs
ON CONFLICT (number) DO NOTHING;