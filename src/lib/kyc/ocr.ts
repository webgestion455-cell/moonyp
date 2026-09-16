/**
 * Lecture OCR d'une pièce d'identité — navigateur uniquement.
 *
 * Le moteur (Tesseract, WebAssembly) est chargé paresseusement, au moment où
 * le client valide réellement une capture : rien n'est téléchargé tant qu'une
 * pièce n'est pas scannée, et rien de tout cela n'entre dans le rendu serveur.
 *
 * Deux passes complémentaires :
 *   1. bande MRZ (bas de la pièce) — alphabet restreint A-Z0-9< , police OCR-B,
 *      image redressée en niveaux de gris puis binarisée ;
 *   2. zone visuelle (VIZ) — texte libre, utilisé en repli quand la MRZ est
 *      illisible (nom, date de naissance imprimés).
 *
 * Le résultat est toujours revalidé côté serveur : il n'est ici qu'un
 * accélérateur d'expérience (retour immédiat au client) et une preuve jointe.
 */

import { parseMrz, type MrzData } from "./mrz";

export interface OcrResult {
  /** Texte brut de la bande MRZ (peut être vide). */
  mrz_text: string;
  /** Texte brut de la zone visuelle (tronqué). */
  viz_text: string;
  /** MRZ décodée et vérifiée, ou null. */
  mrz: MrzData | null;
  /** Confiance moyenne du moteur sur la bande MRZ (0..100). */
  confidence: number;
  duration_ms: number;
  engine: { name: string; version: string };
}

const MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";
const MAX_VIZ_CHARS = 1200;

async function toBitmap(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(source);
  const url = URL.createObjectURL(source);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image_decode_failed"));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

interface CropOptions {
  /** Part haute de l'image à conserver (0..1). */
  top: number;
  height: number;
  /** Largeur cible en pixels (agrandissement pour l'OCR). */
  targetWidth: number;
  binarise: boolean;
}

function renderCrop(
  bitmap: ImageBitmap | HTMLImageElement,
  { top, height, targetWidth, binarise }: CropOptions,
): HTMLCanvasElement {
  const sw = "width" in bitmap ? bitmap.width : 0;
  const sh = "height" in bitmap ? bitmap.height : 0;
  const sy = Math.round(sh * top);
  const sHeight = Math.max(1, Math.round(sh * height));
  const scale = Math.min(4, Math.max(1, targetWidth / Math.max(1, sw)));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, sy, sw, sHeight, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  // Niveaux de gris + étirement de contraste (toujours), binarisation adaptative
  // simple (seuil global d'Otsu) pour la bande MRZ.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    histogram[v] = (histogram[v] ?? 0) + 1;
  }

  if (binarise) {
    const total = canvas.width * canvas.height;
    let sum = 0;
    for (let i = 0; i < 256; i += 1) sum += i * histogram[i]!;
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let threshold = 128;
    for (let i = 0; i < 256; i += 1) {
      wB += histogram[i]!;
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += i * histogram[i]!;
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) {
        best = between;
        threshold = i;
      }
    }
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i]! > threshold ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

type TesseractWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (image: unknown) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker("eng")) as unknown as TesseractWorker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** Libère le moteur OCR (fin de parcours KYC). */
export async function releaseOcrEngine(): Promise<void> {
  const current = workerPromise;
  workerPromise = null;
  if (!current) return;
  try {
    const worker = await current;
    await worker.terminate();
  } catch {
    /* le moteur n'a jamais démarré */
  }
}

/**
 * Lit une pièce d'identité capturée. Ne lève jamais : un échec renvoie un
 * résultat vide, la décision restant alors à la revue de conformité.
 */
export async function readIdentityDocument(
  file: Blob,
  options: { mrzBand?: { top: number; height: number }; viz?: boolean } = {},
): Promise<OcrResult> {
  const started = performance.now();
  const empty: OcrResult = {
    mrz_text: "",
    viz_text: "",
    mrz: null,
    confidence: 0,
    duration_ms: 0,
    engine: { name: "tesseract.js", version: "7" },
  };

  try {
    const bitmap = await toBitmap(file);
    const band = options.mrzBand ?? { top: 0.62, height: 0.38 };
    const worker = await getWorker();

    // Passe 1 — bande MRZ, alphabet contraint, segmentation par blocs de lignes.
    await worker.setParameters({
      tessedit_char_whitelist: MRZ_WHITELIST,
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "0",
    });
    const mrzCanvas = renderCrop(bitmap, { ...band, targetWidth: 1600, binarise: true });
    const mrzPass = await worker.recognize(mrzCanvas);
    let mrzText = mrzPass.data.text ?? "";
    let mrz = parseMrz(mrzText);
    let confidence = mrzPass.data.confidence ?? 0;

    // Repli : certaines cartes portent la MRZ au verso complet ; on retente
    // sur l'image entière si la première bande n'a rien donné d'exploitable.
    if (!mrz) {
      const fullCanvas = renderCrop(bitmap, {
        top: 0,
        height: 1,
        targetWidth: 1800,
        binarise: true,
      });
      const fullPass = await worker.recognize(fullCanvas);
      const fullText = fullPass.data.text ?? "";
      const fullMrz = parseMrz(fullText);
      if (fullMrz) {
        mrz = fullMrz;
        mrzText = fullText;
        confidence = fullPass.data.confidence ?? confidence;
      }
    }

    // Passe 2 — zone visuelle, uniquement si demandée (repli documentaire).
    let vizText = "";
    if (options.viz !== false) {
      await worker.setParameters({
        tessedit_char_whitelist: "",
        tessedit_pageseg_mode: "4",
        preserve_interword_spaces: "1",
      });
      const vizCanvas = renderCrop(bitmap, {
        top: 0,
        height: 0.7,
        targetWidth: 1400,
        binarise: false,
      });
      const vizPass = await worker.recognize(vizCanvas);
      vizText = (vizPass.data.text ?? "").slice(0, MAX_VIZ_CHARS);
    }

    return {
      mrz_text: mrzText.slice(0, 400),
      viz_text: vizText,
      mrz,
      confidence: Math.round(confidence),
      duration_ms: Math.round(performance.now() - started),
      engine: { name: "tesseract.js", version: "7" },
    };
  } catch {
    return { ...empty, duration_ms: Math.round(performance.now() - started) };
  }
}
