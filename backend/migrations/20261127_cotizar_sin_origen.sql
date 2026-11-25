-- Cotizar ya no pregunta "¿Cómo nos conoció?" (antes también dejó de
-- preguntar dónde se usará el tablero). El origen se registra en la ficha
-- del cliente (Clientes) o llega solo cuando la cotización nace en el inbox
-- de WhatsApp.
--
-- La regla de incentivos que premiaba registrar ese dato al cotizar ya no
-- mide algo que el vendedor haga ahí: queda apagada. Admin puede volver a
-- prenderla en Usuarios → Incentivos si quiere premiar fichas completas.
UPDATE sales_incentive_rules
SET enabled = FALSE,
    label = 'Origen del cliente en su ficha',
    description = 'Cotizaciones del mes cuyo cliente tiene "cómo nos conoció" registrado. Cotizar ya no lo pregunta: se llena en Clientes o llega solo desde el inbox de WhatsApp.'
WHERE key = 'datos';
