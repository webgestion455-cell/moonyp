import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ScanFace, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CenterLoader } from "@/components/ui/loader";
import { adminKycQueue } from "@/lib/admin-catalog.functions";
import { adminReviewKycCheck } from "@/lib/admin-applications.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/kyc")({
  component: AdminKycQueue,
});

type Row = Awaited<ReturnType<typeof adminKycQueue>>[number];

const FILTERS = ["verifying", "failed", "passed", "all"] as const;

function AdminKycQueue() {
  const list = useServerFn(adminKycQueue);
  const review = useServerFn(adminReviewKycCheck);

  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("verifying");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await list({ data: { status: filter, limit: 100 } }));
    } finally {
      setLoading(false);
    }
  }, [list, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, status: "passed" | "failed") => {
    setBusy(id);
    try {
      await review({ data: { id, status } });
      toast.success(status === "passed" ? "Contrôle validé" : "Contrôle rejeté");
      await load();
    } catch {
      toast.error("Action impossible");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Conformité — KYC</h1>
          <p className="text-sm text-muted-foreground">File d'attente des contrôles d'identité à revoir.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
              )}
            >
              {f === "verifying" ? "À vérifier" : f === "failed" ? "Rejetés" : f === "passed" ? "Validés" : "Tous"}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <CenterLoader />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center gap-2 py-16 text-center">
            <ScanFace className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Aucun contrôle dans cette file.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {r.application?.reference ?? "—"} ·{" "}
                      {[r.application?.first_name, r.application?.last_name].filter(Boolean).join(" ") ||
                        r.application?.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.category} · {r.document_type_slug ?? r.step_key} ·{" "}
                      {new Date(r.created_at).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {r.application && (
                      <Button asChild variant="outline" size="sm" className="rounded-full">
                        <Link to="/admin/applications/$applicationId" params={{ applicationId: r.application_id }}>
                          Dossier
                        </Link>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={busy === r.id}
                      onClick={() => void decide(r.id, "failed")}
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden />
                      Rejeter
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full"
                      disabled={busy === r.id}
                      onClick={() => void decide(r.id, "passed")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Valider
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
