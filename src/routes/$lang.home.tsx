/**
 * Alias « /{lang}/home » de la page d'accueil.
 *
 * La barre de navigation mobile pointe vers cette adresse : elle doit servir
 * EXACTEMENT la page d'accueil (`/{lang}`) et non une page technique. On
 * redirige donc côté serveur comme côté client, ce qui garantit une seule URL
 * canonique pour l'accueil (bon pour le SEO) tout en gardant le lien mobile.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$lang/home")({
  beforeLoad: ({ params, location }) => {
    throw redirect({ href: `/${params.lang}${location.searchStr}`, replace: true });
  },
  component: () => null,
});
