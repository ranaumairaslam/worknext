const { Pool } = require('pg');

// Neon requires SSL. The connection string from your Neon dashboard usually
// already includes "?sslmode=require", but we also set ssl explicitly here
// so it works even if that query param is missing.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
  process.exit(1);
});

module.exports = pool;