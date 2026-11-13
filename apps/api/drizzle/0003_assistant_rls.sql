-- Feature 002: restricted role for the AI assistant's context builder + settings row.
-- The API connects as the table owner (RLS bypassed); the bot pipeline switches to
-- this role with SET LOCAL ROLE inside a transaction and sets app.requester_id, so it
-- can only ever read the requesting user's own rows (specs/002 data-model.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_bot') THEN
    CREATE ROLE helpdesk_bot NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT helpdesk_bot TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO helpdesk_bot;
--> statement-breakpoint
GRANT SELECT ON tickets, ticket_messages, ticket_summaries, kb_sources, kb_sections, kb_links, kb_chunks, kb_articles TO helpdesk_bot;
--> statement-breakpoint
CREATE OR REPLACE VIEW bot_requester AS
  SELECT id, first_name FROM users
  WHERE id = nullif(current_setting('app.requester_id', true), '')::uuid;
--> statement-breakpoint
GRANT SELECT ON bot_requester TO helpdesk_bot;
--> statement-breakpoint
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ticket_summaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bot_own_tickets ON tickets FOR SELECT TO helpdesk_bot
  USING (user_id = nullif(current_setting('app.requester_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY bot_own_public_messages ON ticket_messages FOR SELECT TO helpdesk_bot
  USING (visibility = 'public' AND ticket_id IN (SELECT id FROM tickets));
--> statement-breakpoint
CREATE POLICY bot_own_summaries ON ticket_summaries FOR SELECT TO helpdesk_bot
  USING (user_id = nullif(current_setting('app.requester_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY bot_approved_articles ON kb_articles FOR SELECT TO helpdesk_bot
  USING (status = 'approved');
--> statement-breakpoint
INSERT INTO bot_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
