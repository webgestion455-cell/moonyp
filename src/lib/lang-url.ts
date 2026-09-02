import i18n, { LANG_STORAGE_KEY, SUPPORTED_LANGUAGES } from "@/i18n";
import { detectAcceptLanguage } from "@/lib/lang-detect";

const CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as readonly string[];

export const DEFAULT_LANG = "en";

export function normalizeLang(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const code = raw.toLowerCase().split(/[-_]/)[0]!;
  return CODES.includes(code) ? code : null;
}

export function isSupportedLang(raw: string | undefined | null): boolean {
  return normalizeLang(raw) !== null;
}

/**
 * Langue courante côté client (localStorage → i18n → navigateur), repli EN.
 * Utilisée pour rediriger les URLs sans préfixe vers leur version préfixée.
 */
export function currentLang(): string {
  if (typeof window !== "undefined") {
    try {
      const stored = normalizeLang(window.localStorage.getItem(LANG_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      /* ignore */
    }
    const nav = normalizeLang(window.navigator?.language);
    if (nav) return nav;
  }
  return normalizeLang(i18n.resolvedLanguage) ?? DEFAULT_LANG;
}

/** Applique la langue issue de l'URL (persistée pour les visites suivantes). */
export function applyLang(code: string): void {
  const lang = normalizeLang(code);
  if (!lang) return;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }
  if (i18n.resolvedLanguage !== lang) void i18n.changeLanguage(lang);
}

/** Construit une URL préfixée par la langue : localizedPath("/simulation") → "/de/simulation". */
export function localizedPath(path: string, lang = currentLang()): string {
  const clean = path === "/" ? "" : `/${path.replace(/^\/+/, "")}`;
  return `/${lang}${clean}`;
}

/**
 * Langue à utiliser pour rediriger une URL sans préfixe.
 * Côté serveur, on respecte l'en-tête Accept-Language du visiteur.
 */
export async function resolveLang(): Promise<string> {
  if (typeof window !== "undefined") return currentLang();
  return detectAcceptLanguage() ?? DEFAULT_LANG;
}
