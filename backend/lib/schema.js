const { pool } = require('../db');

const ensureUsersSchema = async () => {
  try {
    await pool.query(
      `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`
    );
    await pool.query(
      `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS display_name TEXT`
    );
  } catch (err) {
    console.error('No se pudo asegurar esquema users:', err.message);
  }
};

const ensureQuotesMarketingSchema = async () => {
  try {
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS coupon_code TEXT`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS coupon_discount_percent NUMERIC(10,4) DEFAULT 0`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_name TEXT`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_sku TEXT`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_qty INTEGER NOT NULL DEFAULT 1`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS payment_method TEXT`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS payment_cash_bs NUMERIC(12,2)`
    );
  } catch (err) {
    console.error('No se pudo asegurar esquema marketing en quotes:', err.message);
  }
};

module.exports = {
  ensureQuotesMarketingSchema,
  ensureUsersSchema
};
