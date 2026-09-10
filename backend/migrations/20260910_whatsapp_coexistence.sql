-- Bandeja de WhatsApp en modo coexistencia (número compartido entre la app
-- WhatsApp Business del teléfono y la Cloud API):
--  - source: de dónde salió cada mensaje. 'api' = cliente vía webhook,
--    'panel' = enviado desde el panel PCX, 'phone' = enviado por el equipo
--    desde la app del teléfono (eco smb_message_echoes), 'history' =
--    sincronización inicial del historial.
--  - sent_by_user_id: quién lo envió desde el panel (atribución por vendedor).
--  - kind en seguimientos: 'callback' = el cliente pidió que lo llamen.
--  - flags de despliegue por fases de la bandeja (Admin -> Paneles).
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'api';
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_followup_tasks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'followup';

CREATE INDEX IF NOT EXISTS idx_whatsapp_followup_tasks_kind
  ON whatsapp_followup_tasks (conversation_id, kind, status);

INSERT INTO feature_flags (key, enabled)
VALUES ('whatsapp_inbox_lider', FALSE), ('whatsapp_inbox_ventas', FALSE)
ON CONFLICT (key) DO NOTHING;
