-- Microfabrica + Microfabrica Lider merge into a single role: Produccion.
-- normalizeRole also aliases the old names, so any straggler keeps working;
-- this migration makes the stored data match the new role.

UPDATE users
SET role = 'Produccion'
WHERE LOWER(role) IN ('microfabrica', 'microfabrica lider');

-- Role permission templates: keep the (broader) Lider template as the base
-- for the merged role, then drop both old rows.
INSERT INTO role_panel_defaults (role, panel_access)
SELECT 'Produccion', panel_access
FROM role_panel_defaults
WHERE LOWER(role) = 'microfabrica lider'
ON CONFLICT (role) DO NOTHING;

DELETE FROM role_panel_defaults
WHERE LOWER(role) IN ('microfabrica', 'microfabrica lider');
