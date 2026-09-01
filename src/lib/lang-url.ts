import i18n, { LANG_STORAGE_KEY, SUPPORTED_LANGUAGES } from "@/i18n";

const CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as readonly string[];

export function isSupportedLang(raw: string | undefined | null): boolean {
  if (!raw) return false;
  return CODES.includes(raw.toLowerCase().split(/[-_]/)[0]!);
}

/**
 * Gère les URLs préfixées par la langue (/fr, /de/simulation…).
 * Retourne l'URL cible sans le préfixe, ou null si la langue n'est pas supportée.
 */
export function applyLangFromUrl(lang: string, rest: string): string | null {
  if (!isSupportedLang(lang)) return null;
  const code = lang.toLowerCase().split(/[-_]/)[0]!;

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  }
  if (i18n.resolvedLanguage !== code) void i18n.changeLanguage(code);

  const path = rest ? `/${rest.replace(/^\/+/, "")}` : "/";
  // Le préfixe est retiré de l'URL ; la langue voyage en query pour survivre
  // à une redirection effectuée côté serveur (SSR).
  return `${path}?lang=${code}`;
}
