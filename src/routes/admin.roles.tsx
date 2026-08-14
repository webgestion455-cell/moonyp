import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase as _sb } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PERMISSIONS, PERMISSION_MODULES, STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { toast } from "sonner";
import { Loader2, Save, ShieldCheck } from "lucide-react";

const supabase: any = _sb;

export const Route = createFileRoute("/admin/roles")({
  component: AdminRoles,
  head: () => ({ meta: [{ title: "Matrice des permissions — Administration BNP PARIBAS" }] }),
});

type Matrix = Record<StaffRole, Set<string>>;

function emptyMatrix(): Matrix {
  return { super_admin: new Set(), admin: new Set(), agent: new Set() };
}

function AdminRoles() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [matrix, setMatrix] = useState<Matrix>(emptyMatrix());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hasPermission("roles.manage")) {
      toast.error("Permission insuffisante");
      navigate({ to: "/admin", replace: true });
    }
  }, [hasPermission, navigate]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("role_permissions").select("role, permission_key");
      const next = emptyMatrix();
      (data ?? []).forEach((row: { role: StaffRole; permission_key: string }) => {
        if (next[row.role]) next[row.role].add(row.permission_key);
      });
      setMatrix(next);
      setLoading(false);
    })();
  }, []);

  function toggle(role: StaffRole, key: string) {
    setMatrix((prev) => {
      const set = new Set(prev[role]);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, [role]: set };
    });
  }

  async function save() {
    setSaving(true);
    try {
      for (const role of ["super_admin", "admin", "agent"] as StaffRole[]) {
        await supabase.from("role_permissions").delete().eq("role", role);
        const rows = Array.from(matrix[role]).map((permission_key) => ({ role, permission_key }));
        if (rows.length) {
          const { error } = await supabase.from("role_permissions").insert(rows);
          if (error) throw new Error(error.message);
        }
      }
      await logActivity("roles.permissions_updated", { entity: "role_permissions" });
      toast.success("Matrice des permissions enregistrée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="grid h-96 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl sm:text-2xl font-bold tracking-tight">Matrice des permissions</h1>
          <p className="text-sm text-muted-foreground">Définissez précisément ce que chaque rôle peut faire</p>
        </div>
        <Button onClick={save} disabled={saving} className="shrink-0">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Enregistrer
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {STAFF_ROLES.map((r) => (
          <Card key={r.value}>
            <CardContent className="flex items-start gap-3 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#00915A]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.description}</p>
                <p className="mt-1 text-xs font-medium text-[#00915A]">{matrix[r.value].size} permission(s)</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {PERMISSION_MODULES.map((mod) => {
        const perms = PERMISSIONS.filter((p) => p.module === mod);
        if (!perms.length) return null;
        return (
          <Card key={mod}>
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">{mod}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Permission</th>
                      {STAFF_ROLES.map((r) => (
                        <th key={r.value} className="px-4 py-2 text-center font-medium">{r.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {perms.map((p) => (
                      <tr key={p.key} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium">{p.label}</p>
                          <p className="text-xs text-muted-foreground">{p.key}</p>
                        </td>
                        {STAFF_ROLES.map((r) => (
                          <td key={r.value} className="px-4 py-3 text-center">
                            <Checkbox
                              checked={matrix[r.value].has(p.key)}
                              disabled={r.value === "super_admin"}
                              onCheckedChange={() => toggle(r.value, p.key)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Le rôle « Super administrateur » dispose en permanence de l'ensemble des droits et ne peut pas être restreint.
      </p>
    </div>
  );
}
