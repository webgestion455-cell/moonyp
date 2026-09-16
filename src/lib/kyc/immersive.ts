/**
 * Mode immersif — masquage du chrome du site pendant la vérification d'identité.
 *
 * Pendant la capture d'une pièce ou la vivacité, l'écran appartient
 * entièrement au parcours : en-tête, pied de page, barre de navigation
 * mobile et chat en direct disparaissent. C'est une exigence à la fois
 * d'ergonomie (aucun défilement, aucune distraction, un seul geste attendu)
 * et de conformité (rien ne doit recouvrir la visée caméra).
 *
 * Le store est volontairement un module partagé plutôt qu'un contexte React :
 * le chrome vit dans `__root.tsx`, très loin du parcours KYC dans l'arbre, et
 * un contexte imposerait d'englober toute l'application pour un état booléen.
 *
 * Compteur plutôt que booléen : plusieurs écrans peuvent demander le mode
 * immersif en même temps (parcours + scanner imbriqué). Le chrome ne
 * réapparaît que lorsque le dernier demandeur s'est retiré, ce qui évite le
 * clignotement du header entre deux étapes.
 */

import { useEffect, useSyncExternalStore } from "react";

let holders = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return holders > 0;
}

/** Côté serveur, le chrome est toujours rendu : aucun rendu immersif en SSR. */
function getServerSnapshot(): boolean {
  return false;
}

/** Lit l'état courant. À utiliser dans le chrome du site. */
export function useImmersive(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Demande le mode immersif tant que `active` est vrai. Le retrait est
 * automatique au démontage : un écran qui disparaît ne peut pas laisser le
 * site amputé de son en-tête.
 */
export function useImmersiveMode(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    holders += 1;
    emit();
    const body = document.body;
    const previousOverflow = body.style.overflow;
    // Aucun défilement de la page derrière le parcours : le client ne doit
    // jamais avoir à faire défiler pour atteindre le bouton attendu.
    body.style.overflow = "hidden";
    return () => {
      holders = Math.max(0, holders - 1);
      body.style.overflow = previousOverflow;
      emit();
    };
  }, [active]);
}
