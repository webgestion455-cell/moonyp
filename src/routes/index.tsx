import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveLang } from "@/lib/lang-url";

/** L'accueil canonique vit sous /{langue}/ — on redirige vers la bonne langue. */
export const Route = createFileRoute("/")({
  beforeLoad: async ({ location }) => {
    // Preserve query strings (e.g. notification deep links) during language redirect.
    throw redirect({ href: `/${await resolveLang()}${location.searchStr}` });
  },
  component: () => null,
});
