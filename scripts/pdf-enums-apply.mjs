/**
 * Injecte le bloc `enums` (libellés métier des valeurs techniques Supabase)
 * dans les quinze dictionnaires documentaires `src/lib/pdf/i18n/*.json`.
 *
 * Les versions anglaise et française sont écrites à la main ci-dessous ; les
 * treize autres langues sont produites par traduction automatique puis
 * fusionnées sans jamais écraser une valeur déjà traduite.
 *
 *   bun scripts/pdf-enums-apply.mjs            # complète les clés manquantes
 *   bun scripts/pdf-enums-apply.mjs --force    # retraduit tout le bloc enums
 */
import { readFileSync, writeFileSync } from "node:fs";
import { translateMap } from "./lib/translate.mjs";

const DIR = "src/lib/pdf/i18n";
const LANGS = [
  "fr",
  "en",
  "de",
  "es",
  "it",
  "nl",
  "pl",
  "ro",
  "sk",
  "sl",
  "hr",
  "hu",
  "fi",
  "bg",
  "el",
];
const FORCE = process.argv.includes("--force");

const EN = {
  guaranteeKind: {
    credit_risk_cover: "Credit risk coverage",
    personal_guarantee: "Personal guarantee",
    joint_surety: "Joint and several surety",
    bank_guarantee: "Bank guarantee",
    deposit: "Security deposit",
    pledge: "Pledge",
    mortgage: "Mortgage",
    salary_assignment: "Assignment of salary",
    third_party_guarantor: "Third-party guarantor",
    other: "Other guarantee",
  },
  insuranceCoverage: {
    death: "Death",
    disability: "Permanent disability",
    ptia: "Total and irreversible loss of autonomy",
    itt: "Temporary total incapacity for work",
    ipt: "Total permanent invalidity",
    job_loss: "Involuntary loss of employment",
    death_disability: "Death and permanent disability",
    death_disability_job_loss: "Death, permanent disability and loss of employment",
    loan_repayment: "Repayment of the outstanding loan",
    credit_protection: "Credit instalment protection",
    other: "Other coverage",
  },
  status: {
    draft: "Draft",
    pending: "Pending",
    sent: "Sent to the borrower",
    accepted: "Accepted",
    signed: "Signed",
    active: "Active",
    validated: "Validated",
    declined: "Declined",
    cancelled: "Cancelled",
    expired: "Expired",
    waived: "Waived",
    not_required: "Not required",
    completed: "Completed",
  },
  paymentStatus: {
    unpaid: "Not paid",
    not_required: "No fee due",
    pending: "Pending",
    awaiting_payment: "Awaiting payment",
    paid: "Paid and validated",
    waived: "Waived",
    failed: "Payment failed",
    refunded: "Refunded",
  },
  clientChoice: {
    pay_now: "Immediate payment",
    pay_later: "Deferred payment",
    decline: "Financing declined",
  },
  signatureProvider: {
    internal_aes: "MOONYP advanced electronic signature",
    administrative_validation: "Administrative validation by the lender",
    qualified_eidas: "Qualified electronic signature (eIDAS)",
  },
  common: {
    yes: "Yes",
    no: "No",
    none: "None",
    pending_assignment: "Being assigned",
  },
};

const FR = {
  guaranteeKind: {
    credit_risk_cover: "Couverture du risque de crédit",
    personal_guarantee: "Garantie personnelle",
    joint_surety: "Caution solidaire",
    bank_guarantee: "Garantie bancaire",
    deposit: "Dépôt de garantie",
    pledge: "Nantissement",
    mortgage: "Hypothèque",
    salary_assignment: "Cession sur salaire",
    third_party_guarantor: "Garant tiers",
    other: "Autre garantie",
  },
  insuranceCoverage: {
    death: "Décès",
    disability: "Invalidité permanente",
    ptia: "Perte totale et irréversible d'autonomie",
    itt: "Incapacité temporaire totale de travail",
    ipt: "Invalidité permanente totale",
    job_loss: "Perte involontaire d'emploi",
    death_disability: "Décès et invalidité permanente",
    death_disability_job_loss: "Décès, invalidité permanente et perte d'emploi",
    loan_repayment: "Remboursement du capital restant dû",
    credit_protection: "Protection des échéances du crédit",
    other: "Autre garantie",
  },
  status: {
    draft: "Projet",
    pending: "En attente",
    sent: "Transmis à l'emprunteur",
    accepted: "Accepté",
    signed: "Signé",
    active: "En vigueur",
    validated: "Validé",
    declined: "Refusé",
    cancelled: "Annulé",
    expired: "Expiré",
    waived: "Renoncé",
    not_required: "Non requis",
    completed: "Terminé",
  },
  paymentStatus: {
    unpaid: "Non payé",
    not_required: "Aucun frais dû",
    pending: "En attente",
    awaiting_payment: "En attente de paiement",
    paid: "Payé et validé",
    waived: "Renoncé",
    failed: "Paiement en échec",
    refunded: "Remboursé",
  },
  clientChoice: {
    pay_now: "Paiement immédiat",
    pay_later: "Paiement différé",
    decline: "Renonciation au financement",
  },
  signatureProvider: {
    internal_aes: "Signature électronique avancée MOONYP",
    administrative_validation: "Validation administrative du prêteur",
    qualified_eidas: "Signature électronique qualifiée (eIDAS)",
  },
  common: {
    yes: "Oui",
    no: "Non",
    none: "Aucune",
    pending_assignment: "En cours d'attribution",
  },
};

/** Les identifiants ne sont pas traduits : seule la valeur l'est. */
function flatten(block) {
  const out = {};
  for (const [group, entries] of Object.entries(block)) {
    for (const [slug, value] of Object.entries(entries)) out[`${group}.${slug}`] = value;
  }
  return out;
}

function inflate(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const [group, slug] = path.split(".");
    out[group] ??= {};
    out[group][slug] = value;
  }
  return out;
}

const flatEn = flatten(EN);

for (const lang of LANGS) {
  const file = `${DIR}/${lang}.json`;
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  const current = flatten(bundle.enums ?? {});

  let next;
  if (lang === "fr") next = flatten(FR);
  else if (lang === "en") next = flatEn;
  else {
    const todo = {};
    for (const [key, value] of Object.entries(flatEn)) {
      if (FORCE || !current[key]) todo[key] = value;
    }
    const count = Object.keys(todo).length;
    if (count === 0) {
      console.log(`${lang}: à jour`);
      continue;
    }
    console.log(`${lang}: traduction de ${count} libellés…`);
    next = { ...current, ...translateMap(todo, lang, "en") };
  }

  bundle.enums = inflate({ ...current, ...next });
  writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  console.log(`${lang}: ${Object.keys(flatten(bundle.enums)).length} libellés écrits`);
}
