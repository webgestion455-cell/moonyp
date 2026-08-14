-- =====================================================================
-- MOONYP — 07. LiveChat (invités + staff), notifications, push.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_token       TEXT,
  guest_name        TEXT,
  guest_email       TEXT,
  guest_subject     TEXT,
  guest_phone       TEXT,
  application_ref   TEXT,
  locale            TEXT DEFAULT 'en',
  status            TEXT NOT NULL DEFAULT 'open',   -- open | pending | closed
  folder            TEXT NOT NULL DEFAULT 'inbox',  -- inbox | assigned | archived
  agent_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_name        TEXT,
  unread_for_admin  INTEGER NOT NULL DEFAULT 0,
  unread_for_user   INTEGER NOT NULL DEFAULT 0,
  closed_at         TIMESTAMPTZ,
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_last ON public.chat_conversations(last_message_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conv_guest ON public.chat_conversations(guest_token) WHERE guest_token IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_conv_read" ON public.chat_conversations;
CREATE POLICY "chat_conv_read" ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'chat.view'));

DROP POLICY IF EXISTS "chat_conv_insert_self" ON public.chat_conversations;
CREATE POLICY "chat_conv_insert_self" ON public.chat_conversations
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
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender           TEXT NOT NULL,           -- user | agent | bot | system
  sender_name      TEXT,
  content          TEXT NOT NULL,
  content_type     TEXT NOT NULL DEFAULT 'text',
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON public.chat_messages(conversation_id, created_at);

GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_msg_read" ON public.chat_messages;
CREATE POLICY "chat_msg_read" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'chat.view')
    OR EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_msg_insert" ON public.chat_messages;
CREATE POLICY "chat_msg_insert" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(auth.uid(), 'chat.reply')
    OR EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

-- Compteurs de non-lus + horodatage de la conversation
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

DROP TRIGGER IF EXISTS trg_chat_msg_bump ON public.chat_messages;
CREATE TRIGGER trg_chat_msg_bump
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_chat_conversation();

-- ---------------------------------------------------------------------
-- Accès invité : uniquement via RPC (aucun SELECT direct pour anon)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guest_start_conversation(
  _guest_token TEXT, _name TEXT, _email TEXT, _subject TEXT, _locale TEXT DEFAULT 'en'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF _guest_token IS NULL OR length(_guest_token) < 16 THEN
    RAISE EXCEPTION 'invalid_guest_token';
  END IF;

  SELECT id INTO v_id FROM public.chat_conversations WHERE guest_token = _guest_token;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.chat_conversations (guest_token, guest_name, guest_email, guest_subject, locale)
  VALUES (_guest_token, left(coalesce(_name,''), 120), left(coalesce(_email,''), 200), left(coalesce(_subject,''), 300), coalesce(_locale,'en'))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_list_messages(_guest_token TEXT)
RETURNS TABLE (id UUID, sender TEXT, sender_name TEXT, content TEXT, content_type TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.sender, m.sender_name, m.content, m.content_type, m.created_at
  FROM public.chat_messages m
  JOIN public.chat_conversations c ON c.id = m.conversation_id
  WHERE c.guest_token = _guest_token
  ORDER BY m.created_at;
$$;

CREATE OR REPLACE FUNCTION public.guest_post_message(_guest_token TEXT, _content TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conv UUID; v_id UUID;
BEGIN
  SELECT id INTO v_conv FROM public.chat_conversations
   WHERE guest_token = _guest_token AND status <> 'closed';
  IF v_conv IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF _content IS NULL OR length(trim(_content)) = 0 OR length(_content) > 4000 THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  INSERT INTO public.chat_messages (conversation_id, sender, content)
  VALUES (v_conv, 'user', _content)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_close_conversation(_guest_token TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.chat_conversations
     SET status = 'closed', closed_at = now(), folder = 'archived', updated_at = now()
   WHERE guest_token = _guest_token;
$$;

GRANT EXECUTE ON FUNCTION public.guest_start_conversation(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_list_messages(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_post_message(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_close_conversation(TEXT) TO anon, authenticated;

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

DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
CREATE POLICY "notifications_own" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_staff" ON public.notifications;
CREATE POLICY "notifications_insert_staff" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_permission(auth.uid(), 'notifications.send'));

-- ---------------------------------------------------------------------
-- Abonnements push
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

GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_own" ON public.push_subscriptions;
CREATE POLICY "push_own" ON public.push_subscriptions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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
  handled     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_read_staff" ON public.contact_messages;
CREATE POLICY "contact_read_staff" ON public.contact_messages
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "contact_update_staff" ON public.contact_messages;
CREATE POLICY "contact_update_staff" ON public.contact_messages
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.loan_applications;
