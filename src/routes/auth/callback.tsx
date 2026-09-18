import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  component: Callback,
});

function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    const handle = async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        navigate({ to: "/admin" });
      } else {
        navigate({ to: "/auth" });
      }
    };

    handle();
  }, []);

  return (
    <div className="flex h-screen items-center justify-center">
      <p>Connexion en cours...</p>
    </div>
  );
}
