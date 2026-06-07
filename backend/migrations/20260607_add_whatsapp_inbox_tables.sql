-- WhatsApp Admin Inbox base schema (Meta Direct API).

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id BIGSERIAL PRIMARY KEY,
  wa_phone TEXT NOT NULL UNIQUE,
  profile_name TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT NOT NULL UNIQUE REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_preview TEXT,
  last_message_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_conversations_status_chk CHECK (status IN ('open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message_at
  ON whatsapp_conversations (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  text_body TEXT,
  status TEXT,
  from_phone TEXT,
  to_phone TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_messages_direction_chk CHECK (direction IN ('inbound', 'outbound'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_wa_message_id
  ON whatsapp_messages (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_created
  ON whatsapp_messages (conversation_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS whatsapp_assignment_logs (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  previous_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT 'auto_round_robin',
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_round_robin_state (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
  last_assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_round_robin_singleton_chk CHECK (singleton_id = 1)
);

INSERT INTO whatsapp_round_robin_state (singleton_id, last_assigned_user_id, updated_at)
VALUES (1, NULL, NOW())
ON CONFLICT (singleton_id) DO NOTHING;
