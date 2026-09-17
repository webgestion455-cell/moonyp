/**
 * Illustrations de décision d'identité.
 *
 * Trois dessins vectoriels dédiés — vérifié, en examen par le service
 * conformité, non vérifié — tracés avec les couleurs sémantiques du thème
 * (`success`, `warning`, `destructive`) : aucune couleur en dur, donc un rendu
 * juste en thème clair comme en thème sombre.
 *
 * Ces illustrations remplacent l'affichage technique (score, motifs machine,
 * contrôles champ par champ) qui n'a pas à être montré au client : il voit la
 * décision, rien d'autre.
 */

import { cn } from "@/lib/utils";

type ArtProps = { className?: string };

const BASE = "h-20 w-20 shrink-0";

/** Identité vérifiée — bouclier et coche. */
export function KycArtApproved({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 96 96" role="img" aria-hidden className={cn(BASE, className)}>
      <circle cx="48" cy="48" r="46" className="fill-success/10" />
      <circle
        cx="48"
        cy="48"
        r="46"
        className="fill-none stroke-success/25"
        strokeWidth="2"
        strokeDasharray="6 7"
      />
      <path
        d="M48 20l20 8v20c0 13.5-8.4 22.8-20 27-11.6-4.2-20-13.5-20-27V28l20-8z"
        className="fill-success/15 stroke-success"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M38 49l7.5 7.5L60 42"
        className="fill-none stroke-success"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Identité en cours d'examen — dossier confié au service conformité. */
export function KycArtReview({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 96 96" role="img" aria-hidden className={cn(BASE, className)}>
      <circle cx="48" cy="48" r="46" className="fill-warning/10" />
      <circle
        cx="48"
        cy="48"
        r="46"
        className="fill-none stroke-warning/25"
        strokeWidth="2"
        strokeDasharray="6 7"
      />
      <rect
        x="22"
        y="28"
        width="52"
        height="40"
        rx="6"
        className="fill-warning/15 stroke-warning"
        strokeWidth="2.5"
      />
      <path d="M22 38h52" className="stroke-warning/60" strokeWidth="2" />
      <circle
        cx="45"
        cy="52"
        r="9"
        className="fill-background stroke-warning"
        strokeWidth="2.5"
      />
      <path
        d="M45 47v5.5l3.5 2.5"
        className="fill-none stroke-warning"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M52 59l9 9"
        className="stroke-warning"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Identité non vérifiée — la pièce doit être reprise. */
export function KycArtRejected({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 96 96" role="img" aria-hidden className={cn(BASE, className)}>
      <circle cx="48" cy="48" r="46" className="fill-destructive/10" />
      <circle
        cx="48"
        cy="48"
        r="46"
        className="fill-none stroke-destructive/25"
        strokeWidth="2"
        strokeDasharray="6 7"
      />
      <rect
        x="20"
        y="30"
        width="56"
        height="38"
        rx="6"
        className="fill-destructive/10 stroke-destructive"
        strokeWidth="2.5"
      />
      <circle cx="36" cy="46" r="6" className="fill-none stroke-destructive/70" strokeWidth="2.5" />
      <path
        d="M28 60c2.5-4.5 5.5-6.5 8-6.5s5.5 2 8 6.5"
        className="fill-none stroke-destructive/70"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M52 44h16M52 53h11" className="stroke-destructive/50" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M34 34l30 30"
        className="stroke-destructive"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
