import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/$lang/$")({
  beforeLoad: () => {
    throw notFound();
  },
  component: () => null,
});
