/**
 * Moteur facial Moonyp — auto-hébergé, exécution Node/Bun uniquement.
 *
 * Pile réellement utilisée (aucun service externe, aucun envoi d'image) :
 *   - `@vladmandic/face-api` (MIT) : SSD MobileNet v1 (détection),
 *     Face Landmark 68 (repères), Face Recognition ResNet (descripteur 128D) ;
 *   - `@tensorflow/tfjs` backend CPU pur JavaScript (Apache-2.0) ;
 *   - `jpeg-js` / `pngjs` pour le décodage d'image (pas de binaire natif,
 *     pas de `canvas`).
 *
 * Les poids sont téléchargés une fois par `scripts/kyc-face-models.ts` dans
 * `models/face-api/` et exécutés sur votre propre machine / votre propre
 * conteneur. Rien ne sort du système.
 *
 * ATTENTION — frontière d'exécution : ce fichier n'est JAMAIS importé par
 * l'application (ni client, ni fonction serveur déployée sur l'edge). Il est
 * chargé exclusivement par les scripts `scripts/kyc-*-worker.ts`. Le runtime
 * edge ne peut pas exécuter ces modèles ; c'est pourquoi les contrôles
 * biométriques restent `INCONCLUSIVE` tant que le worker auto-hébergé ne les
 * a pas réellement exécutés.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FACE_ENGINE = {
  library: "@vladmandic/face-api",
  library_version: "1.7.15",
  backend: "@tensorflow/tfjs cpu",
  detector: "ssd_mobilenetv1",
  recognizer: "face_recognition_resnet34_128d",
  landmarks: "face_landmark_68",
} as const;

/**
 * Seuils de distance euclidienne entre descripteurs 128D.
 * 0.6 est le seuil publié du modèle ResNet ; Moonyp resserre la zone de
 * décision et renvoie INCONCLUSIVE dans la bande intermédiaire plutôt que de
 * trancher.
 */
export const FACE_MATCH_THRESHOLDS = {
  match: 0.45,
  mismatch: 0.6,
} as const;

/** Qualité minimale exploitable d'un visage (mesures réelles sur pixels). */
export const FACE_QUALITY_LIMITS = {
  /** Largeur du visage en pixels. */
  minWidth: 80,
  /** Part de l'image occupée par le visage. */
  minAreaRatio: 0.01,
  /** Score de détection du modèle. */
  minDetectionScore: 0.6,
  /** Variance du Laplacien (netteté) sur le cadre du visage. */
  minSharpness: 12,
  /** Luminance moyenne 0..255. */
  minBrightness: 35,
  maxBrightness: 235,
} as const;

export interface DecodedImage {
  data: Uint8Array; // RGB
  width: number;
  height: number;
  format: "jpeg" | "png";
}

/** Décodage sans dépendance native ; lève si le format n'est pas supporté. */
export function decodeImage(buffer: Uint8Array): DecodedImage {
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isPng) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PNG } = require("pngjs") as typeof import("pngjs");
    const png = PNG.sync.read(Buffer.from(buffer));
    const rgb = new Uint8Array(png.width * png.height * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
      rgb[j] = png.data[i]!;
      rgb[j + 1] = png.data[i + 1]!;
      rgb[j + 2] = png.data[i + 2]!;
    }
    return { data: rgb, width: png.width, height: png.height, format: "png" };
  }
  if (isJpeg) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jpeg = require("jpeg-js") as typeof import("jpeg-js");
    const raw = jpeg.decode(Buffer.from(buffer), { useTArray: true, formatAsRGBA: true });
    const rgb = new Uint8Array(raw.width * raw.height * 3);
    for (let i = 0, j = 0; i < raw.data.length; i += 4, j += 3) {
      rgb[j] = raw.data[i]!;
      rgb[j + 1] = raw.data[i + 1]!;
      rgb[j + 2] = raw.data[i + 2]!;
    }
    return { data: rgb, width: raw.width, height: raw.height, format: "jpeg" };
  }
  throw new Error("unsupported_image_format");
}

export interface FaceQuality {
  width: number;
  height: number;
  area_ratio: number;
  detection_score: number;
  sharpness: number;
  brightness: number;
  usable: boolean;
  reasons: string[];
}

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  descriptor: number[];
  quality: FaceQuality;
}

export interface FaceAnalysis {
  faces: DetectedFace[];
  image: { width: number; height: number; format: string };
  /** Visage exploitable retenu (le plus grand), s'il existe. */
  primary: DetectedFace | null;
  duration_ms: number;
}

type FaceApi = typeof import("@vladmandic/face-api");

/** Build sans bundle : tfjs est fourni par le projet (backend CPU pur JS). */
const FACE_API_ENTRY = "@vladmandic/face-api/dist/face-api.esm-nobundle.js";

let enginePromise: Promise<{ faceapi: FaceApi; tf: typeof import("@tensorflow/tfjs") }> | null =
  null;

export function modelsDirectory(dir?: string): string {
  return resolve(dir ?? process.env["KYC_FACE_MODELS_DIR"] ?? "models/face-api");
}

export function modelsAvailable(dir?: string): boolean {
  const base = modelsDirectory(dir);
  return [
    "ssd_mobilenetv1_model-weights_manifest.json",
    "ssd_mobilenetv1_model.bin",
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model.bin",
    "face_recognition_model-weights_manifest.json",
    "face_recognition_model.bin",
  ].every((f) => existsSync(resolve(base, f)));
}

/** Charge face-api + tfjs CPU et les poids locaux. Idempotent. */
export async function loadFaceEngine(dir?: string) {
  if (!enginePromise) {
    enginePromise = (async () => {
      const base = modelsDirectory(dir);
      if (!modelsAvailable(base)) {
        throw new Error(`face_models_missing:${base}`);
      }
      const tf = await import("@tensorflow/tfjs");
      await tf.setBackend("cpu");
      await tf.ready();
      const faceapi = (await import(/* @vite-ignore */ FACE_API_ENTRY)) as unknown as FaceApi;
      // Chargement depuis le disque local : face-api attend un `fetch`, on
      // fournit directement les buffers de poids.
      const loadFromDisk = async (
        manifest: string,
        weights: string,
        net: { loadFromWeightMap: (m: unknown) => void },
      ) => {
        const manifestJson = JSON.parse(readFileSync(resolve(base, manifest), "utf8"));
        const weightData = readFileSync(resolve(base, weights));
        const weightMap = (
          tf as unknown as {
            io: { decodeWeights: (b: ArrayBuffer, specs: unknown[]) => unknown };
          }
        ).io.decodeWeights(
          weightData.buffer.slice(
            weightData.byteOffset,
            weightData.byteOffset + weightData.byteLength,
          ) as ArrayBuffer,
          manifestJson.flatMap((g: { weights: unknown[] }) => g.weights),
        );
        net.loadFromWeightMap(weightMap);
      };
      await loadFromDisk(
        "ssd_mobilenetv1_model-weights_manifest.json",
        "ssd_mobilenetv1_model.bin",
        faceapi.nets.ssdMobilenetv1 as unknown as { loadFromWeightMap: (m: unknown) => void },
      );
      await loadFromDisk(
        "face_landmark_68_model-weights_manifest.json",
        "face_landmark_68_model.bin",
        faceapi.nets.faceLandmark68Net as unknown as { loadFromWeightMap: (m: unknown) => void },
      );
      await loadFromDisk(
        "face_recognition_model-weights_manifest.json",
        "face_recognition_model.bin",
        faceapi.nets.faceRecognitionNet as unknown as { loadFromWeightMap: (m: unknown) => void },
      );
      return { faceapi, tf };
    })();
  }
  return enginePromise;
}

/** Variance du Laplacien sur une zone (netteté réelle, pas une estimation). */
function sharpness(
  img: DecodedImage,
  box: { x: number; y: number; width: number; height: number },
): number {
  const x0 = Math.max(1, Math.floor(box.x));
  const y0 = Math.max(1, Math.floor(box.y));
  const x1 = Math.min(img.width - 2, Math.floor(box.x + box.width));
  const y1 = Math.min(img.height - 2, Math.floor(box.y + box.height));
  if (x1 <= x0 || y1 <= y0) return 0;
  const grey = (x: number, y: number) => {
    const i = (y * img.width + x) * 3;
    return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
  };
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const lap =
        4 * grey(x, y) - grey(x - 1, y) - grey(x + 1, y) - grey(x, y - 1) - grey(x, y + 1);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 100) / 100;
}

function brightness(
  img: DecodedImage,
  box: { x: number; y: number; width: number; height: number },
): number {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(img.width, Math.floor(box.x + box.width));
  const y1 = Math.min(img.height, Math.floor(box.y + box.height));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 3;
      sum += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
      n++;
    }
  }
  return n === 0 ? 0 : Math.round((sum / n) * 100) / 100;
}

function qualityOf(img: DecodedImage, box: DetectedFace["box"], score: number): FaceQuality {
  const area_ratio =
    Math.round(((box.width * box.height) / (img.width * img.height)) * 10000) / 10000;
  const sharp = sharpness(img, box);
  const bright = brightness(img, box);
  const reasons: string[] = [];
  if (box.width < FACE_QUALITY_LIMITS.minWidth) reasons.push("face_too_small");
  if (area_ratio < FACE_QUALITY_LIMITS.minAreaRatio) reasons.push("face_area_too_small");
  if (score < FACE_QUALITY_LIMITS.minDetectionScore) reasons.push("low_detection_score");
  if (sharp < FACE_QUALITY_LIMITS.minSharpness) reasons.push("face_blurred");
  if (bright < FACE_QUALITY_LIMITS.minBrightness) reasons.push("face_underexposed");
  if (bright > FACE_QUALITY_LIMITS.maxBrightness) reasons.push("face_overexposed");
  return {
    width: Math.round(box.width),
    height: Math.round(box.height),
    area_ratio,
    detection_score: Math.round(score * 1000) / 1000,
    sharpness: sharp,
    brightness: bright,
    usable: reasons.length === 0,
    reasons,
  };
}

/** Détection + repères + descripteurs sur une image encodée (JPEG/PNG). */
export async function analyzeFaces(buffer: Uint8Array, dir?: string): Promise<FaceAnalysis> {
  const started = Date.now();
  const { faceapi, tf } = await loadFaceEngine(dir);
  const img = decodeImage(buffer);
  const tensor = tf.tensor3d(img.data, [img.height, img.width, 3], "int32");
  try {
    const detections = await faceapi
      .detectAllFaces(
        tensor as unknown as Parameters<typeof faceapi.detectAllFaces>[0],
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }),
      )
      .withFaceLandmarks()
      .withFaceDescriptors();

    const faces: DetectedFace[] = detections.map((d) => {
      const box = {
        x: d.detection.box.x,
        y: d.detection.box.y,
        width: d.detection.box.width,
        height: d.detection.box.height,
      };
      return {
        box: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
        descriptor: Array.from(d.descriptor),
        quality: qualityOf(img, box, d.detection.score),
      };
    });

    const usable = faces.filter((f) => f.quality.usable);
    const primary =
      (usable.length > 0 ? usable : faces)
        .slice()
        .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0] ?? null;

    return {
      faces,
      image: { width: img.width, height: img.height, format: img.format },
      primary: primary && primary.quality.usable ? primary : null,
      duration_ms: Date.now() - started,
    };
  } finally {
    tensor.dispose();
  }
}

export type FaceMatchStatus = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface FaceMatchOutcome {
  status: FaceMatchStatus;
  /** Distance euclidienne réelle entre descripteurs, jamais inventée. */
  distance: number | null;
  threshold: number;
  reasons: string[];
  method: string;
  library: string;
  library_version: string;
  evaluated_at: string;
}

/** Distance euclidienne entre deux descripteurs 128D. */
export function descriptorDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error("descriptor_length_mismatch");
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.round(Math.sqrt(sum) * 10000) / 10000;
}

/**
 * Comparaison portrait de la pièce ↔ visage de la session de vivacité.
 * Aucune dérivation depuis un autre contrôle : sans les deux descripteurs
 * réels, le résultat est INCONCLUSIVE.
 */
export function compareFaces(
  idPortrait: { descriptor: readonly number[]; quality: FaceQuality } | null,
  liveFace: { descriptor: readonly number[]; quality: FaceQuality } | null,
  at: Date = new Date(),
): FaceMatchOutcome {
  const base = {
    threshold: FACE_MATCH_THRESHOLDS.match,
    method: "euclidean_distance_128d",
    library: FACE_ENGINE.library,
    library_version: FACE_ENGINE.library_version,
    evaluated_at: at.toISOString(),
  };
  if (!idPortrait) {
    return {
      ...base,
      status: "INCONCLUSIVE",
      distance: null,
      reasons: ["id_portrait_descriptor_missing"],
    };
  }
  if (!liveFace) {
    return {
      ...base,
      status: "INCONCLUSIVE",
      distance: null,
      reasons: ["liveness_face_descriptor_missing"],
    };
  }
  const reasons: string[] = [];
  if (!idPortrait.quality.usable)
    reasons.push(...idPortrait.quality.reasons.map((r) => `id_portrait:${r}`));
  if (!liveFace.quality.usable)
    reasons.push(...liveFace.quality.reasons.map((r) => `liveness_face:${r}`));
  const distance = descriptorDistance(idPortrait.descriptor, liveFace.descriptor);
  if (reasons.length > 0) {
    return {
      ...base,
      status: "INCONCLUSIVE",
      distance,
      reasons: [...reasons, "image_quality_insufficient"],
    };
  }
  if (distance <= FACE_MATCH_THRESHOLDS.match) {
    return { ...base, status: "PASS", distance, reasons: ["distance_below_match_threshold"] };
  }
  if (distance >= FACE_MATCH_THRESHOLDS.mismatch) {
    return { ...base, status: "FAIL", distance, reasons: ["distance_above_mismatch_threshold"] };
  }
  return { ...base, status: "INCONCLUSIVE", distance, reasons: ["distance_in_uncertainty_band"] };
}
