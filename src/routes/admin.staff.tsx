import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STAFF_ROLES, roleLabel, type StaffRole } from "@/lib/permissions";
import { listStaff, inviteStaff, updateStaffRole, setStaffActive, revokeInvitation } from "@/lib/staff.functions";
import { toast } from "sonner";
import { Loader2, UserPlus, ShieldCheck, Copy, Ban, RotateCcw, MailCheck, Users } from "lucide-react";

export const Route = createFileRoute("/admin/staff")({
  component: AdminStaff,
  head: () => ({ meta: [{ title: "Équipe & rôles — Administration BNP PARIBAS" }] }),
});

interface Member {
  user_id: string;
  role: string;
  email: string;
  display_name: string | null;
  job_title: string | null;
  active: boolean;
  last_sign_in_at: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function initials(name: string | null, email: string) {
  const src = name?.trim() || email;
  return src.slice(0, 2).toUpperCase();
}

function AdminStaff() {
  const { session, hasPermission, user } = useAuth();
  const navigate = useNavigate();
  const canManage = hasPermission("staff.manage");

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: "", fullName: "", jobTitle: "", role: "agent" as StaffRole });
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission("staff.view")) {
      toast.error("Permission insuffisante");
      navigate({ to: "/admin", replace: true });
    }
  }, [hasPermission, navigate]);

  async function load() {
    const token = session?.access_token;
    if (!token) return;
    setLoading(true);
    try {
      const res = await listStaff({ data: { accessToken: token } });
      setMembers((res.members ?? []) as unknown as Member[]);
      setInvitations((res.invitations ?? []) as unknown as Invitation[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session?.access_token]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const token = session?.access_token;
    if (!token) return;
    setSaving(true);
    setFallbackLink(null);
    try {
      const res = await inviteStaff({
        data: {
          accessToken: token,
          email: form.email,
          role: form.role,
          fullName: form.fullName || undefined,
          jobTitle: form.jobTitle || undefined,
          origin: window.location.origin,
        },
      });
      if (res.emailSent) {
        toast.success("Invitation envoyée par e-mail");
        setOpen(false);
      } else {
        setFallbackLink(res.link ?? null);
        toast.warning("E-mail non configuré — copiez le lien d'invitation");
      }
      setForm({ email: "", fullName: "", jobTitle: "", role: "agent" });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invitation impossible");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(userId: string, role: StaffRole) {
    const token = session?.access_token;
    if (!token) return;
    try {
      await updateStaffRole({ data: { accessToken: token, userId, role } });
      toast.success("Rôle mis à jour");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Modification impossible");
    }
  }

  async function toggleActive(userId: string, active: boolean) {
    const token = session?.access_token;
    if (!token) return;
    try {
      await setStaffActive({ data: { accessToken: token, userId, active } });
      toast.success(active ? "Accès réactivé" : "Accès suspendu");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => `${m.email} ${m.display_name ?? ""} ${m.job_title ?? ""}`.toLowerCase().includes(q));
  }, [members, query]);

  const pendingInvites = invitations.filter((i) => !i.accepted_at && !i.revoked_at);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl sm:text-2xl font-bold tracking-tight">Équipe & rôles</h1>
          <p className="text-sm text-muted-foreground">Administrateurs, agents et invitations en attente</p>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="shrink-0">
                <UserPlus className="mr-2 h-4 w-4" /> Inviter un membre
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Inviter un membre de l'équipe</DialogTitle>
                <DialogDescription>Un e-mail sécurisé lui permettra de définir son mot de passe.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="inv-email">Adresse e-mail professionnelle</Label>
                  <Input id="inv-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="prenom.nom@bnpparibas.com" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="inv-name">Nom complet</Label>
                    <Input id="inv-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-title">Fonction</Label>
                    <Input id="inv-title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="Conseiller crédit" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Rôle</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as StaffRole })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAFF_ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <span className="font-medium">{r.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{STAFF_ROLES.find((r) => r.value === form.role)?.description}</p>
                </div>
                {fallbackLink && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs break-all">
                    <p className="mb-2 font-medium">Lien d'activation :</p>
                    {fallbackLink}
                    <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => { void navigator.clipboard.writeText(fallbackLink); toast.success("Lien copié"); }}>
                      <Copy className="mr-2 h-3.5 w-3.5" /> Copier
                    </Button>
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailCheck className="mr-2 h-4 w-4" />}
                    Envoyer l'invitation
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Membres actifs", value: members.filter((m) => m.active).length, icon: Users },
          { label: "Administrateurs", value: members.filter((m) => m.role !== "agent").length, icon: ShieldCheck },
          { label: "Invitations en attente", value: pendingInvites.length, icon: MailCheck },
        ].map((kpi) => (
          <Card key={kpi.label} className="border-t-4 border-t-[#00915A]">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
              <kpi.icon className="h-6 w-6 text-[#00915A]" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
          <CardTitle className="text-base">Membres de l'équipe</CardTitle>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…" className="w-full sm:w-64" />
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-40 place-items-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Membre</TableHead>
                    <TableHead className="hidden md:table-cell">Fonction</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead className="hidden lg:table-cell">Dernière connexion</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#00915A] text-xs font-semibold text-white">
                            {initials(m.display_name, m.email)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{m.display_name ?? m.email.split("@")[0]}</p>
                            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{m.job_title ?? "—"}</TableCell>
                      <TableCell>
                        {canManage && m.user_id !== user?.id ? (
                          <Select value={m.role} onValueChange={(v) => changeRole(m.user_id, v as StaffRole)}>
                            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {STAFF_ROLES.map((r) => (
                                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleString() : "Jamais"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && m.user_id !== user?.id ? (
                          <Button size="sm" variant={m.active ? "ghost" : "outline"} onClick={() => toggleActive(m.user_id, !m.active)}>
                            {m.active ? <><Ban className="mr-1.5 h-3.5 w-3.5" /> Suspendre</> : <><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Réactiver</>}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Vous</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Aucun membre</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Invitations en attente</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pendingInvites.map((i) => (
              <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabel(i.role)} · expire le {new Date(i.expires_at).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                    const token = session?.access_token;
                    if (!token) return;
                    await revokeInvitation({ data: { accessToken: token, invitationId: i.id } });
                    toast.success("Invitation révoquée");
                    void load();
                  }}>Révoquer</Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
