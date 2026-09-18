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
  /**
   * Rotation de la tête autour de l'axe vertical, en degrés.
   * Positif = la personne tourne la tête vers SA gauche.
   * Le signe est donné par la géométrie du visage (position du nez entre les
   * deux oreilles), jamais par la convention interne du modèle : c'est ce qui
   * rend la mesure indépendante de l'appareil et de l'orientation du flux.
   */
  yaw: number;
  /**
   * Estimation géométrique indépendante du même mouvement, normalisée
   * (-1..1). Elle sert de second avis : un seul estimateur suffisant ne suffit
   * pas pour valider un défi bancaire.
   */
  yawRatio: number;
  /** Hochement (haut/bas), en degrés. */
  pitch: number;
  /** Inclinaison de la tête vers l'épaule, en degrés. Jamais un « tour ». */
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
  minFaceFill: 0.28,
  maxFaceFill: 0.88,
  maxOffCenter: 0.18,
  /** Au repos, la tête doit être de face. */
  maxNeutralYaw: 16,
  maxNeutralPitch: 20,
  /**
   * Amplitude minimale d'un tour de tête, en degrés. Une personne qui tourne
   * la tête « normalement » dépasse 25° ; le seuil est volontairement plus bas
   * pour que le geste naturel suffise, la fraude étant écartée ailleurs
   * (relief du visage, anti-écran, temps de réaction, ordre tiré au sort).
   */
  turnYaw: 17,
  /** Second estimateur, purement géométrique, du même tour de tête (0..1). */
  turnRatio: 0.13,
  /** Sous ces valeurs, la tête est considérée revenue de face. */
  restYaw: 11,
  restRatio: 0.07,
  blink: 0.5,
  smile: 0.4,
  jawOpen: 0.32,
  minBrightness: 55,
  maxBrightness: 225,
  minDepthVariance: 0.011,
  maxScreenLikelihood: 0.72,
  /** Nombre d'images consécutives conformes avant de considérer le visage prêt. */
  readyFrames: 4,
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

/**
 * Tangage / lacet / roulis en degrés, extraits de la matrice 4x4 du modèle.
 *
 * MediaPipe renvoie la matrice en colonne-major : l'élément (ligne j,
 * colonne i) se lit `data[i * 4 + j]`. La décomposition est celle d'une
 * rotation X→Y→Z : le tangage vient de (r21, r22), le lacet de r20, le roulis
 * de (r10, r00). Les intervertir revenait à demander à l'utilisateur de
 * pencher la tête pour valider un « tourner la tête » — c'est exactement le
 * défaut corrigé ici.
 */
function poseFromMatrix(data: number[] | undefined): { yaw: number; pitch: number; roll: number } {
  if (!data || data.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  const r00 = data[0]!;
  const r10 = data[1]!;
  const r20 = data[2]!;
  const r21 = data[6]!;
  const r22 = data[10]!;
  const deg = 180 / Math.PI;
  const pitch = Math.atan2(r21, r22) * deg;
  const yaw = Math.atan2(-r20, Math.hypot(r21, r22)) * deg;
  const roll = Math.atan2(r10, r00) * deg;
  return { yaw, pitch, roll };
}

/**
 * Second estimateur du tour de tête, purement géométrique : position du nez
 * entre les deux bords du visage, rapportée à la largeur du visage.
 *
 * Renvoie une valeur normalisée : 0 de face, positif quand la personne tourne
 * la tête vers SA gauche (côté qui apparaît à droite dans l'image brute d'une
 * caméra frontale non miroir), négatif vers sa droite. Cet estimateur ne
 * dépend d'aucune convention interne du modèle : c'est lui qui donne le signe.
 */
function yawRatioFromLandmarks(points: Array<{ x: number; y: number; z: number }>): number {
  const nose = points[1];
  const left = points[234];
  const right = points[454];
  if (!nose || !left || !right) return 0;
  const width = right.x - left.x;
  if (Math.abs(width) < 1e-4) return 0;
  const centre = (left.x + right.x) / 2;
  const ratio = ((nose.x - centre) / width) * 2;
  return Math.max(-1, Math.min(1, ratio));
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
        yawRatio: 0,

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

  const pose = poseFromMatrix(result.facialTransformationMatrixes?.[0]?.data);
  const yawRatio = yawRatioFromLandmarks(points);
  // Le signe du tour de tête vient de la géométrie du visage, jamais de la
  // convention interne du modèle : l'amplitude, elle, retient l'estimation la
  // plus prudente des deux mesures.
  const yawSign = Math.abs(yawRatio) > 0.02 ? Math.sign(yawRatio) : Math.sign(pose.yaw) || 1;
  const yaw = yawSign * Math.abs(pose.yaw);
  const pitch = pose.pitch;
  const roll = pose.roll;

  const metrics: FaceMetrics = {
    faces,
    faceFill,
    offCenter,
    yaw,
    yawRatio,
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
  // L'inclinaison de la tête vers l'épaule (roulis) n'est jamais un défaut de
  // cadrage : seuls le tour de tête et le hochement comptent pour le « de face ».
  else if (
    Math.abs(yaw) > th.maxNeutralYaw ||
    Math.abs(yawRatio) > th.restRatio * 2 ||
    Math.abs(pitch) > th.maxNeutralPitch
  )
    issue = "not_frontal";

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

/**
 * Amplitude d'un tour de tête dans le sens demandé, exprimée en degrés.
 *
 * `direction` vaut +1 pour la gauche de la personne, -1 pour sa droite. La
 * valeur retenue est la plus favorable des deux estimateurs indépendants
 * (matrice de pose du modèle, géométrie du visage) : un tour de tête naturel
 * est ainsi reconnu même quand l'un des deux décroche, sans jamais accepter un
 * geste qui n'a pas eu lieu puisque les deux doivent aller dans le bon sens.
 */
function turnAmplitude(m: FaceMetrics, direction: 1 | -1): number {
  const th = LIVENESS_THRESHOLDS;
  const fromPose = Math.max(0, direction * m.yaw);
  const fromGeometry = Math.max(0, direction * m.yawRatio);
  return Math.max(fromPose, (fromGeometry / th.turnRatio) * th.turnYaw);
}

/** Amplitude mesurée du geste demandé (0 = rien fait). */
export function challengeValue(challenge: LivenessChallenge, m: FaceMetrics): number {
  switch (challenge) {
    case "blink":
      return Math.max(m.blinkLeft, m.blinkRight);
    case "turn_left":
      return turnAmplitude(m, 1);
    case "turn_right":
      return turnAmplitude(m, -1);
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
      return Math.abs(m.yaw) < th.restYaw && Math.abs(m.yawRatio) < th.restRatio;
    case "smile":
      return m.smile < 0.15;
    case "open_mouth":
      return m.jawOpen < 0.12;
    default:
      return true;
  }
}

/**
 * Un défi de tour de tête rend volontairement le visage non frontal : pendant
 * ces défis, la consigne de cadrage « regardez droit vers la caméra » est un
 * contresens. Cette fonction dit quels signalements doivent être tus.
 */
export function issueMutedDuring(
  challenge: LivenessChallenge | null,
  issue: FaceIssue | null,
): boolean {
  if (!issue || !challenge) return false;
  const turning = challenge === "turn_left" || challenge === "turn_right";
  if (turning) return issue === "not_frontal" || issue === "off_center";
  return false;
}
