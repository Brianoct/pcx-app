-- La ruleta de premios se retiró del producto: la empresa decidió enfocarse
-- en mejores accesorios en lugar de mecánicas de sorteo. Se eliminan sus
-- tablas; los regalos ya otorgados viven en las columnas gift_* de quotes y
-- no se tocan.
DROP TABLE IF EXISTS wheel_spins;
DROP TABLE IF EXISTS wheel_campaigns;
DROP TABLE IF EXISTS wheel_config;
