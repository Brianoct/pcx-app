// Applies backend/migrations/*.sql in filename order, tracking applied files
// in schema_migrations. All migration files must be idempotent or new.
//
//   node scripts/migrate.js          (standalone; reads .env)
//
// Also exported as runMigrations() and awaited at server boot (see index.js),
// so deploys need no extra configuration.
const path = require('path');
const fs = require('fs');

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

const runMigrations = async (pool) => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     )`
  );

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedRes = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRes.rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`migrated: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration failed (${file}): ${err.message}`);
    } finally {
      client.release();
    }
  }
};

module.exports = { runMigrations };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  const { pool } = require('../db');
  runMigrations(pool)
    .then(() => {
      console.log('migrations up to date');
      return pool.end();
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
