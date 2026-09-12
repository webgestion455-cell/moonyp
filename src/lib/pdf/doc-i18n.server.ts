/**
 * Dictionnaire documentaire (contrat, garantie, assurance).
 *
 * Les quinze langues de l'application disposent d'un dictionnaire dédié.
 * Une langue extérieure à cette liste retombe explicitement sur l'anglais.
 */
import fr from "@/lib/pdf/i18n/fr.json";
import en from "@/lib/pdf/i18n/en.json";
import de from "@/lib/pdf/i18n/de.json";
import es from "@/lib/pdf/i18n/es.json";
import it from "@/lib/pdf/i18n/it.json";
import nl from "@/lib/pdf/i18n/nl.json";
import pl from "@/lib/pdf/i18n/pl.json";
import ro from "@/lib/pdf/i18n/ro.json";
import sk from "@/lib/pdf/i18n/sk.json";
import sl from "@/lib/pdf/i18n/sl.json";
import hr from "@/lib/pdf/i18n/hr.json";
import hu from "@/lib/pdf/i18n/hu.json";
import fi from "@/lib/pdf/i18n/fi.json";
import bg from "@/lib/pdf/i18n/bg.json";
import el from "@/lib/pdf/i18n/el.json";

type Bundle = typeof en;

const BUNDLES: Record<string, Bundle> = {
  fr: fr as Bundle,
  en: en as Bundle,
  de: de as Bundle,
  es: es as Bundle,
  it: it as Bundle,
  nl: nl as Bundle,
  pl: pl as Bundle,
  ro: ro as Bundle,
  sk: sk as Bundle,
  sl: sl as Bundle,
  hr: hr as Bundle,
  hu: hu as Bundle,
  fi: fi as Bundle,
  bg: bg as Bundle,
  el: el as Bundle,
};

/** Langue effectivement utilisée pour la mise en page du document. */
export function docLocale(language: string | null | undefined): string {
  const lang = (language ?? "en").slice(0, 2).toLowerCase();
  return BUNDLES[lang] ? lang : "en";
}

function pick(bundle: Bundle, path: string): string | undefined {
  let node: unknown = bundle;
  for (const key of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" ? node : undefined;
}

/** Traducteur documentaire : `docText("fr", "contract.a1t")`. */
export function docText(language: string | null | undefined, path: string): string {
  const lang = docLocale(language);
  return pick(BUNDLES[lang]!, path) ?? pick(BUNDLES["en"]!, path) ?? path;
}

/** Fabrique un traducteur préfixé (« contract. », « guarantee. »…). */
export function docTranslator(language: string | null | undefined, prefix: string) {
  const lang = docLocale(language);
  return (key: string) => docText(lang, key.includes(".") ? key : `${prefix}.${key}`);
}

export type DocBundle = Bundle;
