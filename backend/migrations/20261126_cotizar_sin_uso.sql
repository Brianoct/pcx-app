-- Cotizar ya no pregunta "¿Dónde se usará?": ese dato vive en la ficha del
-- cliente (Clientes → segmento). La regla de incentivos que pedía uso Y
-- origen pasa a medir solo el origen, que sí se sigue registrando al cotizar.
UPDATE sales_incentive_rules
SET label = 'Origen del cliente registrado',
    description = 'Cotizaciones del mes con "cómo nos conoció" registrado, en la cotización o en la ficha del cliente.'
WHERE key = 'datos';
