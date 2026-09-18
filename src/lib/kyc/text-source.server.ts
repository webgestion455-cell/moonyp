/**
 * Source de texte serveur pour l'analyse documentaire.
 *
 * Deux cas, traités différemment et jamais confondus :
 *
 *   1. PDF → le texte est réellement extrait ici, côté serveur, avec `unpdf`
 *      (MIT, JavaScript pur, compatible runtime edge). C'est une lecture
 *      serveur : elle ne dépend d'aucune mesure du navigateur.
 *
 *   2. Image (JPEG/PNG/WebP/HEIC) → aucune OCR ne peut s'exécuter dans le
 *      runtime edge (pas de WebAssembly Tesseract avec données de langue, pas
 *      de worker threads). Le texte du navigateur est alors conservé comme
 *      SOURCE NON AUTHENTIFIÉE : il sert à orienter les contrôles, mais tout
 *      contrôle qui en dépend reste au mieux REVIEW_REQUIRED tant que
 *      l'OCR auto-hébergée (`scripts/kyc-ocr-worker.ts`) n'a pas relu le
 *      fichier côté serveur.
 */

export type TextSource = "server_pdf_text" | "server_ocr" | "client_ocr" | "none";

export interface ExtractedText {
  text: string;
  source: TextSource;
  /** Vrai uniquement quand le texte a été produit par le serveur. */
  server_side: boolean;
  pages?: number;
  engine: string | null;
  reasons: string[];
}

/** Extraction du texte d'un PDF (couche texte réelle, pas une OCR). */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedText> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const copy = new Uint8Array(bytes);
    const pdf = await getDocumentProxy(copy);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const value = Array.isArray(text) ? text.join("\n") : String(text ?? "");
    return {
      text: value,
      source: "server_pdf_text",
      server_side: true,
      pages: totalPages,
      engine: "unpdf",
      reasons: value.trim().length === 0 ? ["pdf_without_text_layer"] : [],
    };
  } catch (error) {
    return {
      text: "",
      source: "none",
      server_side: false,
      engine: "unpdf",
      reasons: [`pdf_text_extraction_failed:${error instanceof Error ? error.name : "error"}`],
    };
  }
}

/**
 * Texte exploitable pour un fichier donné.
 * `clientText` n'est utilisé qu'en dernier recours et reste marqué comme
 * non authentifié (`server_side: false`).
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  kind: string,
  clientText: string | null,
): Promise<ExtractedText> {
  if (kind === "application/pdf") {
    const pdf = await extractPdfText(bytes);
    if (pdf.text.trim().length > 0) return pdf;
    if (clientText && clientText.trim().length > 0) {
      return {
        text: clientText,
        source: "client_ocr",
        server_side: false,
        engine: "browser",
        reasons: [...pdf.reasons, "fallback_client_text"],
      };
    }
    return pdf;
  }
  if (clientText && clientText.trim().length > 0) {
    return {
      text: clientText,
      source: "client_ocr",
      server_side: false,
      engine: "browser",
      reasons: ["server_ocr_unavailable_for_images"],
    };
  }
  return {
    text: "",
    source: "none",
    server_side: false,
    engine: null,
    reasons: ["no_text_available", "server_ocr_unavailable_for_images"],
  };
}
