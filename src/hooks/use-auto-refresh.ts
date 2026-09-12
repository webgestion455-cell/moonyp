import { useEffect, useRef } from "react";

/**
 * Cadence d'actualisation silencieuse de l'espace client et du back-office.
 *
 * Le besoin métier est simple : ni le client ni l'équipe ne doivent recharger
 * la page ou l'application pour voir l'état réel d'un dossier. Toutes les
 * sections rafraîchissent donc leurs données toutes les 5 secondes.
 */
export const AUTO_REFRESH_MS = 5000;

export interface AutoRefreshOptions {
  /** Intervalle en millisecondes (5 000 ms par défaut). */
  intervalMs?: number;
  /** Permet de suspendre la boucle (permission manquante, session absente…). */
  enabled?: boolean;
  /** Relance immédiatement au retour d'onglet / de focus. */
  refreshOnFocus?: boolean;
}

/**
 * Rafraîchissement périodique **silencieux**.
 *
 * - la fonction passée doit recharger les données SANS repasser l'écran en
 *   état « chargement » (pas de clignotement, pas de perte de saisie) ;
 * - aucun appel n'est empilé : un cycle attend la fin du précédent ;
 * - la boucle se met en veille lorsque l'onglet est masqué, et repart
 *   immédiatement au retour de l'utilisateur ;
 * - les erreurs réseau sont absorbées : un incident passager ne doit jamais
 *   casser l'écran affiché.
 */
export function useAutoRefresh(
  refresh: () => unknown | Promise<unknown>,
  options: AutoRefreshOptions = {},
): void {
  const { intervalMs = AUTO_REFRESH_MS, enabled = true, refreshOnFocus = true } = options;

  // La référence évite de reconstruire l'intervalle à chaque rendu.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || runningRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      runningRef.current = true;
      try {
        await refreshRef.current();
      } catch {
        // Silencieux : l'écran conserve les dernières données connues.
      } finally {
        runningRef.current = false;
      }
    };

    const timer = window.setInterval(() => void tick(), Math.max(1000, intervalMs));

    const onVisible = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void tick();
    };

    if (refreshOnFocus) {
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onVisible);
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (refreshOnFocus) {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onVisible);
      }
    };
  }, [enabled, intervalMs, refreshOnFocus]);
}
