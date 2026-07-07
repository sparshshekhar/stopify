// db.js
// Central Postgres connection pool. Every route in server.js will
// `const db = require('./db')` and call `db.query(sql, params)`.

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Fallback to individual fields if DATABASE_URL isn't set
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "parking_system",
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
