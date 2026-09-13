/**
 * Langue du back-office : français, toujours.
 *
 * Le site public et les documents clients restent multilingues (15 langues) :
 * un dossier allemand reçoit ses emails, son contrat et ses notifications en
 * allemand. En revanche, l'administration MOONYP est un outil interne : elle
 * doit s'afficher intégralement en français, quelle que soit la langue choisie
 * dans le sélecteur de l'interface publique.
 *
 * Usage dans un écran d'administration :
 *   const { t, locale } = useAdminT();
 *
 * `t` est un traducteur figé sur « fr » ; `locale` sert au formatage des dates
 * et des montants (`Intl`). Hors composant (titres de page `head()`), utiliser
 * `adminT()`.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";

/** Langue unique de l'administration. */
export const ADMIN_LOCALE = "fr";

type AdminTOptions = Record<string, unknown>;

/** Traducteur français hors composant React (titres de page, helpers). */
export function adminT(key: string, options?: AdminTOptions): string {
  return i18n.getFixedT(ADMIN_LOCALE)(key, options as never) as unknown as string;
}

/** Traducteur français pour les composants du back-office. */
export function useAdminT() {
  const { i18n: instance } = useTranslation();
  const t = useMemo(() => instance.getFixedT(ADMIN_LOCALE), [instance]);
  return { t, locale: ADMIN_LOCALE, i18n: instance };
}
