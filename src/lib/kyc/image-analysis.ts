/**
 * Analyse d'image temps réel pour le scan de documents d'identité.
 *
 * Tout ce qui est mesuré ici l'est réellement, image par image, à partir des
 * pixels du flux caméra : aucune animation, aucune temporisation décorative.
 * Les signaux produits sont ceux qu'utilise un parcours KYC bancaire :
 *
 *   - luminance moyenne et contraste (sous / sur-exposition) ;
 *   - netteté (variance du Laplacien) ;
 *   - reflets spéculaires (blocs brûlés) ;
 *   - détection du document par profils de gradient (Sobel) et rectangle
 *     dominant, avec mesure de rectitude des bords ;
 *   - cadrage (remplissage et centrage dans la zone de visée) ;
 *   - stabilité inter-images (le document ne doit plus bouger) ;
 *   - vraisemblance de re-photographie d'écran (moiré périodique, bandes de
 *     couleur, uniformité du rétro-éclairage).
 *
 * Ces mesures sont volontairement conservatrices : elles rejettent les prises
 * de vue inexploitables et déclenchent la capture automatique uniquement
 * lorsque tous les critères sont réunis sur plusieurs images consécutives.
 * Elles sont ensuite transmises au serveur avec la pièce (evidence de capture)
 * afin que la conformité dispose d'une trace objective.
 */

export interface DocumentRect {
  /** Coordonnées normalisées 0..1 dans l'image analysée. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameSignals {
  brightness: number;
  contrast: number;
  sharpness: number;
  glare: number;
  /** Rectangle du document détecté, ou null si aucun bord exploitable. */
  rect: DocumentRect | null;
  /** Rectitude moyenne des quatre bords détectés (0..1). */
  edgeStraightness: number;
  /** Part de la zone de visée réellement occupée par le document (0..1+). */
  fill: number;
  /** Écart du centre du document au centre de la visée (0 = parfait). */
  offCenter: number;
  /** Vraisemblance d'une présentation d'écran / photo d'écran (0..1). */
  screenLikelihood: number;
}

export type SignalIssue =
  | "no_document"
  | "too_far"
  | "too_close"
  | "off_center"
  | "skewed"
  | "dark"
  | "bright"
  | "blurry"
  | "glare"
  | "screen"
  | "unstable";

export interface FrameVerdict {
  signals: FrameSignals;
  /** Toutes les conditions objectives sont réunies sur cette image. */
  ok: boolean;
  /** Problème prioritaire à afficher au porteur du document. */
  issue: SignalIssue | null;
  /** Score global 0..100, journalisé comme preuve de capture. */
  score: number;
}

export interface AnalysisThresholds {
  minBrightness: number;
  maxBrightness: number;
  minContrast: number;
  minSharpness: number;
  maxGlare: number;
  minFill: number;
  maxFill: number;
  maxOffCenter: number;
  minStraightness: number;
  maxScreenLikelihood: number;
}

/** Seuils d'un scan de pièce d'identité tenue à la main devant la caméra. */
export const ID_THRESHOLDS: AnalysisThresholds = {
  minBrightness: 62,
  maxBrightness: 218,
  minContrast: 24,
  minSharpness: 55,
  maxGlare: 0.035,
  minFill: 0.55,
  maxFill: 1.08,
  maxOffCenter: 0.14,
  minStraightness: 0.45,
  maxScreenLikelihood: 0.62,
};

/** Seuils assouplis pour un justificatif A4 posé à plat (facture, relevé). */
export const PAPER_THRESHOLDS: AnalysisThresholds = {
  ...ID_THRESHOLDS,
  minSharpness: 40,
  minContrast: 18,
  minFill: 0.42,
  maxOffCenter: 0.2,
  minStraightness: 0.35,
  maxScreenLikelihood: 0.9,
};

const ANALYSIS_WIDTH = 256;

interface Grey {
  data: Float32Array;
  width: number;
  height: number;
}

function toGrey(image: ImageData): { grey: Grey; brightness: number; contrast: number; glare: number; banding: number } {
  const { width: sw, height: sh, data } = image;
  const scale = Math.max(1, Math.round(sw / ANALYSIS_WIDTH));
  const width = Math.max(2, Math.floor(sw / scale));
  const height = Math.max(2, Math.floor(sh / scale));
  const grey = new Float32Array(width * height);

  let sum = 0;
  let sumSq = 0;
  let blown = 0;
  let bandingHits = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = ((y * scale) * sw + x * scale) * 4;
      const r = data[si]!;
      const g = data[si + 1]!;
      const b = data[si + 2]!;
      const v = 0.299 * r + 0.587 * g + 0.114 * b;
      grey[y * width + x] = v;
      sum += v;
      sumSq += v * v;
      if (v > 246 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) blown += 1;
      // Un rendu d'écran produit beaucoup de triplets RGB strictement égaux
      // (quantification 8 bits sur une dalle) ; le papier réel presque jamais.
      if (r === g && g === b && r > 24 && r < 240) bandingHits += 1;
    }
  }

  const n = width * height;
  const brightness = sum / n;
  const contrast = Math.sqrt(Math.max(0, sumSq / n - brightness * brightness));

  return {
    grey: { data: grey, width, height },
    brightness,
    contrast,
    glare: blown / n,
    banding: bandingHits / n,
  };
}

function laplacianVariance(grey: Grey): number {
  const { data, width: w, height: h } = grey;
  let mean = 0;
  let count = 0;
  const values = new Float32Array(Math.max(1, (w - 2) * (h - 2)));
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const v =
        4 * data[y * w + x]! -
        data[(y - 1) * w + x]! -
        data[(y + 1) * w + x]! -
        data[y * w + x - 1]! -
        data[y * w + x + 1]!;
      values[count] = v;
      mean += v;
      count += 1;
    }
  }
  if (count === 0) return 0;
  mean /= count;
  let variance = 0;
  for (let i = 0; i < count; i += 1) variance += (values[i]! - mean) ** 2;
  return variance / count;
}

interface Gradients {
  gx: Float32Array;
  gy: Float32Array;
  width: number;
  height: number;
}

function sobel(grey: Grey): Gradients {
  const { data, width: w, height: h } = grey;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const tl = data[(y - 1) * w + x - 1]!;
      const tc = data[(y - 1) * w + x]!;
      const tr = data[(y - 1) * w + x + 1]!;
      const ml = data[y * w + x - 1]!;
      const mr = data[y * w + x + 1]!;
      const bl = data[(y + 1) * w + x - 1]!;
      const bc = data[(y + 1) * w + x]!;
      const br = data[(y + 1) * w + x + 1]!;
      gx[y * w + x] = Math.abs(tr + 2 * mr + br - (tl + 2 * ml + bl));
      gy[y * w + x] = Math.abs(bl + 2 * bc + br - (tl + 2 * tc + tr));
    }
  }
  return { gx, gy, width: w, height: h };
}

/** Recherche d'un maximum de profil dans une bande, en évitant le bord exact. */
function bestLine(profile: Float32Array, from: number, to: number): { index: number; value: number } {
  let index = -1;
  let value = 0;
  for (let i = from; i < to; i += 1) {
    const v = profile[i] ?? 0;
    if (v > value) {
      value = v;
      index = i;
    }
  }
  return { index, value };
}

/**
 * Détection du rectangle dominant du document par profils de gradient.
 *
 * Un document tenu devant l'objectif produit deux maxima horizontaux (haut /
 * bas) et deux maxima verticaux (gauche / droite) très supérieurs au fond.
 * On les cherche dans les bandes extérieures de l'image, puis on mesure la
 * rectitude de chaque bord (proportion de colonnes/lignes où le gradient
 * culmine effectivement sur la ligne retenue), ce qui élimine les faux
 * positifs sur un fond texturé.
 */
function detectRect(g: Gradients): { rect: DocumentRect | null; straightness: number } {
  const { gx, gy, width: w, height: h } = g;

  const rowProfile = new Float32Array(h);
  const colProfile = new Float32Array(w);
  for (let y = 1; y < h - 1; y += 1) {
    let s = 0;
    for (let x = 1; x < w - 1; x += 1) s += gy[y * w + x]!;
    rowProfile[y] = s / w;
  }
  for (let x = 1; x < w - 1; x += 1) {
    let s = 0;
    for (let y = 1; y < h - 1; y += 1) s += gx[y * w + x]!;
    colProfile[x] = s / h;
  }

  const top = bestLine(rowProfile, 2, Math.floor(h * 0.45));
  const bottom = bestLine(rowProfile, Math.ceil(h * 0.55), h - 2);
  const left = bestLine(colProfile, 2, Math.floor(w * 0.45));
  const right = bestLine(colProfile, Math.ceil(w * 0.55), w - 2);

  if (top.index < 0 || bottom.index < 0 || left.index < 0 || right.index < 0) {
    return { rect: null, straightness: 0 };
  }

  // Niveau de fond : médiane approchée des profils.
  const rowSorted = Array.from(rowProfile).sort((a, b) => a - b);
  const colSorted = Array.from(colProfile).sort((a, b) => a - b);
  const rowBase = rowSorted[Math.floor(rowSorted.length / 2)] || 1;
  const colBase = colSorted[Math.floor(colSorted.length / 2)] || 1;

  const contrastRatio =
    Math.min(top.value, bottom.value) / Math.max(rowBase, 0.5) +
    Math.min(left.value, right.value) / Math.max(colBase, 0.5);
  if (contrastRatio < 3.2) return { rect: null, straightness: 0 };

  const straightOf = (
    lineIndex: number,
    axis: "row" | "col",
  ): number => {
    let hits = 0;
    let total = 0;
    if (axis === "row") {
      for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.85); x += 1) {
        let best = 0;
        let bestY = lineIndex;
        for (let dy = -3; dy <= 3; dy += 1) {
          const y = lineIndex + dy;
          if (y < 1 || y > h - 2) continue;
          const v = gy[y * w + x]!;
          if (v > best) {
            best = v;
            bestY = y;
          }
        }
        total += 1;
        if (best > rowBase * 1.8 && Math.abs(bestY - lineIndex) <= 2) hits += 1;
      }
    } else {
      for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y += 1) {
        let best = 0;
        let bestX = lineIndex;
        for (let dx = -3; dx <= 3; dx += 1) {
          const x = lineIndex + dx;
          if (x < 1 || x > w - 2) continue;
          const v = gx[y * w + x]!;
          if (v > best) {
            best = v;
            bestX = x;
          }
        }
        total += 1;
        if (best > colBase * 1.8 && Math.abs(bestX - lineIndex) <= 2) hits += 1;
      }
    }
    return total === 0 ? 0 : hits / total;
  };

  const straightness =
    (straightOf(top.index, "row") +
      straightOf(bottom.index, "row") +
      straightOf(left.index, "col") +
      straightOf(right.index, "col")) /
    4;

  const rect: DocumentRect = {
    x: left.index / w,
    y: top.index / h,
    width: (right.index - left.index) / w,
    height: (bottom.index - top.index) / h,
  };
  if (rect.width <= 0.05 || rect.height <= 0.05) return { rect: null, straightness: 0 };
  return { rect, straightness };
}

/**
 * Vraisemblance d'une re-photographie d'écran.
 *
 * Trois indices cumulés, tous mesurés sur l'image :
 *   1. moiré : périodicité forte du signal haute fréquence (autocorrélation
 *      des lignes après filtrage passe-haut) ;
 *   2. quantification : proportion anormale de pixels gris purs (r=g=b) ;
 *   3. rétro-éclairage : luminance très homogène par blocs avec un bord
 *      lumineux marqué.
 */
function screenLikelihood(grey: Grey, banding: number): number {
  const { data, width: w, height: h } = grey;
  const lags = 10;
  const corr = new Float64Array(lags + 1);
  let rows = 0;
  for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y += 2) {
    const hp = new Float32Array(w);
    for (let x = 1; x < w - 1; x += 1) {
      hp[x] = data[y * w + x]! - (data[y * w + x - 1]! + data[y * w + x + 1]!) / 2;
    }
    let energy = 0;
    for (let x = 1; x < w - 1; x += 1) energy += hp[x]! * hp[x]!;
    if (energy < 1) continue;
    for (let lag = 2; lag <= lags; lag += 1) {
      let acc = 0;
      for (let x = 1; x < w - 1 - lag; x += 1) acc += hp[x]! * hp[x + lag]!;
      corr[lag] += acc / energy;
    }
    rows += 1;
  }

  let moire = 0;
  if (rows > 0) {
    let peak = 0;
    for (let lag = 2; lag <= lags; lag += 1) peak = Math.max(peak, corr[lag]! / rows);
    moire = Math.max(0, Math.min(1, (peak - 0.12) / 0.35));
  }

  // Homogénéité par blocs : un écran filmé renvoie des blocs très proches.
  const bx = 8;
  const by = 8;
  const means: number[] = [];
  for (let j = 0; j < by; j += 1) {
    for (let i = 0; i < bx; i += 1) {
      let s = 0;
      let c = 0;
      for (let y = Math.floor((j * h) / by); y < Math.floor(((j + 1) * h) / by); y += 2) {
        for (let x = Math.floor((i * w) / bx); x < Math.floor(((i + 1) * w) / bx); x += 2) {
          s += data[y * w + x]!;
          c += 1;
        }
      }
      if (c > 0) means.push(s / c);
    }
  }
  const mMean = means.reduce((a, b) => a + b, 0) / (means.length || 1);
  const mVar = means.reduce((a, b) => a + (b - mMean) ** 2, 0) / (means.length || 1);
  const flat = Math.max(0, Math.min(1, (420 - mVar) / 420));

  const quantisation = Math.max(0, Math.min(1, (banding - 0.08) / 0.4));

  return Math.max(0, Math.min(1, 0.55 * moire + 0.25 * quantisation + 0.2 * flat));
}

/**
 * Analyse complète d'une image du flux caméra.
 * `guide` décrit la zone de visée (fraction du cadre) pour juger du cadrage.
 */
export function analyseFrame(
  image: ImageData,
  options: {
    thresholds: AnalysisThresholds;
    guide?: { x: number; y: number; width: number; height: number };
  },
): FrameVerdict {
  const guide = options.guide ?? { x: 0.06, y: 0.06, width: 0.88, height: 0.88 };
  const th = options.thresholds;

  const { grey, brightness, contrast, glare, banding } = toGrey(image);
  const sharpness = laplacianVariance(grey);
  const { rect, straightness } = detectRect(sobel(grey));
  const screen = screenLikelihood(grey, banding);

  let fill = 0;
  let offCenter = 1;
  if (rect) {
    fill = (rect.width * rect.height) / (guide.width * guide.height);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    offCenter = Math.hypot(cx - (guide.x + guide.width / 2), cy - (guide.y + guide.height / 2));
  }

  const signals: FrameSignals = {
    brightness,
    contrast,
    sharpness,
    glare,
    rect,
    edgeStraightness: straightness,
    fill,
    offCenter,
    screenLikelihood: screen,
  };

  let issue: SignalIssue | null = null;
  if (!rect) issue = "no_document";
  else if (straightness < th.minStraightness) issue = "skewed";
  else if (fill < th.minFill) issue = "too_far";
  else if (fill > th.maxFill) issue = "too_close";
  else if (offCenter > th.maxOffCenter) issue = "off_center";
  else if (brightness < th.minBrightness) issue = "dark";
  else if (brightness > th.maxBrightness) issue = "bright";
  else if (glare > th.maxGlare) issue = "glare";
  else if (sharpness < th.minSharpness || contrast < th.minContrast) issue = "blurry";
  else if (screen > th.maxScreenLikelihood) issue = "screen";

  const norm = (value: number, min: number, max: number) =>
    Math.max(0, Math.min(1, (value - min) / Math.max(1e-6, max - min)));

  const score = Math.round(
    100 *
      (0.28 * norm(sharpness, th.minSharpness * 0.5, th.minSharpness * 4) +
        0.18 * norm(straightness, 0, 1) +
        0.18 * (1 - Math.min(1, Math.abs(fill - 0.8) / 0.6)) +
        0.12 * (1 - Math.min(1, offCenter / 0.4)) +
        0.12 * (1 - Math.min(1, glare / 0.12)) +
        0.12 * (1 - screen)),
  );

  return { signals, ok: issue === null, issue, score };
}

/** Écart relatif entre deux rectangles : sert à mesurer la stabilité. */
export function rectDelta(a: DocumentRect | null, b: DocumentRect | null): number {
  if (!a || !b) return 1;
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );
}

/** Preuve de capture transmise au serveur avec la pièce. */
export interface CaptureEvidence {
  method: "scan" | "upload" | "liveness";
  score?: number;
  brightness?: number;
  contrast?: number;
  sharpness?: number;
  glare?: number;
  straightness?: number;
  fill?: number;
  off_center?: number;
  screen_likelihood?: number;
  stable_frames?: number;
  analysed_frames?: number;
  duration_ms?: number;
  auto?: boolean;
  liveness_session?: string;
  device?: { width: number; height: number; facing: string };
}

export function evidenceFromVerdict(
  verdict: FrameVerdict,
  extra: Partial<CaptureEvidence>,
): CaptureEvidence {
  const s = verdict.signals;
  return {
    method: "scan",
    score: verdict.score,
    brightness: Math.round(s.brightness * 10) / 10,
    contrast: Math.round(s.contrast * 10) / 10,
    sharpness: Math.round(s.sharpness * 10) / 10,
    glare: Math.round(s.glare * 1000) / 1000,
    straightness: Math.round(s.edgeStraightness * 100) / 100,
    fill: Math.round(s.fill * 100) / 100,
    off_center: Math.round(s.offCenter * 100) / 100,
    screen_likelihood: Math.round(s.screenLikelihood * 100) / 100,
    ...extra,
  };
}
