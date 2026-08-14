import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase as _sb } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ACTION_LABELS } from "@/lib/activity-log";
import { Loader2, ScrollText } from "lucide-react";

const supabase: any = _sb;

export const Route = createFileRoute("/admin/logs")({
  component: AdminLogs,
  head: () => ({ meta: [{ title: "Journal d'activité — Administration BNP PARIBAS" }] }),
});

interface LogRow {
  id: string;
  actor_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function AdminLogs() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("activity_logs")
        .select("id, actor_email, action, entity, entity_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      setRows((data ?? []) as LogRow[]);
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter((r) =>
    `${r.actor_email ?? ""} ${r.action} ${r.entity ?? ""} ${r.entity_id ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl sm:text-2xl font-bold tracking-tight">Journal d'activité</h1>
          <p className="text-sm text-muted-foreground">Traçabilité complète des actions de l'équipe</p>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="w-full sm:w-64 shrink-0" />
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4" /> {filtered.length} évènement(s)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucune activité enregistrée</p>
          ) : (
            filtered.map((r) => (
              <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ACTION_LABELS[r.action] ?? r.action}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.actor_email ?? "Système"}{r.entity ? ` · ${r.entity}` : ""}{r.entity_id ? ` #${String(r.entity_id).slice(0, 8)}` : ""}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">{new Date(r.created_at).toLocaleString()}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
