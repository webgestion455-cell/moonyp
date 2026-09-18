/**
 * Détection du type réel d'un fichier déposé — module pur, sans E/S.
 *
 * L'extension et le `Content-Type` annoncés par le navigateur ne sont jamais
 * une preuve : le type est déduit des octets de signature (magic bytes). Un
 * fichier dont le type réel n'est pas autorisé est refusé, quel que soit son
 * nom.
 */

export type SniffedKind =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "application/pdf"
  | "unknown";

export const ACCEPTED_KINDS: readonly SniffedKind[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];

/** Taille maximale acceptée côté serveur, indépendamment du client. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** En dessous, le fichier ne peut pas porter une pièce exploitable. */
export const MIN_FILE_BYTES = 4 * 1024;

export interface SniffResult {
  kind: SniffedKind;
  accepted: boolean;
  /** Vrai si le type annoncé par le navigateur diffère du type réel. */
  declared_mismatch: boolean;
  bytes: number;
  reasons: string[];
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++)
    out += String.fromCharCode(bytes[i]!);
  return out;
}

/** Type réel d'après la signature binaire. */
export function sniffKind(bytes: Uint8Array): SniffedKind {
  if (bytes.length < 12) return "unknown";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand))
      return "image/heic";
  }
  return "unknown";
}

export function sniffFile(
  bytes: Uint8Array,
  declaredMime: string,
  declaredSize?: number,
): SniffResult {
  const kind = sniffKind(bytes);
  const reasons: string[] = [];
  const declared = (declaredMime || "").toLowerCase().split(";")[0]!.trim();
  const declared_mismatch = kind !== "unknown" && declared.length > 0 && declared !== kind;

  if (kind === "unknown") reasons.push("unrecognised_file_signature");
  else if (!ACCEPTED_KINDS.includes(kind)) reasons.push(`file_type_not_allowed:${kind}`);
  if (declared_mismatch) reasons.push(`declared_mime_mismatch:${declared}`);
  if (bytes.length > MAX_FILE_BYTES) reasons.push("file_too_large");
  if (bytes.length < MIN_FILE_BYTES) reasons.push("file_too_small");
  if (typeof declaredSize === "number" && Math.abs(declaredSize - bytes.length) > 1024)
    reasons.push("declared_size_mismatch");

  return {
    kind,
    accepted:
      kind !== "unknown" &&
      ACCEPTED_KINDS.includes(kind) &&
      bytes.length <= MAX_FILE_BYTES &&
      bytes.length >= MIN_FILE_BYTES,
    declared_mismatch,
    bytes: bytes.length,
    reasons,
  };
}

/** SHA-256 hexadécimal via WebCrypto (disponible edge, Node et navigateur). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
