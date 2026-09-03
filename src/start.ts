import { createStart, createMiddleware } from "@tanstack/react-start";
import { setResponseHeaders } from "@tanstack/react-start/server";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

/**
 * En-têtes de sécurité réels (HTTP).
 * `frame-ancestors`, `X-Frame-Options` et `Permissions-Policy` sont ignorés
 * lorsqu'ils sont déclarés via <meta http-equiv> : ils doivent être envoyés
 * par le serveur. Les origines Lovable restent autorisées pour la prévisualisation.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://flagcdn.com https://*.supabase.co https://tile.openstreetmap.org",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://photon.komoot.io https://nominatim.openstreetmap.org https://api.bigdatacloud.net https://flagcdn.com https://ipapi.co",
  "frame-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'self' https://*.lovable.app https://*.lovable.dev https://lovable.dev https://*.lovableproject.com",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = createMiddleware({ type: "request" }).server(async ({ next }) => {
  setResponseHeaders({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self), microphone=(), camera=(self), payment=()",
  });
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders],
  // Indispensable : attache le jeton Supabase aux appels de server functions
  // protégés par `requireSupabaseAuth` (sans lui, tout l'admin renvoie 401/500).
  functionMiddleware: [attachSupabaseAuth],
}));
