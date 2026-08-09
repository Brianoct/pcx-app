const { Pool } = require('pg');
const { isSandboxRequest } = require('./lib/requestContext');

const baseConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};

const realPool = new Pool(baseConfig);

// Sandbox connections pin search_path to the sandbox schema only (no fallback
// to public): unqualified table names resolve inside the sandbox copy, and a
// table missing there errors instead of silently touching real data.
const sandboxPool = new Pool({
  ...baseConfig,
  options: '-c search_path=sandbox'
});

const activePool = () => (isSandboxRequest() ? sandboxPool : realPool);

// Same object shape every module already destructures (`const { pool } =`),
// but each call routes to the real or sandbox pool per request context.
const pool = {
  query: (...args) => activePool().query(...args),
  connect: (...args) => activePool().connect(...args),
  end: () => Promise.all([realPool.end(), sandboxPool.end()])
};

const isPgUndefinedTableError = (err) => err?.code === '42P01';

const isPgUndefinedColumnError = (err) => err?.code === '42703';

module.exports = {
  pool,
  realPool,
  sandboxPool,
  isPgUndefinedColumnError,
  isPgUndefinedTableError
};
