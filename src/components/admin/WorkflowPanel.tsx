/**
 * Panneau bancaire « Informations & décision ».
 *
 * Ce composant est PUREMENT présentationnel : il n'invente aucune transition.
 * Toutes les actions proposées proviennent de `nextStatuses()` (moteur
 * `src/lib/application-workflow.ts`), donc de `canTransition()`. Le frontend
 * ne fait qu'afficher l'état réel du dossier et déléguer la décision au
 * serveur via `applyTransition()`.
 */
import { useAdminT } from "@/hooks/use-admin-t";
import { CheckCircle2, CircleDot, Lock, Ban, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  APPLICATION_STATUS_ORDER,
  statusLabel,
  type ApplicationStatus,
} from "@/lib/application-status";
import {
  DECISION_STATUSES,
  type TransitionCheck,
} from "@/lib/application-workflow";

export type Transition = { status: ApplicationStatus; check: TransitionCheck };

/** Étapes de progression (les branches terminales sont affichées à part). */
const TERMINAL: ApplicationStatus[] = ["rejected", "cancelled"];
const MAIN_PATH = APPLICATION_STATUS_ORDER.filter((s) => !TERMINAL.includes(s));

type StepState = "done" | "current" | "next" | "blocked" | "locked" | "terminal";

const STEP_STYLE: Record<StepState, string> = {
  done: "border-success/40 bg-success/10 text-success",
  current: "border-primary bg-primary text-primary-foreground shadow-sm",
  next: "border-primary/40 bg-primary/5 text-primary",
  blocked: "border-warning/50 bg-warning/10 text-warning",
  locked: "border-border bg-muted/40 text-muted-foreground",
  terminal: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** Libellé d'action attendu à l'étape courante (verbes métier). */
function actionLabel(status: ApplicationStatus, fallback: string): string {
  const MAP: Partial<Record<ApplicationStatus, string>> = {
    received: "Enregistrer la réception",
    verification: "Lancer la vérification",
    documents_missing: "Signaler des documents manquants",
    info_requested: "Demander des informations",
    analysis: "Passer en analyse",
    approved: "Approuver la demande",
    rejected: "Refuser la demande",
    cancelled: "Annuler le dossier",
    offer_available: "Publier l'offre",
    contract_sent: "Préparer et envoyer le contrat",
    signature_pending: "Mettre en attente de signature",
    contract_signed: "Enregistrer la signature",
    guarantee_sent: "Envoyer la garantie",
    guarantee_signed: "Valider la garantie",
    insurance_pending: "Demander l'assurance",
    insurance_validated: "Valider l'assurance",
    disbursement_preparing: "Préparer le décaissement",
    disbursed: "Confirmer le décaissement",
    repaying: "Démarrer le remboursement",
    late: "Marquer en retard",
    repaid: "Clôturer (remboursé)",
  };
  return MAP[status] ?? fallback;
}

export function WorkflowPanel({
  status,
  transitions,
  lastTransitionAt,
  busy,
  onSelect,
}: {
  status: ApplicationStatus;
  transitions: Transition[];
  lastTransitionAt?: string | null;
  busy: boolean;
  onSelect: (status: ApplicationStatus) => void;
}) {
  const { t } = useAdminT();

  const reachable = new Map(transitions.map((tr) => [tr.status, tr.check]));
  const currentIndex = MAIN_PATH.indexOf(status);
  const isTerminalStatus = TERMINAL.includes(status) || transitions.length === 0;

  const decisions = transitions.filter((tr) => DECISION_STATUSES.includes(tr.status));
  const progress = transitions.filter((tr) => !DECISION_STATUSES.includes(tr.status));
  const primary = progress.find((tr) => tr.check.ok) ?? null;
  const secondary = progress.filter((tr) => tr.status !== primary?.status);

  const blockers = transitions
    .filter((tr) => !tr.check.ok && tr.check.reason?.startsWith("workflow.guard."))
    .map((tr) => tr.check.reason!)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  function stateOf(step: ApplicationStatus): StepState {
    if (step === status) return "current";
    const check = reachable.get(step);
    if (check) return check.ok ? "next" : "blocked";
    const index = MAIN_PATH.indexOf(step);
    if (currentIndex >= 0 && index >= 0 && index < currentIndex) return "done";
    return "locked";
  }

  const tr = (key?: string) => (key ? t(key, { defaultValue: key }) : "");

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Informations &amp; décision</CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* A — Étape actuelle */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Étape actuelle</p>
          <p className="mt-1 text-base font-semibold">{statusLabel(status)}</p>
          {lastTransitionAt && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Dernière transition&nbsp;: {new Date(lastTransitionAt).toLocaleString("fr-FR")}
            </p>
          )}
          {isTerminalStatus && (
            <p className="mt-2 text-xs text-muted-foreground">
              Étape terminale : aucune transition supplémentaire n'est autorisée par le moteur.
            </p>
          )}
        </div>

        {/* B — Parcours du dossier (informative) */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Parcours du dossier
          </p>

          <ol className="space-y-1.5">
            {MAIN_PATH.map((step) => {
              const state = stateOf(step);
              const check = reachable.get(step);
              const Icon =
                state === "done"
                  ? CheckCircle2
                  : state === "current"
                    ? CircleDot
                    : state === "blocked"
                      ? Lock
                      : ChevronRight;
              return (
                <li
                  key={step}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                    STEP_STYLE[state],
                  )}
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="flex-1 font-medium">{statusLabel(step)}</span>
                  {state === "blocked" && check?.reason && (
                    <span className="text-[10px] font-normal opacity-80">{tr(check.reason)}</span>
                  )}
                  {state === "current" && (
                    <span className="text-[10px] font-semibold uppercase">en cours</span>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Issues terminales
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TERMINAL.map((step) => (
              <span
                key={step}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                  step === status ? STEP_STYLE.terminal : "border-border bg-muted/40 text-muted-foreground",
                )}
              >
                {statusLabel(step)}
              </span>
            ))}
          </div>
        </div>

        {/* C — Actions disponibles */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Actions disponibles
          </p>

          {transitions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aucune action : le dossier a atteint un statut terminal.
            </p>
          ) : (
            <div className="space-y-3">
              {primary && (
                <div>
                  <Button
                    className="w-full justify-center"
                    disabled={busy || !primary.check.ok}
                    onClick={() => onSelect(primary.status)}
                  >
                    {actionLabel(primary.status, statusLabel(primary.status))}
                  </Button>
                  {!primary.check.ok && primary.check.reason && (
                    <p className="mt-1.5 text-xs text-warning">{tr(primary.check.reason)}</p>
                  )}
                </div>
              )}

              {decisions.length > 0 && (
                <div className="rounded-xl border border-border p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Décision bancaire
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {decisions.map(({ status: s, check }) => (
                      <div key={s}>
                        <Button
                          size="sm"
                          variant={s === "approved" ? "default" : "outline"}
                          className={cn(
                            "w-full justify-center",
                            s === "rejected" && "border-destructive/50 text-destructive hover:bg-destructive/10",
                          )}
                          disabled={busy || !check.ok}
                          onClick={() => onSelect(s)}
                        >
                          {actionLabel(s, statusLabel(s))}
                        </Button>
                        {!check.ok && check.reason && (
                          <p className="mt-1 text-[11px] text-warning">{tr(check.reason)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!decisions.some((d) => d.status === "approved") && !isTerminalStatus && (
                <p className="rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  L'accord définitif se prononce depuis l'étape « {statusLabel("analysis")} ». Faites
                  progresser le dossier jusqu'à cette étape pour voir apparaître «{" "}
                  {statusLabel("approved")} ».
                </p>
              )}

              {secondary.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Autres transitions autorisées
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {secondary.map(({ status: s, check }) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        disabled={busy || !check.ok}
                        title={check.ok ? undefined : tr(check.reason)}
                        onClick={() => onSelect(s)}
                      >
                        {actionLabel(s, statusLabel(s))}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* D — Conditions bloquantes explicites */}
        {blockers.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
              <Ban className="h-3.5 w-3.5" aria-hidden /> Conditions à lever
            </p>
            <ul className="mt-1.5 list-inside list-disc text-xs text-warning">
              {blockers.map((b) => (
                <li key={b}>{tr(b)}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
