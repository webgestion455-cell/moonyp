import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import fr from "./locales/fr.json";
import en from "./locales/en.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import it from "./locales/it.json";
import nl from "./locales/nl.json";
import sl from "./locales/sl.json";
import bg from "./locales/bg.json";
import sk from "./locales/sk.json";
import el from "./locales/el.json";
import fi from "./locales/fi.json";
import ro from "./locales/ro.json";
import pl from "./locales/pl.json";
import hr from "./locales/hr.json";
import hu from "./locales/hu.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "nl", label: "Nederlands", flag: "🇳🇱" },
  { code: "sl", label: "Slovenščina", flag: "🇸🇮" },
  { code: "bg", label: "Български", flag: "🇧🇬" },
  { code: "sk", label: "Slovenčina", flag: "🇸🇰" },
  { code: "el", label: "Ελληνικά", flag: "🇬🇷" },
  { code: "fi", label: "Suomi", flag: "🇫🇮" },
  { code: "ro", label: "Română", flag: "🇷🇴" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
  { code: "hr", label: "Hrvatski", flag: "🇭🇷" },
  { code: "hu", label: "Magyar", flag: "🇭🇺" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const LANG_STORAGE_KEY = "bnpparibas.lang";
const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as readonly string[];

function pickSupported(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const short = raw.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_CODES.includes(short) ? short : null;
}

// One-time migration from older localStorage keys
if (typeof window !== "undefined") {
  try {
    const current = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (!current) {
      for (const legacy of ["hsbcloan.lang", "i18nextLng"]) {
        const v = window.localStorage.getItem(legacy);
        const picked = pickSupported(v);
        if (picked) {
          window.localStorage.setItem(LANG_STORAGE_KEY, picked);
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }
}

if (!i18n.isInitialized) {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        fr: { translation: fr },
        en: { translation: en },
        de: { translation: de },
        es: { translation: es },
        it: { translation: it },
        nl: { translation: nl },
        sl: { translation: sl },
        bg: { translation: bg },
        sk: { translation: sk },
        el: { translation: el },
        fi: { translation: fi },
        ro: { translation: ro },
        pl: { translation: pl },
        hr: { translation: hr },
        hu: { translation: hu },
      },
      lng: undefined,
      fallbackLng: "en",
      supportedLngs: SUPPORTED_CODES as string[],
      nonExplicitSupportedLngs: true,
      load: "languageOnly",
      initAsync: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      detection: {
        order: ["localStorage", "navigator", "htmlTag"],
        caches: ["localStorage"],
        lookupLocalStorage: LANG_STORAGE_KEY,
      },
    });

  if (typeof window !== "undefined") {
    i18n.on("languageChanged", (lng) => {
      const short = lng.split("-")[0];
      try {
        document.documentElement.lang = short;
        window.localStorage.setItem(LANG_STORAGE_KEY, short);
      } catch {
        /* ignore */
      }
    });

    const handleSystemChange = () => {
      try {
        const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
        if (stored) return;
      } catch {
        /* ignore */
      }
      const next = pickSupported(window.navigator.language);
      if (next && next !== i18n.resolvedLanguage) {
        void i18n.changeLanguage(next);
      }
    };

    window.addEventListener("languagechange", handleSystemChange);
  }
}

export default i18n;
