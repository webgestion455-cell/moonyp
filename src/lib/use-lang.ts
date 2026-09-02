import { useTranslation } from "react-i18next";
import { DEFAULT_LANG, normalizeLang } from "@/lib/lang-url";

/** Langue active, utilisée pour construire les liens préfixés (/de/simulation). */
export function useLang(): string {
  const { i18n } = useTranslation();
  return normalizeLang(i18n.resolvedLanguage) ?? DEFAULT_LANG;
}
