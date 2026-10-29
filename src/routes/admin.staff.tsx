import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/AdminUI";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STAFF_ROLES, roleLabel, type StaffRole } from "@/lib/permissions";
import {
  listStaff,
  inviteStaff,
  updateStaffRole,
  setStaffActive,
  revokeInvitation,
  updateStaffProfile,
} from "@/lib/staff.functions";
import { toast } from "sonner";
import {
  Loader2,
  UserPlus,
  ShieldCheck,
  Copy,
  Ban,
  RotateCcw,
  MailCheck,
  Users,
  Pencil,
} from "lucide-react";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/staff")({
  component: AdminStaff,
  head: () => ({ meta: [{ title: "Équipe & rôles — Administration MOONYP" }] }),
});

const SUPPORT_DEPARTMENTS = [
  { value: "customer_support", label: "Spécialiste du service client" },
  { value: "senior_customer_support", label: "Spécialiste senior du service client" },
  { value: "customer_support_supervisor", label: "Superviseur du service client" },
  { value: "support_manager", label: "Responsable du service client" },
  { value: "relationship_manager", label: "Gestionnaire de clientèle" },
  { value: "account_services", label: "Spécialiste des comptes" },
  { value: "payments_specialist", label: "Spécialiste des paiements" },
  { value: "kyc_aml_specialist", label: "Spécialiste KYC / Lutte anti-blanchiment" },
  { value: "fraud_risk_analyst", label: "Analyste fraude et risques" },
  { value: "compliance_officer", label: "Responsable conformité" },
  { value: "complaints_specialist", label: "Spécialiste des réclamations" },
  { value: "technical_support", label: "Spécialiste du support technique" },
  { value: "security_specialist", label: "Spécialiste sécurité" },
  { value: "operations_specialist", label: "Spécialiste des opérations" },
  { value: "team_lead", label: "Chef d’équipe support" },
] as const;

interface Member {
  user_id: string;
  role: string;
  email: string;
  display_name: string | null;
  job_title: string | null;
  avatar_url?: string | null;
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
  const { session, hasPermission, user, loading: authLoading, role: authRole } = useAuth();
  const navigate = useNavigate();
  const canManage = hasPermission("staff.manage");

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    jobTitle: "",
    role: "agent" as StaffRole,
  });
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState<Member | null>(null);
  const [profileDraft, setProfileDraft] = useState({ display_name: "", job_title: "", avatar_url: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const canViewStaff = hasPermission("staff.view");
  useEffect(() => {
    // Ne pas rediriger pendant que le rôle est encore récupéré depuis Supabase.
    // hasPermission est recréée à chaque rendu : on dépend du booléen stable,
    // pas de la fonction, afin d'éviter les toasts et redirections en boucle.
    if (authLoading || (user && authRole === null)) return;
    if (!canViewStaff) {
      toast.error("Permission insuffisante");
      navigate({ to: "/admin", replace: true });
    }
  }, [authLoading, authRole, user?.id, canViewStaff, navigate]);

  /**
   * `silent` : rechargement de fond (cadence 5 s). Ni état de chargement, ni
   * message d'erreur : l'écran conserve simplement les dernières données.
   */
  async function load(silent = false) {
    const token = session?.access_token;
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const res = await listStaff({ data: { accessToken: token } });
      setMembers((res.members ?? []) as unknown as Member[]);
      setInvitations((res.invitations ?? []) as unknown as Invitation[]);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session?.access_token]);

  /*
   * L'équipe et les invitations reflètent l'état réel sans rechargement.
   * La boucle est suspendue tant qu'une invitation est en cours de saisie.
   */
  useAutoRefresh(() => load(true), { enabled: Boolean(session?.access_token) && !open && !saving });

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

  async function uploadProfilePhoto(file?: File) {
    if (!file || !profileEditing) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) {
      toast.error("Choisissez une image JPG, PNG, WebP ou AVIF.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La photo ne doit pas dépasser 5 Mo.");
      return;
    }
    setAvatarUploading(true);
    try {
      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const path = `${profileEditing.user_id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("support-avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("support-avatars").getPublicUrl(path);
      setProfileDraft(v => ({ ...v, avatar_url: data.publicUrl }));
      toast.success("Photo téléversée. Enregistrez le profil pour confirmer.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Téléversement de la photo impossible.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function saveProfile() {
    if (!profileEditing || !canManage) return;
    if (profileDraft.avatar_url && !/^https:\/\//i.test(profileDraft.avatar_url)) {
      toast.error("L’URL de la photo doit commencer par https://");
      return;
    }
    setProfileSaving(true);
    try {
      const token = session?.access_token;
      if (!token) throw new Error("Session expirée. Reconnectez-vous.");
      await updateStaffProfile({ data: {
        accessToken: token,
        userId: profileEditing.user_id,
        displayName: profileDraft.display_name,
        jobTitle: profileDraft.job_title,
        avatarUrl: profileDraft.avatar_url,
      } });
      toast.success("Profil du membre mis à jour");
      setProfileEditing(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible d’enregistrer ce profil. Vérifiez les permissions.");
    } finally { setProfileSaving(false); }
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
    return members.filter((m) =>
      `${m.email} ${m.display_name ?? ""} ${m.job_title ?? ""}`.toLowerCase().includes(q),
    );
  }, [members, query]);

  const pendingInvites = invitations.filter((i) => !i.accepted_at && !i.revoked_at);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Équipe & rôles"
        subtitle="Administrateurs, agents et invitations en attente."
        actions={
          <>
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
                    <DialogDescription>
                      Un e-mail sécurisé lui permettra de définir son mot de passe.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleInvite} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="inv-email">Adresse e-mail professionnelle</Label>
                      <Input
                        id="inv-email"
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder="prenom.nom@bnpparibas.com"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="inv-name">Nom complet</Label>
                        <Input
                          id="inv-name"
                          value={form.fullName}
                          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="inv-title">Fonction</Label>
                        <Input
                          id="inv-title"
                          value={form.jobTitle}
                          onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                          placeholder="Conseiller crédit"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Rôle</Label>
                      <Select
                        value={form.role}
                        onValueChange={(v) => setForm({ ...form, role: v as StaffRole })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STAFF_ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              <span className="font-medium">{r.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {STAFF_ROLES.find((r) => r.value === form.role)?.description}
                      </p>
                    </div>
                    {fallbackLink && (
                      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs break-all">
                        <p className="mb-2 font-medium">Lien d'activation :</p>
                        {fallbackLink}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => {
                            void navigator.clipboard.writeText(fallbackLink);
                            toast.success("Lien copié");
                          }}
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" /> Copier
                        </Button>
                      </div>
                    )}
                    <DialogFooter>
                      <Button type="submit" disabled={saving}>
                        {saving ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <MailCheck className="mr-2 h-4 w-4" />
                        )}
                        Envoyer l'invitation
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Membres actifs", value: members.filter((m) => m.active).length, icon: Users },
          {
            label: "Administrateurs",
            value: members.filter((m) => m.role !== "agent").length,
            icon: ShieldCheck,
          },
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
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
            className="w-full sm:w-64"
          />
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
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border bg-muted"><img src={m.avatar_url || "/icon-192.png"} alt="" className="h-full w-full object-cover" /></div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {m.display_name ?? m.email.split("@")[0]}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {m.job_title ?? "—"}
                      </TableCell>
                      <TableCell>
                        {canManage && m.user_id !== user?.id ? (
                          <Select
                            value={m.role}
                            onValueChange={(v) => changeRole(m.user_id, v as StaffRole)}
                          >
                            <SelectTrigger className="h-8 w-[190px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STAFF_ROLES.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {m.last_sign_in_at
                          ? new Date(m.last_sign_in_at).toLocaleString()
                          : "Jamais"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                        {canManage && <Button size="sm" variant="outline" onClick={() => { setProfileEditing(m); setProfileDraft({ display_name: m.display_name || "", job_title: m.job_title || "", avatar_url: m.avatar_url || "" }); }}><Pencil className="mr-1.5 h-3.5 w-3.5"/>Profil</Button>}
                        {canManage && m.user_id !== user?.id ? (
                          <Button
                            size="sm"
                            variant={m.active ? "ghost" : "outline"}
                            onClick={() => toggleActive(m.user_id, !m.active)}
                          >
                            {m.active ? (
                              <>
                                <Ban className="mr-1.5 h-3.5 w-3.5" /> Suspendre
                              </>
                            ) : (
                              <>
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Réactiver
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Vous</span>
                        )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        Aucun membre
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(profileEditing)} onOpenChange={(v) => { if (!v) setProfileEditing(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Profil du membre</DialogTitle><DialogDescription>Ces informations sont affichées dans les conversations du support. Sans photo, le logo MOONYP est utilisé par défaut.</DialogDescription></DialogHeader>
          {profileEditing && <div className="space-y-4 py-2">
            <div className="flex items-center gap-3"><img src={profileDraft.avatar_url || "/icon-192.png"} alt="Aperçu du profil" className="h-14 w-14 rounded-lg border object-cover"/><div className="min-w-0 flex-1"><p className="font-medium">{profileEditing.email}</p><p className="text-xs text-muted-foreground">Photo de profil · 5 Mo maximum</p><label className="mt-2 inline-flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={avatarUploading} onChange={e=>{void uploadProfilePhoto(e.currentTarget.files?.[0]);e.currentTarget.value="";}}/>{avatarUploading?"Téléversement…":"Choisir une photo sur l’appareil"}</label></div></div>
            <div className="space-y-1"><Label htmlFor="profile-name">Nom affiché</Label><Input id="profile-name" value={profileDraft.display_name} onChange={e=>setProfileDraft(v=>({...v,display_name:e.target.value}))} placeholder="Anna"/></div>
            <div className="space-y-1"><Label>Département / fonction dans la signature</Label><Select value={profileDraft.job_title || "customer_support"} onValueChange={value=>setProfileDraft(v=>({...v,job_title:value}))}><SelectTrigger><SelectValue placeholder="Choisir un département"/></SelectTrigger><SelectContent>{profileDraft.job_title && !SUPPORT_DEPARTMENTS.some(item=>item.value===profileDraft.job_title) && <SelectItem value={profileDraft.job_title}>{profileDraft.job_title} (fonction personnalisée existante)</SelectItem>}{SUPPORT_DEPARTMENTS.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">La fonction sera automatiquement traduite dans la langue du client dans la signature du support.</p></div>
            <p className="text-xs text-muted-foreground">Sans photo personnelle, le logo MOONYP est utilisé pour l’agent. Les clients affichent une icône de profil neutre.</p>
          </div>}
          <DialogFooter><Button variant="outline" onClick={()=>setProfileEditing(null)}>Annuler</Button><Button onClick={()=>void saveProfile()} disabled={profileSaving}>{profileSaving?"Enregistrement…":"Enregistrer le profil"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invitations en attente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingInvites.map((i) => (
              <div
                key={i.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabel(i.role)} · expire le {new Date(i.expires_at).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={async () => {
                      const token = session?.access_token;
                      if (!token) return;
                      await revokeInvitation({ data: { accessToken: token, invitationId: i.id } });
                      toast.success("Invitation révoquée");
                      void load();
                    }}
                  >
                    Révoquer
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
