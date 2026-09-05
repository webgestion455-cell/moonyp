-- =====================================================================
-- MOONYP — 07. Messagerie (client connecté + invité), dossiers de
--              conversation pour l'administration, notifications,
--              push, emails transactionnels, messages de contact.
-- Dépend de : 01_core.sql, 02_rbac_staff.sql, 05_applications.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_token       TEXT,
  guest_name        TEXT,
  guest_email       TEXT,
  locale            TEXT NOT NULL DEFAULT 'en',
  status            TEXT NOT NULL DEFAULT 'open',   -- open | pending | closed
  agent_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_name        TEXT,
  unread_for_admin  INTEGER NOT NULL DEFAULT 0,
  unread_for_user   INTEGER NOT NULL DEFAULT 0,
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON public.chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_guest ON public.chat_conversations(guest_token);
CREATE INDEX IF NOT EXISTS idx_chat_conv_last ON public.chat_conversations(last_message_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_conv_read" ON public.chat_conversations;
CREATE POLICY "chat_conv_read" ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'chat.view'));

DROP POLICY IF EXISTS "chat_conv_insert_own" ON public.chat_conversations;
CREATE POLICY "chat_conv_insert_own" ON public.chat_conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_conv_update" ON public.chat_conversations;
CREATE POLICY "chat_conv_update" ON public.chat_conversations
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'chat.reply'))
  WITH CHECK (auth.uid() = user_id OR public.has_permission(auth.uid(), 'chat.reply'));

DROP TRIGGER IF EXISTS trg_chat_conv_updated ON public.chat_conversations;
CREATE TRIGGER trg_chat_conv_updated
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender           TEXT NOT NULL,   -- user | agent | bot | system
  sender_name      TEXT,
  content          TEXT NOT NULL,
  content_type     TEXT NOT NULL DEFAULT 'text',
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON public.chat_messages(conversation_id, created_at);

GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_messages_read" ON public.chat_messages;
CREATE POLICY "chat_messages_read" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'chat.view')
    OR EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_insert" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(auth.uid(), 'chat.reply')
    OR EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

-- Compteurs de non-lus + tri des conversations
CREATE OR REPLACE FUNCTION public.bump_chat_conversation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.chat_conversations
     SET last_message_at = NEW.created_at,
         updated_at = now(),
         unread_for_admin = CASE WHEN NEW.sender = 'user' THEN unread_for_admin + 1 ELSE unread_for_admin END,
         unread_for_user  = CASE WHEN NEW.sender IN ('agent','bot','system') THEN unread_for_user + 1 ELSE unread_for_user END
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bump_chat_conversation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_chat_msg_bump ON public.chat_messages;
CREATE TRIGGER trg_chat_msg_bump
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_chat_conversation();

-- ---------------------------------------------------------------------
-- Dossiers de conversation pour le backoffice
-- Regroupe les conversations par interlocuteur (client ou invité).
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.chat_admin_folders;
CREATE VIEW public.chat_admin_folders
WITH (security_invoker = true) AS
SELECT
  COALESCE(c.user_id::text, 'guest:' || COALESCE(c.guest_email, c.guest_token, c.id::text)) AS folder_key,
  c.user_id                                                                                  AS user_id,
  (c.user_id IS NULL)                                                                        AS is_guest,
  COALESCE(max(c.guest_name), max(p.full_name))                                              AS folder_name,
  COALESCE(max(c.guest_email), max(p.email))                                                 AS folder_email,
  count(*) FILTER (WHERE c.status <> 'closed')                                               AS open_count,
  count(*) FILTER (WHERE c.status = 'closed')                                                AS closed_count,
  max(c.last_message_at)                                                                     AS last_activity,
  COALESCE(sum(c.unread_for_admin), 0)                                                       AS unread_total
FROM public.chat_conversations c
LEFT JOIN public.profiles p ON p.user_id = c.user_id
GROUP BY 1, 2, 3;

GRANT SELECT ON public.chat_admin_folders TO authenticated;
GRANT ALL ON public.chat_admin_folders TO service_role;

-- ---------------------------------------------------------------------
-- Notifications internes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  link        TEXT,
  category    TEXT NOT NULL DEFAULT 'general',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_read_own" ON public.notifications;
CREATE POLICY "notifications_read_own" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_staff" ON public.notifications;
CREATE POLICY "notifications_insert_staff" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_permission(auth.uid(), 'notifications.send'));

-- ---------------------------------------------------------------------
-- Abonnements Web Push
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON public.push_subscriptions(user_id);

GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_own" ON public.push_subscriptions;
CREATE POLICY "push_own" ON public.push_subscriptions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Emails transactionnels (journal d'envoi)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactional_emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID REFERENCES public.loan_applications(id) ON DELETE SET NULL,
  to_email        TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'en',
  template        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed
  error           TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emails_app ON public.transactional_emails(application_id, created_at DESC);

GRANT SELECT ON public.transactional_emails TO authenticated;
GRANT ALL ON public.transactional_emails TO service_role;
ALTER TABLE public.transactional_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emails_read_staff" ON public.transactional_emails;
CREATE POLICY "emails_read_staff" ON public.transactional_emails
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'applications.view'));

DROP TRIGGER IF EXISTS trg_transactional_emails_updated ON public.transactional_emails;
CREATE TRIGGER trg_transactional_emails_updated
  BEFORE UPDATE ON public.transactional_emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Messages du formulaire de contact
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_created ON public.contact_messages(created_at DESC);

GRANT SELECT, INSERT ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_insert" ON public.contact_messages;
CREATE POLICY "contact_insert" ON public.contact_messages
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "contact_read_staff" ON public.contact_messages;
CREATE POLICY "contact_read_staff" ON public.contact_messages
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'chat.view'));
