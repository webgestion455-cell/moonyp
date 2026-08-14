import { useEffect } from "react";
import { Outlet, Link, createRootRoute, HeadContent, Scripts, useLocation } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { Toaster } from "@/components/ui/sonner";
import { AppHeader } from "@/components/AppHeader";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { LiveChat } from "@/components/LiveChat";
import "@/i18n";
import i18n from "@/i18n";

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
const themeInitScript = `(function(){try{var k='lendly-theme';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t;var lng=localStorage.getItem('moonyp.lang');if(lng){document.documentElement.lang=lng.split('-')[0];}}catch(e){}})();`;

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
      {
        httpEquiv: "Content-Security-Policy",
        content:
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' data: https://fonts.gstatic.com; " +
          "img-src 'self' data: blob: https:; " +
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://ipapi.co https://nominatim.openstreetmap.org; " +
          "frame-ancestors 'self'; " +
          "base-uri 'self'; " +
          "form-action 'self';",
      },
      { httpEquiv: "X-Content-Type-Options", content: "nosniff" },
      { httpEquiv: "Permissions-Policy", content: "geolocation=(), microphone=(), camera=(self)" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Inter:wght@400;500;600;700;800&display=swap" },
    ],
    scripts: [{ children: themeInitScript }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const location = useLocation();
  const pathname = location.pathname;

  // Staff area and the secure applicant portal render their own chrome.
  const hideLayout =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/secure") ||
    pathname === "/staff-invite" ||
    pathname === "/reset-password";

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
          <main className="flex-1">
            <Outlet />
          </main>
          {!hideLayout && <div className="h-16 md:hidden" aria-hidden />}
          {!hideLayout && <MobileBottomNav />}
        </div>
        {!hideLayout && <LiveChat />}
        <Toaster richColors closeButton />
      </AuthProvider>
    </ThemeProvider>
  );
}
