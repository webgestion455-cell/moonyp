import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CenterLoader } from "@/components/ui/loader";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Mail, LockKeyhole, Wallet } from "lucide-react";
import { toast } from "sonner";
import { requestAdminCode, verifyAdminCode } from "@/lib/admin-2fa.functions";

export const ADMIN_2FA_KEY = "lendly-admin-2fa";

export function getAdmin2FAExpiry(userId?: string | null) {
  if (typeof window === "undefined" || !userId) return 0;
  try {
    const raw = sessionStorage.getItem(ADMIN_2FA_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { userId?: string; expiresAt?: number };
    return parsed.userId === userId ? Number(parsed.expiresAt ?? 0) : 0;
  } catch {
    const legacyExpiry = Number(sessionStorage.getItem(ADMIN_2FA_KEY) ?? 0);
    return Number.isFinite(legacyExpiry) ? legacyExpiry : 0;
  }
}

export function setAdmin2FASession(userId: string) {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  sessionStorage.setItem(ADMIN_2FA_KEY, JSON.stringify({ userId, expiresAt }));
  return expiresAt;
}

export function clearAdmin2FASession() {
  sessionStorage.removeItem(ADMIN_2FA_KEY);
}

export const Route = createFileRoute("/admin/verify")({
  component: AdminVerify,
  head: () => ({ meta: [{ title: "Vérification équipe — MOONYP" }] }),
});

function AdminVerify() {
  const { user, role, isStaff, session, loading: authLoading, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user || role === null) return;
    if (!isStaff) {
      toast.error("Accès refusé");
      navigate({ to: "/", replace: true });
      return;
    }
    if (getAdmin2FAExpiry(user.id) > Date.now()) {
      navigate({ to: "/admin", replace: true });
    }
  }, [user, role, isStaff, authLoading, navigate]);

  async function handleAdminSignIn(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) { toast.error("Email requis"); return; }
    if (!password) { toast.error("Mot de passe requis"); return; }
    setSigningIn(true);
    const { error } = await signIn(normalizedEmail, password);
    setSigningIn(false);
    if (error) {
      toast.error(error.message === "Invalid login credentials" ? "Identifiants incorrects" : error.message);
      return;
    }
    toast.success("Identité validée · envoyez le code 2FA");
  }

  async function handleSend() {
    if (!session) return;
    setSending(true);
    try {
      const res = await requestAdminCode({ data: { accessToken: session.access_token } });
      setSent(true);
      setSentTo(res.email ?? null);
      if (res.channel === "email") {
        toast.success(`Code envoyé à ${res.email}`);
      } else if ((res as any).devCode) {
        setDevCode((res as any).devCode);
        toast.info("Mode dev : code affiché ci-dessous");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'envoi");
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!session || code.length !== 6) return;
    setVerifying(true);
    try {
      await verifyAdminCode({ data: { accessToken: session.access_token, code } });
      setAdmin2FASession(session.user.id);
      toast.success("Accès équipe validé");
      navigate({ to: "/admin", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Code invalide");
    } finally {
      setVerifying(false);
    }
  }

  if (authLoading) {
    return <CenterLoader className="h-96" />;
  }

  const waitingForRole = Boolean(user && role === null);
  const canRequestCode = Boolean(user && isStaff && session);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-2xl font-bold">Vérification équipe</h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Pour des raisons de sécurité, un code à usage unique est requis avant l'accès à l'espace équipe.
      </p>

      <div className="mt-8 w-full rounded-2xl border border-border bg-card p-6 shadow-card">
        {!user ? (
          <form onSubmit={handleAdminSignIn} className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Wallet className="h-4 w-4" /> Connexion espace équipe
            </div>
            <div>
              <Label htmlFor="admin-email">Email professionnel</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5"
                required
              />
            </div>
            <div>
              <Label htmlFor="admin-password">Mot de passe</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5"
                required
              />
            </div>
            <Button type="submit" disabled={signingIn} className="w-full shadow-glow">
              {signingIn ? "Connexion..." : "Continuer vers le 2FA"}
            </Button>
          </form>
        ) : waitingForRole ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Vérification des droits...</div>
        ) : !sent ? (
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" /> Code sera envoyé à <span className="font-medium text-foreground">{user.email}</span>
            </div>
            <Button onClick={handleSend} disabled={sending || !canRequestCode} className="w-full shadow-glow">
              {sending ? "Envoi..." : "Envoyer le code"}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-xs text-center text-muted-foreground">
              Code envoyé à <span className="font-medium text-foreground">{sentTo ?? user.email}</span>
            </p>
            <div>
              <Label htmlFor="code">Code à 6 chiffres</Label>
              <Input
                id="code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                className="mt-1.5 text-center text-2xl tracking-[0.5em]"
                required
              />
            </div>
            {devCode && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs">
                <strong>Dev :</strong> code = <code className="font-mono text-base">{devCode}</code>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Configurez RESEND_API_KEY_MAIL pour recevoir les codes par email.
                </p>
              </div>
            )}
            <Button type="submit" disabled={verifying || code.length !== 6} className="w-full shadow-glow">
              {verifying ? "Vérification..." : "Valider et accéder"}
            </Button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Renvoyer un nouveau code
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
        <LockKeyhole className="h-3.5 w-3.5 text-success" /> Session équipe valide 8h après validation
      </div>
    </div>
  );
}
