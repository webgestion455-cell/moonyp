import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldCheck, Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { acceptStaffInvite, declineStaffInvite } from "@/lib/staff.functions";
import { supabase } from "@/integrations/supabase/client";
import { CenterLoader } from "@/components/ui/loader";

const searchSchema = z.object({
  token: z.string().optional(),
  decline: z.string().optional(),
});

export const Route = createFileRoute("/staff-invite")({
  component: StaffInvitePage,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Activation de compte équipe — BNP PARIBAS" },
      {
        name: "description",
        content:
          "Activez votre accès à l'espace d'administration BNP PARIBAS ou refusez l'invitation reçue par e-mail.",
      },
      { property: "og:title", content: "Activation de compte équipe — BNP PARIBAS" },
      { property: "og:description", content: "Activez ou refusez votre invitation équipe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function StaffInvitePage() {
  const { token, decline } = useSearch({ from: "/staff-invite" });
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [declining, setDeclining] = useState(decline === "1");
  const [declined, setDeclined] = useState<string | null>(null);

  // Refus depuis le bouton « Refuser l'invitation » de l'e-mail
  useEffect(() => {
    if (decline !== "1" || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await declineStaffInvite({ data: { token } });
        if (!cancelled) setDeclined(res.email);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Lien invalide");
      } finally {
        if (!cancelled) setDeclining(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decline, token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) { toast.error("Lien d'invitation invalide"); return; }
    if (!fullName.trim()) { toast.error("Nom complet requis"); return; }
    if (password.length < 10) { toast.error("Mot de passe : 10 caractères minimum"); return; }
    if (password !== confirm) { toast.error("Les mots de passe ne correspondent pas"); return; }
    setLoading(true);
    try {
      const res = await acceptStaffInvite({ data: { token, password, fullName: fullName.trim() } });
      setDone(res.email);
      // Connexion automatique puis redirection vers la vérification 2FA équipe
      const { error } = await supabase.auth.signInWithPassword({ email: res.email, password });
      toast.success("Compte activé — bienvenue dans l'équipe");
      if (!error) {
        navigate({ to: "/admin/verify", replace: true });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'activation");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Shell title="Lien invalide">
        <p className="text-sm text-muted-foreground">
          Ce lien d'invitation est incomplet. Contactez votre administrateur pour en recevoir un nouveau.
        </p>
      </Shell>
    );
  }

  if (declining) {
    return (
      <div className="min-h-screen grid place-items-center bg-muted/20 px-4">
        <CenterLoader />
      </div>
    );
  }

  if (declined) {
    return (
      <Shell title="Invitation refusée" icon={<XCircle className="h-6 w-6" />}>
        <p className="text-sm text-muted-foreground">
          L'invitation envoyée à <span className="font-medium text-foreground">{declined}</span> a bien été
          refusée. Aucun compte n'a été créé et le lien n'est plus valable.
        </p>
        <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/" })}>
          Retour à l'accueil
        </Button>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Compte activé" icon={<CheckCircle2 className="h-6 w-6" />}>
        <p className="text-sm text-muted-foreground">
          Bienvenue dans l'équipe. Votre compte <span className="font-medium text-foreground">{done}</span> est prêt.
        </p>
        <Button className="w-full" onClick={() => navigate({ to: "/admin/verify", replace: true })}>
          Accéder à l'espace équipe
        </Button>
      </Shell>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-muted/20 px-4 py-10">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="mt-3">Activer votre compte équipe</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Définissez votre mot de passe pour rejoindre l'espace équipe BNP PARIBAS.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="fullName">Nom complet</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="password">Mot de passe (10 car. min.)</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="confirm">Confirmation</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="mt-1.5" />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Activation…</> : "Activer mon compte"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  const res = await declineStaffInvite({ data: { token } });
                  setDeclined(res.email);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Erreur");
                } finally {
                  setLoading(false);
                }
              }}
            >
              Refuser l'invitation
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Shell({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid place-items-center bg-muted/20 px-4 py-10">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          {icon && (
            <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center text-primary">
              {icon}
            </div>
          )}
          <CardTitle className="mt-3">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}
