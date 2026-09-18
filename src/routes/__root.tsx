import { useEffect } from "react";
import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { Toaster } from "@/components/ui/sonner";
import { AppHeader } from "@/components/AppHeader";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { SiteFooter } from "@/components/SiteFooter";
import { LiveChat } from "@/components/LiveChat";
import { useImmersive } from "@/lib/kyc/immersive";
import "@/i18n";
import i18n, { applyDetectedLanguage, LANG_STORAGE_KEY } from "@/i18n";
import { applyLang, isSupportedLang, normalizeLang } from "@/lib/lang-url";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  const t = (k: string) => i18n.t(k);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">{t("common.notFound")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.notFoundDesc")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

// Inline script to set theme class BEFORE first paint (no FOUC) + sets <html lang> from saved i18n choice
const themeInitScript = `(function(){try{var t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t;var lng=localStorage.getItem('moonyp.lang');if(lng){document.documentElement.lang=lng.split('-')[0];}}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "author", content: "MOONYP" },
      { name: "theme-color", content: "#0a0a0a" },
      // PWA / iOS standalone
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "MOONYP" },
      { name: "application-name", content: "MOONYP" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { name: "referrer", content: "strict-origin-when-cross-origin" },
      // CSP, X-Content-Type-Options et Permissions-Policy sont envoyés en
      // en-têtes HTTP réels depuis `src/start.ts` (les <meta http-equiv>
      // correspondants sont ignorés par les navigateurs pour frame-ancestors).
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
    scripts: [{ children: themeInitScript }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const location = useLocation();
  const pathname = location.pathname;
  const routeLang = normalizeLang(pathname.split("/")[1]);

  // Chemin sans préfixe de langue (/de/secure/... → /secure/...)
  const basePath = routeLang ? pathname.slice(routeLang.length + 1) || "/" : pathname;

  // Vérification d'identité en cours : le parcours occupe tout l'écran, le
  // chrome du site s'efface (aucune distraction, aucun recouvrement caméra).
  const immersive = useImmersive();

  // Staff area and the secure applicant portal render their own chrome.
  // Important : cet indicateur ne dépend QUE de l'URL. Le mode immersif ne doit
  // jamais entrer dans la clé de <main> — sinon activer l'immersif change la
  // clé, React démonte tout le sous-arbre et le parcours KYC repart à zéro.
  const chromelessRoute =
    basePath.startsWith("/admin") ||
    basePath.startsWith("/auth") ||
    basePath.startsWith("/secure") ||
    basePath === "/staff-invite" ||
    basePath === "/reset-password";

  const hideLayout = immersive || chromelessRoute;

  // Détection de langue appliquée après hydratation (SSR déterministe en "en").
  useEffect(() => {
    if (routeLang) {
      document.documentElement.lang = routeLang;
      return;
    }

    // /fr, /de/simulation… redirigent vers /?lang=xx : on applique puis on nettoie l'URL.
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("lang");
      if (q && isSupportedLang(q)) {
        const code = q.toLowerCase().split(/[-_]/)[0]!;
        window.localStorage.setItem(LANG_STORAGE_KEY, code);
        if (i18n.resolvedLanguage !== code) void i18n.changeLanguage(code);
        document.documentElement.lang = code;
        url.searchParams.delete("lang");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
        return;
      }
    } catch {
      /* ignore */
    }
    applyDetectedLanguage();
    requestAnimationFrame(() => {
      document.documentElement.lang = (i18n.resolvedLanguage ?? "en").split("-")[0]!;
    });
  }, [routeLang, pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setOverlaysWebView({ overlay: false });
    void StatusBar.setStyle({ style: Style.Dark });
    void StatusBar.setBackgroundColor({ color: "#000000" });
    void SplashScreen.hide();
    const listener = App.addListener("backButton", ({ canGoBack }: { canGoBack: boolean }) => {
      if (!canGoBack) App.exitApp();
      else window.history.back();
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <div className="flex min-h-screen flex-col">
          {!hideLayout && <AppHeader />}
          {!hideLayout && <div className="h-16 shrink-0" aria-hidden />}
          <main
            key={chromelessRoute ? "app" : pathname}
            className={`flex-1 ${chromelessRoute ? "" : "animate-page"}`}
          >
            <Outlet />
          </main>
          {!hideLayout && <SiteFooter />}
          {!hideLayout && <div className="h-16 md:hidden" aria-hidden />}
          {!hideLayout && <MobileBottomNav />}
        </div>
        {!hideLayout && <LiveChat />}
        <Toaster richColors closeButton />
      </AuthProvider>
    </ThemeProvider>
  );
}
