import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bitcoin, CreditCard, Landmark, Loader2, Pencil, Plus, QrCode, Trash2, Wallet } from "lucide-react";
import { ListSkeleton } from "@/components/ui/loader";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/admin/AdminUI";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MethodBrands } from "@/components/payments/PaymentBrands";
import {
  adminDeletePaymentMethod,
  adminPaymentSettings,
  adminSavePaymentMethod,
  adminSetPaymentMethodActive,
} from "@/lib/payments.functions";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
  head: () => ({
    meta: [
      { title: "Moyens de paiement — Administration MOONYP" },
      { name: "description", content: "Configuration des moyens de paiement et des prestataires d'encaissement Moonyp." },
      { property: "og:title", content: "Moyens de paiement — Administration MOONYP" },
      { property: "og:description", content: "Configuration des moyens de paiement Moonyp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Settings = Awaited<ReturnType<typeof adminPaymentSettings>>;
type Method = Settings["methods"][number];
type Kind = "bank_transfer" | "card" | "qr" | "crypto" | "other";
type Provider = "bank_transfer" | "stripe" | "paypal";

interface FormState {
  provider: Provider;
  kind: Kind;
  label: string;
  holder: string;
  iban: string;
  bic: string;
  bank_name: string;
  card_brand: string;
  card_last4: string;
  address: string;
  network: string;
  qr_url: string;
  instructions: string;
  currency: string;
  active: boolean;
  sort_order: number;
}

const EMPTY: FormState = {
  provider: "bank_transfer",
  kind: "bank_transfer",
  label: "",
  holder: "",
  iban: "",
  bic: "",
  bank_name: "",
  card_brand: "",
  card_last4: "",
  address: "",
  network: "",
  qr_url: "",
  instructions: "",
  currency: "EUR",
  active: true,
  sort_order: 0,
};

const KIND_META: Record<Kind, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  bank_transfer: { label: "Virement bancaire", icon: Landmark },
  card: { label: "Carte bancaire", icon: CreditCard },
  qr: { label: "QR code", icon: QrCode },
  crypto: { label: "Crypto", icon: Bitcoin },
  other: { label: "Autre", icon: Wallet },
};

const PROVIDER_LABEL: Record<Provider, string> = {
  bank_transfer: "Virement bancaire",
  stripe: "Stripe",
  paypal: "PayPal Business",
};

function AdminSettings() {
  const { hasPermission, isStaff } = useAuth();
  const { t } = useTranslation();
  const load = useServerFn(adminPaymentSettings);
  const save = useServerFn(adminSavePaymentMethod);
  const toggle = useServerFn(adminSetPaymentMethodActive);
  const remove = useServerFn(adminDeletePaymentMethod);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Method | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const canManage = isStaff && hasPermission("settings.manage");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await load());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = settings?.methods ?? [];
  const providers = settings?.providers ?? [];

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(r: Method) {
    setEditing(r);
    setForm({
      provider: (r.provider as Provider) ?? "bank_transfer",
      kind: (r.kind as Kind) ?? "bank_transfer",
      label: r.label,
      holder: r.holder ?? "",
      iban: r.iban ?? "",
      bic: r.bic ?? "",
      bank_name: r.bank_name ?? "",
      card_brand: r.card_brand ?? "",
      card_last4: r.card_last4 ?? "",
      address: r.address ?? "",
      network: r.network ?? "",
      qr_url: r.qr_url ?? "",
      instructions: r.instructions ?? "",
      currency: r.currency,
      active: r.active,
      sort_order: r.sort_order,
    });
    setDialogOpen(true);
  }

  async function submit() {
    if (!form.label.trim()) {
      toast.error("Libellé requis");
      return;
    }
    setSaving(true);
    try {
      await save({ data: { ...form, label: form.label.trim(), id: editing?.id } });
      toast.success(editing ? "Moyen de paiement mis à jour" : "Moyen de paiement ajouté");
      setEditing(null);
      setForm(EMPTY);
      setDialogOpen(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const fields = {
    bank: form.kind === "bank_transfer" || form.kind === "other",
    card: form.kind === "card",
    crypto: form.kind === "crypto",
    qr: form.kind === "qr",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moyens de paiement"
        subtitle="Configurez les moyens de règlement visibles côté client. Les clés API restent côté serveur."
        actions={<>
        {canManage && (
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Nouveau moyen
          </Button>
        )}
        </>}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Prestataires</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {providers.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{PROVIDER_LABEL[p.id as Provider] ?? p.id}</p>
                <Badge variant={p.configured ? "default" : "secondary"}>
                  {p.configured ? "Configuré" : "Non configuré"}
                </Badge>
              </div>
              {!p.configured && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Secrets manquants : {p.missingEnv.join(", ") || "—"}. Tant qu'ils ne sont pas renseignés, ce
                  prestataire n'est pas proposé aux clients.
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Liste ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ListSkeleton rows={3} />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucun moyen de paiement configuré.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => {
                const Icon = KIND_META[r.kind as Kind]?.icon ?? Wallet;
                const providerStatus = providers.find((p) => p.id === r.provider);
                return (
                  <div key={r.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{r.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {KIND_META[r.kind as Kind]?.label ?? r.kind} · {r.currency}
                          </p>
                        </div>
                      </div>
                      <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Actif" : "Inactif"}</Badge>
                    </div>

                    <MethodBrands kind={r.kind} provider={r.provider} />

                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <p>Prestataire : {PROVIDER_LABEL[r.provider as Provider] ?? r.provider}</p>
                      {providerStatus && !providerStatus.configured && (
                        <p className="text-amber-600">Prestataire non configuré — invisible côté client.</p>
                      )}
                      {r.iban && (
                        <p>
                          IBAN : <span className="font-mono">{r.iban}</span>
                        </p>
                      )}
                      {r.bic && (
                        <p>
                          BIC : <span className="font-mono">{r.bic}</span>
                        </p>
                      )}
                      {r.card_brand && r.card_last4 && (
                        <p>
                          {r.card_brand.toUpperCase()} •••• {r.card_last4}
                        </p>
                      )}
                      {r.address && <p className="truncate">Adresse : <span className="font-mono">{r.address}</span></p>}
                      {r.network && <p>Réseau : {r.network}</p>}
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-2 border-t border-border pt-2">
                        <div className="mr-auto flex items-center gap-2">
                          <Switch
                            checked={r.active}
                            onCheckedChange={async (v) => {
                              await toggle({ data: { id: r.id, active: v } });
                              await refresh();
                            }}
                          />
                          <span className="text-xs text-muted-foreground">Visible</span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            if (!confirm(`Supprimer « ${r.label} » ?`)) return;
                            await remove({ data: { id: r.id } });
                            toast.success("Supprimé");
                            await refresh();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setEditing(null);
            setForm(EMPTY);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier" : "Nouveau moyen de paiement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prestataire</Label>
                <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as Provider })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as Kind })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_META) as Kind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_META[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Libellé (visible client)</Label>
                <Input
                  className="mt-1.5"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Ex : Compte Moonyp principal"
                />
              </div>
              <div>
                <Label>Devise</Label>
                <Input
                  className="mt-1.5"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })}
                />
              </div>
            </div>

            {fields.bank && (
              <>
                <div>
                  <Label>Titulaire</Label>
                  <Input className="mt-1.5" value={form.holder} onChange={(e) => setForm({ ...form, holder: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>IBAN</Label>
                    <Input
                      className="mt-1.5 font-mono"
                      value={form.iban}
                      onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div>
                    <Label>BIC</Label>
                    <Input
                      className="mt-1.5 font-mono"
                      value={form.bic}
                      onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Banque</Label>
                  <Input
                    className="mt-1.5"
                    value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                  />
                </div>
              </>
            )}

            {fields.card && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Réseau</Label>
                  <Select value={form.card_brand || "visa"} onValueChange={(v) => setForm({ ...form, card_brand: v })}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visa">Visa</SelectItem>
                      <SelectItem value="mastercard">Mastercard</SelectItem>
                      <SelectItem value="amex">American Express</SelectItem>
                      <SelectItem value="cb">Carte Bancaire</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>4 derniers chiffres</Label>
                  <Input
                    className="mt-1.5 font-mono"
                    maxLength={4}
                    value={form.card_last4}
                    onChange={(e) => setForm({ ...form, card_last4: e.target.value.replace(/\D/g, "") })}
                  />
                </div>
              </div>
            )}

            {fields.crypto && (
              <>
                <div>
                  <Label>Adresse du wallet</Label>
                  <Input
                    className="mt-1.5 font-mono"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Réseau (BTC, ETH, USDT-TRC20…)</Label>
                  <Input className="mt-1.5" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} />
                </div>
              </>
            )}

            {fields.qr && (
              <div>
                <Label>URL du QR code</Label>
                <Input
                  className="mt-1.5"
                  value={form.qr_url}
                  onChange={(e) => setForm({ ...form, qr_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
            )}

            <div>
              <Label>Instructions (facultatif)</Label>
              <Textarea
                className="mt-1.5"
                rows={3}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                placeholder="Message affiché au client lors du choix de ce moyen…"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <span className="text-sm">Visible côté client</span>
              <div className="ml-auto flex items-center gap-2">
                <Label className="text-xs">Ordre</Label>
                <Input
                  className="w-20"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("workflow.cancel", { defaultValue: "Annuler" })}
            </Button>
            <Button onClick={() => void submit()} disabled={saving || !canManage}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enregistrement…
                </>
              ) : (
                "Enregistrer"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
