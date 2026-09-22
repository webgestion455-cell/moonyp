import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Ban, Copy, Link2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CenterLoader } from "@/components/ui/loader";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import {
  adminCreateKycRequest,
  adminListKycRequests,
  adminRevokeKycRequest,
} from "@/lib/kyc-requests.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/kyc-requests")({
  head: () => ({
    meta: [
      { title: "Vérifications externes — MOONYP" },
      {
        name: "description",
        content:
          "Création et suivi des demandes de vérification d'identité destinées à des clients externes.",
      },
      { property: "og:title", content: "Vérifications externes — MOONYP" },
      {
        property: "og:description",
        content:
          "Création et suivi des demandes de vérification d'identité destinées à des clients externes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminKycRequests,
});

type Row = Awaited<ReturnType<typeof adminListKycRequests>>[number];

const STATUS_LABELS: Record<string, string> = {
  pending: "Lien actif",
  in_progress: "Parcours en cours",
  completed: "Terminée",
  revoked: "Révoquée",
  expired: "Expirée",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  in_progress: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  completed: "border-primary/30 bg-primary/10 text-primary",
  revoked: "border-rose-500/30 bg-rose-500/10 text-rose-700",
  expired: "border-border bg-muted text-muted-foreground",
};

const EXPIRY_CHOICES = [
  { hours: 24, label: "24 heures" },
  { hours: 72, label: "3 jours" },
  { hours: 168, label: "7 jours" },
  { hours: 720, label: "30 jours" },
];

function kycLink(language: string, token: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/${language}/apply?mode=kyc&token=${token}`;
}

function AdminKycRequests() {
  const list = useServerFn(adminListKycRequests);
  const create = useServerFn(adminCreateKycRequest);
  const revoke = useServerFn(adminRevokeKycRequest);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<string>("fr");
  const [hours, setHours] = useState(168);
  const [note, setNote] = useState("");
  const [freshLink, setFreshLink] = useState<{ reference: string; url: string } | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setRows(await list({ data: undefined as never }));
      } catch {
        toast.error("Chargement impossible");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [list],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié");
    } catch {
      toast.error("Copie impossible");
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const created = await create({
        data: {
          full_name: fullName,
          email,
          phone,
          language: language as never,
          expires_in_hours: hours,
          partner_note: note,
        },
      });
      const url = kycLink(created.language, created.token);
      setFreshLink({ reference: created.reference, url });
      void copy(url);
      setFullName("");
      setEmail("");
      setPhone("");
      setNote("");
      await load(true);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === "forbidden"
          ? "Permission insuffisante"
          : "Création impossible — vérifiez les informations saisies",
      );
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (id: string) => {
    try {
      await revoke({ data: { id } });
      toast.success("Demande révoquée");
      await load(true);
    } catch {
      toast.error("Révocation impossible");
    }
  };

  const canSubmit = fullName.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && !busy;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            Vérifications d'identité externes
          </h1>
          <p className="text-sm text-muted-foreground">
            Créez un lien sécurisé pour un client qui n'existe pas encore dans la base : aucune
            demande de prêt ni compte n'est nécessaire.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="kyc_full_name">Nom et prénom du client</Label>
              <Input
                id="kyc_full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Marie Dupont"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc_email">Adresse e-mail</Label>
              <Input
                id="kyc_email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@exemple.com"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc_phone">Téléphone (facultatif)</Label>
              <Input
                id="kyc_phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+33 6 12 34 56 78"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc_language">Langue du parcours</Label>
              <select
                id="kyc_language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc_expiry">Expiration du lien</Label>
              <select
                id="kyc_expiry"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {EXPIRY_CHOICES.map((c) => (
                  <option key={c.hours} value={c.hours}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc_note">Note interne (facultatif)</Label>
              <Input
                id="kyc_note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Partenaire, référence dossier…"
                className="h-11"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Le lien contient uniquement un jeton aléatoire : aucune donnée personnelle n'y figure.
            </p>
            <Button
              className="rounded-full sm:w-auto"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Créer la demande
            </Button>
          </div>

          {freshLink && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Lien à transmettre — {freshLink.reference}
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-md bg-background px-3 py-2 text-xs">
                  {freshLink.url}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => void copy(freshLink.url)}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Copier
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Ce lien n'est affiché qu'une seule fois : il n'est pas conservé en clair.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <CenterLoader />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center gap-2 py-16 text-center">
            <Link2 className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Aucune demande externe pour l'instant.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {r.reference} · {r.full_name}
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px]",
                          STATUS_STYLES[r.effective_status] ?? STATUS_STYLES.expired,
                        )}
                      >
                        {STATUS_LABELS[r.effective_status] ?? r.effective_status}
                      </Badge>
                      {r.kyc_decision && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          Résultat : {r.kyc_decision}
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.email}
                      {r.phone ? ` · ${r.phone}` : ""} · {r.language.toUpperCase()} · expire le{" "}
                      {new Date(r.expires_at).toLocaleString("fr-FR")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Créée le {new Date(r.created_at).toLocaleString("fr-FR")}
                      {r.last_accessed_at
                        ? ` · dernier accès ${new Date(r.last_accessed_at).toLocaleString("fr-FR")}`
                        : ""}
                      {r.completed_at
                        ? ` · terminée ${new Date(r.completed_at).toLocaleString("fr-FR")}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {(r.effective_status === "pending" || r.effective_status === "in_progress") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => void doRevoke(r.id)}
                      >
                        <Ban className="h-3.5 w-3.5" aria-hidden />
                        Révoquer
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
