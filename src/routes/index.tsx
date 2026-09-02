import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveLang } from "@/lib/lang-url";

/** L'accueil canonique vit sous /{langue}/ — on redirige vers la bonne langue. */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    throw redirect({ to: "/$lang", params: { lang: await resolveLang() } });
  },
  component: () => null,
});
