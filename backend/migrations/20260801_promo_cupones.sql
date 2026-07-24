-- Cupones personales dentro del motor de promos (reemplazan la sección
-- Cupones antigua de códigos globales):
--  - meta: datos por código (descuento %, vigencia) congelados al emitir.
--  - redeemed_quote_id / redeemed_at: qué compra canjeó el cupón.
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS redeemed_quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMP;

-- La sección Cupones vieja se elimina: códigos globales sin cliente ni canje
-- rastreado. Las cotizaciones guardadas conservan su coupon_code como texto.
DROP TABLE IF EXISTS cupones;
