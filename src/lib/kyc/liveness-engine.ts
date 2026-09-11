/**
 * Moteur de contrôle de vivacité (liveness) réel.
 *
 * Aucune animation, aucune temporisation décorative : chaque image du flux de
 * la caméra frontale est passée dans le détecteur de repères faciaux MediaPipe
 * (`FaceLandmarker`, 478 points + 52 blendshapes + matrice de transformation
 * faciale). Les décisions sont prises sur des mesures :
 *
 *   - présence d'un visage unique, correctement cadré et à bonne distance ;
 *   - pose de la tête (lacet / tangage / roulis) issue de la matrice de
 *     transformation renvoyée par le modèle ;
 *   - clignement réel (blendshapes `eyeBlinkLeft` / `eyeBlinkRight`) ;
 *   - sourire (`mouthSmileLeft` / `mouthSmileRight`) et ouverture de bouche
 *     (`jawOpen`) ;
 *   - relief du visage : dispersion des profondeurs (z) des repères, très
 *     faible sur une photo ou un écran plat présenté à la caméra ;
 *   - vraisemblance d'une re-photographie d'écran, mesurée par le même moteur
 *     d'analyse d'image que le scanner de documents (moiré, quantification,
 *     rétro-éclairage).
 *
 * Le résultat est une session horodatée (défis demandés, défis réussis,
 * mesures, durée) transmise au serveur, qui la revalide avant de statuer.
 */

import { PAPER_THRESHOLDS, analyseFrame } from "@/lib/kyc/image-analysis";

/* --------------------------------------------------------------------- */
/* Types                                                                  */
/* --------------------------------------------------------------------- */

export type LivenessChallenge = "blink" | "turn_left" | "turn_right" | "smile" | "open_mouth";

export type FaceIssue =
  | "no_face"
  | "multiple_faces"
  | "too_far"
  | "too_close"
  | "off_center"
  | "not_frontal"
  | "dark"
  | "bright"
  | "flat"
  | "screen";

export interface FaceMetrics {
  faces: number;
  /** Part de la hauteur du cadre occupée par le visage (0..1). */
  faceFill: number;
  /** Écart du centre du visage au centre du cadre (0 = parfait). */
  offCenter: number;
  /** Degrés. Positif = le visage regarde vers sa gauche (droite écran). */
  yaw: number;
  pitch: number;
  roll: number;
  blinkLeft: number;
  blinkRight: number;
  smile: number;
  jawOpen: number;
  /** Dispersion normalisée des profondeurs des repères (relief). */
  depthVariance: number;
  brightness: number;
  sharpness: number;
  screenLikelihood: number;
}

export interface FaceVerdict {
  metrics: FaceMetrics;
  /** Le visage est utilisable pour demander un défi. */
  ready: boolean;
  issue: FaceIssue | null;
}

export interface ChallengeResult {
  challenge: LivenessChallenge;
  /** Millisecondes écoulées depuis le début de la session. */
  at_ms: number;
  /** Durée réellement mise par la personne pour exécuter le défi. */
  reaction_ms: number;
  /** Valeur mesurée au moment de la validation (amplitude du geste). */
  value: number;
}

export interface LivenessSessionEvidence {
  method: "liveness";
  /** Identifiant de session généré côté client, rejoué dans le journal. */
  session_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  analysed_frames: number;
  /** Défis demandés, dans l'ordre. */
  requested: LivenessChallenge[];
  /** Défis réellement validés, avec leurs mesures. */
  passed: ChallengeResult[];
  /** Mesures agrégées sur la session. */
  metrics: {
    yaw_min: number;
    yaw_max: number;
    blink_peak: number;
    smile_peak: number;
    jaw_peak: number;
    depth_variance_avg: number;
    screen_likelihood_max: number;
    brightness_avg: number;
    sharpness_avg: number;
    multi_face_frames: number;
    no_face_frames: number;
  };
  device: { width: number; height: number; facing: "user" };
  engine: { name: "mediapipe/face_landmarker"; version: string };
}

/* --------------------------------------------------------------------- */
/* Seuils                                                                 */
/* --------------------------------------------------------------------- */

export const LIVENESS_THRESHOLDS = {
  minFaceFill: 0.3,
  maxFaceFill: 0.86,
  maxOffCenter: 0.16,
  /** Au repos, la tête doit être de face. */
  maxNeutralYaw: 14,
  maxNeutralPitch: 18,
  /** Amplitude minimale d'un demi-tour de tête pour valider le défi. */
  turnYaw: 22,
  blink: 0.55,
  smile: 0.42,
  jawOpen: 0.35,
  minBrightness: 55,
  maxBrightness: 225,
  minDepthVariance: 0.011,
  maxScreenLikelihood: 0.72,
  /** Nombre d'images consécutives conformes avant de considérer le visage prêt. */
  readyFrames: 5,
} as const;

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/* --------------------------------------------------------------------- */
/* Chargement du modèle                                                   */
/* --------------------------------------------------------------------- */

type Landmarker = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => unknown;
  close: () => void;
};

let landmarkerPromise: Promise<Landmarker> | null = null;

/**
 * Charge (une seule fois par onglet) le détecteur de repères faciaux.
 * Le modèle et le runtime WASM sont récupérés depuis les CDN officiels
 * MediaPipe ; tout le calcul reste ensuite local à l'appareil.
 */
export function loadFaceEngine(): Promise<Landmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
      const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      return landmarker as unknown as Landmarker;
    })().catch((error) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
}

export function releaseFaceEngine(): void {
  const pending = landmarkerPromise;
  landmarkerPromise = null;
  void pending?.then((l) => l.close()).catch(() => undefined);
}

/* --------------------------------------------------------------------- */
/* Lecture des sorties du modèle                                          */
/* --------------------------------------------------------------------- */

interface RawResult {
  faceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
  faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
  facialTransformationMatrixes?: Array<{ data: number[] }>;
}

function blend(result: RawResult, name: string): number {
  const cats = result.faceBlendshapes?.[0]?.categories ?? [];
  for (const c of cats) if (c.categoryName === name) return c.score;
  return 0;
}

/** Lacet / tangage / roulis en degrés, extraits de la matrice 4x4 du modèle. */
function poseFromMatrix(data: number[] | undefined): { yaw: number; pitch: number; roll: number } {
  if (!data || data.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  // Matrice colonne-major renvoyée par MediaPipe.
  const r00 = data[0]!;
  const r10 = data[1]!;
  const r20 = data[2]!;
  const r21 = data[6]!;
  const r22 = data[10]!;
  const deg = 180 / Math.PI;
  const pitch = Math.atan2(-r20, Math.hypot(r21, r22)) * deg;
  const yaw = Math.atan2(r10, r00) * deg;
  const roll = Math.atan2(r21, r22) * deg;
  return { yaw, pitch, roll };
}

/**
 * Relief du visage : écart-type des profondeurs des repères, rapporté à la
 * largeur du visage. Une photo imprimée ou un écran plat produit une valeur
 * très basse ; un vrai visage, nettement plus élevée.
 */
function depthVariance(points: Array<{ x: number; y: number; z: number }>): number {
  if (points.length === 0) return 0;
  let minX = 1;
  let maxX = 0;
  let sum = 0;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    sum += p.z;
  }
  const width = Math.max(1e-4, maxX - minX);
  const mean = sum / points.length;
  let variance = 0;
  for (const p of points) variance += (p.z - mean) ** 2;
  return Math.sqrt(variance / points.length) / width;
}

/* --------------------------------------------------------------------- */
/* Analyse d'une image                                                    */
/* --------------------------------------------------------------------- */

export interface FrameContext {
  /** Image réduite du flux, pour les mesures photométriques et anti-écran. */
  image?: ImageData | null;
}

export function readFace(raw: unknown, context: FrameContext = {}): FaceVerdict {
  const result = (raw ?? {}) as RawResult;
  const faces = result.faceLandmarks?.length ?? 0;
  const points = result.faceLandmarks?.[0] ?? [];

  let brightness = 128;
  let sharpness = 999;
  let screen = 0;
  if (context.image) {
    const photo = analyseFrame(context.image, { thresholds: PAPER_THRESHOLDS });
    brightness = photo.signals.brightness;
    sharpness = photo.signals.sharpness;
    screen = photo.signals.screenLikelihood;
  }

  if (faces === 0 || points.length === 0) {
    return {
      metrics: {
        faces,
        faceFill: 0,
        offCenter: 1,
        yaw: 0,
        pitch: 0,
        roll: 0,
        blinkLeft: 0,
        blinkRight: 0,
        smile: 0,
        jawOpen: 0,
        depthVariance: 0,
        brightness,
        sharpness,
        screenLikelihood: screen,
      },
      ready: false,
      issue: "no_face",
    };
  }

  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const faceFill = Math.max(0, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const offCenter = Math.hypot(cx - 0.5, cy - 0.5);

  const { yaw, pitch, roll } = poseFromMatrix(result.facialTransformationMatrixes?.[0]?.data);

  const metrics: FaceMetrics = {
    faces,
    faceFill,
    offCenter,
    yaw,
    pitch,
    roll,
    blinkLeft: blend(result, "eyeBlinkLeft"),
    blinkRight: blend(result, "eyeBlinkRight"),
    smile: (blend(result, "mouthSmileLeft") + blend(result, "mouthSmileRight")) / 2,
    jawOpen: blend(result, "jawOpen"),
    depthVariance: depthVariance(points),
    brightness,
    sharpness,
    screenLikelihood: screen,
  };

  const th = LIVENESS_THRESHOLDS;
  let issue: FaceIssue | null = null;
  if (faces > 1) issue = "multiple_faces";
  else if (faceFill < th.minFaceFill) issue = "too_far";
  else if (faceFill > th.maxFaceFill) issue = "too_close";
  else if (offCenter > th.maxOffCenter) issue = "off_center";
  else if (brightness < th.minBrightness) issue = "dark";
  else if (brightness > th.maxBrightness) issue = "bright";
  else if (metrics.depthVariance < th.minDepthVariance) issue = "flat";
  else if (screen > th.maxScreenLikelihood) issue = "screen";
  else if (Math.abs(yaw) > th.maxNeutralYaw || Math.abs(pitch) > th.maxNeutralPitch) issue = "not_frontal";

  return { metrics, ready: issue === null, issue };
}

/* --------------------------------------------------------------------- */
/* Défis                                                                  */
/* --------------------------------------------------------------------- */

const ALL_ACTIVE: LivenessChallenge[] = ["blink", "turn_left", "turn_right", "smile", "open_mouth"];

/**
 * Tirage aléatoire de la séquence de défis : elle change à chaque session,
 * ce qui rend inopérant le rejeu d'une vidéo enregistrée.
 */
export function drawChallenges(count = 3): LivenessChallenge[] {
  const pool = [...ALL_ACTIVE];
  const picked: LivenessChallenge[] = ["blink"];
  pool.splice(pool.indexOf("blink"), 1);
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}

/** Amplitude mesurée du geste demandé (0 = rien fait). */
export function challengeValue(challenge: LivenessChallenge, m: FaceMetrics): number {
  switch (challenge) {
    case "blink":
      return Math.max(m.blinkLeft, m.blinkRight);
    case "turn_left":
      return Math.max(0, -m.yaw);
    case "turn_right":
      return Math.max(0, m.yaw);
    case "smile":
      return m.smile;
    case "open_mouth":
      return m.jawOpen;
    default:
      return 0;
  }
}

export function challengeSatisfied(challenge: LivenessChallenge, m: FaceMetrics): boolean {
  const th = LIVENESS_THRESHOLDS;
  const value = challengeValue(challenge, m);
  switch (challenge) {
    case "blink":
      return value >= th.blink;
    case "turn_left":
    case "turn_right":
      return value >= th.turnYaw;
    case "smile":
      return value >= th.smile;
    case "open_mouth":
      return value >= th.jawOpen;
    default:
      return false;
  }
}

/**
 * Un défi n'est validé que si la personne est d'abord revenue au repos :
 * on exige donc la séquence « repos → geste » pour chaque défi.
 */
export function challengeAtRest(challenge: LivenessChallenge, m: FaceMetrics): boolean {
  const th = LIVENESS_THRESHOLDS;
  switch (challenge) {
    case "blink":
      return Math.max(m.blinkLeft, m.blinkRight) < 0.2;
    case "turn_left":
    case "turn_right":
      return Math.abs(m.yaw) < th.maxNeutralYaw;
    case "smile":
      return m.smile < 0.15;
    case "open_mouth":
      return m.jawOpen < 0.12;
    default:
      return true;
  }
}
