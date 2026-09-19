/**
 * Extraction du visage sur une capture — exécutée dans le navigateur.
 *
 * Rôle exact, et rien de plus : localiser le visage sur une image déjà prise
 * (portrait d'une pièce d'identité, ou image issue du contrôle de vivacité),
 * puis produire une imagette recadrée normalisée que le SERVEUR comparera.
 *
 * Ce module ne décide rien et ne calcule aucune similarité : il transporte des
 * pixels. Le nombre de visages détecté est transmis à titre de mesure ; il ne
 * peut que durcir la décision serveur (plusieurs visages = bloquant), jamais
 * l'assouplir. La comparaison, les seuils et le verdict sont exclusivement
 * serveur (`src/lib/kyc/face-compare.server.ts`).
 *
 * Le modèle MediaPipe s'exécute localement : aucune image n'est envoyée à un
 * tiers. Seule l'imagette du visage part vers le back-end Moonyp, sur le même
 * canal que les pièces déjà transmises.
 */

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Côté de l'imagette transmise au serveur. */
const CROP_SIZE = 192;
/** Marge ajoutée autour de la boîte des repères (front + menton). */
const CROP_MARGIN = 0.38;
/** Réduction de l'image source avant détection (performance mobile). */
const MAX_SOURCE_SIDE = 1280;

export interface FaceEvidencePayload {
  /** Imagette JPEG du visage recadré, encodée base64 (sans préfixe data:). */
  image_base64: string;
  /** Nombre de visages détectés sur l'image d'origine. */
  faces_detected: number;
  /** Côté du visage détecté, en pixels de l'image source. */
  face_size_px: number;
  engine: { name: string; version: string };
  source: "document" | "live";
}

type ImageLandmarker = {
  detect: (image: HTMLCanvasElement | ImageBitmap) => unknown;
  close: () => void;
};

let imageLandmarker: Promise<ImageLandmarker> | null = null;

/** Détecteur en mode IMAGE, distinct de celui du contrôle de vivacité (VIDEO). */
function loadImageFaceEngine(): Promise<ImageLandmarker> {
  if (!imageLandmarker) {
    imageLandmarker = (async () => {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
      const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "IMAGE",
        numFaces: 4,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      return landmarker as unknown as ImageLandmarker;
    })().catch((error) => {
      imageLandmarker = null;
      throw error;
    });
  }
  return imageLandmarker;
}

export function releaseImageFaceEngine(): void {
  const pending = imageLandmarker;
  imageLandmarker = null;
  void pending?.then((l) => l.close()).catch(() => undefined);
}

async function drawToCanvas(file: Blob): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

interface Landmark {
  x: number;
  y: number;
}

function boxOf(landmarks: Landmark[], width: number, height: number) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const w = (maxX - minX) * width;
  const h = (maxY - minY) * height;
  return {
    x: minX * width,
    y: minY * height,
    width: w,
    height: h,
    size: Math.max(w, h),
  };
}

/**
 * Extrait la preuve faciale d'une capture. Renvoie `null` si aucun visage
 * exploitable n'est trouvé ou si le moteur n'est pas disponible : l'absence de
 * preuve n'interrompt jamais le parcours, elle oriente la décision serveur.
 */
export async function extractFaceEvidence(
  file: Blob,
  source: "document" | "live",
): Promise<FaceEvidencePayload | null> {
  try {
    const canvas = await drawToCanvas(file);
    if (!canvas) return null;

    const engine = await loadImageFaceEngine();
    const raw = engine.detect(canvas) as { faceLandmarks?: Landmark[][] } | undefined;
    const faces = raw?.faceLandmarks ?? [];
    if (faces.length === 0) {
      return {
        image_base64: "",
        faces_detected: 0,
        face_size_px: 0,
        engine: { name: "mediapipe_face_landmarker", version: "1.0.1" },
        source,
      };
    }

    // Visage retenu : le plus grand — sur une pièce d'identité, le portrait
    // principal ; sur une capture de vivacité, la personne au premier plan.
    const boxes = faces.map((points) => boxOf(points, canvas.width, canvas.height));
    const best = boxes.reduce((a, b) => (b.size > a.size ? b : a));

    const margin = best.size * CROP_MARGIN;
    const side = Math.max(24, best.size + margin * 2);
    const cx = best.x + best.width / 2;
    const cy = best.y + best.height / 2;
    const sx = Math.max(0, Math.min(canvas.width - 1, cx - side / 2));
    const sy = Math.max(0, Math.min(canvas.height - 1, cy - side / 2));
    const sw = Math.min(side, canvas.width - sx);
    const sh = Math.min(side, canvas.height - sy);

    const crop = document.createElement("canvas");
    crop.width = CROP_SIZE;
    crop.height = CROP_SIZE;
    const context = crop.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, sx, sy, sw, sh, 0, 0, CROP_SIZE, CROP_SIZE);

    const dataUrl = crop.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1] ?? "";
    if (!base64) return null;

    return {
      image_base64: base64,
      faces_detected: faces.length,
      face_size_px: Math.round(best.size),
      engine: { name: "mediapipe_face_landmarker", version: "1.0.1" },
      source,
    };
  } catch {
    // Le parcours n'est jamais interrompu par l'indisponibilité du détecteur.
    return null;
  }
}
