import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { BankSpinner } from "@/components/ui/loader";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { getAdmin2FAExpiry } from "@/routes/admin.verify";
import { roleLabel } from "@/lib/permissions";
import {
  LayoutDashboard,
  Wallet,
  MessageCircle,
  Bell,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  Search,
  UserCog,
  KeyRound,
  ScrollText,
  Settings,
  ScanFace,
  Package,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (p: string) => boolean;
  permission?: string;
}

function AdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, isStaff, staffRole, hasPermission, loading, profile, signOut } = useAuth() as any;
  const [openMobile, setOpenMobile] = useState(false);

  const isVerify = pathname === "/admin/verify" || pathname === "/admin/verify/";

  const twofaExpiry = user ? getAdmin2FAExpiry(user.id) : 0;
  const twofaValid = twofaExpiry > Date.now();

  // ⚠️ Tous les hooks doivent être appelés AVANT tout return conditionnel
  const nav: NavItem[] = useMemo(() => {
    const all: NavItem[] = [
      { to: "/admin", label: t("adminDash.overview"), icon: LayoutDashboard, match: (p) => p === "/admin" || p === "/admin/", permission: "dashboard.view" },
      { to: "/admin/applications", label: "Dossiers", icon: Wallet, match: (p) => p.startsWith("/admin/applications"), permission: "applications.view" },
      { to: "/admin/kyc", label: "Conformité KYC", icon: ScanFace, match: (p) => p.startsWith("/admin/kyc"), permission: "kyc.review" },
      { to: "/admin/products", label: "Catalogue", icon: Package, match: (p) => p.startsWith("/admin/products"), permission: "products.manage" },
      { to: "/admin/chat", label: t("adminDash.chat"), icon: MessageCircle, match: (p) => p.startsWith("/admin/chat"), permission: "chat.view" },
      { to: "/admin/notifications", label: t("adminDash.notifications"), icon: Bell, match: (p) => p.startsWith("/admin/notifications"), permission: "notifications.send" },
      { to: "/admin/security", label: t("adminDash.security"), icon: ShieldCheck, match: (p) => p.startsWith("/admin/security"), permission: "security.view" },
      { to: "/admin/staff", label: "Équipe", icon: UserCog, match: (p) => p.startsWith("/admin/staff"), permission: "staff.view" },
      { to: "/admin/roles", label: "Permissions", icon: KeyRound, match: (p) => p.startsWith("/admin/roles"), permission: "roles.manage" },
      { to: "/admin/logs", label: "Journal", icon: ScrollText, match: (p) => p.startsWith("/admin/logs"), permission: "logs.view" },
      { to: "/admin/settings", label: "Paramètres", icon: Settings, match: (p) => p.startsWith("/admin/settings"), permission: "settings.manage" },
    ];
    return all.filter((n) => !n.permission || hasPermission(n.permission));
  }, [t, hasPermission]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (!isStaff && staffRole !== null) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (isStaff && !twofaValid && !isVerify) {
      navigate({ to: "/admin/verify", replace: true });
    }
  }, [loading, user, isStaff, staffRole, navigate, twofaValid, isVerify]);

  if (loading || !user || (!isStaff && staffRole !== null) || (!twofaValid && !isVerify)) {
    return (
      <div className="min-h-screen grid place-items-center bg-muted/20">
        <BankSpinner size={30} />
      </div>
    );
  }

  if (isVerify) {
    return (
      <div className="min-h-screen bg-muted/20">
        <Outlet />
      </div>
    );
  }


  const adminName = profile?.full_name ?? user?.email?.split("@")[0] ?? "Membre";

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-muted/20">
      {/* Colonne de navigation : hauteur fixe, ne défile jamais avec le contenu. */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-card border-r border-border h-full">
        <div className="px-5 py-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-[#00915A] grid place-items-center text-white font-bold">B</div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight">MOONYP</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("adminDash.title")}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          {nav.map((n) => {
            const active = n.match(pathname);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition",
                  active ? "bg-[#00915A] text-white font-semibold shadow-sm" : "text-foreground/80 hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border shrink-0">
          <button
            onClick={async () => { await signOut?.(); navigate({ to: "/auth", replace: true }); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted text-muted-foreground"
          >
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
        </div>
      </aside>

      {openMobile && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-[17rem] max-w-[85vw] bg-card border-r border-border flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <p className="font-bold">Espace équipe</p>
              <button onClick={() => setOpenMobile(false)} aria-label="Fermer"><X className="h-5 w-5" /></button>
            </div>
            <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
              {nav.map((n) => {
                const active = n.match(pathname);
                const Icon = n.icon;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setOpenMobile(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition",
                      active ? "bg-[#00915A] text-white font-semibold" : "hover:bg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4" /> {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="p-3 border-t border-border shrink-0">
              <button
                onClick={async () => { setOpenMobile(false); await signOut?.(); navigate({ to: "/auth", replace: true }); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted text-muted-foreground"
              >
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </div>
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setOpenMobile(false)} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Barre supérieure ancrée : reste en place pendant le défilement. */}
        <header className="shrink-0 z-30 bg-card border-b border-border">
          <div className="flex items-center gap-3 px-4 h-14">
            <button className="lg:hidden" onClick={() => setOpenMobile(true)} aria-label="Menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden md:flex items-center gap-2 flex-1 max-w-md rounded-lg border border-border bg-muted/40 px-3 py-1.5">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input type="text" placeholder={t("chat.admin.searchPlaceholder")} className="bg-transparent text-sm outline-none flex-1" />
            </div>
            <div className="flex-1 md:hidden" />
            <div className="flex items-center gap-2">
              <NotificationBell />
              <div className="h-9 w-9 rounded-full bg-[#00915A] text-white grid place-items-center text-sm font-semibold">
                {adminName.slice(0, 1).toUpperCase()}
              </div>
              <div className="hidden md:block text-xs leading-tight">
                <p className="font-semibold">{adminName}</p>
                <p className="text-muted-foreground">{roleLabel(staffRole)}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Zone de contenu : unique conteneur défilant du back-office. */}
        <main className="flex-1 min-w-0 overflow-y-auto overscroll-contain">
          {/* Gouttière homogène : même respiration sur mobile, tablette et grand écran. */}
          <div className="mx-auto w-full max-w-[1600px] p-3 sm:p-5 lg:p-6 pb-16">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
