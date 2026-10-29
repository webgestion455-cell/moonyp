import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LoaderCircle } from "lucide-react";

export const Route = createFileRoute("/auth/callback")({ component: Callback });

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\\\")) return "/admin";
  return value;
}

function Callback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Vérification de votre compte…");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const requestedNext = safeNext(url.searchParams.get("next"));
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const user = data.session?.user;
        if (!user) {
          if (active) navigate({ to: "/auth" });
          return;
        }

        const metadata = user.user_metadata ?? {};
        const companyName = typeof metadata.company_name === "string" ? metadata.company_name.trim() : "";
        if (metadata.account_type === "business" && companyName.length >= 2) {
          const { data: existing, error: membershipError } = await supabase
            .from("organization_members").select("organization_id").eq("user_id", user.id).eq("active", true).limit(1);
          if (membershipError) throw membershipError;
          if (!existing?.length) {
            const base = companyName.normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 44) || "entreprise";
            const slug = `${base}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
            const { error: createError } = await supabase.rpc("create_support_organization", {
              p_name: companyName.slice(0, 120), p_slug: slug, p_default_locale: "fr"
            });
            if (createError) throw createError;
          }
          if (active) navigate({ to: "/workspace" });
          return;
        }
        if (active) navigate({ to: requestedNext as any });
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "La vérification a échoué. Réessayez de vous connecter.");
      }
    })();
    return () => { active = false; };
  }, []);

  return <main className="grid min-h-screen place-items-center p-6"><div className="max-w-md text-center"><LoaderCircle className="mx-auto mb-4 h-8 w-8 animate-spin text-primary"/><p className="text-sm text-muted-foreground">{message}</p><a href="/auth" className="mt-4 inline-block text-sm underline">Retour à la connexion</a></div></main>;
}
