// Catalogue de permissions — miroir client de public.permissions
// (voir supabase/sql/09_storage_and_seed.sql : les clés doivent rester identiques).
export type StaffRole = "super_admin" | "admin" | "agent";

export const STAFF_ROLES: { value: StaffRole; label: string; description: string }[] = [
  { value: "super_admin", label: "Super administrateur", description: "Accès total, gestion de l'équipe et des permissions" },
  { value: "admin", label: "Administrateur", description: "Gestion opérationnelle complète (dossiers, contrats, paiements)" },
  { value: "agent", label: "Agent / Conseiller", description: "Instruction des dossiers et relation client" },
];

export const PERMISSION_MODULES = [
  "Pilotage",
  "Dossiers",
  "Conformité",
  "Contrats",
  "Financement",
  "Catalogue",
  "Assistance",
  "Sécurité",
  "Équipe",
  "Paramètres",
] as const;

export const PERMISSIONS: { key: string; module: string; label: string }[] = [
  { key: "dashboard.view", module: "Pilotage", label: "Voir le tableau de bord" },

  { key: "applications.view", module: "Dossiers", label: "Consulter les dossiers" },
  { key: "applications.review", module: "Dossiers", label: "Instruire les dossiers" },
  { key: "applications.decide", module: "Dossiers", label: "Décider (accord / refus / offre)" },

  { key: "documents.review", module: "Conformité", label: "Valider les pièces justificatives" },
  { key: "kyc.review", module: "Conformité", label: "Valider les contrôles KYC" },

  { key: "contracts.manage", module: "Contrats", label: "Gérer les contrats et signatures" },
  { key: "guarantees.manage", module: "Contrats", label: "Gérer les garanties" },
  { key: "insurances.manage", module: "Contrats", label: "Gérer les assurances" },

  { key: "payments.manage", module: "Financement", label: "Gérer les paiements" },
  { key: "disbursements.manage", module: "Financement", label: "Gérer les décaissements" },
  { key: "repayments.manage", module: "Financement", label: "Gérer les remboursements" },

  { key: "products.manage", module: "Catalogue", label: "Gérer les produits et documents" },

  { key: "chat.view", module: "Assistance", label: "Accéder à la messagerie" },
  { key: "chat.reply", module: "Assistance", label: "Répondre aux clients" },
  { key: "notifications.send", module: "Assistance", label: "Envoyer des notifications" },

  { key: "security.view", module: "Sécurité", label: "Consulter les alertes de sécurité" },
  { key: "logs.view", module: "Sécurité", label: "Consulter le journal d'activité" },

  { key: "staff.view", module: "Équipe", label: "Voir les membres de l'équipe" },
  { key: "staff.manage", module: "Équipe", label: "Inviter / révoquer un membre" },
  { key: "roles.manage", module: "Équipe", label: "Modifier la matrice des permissions" },

  { key: "settings.manage", module: "Paramètres", label: "Configurer les paramètres et moyens de paiement" },
];

export function roleLabel(role: string | null | undefined) {
  return STAFF_ROLES.find((r) => r.value === role)?.label ?? "Membre";
}
