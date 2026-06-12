const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const isPgUndefinedTableError = (err) => err?.code === '42P01';

const isPgUndefinedColumnError = (err) => err?.code === '42703';

module.exports = {
  pool,
  isPgUndefinedColumnError,
  isPgUndefinedTableError
};
