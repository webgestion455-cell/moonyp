import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { BankSpinner } from "@/components/ui/loader";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import moonypLogo from "@/assets/moonyp-logo.png";

export const Route = createFileRoute("/auth")({
  component: StaffSignIn,
  head: () => ({
    meta: [
      { title: "Espace équipe — MOONYP" },
      { name: "description", content: "Connexion réservée aux collaborateurs MOONYP." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Espace équipe — MOONYP" },
      { property: "og:description", content: "Connexion réservée aux collaborateurs MOONYP." },
    ],
  }),
});

function StaffSignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/admin", replace: true });
  }, [loading, user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (error) {
      toast.error(t("auth.invalidCredentials"));
      return;
    }
    navigate({ to: "/admin", replace: true });
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/20">
        <BankSpinner size={30} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/20 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t("common.backHome")}
        </Link>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
          <div className="flex items-center gap-3">
            <img
              src={moonypLogo}
              alt="MOONYP"
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
            />
            <div>
              <p className="font-serif text-lg font-semibold">MOONYP</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Espace équipe
              </p>
            </div>
          </div>

          <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Accès réservé aux collaborateurs autorisés. Une vérification à deux facteurs est
              exigée après la connexion. Les clients suivent leur dossier via le lien sécurisé reçu
              par email.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">{t("auth.email")}</Label>
              <Input
                id="staff-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-password">{t("auth.password")}</Label>
              <PasswordInput
                id="staff-password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12"
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-full" disabled={busy}>
              {busy ? <BankSpinner size={18} /> : t("auth.signIn")}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <Link
              to="/reset-password"
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("auth.forgotPassword")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
