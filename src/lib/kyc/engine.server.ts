/**
 * Moteur de contrôles KYC — exécution réelle, sans fournisseur externe.
 *
 * Ce module ne fait AUCUNE E/S : il reçoit des entrées déjà collectées
 * (octets analysés, texte extrait, preuves de capture, listes de sanctions,
 * résultats du moteur facial) et produit une ligne `ControlResult` par
 * contrôle de la taxonomie.
 *
 * Règles appliquées sans exception :
 *   - un contrôle qui n'a pas tourné sort NOT_VERIFIED / INCONCLUSIVE, jamais PASS ;
 *   - `document_authenticity` est NOT_VERIFIED par construction ;
 *   - `face_match` n'est jamais déduit de la vivacité, ni l'inverse ;
 *   - un texte produit par le navigateur (OCR image) ne peut pas porter un
 *     PASS : il plafonne à REVIEW_REQUIRED, car le serveur ne l'a pas mesuré ;
 *   - aucun résultat n'est une décision de crédit.
 */

import {
  CONTROL_BY_KEY,
  KYC_ENGINE_VERSION,
  type ControlKey,
  type ControlResult,
  type ControlStatus,
  type StepKey,
  notExecuted,
  sanitizeResult,
  unverifiable,
} from "./controls";
import { verifyCaptureEvidence } from "./evidence.server";
import { crossCheckIdentity } from "./identity-match";
import { mrzExpired, parseMrz, type MrzData } from "./mrz";
import { assessRisk, type RiskFacts } from "./fraud";
import { screenCandidate, type ScreeningEntry, type ScreeningResult } from "./sanctions";
import { normaliseIban, validateIban } from "@/lib/iban";
import type { SniffResult } from "./file-sniff";
import type { ExtractedText } from "./text-source.server";
import {
  ACCEPTED_NATURES,
  classifyDocument,
  closestAmount,
  documentReferenceDate,
  extractAmounts,
  extractIbans,
  matchAddress,
  matchName,
  monthsBetween,
  textQuality,
} from "./text-extract";

/* --------------------------------------------------------------------- */
/* Entrées                                                                */
/* --------------------------------------------------------------------- */

export interface AnalysedFile {
  /** Slug du type de document du catalogue (`document_types.slug`). */
  slug: string;
  storage_path: string;
  file_name: string;
  declared_mime: string;
  declared_size: number;
  sha256: string;
  sniff: SniffResult;
  text: ExtractedText;
  /** Preuve de capture mesurée par le navigateur (revalidée ici). */
  capture_evidence: unknown;
  document_id?: string | null;
}

export interface SubjectData {
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  nationality: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  iban: string | null;
  /** Revenu mensuel net déclaré, utilisé pour la cohérence des justificatifs. */
  monthly_income: number | null;
}

/** Résultat du moteur facial auto-hébergé (`face-engine.node.ts`). */
export interface FacePortraitResult {
  faces: number;
  quality: { width: number; area_ratio: number; detection_score: number; sharpness: number; brightness: number };
  usable: boolean;
  reasons: string[];
  engine: string;
  engine_version: string;
  computed_at: string;
}

export interface FaceMatchResult {
  status: "PASS" | "FAIL" | "INCONCLUSIVE";
  distance: number | null;
  threshold: number;
  reasons: string[];
  engine: string;
  engine_version: string;
  computed_at: string;
}

export interface ScreeningInput {
  /** Entrées réellement importées en base ; jamais de liste fabriquée. */
  entries: ScreeningEntry[];
  list: { version: string | null; source: string | null; imported_at: string | null; entry_count: number } | null;
}

export interface EngineContext {
  now: Date;
  subject: SubjectData;
  /** Ancienneté maximale acceptée d'un justificatif, en mois. */
  maxDocumentAgeMonths: number;
}

const DEFAULTS = { maxDocumentAgeMonths: 3 };

export function engineContext(subject: SubjectData, now: Date = new Date()): EngineContext {
  return { now, subject, maxDocumentAgeMonths: DEFAULTS.maxDocumentAgeMonths };
}

/* --------------------------------------------------------------------- */
/* Aides internes                                                         */
/* --------------------------------------------------------------------- */

function result(
  control: ControlKey,
  status: ControlStatus,
  method: string,
  reasons: string[],
  extra: Partial<ControlResult> = {},
): ControlResult {
  return sanitizeResult({
    control,
    status,
    executed: true,
    method,
    reasons,
    ...extra,
  });
}

/**
 * Un texte non produit par le serveur ne peut pas porter un PASS.
 * Il est ramené à REVIEW_REQUIRED, avec le motif exact.
 */
function capByTextSource(res: ControlResult, text: ExtractedText): ControlResult {
  if (res.status !== "PASS" || text.server_side) return res;
  return {
    ...res,
    status: "REVIEW_REQUIRED",
    reasons: [...res.reasons, `text_source_not_server_verified:${text.source}`],
  };
}

function qualityControl(control: ControlKey, file: AnalysedFile): ControlResult {
  if (!file.sniff.accepted) {
    return result(control, "FAIL", "magic_bytes+size", file.sniff.reasons, {
      library: "moonyp/file-sniff",
      library_version: KYC_ENGINE_VERSION,
      details: { kind: file.sniff.kind, bytes: file.sniff.bytes },
      document_id: file.document_id ?? null,
    });
  }
  const verdict = verifyCaptureEvidence(file.capture_evidence);
  const reasons = [...file.sniff.reasons, ...verdict.reasons];
  const status: ControlStatus =
    verdict.status === "passed"
      ? "PASS"
      : verdict.status === "failed"
        ? "FAIL"
        : verdict.status === "manual_review"
          ? "REVIEW_REQUIRED"
          : "REVIEW_REQUIRED";
  return result(control, status, `magic_bytes+capture_evidence:${verdict.method}`, reasons, {
    score: verdict.score ?? undefined,
    library: "moonyp/evidence.server",
    library_version: KYC_ENGINE_VERSION,
    details: { kind: file.sniff.kind, bytes: file.sniff.bytes, evidence: verdict.evidence },
    document_id: file.document_id ?? null,
  });
}

function readabilityControl(control: ControlKey, file: AnalysedFile, minWords: number): ControlResult {
  if (file.text.source === "none") {
    return notExecuted(
      control,
      file.text.reasons[0] ?? "no_text_available",
      "INCONCLUSIVE",
      { engine: file.text.engine, storage_path: file.storage_path },
    );
  }
  const quality = textQuality(file.text.text, minWords);
  const base = result(
    control,
    quality.readable ? "PASS" : "INCONCLUSIVE",
    `text_quality:${file.text.source}`,
    quality.readable ? [] : ["text_not_readable"],
    {
      score: Math.round(quality.readable_word_ratio * 100),
      threshold: 50,
      library: file.text.engine ?? "moonyp/text-extract",
      details: { ...quality, source: file.text.source, pages: file.text.pages ?? null },
      document_id: file.document_id ?? null,
    },
  );
  return capByTextSource(base, file.text);
}

function natureControl(
  control: ControlKey,
  file: AnalysedFile,
  category: "address" | "bank" | "income",
): ControlResult {
  if (!file.text.text.trim()) {
    return notExecuted(control, "no_text_available", "INCONCLUSIVE");
  }
  const guess = classifyDocument(file.text.text);
  const accepted = ACCEPTED_NATURES[category].includes(guess.nature);
  const base = result(
    control,
    accepted ? "PASS" : guess.nature === "unknown" ? "INCONCLUSIVE" : "REVIEW_REQUIRED",
    "keyword_classifier",
    accepted ? [] : [`unexpected_nature:${guess.nature}`],
    {
      library: "moonyp/text-extract",
      details: { nature: guess.nature, hits: guess.hits, by_nature: guess.by_nature, expected: ACCEPTED_NATURES[category] },
      document_id: file.document_id ?? null,
    },
  );
  return capByTextSource(base, file.text);
}

function recencyControl(control: ControlKey, file: AnalysedFile, ctx: EngineContext): ControlResult {
  if (!file.text.text.trim()) return notExecuted(control, "no_text_available", "INCONCLUSIVE");
  const nowIso = ctx.now.toISOString();
  const ref = documentReferenceDate(file.text.text, nowIso);
  if (!ref.date) {
    return result(control, "INCONCLUSIVE", "date_extraction", ["no_document_date_found"], {
      library: "moonyp/text-extract",
      details: { future_dates: ref.future, all_dates: ref.all },
      document_id: file.document_id ?? null,
    });
  }
  const age = monthsBetween(ref.date, nowIso.slice(0, 10));
  const fresh = age <= ctx.maxDocumentAgeMonths && age >= 0;
  const base = result(
    control,
    fresh ? "PASS" : "FAIL",
    "date_extraction",
    fresh ? [] : [`document_older_than_${ctx.maxDocumentAgeMonths}_months`],
    {
      score: age,
      threshold: ctx.maxDocumentAgeMonths,
      library: "moonyp/text-extract",
      details: { reference_date: ref.date, age_months: age, future_dates: ref.future },
      document_id: file.document_id ?? null,
    },
  );
  return capByTextSource(base, file.text);
}

/* --------------------------------------------------------------------- */
/* Étape 1 — Identité                                                     */
/* --------------------------------------------------------------------- */

export interface IdentityStepInput {
  file: AnalysedFile | null;
  portrait: FacePortraitResult | null;
  screening: ScreeningInput;
  riskFacts: RiskFacts | null;
}

export function runIdentityControls(input: IdentityStepInput, ctx: EngineContext): ControlResult[] {
  const out: ControlResult[] = [];
  const file = input.file;

  if (!file) {
    for (const key of ["document_capture_quality", "document_readability", "mrz_integrity", "identity_data_match", "document_expiry", "id_portrait_extraction"] as ControlKey[]) {
      out.push(notExecuted(key, "no_identity_document_submitted", "NOT_STARTED"));
    }
  } else {
    out.push(qualityControl("document_capture_quality", file));
    out.push(readabilityControl("document_readability", file, 8));

    const mrz = file.text.text ? parseMrz(file.text.text) : null;
    out.push(mrzControl(file, mrz));
    out.push(identityMatchControl(file, mrz, ctx));
    out.push(expiryControl(file, mrz, ctx));
    out.push(portraitControl(input.portrait, file));
  }

  // Authenticité : aucune bibliothèque self-hosted ne vérifie les éléments de
  // sécurité physiques. Statut figé NOT_VERIFIED, jamais PASS.
  out.push(unverifiable("document_authenticity"));

  out.push(...screeningControls(input.screening, ctx));
  out.push(fraudControl(input.riskFacts, ctx));
  return out.map(sanitizeResult);
}

function mrzControl(file: AnalysedFile, mrz: MrzData | null): ControlResult {
  if (!file.text.text.trim()) return notExecuted("mrz_integrity", "no_text_available", "INCONCLUSIVE");
  if (!mrz) {
    return result("mrz_integrity", "INCONCLUSIVE", "mrz_parser", ["no_mrz_band_detected"], {
      library: "moonyp/mrz",
      details: { text_source: file.text.source },
      document_id: file.document_id ?? null,
    });
  }
  const status: ControlStatus = mrz.checksums_valid ? "PASS" : mrz.checksum_ratio >= 0.5 ? "REVIEW_REQUIRED" : "FAIL";
  const base = result(
    "mrz_integrity",
    status,
    "mrz_checksum_mod_7_3_1",
    mrz.checksums_valid ? [] : [`mrz_checksum_invalid:${mrz.checks.filter((c) => !c.ok).map((c) => c.field).join(",")}`],
    {
      score: Math.round(mrz.checksum_ratio * 100),
      threshold: 100,
      library: "moonyp/mrz",
      details: { format: mrz.format, checks: mrz.checks, issuing_state: mrz.issuing_state, text_source: file.text.source },
      document_id: file.document_id ?? null,
    },
  );
  // La MRZ est auto-vérifiante (clés de contrôle) : un OCR client dont toutes
  // les clés tombent juste reste une preuve arithmétique valable.
  return base;
}

function identityMatchControl(file: AnalysedFile, mrz: MrzData | null, ctx: EngineContext): ControlResult {
  if (!mrz) return notExecuted("identity_data_match", "no_mrz_to_compare", "INCONCLUSIVE");
  const cross = crossCheckIdentity(
    {
      first_name: ctx.subject.first_name,
      last_name: ctx.subject.last_name,
      birth_date: ctx.subject.birth_date,
      nationality: ctx.subject.nationality,
    },
    mrz,
    { at: ctx.now },
  );
  const mismatch = cross.fields.some((f) => f.status === "mismatch");
  const partial = cross.fields.some((f) => f.status === "partial" || f.status === "unknown");
  const status: ControlStatus = mismatch ? "FAIL" : cross.score >= 85 && !partial ? "PASS" : "REVIEW_REQUIRED";
  return result("identity_data_match", status, "ocr_mrz_vs_declared", cross.reasons, {
    score: cross.score,
    threshold: 85,
    library: "moonyp/identity-match",
    details: { fields: cross.fields },
    document_id: file.document_id ?? null,
  });
}

function expiryControl(file: AnalysedFile, mrz: MrzData | null, ctx: EngineContext): ControlResult {
  if (!mrz) return notExecuted("document_expiry", "no_expiry_date_available", "INCONCLUSIVE");
  const expired = mrzExpired(mrz, ctx.now);
  if (expired === null) {
    return result("document_expiry", "INCONCLUSIVE", "mrz_expiry_date", ["expiry_date_unreadable"], {
      library: "moonyp/mrz",
      document_id: file.document_id ?? null,
    });
  }
  return result("document_expiry", expired ? "FAIL" : "PASS", "mrz_expiry_date", expired ? ["document_expired"] : [], {
    library: "moonyp/mrz",
    details: { expiry_date: mrz.expiry_date, evaluated_at: ctx.now.toISOString() },
    document_id: file.document_id ?? null,
  });
}

function portraitControl(portrait: FacePortraitResult | null, file: AnalysedFile): ControlResult {
  if (!portrait) {
    return notExecuted("id_portrait_extraction", "face_engine_job_pending", "NOT_VERIFIED", {
      storage_path: file.storage_path,
    });
  }
  const status: ControlStatus =
    portrait.faces === 1 && portrait.usable
      ? "PASS"
      : portrait.faces === 0
        ? "FAIL"
        : portrait.faces > 1
          ? "REVIEW_REQUIRED"
          : "INCONCLUSIVE";
  return result("id_portrait_extraction", status, "face_detection_ssd_mobilenetv1", portrait.reasons, {
    score: Math.round(portrait.quality.detection_score * 100),
    library: portrait.engine,
    library_version: portrait.engine_version,
    details: { faces: portrait.faces, quality: portrait.quality, computed_at: portrait.computed_at },
    document_id: file.document_id ?? null,
  });
}

function screeningControls(input: ScreeningInput, ctx: EngineContext): ControlResult[] {
  const keys: { key: ControlKey; kind: "sanction" | "pep" }[] = [
    { key: "sanctions_screening", kind: "sanction" },
    { key: "pep_screening", kind: "pep" },
  ];
  return keys.map(({ key, kind }) => {
    const entries = input.entries.filter((e) => e.kind === kind);
    if (!input.list || entries.length === 0) {
      return notExecuted(key, "no_screening_list_imported", "NOT_VERIFIED", {
        list: input.list,
        hint: "importer une liste versionnée via scripts/kyc-import-screening-list.ts",
      });
    }
    const res: ScreeningResult = screenCandidate(
      {
        first_name: ctx.subject.first_name,
        last_name: ctx.subject.last_name,
        birth_date: ctx.subject.birth_date,
        nationality: ctx.subject.nationality,
      },
      entries,
      { version: input.list.version, source: input.list.source },
      ctx.now,
    );
    const status: ControlStatus =
      res.status === "no_match" ? "PASS" : res.status === "possible_match" ? "REVIEW_REQUIRED" : "REVIEW_REQUIRED";
    return result(key, status, "local_name_screening", res.status === "no_match" ? [] : [res.status], {
      score: res.hits[0]?.score !== undefined ? Math.round(res.hits[0].score * 100) : undefined,
      threshold: 82,
      library: "moonyp/sanctions",
      details: {
        screening_status: res.status,
        entries_screened: res.entries_screened,
        list_version: res.list_version,
        list_source: res.list_source,
        imported_at: input.list.imported_at,
        entry_count: input.list.entry_count,
        hits: res.hits,
      },
    });
  });
}

function fraudControl(facts: RiskFacts | null, ctx: EngineContext): ControlResult {
  if (!facts) return notExecuted("fraud_signals", "risk_facts_unavailable", "INCONCLUSIVE");
  const risk = assessRisk(facts, ctx.now);
  // Les signaux de risque ne sont jamais une preuve de fraude : ils orientent
  // vers la revue humaine, ils ne condamnent pas un dossier.
  const status: ControlStatus = risk.review_required || risk.status === "high" || risk.status === "medium" ? "REVIEW_REQUIRED" : "PASS";
  return result("fraud_signals", status, "rule_based_risk_signals", risk.signals.map((s) => s.code), {
    score: risk.score,
    library: "moonyp/fraud",
    details: { risk_status: risk.status, signals: risk.signals, evaluated_at: risk.evaluated_at },
  });
}

/* --------------------------------------------------------------------- */
/* Étape 2 — Domicile                                                     */
/* --------------------------------------------------------------------- */

export function runAddressControls(file: AnalysedFile | null, ctx: EngineContext): ControlResult[] {
  if (!file) {
    return (["address_document_readability", "address_document_nature", "address_match", "address_document_recency"] as ControlKey[]).map(
      (k) => notExecuted(k, "no_address_document_submitted", "NOT_STARTED"),
    );
  }
  const out: ControlResult[] = [
    readabilityControl("address_document_readability", file, 20),
    natureControl("address_document_nature", file, "address"),
  ];

  const { address, postal_code, city, first_name, last_name } = ctx.subject;
  if (!address || !postal_code || !city) {
    out.push(notExecuted("address_match", "declared_address_incomplete", "INCONCLUSIVE"));
  } else if (!file.text.text.trim()) {
    out.push(notExecuted("address_match", "no_text_available", "INCONCLUSIVE"));
  } else {
    // L'adresse comparée est celle du DOSSIER, jamais une adresse transmise
    // librement par le navigateur au moment du dépôt.
    const addr = matchAddress(file.text.text, { address, postal_code, city });
    const name = matchName(file.text.text, first_name ?? "", last_name ?? "");
    const holderOk = name.last_name;
    const strong = addr.postal_code && addr.city && addr.street && holderOk;
    const partial = addr.score >= 45 || holderOk;
    const reasons: string[] = [];
    if (!addr.postal_code) reasons.push("postal_code_not_found");
    if (!addr.city) reasons.push("city_not_found");
    if (!addr.street) reasons.push("street_not_found");
    if (!holderOk) reasons.push("holder_name_not_found");
    out.push(
      capByTextSource(
        result("address_match", strong ? "PASS" : partial ? "REVIEW_REQUIRED" : "FAIL", "address_and_name_matching", reasons, {
          score: addr.score,
          threshold: 70,
          library: "moonyp/text-extract",
          details: { address: addr, name },
          document_id: file.document_id ?? null,
        }),
        file.text,
      ),
    );
  }

  out.push(recencyControl("address_document_recency", file, ctx));
  return out.map(sanitizeResult);
}

/* --------------------------------------------------------------------- */
/* Étape 3 — Vivacité                                                     */
/* --------------------------------------------------------------------- */

export interface LivenessStepInput {
  /** Preuve mesurée par la session de vivacité (revalidée serveur). */
  evidence: unknown;
  /** Session réellement enregistrée côté serveur (référence biométrique). */
  serverSession: { asset_id: string; frames: number; challenges: string[]; recorded_at: string } | null;
  faceMatch: FaceMatchResult | null;
  liveFace: FacePortraitResult | null;
}

export function runLivenessControls(input: LivenessStepInput): ControlResult[] {
  const out: ControlResult[] = [];
  const verdict = verifyCaptureEvidence(input.evidence);
  const isLiveness = verdict.method === "liveness";
  const ev = (verdict.evidence ?? {}) as Record<string, unknown>;

  if (!isLiveness) {
    out.push(notExecuted("liveness_challenges", "no_liveness_evidence", "NOT_STARTED"));
    out.push(notExecuted("liveness_server_validation", "no_liveness_evidence", "NOT_STARTED"));
    out.push(notExecuted("anti_spoofing", "no_liveness_evidence", "NOT_STARTED"));
  } else {
    const challenges = Array.isArray(ev["challenges"]) ? (ev["challenges"] as unknown[]).length : 0;
    out.push(
      result(
        "liveness_challenges",
        challenges >= 4 ? (verdict.status === "failed" ? "FAIL" : "PASS") : challenges > 0 ? "INCONCLUSIVE" : "FAIL",
        "randomised_challenge_sequence",
        challenges >= 4 ? [] : [`insufficient_challenges:${challenges}`],
        {
          score: challenges,
          threshold: 4,
          library: "moonyp/liveness-engine",
          details: { challenges: ev["challenges"] ?? null, duration_ms: ev["duration_ms"] ?? null },
        },
      ),
    );

    // Validation serveur : la session doit exister côté serveur avec ses
    // images. « La caméra s'est ouverte » n'est jamais un PASS.
    if (!input.serverSession) {
      out.push(notExecuted("liveness_server_validation", "no_server_side_liveness_session", "INCONCLUSIVE"));
    } else {
      const status: ControlStatus =
        verdict.status === "passed" ? "PASS" : verdict.status === "failed" ? "FAIL" : "REVIEW_REQUIRED";
      out.push(
        result("liveness_server_validation", status, "server_revalidation_of_measured_evidence", verdict.reasons, {
          score: verdict.score ?? undefined,
          library: "moonyp/evidence.server",
          details: {
            frames: input.serverSession.frames,
            challenges: input.serverSession.challenges,
            asset_id: input.serverSession.asset_id,
            recorded_at: input.serverSession.recorded_at,
            evidence: verdict.evidence,
          },
        }),
      );
    }

    const screen = typeof ev["screen_likelihood"] === "number" ? (ev["screen_likelihood"] as number) : null;
    const depth = typeof ev["depth_variance"] === "number" ? (ev["depth_variance"] as number) : null;
    if (screen === null && depth === null) {
      out.push(notExecuted("anti_spoofing", "no_spoofing_metrics_in_evidence", "INCONCLUSIVE"));
    } else {
      const spoof = (screen !== null && screen > 0.7) || (depth !== null && depth < 0.01);
      out.push(
        result("anti_spoofing", spoof ? "FAIL" : "PASS", "screen_likelihood+depth_variance", spoof ? ["presentation_attack_suspected"] : [], {
          score: screen !== null ? Math.round(screen * 100) : undefined,
          threshold: 70,
          library: "moonyp/liveness-engine",
          details: { screen_likelihood: screen, depth_variance: depth },
        }),
      );
    }
  }

  // Face match : mesuré indépendamment, jamais déduit de la vivacité.
  if (!input.faceMatch) {
    out.push(
      notExecuted("face_match", "face_match_job_pending", "NOT_VERIFIED", {
        note: "le face match exige le moteur facial serveur ; la vivacité ne vaut jamais face match",
        live_face: input.liveFace ? { faces: input.liveFace.faces, usable: input.liveFace.usable } : null,
      }),
    );
  } else {
    const m = input.faceMatch;
    out.push(
      result("face_match", m.status, "face_descriptor_euclidean_distance", m.reasons, {
        score: m.distance !== null ? Math.round((1 - Math.min(m.distance, 1)) * 100) : undefined,
        threshold: Math.round((1 - m.threshold) * 100),
        library: m.engine,
        library_version: m.engine_version,
        details: { distance: m.distance, distance_threshold: m.threshold, computed_at: m.computed_at },
      }),
    );
  }

  return out.map(sanitizeResult);
}

/* --------------------------------------------------------------------- */
/* Étape 4 — IBAN / relevé bancaire                                       */
/* --------------------------------------------------------------------- */

export function runIbanControls(file: AnalysedFile | null, ctx: EngineContext): ControlResult[] {
  const out: ControlResult[] = [];
  const declared = ctx.subject.iban ? normaliseIban(ctx.subject.iban) : null;

  if (!declared) {
    out.push(notExecuted("iban_format", "no_iban_declared", "NOT_STARTED"));
  } else {
    const check = validateIban(declared);
    out.push(
      result("iban_format", check.valid ? "PASS" : "FAIL", "iban_structure+mod_97", check.valid ? [] : [check.reason ?? "iban_invalid"], {
        library: "moonyp/iban",
        details: { country: declared.slice(0, 2), length: declared.length },
      }),
    );
  }

  if (!file) {
    for (const k of ["iban_document_readability", "iban_document_match", "iban_holder_match"] as ControlKey[]) {
      out.push(notExecuted(k, "no_bank_document_submitted", "NOT_STARTED"));
    }
    return out.map(sanitizeResult);
  }

  out.push(readabilityControl("iban_document_readability", file, 15));

  if (!declared || !file.text.text.trim()) {
    out.push(notExecuted("iban_document_match", "no_iban_or_no_text", "INCONCLUSIVE"));
  } else {
    const found = extractIbans(file.text.text);
    const exact = found.find((f) => f.iban === declared);
    const status: ControlStatus = exact ? "PASS" : found.length > 0 ? "FAIL" : "INCONCLUSIVE";
    out.push(
      capByTextSource(
        result("iban_document_match", status, "iban_extraction_vs_declared", exact ? [] : found.length ? ["iban_on_document_differs"] : ["no_iban_found_on_document"], {
          library: "moonyp/text-extract",
          details: { found: found.map((f) => ({ masked: `${f.iban.slice(0, 4)}…${f.iban.slice(-4)}`, valid: f.valid })) },
          document_id: file.document_id ?? null,
        }),
        file.text,
      ),
    );
  }

  // Titularité du compte : sans preuve bancaire réelle portant le nom du
  // demandeur, le contrôle reste non vérifié — jamais PASS par défaut.
  if (!file.text.text.trim()) {
    out.push(notExecuted("iban_holder_match", "account_ownership_unverified:no_text", "NOT_VERIFIED"));
  } else {
    const name = matchName(file.text.text, ctx.subject.first_name ?? "", ctx.subject.last_name ?? "");
    const both = name.last_name && name.first_name;
    out.push(
      capByTextSource(
        result(
          "iban_holder_match",
          both ? "PASS" : name.last_name ? "REVIEW_REQUIRED" : "FAIL",
          "holder_name_on_bank_document",
          both ? [] : ["account_ownership_unverified"],
          {
            library: "moonyp/text-extract",
            details: { name, ownership: both ? "DOCUMENT_EVIDENCE" : "UNVERIFIED" },
            document_id: file.document_id ?? null,
          },
        ),
        file.text,
      ),
    );
  }

  return out.map(sanitizeResult);
}

/* --------------------------------------------------------------------- */
/* Étape 5 — Revenus                                                      */
/* --------------------------------------------------------------------- */

export function runIncomeControls(file: AnalysedFile | null, ctx: EngineContext): ControlResult[] {
  if (!file) {
    return (["income_document_readability", "income_document_nature", "income_amount_consistency", "income_document_recency"] as ControlKey[]).map(
      (k) => notExecuted(k, "no_income_document_submitted", "NOT_STARTED"),
    );
  }
  const out: ControlResult[] = [
    readabilityControl("income_document_readability", file, 20),
    natureControl("income_document_nature", file, "income"),
  ];

  const expected = ctx.subject.monthly_income;
  if (!expected || expected <= 0) {
    out.push(notExecuted("income_amount_consistency", "no_declared_income", "INCONCLUSIVE"));
  } else if (!file.text.text.trim()) {
    out.push(notExecuted("income_amount_consistency", "no_text_available", "INCONCLUSIVE"));
  } else {
    const name = matchName(file.text.text, ctx.subject.first_name ?? "", ctx.subject.last_name ?? "");
    const amounts = extractAmounts(file.text.text);
    const closest = closestAmount(amounts, expected);
    const reasons: string[] = [];
    if (!name.last_name) reasons.push("holder_name_not_found");
    if (!closest) reasons.push("no_amount_found");
    else if (closest.deviation > 0.15) reasons.push(`declared_income_deviation:${Math.round(closest.deviation * 100)}%`);
    const status: ControlStatus = !closest
      ? "INCONCLUSIVE"
      : closest.deviation <= 0.15 && name.last_name
        ? "PASS"
        : closest.deviation > 0.4
          ? "FAIL"
          : "REVIEW_REQUIRED";
    out.push(
      capByTextSource(
        result("income_amount_consistency", status, "amount_extraction_vs_declared", reasons, {
          score: closest ? Math.round((1 - Math.min(closest.deviation, 1)) * 100) : undefined,
          threshold: 85,
          library: "moonyp/text-extract",
          details: { declared_income: expected, closest, amounts_found: amounts.length, name },
          document_id: file.document_id ?? null,
        }),
        file.text,
      ),
    );
  }

  out.push(recencyControl("income_document_recency", file, ctx));
  return out.map(sanitizeResult);
}

/* --------------------------------------------------------------------- */
/* Dispatch par étape                                                     */
/* --------------------------------------------------------------------- */

export interface StepRunInput {
  step: StepKey;
  files: AnalysedFile[];
  ctx: EngineContext;
  portrait?: FacePortraitResult | null;
  liveFace?: FacePortraitResult | null;
  faceMatch?: FaceMatchResult | null;
  livenessEvidence?: unknown;
  livenessSession?: LivenessStepInput["serverSession"];
  screening?: ScreeningInput;
  riskFacts?: RiskFacts | null;
}

export function runStep(input: StepRunInput): ControlResult[] {
  const primary = input.files[0] ?? null;
  switch (input.step) {
    case "identity":
      return runIdentityControls(
        {
          file: primary,
          portrait: input.portrait ?? null,
          screening: input.screening ?? { entries: [], list: null },
          riskFacts: input.riskFacts ?? null,
        },
        input.ctx,
      );
    case "address":
      return runAddressControls(primary, input.ctx);
    case "liveness":
      return runLivenessControls({
        evidence: input.livenessEvidence,
        serverSession: input.livenessSession ?? null,
        faceMatch: input.faceMatch ?? null,
        liveFace: input.liveFace ?? null,
      });
    case "iban":
      return runIbanControls(primary, input.ctx);
    case "income":
      return runIncomeControls(primary, input.ctx);
  }
}

export { CONTROL_BY_KEY, KYC_ENGINE_VERSION };
