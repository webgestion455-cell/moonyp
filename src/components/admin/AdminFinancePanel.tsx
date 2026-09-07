import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Banknote,
  CalendarClock,
  FileSignature,
  ShieldCheck,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/ui/loader";

import {
  adminListPayments,
  adminUpdatePaymentStatus,
} from "@/lib/payments.functions";

import {
  adminConfirmDisbursement,
  adminGenerateSchedule,
  adminGetDisbursement,
  adminPrepareDisbursement,
  adminRecordRepayment,
  adminSetInstallmentStatus,
} from "@/lib/disbursements.functions";

import {
  adminSendInsurance,
} from "@/lib/guarantees.functions";

import {
  adminListContracts,
  adminPrepareContract,
  adminSendContract,
} from "@/lib/contracts.functions";

import { formatMoney } from "@/lib/loan-math";

type Payments = Awaited<ReturnType<typeof adminListPayments>>;
type Disb = Awaited<ReturnType<typeof adminGetDisbursement>>;
type ContractsData = Awaited<ReturnType<typeof adminListContracts>>;
type Contract = ContractsData["contracts"][number];

const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-600",
  received: "bg-emerald-500/10 text-emerald-600",
  upcoming: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground",
  processing: "bg-primary/10 text-primary",
  partially_paid: "bg-amber-500/10 text-amber-600",
  late: "bg-destructive/10 text-destructive",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary",
  viewed: "bg-primary/10 text-primary",
  signing: "bg-amber-500/10 text-amber-600",
  signed: "bg-emerald-500/10 text-emerald-600",
};

function maskIban(iban: string | null | undefined) {
  if (!iban) return "—";
  const clean = iban.replace(/\s+/g, "");
  return clean.length < 8
    ? "••••"
    : `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}

function contractStatusLabel(status: string) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyé";
    case "viewed":
      return "Consulté";
    case "signing":
      return "Signature en cours";
    case "signed":
      return "Signé";
    default:
      return status;
  }
}

export function AdminFinancePanel({
  applicationId,
  onChanged,
}: {
  applicationId: string;
  onChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();

  const listPayments = useServerFn(adminListPayments);
  const updatePayment = useServerFn(adminUpdatePaymentStatus);

  const getDisb = useServerFn(adminGetDisbursement);
  const prepare = useServerFn(adminPrepareDisbursement);
  const confirm = useServerFn(adminConfirmDisbursement);
  const generate = useServerFn(adminGenerateSchedule);
  const record = useServerFn(adminRecordRepayment);
  const setInstallment = useServerFn(adminSetInstallmentStatus);

  const sendInsurance = useServerFn(adminSendInsurance);

  // Contrats
  const listContracts = useServerFn(adminListContracts);
  const prepareContract = useServerFn(adminPrepareContract);
  const sendContract = useServerFn(adminSendContract);

  const [payments, setPayments] = useState<Payments>([]);
  const [disb, setDisb] = useState<Disb | null>(null);
  const [contracts, setContracts] = useState<ContractsData | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [firstDue, setFirstDue] = useState("");

  const [insurance, setInsurance] = useState({
    provider: "",
    coverage: "",
    monthly_premium: "",
    fee_amount: "",
    fee_description: "",
    due_date: "",
  });

  const locale = i18n.language;

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const [p, d, c] = await Promise.all([
        listPayments({
          data: {
            application_id: applicationId,
          },
        }),
        getDisb({
          data: {
            application_id: applicationId,
          },
        }),
        listContracts({
          data: {
            application_id: applicationId,
          },
        }),
      ]);

      setPayments(p);
      setDisb(d);
      setContracts(c);

      if (!payoutAmount) {
        setPayoutAmount(String(d.application.amount ?? ""));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Chargement impossible",
      );
    } finally {
      setLoading(false);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, getDisb, listContracts, listPayments]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(
    action: () => Promise<unknown>,
    success: string,
  ) {
    if (busy) return;

    setBusy(true);

    try {
      await action();
      toast.success(success);
      await refresh();
      onChanged?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? t(error.message, {
              defaultValue: error.message,
            })
          : "Action impossible",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <ListSkeleton rows={5} />;
  }

  const schedule = disb?.schedule ?? [];
  const blockers = disb?.blockers ?? [];
  const current = disb?.disbursement ?? null;

  const contractList = contracts?.contracts ?? [];
  const latestContract: Contract | null =
    contractList.length > 0 ? contractList[0] : null;

  return (
    <div className="space-y-4">
      {/* ============================================================
          CONTRAT
      ============================================================ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileSignature className="h-4 w-4" />
            Contrat & signature
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {!latestContract ? (
            <div className="rounded-lg border border-dashed border-border p-4">
              <p className="text-sm font-medium">
                Aucun contrat préparé
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Préparez le contrat à partir de l'offre actuelle. Un
                document PDF versionné sera créé dans Supabase.
              </p>

              <Button
                className="mt-3"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(
                    async () => {
                      const result = await prepareContract({
                        data: {
                          application_id: applicationId,
                        },
                      });

                      if (!result?.id) {
                        throw new Error(
                          "contract_prepare_failed",
                        );
                      }
                    },
                    "Contrat préparé",
                  )
                }
              >
                Préparer le contrat
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    Contrat v{latestContract.version}
                  </p>

                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {latestContract.id}
                  </p>
                </div>

                <Badge
                  className={
                    STATUS_TONE[latestContract.status] ??
                    "bg-muted text-muted-foreground"
                  }
                >
                  {contractStatusLabel(latestContract.status)}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <p className="uppercase text-muted-foreground">
                    Créé le
                  </p>
                  <p className="mt-1 font-medium">
                    {new Date(
                      latestContract.created_at,
                    ).toLocaleString(locale)}
                  </p>
                </div>

                <div>
                  <p className="uppercase text-muted-foreground">
                    Envoyé le
                  </p>
                  <p className="mt-1 font-medium">
                    {latestContract.sent_at
                      ? new Date(
                          latestContract.sent_at,
                        ).toLocaleString(locale)
                      : "—"}
                  </p>
                </div>

                <div>
                  <p className="uppercase text-muted-foreground">
                    Signé le
                  </p>
                  <p className="mt-1 font-medium">
                    {latestContract.signed_at
                      ? new Date(
                          latestContract.signed_at,
                        ).toLocaleString(locale)
                      : "—"}
                  </p>
                </div>
              </div>

              {latestContract.signature_name && (
                <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
                  <span className="text-muted-foreground">
                    Signataire :
                  </span>{" "}
                  <span className="font-medium">
                    {latestContract.signature_name}
                  </span>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {latestContract.previewUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                  >
                    <a
                      href={latestContract.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Prévisualiser le PDF
                    </a>
                  </Button>
                )}

                {latestContract.signedUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                  >
                    <a
                      href={latestContract.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Télécharger le contrat signé
                    </a>
                  </Button>
                )}

                {latestContract.status === "draft" && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        async () => {
                          const result =
                            await sendContract({
                              data: {
                                application_id:
                                  applicationId,
                                contract_id:
                                  latestContract.id,
                              },
                            });

                          if (!result?.ok) {
                            throw new Error(
                              "contract_send_failed",
                            );
                          }
                        },
                        "Contrat envoyé au client",
                      )
                    }
                  >
                    Envoyer au client
                  </Button>
                )}

                {latestContract.status === "sent" ||
                latestContract.status === "viewed" ||
                latestContract.status === "signing" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        async () => {
                          const result =
                            await sendContract({
                              data: {
                                application_id:
                                  applicationId,
                                contract_id:
                                  latestContract.id,
                              },
                            });

                          if (!result?.ok) {
                            throw new Error(
                              "contract_resend_failed",
                            );
                          }
                        },
                        "Contrat renvoyé au client",
                      )
                    }
                  >
                    Renvoyer le contrat
                  </Button>
                ) : null}
              </div>

              {contractList.length > 1 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-2 text-xs font-medium">
                    Versions précédentes
                  </p>

                  <div className="space-y-1">
                    {contractList.slice(1).map((contract) => (
                      <div
                        key={contract.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2 text-xs"
                      >
                        <span>
                          Contrat v{contract.version}
                        </span>

                        <Badge
                          className={
                            STATUS_TONE[contract.status] ??
                            "bg-muted text-muted-foreground"
                          }
                        >
                          {contractStatusLabel(
                            contract.status,
                          )}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
          PAIEMENTS
      ============================================================ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Banknote className="h-4 w-4" />
            Encaissements
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun paiement enregistré.
            </p>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t(
                      `finance.payment.purpose.${p.purpose}`,
                      {
                        defaultValue: p.purpose,
                      },
                    )}{" "}
                    ·{" "}
                    {formatMoney(
                      Number(p.amount),
                      p.currency ?? "EUR",
                      locale,
                    )}
                  </p>

                  <p className="font-mono text-xs text-muted-foreground">
                    {p.reference} · {p.provider} ·{" "}
                    {new Date(
                      p.created_at,
                    ).toLocaleString(locale)}
                  </p>
                </div>

                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    STATUS_TONE[p.status] ?? "bg-muted"
                  }`}
                >
                  {t(
                    `finance.payment.status.${p.status}`,
                    {
                      defaultValue: p.status,
                    },
                  )}
                </span>

                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={
                      busy || p.status === "received"
                    }
                    onClick={() =>
                      run(
                        () =>
                          updatePayment({
                            data: {
                              id: p.id,
                              status: "received",
                            },
                          }),
                        "Encaissement confirmé",
                      )
                    }
                  >
                    Confirmer la réception
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          updatePayment({
                            data: {
                              id: p.id,
                              status: "failed",
                            },
                          }),
                        "Paiement rejeté",
                      )
                    }
                  >
                    Rejeter
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ============================================================
          ASSURANCE
      ============================================================ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" />
            Assurance — prime et frais
          </CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Assureur</Label>
            <Input
              className="mt-1.5"
              value={insurance.provider}
              onChange={(e) =>
                setInsurance({
                  ...insurance,
                  provider: e.target.value,
                })
              }
            />
          </div>

          <div>
            <Label className="text-xs">
              Garanties couvertes
            </Label>
            <Input
              className="mt-1.5"
              value={insurance.coverage}
              onChange={(e) =>
                setInsurance({
                  ...insurance,
                  coverage: e.target.value,
                })
              }
              placeholder="Décès, PTIA, ITT…"
            />
          </div>

          <div>
            <Label className="text-xs">
              Prime mensuelle (€)
            </Label>
            <Input
              className="mt-1.5"
              type="number"
              min={0}
              step="0.01"
              value={insurance.monthly_premium}
              onChange={(e) =>
                setInsurance({
                  ...insurance,
                  monthly_premium: e.target.value,
                })
              }
            />
          </div>

          <div>
            <Label className="text-xs">
              Frais de mise en place (€)
            </Label>
            <Input
              className="mt-1.5"
              type="number"
              min={0}
              step="0.01"
              value={insurance.fee_amount}
              onChange={(e) =>
                setInsurance({
                  ...insurance,
                  fee_amount: e.target.value,
                })
              }
            />
          </div>

          <div className="sm:col-span-2">
            <Label className="text-xs">
              Détail des frais (visible client)
            </Label>
            <Textarea
              className="mt-1.5"
              rows={2}
              maxLength={500}
              value={insurance.fee_description}
              onChange={(e) =>
                setInsurance({
                  ...insurance,
                  fee_description: e.target.value,
                })
              }
            />
          </div>

          <div>
            <Label className="text-xs">
              Échéance de règlement
            </Label>
            <Input
              className="mt-1.5"
              type="date"
              value={insurance.due_date}
              onChange={(e) =>
                setInsurance({
                  ...insurance,
                  due_date: e.target.value,
                })
              }
            />
          </div>

          <div className="flex items-end">
            <Button
              size="sm"
              disabled={
                busy ||
                insurance.monthly_premium === ""
              }
              onClick={() =>
                run(
                  () =>
                    sendInsurance({
                      data: {
                        application_id: applicationId,
                        provider:
                          insurance.provider || undefined,
                        coverage:
                          insurance.coverage || undefined,
                        monthly_premium: Number(
                          insurance.monthly_premium || 0,
                        ),
                        fee_amount: Number(
                          insurance.fee_amount || 0,
                        ),
                        fee_description:
                          insurance.fee_description ||
                          undefined,
                        due_date:
                          insurance.due_date || undefined,
                        currency: "EUR",
                        required: true,
                      },
                    }),
                  "Étape assurance envoyée au client",
                )
              }
            >
              Envoyer l'assurance
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ============================================================
          DÉCAISSEMENT
      ============================================================ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Banknote className="h-4 w-4" />
            Décaissement
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {blockers.length > 0 && (
            <ul className="list-inside list-disc rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700">
              {blockers.map((b) => (
                <li key={b}>
                  {t(b, { defaultValue: b })}
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">
                Bénéficiaire
              </p>
              <p className="font-medium">
                {disb?.application.bank_holder ?? "—"}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-muted-foreground">
                IBAN
              </p>
              <p className="font-mono font-medium">
                {maskIban(
                  disb?.application.bank_iban,
                )}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-muted-foreground">
                Banque
              </p>
              <p className="font-medium">
                {disb?.application.bank_name ?? "—"}
              </p>
            </div>
          </div>

          {current ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">
                  {current.reference}
                </span>

                <Badge
                  variant={
                    current.status === "disbursed"
                      ? "default"
                      : "secondary"
                  }
                >
                  {current.status}
                </Badge>
              </div>

              <p className="text-sm">
                {formatMoney(
                  Number(current.amount),
                  current.currency ?? "EUR",
                  locale,
                )}
                {current.processed_at
                  ? ` · ${new Date(
                      current.processed_at,
                    ).toLocaleString(locale)}`
                  : ""}
              </p>

              {current.status !== "disbursed" && (
                <Button
                  size="sm"
                  disabled={
                    busy || blockers.length > 0
                  }
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Confirmez-vous que les fonds ont réellement été envoyés ?",
                      )
                    ) {
                      return;
                    }

                    void run(
                      () =>
                        confirm({
                          data: {
                            application_id:
                              applicationId,
                            disbursement_id:
                              current.id,
                            confirmed: true,
                            admin_notes:
                              payoutNotes ||
                              undefined,
                          },
                        }),
                      "Décaissement confirmé",
                    );
                  }}
                >
                  Confirmer le décaissement
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">
                  Montant (€)
                </Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  min={0}
                  step="0.01"
                  value={payoutAmount}
                  onChange={(e) =>
                    setPayoutAmount(e.target.value)
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <Label className="text-xs">
                  Note interne
                </Label>
                <Input
                  className="mt-1.5"
                  value={payoutNotes}
                  onChange={(e) =>
                    setPayoutNotes(e.target.value)
                  }
                />
              </div>

              <div>
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    blockers.length > 0 ||
                    !payoutAmount
                  }
                  onClick={() =>
                    run(
                      () =>
                        prepare({
                          data: {
                            application_id:
                              applicationId,
                            amount:
                              Number(payoutAmount),
                            currency: "EUR",
                            admin_notes:
                              payoutNotes ||
                              undefined,
                          },
                        }),
                      "Décaissement préparé",
                    )
                  }
                >
                  Préparer le décaissement
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
          ÉCHÉANCIER
      ============================================================ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4" />
            Échéancier de remboursement
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">
                Première échéance
              </Label>
              <Input
                className="mt-1.5"
                type="date"
                value={firstDue}
                onChange={(e) =>
                  setFirstDue(e.target.value)
                }
              />
            </div>

            <Button
              size="sm"
              variant="outline"
              disabled={busy || !firstDue}
              onClick={() =>
                run(
                  () =>
                    generate({
                      data: {
                        application_id:
                          applicationId,
                        first_due_date: firstDue,
                      },
                    }),
                  "Échéancier généré",
                )
              }
            >
              Générer l'échéancier
            </Button>
          </div>

          {schedule.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune échéance générée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">#</th>
                    <th>Échéance</th>
                    <th>Montant</th>
                    <th>Capital</th>
                    <th>Intérêts</th>
                    <th>Assurance</th>
                    <th>Restant dû</th>
                    <th>Statut</th>
                    <th />
                  </tr>
                </thead>

                <tbody>
                  {schedule.map((row) => {
                    const status =
                      (
                        row as {
                          status?: string;
                        }
                      ).status ??
                      (row.paid
                        ? "paid"
                        : "upcoming");

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border/60"
                      >
                        <td className="py-2">
                          {row.installment_no}
                        </td>

                        <td>
                          {new Date(
                            row.due_date,
                          ).toLocaleDateString(
                            locale,
                          )}
                        </td>

                        <td>
                          {formatMoney(
                            Number(row.amount),
                            "EUR",
                            locale,
                          )}
                        </td>

                        <td>
                          {formatMoney(
                            Number(row.principal),
                            "EUR",
                            locale,
                          )}
                        </td>

                        <td>
                          {formatMoney(
                            Number(row.interest),
                            "EUR",
                            locale,
                          )}
                        </td>

                        <td>
                          {formatMoney(
                            Number(row.insurance),
                            "EUR",
                            locale,
                          )}
                        </td>

                        <td>
                          {formatMoney(
                            Number(
                              row.remaining_balance,
                            ),
                            "EUR",
                            locale,
                          )}
                        </td>

                        <td>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] ${
                              STATUS_TONE[status] ??
                              "bg-muted"
                            }`}
                          >
                            {t(
                              `finance.repayment.status.${status}`,
                              {
                                defaultValue:
                                  status,
                              },
                            )}
                          </span>
                        </td>

                        <td className="whitespace-nowrap py-1 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={
                              busy ||
                              status === "paid"
                            }
                            onClick={() =>
                              run(
                                () =>
                                  record({
                                    data: {
                                      application_id:
                                        applicationId,
                                      installment_id:
                                        row.id,
                                      amount:
                                        Number(
                                          row.amount,
                                        ) -
                                        Number(
                                          (
                                            row as {
                                              paid_amount?: number;
                                            }
                                          )
                                            .paid_amount ??
                                            0,
                                        ),
                                    },
                                  }),
                                "Remboursement enregistré",
                              )
                            }
                          >
                            Encaisser
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={
                              busy ||
                              status === "late"
                            }
                            onClick={() =>
                              run(
                                () =>
                                  setInstallment({
                                    data: {
                                      application_id:
                                        applicationId,
                                      installment_id:
                                        row.id,
                                      status: "late",
                                    },
                                  }),
                                "Échéance marquée en retard",
                              )
                            }
                          >
                            Retard
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

