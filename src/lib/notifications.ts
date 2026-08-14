import { supabase } from "@/integrations/supabase/client";
import i18n from "@/i18n";

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  link: string | null;
  category: string;
  read: boolean;
  created_at: string;
}

type Category = "info" | "success" | "warning" | "danger";
type Params = Record<string, string | number>;

/**
 * notifyUser : envoie une notification dans la langue du DESTINATAIRE.
 *
 * Deux signatures :
 *  - Recommandée : { userId, titleKey, messageKey, params, ... }
 *    -> la langue est lue depuis profiles.language et le rendu i18n
 *       est effectué avec cette langue, indépendamment de la langue
 *       de l'utilisateur qui déclenche l'action.
 *  - Compatibilité : { userId, title, message, ... } -> texte brut.
 */
export type NotifyUserInput =
  | {
      userId: string;
      titleKey: string;
      messageKey: string;
      params?: Params;
      link?: string;
      category?: Category;
    }
  | {
      userId: string;
      title: string;
      message: string;
      link?: string;
      category?: Category;
    };

async function getUserLanguage(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("language")
      .eq("user_id", userId)
      .maybeSingle();
    const lang = (data as { language?: string } | null)?.language;
    return lang && lang.length > 0 ? lang : "fr";
  } catch {
    return "fr";
  }
}

function renderForLang(
  lng: string,
  titleKey: string,
  messageKey: string,
  params?: Params,
): { title: string; message: string } {
  const title = i18n.t(titleKey, { lng, ...(params ?? {}) }) as string;
  const message = i18n.t(messageKey, { lng, ...(params ?? {}) }) as string;
  return { title, message };
}

export async function notifyUser(input: NotifyUserInput) {
  let title: string;
  let message: string;
  if ("titleKey" in input) {
    const lng = await getUserLanguage(input.userId);
    const rendered = renderForLang(lng, input.titleKey, input.messageKey, input.params);
    title = rendered.title;
    message = rendered.message;
  } else {
    title = input.title;
    message = input.message;
  }

  const { error } = await supabase.from("notifications").insert({
    user_id: input.userId,
    title,
    message,
    link: input.link ?? null,
    category: input.category ?? "info",
    read: false,
  });
  if (error) {
    console.error("Notification insert error:", error);
  }

  await sendPush({ userId: input.userId, title, message, link: input.link });
}

export type NotifyAdminsInput =
  | {
      titleKey: string;
      messageKey: string;
      params?: Params;
      link?: string;
      category?: Category;
    }
  | {
      title: string;
      message: string;
      link?: string;
      category?: Category;
    };

export async function notifyAllAdmins(input: NotifyAdminsInput) {
  const { data: admins } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
  if (!admins) return;
  await Promise.all(
    admins.map((a) => {
      if ("titleKey" in input) {
        return notifyUser({
          userId: a.user_id,
          titleKey: input.titleKey,
          messageKey: input.messageKey,
          params: input.params,
          link: input.link,
          category: input.category,
        });
      }
      return notifyUser({
        userId: a.user_id,
        title: input.title,
        message: input.message,
        link: input.link,
        category: input.category,
      });
    }),
  );
}

export async function sendPush(params: {
  userId: string;
  title: string;
  message: string;
  link?: string;
}) {
  try {
    await supabase.functions.invoke("send-push", { body: params });
  } catch {
    // push optionnel — ignore en cas d'absence d'edge function
  }
}

export function ensureBrowserPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return Promise.resolve("unsupported" as const);
  if (Notification.permission === "granted") return Promise.resolve("granted" as const);
  if (Notification.permission === "denied") return Promise.resolve("denied" as const);
  return Notification.requestPermission().then((p) => p as "granted" | "denied" | "default");
}

export function showBrowserNotification(n: Pick<AppNotification, "title" | "message" | "link">) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const notif = new Notification(n.title, {
      body: n.message,
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      tag: n.title,
    });
    if (n.link) {
      notif.onclick = () => {
        window.focus();
        window.location.href = n.link!;
      };
    }
  } catch {
    /* ignore */
  }
}

export function playNotificationSound() {
  try {
    const audio = new Audio("/notification.mp3");
    audio.volume = 1.0;
    audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}
