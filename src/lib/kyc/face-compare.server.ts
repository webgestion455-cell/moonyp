/**
 * Comparaison faciale pièce d'identité ↔ visage vivant — moteur serveur.
 *
 * Ce module tourne dans le runtime applicatif (edge inclus) : il n'utilise
 * aucun binaire natif, aucun modèle TensorFlow, aucun service externe. Il
 * compare les PIXELS RÉELS de deux visages recadrés, transmis par le parcours
 * KYC, avec des descripteurs classiques, déterministes et auditables :
 *
 *   - HOG (histogrammes de gradients orientés, 9 orientations, cellules 8×8,
 *     blocs 2×2 normalisés L2) → similarité cosinus ;
 *   - LBP (motifs binaires locaux 8 voisins, rayon 1, histogrammes uniformes
 *     59 bins sur une grille 4×4) → similarité chi-2 ;
 *   - corrélation croisée normalisée sur l'imagette égalisée.
 *
 * Honnêteté du moteur : ce n'est PAS un réseau de reconnaissance faciale
 * profond. Sa précision est celle d'un moteur classique. Il est donc utilisé
 * comme filtre de premier niveau, avec une bande intermédiaire large : tout
 * ce qui n'est pas franchement au-dessus ou franchement en dessous du seuil
 * part en revue humaine. Lorsque le worker interne (`face-engine.node.ts`,
 * descripteur ResNet 128D) a produit un résultat pour le dossier, ce dernier
 * prime — voir `resolveFaceMatch()`.
 *
 * Aucun descripteur biométrique n'est persisté : tout est calculé en mémoire
 * et détruit à la fin de l'appel. Seules des métriques non réversibles
 * (similarité, qualité, motifs) ressortent.
 *
 * Module strictement serveur (`*.server.ts`).
 */

import {
  FACE_MATCH_THRESHOLD,
  FACE_MISMATCH_THRESHOLD,
  FACE_QUALITY_LIMITS,
  FACE_DESCRIPTOR_DISTANCE,
} from "./thresholds.server";

export const FACE_COMPARE_ENGINE = {
  name: "moonyp-face-classic",
  version: "1.0.0",
  method: "hog+lbp+ncc",
  /** Déclaration explicite : moteur classique, pas un réseau profond. */
  grade: "first_level_screening",
} as const;

/* --------------------------------------------------------------------- */
/* Entrées                                                                */
/* --------------------------------------------------------------------- */

/** Preuve faciale transmise par le parcours (jamais crue sur parole). */
export interface FaceEvidenceInput {
  /** Image du visage recadré, encodée base64 (JPEG ou PNG). */
  image_base64?: unknown;
  /** Nombre de visages détectés sur l'image d'origine par le client. */
  faces_detected?: unknown;
  /** Côté du visage détecté, en pixels de l'image source. */
  face_size_px?: unknown;
  /** Nom/version du détecteur client, purement informatif. */
  engine?: unknown;
  source?: unknown;
}

export type FaceMatchBand = "match" | "borderline" | "mismatch" | "not_compared";

/** Contrat de sortie imposé : identique quel que soit le moteur retenu. */
export interface FaceMatchOutcome {
  compared: boolean;
  similarity: number | null;
  threshold: number;
  passed: boolean;
  reasons: string[];
  band: FaceMatchBand;
  engine: string;
  engine_version: string;
  method: string;
  document_faces: number | null;
  live_faces: number | null;
  /** Métriques de qualité, sûres à journaliser (non biométriques). */
  quality: {
    document: FaceCropQuality | null;
    live: FaceCropQuality | null;
  };
  compared_at: string;
}

export interface FaceCropQuality {
  width: number;
  height: number;
  sharpness: number;
  brightness: number;
  contrast: number;
  usable: boolean;
  reasons: string[];
}

/* --------------------------------------------------------------------- */
/* Normalisation des entrées                                              */
/* --------------------------------------------------------------------- */

/** Taille maximale acceptée pour une imagette de visage (anti-abus). */
const MAX_IMAGE_BYTES = 512 * 1024;

/** Résolution de travail des descripteurs. */
const WORK_SIZE = 112;

function intOrNull(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function base64Payload(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.startsWith("data:") ? (value.split(",")[1] ?? "") : value;
  const cleaned = raw.replace(/\s+/g, "");
  if (cleaned.length < 64) return null;
  // 4 caractères base64 = 3 octets.
  if ((cleaned.length * 3) / 4 > MAX_IMAGE_BYTES) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  return cleaned;
}

function decodeBase64(payload: string): Uint8Array | null {
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

interface RgbImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Décodage pur JavaScript : JPEG (jpeg-js) ou PNG (pngjs). */
async function decodeImage(bytes: Uint8Array): Promise<RgbImage | null> {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  try {
    if (isJpeg) {
      const jpeg = await import("jpeg-js");
      const decode = (jpeg as unknown as { default?: typeof jpeg }).default ?? jpeg;
      const raw = decode.decode(bytes, { useTArray: true, formatAsRGBA: true });
      const rgb = new Uint8Array(raw.width * raw.height * 3);
      for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
        rgb[j] = raw.data[i]!;
        rgb[j + 1] = raw.data[i + 1]!;
        rgb[j + 2] = raw.data[i + 2]!;
      }
      return { data: rgb, width: raw.width, height: raw.height };
    }
    if (isPng) {
      const { PNG } = await import("pngjs");
      const png = PNG.sync.read(Buffer.from(bytes));
      const rgb = new Uint8Array(png.width * png.height * 3);
      for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
        rgb[j] = png.data[i]!;
        rgb[j + 1] = png.data[i + 1]!;
        rgb[j + 2] = png.data[i + 2]!;
      }
      return { data: rgb, width: png.width, height: png.height };
    }
  } catch {
    return null;
  }
  return null;
}

/* --------------------------------------------------------------------- */
/* Prétraitement                                                          */
/* --------------------------------------------------------------------- */

/** Niveaux de gris (luminance ITU-R BT.601) puis rééchantillonnage bilinéaire. */
function toGrayResized(image: RgbImage, size: number): Float32Array {
  const gray = new Float32Array(image.width * image.height);
  for (let i = 0, p = 0; p < gray.length; i += 3, p += 1) {
    gray[p] = 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]!;
  }
  const out = new Float32Array(size * size);
  const sx = image.width / size;
  const sy = image.height / size;
  for (let y = 0; y < size; y += 1) {
    const fy = Math.min(image.height - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < size; x += 1) {
      const fx = Math.min(image.width - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const wx = fx - x0;
      const a = gray[y0 * image.width + x0]!;
      const b = gray[y0 * image.width + x1]!;
      const c = gray[y1 * image.width + x0]!;
      const d = gray[y1 * image.width + x1]!;
      out[y * size + x] =
        a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c * (1 - wx) * wy + d * wx * wy;
    }
  }
  return out;
}

/** Égalisation d'histogramme : neutralise l'écart d'exposition entre les deux prises. */
function equalize(values: Float32Array): Float32Array {
  const hist = new Uint32Array(256);
  for (const v of values) hist[Math.min(255, Math.max(0, Math.round(v)))]! += 1;
  const cdf = new Float32Array(256);
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += hist[i]!;
    cdf[i] = sum;
  }
  const total = values.length || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const level = Math.min(255, Math.max(0, Math.round(values[i]!)));
    out[i] = (cdf[level]! / total) * 255;
  }
  return out;
}

/** Variance du Laplacien : mesure de netteté réellement calculée sur les pixels. */
function sharpnessOf(values: Float32Array, size: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      const lap =
        4 * values[i]! - values[i - 1]! - values[i + 1]! - values[i - size]! - values[i + size]!;
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

function statsOf(values: Float32Array): { mean: number; std: number } {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / (values.length || 1);
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  return { mean, std: Math.sqrt(acc / (values.length || 1)) };
}

/* --------------------------------------------------------------------- */
/* Descripteurs                                                           */
/* --------------------------------------------------------------------- */

/** Table des 58 motifs LBP uniformes ; tous les autres tombent dans le bin 58. */
const UNIFORM_LBP = (() => {
  const table = new Int16Array(256).fill(58);
  let next = 0;
  for (let code = 0; code < 256; code += 1) {
    let transitions = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      const a = (code >> bit) & 1;
      const b = (code >> ((bit + 1) % 8)) & 1;
      if (a !== b) transitions += 1;
    }
    if (transitions <= 2) {
      table[code] = next;
      next += 1;
    }
  }
  return table;
})();

/** Histogrammes LBP uniformes sur une grille 4×4 (16 × 59 = 944 dimensions). */
function lbpHistogram(values: Float32Array, size: number): Float32Array {
  const grid = 4;
  const cell = size / grid;
  const hist = new Float32Array(grid * grid * 59);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const c = values[y * size + x]!;
      let code = 0;
      code |= (values[(y - 1) * size + (x - 1)]! >= c ? 1 : 0) << 0;
      code |= (values[(y - 1) * size + x]! >= c ? 1 : 0) << 1;
      code |= (values[(y - 1) * size + (x + 1)]! >= c ? 1 : 0) << 2;
      code |= (values[y * size + (x + 1)]! >= c ? 1 : 0) << 3;
      code |= (values[(y + 1) * size + (x + 1)]! >= c ? 1 : 0) << 4;
      code |= (values[(y + 1) * size + x]! >= c ? 1 : 0) << 5;
      code |= (values[(y + 1) * size + (x - 1)]! >= c ? 1 : 0) << 6;
      code |= (values[y * size + (x - 1)]! >= c ? 1 : 0) << 7;
      const gx = Math.min(grid - 1, Math.floor(x / cell));
      const gy = Math.min(grid - 1, Math.floor(y / cell));
      hist[(gy * grid + gx) * 59 + UNIFORM_LBP[code]!]! += 1;
    }
  }
  // Normalisation par cellule.
  for (let block = 0; block < grid * grid; block += 1) {
    let sum = 0;
    for (let b = 0; b < 59; b += 1) sum += hist[block * 59 + b]!;
    if (sum <= 0) continue;
    for (let b = 0; b < 59; b += 1) hist[block * 59 + b]! /= sum;
  }
  return hist;
}

/** Descripteur HOG : 9 orientations, cellules 8×8, blocs 2×2 normalisés L2. */
function hogDescriptor(values: Float32Array, size: number): Float32Array {
  const cellSize = 8;
  const cells = size / cellSize;
  const bins = 9;
  const cellHist = new Float32Array(cells * cells * bins);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const gx = values[y * size + (x + 1)]! - values[y * size + (x - 1)]!;
      const gy = values[(y + 1) * size + x]! - values[(y - 1) * size + x]!;
      const magnitude = Math.hypot(gx, gy);
      if (magnitude <= 0) continue;
      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      if (angle >= 180) angle = 179.999;
      const bin = Math.min(bins - 1, Math.floor((angle / 180) * bins));
      const cx = Math.min(cells - 1, Math.floor(x / cellSize));
      const cy = Math.min(cells - 1, Math.floor(y / cellSize));
      cellHist[(cy * cells + cx) * bins + bin]! += magnitude;
    }
  }
  const blocks = cells - 1;
  const out = new Float32Array(blocks * blocks * bins * 4);
  let w = 0;
  for (let by = 0; by < blocks; by += 1) {
    for (let bx = 0; bx < blocks; bx += 1) {
      const block: number[] = [];
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const base = ((by + dy) * cells + (bx + dx)) * bins;
          for (let b = 0; b < bins; b += 1) block.push(cellHist[base + b]!);
        }
      }
      let norm = 0;
      for (const v of block) norm += v * v;
      norm = Math.sqrt(norm) + 1e-6;
      for (const v of block) {
        out[w] = Math.min(0.2, v / norm);
        w += 1;
      }
    }
  }
  return out;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Similarité chi-2 bornée 0..1 entre deux histogrammes normalisés. */
function chiSquareSimilarity(a: Float32Array, b: Float32Array): number {
  let distance = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const s = a[i]! + b[i]!;
    if (s <= 0) continue;
    const d = a[i]! - b[i]!;
    distance += (d * d) / s;
  }
  // chi-2 normalisé : 0 = identique, 2 = totalement disjoint par cellule.
  const cells = Math.max(1, n / 59);
  return Math.max(0, 1 - distance / (2 * cells));
}

/** Corrélation croisée normalisée entre deux imagettes égalisées. */
function normalizedCorrelation(a: Float32Array, b: Float32Array): number {
  const sa = statsOf(a);
  const sb = statsOf(b);
  if (sa.std <= 0 || sb.std <= 0) return 0;
  let acc = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) acc += ((a[i]! - sa.mean) / sa.std) * ((b[i]! - sb.mean) / sb.std);
  return Math.max(-1, Math.min(1, acc / n));
}

/* --------------------------------------------------------------------- */
/* Préparation d'un visage                                                */
/* --------------------------------------------------------------------- */

interface PreparedFace {
  raw: Float32Array;
  equalized: Float32Array;
  hog: Float32Array;
  lbp: Float32Array;
  quality: FaceCropQuality;
}

async function prepareFace(
  input: FaceEvidenceInput | null | undefined,
  label: "document" | "live",
): Promise<{ face: PreparedFace | null; reasons: string[] }> {
  const reasons: string[] = [];
  if (!input) return { face: null, reasons: [`${label}_face_evidence_missing`] };

  const payload = base64Payload(input.image_base64);
  if (!payload) return { face: null, reasons: [`${label}_face_image_missing`] };

  const bytes = decodeBase64(payload);
  if (!bytes) return { face: null, reasons: [`${label}_face_image_unreadable`] };

  const image = await decodeImage(bytes);
  if (!image || image.width < 32 || image.height < 32) {
    return { face: null, reasons: [`${label}_face_image_unreadable`] };
  }

  const raw = toGrayResized(image, WORK_SIZE);
  const stats = statsOf(raw);
  const sharpness = sharpnessOf(raw, WORK_SIZE);
  const declaredSize = intOrNull(input.face_size_px, 0, 10_000);

  const qualityReasons: string[] = [];
  if (declaredSize !== null && declaredSize < FACE_QUALITY_LIMITS.minFaceSizePx)
    qualityReasons.push(`${label}_face_too_small`);
  if (sharpness < FACE_QUALITY_LIMITS.minSharpness) qualityReasons.push(`${label}_face_blurry`);
  if (stats.mean < FACE_QUALITY_LIMITS.minBrightness) qualityReasons.push(`${label}_face_too_dark`);
  if (stats.mean > FACE_QUALITY_LIMITS.maxBrightness)
    qualityReasons.push(`${label}_face_overexposed`);
  if (stats.std < FACE_QUALITY_LIMITS.minContrast)
    qualityReasons.push(`${label}_face_low_contrast`);

  const quality: FaceCropQuality = {
    width: image.width,
    height: image.height,
    sharpness: Math.round(sharpness * 100) / 100,
    brightness: Math.round(stats.mean * 100) / 100,
    contrast: Math.round(stats.std * 100) / 100,
    usable: qualityReasons.length === 0,
    reasons: qualityReasons,
  };

  reasons.push(...qualityReasons);
  const equalized = equalize(raw);
  return {
    face: {
      raw,
      equalized,
      hog: hogDescriptor(equalized, WORK_SIZE),
      lbp: lbpHistogram(equalized, WORK_SIZE),
      quality,
    },
    reasons,
  };
}

/* --------------------------------------------------------------------- */
/* Comparaison                                                            */
/* --------------------------------------------------------------------- */

function notCompared(
  reasons: string[],
  documentFaces: number | null,
  liveFaces: number | null,
  quality: FaceMatchOutcome["quality"],
): FaceMatchOutcome {
  return {
    compared: false,
    similarity: null,
    threshold: FACE_MATCH_THRESHOLD,
    passed: false,
    reasons: [...new Set(reasons)],
    band: "not_compared",
    engine: FACE_COMPARE_ENGINE.name,
    engine_version: FACE_COMPARE_ENGINE.version,
    method: FACE_COMPARE_ENGINE.method,
    document_faces: documentFaces,
    live_faces: liveFaces,
    quality,
    compared_at: new Date().toISOString(),
  };
}

/**
 * Compare le visage de la pièce d'identité au visage capté pendant le
 * contrôle de vivacité. Ne lève jamais : toute impossibilité produit
 * `compared: false` avec le motif exact.
 */
export async function compareFaces(
  documentFace: FaceEvidenceInput | null | undefined,
  liveFace: FaceEvidenceInput | null | undefined,
): Promise<FaceMatchOutcome> {
  const documentFaces = intOrNull(documentFace?.faces_detected, 0, 50);
  const liveFaces = intOrNull(liveFace?.faces_detected, 0, 50);

  const doc = await prepareFace(documentFace, "document");
  const live = await prepareFace(liveFace, "live");
  const quality = { document: doc.face?.quality ?? null, live: live.face?.quality ?? null };
  const reasons = [...doc.reasons, ...live.reasons];

  // Plusieurs visages là où un seul est attendu : condition bloquante, jamais
  // une comparaison « au mieux ».
  if (documentFaces !== null && documentFaces > 1) reasons.push("multiple_faces_on_document");
  if (liveFaces !== null && liveFaces > 1) reasons.push("multiple_faces_on_live_capture");
  if (documentFaces === 0) reasons.push("no_face_on_document");
  if (liveFaces === 0) reasons.push("no_face_on_live_capture");

  if (!doc.face || !live.face) return notCompared(reasons, documentFaces, liveFaces, quality);
  if (!doc.face.quality.usable || !live.face.quality.usable) {
    return notCompared(
      [...reasons, "face_quality_insufficient"],
      documentFaces,
      liveFaces,
      quality,
    );
  }
  if ((documentFaces !== null && documentFaces > 1) || (liveFaces !== null && liveFaces > 1)) {
    return notCompared(reasons, documentFaces, liveFaces, quality);
  }

  const hog = cosine(doc.face.hog, live.face.hog);
  const lbp = chiSquareSimilarity(doc.face.lbp, live.face.lbp);
  const ncc = normalizedCorrelation(doc.face.equalized, live.face.equalized);

  // Pondération : le HOG porte la structure du visage, le LBP la texture,
  // la corrélation sert d'appoint. Bornée 0..1, jamais extrapolée.
  const blended = 0.5 * hog + 0.35 * lbp + 0.15 * Math.max(0, ncc);
  const similarity = Math.round(Math.max(0, Math.min(1, blended)) * 10_000) / 10_000;

  const band: FaceMatchBand =
    similarity >= FACE_MATCH_THRESHOLD
      ? "match"
      : similarity < FACE_MISMATCH_THRESHOLD
        ? "mismatch"
        : "borderline";

  if (band === "match") reasons.push("identity_face_match_passed");
  if (band === "borderline") reasons.push("identity_face_match_borderline");
  if (band === "mismatch") reasons.push("identity_face_match_failed");

  return {
    compared: true,
    similarity,
    threshold: FACE_MATCH_THRESHOLD,
    passed: band === "match",
    reasons: [...new Set(reasons)],
    band,
    engine: FACE_COMPARE_ENGINE.name,
    engine_version: FACE_COMPARE_ENGINE.version,
    method: FACE_COMPARE_ENGINE.method,
    document_faces: documentFaces,
    live_faces: liveFaces,
    quality,
    compared_at: new Date().toISOString(),
  };
}

/* --------------------------------------------------------------------- */
/* Priorité au moteur profond                                             */
/* --------------------------------------------------------------------- */

/**
 * Convertit un résultat du worker interne (`application_kyc_face_jobs.result`,
 * descripteur ResNet 128D) au contrat commun. Renvoie `null` si le résultat
 * n'est pas exploitable, auquel cas le moteur classique reste en vigueur.
 */
export function faceMatchFromWorkerResult(result: unknown): FaceMatchOutcome | null {
  if (!result || typeof result !== "object") return null;
  const row = result as Record<string, unknown>;
  const distance = typeof row["distance"] === "number" ? row["distance"] : null;
  const status = typeof row["status"] === "string" ? row["status"] : null;
  if (distance === null && status === null) return null;

  const band: FaceMatchBand =
    distance === null
      ? "not_compared"
      : distance <= FACE_DESCRIPTOR_DISTANCE.match
        ? "match"
        : distance >= FACE_DESCRIPTOR_DISTANCE.mismatch
          ? "mismatch"
          : "borderline";

  // Similarité lisible, dérivée de la distance euclidienne (1 = identique).
  const similarity =
    distance === null ? null : Math.round(Math.max(0, 1 - distance) * 10_000) / 10_000;

  const reasons = Array.isArray(row["reasons"])
    ? (row["reasons"] as unknown[]).filter((r): r is string => typeof r === "string").slice(0, 12)
    : [];
  if (band === "match") reasons.push("identity_face_match_passed");
  if (band === "borderline") reasons.push("identity_face_match_borderline");
  if (band === "mismatch") reasons.push("identity_face_match_failed");

  return {
    compared: distance !== null,
    similarity,
    threshold: 1 - FACE_DESCRIPTOR_DISTANCE.match,
    passed: band === "match",
    reasons: [...new Set(reasons)],
    band,
    engine: "face-api/face_recognition_resnet34_128d",
    engine_version: "1.7.15",
    method: "face_descriptor_euclidean_distance",
    document_faces: intOrNull(row["id_faces"], 0, 50),
    live_faces: intOrNull(row["live_faces"], 0, 50),
    quality: { document: null, live: null },
    compared_at: new Date().toISOString(),
  };
}

/**
 * Sélectionne le résultat opposable : le moteur profond prime dès qu'il a
 * réellement comparé ; sinon le moteur classique du runtime applicatif.
 */
export function resolveFaceMatch(
  workerResult: FaceMatchOutcome | null,
  inlineResult: FaceMatchOutcome | null,
): FaceMatchOutcome | null {
  if (workerResult && workerResult.compared) return workerResult;
  return inlineResult ?? workerResult;
}
