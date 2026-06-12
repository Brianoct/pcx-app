// Seeds the local/CI test users used by scripts/api-smoke.mjs.
//   node scripts/seed-dev-users.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const bcrypt = require('bcrypt');
const { pool } = require('../db');

const USERS = [
  { email: 'admin@test.com', role: 'Admin', city: 'Santa Cruz', display_name: 'Admin Test' },
  { email: 'ventas@test.com', role: 'Ventas', city: 'Santa Cruz', display_name: 'Maria Ventas' }
];

const run = async () => {
  const hash = await bcrypt.hash('admin123', 10);
  for (const u of USERS) {
    await pool.query(
      `INSERT INTO users (email, password_hash, role, city, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, hash, u.role, u.city, u.display_name]
    );
  }
  console.log('dev users seeded');
  await pool.end();
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
