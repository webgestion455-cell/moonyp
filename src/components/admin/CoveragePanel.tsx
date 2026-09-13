/**
 * Garantie & Assurance — poste unique du back-office.
 *
 * Ce panneau porte TOUTE la procédure : envoi des frais (montant saisi par
 * l'administrateur), suivi du choix client, validation explicite du paiement,
 * puis validation de la police d'assurance. Aucun statut n'est écrit
 * directement : les fonctions serveur appellent `applyTransition()`.
 *
 * Règle de sécurité : un clic client ne vaut jamais paiement. Seule la
 * validation administrative ci-dessous fait basculer `payment_status`.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, Umbrella, BadgeEuro, CheckCircle2, Download, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/ui/loader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  adminGetCoverage,
  adminSendGuarantee,
  adminValidateGuaranteePayment,
  adminSendInsurance,
  adminValidateInsurance,
  adminValidateInsurancePayment,
} from "@/lib/guarantees.functions";
import { formatMoney } from "@/lib/loan-math";
import type { ApplicationStatus } from "@/lib/application-status";

/** Étapes du workflow prises en charge par ce panneau (formulaires guidés). */
export const COVERAGE_STEPS: ApplicationStatus[] = [
  "guarantee_sent",
  "guarantee_signed",
  "insurance_pending",
  "insurance_validated",
];

type Coverage = Awaited<ReturnType<typeof adminGetCoverage>>;
type GuaranteeRow = Coverage["guarantees"][number];
type InsuranceRow = Coverage["insurances"][number];

const TONE: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-600",
  awaiting_payment: "bg-amber-500/10 text-amber-600",
  pending: "bg-muted text-muted-foreground",
  unpaid: "bg-muted text-muted-foreground",
  not_required: "bg-muted text-muted-foreground",
  waived: "bg-destructive/10 text-destructive",
  validated: "bg-emerald-500/10 text-emerald-600",
  declined: "bg-destructive/10 text-destructive",
  signed: "bg-emerald-500/10 text-emerald-600",
  sent: "bg-primary/10 text-primary",
  accepted: "bg-primary/10 text-primary",
};

const CHOICE_LABEL: Record<string, string> = {
  pay_now: "Payer maintenant",
  pay_later: "Payer ultérieurement",
  decline: "Renonce au financement",
};

/** Statuts de dossier garantie / assurance, en clair pour le back-office. */
const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  pending: "En attente",
  sent: "Transmis au client",
  accepted: "Accepté",
  signed: "Signé",
  active: "En vigueur",
  validated: "Validée",
  declined: "Refusée",
  cancelled: "Annulée",
  expired: "Expirée",
  waived: "Renoncée",
  not_required: "Non requise",
  completed: "Terminée",
};

/** Types de garantie proposés au back-office. */
const GUARANTEE_KIND_LABEL: Record<string, string> = {
  credit_risk_cover: "Couverture du risque de crédit",
  personal_guarantee: "Garantie personnelle",
  joint_surety: "Caution solidaire",
  bank_guarantee: "Garantie bancaire",
  deposit: "Dépôt de garantie",
  pledge: "Nantissement",
  mortgage: "Hypothèque",
  salary_assignment: "Cession sur salaire",
  third_party_guarantor: "Garant tiers",
  other: "Autre garantie",
};

/** Garanties d'assurance emprunteur proposées au back-office. */
const COVERAGE_LABEL: Record<string, string> = {
  death: "Décès",
  disability: "Invalidité permanente",
  ptia: "Perte totale et irréversible d'autonomie",
  itt: "Incapacité temporaire totale de travail",
  ipt: "Invalidité permanente totale",
  job_loss: "Perte involontaire d'emploi",
  death_disability: "Décès et invalidité permanente",
  death_disability_job_loss: "Décès, invalidité permanente et perte d'emploi",
  loan_repayment: "Remboursement du capital restant dû",
  credit_protection: "Protection des échéances du crédit",
  other: "Autre garantie",
};

/** Style des listes déroulantes natives, aligné sur le composant Input. */
const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Aucun code technique ne doit s'afficher : repli humanisé systématique. */
function humanLabel(dictionary: Record<string, string>, value: unknown, fallback = "—"): string {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  if (!raw) return fallback;
  if (dictionary[raw]) return dictionary[raw]!;
  const words = raw.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "Non payé",
  not_required: "Sans frais",
  pending: "En attente",
  awaiting_payment: "En attente de paiement",
  paid: "Payé (validé)",
  waived: "Renoncé",
  failed: "Échec",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function CoveragePanel({
  applicationId,
  requestedStep,
  onStepHandled,
  onChanged,
  locale = "fr",
}: {
  applicationId: string;
  /** Étape demandée depuis « Informations & décision » (ouvre le formulaire). */
  requestedStep?: ApplicationStatus | null;
  onStepHandled?: () => void;
  onChanged?: () => void;
  locale?: string;
}) {
  const getCoverage = useServerFn(adminGetCoverage);
  const sendGuarantee = useServerFn(adminSendGuarantee);
  const validateGuaranteePayment = useServerFn(adminValidateGuaranteePayment);
  const sendInsurance = useServerFn(adminSendInsurance);
  const validateInsurance = useServerFn(adminValidateInsurance);
  const validateInsurancePayment = useServerFn(adminValidateInsurancePayment);

  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<
    null | "guarantee" | "guaranteePayment" | "insurance" | "insurancePolicy" | "insurancePayment"
  >(null);

  const [gForm, setGForm] = useState({
    fee_amount: "",
    currency: "EUR",
    kind: "credit_risk_cover",
    guarantor_name: "",
    fee_description: "Frais de couverture du risque de crédit",
    payment_instructions: "",
  });
  const [gPay, setGPay] = useState({ payment_reference: "", note: "" });

  const [iForm, setIForm] = useState({
    provider: "",
    policy_number: "",
    coverage: "",
    monthly_premium: "",
    fee_amount: "",
    fee_description: "Frais de mise en place de l'assurance emprunteur",
    currency: "EUR",
    due_date: "",
  });
  const [iPolicy, setIPolicy] = useState({ policy_number: "", starts_on: "", admin_notes: "" });
  const [iPay, setIPay] = useState({ payment_reference: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getCoverage({ data: { application_id: applicationId } }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [getCoverage, applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ouverture du bon formulaire quand l'étape est déclenchée depuis le panneau
  // de décision : l'administrateur ne peut pas « envoyer la garantie » sans
  // saisir le montant des frais.
  // Le dialogue de validation reprend la police déjà enregistrée au dossier :
  // valider sans ressaisir ne doit jamais effacer le numéro existant.
  useEffect(() => {
    const existing = data?.insurances?.[0];
    if (!existing) return;
    setIPolicy((previous) =>
      previous.policy_number || previous.starts_on
        ? previous
        : {
            ...previous,
            policy_number: existing.policy_number ?? "",
            starts_on: existing.starts_on ?? "",
          },
    );
  }, [data]);

  useEffect(() => {
    if (!requestedStep) return;
    if (requestedStep === "guarantee_sent") setDialog("guarantee");
    else if (requestedStep === "guarantee_signed") setDialog("guaranteePayment");
    else if (requestedStep === "insurance_pending") setDialog("insurance");
    else if (requestedStep === "insurance_validated") setDialog("insurancePolicy");
  }, [requestedStep]);

  function close() {
    setDialog(null);
    onStepHandled?.();
  }

  const guarantee: GuaranteeRow | undefined = data?.guarantees?.[0];
  const insurance: InsuranceRow | undefined = data?.insurances?.[0];

  const money = (value: unknown, currency: unknown) =>
    formatMoney(Number(value ?? 0), (currency as string) ?? "EUR", locale);

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(success);
      close();
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          Garantie &amp; assurance
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading ? (
          <ListSkeleton rows={3} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* ----------------------------- Garantie ----------------------- */}
            <section className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BadgeEuro className="h-4 w-4 text-primary" aria-hidden /> Garantie
                </h3>
                {guarantee && (
                  <Badge className={TONE[String(guarantee.payment_status)] ?? TONE.pending}>
                    {humanLabel(PAYMENT_LABEL, guarantee.payment_status, "En attente")}
                  </Badge>
                )}
              </div>

              {guarantee ? (
                <div className="mt-3">
                  <Field label="Type de garantie" value={humanLabel(GUARANTEE_KIND_LABEL, guarantee.kind)} />
                  <Field label="Statut de la garantie" value={humanLabel(STATUS_LABEL, guarantee.status, "En attente")} />
                  <Field label="Frais de couverture" value={money(guarantee.fee_amount ?? guarantee.amount, guarantee.currency)} />
                  <Field
                    label="Choix du client"
                    value={humanLabel(CHOICE_LABEL, guarantee.client_choice, "En attente")}
                  />
                  {guarantee.document_hash && <Field label="Empreinte SHA-256" value={`${guarantee.document_hash.slice(0, 16)}…`} />}
                  <Field
                    label="Date programmée"
                    value={guarantee.scheduled_payment_date ? new Date(guarantee.scheduled_payment_date).toLocaleDateString("fr-FR") : "—"}
                  />
                  <Field label="Rappels envoyés" value={String(guarantee.reminder_count ?? 0)} />
                  <Field
                    label="Paiement validé le"
                    value={guarantee.payment_validated_at ? new Date(guarantee.payment_validated_at).toLocaleString("fr-FR") : "—"}
                  />
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Aucune garantie envoyée. Saisissez les frais de couverture du risque de crédit pour lancer l'étape.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant={guarantee ? "outline" : "default"} onClick={() => setDialog("guarantee")}>
                  {guarantee ? "Nouvelle garantie" : "Envoyer la garantie"}
                </Button>
                {guarantee && guarantee.payment_status !== "paid" && (
                  <Button size="sm" onClick={() => setDialog("guaranteePayment")}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden /> Valider le paiement reçu
                  </Button>
                )}
                {guarantee?.document_url && (
                  <Button asChild size="sm" variant="outline"><a href={guarantee.document_url} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-4 w-4" aria-hidden /> Acte de garantie</a></Button>
                )}
                {guarantee?.signed_document_url && (
                  <Button asChild size="sm" variant="outline"><a href={guarantee.signed_document_url} target="_blank" rel="noreferrer"><Download className="mr-1.5 h-4 w-4" aria-hidden /> Version signée</a></Button>
                )}
              </div>
            </section>

            {/* ----------------------------- Assurance ---------------------- */}
            <section className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Umbrella className="h-4 w-4 text-primary" aria-hidden /> Assurance
                </h3>
                {insurance && (
                  <Badge className={TONE[String(insurance.status)] ?? TONE.pending}>{humanLabel(STATUS_LABEL, insurance.status, "En attente")}</Badge>
                )}
              </div>

              {insurance ? (
                <div className="mt-3">
                  <Field label="Assureur" value={insurance.provider ?? "—"} />
                  <Field label="Prime mensuelle" value={money(insurance.monthly_premium, insurance.currency)} />
                  <Field label="Frais de mise en place" value={money(insurance.fee_amount, insurance.currency)} />
                  <Field
                    label="Paiement des frais"
                    value={humanLabel(PAYMENT_LABEL, insurance.payment_status, "En attente")}
                  />
                  <Field
                    label="Choix du client"
                    value={humanLabel(CHOICE_LABEL, insurance.client_choice, "En attente")}
                  />
                  <Field
                    label="Date programmée"
                    value={insurance.scheduled_payment_date ? new Date(insurance.scheduled_payment_date).toLocaleDateString("fr-FR") : "—"}
                  />
                  <Field label="Numéro de police" value={insurance.policy_number?.trim() || "En cours d'attribution"} />
                  <Field label="Garanties couvertes" value={humanLabel(COVERAGE_LABEL, insurance.coverage)} />
                  {insurance.document_hash && <Field label="Empreinte SHA-256" value={`${insurance.document_hash.slice(0, 16)}…`} />}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Étape distincte de la garantie : définissez la prime, les frais de mise en place et l'échéance.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant={insurance ? "outline" : "default"} onClick={() => setDialog("insurance")}>
                  {insurance ? "Nouvelle assurance" : "Demander l'assurance"}
                </Button>
                {insurance && insurance.payment_status !== "paid" && Number(insurance.fee_amount ?? 0) > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setDialog("insurancePayment")}>
                    Valider les frais reçus
                  </Button>
                )}
                {insurance && insurance.status !== "validated" && (
                  <Button size="sm" onClick={() => setDialog("insurancePolicy")}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden /> Valider l'assurance
                  </Button>
                )}
                {insurance?.document_url && (
                  <Button asChild size="sm" variant="outline"><a href={insurance.document_url} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-4 w-4" aria-hidden /> Notice d'assurance</a></Button>
                )}
                {insurance?.signed_document_url && (
                  <Button asChild size="sm" variant="outline"><a href={insurance.signed_document_url} target="_blank" rel="noreferrer"><Download className="mr-1.5 h-4 w-4" aria-hidden /> Version signée</a></Button>
                )}
              </div>
            </section>
          </div>
        )}

        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Sécurité : un choix du client n'emporte aucun paiement. Le statut « payé » provient uniquement d'une
          validation administrative explicite ou d'un évènement de paiement du prestataire.
        </p>
      </CardContent>

      {/* -------------------------- Dialogue garantie ---------------------- */}
      <Dialog open={dialog === "guarantee"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Envoyer la garantie</DialogTitle>
            <DialogDescription>
              Le montant saisi est enregistré dans le dossier, affiché au client et repris dans l'email.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="g-fee">Frais de couverture du risque de crédit *</Label>
                <Input
                  id="g-fee"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={gForm.fee_amount}
                  onChange={(e) => setGForm({ ...gForm, fee_amount: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="g-cur">Devise</Label>
                <Input
                  id="g-cur"
                  maxLength={3}
                  value={gForm.currency}
                  onChange={(e) => setGForm({ ...gForm, currency: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="g-kind">Type de garantie</Label>
              <select
                id="g-kind"
                className={SELECT_CLASS}
                value={gForm.kind}
                onChange={(e) => setGForm({ ...gForm, kind: e.target.value })}
              >
                {Object.entries(GUARANTEE_KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="g-name">Garant (facultatif)</Label>
              <Input id="g-name" value={gForm.guarantor_name} onChange={(e) => setGForm({ ...gForm, guarantor_name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="g-desc">Libellé des frais</Label>
              <Input id="g-desc" value={gForm.fee_description} onChange={(e) => setGForm({ ...gForm, fee_description: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="g-inst">Instructions de paiement (facultatif)</Label>
              <Textarea
                id="g-inst"
                rows={3}
                value={gForm.payment_instructions}
                onChange={(e) => setGForm({ ...gForm, payment_instructions: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button
              disabled={busy || gForm.fee_amount === "" || Number(gForm.fee_amount) < 0}
              onClick={() =>
                void run(
                  () =>
                    sendGuarantee({
                      data: {
                        application_id: applicationId,
                        kind: gForm.kind,
                        fee_amount: Number(gForm.fee_amount),
                        currency: gForm.currency || "EUR",
                        fee_description: gForm.fee_description || undefined,
                        payment_instructions: gForm.payment_instructions || undefined,
                        guarantor_name: gForm.guarantor_name || undefined,
                      },
                    }),
                  "Garantie envoyée au client",
                )
              }
            >
              Envoyer au client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------- Dialogue validation paiement garantie ---------- */}
      <Dialog open={dialog === "guaranteePayment"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Valider le paiement des frais de garantie</DialogTitle>
            <DialogDescription>
              À n'utiliser qu'après réception effective des fonds. Le dossier passe en « garantie validée ».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="gp-ref">Référence du paiement</Label>
              <Input id="gp-ref" value={gPay.payment_reference} onChange={(e) => setGPay({ ...gPay, payment_reference: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="gp-note">Note interne</Label>
              <Textarea id="gp-note" rows={3} value={gPay.note} onChange={(e) => setGPay({ ...gPay, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button
              disabled={busy || !guarantee}
              onClick={() =>
                void run(
                  () =>
                    validateGuaranteePayment({
                      data: {
                        guarantee_id: guarantee!.id,
                        application_id: applicationId,
                        payment_reference: gPay.payment_reference || undefined,
                        note: gPay.note || undefined,
                      },
                    }),
                  "Paiement de la garantie validé",
                )
              }
            >
              Confirmer la réception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -------------------------- Dialogue assurance ---------------------- */}
      <Dialog open={dialog === "insurance"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Demander l'assurance</DialogTitle>
            <DialogDescription>
              Étape distincte de la garantie : prime mensuelle, frais de mise en place et échéance de paiement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="i-prov">Assureur</Label>
              <Input id="i-prov" value={iForm.provider} onChange={(e) => setIForm({ ...iForm, provider: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="i-pol">Numéro de police</Label>
              <Input
                id="i-pol"
                value={iForm.policy_number}
                placeholder="Laisser vide : la notice indiquera « En cours d'attribution »"
                onChange={(e) => setIForm({ ...iForm, policy_number: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="i-cov">Garanties couvertes</Label>
              <select
                id="i-cov"
                className={SELECT_CLASS}
                value={iForm.coverage}
                onChange={(e) => setIForm({ ...iForm, coverage: e.target.value })}
              >
                <option value="">Non précisées</option>
                {Object.entries(COVERAGE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                La notice d'assurance du client affichera ce libellé traduit dans sa langue.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="i-prem">Prime mensuelle *</Label>
                <Input
                  id="i-prem"
                  type="number"
                  min="0"
                  step="0.01"
                  value={iForm.monthly_premium}
                  onChange={(e) => setIForm({ ...iForm, monthly_premium: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="i-fee">Frais à payer</Label>
                <Input
                  id="i-fee"
                  type="number"
                  min="0"
                  step="0.01"
                  value={iForm.fee_amount}
                  onChange={(e) => setIForm({ ...iForm, fee_amount: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="i-cur">Devise</Label>
                <Input id="i-cur" maxLength={3} value={iForm.currency} onChange={(e) => setIForm({ ...iForm, currency: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div>
              <Label htmlFor="i-desc">Libellé des frais</Label>
              <Input id="i-desc" value={iForm.fee_description} onChange={(e) => setIForm({ ...iForm, fee_description: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="i-due">Échéance de paiement</Label>
              <Input id="i-due" type="date" value={iForm.due_date} onChange={(e) => setIForm({ ...iForm, due_date: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button
              disabled={busy || iForm.monthly_premium === ""}
              onClick={() =>
                void run(
                  () =>
                    sendInsurance({
                      data: {
                        application_id: applicationId,
                        provider: iForm.provider || undefined,
                        policy_number: iForm.policy_number || undefined,
                        coverage: iForm.coverage || undefined,
                        monthly_premium: Number(iForm.monthly_premium || 0),
                        fee_amount: Number(iForm.fee_amount || 0),
                        fee_description: iForm.fee_description || undefined,
                        currency: iForm.currency || "EUR",
                        due_date: iForm.due_date || undefined,
                        required: true,
                      },
                    }),
                  "Assurance demandée au client",
                )
              }
            >
              Envoyer au client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------ Dialogue validation frais assurance ------------- */}
      <Dialog open={dialog === "insurancePayment"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Valider les frais d'assurance reçus</DialogTitle>
            <DialogDescription>Uniquement après réception effective des fonds.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ip-ref">Référence du paiement</Label>
              <Input id="ip-ref" value={iPay.payment_reference} onChange={(e) => setIPay({ ...iPay, payment_reference: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ip-note">Note interne</Label>
              <Textarea id="ip-note" rows={3} value={iPay.note} onChange={(e) => setIPay({ ...iPay, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button
              disabled={busy || !insurance}
              onClick={() =>
                void run(
                  () =>
                    validateInsurancePayment({
                      data: {
                        insurance_id: insurance!.id,
                        application_id: applicationId,
                        payment_reference: iPay.payment_reference || undefined,
                        note: iPay.note || undefined,
                      },
                    }),
                  "Frais d'assurance validés",
                )
              }
            >
              Confirmer la réception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------- Dialogue validation assurance ------------------ */}
      <Dialog open={dialog === "insurancePolicy"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Valider l'assurance</DialogTitle>
            <DialogDescription>Enregistrez la police et la date d'effet : le dossier passe en « assurance validée ».</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ipol-num">Numéro de police</Label>
              <Input id="ipol-num" value={iPolicy.policy_number} onChange={(e) => setIPolicy({ ...iPolicy, policy_number: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ipol-start">Date d'effet</Label>
              <Input id="ipol-start" type="date" value={iPolicy.starts_on} onChange={(e) => setIPolicy({ ...iPolicy, starts_on: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ipol-note">Note interne</Label>
              <Textarea id="ipol-note" rows={3} value={iPolicy.admin_notes} onChange={(e) => setIPolicy({ ...iPolicy, admin_notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button
              disabled={busy || !insurance}
              onClick={() =>
                void run(
                  () =>
                    validateInsurance({
                      data: {
                        insurance_id: insurance!.id,
                        application_id: applicationId,
                        policy_number: iPolicy.policy_number || undefined,
                        starts_on: iPolicy.starts_on || undefined,
                        admin_notes: iPolicy.admin_notes || undefined,
                      },
                    }),
                  "Assurance validée",
                )
              }
            >
              Valider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
