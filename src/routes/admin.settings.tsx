import { createFileRoute } from "@tanstack/react-router";
import { ListSkeleton } from "@/components/ui/loader";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase as _sb } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Wallet, CreditCard, QrCode, Bitcoin, Landmark } from "lucide-react";

const supabase: any = _sb;

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
  head: () => ({ meta: [{ title: "Moyens de paiement — Administration BNP PARIBAS" }] }),
});

type Kind = "bank_transfer" | "card" | "qr" | "crypto" | "other";

interface PaymentMethod {
  id: string;
  kind: Kind;
  label: string;
  holder: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  card_brand: string | null;
  card_last4: string | null;
  address: string | null;
  network: string | null;
  qr_url: string | null;
  instructions: string | null;
  currency: string;
  active: boolean;
  sort_order: number;
}

const EMPTY: Omit<PaymentMethod, "id"> = {
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

function AdminSettings() {
  const { hasPermission, isStaff } = useAuth();
  const [rows, setRows] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);
  const canManage = isStaff && hasPermission("settings.manage");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_methods")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setRows((data as PaymentMethod[]) ?? []);
    setLoading(false);
  }

  function openNew() { setEditing(null); setForm(EMPTY); setDialogOpen(true); }
  function openEdit(r: PaymentMethod) {
    setEditing(r);
    setForm({
      kind: r.kind, label: r.label, holder: r.holder ?? "", iban: r.iban ?? "", bic: r.bic ?? "",
      bank_name: r.bank_name ?? "", card_brand: r.card_brand ?? "", card_last4: r.card_last4 ?? "",
      address: r.address ?? "", network: r.network ?? "", qr_url: r.qr_url ?? "",
      instructions: r.instructions ?? "", currency: r.currency, active: r.active, sort_order: r.sort_order,
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.label.trim()) { toast.error("Libellé requis"); return; }
    setSaving(true);
    const payload = { ...form, label: form.label.trim() };
    const q = editing
      ? supabase.from("payment_methods").update(payload).eq("id", editing.id)
      : supabase.from("payment_methods").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "Moyen de paiement mis à jour" : "Moyen de paiement ajouté");
    setEditing(null); setForm(EMPTY); setDialogOpen(false);
    void load();
  }

  async function remove(r: PaymentMethod) {
    if (!confirm(`Supprimer "${r.label}" ?`)) return;
    const { error } = await supabase.from("payment_methods").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Supprimé");
    void load();
  }

  async function toggleActive(r: PaymentMethod) {
    const { error } = await supabase.from("payment_methods").update({ active: !r.active }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    void load();
  }

  const showFields = (kind: Kind) => ({
    bank: kind === "bank_transfer" || kind === "other",
    card: kind === "card",
    crypto: kind === "crypto",
    qr: kind === "qr",
  });

  const fields = showFields(form.kind);


  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Moyens de paiement</h1>
          <p className="text-sm text-muted-foreground">Configurez les moyens de règlement visibles côté client.</p>
        </div>
        {canManage && (
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Nouveau moyen</Button>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Liste ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <ListSkeleton rows={3} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Aucun moyen de paiement configuré.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => {
                const Icon = KIND_META[r.kind]?.icon ?? Wallet;
                return (
                  <div key={r.id} className="border border-border rounded-xl p-4 bg-card space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center shrink-0"><Icon className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{r.label}</p>
                          <p className="text-xs text-muted-foreground">{KIND_META[r.kind]?.label} · {r.currency}</p>
                        </div>
                      </div>
                      <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Actif" : "Inactif"}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {r.iban && <p>IBAN: <span className="font-mono">{r.iban}</span></p>}
                      {r.bic && <p>BIC: <span className="font-mono">{r.bic}</span></p>}
                      {r.card_brand && r.card_last4 && <p>{r.card_brand.toUpperCase()} •••• {r.card_last4}</p>}
                      {r.address && <p className="truncate">Adresse: <span className="font-mono">{r.address}</span></p>}
                      {r.network && <p>Réseau: {r.network}</p>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border">
                        <div className="flex items-center gap-2 mr-auto">
                          <Switch checked={r.active} onCheckedChange={() => toggleActive(r)} />
                          <span className="text-xs text-muted-foreground">Visible</span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="outline" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditing(null); setForm(EMPTY); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier" : "Nouveau moyen de paiement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as Kind })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_META) as Kind[]).map((k) => (
                      <SelectItem key={k} value={k}>{KIND_META[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Devise</Label>
                <Input className="mt-1.5" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })} />
              </div>
            </div>
            <div>
              <Label>Libellé (visible client)</Label>
              <Input className="mt-1.5" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex : Compte BNP Paribas principal" />
            </div>
            {fields.bank && (
              <>
                <div>
                  <Label>Titulaire</Label>
                  <Input className="mt-1.5" value={form.holder ?? ""} onChange={(e) => setForm({ ...form, holder: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>IBAN</Label>
                    <Input className="mt-1.5 font-mono" value={form.iban ?? ""} onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label>BIC</Label>
                    <Input className="mt-1.5 font-mono" value={form.bic ?? ""} onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })} />
                  </div>
                </div>
                <div>
                  <Label>Banque</Label>
                  <Input className="mt-1.5" value={form.bank_name ?? ""} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
                </div>
              </>
            )}
            {fields.card && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Réseau</Label>
                  <Select value={form.card_brand || "visa"} onValueChange={(v) => setForm({ ...form, card_brand: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visa">Visa</SelectItem>
                      <SelectItem value="mastercard">Mastercard</SelectItem>
                      <SelectItem value="amex">American Express</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>4 derniers chiffres</Label>
                  <Input className="mt-1.5 font-mono" maxLength={4} value={form.card_last4 ?? ""} onChange={(e) => setForm({ ...form, card_last4: e.target.value.replace(/\D/g, "") })} />
                </div>
              </div>
            )}
            {fields.crypto && (
              <>
                <div>
                  <Label>Adresse du wallet</Label>
                  <Input className="mt-1.5 font-mono" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div>
                  <Label>Réseau (BTC, ETH, USDT-TRC20…)</Label>
                  <Input className="mt-1.5" value={form.network ?? ""} onChange={(e) => setForm({ ...form, network: e.target.value })} />
                </div>
              </>
            )}
            {fields.qr && (
              <div>
                <Label>URL du QR code</Label>
                <Input className="mt-1.5" value={form.qr_url ?? ""} onChange={(e) => setForm({ ...form, qr_url: e.target.value })} placeholder="https://…" />
              </div>
            )}
            <div>
              <Label>Instructions (facultatif)</Label>
              <Textarea className="mt-1.5" rows={3} value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="Message affiché au client lors du choix de ce moyen…" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <span className="text-sm">Visible côté client</span>
              <div className="ml-auto flex items-center gap-2">
                <Label className="text-xs">Ordre</Label>
                <Input className="w-20" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setForm(EMPTY); }}>Annuler</Button>
            <Button onClick={save} disabled={saving || !canManage}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enregistrement…</> : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
