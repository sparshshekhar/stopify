-- schema_auth.sql
-- Run this AFTER schema.sql, against the same database:
--   psql -U postgres -d parking_system -f schema_auth.sql

-- ── Users ────────────────────────────────────────────────────────────────
-- Supports login by email OR phone (at least one is required).
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(150) UNIQUE,
  phone           VARCHAR(20) UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(10) NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'admin')),
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT users_identifier_required CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Link each parking session to the account that created it (nullable —
-- older sessions created before accounts existed won't have one).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);