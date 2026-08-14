import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase as _sb } from "@/integrations/supabase/client";
// Types widening — new tables (security_alerts, profiles.language, ...) live in a
// migration that regenerates supabase/types.ts; cast until then.
const supabase: any = _sb;
import i18n from "i18next";

import type { StaffRole } from "@/lib/permissions";

type Role = "admin" | "user";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  role: Role | null;
  /** Rôle métier réel : super_admin | admin | agent | null (client) */
  staffRole: StaffRole | null;
  /** Tous les rôles bruts affectés à l'utilisateur */
  roles: string[];
  /** Clés de permissions effectives */
  permissions: string[];
  isStaff: boolean;
  isSuperAdmin: boolean;
  hasPermission: (key: string) => boolean;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string, phone: string, lang: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const STAFF_PRIORITY: StaffRole[] = ["super_admin", "admin", "agent"];

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  let active = true;
  const failSafe = window.setTimeout(() => {
    if (active) setLoading(false);
  }, 2500);

  // IMPORTANT: CAPTURE SUBSCRIPTION
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event: string, newSession: Session | null) => {
    if (!active) return;


    setSession(newSession);
    setUser(newSession?.user ?? null);

    // NO USER
    if (!newSession?.user) {
      setRole(null);
      setLoading(false);
      return;
    }

    // EMAIL NON CONFIRMÉ
    if (!newSession.user.email_confirmed_at) {
      setRole(null);
      setLoading(false);
      return;
    }

    setRole(null);

    setTimeout(() => {
      void fetchRole(newSession.user.id);
    }, 0);

    setLoading(false);
  });

  // CHECK SESSION INITIALE
  supabase.auth
    .getSession()
    .then(({ data: { session: existing } }: { data: { session: Session | null } }) => {
      if (!active) return;

      setSession(existing);
      setUser(existing?.user ?? null);

      if (!existing?.user) {
        setRole(null);
        setLoading(false);
        return;
      }

      if (!existing.user.email_confirmed_at) {
        setRole(null);
        setLoading(false);
        return;
      }

      setRole(null);
      void fetchRole(existing.user.id);
    })
    .catch(() => {
      if (!active) return;
      setSession(null);
      setUser(null);
      setRole(null);
    })
    .finally(() => {
      if (!active) return;
      window.clearTimeout(failSafe);
      setLoading(false);
    });

  return () => {
    active = false;
    window.clearTimeout(failSafe);
    subscription.unsubscribe();
  };
}, []);

  async function fetchRole(userId: string) {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const list: string[] = (data ?? []).map((r: { role: string }) => r.role);
    setRoles(list);
    const staff = list.some((r) => r === "admin" || r === "super_admin" || r === "agent");
    setRole(staff ? "admin" : "user");

    if (staff) {
      const { data: perms } = await supabase.rpc("my_permissions");
      const keys = Array.isArray(perms)
        ? (perms as Array<{ permission_key: string } | string>).map((p) =>
            typeof p === "string" ? p : p.permission_key,
          )
        : [];
      setPermissions(list.includes("super_admin") && keys.length === 0 ? ["*"] : keys);
    } else {
      setPermissions([]);
    }

    // Synchronise la langue préférée du profil avec i18n
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("language")
        .eq("user_id", userId)
        .maybeSingle();
      const lang = (prof as { language?: string } | null)?.language;
      if (lang && i18n.resolvedLanguage?.split("-")[0] !== lang) {
        void i18n.changeLanguage(lang);
      } else {
        // Pas de langue serveur → persiste la langue courante côté serveur
        const cur = (i18n.resolvedLanguage || i18n.language || "fr").split("-")[0];
        await supabase.from("profiles").update({ language: cur }).eq("user_id", userId);
      }
    } catch {
      /* ignore */
    }
  }

  // Persiste la langue choisie côté profil dès qu'elle change
  useEffect(() => {
    const handler = (lng: string) => {
      const short = (lng || "fr").split("-")[0];
      const uid = user?.id;
      if (!uid) return;
      void supabase.from("profiles").update({ language: short }).eq("user_id", uid);
    };
    i18n.on("languageChanged", handler);
    return () => {
      i18n.off("languageChanged", handler);
    };
  }, [user?.id]);

  async function signUp(email: string, password: string, fullName: string, phone: string, lang: string) {
    const redirectUrl = `${window.location.origin}/dashboard`;
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { full_name: fullName, phone, lang: lang.substring(0,2).toLowerCase(), },
      },
    });
    try {
      const { logSecurityEvent, checkAndRegisterDevice } = await import("@/lib/security");
      await logSecurityEvent("signup", { userId: data?.user?.id ?? null, success: !error, metadata: { email } });
      if (data?.user?.id) await checkAndRegisterDevice(data.user.id);
    } catch {}
    return { error };
  }

  async function signIn(email: string, password: string) {
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    try {
      const sec = await import("@/lib/security");
      if (error) {
        await sec.logSecurityEvent("login_failure", { userId: null, success: false, metadata: { email, reason: error.message } });
      } else if (data.user) {
        const dev = await sec.checkAndRegisterDevice(data.user.id);
        await sec.logSecurityEvent("login_success", { userId: data.user.id, metadata: { newDevice: dev.isNew, newCountry: dev.isNewCountry } });
        if (dev.isNew || dev.isNewCountry) {
          await supabase.from("security_alerts").insert({
            user_id: data.user.id,
            alert_type: dev.isNew ? "new_device_login" : "new_country_login",
            severity: dev.isNew && dev.isNewCountry ? "high" : "medium",
            description: dev.isNew ? `Login from a new device (${dev.device.browser}/${dev.device.os})` : `Login from a new country (${dev.country})`,
            metadata: { fingerprint: dev.device.fingerprint, country: dev.country } as never,
          });
        }
        await sec.updateRiskScore(data.user.id, { newDevice: dev.isNew, newCountry: dev.isNewCountry });
        sec.startSessionTimer();
      }
    } catch {}
    return { error };
  }

  async function signOut() {
    const uid = user?.id;
    try {
      if (uid) {
        const sec = await import("@/lib/security");
        await sec.endSessionTimer(uid);
        await sec.logSecurityEvent("logout", { userId: uid });
      }
    } catch {}
    await supabase.auth.signOut();
  }

  const staffRole = (STAFF_PRIORITY.find((r) => roles.includes(r)) ?? null) as StaffRole | null;
  const isSuperAdmin = roles.includes("super_admin");
  const isStaff = staffRole !== null;
  const hasPermission = (key: string) => isSuperAdmin || permissions.includes("*") || permissions.includes(key);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        staffRole,
        roles,
        permissions,
        isStaff,
        isSuperAdmin,
        hasPermission,
        loading,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
