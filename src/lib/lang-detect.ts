import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

const CODES = new Set([
  "en", "fr", "de", "es", "it", "nl", "sl", "bg", "sk", "el", "fi", "ro", "pl", "hr", "hu",
]);

/**
 * Langue déduite de l'en-tête Accept-Language.
 * Le corps serveur (et son import) est retiré du bundle client par TanStack Start.
 */
export const detectAcceptLanguage = createIsomorphicFn()
  .client((): string | null => null)
  .server((): string | null => {
    try {
      const header = getRequestHeader("accept-language") ?? "";
      for (const part of header.split(",")) {
        const code = part.split(";")[0]?.trim().toLowerCase().split(/[-_]/)[0];
        if (code && CODES.has(code)) return code;
      }
    } catch {
      /* pas de contexte requête */
    }
    return null;
  });
