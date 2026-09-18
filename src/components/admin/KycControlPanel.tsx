/**
 * Panneau conformité : état réel de chaque contrôle KYC d'un dossier.
 *
 * Règles d'affichage :
 *   - le statut affiché est celui écrit par le moteur, sans reformulation
 *     valorisante ; un contrôle jamais exécuté affiche « non exécuté » ;
 *   - un contrôle non vérifiable par construction affiche son motif exact ;
 *   - aucune donnée biométrique n'est affichée : seulement des métriques
 *     (distance, netteté, score de détection) et des motifs techniques.
 */

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
  adminKycControlState,
  type AdminControlView,
  type AdminKycControlState,
} from "@/lib/admin-kyc-controls.functions";
import type { ControlStatus, StepKey } from "@/lib/kyc/controls";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<ControlStatus, string> = {
  PASS: "Vérifié",
  FAIL: "Échec",
  REVIEW_REQUIRED: "Revue humaine requise",
  INCONCLUSIVE: "Non concluant",
  NOT_VERIFIED: "Non vérifié",
  NOT_STARTED: "Non exécuté",
};

const STATUS_STYLES: Record<ControlStatus, string> = {
  PASS: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  FAIL: "border-rose-500/30 bg-rose-500/10 text-rose-700",
  REVIEW_REQUIRED: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  INCONCLUSIVE: "border-slate-400/30 bg-slate-400/10 text-slate-700",
  NOT_VERIFIED: "border-slate-400/30 bg-slate-400/10 text-slate-700",
  NOT_STARTED: "border-border bg-muted text-muted-foreground",
};

const STEP_LABELS: Record<StepKey, string> = {
  identity: "1 · Identité",
  address: "2 · Domicile",
  liveness: "3 · Vivacité",
  iban: "4 · IBAN",
  income: "5 · Revenus",
};

const CONTROL_LABELS: Record<string, string> = {
  document_capture_quality: "Qualité de capture de la pièce",
  document_readability: "Lisibilité de la pièce",
  mrz_integrity: "Intégrité de la MRZ (clés de contrôle)",
  identity_data_match: "Concordance des données d'identité",
  document_expiry: "Validité / expiration de la pièce",
  document_authenticity: "Authenticité physique de la pièce",
  id_portrait_extraction: "Extraction du portrait de la pièce",
  sanctions_screening: "Filtrage sanctions",
  pep_screening: "Filtrage PEP",
  fraud_signals: "Signaux de fraude / réutilisation",
  address_document_readability: "Lisibilité du justificatif de domicile",
  address_document_nature: "Nature du justificatif de domicile",
  address_match: "Concordance de l'adresse",
  address_document_recency: "Ancienneté du justificatif de domicile",
  liveness_challenges: "Défis de vivacité réalisés",
  liveness_server_validation: "Revalidation serveur de la vivacité",
  anti_spoofing: "Détection de présentation (écran/photo)",
  face_match: "Correspondance visage ↔ portrait",
  iban_format: "Format et clé de contrôle IBAN",
  iban_document_readability: "Lisibilité du RIB",
  iban_document_match: "Concordance IBAN déclaré ↔ RIB",
  iban_holder_match: "Titularité du compte",
  income_document_readability: "Lisibilité des justificatifs de revenus",
  income_document_nature: "Nature des justificatifs de revenus",
  income_amount_consistency: "Cohérence des montants déclarés",
  income_document_recency: "Ancienneté des justificatifs de revenus",
};

function metricLine(control: AdminControlView): string | null {
  const bits: string[] = [];
  if (control.score !== null)
    bits.push(
      `score ${control.score}${control.threshold !== null ? ` / seuil ${control.threshold}` : ""}`,
    );
  const distance = control.details["distance"];
  if (typeof distance === "number") bits.push(`distance ${distance}`);
  if (control.library)
    bits.push(`${control.library}${control.library_version ? `@${control.library_version}` : ""}`);
  if (control.method) bits.push(control.method);
  return bits.length > 0 ? bits.join(" · ") : null;
}

export function KycControlPanel({ applicationId }: { applicationId: string }) {
  const fetchState = useServerFn(adminKycControlState);
  const [state, setState] = useState<AdminKycControlState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await fetchState({ data: { applicationId } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "lecture_impossible");
    } finally {
      setLoading(false);
    }
  }, [fetchState, applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Lecture de l'état des
        contrôles…
      </p>
    );
  }
  if (error || !state) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        État des contrôles indisponible ({error ?? "aucune session"}). Aucun contrôle ne peut être
        présumé vérifié.
      </p>
    );
  }

  const byStep =
    state.required_steps.length > 0
      ? state.required_steps
      : (Object.keys(STEP_LABELS) as StepKey[]);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">État KYC agrégé :</span>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono">
          {state.aggregate}
        </span>
        <span className="text-muted-foreground">
          (état de vérification documenté — ce n'est pas une décision de crédit)
        </span>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <p className="rounded-lg border border-border bg-background p-2">
          <span className="font-semibold">Liste sanctions / PEP : </span>
          {state.engine.screening_list
            ? `${state.engine.screening_list.source ?? "source inconnue"} — ${state.engine.screening_list.entry_count} entrées${
                state.engine.screening_list.imported_at
                  ? `, importée le ${new Date(state.engine.screening_list.imported_at).toLocaleDateString("fr-FR")}`
                  : ""
              }`
            : "aucune liste active — le filtrage reste non vérifié."}
        </p>
        <p className="rounded-lg border border-border bg-background p-2">
          <span className="font-semibold">Moteur facial interne : </span>
          {`${state.engine.face_jobs.done} traité(s), ${state.engine.face_jobs.pending} en attente, ${state.engine.face_jobs.running} en cours, ${state.engine.face_jobs.error} en erreur`}
          {state.engine.face_jobs.pending + state.engine.face_jobs.running > 0
            ? " — les contrôles biométriques restent non vérifiés jusqu'au traitement."
            : ""}
        </p>
      </div>

      {byStep.map((step) => {
        const controls = state.controls.filter((c) => c.step === step);
        const stepRow = state.steps.find((s) => s.step === step);
        return (
          <section key={step} className="space-y-1.5">
            <header className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide">{STEP_LABELS[step]}</h4>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  STATUS_STYLES[(stepRow?.status ?? "NOT_STARTED") as ControlStatus] ??
                    STATUS_STYLES.NOT_STARTED,
                )}
              >
                {STATUS_LABELS[(stepRow?.status ?? "NOT_STARTED") as ControlStatus] ??
                  "Non exécuté"}
                {stepRow?.attempt ? ` · tentative ${stepRow.attempt}` : ""}
              </span>
            </header>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
              {controls.map((control) => (
                <li key={control.control} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium">
                      {CONTROL_LABELS[control.control] ?? control.control}
                      {!control.required && (
                        <span className="ml-1 text-muted-foreground">(facultatif)</span>
                      )}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        STATUS_STYLES[control.status],
                      )}
                    >
                      {STATUS_LABELS[control.status]}
                    </span>
                  </div>
                  {control.unverifiable && (
                    <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      Non vérifiable par construction : {control.unverifiable_reason}
                    </p>
                  )}
                  {metricLine(control) && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {metricLine(control)}
                    </p>
                  )}
                  {control.reasons.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Motifs : {control.reasons.join(", ")}
                    </p>
                  )}
                  {control.recorded_at && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Enregistré le {new Date(control.recorded_at).toLocaleString("fr-FR")}
                      {control.attempt ? ` (tentative ${control.attempt})` : ""}
                      {control.executed ? "" : " — contrôle non exécuté"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Ligne dépliable réutilisable dans la file KYC. */
export function KycControlDisclosure({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        )}
        État réel des 26 contrôles
      </button>
      {open && (
        <div className="mt-2">
          <KycControlPanel applicationId={applicationId} />
        </div>
      )}
    </div>
  );
}
