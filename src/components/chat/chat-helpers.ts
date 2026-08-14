// Utilitaires partagés pour le Live Chat pro
// - Sanitisation HTML côté client (whitelist stricte)
// - Formatage heure/date locale en temps réel
// - Constantes de branding

export const CHAT_BRAND = {
  bankName: "BNP PARIBAS",
  agentTitle: "Kundenservice-Spezialistin",
  address: "16 boulevard des Italiens, 75009 Paris, France",
  companyNumber: "662 042 449",
  copyright: `© 2000-${new Date().getFullYear()} BNP Paribas, All rights reserved.`,
  primary: "#00915A",
  supportEmail: "cardservice.bnpparibas@gmail.com",
};

const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "EM", "B", "I", "U",
  "UL", "OL", "LI", "A", "SPAN", "DIV", "H4", "H5", "BLOCKQUOTE",
]);
const ALLOWED_ATTRS: Record<string, string[]> = {
  A: ["href", "title", "target", "rel"],
  SPAN: ["style"],
  DIV: ["style"],
};

/** Sanitise du HTML utilisateur/agent côté client via DOMParser (whitelist stricte). */
export function sanitizeHtml(input: string): string {
  if (!input) return "";
  if (typeof window === "undefined") {
    // Fallback SSR : strip tags dangereux basiquement
    return input
      .replace(/<\s*(script|style|iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?>/gi, "")
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
      .replace(/javascript:/gi, "");
  }
  const doc = new DOMParser().parseFromString(`<div id="root">${input}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return "";
  walk(root);
  return root.innerHTML;
}

function walk(node: Element) {
  const kids = Array.from(node.children);
  for (const el of kids) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // remplace par ses enfants (déplié)
      while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
      el.remove();
      continue;
    }
    const allowed = ALLOWED_ATTRS[el.tagName] ?? [];
    for (const attr of Array.from(el.attributes)) {
      if (!allowed.includes(attr.name)) el.removeAttribute(attr.name);
      if (attr.name === "href" && /^\s*javascript:/i.test(attr.value)) el.removeAttribute("href");
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    walk(el);
  }
}

/** Convertit du texte brut en HTML sûr (paragraphes + <br>). */
export function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** Formate une heure selon la locale/timezone du navigateur. */
export function formatTime(iso: string, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale ?? navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Formate une date longue (ex: "Aujourd'hui", "Hier", ou "12 juil. 2026"). */
export function formatDay(iso: string, t: (k: string) => string, locale?: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff === 0) return t("chat.today");
  if (diff === 1) return t("chat.yesterday");
  return new Intl.DateTimeFormat(locale ?? navigator.language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Initiales à partir d'un nom (avatar fallback). */
export function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
