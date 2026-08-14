import { cn } from "@/lib/utils";

/**
 * Indicateurs de chargement premium (style grandes plateformes fintech).
 * Aucun texte "Chargement…" : anneau de progression + squelettes.
 */

export function BankSpinner({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={cn("inline-block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 50 50" className="h-full w-full animate-spin [animation-duration:900ms]">
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          className="text-border"
        />
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="90 160"
          className="text-primary"
        />
      </svg>
    </span>
  );
}

/** Trois points animés — utilisé dans les bulles de chat. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden="true">
      {[0, 120, 240].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

/** Bloc de squelette générique. */
export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-muted/70",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_infinite]",
        "after:bg-gradient-to-r after:from-transparent after:via-foreground/10 after:to-transparent",
        className,
      )}
    />
  );
}

/** Zone de page en cours de chargement (remplace les textes "Chargement…"). */
export function PageLoader({
  className,
  lines = 4,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div className={cn("w-full space-y-4 p-4 sm:p-6", className)} aria-busy="true">
      <div className="flex items-center gap-3">
        <BankSpinner size={24} />
        <Shimmer className="h-4 w-40 max-w-[45%]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Shimmer key={i} className="h-12 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** Squelette de liste compact (tables, files d'attente, tickets). */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-3", className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Shimmer className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Shimmer className="h-3 w-1/3" />
            <Shimmer className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chargement plein écran centré, discret et premium. */
export function CenterLoader({ className }: { className?: string }) {
  return (
    <div className={cn("grid min-h-[240px] w-full place-items-center", className)} aria-busy="true">
      <BankSpinner size={34} />
    </div>
  );
}
