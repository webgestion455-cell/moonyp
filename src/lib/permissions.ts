// Catalogue de permissions — miroir client de public.permissions
export type StaffRole = "super_admin" | "admin" | "agent";

export const STAFF_ROLES: { value: StaffRole; label: string; description: string }[] = [
  { value: "super_admin", label: "Super administrateur", description: "Accès total, gestion de l'équipe et des permissions" },
  { value: "admin", label: "Administrateur", description: "Gestion opérationnelle complète (crédits, virements, clients)" },
  { value: "agent", label: "Agent / Conseiller", description: "Assistance clients et consultation des dossiers" },
];

export const PERMISSION_MODULES = [
  "Pilotage",
  "Clients",
  "Crédits",
  "Virements",
  "Facturation",
  "Assistance",
  "Sécurité",
  "Équipe",
  "Paramètres",
] as const;

export const PERMISSIONS: { key: string; module: string; label: string }[] = [
  { key: "dashboard.view", module: "Pilotage", label: "Voir le tableau de bord" },
  { key: "clients.view", module: "Clients", label: "Consulter les clients" },
  { key: "clients.manage", module: "Clients", label: "Modifier / bloquer un client" },
  { key: "loans.view", module: "Crédits", label: "Consulter les demandes de prêt" },
  { key: "loans.decide", module: "Crédits", label: "Accepter / refuser / envoyer un contrat" },
  { key: "transfers.view", module: "Virements", label: "Consulter les virements" },
  { key: "transfers.execute", module: "Virements", label: "Exécuter / rejeter un virement" },
  { key: "invoices.view", module: "Facturation", label: "Consulter les factures et justificatifs" },
  { key: "chat.view", module: "Assistance", label: "Accéder à la messagerie" },
  { key: "chat.reply", module: "Assistance", label: "Répondre aux clients" },
  { key: "notifications.send", module: "Assistance", label: "Envoyer des notifications" },
  { key: "security.view", module: "Sécurité", label: "Consulter les alertes de sécurité" },
  { key: "logs.view", module: "Sécurité", label: "Consulter le journal d'activité" },
  { key: "staff.view", module: "Équipe", label: "Voir les membres de l'équipe" },
  { key: "staff.manage", module: "Équipe", label: "Inviter / révoquer un membre" },
  { key: "roles.manage", module: "Équipe", label: "Modifier la matrice des permissions" },
  { key: "settings.manage", module: "Paramètres", label: "Configurer les moyens de paiement" },
];

export function roleLabel(role: string | null | undefined) {
  return STAFF_ROLES.find((r) => r.value === role)?.label ?? "Membre";
}
