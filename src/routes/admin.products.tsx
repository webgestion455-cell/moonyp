import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Package, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CenterLoader } from "@/components/ui/loader";
import { adminListProducts, adminUpdateProduct } from "@/lib/admin-catalog.functions";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";

export const Route = createFileRoute("/admin/products")({
  component: AdminProducts,
});

type Product = Awaited<ReturnType<typeof adminListProducts>>[number];

const NUMERIC_FIELDS: { key: keyof Product; label: string; step?: string }[] = [
  { key: "min_amount", label: "Montant min (€)" },
  { key: "max_amount", label: "Montant max (€)" },
  { key: "min_months", label: "Durée min (mois)" },
  { key: "max_months", label: "Durée max (mois)" },
  { key: "annual_rate", label: "Taux annuel (%)", step: "0.01" },
  { key: "insurance_monthly_rate", label: "Assurance (%/mois)", step: "0.001" },
  { key: "fee_fixed", label: "Frais fixes (€)" },
  { key: "fee_percent", label: "Frais (%)", step: "0.01" },
  { key: "max_dti_percent", label: "Taux d'endettement max (%)", step: "0.1" },
];

function AdminProducts() {
  const list = useServerFn(adminListProducts);
  const update = useServerFn(adminUpdateProduct);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  /*
   * Les produits sont éditables en ligne : l'actualisation automatique ne doit
   * jamais écraser une saisie en cours. On mémorise donc les produits modifiés
   * et non encore enregistrés, et on suspend le rafraîchissement tant qu'il en
   * reste au moins un.
   */
  const dirtyRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setProducts(await list({ data: undefined as never }));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [list],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Actualisation automatique toutes les 5 secondes, hors saisie en cours.
  useAutoRefresh(() => {
    if (dirtyRef.current.size > 0) return;
    return load(true);
  });

  const patch = (id: string, key: string, value: unknown) => {
    dirtyRef.current.add(id);
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
  };

  const save = async (p: Product) => {
    setBusy(p.id);
    try {
      await update({
        data: {
          id: p.id,
          active: p.active,
          min_amount: Number(p.min_amount),
          max_amount: Number(p.max_amount),
          min_months: Number(p.min_months),
          max_months: Number(p.max_months),
          annual_rate: Number(p.annual_rate),
          insurance_monthly_rate: Number(p.insurance_monthly_rate),
          fee_fixed: Number(p.fee_fixed),
          fee_percent: Number(p.fee_percent),
          max_dti_percent: Number(p.max_dti_percent),
        },
      });
      // Saisie enregistrée : l'actualisation automatique peut reprendre.
      dirtyRef.current.delete(p.id);
      toast.success("Produit mis à jour");
    } catch {
      toast.error("Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <CenterLoader />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Catalogue de financement</h1>
        <p className="text-sm text-muted-foreground">
          Barèmes, plafonds et frais appliqués au simulateur et au parcours de demande.
        </p>
      </header>

      {products.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center gap-2 py-16 text-center">
            <Package className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Aucun produit configuré.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {products.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-sm font-semibold">{p.name}</CardTitle>
                  <p className="truncate text-xs text-muted-foreground">{p.slug}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Label htmlFor={`active-${p.id}`} className="text-xs text-muted-foreground">
                    Actif
                  </Label>
                  <Switch
                    id={`active-${p.id}`}
                    checked={Boolean(p.active)}
                    onCheckedChange={(v) => patch(p.id, "active", v)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {NUMERIC_FIELDS.map((f) => (
                    <div key={String(f.key)} className="space-y-1">
                      <Label htmlFor={`${String(f.key)}-${p.id}`} className="text-[11px] text-muted-foreground">
                        {f.label}
                      </Label>
                      <Input
                        id={`${String(f.key)}-${p.id}`}
                        type="number"
                        inputMode="decimal"
                        step={f.step ?? "1"}
                        value={String(p[f.key] ?? "")}
                        onChange={(e) => patch(p.id, String(f.key), e.target.value)}
                        className="h-9"
                      />
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={busy === p.id}
                  onClick={() => void save(p)}
                >
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  Enregistrer
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
