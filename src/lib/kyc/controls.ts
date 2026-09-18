/**
 * Taxonomie des contrôles KYC — moteur interne Moonyp.
 *
 * Ce module est pur (aucune E/S) et partagé entre le serveur, l'admin et
 * les tests. Il fixe :
 *   - les cinq étapes séquentielles du parcours ;
 *   - la liste fermée des contrôles, leur étape et leur caractère
 *     obligatoire ;
 *   - les statuts explicites d'un contrôle et d'une étape ;
 *   - l'agrégation d'un dossier, qui n'est JAMAIS une décision de crédit.
 *
 * Règles non négociables :
 *   - un contrôle non exécuté ne porte jamais le statut PASS ;
 *   - un contrôle qu'aucune bibliothèque locale ne sait garantir reste
 *     NOT_VERIFIED, avec la raison exacte ;
 *   - une étape n'est PASS que si tous ses contrôles obligatoires sont PASS ;
 *   - l'état agrégé décrit la preuve KYC disponible, pas l'issue du crédit.
 */

export const KYC_ENGINE_VERSION = "moonyp-kyc/2.0.0";

/** Nombre de tentatives par étape avant signalement fraude/abus. */
export const STEP_ATTEMPT_LIMIT = 3;

export type ControlStatus =
  | "PASS"
  | "FAIL"
  | "REVIEW_REQUIRED"
  | "INCONCLUSIVE"
  | "NOT_VERIFIED"
  | "NOT_STARTED";

export type StepStatus = "NOT_STARTED" | "PASS" | "FAIL" | "REVIEW_REQUIRED" | "INCONCLUSIVE";

export type StepKey = "identity" | "address" | "liveness" | "iban" | "income";

/** Ordre imposé du parcours : identité → domicile → vivacité → IBAN → revenus. */
export const STEP_ORDER: readonly StepKey[] = ["identity", "address", "liveness", "iban", "income"];

/** Catégorie du catalogue `document_types` alimentant chaque étape. */
export const STEP_DOCUMENT_CATEGORY: Record<StepKey, "identity" | "address" | "selfie" | "bank" | "income"> = {
  identity: "identity",
  address: "address",
  liveness: "selfie",
  iban: "bank",
  income: "income",
};

export type ControlKey =
  // Identité
  | "document_capture_quality"
  | "document_readability"
  | "mrz_integrity"
  | "identity_data_match"
  | "document_expiry"
  | "document_authenticity"
  | "id_portrait_extraction"
  | "sanctions_screening"
  | "pep_screening"
  | "fraud_signals"
  // Domicile
  | "address_document_readability"
  | "address_document_nature"
  | "address_match"
  | "address_document_recency"
  // Vivacité
  | "liveness_challenges"
  | "liveness_server_validation"
  | "anti_spoofing"
  | "face_match"
  // IBAN
  | "iban_format"
  | "iban_document_readability"
  | "iban_document_match"
  | "iban_holder_match"
  // Revenus
  | "income_document_readability"
  | "income_document_nature"
  | "income_amount_consistency"
  | "income_document_recency";

export interface ControlDefinition {
  key: ControlKey;
  step: StepKey;
  /** Obligatoire pour qu'une étape soit PASS. */
  required: boolean;
  /**
   * Vrai quand aucune bibliothèque locale ne permet d'exécuter réellement le
   * contrôle : il est alors toujours NOT_VERIFIED, jamais PASS. Le motif
   * exact est porté par `unverifiableReason`.
   */
  unverifiable?: boolean;
  unverifiableReason?: string;
}

export const CONTROL_DEFINITIONS: readonly ControlDefinition[] = [
  { key: "document_capture_quality", step: "identity", required: true },
  { key: "document_readability", step: "identity", required: true },
  { key: "mrz_integrity", step: "identity", required: true },
  { key: "identity_data_match", step: "identity", required: true },
  { key: "document_expiry", step: "identity", required: true },
  {
    key: "document_authenticity",
    step: "identity",
    required: false,
    unverifiable: true,
    unverifiableReason:
      "no_local_security_feature_library: aucune bibliothèque self-hosted ne vérifie hologrammes, encres optiques, puce NFC ou motifs de sécurité ; seule la cohérence MRZ est contrôlée",
  },
  { key: "id_portrait_extraction", step: "identity", required: true },
  { key: "sanctions_screening", step: "identity", required: false },
  { key: "pep_screening", step: "identity", required: false },
  { key: "fraud_signals", step: "identity", required: true },

  { key: "address_document_readability", step: "address", required: true },
  { key: "address_document_nature", step: "address", required: true },
  { key: "address_match", step: "address", required: true },
  { key: "address_document_recency", step: "address", required: true },

  { key: "liveness_challenges", step: "liveness", required: true },
  { key: "liveness_server_validation", step: "liveness", required: true },
  { key: "anti_spoofing", step: "liveness", required: true },
  { key: "face_match", step: "liveness", required: true },

  { key: "iban_format", step: "iban", required: true },
  { key: "iban_document_readability", step: "iban", required: true },
  { key: "iban_document_match", step: "iban", required: true },
  { key: "iban_holder_match", step: "iban", required: true },

  { key: "income_document_readability", step: "income", required: true },
  { key: "income_document_nature", step: "income", required: true },
  { key: "income_amount_consistency", step: "income", required: true },
  { key: "income_document_recency", step: "income", required: true },
];

export const CONTROL_BY_KEY: Record<ControlKey, ControlDefinition> = Object.fromEntries(
  CONTROL_DEFINITIONS.map((c) => [c.key, c]),
) as Record<ControlKey, ControlDefinition>;

export function controlsForStep(step: StepKey): ControlDefinition[] {
  return CONTROL_DEFINITIONS.filter((c) => c.step === step);
}

export const REQUIRED_CONTROLS: readonly ControlKey[] = CONTROL_DEFINITIONS.filter((c) => c.required).map(
  (c) => c.key,
);

/** Résultat d'un contrôle tel qu'il est persisté (une ligne par contrôle). */
export interface ControlResult {
  control: ControlKey;
  status: ControlStatus;
  /** Vrai uniquement si le code du contrôle a réellement tourné sur des données. */
  executed: boolean;
  method: string;
  library?: string;
  library_version?: string;
  score?: number;
  threshold?: number;
  reasons: string[];
  /** Détails non sensibles : métriques, compteurs, versions, références. */
  details?: Record<string, unknown>;
  duration_ms?: number;
  document_id?: string | null;
}

/** Contrôle non exécuté : jamais PASS, motif obligatoire. */
export function notExecuted(
  control: ControlKey,
  reason: string,
  status: Extract<ControlStatus, "NOT_VERIFIED" | "NOT_STARTED" | "INCONCLUSIVE"> = "NOT_VERIFIED",
  details?: Record<string, unknown>,
): ControlResult {
  return { control, status, executed: false, method: "not_executed", reasons: [reason], details };
}

/** Contrôle déclaré non vérifiable par construction (voir CONTROL_DEFINITIONS). */
export function unverifiable(control: ControlKey): ControlResult {
  const def = CONTROL_BY_KEY[control];
  return notExecuted(control, def.unverifiableReason ?? "unverifiable_by_design");
}

/**
 * Garde-fou : un résultat PASS doit provenir d'un contrôle réellement
 * exécuté. Toute tentative contraire est dégradée en INCONCLUSIVE avec motif,
 * pour qu'aucun chemin de code ne puisse afficher « vérifié » à tort.
 */
export function sanitizeResult(result: ControlResult): ControlResult {
  if (result.status === "PASS" && !result.executed) {
    return {
      ...result,
      status: "INCONCLUSIVE",
      reasons: [...result.reasons, "pass_without_execution_rejected"],
    };
  }
  const def = CONTROL_BY_KEY[result.control];
  if (def?.unverifiable && result.status === "PASS") {
    return {
      ...result,
      status: "NOT_VERIFIED",
      executed: false,
      reasons: [...result.reasons, def.unverifiableReason ?? "unverifiable_by_design"],
    };
  }
  return result;
}

/**
 * Statut d'une étape à partir de ses contrôles.
 *
 * Priorité : FAIL > REVIEW_REQUIRED > INCONCLUSIVE > PASS.
 * Un contrôle obligatoire NOT_STARTED / NOT_VERIFIED rend l'étape
 * INCONCLUSIVE (la preuve manque). Un contrôle facultatif NOT_VERIFIED
 * (ex. authenticité) ne bloque pas l'étape mais reste visible tel quel.
 */
export function stepStatus(step: StepKey, results: readonly ControlResult[]): { status: StepStatus; reasons: string[] } {
  const defs = controlsForStep(step);
  const byKey = new Map(results.map((r) => [r.control, sanitizeResult(r)]));
  const reasons: string[] = [];

  if (results.length === 0) return { status: "NOT_STARTED", reasons: ["no_control_recorded"] };

  let fail = false;
  let review = false;
  let inconclusive = false;

  for (const def of defs) {
    const r = byKey.get(def.key);
    if (!r) {
      if (def.required) {
        inconclusive = true;
        reasons.push(`${def.key}:missing`);
      }
      continue;
    }
    for (const reason of r.reasons) reasons.push(`${def.key}:${reason}`);
    switch (r.status) {
      case "FAIL":
        fail = true;
        break;
      case "REVIEW_REQUIRED":
        review = true;
        break;
      case "INCONCLUSIVE":
        if (def.required) inconclusive = true;
        break;
      case "NOT_VERIFIED":
      case "NOT_STARTED":
        if (def.required) inconclusive = true;
        break;
      case "PASS":
        break;
    }
  }

  if (fail) return { status: "FAIL", reasons };
  if (review) return { status: "REVIEW_REQUIRED", reasons };
  if (inconclusive) return { status: "INCONCLUSIVE", reasons };
  return { status: "PASS", reasons };
}

/**
 * État KYC agrégé d'un dossier.
 *
 * Ce n'est PAS une décision de crédit : `kyc_ready_for_review` signifie
 * uniquement que toutes les étapes ont été enregistrées et que les contrôles
 * exécutés n'ont rien relevé. L'accord ou le refus du prêt reste un acte
 * humain distinct, tracé ailleurs (application status / decisions).
 */
export type KycAggregateState =
  | "kyc_not_started"
  | "kyc_in_progress"
  | "kyc_ready_for_review"
  | "kyc_review_required"
  | "kyc_insufficient_evidence"
  | "kyc_rejected_evidence";

export interface AggregateInput {
  /** Dernier statut connu de chaque étape requise par le plan du dossier. */
  steps: Partial<Record<StepKey, StepStatus>>;
  /** Étapes exigées par le plan documentaire (produit/pays/situation). */
  requiredSteps: readonly StepKey[];
}

export function aggregateKyc(input: AggregateInput): { state: KycAggregateState; reasons: string[] } {
  const reasons: string[] = [];
  const statuses = input.requiredSteps.map((s) => ({ step: s, status: input.steps[s] ?? "NOT_STARTED" }));

  if (statuses.length === 0) return { state: "kyc_not_started", reasons: ["no_step_required"] };
  if (statuses.every((s) => s.status === "NOT_STARTED")) return { state: "kyc_not_started", reasons: [] };

  const missing = statuses.filter((s) => s.status === "NOT_STARTED");
  if (missing.length > 0) {
    for (const m of missing) reasons.push(`${m.step}:not_started`);
    return { state: "kyc_in_progress", reasons };
  }

  if (statuses.some((s) => s.status === "FAIL")) {
    for (const s of statuses.filter((x) => x.status === "FAIL")) reasons.push(`${s.step}:fail`);
    return { state: "kyc_rejected_evidence", reasons };
  }
  if (statuses.some((s) => s.status === "REVIEW_REQUIRED")) {
    for (const s of statuses.filter((x) => x.status === "REVIEW_REQUIRED")) reasons.push(`${s.step}:review_required`);
    return { state: "kyc_review_required", reasons };
  }
  if (statuses.some((s) => s.status === "INCONCLUSIVE")) {
    for (const s of statuses.filter((x) => x.status === "INCONCLUSIVE")) reasons.push(`${s.step}:inconclusive`);
    return { state: "kyc_insufficient_evidence", reasons };
  }
  return { state: "kyc_ready_for_review", reasons };
}

/**
 * Étape suivante autorisée : la première non encore PASS/REVIEW/INCONCLUSIVE
 * dans l'ordre imposé. Une étape FAIL doit être refaite avant d'avancer.
 */
export function nextStep(
  steps: Partial<Record<StepKey, StepStatus>>,
  requiredSteps: readonly StepKey[],
): StepKey | null {
  for (const key of STEP_ORDER) {
    if (!requiredSteps.includes(key)) continue;
    const s = steps[key] ?? "NOT_STARTED";
    if (s === "NOT_STARTED" || s === "FAIL") return key;
  }
  return null;
}

export function canSubmitStep(
  step: StepKey,
  steps: Partial<Record<StepKey, StepStatus>>,
  requiredSteps: readonly StepKey[],
): { allowed: boolean; reason?: string } {
  if (!requiredSteps.includes(step)) return { allowed: false, reason: "step_not_in_plan" };
  for (const key of STEP_ORDER) {
    if (key === step) return { allowed: true };
    if (!requiredSteps.includes(key)) continue;
    const s = steps[key] ?? "NOT_STARTED";
    if (s === "NOT_STARTED" || s === "FAIL") return { allowed: false, reason: `previous_step_incomplete:${key}` };
  }
  return { allowed: true };
}

/** Statuts machine ↔ colonne historique application_kyc_checks.status. */
export function legacyCheckStatus(status: StepStatus | ControlStatus): "verifying" | "passed" | "failed" | "manual_review" {
  switch (status) {
    case "PASS":
      return "passed";
    case "FAIL":
      return "failed";
    case "REVIEW_REQUIRED":
      return "manual_review";
    default:
      return "verifying";
  }
}
