/**
 * Revalidation serveur des preuves de capture KYC.
 *
 * Le navigateur produit une preuve mesurée (scanner de document ou contrôle de
 * vivacité). Cette preuve n'est jamais crue sur parole : elle est ici
 * normalisée, bornée, puis confrontée aux mêmes seuils que ceux appliqués à
 * l'écran. Le verdict obtenu pilote le statut du contrôle KYC correspondant
 * (`application_kyc_checks`) et, le cas échéant, l'orientation en revue
 * manuelle.
 *
 * Ce module est strictement serveur (`*.server.ts`) : il n'est jamais embarqué
 * dans le bundle client.
 */

export type EvidenceMethod = "scan" | "upload" | "liveness";

export type EvidenceVerdict = {
  /** Statut à écrire dans `application_kyc_checks.status`. */
  status: "verifying" | "passed" | "manual_review" | "failed";
  /** Score 0..100 conservé pour la conformité. */
  score: number | null;
  method: EvidenceMethod;
  provider: string;
  /** Motifs machine, journalisés et affichés au back-office. */
  reasons: string[];
  /** Preuve normalisée, sûre à stocker en JSONB. */
  evidence: Record<string, unknown> | null;
};

/* --------------------------------------------------------------------- */
/* Seuils serveur (volontairement un cran en dessous du client, afin de   */
/* tolérer l'imprécision d'un appareil modeste sans laisser passer une    */
/* capture manifestement non conforme).                                   */
/* --------------------------------------------------------------------- */

const SCAN_LIMITS = {
  minScore: 55,
  minSharpness: 34,
  minBrightness: 45,
  maxBrightness: 232,
  maxGlare: 0.06,
  maxScreenLikelihood: 0.78,
  minStableFrames: 3,
  minAnalysedFrames: 5,
};

const LIVENESS_LIMITS = {
  // Quatre défis au lieu de trois : une séquence rejouée depuis un
  // enregistrement a d'autant moins de chance de couvrir l'ordre tiré.
  minChallenges: 4,
  minDurationMs: 1800,
  maxDurationMs: 10 * 60 * 1000,
  minAnalysedFrames: 30,
  minDepthVariance: 0.01,
  // Un visage rejoué depuis un écran est refusé plus tôt qu'auparavant.
  maxScreenLikelihood: 0.7,
  maxNoFaceRatio: 0.6,
  maxReactionMs: 60_000,
  /**
   * Anti-rejeu : une réaction plus rapide que la perception humaine ne vient
   * pas d'une personne qui vient de lire la consigne, mais d'une vidéo qui
   * exécutait déjà le geste.
   */
  minReactionMs: 120,
};

const KNOWN_CHALLENGES = new Set(["blink", "turn_left", "turn_right", "smile", "open_mouth"]);

/* --------------------------------------------------------------------- */
/* Utilitaires de normalisation                                           */
/* --------------------------------------------------------------------- */

function num(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function str(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDate(value: unknown): string | null {
  const raw = str(value, 40);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/* --------------------------------------------------------------------- */
/* Scan / import de document                                              */
/* --------------------------------------------------------------------- */

function verdictForDocument(
  raw: Record<string, unknown>,
  method: "scan" | "upload",
): EvidenceVerdict {
  const device = record(raw["device"]);
  const evidence: Record<string, unknown> = {
    method,
    auto: raw["auto"] === true,
    score: num(raw["score"], 0, 100),
    brightness: num(raw["brightness"], 0, 255),
    contrast: num(raw["contrast"], 0, 255),
    sharpness: num(raw["sharpness"], 0, 100_000),
    glare: num(raw["glare"], 0, 1),
    straightness: num(raw["straightness"], 0, 1),
    fill: num(raw["fill"], 0, 4),
    off_center: num(raw["off_center"], 0, 4),
    screen_likelihood: num(raw["screen_likelihood"], 0, 1),
    stable_frames: num(raw["stable_frames"], 0, 100_000),
    analysed_frames: num(raw["analysed_frames"], 0, 1_000_000),
    duration_ms: num(raw["duration_ms"], 0, 60 * 60 * 1000),
    device: {
      width: num(device["width"], 0, 20_000),
      height: num(device["height"], 0, 20_000),
      facing: str(device["facing"], 20),
    },
    verified_at: new Date().toISOString(),
  };

  const reasons: string[] = [];
  const score = evidence["score"] as number | null;

  if (method === "upload") {
    // Un fichier importé n'a pas de mesure caméra : la conformité tranche.
    return {
      status: "verifying",
      score,
      method,
      provider: "device_upload",
      reasons: ["manual_review_required"],
      evidence,
    };
  }

  const sharpness = evidence["sharpness"] as number | null;
  const brightness = evidence["brightness"] as number | null;
  const glare = evidence["glare"] as number | null;
  const screen = evidence["screen_likelihood"] as number | null;
  const stable = evidence["stable_frames"] as number | null;
  const analysed = evidence["analysed_frames"] as number | null;

  if (score === null) reasons.push("missing_score");
  else if (score < SCAN_LIMITS.minScore) reasons.push("low_quality_score");
  if (sharpness !== null && sharpness < SCAN_LIMITS.minSharpness) reasons.push("blurry");
  if (brightness !== null && brightness < SCAN_LIMITS.minBrightness) reasons.push("too_dark");
  if (brightness !== null && brightness > SCAN_LIMITS.maxBrightness) reasons.push("overexposed");
  if (glare !== null && glare > SCAN_LIMITS.maxGlare) reasons.push("glare");
  if (screen !== null && screen > SCAN_LIMITS.maxScreenLikelihood)
    reasons.push("screen_presentation_suspected");
  if (stable !== null && stable < SCAN_LIMITS.minStableFrames) reasons.push("unstable_capture");
  if (analysed !== null && analysed < SCAN_LIMITS.minAnalysedFrames)
    reasons.push("insufficient_analysis");

  const blocking = reasons.includes("screen_presentation_suspected");
  return {
    status: blocking ? "manual_review" : reasons.length > 0 ? "manual_review" : "verifying",
    score,
    method,
    provider: "device_scan",
    reasons,
    evidence,
  };
}

/* --------------------------------------------------------------------- */
/* Contrôle de vivacité                                                   */
/* --------------------------------------------------------------------- */

function verdictForLiveness(raw: Record<string, unknown>): EvidenceVerdict {
  const metrics = record(raw["metrics"]);
  const device = record(raw["device"]);
  const engine = record(raw["engine"]);

  const requested = Array.isArray(raw["requested"])
    ? (raw["requested"] as unknown[])
        .map((c) => str(c, 20))
        .filter((c): c is string => Boolean(c) && KNOWN_CHALLENGES.has(c as string))
        .slice(0, 8)
    : [];

  const passed = Array.isArray(raw["passed"])
    ? (raw["passed"] as unknown[])
        .slice(0, 8)
        .map((entry) => {
          const item = record(entry);
          const challenge = str(item["challenge"], 20);
          if (!challenge || !KNOWN_CHALLENGES.has(challenge)) return null;
          return {
            challenge,
            at_ms: num(item["at_ms"], 0, 60 * 60 * 1000),
            reaction_ms: num(item["reaction_ms"], 0, 60 * 60 * 1000),
            value: num(item["value"], -1000, 1000),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  const started = isoDate(raw["started_at"]);
  const completed = isoDate(raw["completed_at"]);
  const duration = num(raw["duration_ms"], 0, 60 * 60 * 1000);
  const analysed = num(raw["analysed_frames"], 0, 1_000_000);

  const normalisedMetrics = {
    yaw_min: num(metrics["yaw_min"], -180, 180),
    yaw_max: num(metrics["yaw_max"], -180, 180),
    blink_peak: num(metrics["blink_peak"], 0, 1),
    smile_peak: num(metrics["smile_peak"], 0, 1),
    jaw_peak: num(metrics["jaw_peak"], 0, 1),
    depth_variance_avg: num(metrics["depth_variance_avg"], 0, 10),
    screen_likelihood_max: num(metrics["screen_likelihood_max"], 0, 1),
    brightness_avg: num(metrics["brightness_avg"], 0, 255),
    sharpness_avg: num(metrics["sharpness_avg"], 0, 100_000),
    multi_face_frames: num(metrics["multi_face_frames"], 0, 1_000_000),
    no_face_frames: num(metrics["no_face_frames"], 0, 1_000_000),
  };

  const evidence: Record<string, unknown> = {
    method: "liveness",
    session_id: str(raw["session_id"], 64),
    started_at: started,
    completed_at: completed,
    duration_ms: duration,
    analysed_frames: analysed,
    requested,
    passed,
    metrics: normalisedMetrics,
    device: {
      width: num(device["width"], 0, 20_000),
      height: num(device["height"], 0, 20_000),
      facing: str(device["facing"], 20),
    },
    engine: { name: str(engine["name"], 60), version: str(engine["version"], 20) },
    verified_at: new Date().toISOString(),
  };

  const reasons: string[] = [];

  if (passed.length < LIVENESS_LIMITS.minChallenges) reasons.push("not_enough_challenges");
  if (requested.length > 0 && passed.length < requested.length)
    reasons.push("challenges_incomplete");
  if (new Set(passed.map((p) => p.challenge)).size < passed.length)
    reasons.push("duplicated_challenges");
  for (const entry of passed) {
    if (requested.length > 0 && !requested.includes(entry.challenge))
      reasons.push("unexpected_challenge");
    if (entry.reaction_ms !== null && entry.reaction_ms > LIVENESS_LIMITS.maxReactionMs) {
      reasons.push("slow_reaction");
    }
    if (entry.reaction_ms !== null && entry.reaction_ms < LIVENESS_LIMITS.minReactionMs) {
      // Le geste précédait la consigne : rejeu d'un enregistrement.
      reasons.push("reaction_too_fast");
    }
  }
  if (duration === null || duration < LIVENESS_LIMITS.minDurationMs)
    reasons.push("session_too_short");
  if (duration !== null && duration > LIVENESS_LIMITS.maxDurationMs)
    reasons.push("session_expired");
  if (analysed === null || analysed < LIVENESS_LIMITS.minAnalysedFrames)
    reasons.push("insufficient_analysis");
  if (
    normalisedMetrics.depth_variance_avg !== null &&
    normalisedMetrics.depth_variance_avg < LIVENESS_LIMITS.minDepthVariance
  ) {
    reasons.push("flat_face_suspected");
  }
  if (
    normalisedMetrics.screen_likelihood_max !== null &&
    normalisedMetrics.screen_likelihood_max > LIVENESS_LIMITS.maxScreenLikelihood
  ) {
    reasons.push("screen_presentation_suspected");
  }
  if (normalisedMetrics.multi_face_frames !== null && normalisedMetrics.multi_face_frames > 0) {
    reasons.push("multiple_faces_seen");
  }
  if (
    analysed !== null &&
    analysed > 0 &&
    normalisedMetrics.no_face_frames !== null &&
    normalisedMetrics.no_face_frames / analysed > LIVENESS_LIMITS.maxNoFaceRatio
  ) {
    reasons.push("face_rarely_detected");
  }
  if (started && completed && Date.parse(completed) < Date.parse(started))
    reasons.push("inconsistent_timestamps");

  // Score de vivacité : base sur les défis validés, pénalisé par les motifs.
  const base = Math.min(100, (passed.length / Math.max(1, LIVENESS_LIMITS.minChallenges)) * 100);
  const score = Math.max(0, Math.round(base - reasons.length * 15));

  const blocking = reasons.some((r) =>
    [
      "not_enough_challenges",
      "flat_face_suspected",
      "screen_presentation_suspected",
      "session_too_short",
    ].includes(r),
  );

  return {
    status: blocking ? "failed" : reasons.length > 0 ? "manual_review" : "verifying",
    score,
    method: "liveness",
    provider: "mediapipe_face_landmarker",
    reasons,
    evidence,
  };
}

/* --------------------------------------------------------------------- */
/* Point d'entrée                                                         */
/* --------------------------------------------------------------------- */

/**
 * Revalide une preuve de capture transmise par le client.
 * Une preuve absente ou illisible n'est jamais bloquante : le dossier part
 * simplement en revue documentaire, comme aujourd'hui.
 */
export function verifyCaptureEvidence(input: unknown): EvidenceVerdict {
  const raw = record(input);
  const method = str(raw["method"], 20);

  if (method === "liveness") return verdictForLiveness(raw);
  if (method === "scan") return verdictForDocument(raw, "scan");
  if (method === "upload") return verdictForDocument(raw, "upload");

  return {
    status: "verifying",
    score: null,
    method: "upload",
    provider: "manual",
    reasons: ["no_evidence"],
    evidence: null,
  };
}
