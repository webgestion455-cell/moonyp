/**
 * Briques d'interface communes du back-office.
 *
 * Objectif : une seule façon d'afficher un en-tête de section, une tuile
 * d'indicateur, un jeu de filtres et un état vide — pour que toutes les
 * sections du back-office se lisent de la même manière (standard bancaire).
 * Purement présentationnel : aucune logique métier ici.
 */
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** En-tête de page : titre, sous-titre et actions alignées à droite. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="font-serif text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Intitulé de bloc à l'intérieur d'une page. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {aside}
    </div>
  );
}

export type StatTone = "neutral" | "positive" | "warning" | "critical" | "primary";

const TONE_TEXT: Record<StatTone, string> = {
  neutral: "text-sky-600 dark:text-sky-400",
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-rose-600 dark:text-rose-400",
  primary: "text-primary",
};

/** Tuile d'indicateur : dense, lisible, cliquable si `href` est fourni. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  size = "sm",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: StatTone;
  size?: "sm" | "lg";
}) {
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-sm">
      <CardContent className={cn("flex flex-col gap-1", size === "lg" ? "p-4 sm:p-5" : "p-3.5")}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
            {label}
          </p>
          {Icon && <Icon className={cn("h-4 w-4 shrink-0", TONE_TEXT[tone])} />}
        </div>
        <p
          className={cn(
            "break-words font-serif font-semibold tabular-nums",
            size === "lg" ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl",
          )}
        >
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Barre de filtres homogène (pastilles défilables sur petit écran). */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            value === o.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:bg-muted",
          )}
        >
          {o.label}
          {typeof o.count === "number" && (
            <span className="ml-1.5 opacity-70 tabular-nums">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** État vide compact : jamais de grande zone blanche inutile. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="grid place-items-center gap-2 px-6 py-10 text-center">
        {Icon && (
          <span className="grid h-10 w-10 place-items-center rounded-full bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </span>
        )}
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
        {action && <div className="mt-1">{action}</div>}
      </CardContent>
    </Card>
  );
}

/** Conteneur de liste : bordures internes homogènes, pas de rembourrage vide. */
export function ListCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">{children}</ul>
      </CardContent>
    </Card>
  );
}
