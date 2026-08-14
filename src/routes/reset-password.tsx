import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { PasswordStrength } from "@/components/PasswordStrength";
import { Honeypot } from "@/components/Honeypot";
import { isPasswordStrong } from "@/lib/password";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import i18n from "@/i18n";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({ meta: [{ title: i18n.t("auth.resetTitle") }] }),
});

function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase puts a recovery session in the URL hash; the SDK exchanges it automatically.
    const sub = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "PASSWORD_RECOVERY" || evt === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const hp = (new FormData(e.currentTarget).get("website") as string) || "";
    if (hp) return; // bot
    if (!isPasswordStrong(pw)) {
      toast.error(t("password.notStrong"));
      return;
    }
    if (pw !== pw2) {
      toast.error(t("settings.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("auth.resetSuccess"));
    navigate({ to: "/admin" });
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/auth"><ArrowLeft className="mr-2 h-4 w-4" /> {t("auth.backHome")}</Link>
        </Button>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-elevated md:p-8">
          <div className="mb-5 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">{t("auth.resetTitle")}</h1>
          </div>
          {!ready ? (
            <p className="text-sm text-muted-foreground">{t("auth.resetWaiting")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Honeypot />
              <div className="space-y-2">
                <Label htmlFor="rp-pw">{t("auth.newPassword")}</Label>
                <PasswordInput
                  id="rp-pw"
                  value={pw}
                  onChange={(e) => setPw(e.currentTarget.value)}
                  autoComplete="new-password"
                  required
                  showToggleLabel={{ show: t("password.show"), hide: t("password.hide") }}
                />
                <PasswordStrength password={pw} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rp-pw2">{t("auth.confirmNewPassword")}</Label>
                <PasswordInput
                  id="rp-pw2"
                  value={pw2}
                  onChange={(e) => setPw2(e.currentTarget.value)}
                  autoComplete="new-password"
                  required
                  showToggleLabel={{ show: t("password.show"), hide: t("password.hide") }}
                />
              </div>
              <Button type="submit" className="h-11 w-full shadow-glow" disabled={submitting}>
                {submitting ? t("common.updating") : t("auth.updatePassword")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
