/**
 * Lecture et validation de bande MRZ (Machine Readable Zone) — ICAO 9303.
 *
 * Ce module est purement déterministe : il ne fait aucun appel réseau, ne
 * dépend d'aucun DOM et est donc utilisable à l'identique dans le navigateur
 * (lecture immédiate après OCR) et sur le serveur (revalidation avant
 * décision). Les trois gabarits normalisés sont pris en charge :
 *
 *   - TD1 : carte d'identité / titre de séjour — 3 lignes de 30 caractères ;
 *   - TD2 : ancien format carte / visa long — 2 lignes de 36 caractères ;
 *   - TD3 : passeport — 2 lignes de 44 caractères.
 *
 * Chaque champ porteur d'une clé de contrôle est vérifié par la pondération
 * 7-3-1 de l'OACI. Une MRZ dont les clés ne tombent pas juste n'est jamais
 * considérée comme exploitable pour une décision automatique.
 */

export type MrzFormat = "TD1" | "TD2" | "TD3";

export interface MrzCheckResult {
  field: "document_number" | "birth_date" | "expiry_date" | "personal_number" | "composite";
  ok: boolean;
}

export interface MrzData {
  format: MrzFormat;
  /** Code document brut (P, ID, IP, I…). */
  document_code: string;
  issuing_state: string;
  document_number: string;
  surname: string;
  given_names: string;
  nationality: string;
  /** Normalisé en ISO (YYYY-MM-DD) quand la date est plausible. */
  birth_date: string | null;
  expiry_date: string | null;
  sex: "M" | "F" | "X" | null;
  optional_data: string;
  checks: MrzCheckResult[];
  /** Toutes les clés de contrôle présentes sont valides. */
  checksums_valid: boolean;
  /** Part de clés valides (0..1) — utile pour un OCR partiellement fautif. */
  checksum_ratio: number;
  /** Lignes retenues, telles que normalisées. */
  lines: string[];
}

const FILLER = "<";
const ALPHABET = /^[A-Z0-9<]+$/;

/** Corrections OCR usuelles sur une bande MRZ (police OCR-B). */
const OCR_FIXES_ALPHA: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "8": "B",
};
const OCR_FIXES_NUM: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  U: "0",
  I: "1",
  L: "1",
  Z: "2",
  S: "5",
  B: "8",
  G: "6",
};

export function normaliseMrzLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[«»‹›|]/g, FILLER)
    .replace(/[^A-Z0-9<]/g, "")
    .trim();
}

function charValue(char: string): number {
  if (char === FILLER) return 0;
  if (char >= "0" && char <= "9") return char.charCodeAt(0) - 48;
  if (char >= "A" && char <= "Z") return char.charCodeAt(0) - 55;
  return 0;
}

/** Clé de contrôle OACI (pondération cyclique 7-3-1). */
export function mrzCheckDigit(input: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) {
    sum += charValue(input[i]!) * weights[i % 3]!;
  }
  return sum % 10;
}

function digitsOnly(value: string): string {
  return value.replace(/./g, (c) => OCR_FIXES_NUM[c] ?? c);
}

function lettersOnly(value: string): string {
  return value.replace(/./g, (c) => OCR_FIXES_ALPHA[c] ?? c);
}

function verify(
  field: MrzCheckResult["field"],
  payload: string,
  digit: string,
): MrzCheckResult | null {
  if (!digit || digit === FILLER) return null;
  const expected = digitsOnly(digit);
  if (!/^[0-9]$/.test(expected)) return { field, ok: false };
  return { field, ok: mrzCheckDigit(payload) === Number(expected) };
}

/** YYMMDD → ISO, avec fenêtre de siècle : naissance passée, expiration future. */
export function mrzDate(raw: string, kind: "birth" | "expiry"): string | null {
  const value = digitsOnly(raw);
  if (!/^[0-9]{6}$/.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const currentYear = new Date().getUTCFullYear();
  const currentShort = currentYear % 100;
  let year: number;
  if (kind === "birth") {
    year = yy > currentShort ? 1900 + yy : 2000 + yy;
  } else {
    year = yy < currentShort - 30 ? 2100 + yy : 2000 + yy;
    if (year > currentYear + 60) year -= 100;
  }
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${String(year).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function splitNames(field: string): { surname: string; given_names: string } {
  const clean = lettersOnly(field.replace(/[0-9]/g, ""));
  const [surnamePart = "", givenPart = ""] = clean.split("<<");
  const tidy = (v: string) => v.replace(/</g, " ").replace(/\s+/g, " ").trim();
  return { surname: tidy(surnamePart), given_names: tidy(givenPart) };
}

function sexOf(raw: string): MrzData["sex"] {
  const c = raw.toUpperCase();
  if (c === "M") return "M";
  if (c === "F") return "F";
  return c === "<" || c === "X" ? "X" : null;
}

function finalise(
  format: MrzFormat,
  base: Omit<MrzData, "checks" | "checksums_valid" | "checksum_ratio" | "format" | "lines">,
  checks: (MrzCheckResult | null)[],
  lines: string[],
): MrzData {
  const kept = checks.filter((c): c is MrzCheckResult => c !== null);
  const valid = kept.filter((c) => c.ok).length;
  return {
    format,
    ...base,
    checks: kept,
    checksums_valid: kept.length > 0 && valid === kept.length,
    checksum_ratio: kept.length === 0 ? 0 : valid / kept.length,
    lines,
  };
}

function parseTd3(l1: string, l2: string): MrzData {
  const documentNumber = l2.slice(0, 9).replace(/</g, "");
  const birth = l2.slice(13, 19);
  const expiry = l2.slice(21, 27);
  const personal = l2.slice(28, 42);
  const composite = `${l2.slice(0, 10)}${l2.slice(13, 20)}${l2.slice(21, 43)}`;

  return finalise(
    "TD3",
    {
      document_code: l1.slice(0, 2).replace(/</g, ""),
      issuing_state: lettersOnly(l1.slice(2, 5).replace(/</g, "")),
      document_number: documentNumber,
      ...splitNames(l1.slice(5)),
      nationality: lettersOnly(l2.slice(10, 13).replace(/</g, "")),
      birth_date: mrzDate(birth, "birth"),
      expiry_date: mrzDate(expiry, "expiry"),
      sex: sexOf(l2.charAt(20)),
      optional_data: personal.replace(/</g, ""),
    },
    [
      verify("document_number", l2.slice(0, 9), l2.charAt(9)),
      verify("birth_date", birth, l2.charAt(19)),
      verify("expiry_date", expiry, l2.charAt(27)),
      verify("personal_number", personal, l2.charAt(42)),
      verify("composite", composite, l2.charAt(43)),
    ],
    [l1, l2],
  );
}

function parseTd2(l1: string, l2: string): MrzData {
  const documentNumber = l2.slice(0, 9).replace(/</g, "");
  const birth = l2.slice(13, 19);
  const expiry = l2.slice(21, 27);
  const optional = l2.slice(28, 35);
  const composite = `${l2.slice(0, 10)}${l2.slice(13, 20)}${l2.slice(21, 35)}`;

  return finalise(
    "TD2",
    {
      document_code: l1.slice(0, 2).replace(/</g, ""),
      issuing_state: lettersOnly(l1.slice(2, 5).replace(/</g, "")),
      document_number: documentNumber,
      ...splitNames(l1.slice(5)),
      nationality: lettersOnly(l2.slice(10, 13).replace(/</g, "")),
      birth_date: mrzDate(birth, "birth"),
      expiry_date: mrzDate(expiry, "expiry"),
      sex: sexOf(l2.charAt(20)),
      optional_data: optional.replace(/</g, ""),
    },
    [
      verify("document_number", l2.slice(0, 9), l2.charAt(9)),
      verify("birth_date", birth, l2.charAt(19)),
      verify("expiry_date", expiry, l2.charAt(27)),
      verify("composite", composite, l2.charAt(35)),
    ],
    [l1, l2],
  );
}

function parseTd1(l1: string, l2: string, l3: string): MrzData {
  const documentNumber = l1.slice(5, 14).replace(/</g, "");
  const birth = l2.slice(0, 6);
  const expiry = l2.slice(8, 14);
  const composite = `${l1.slice(5, 30)}${l2.slice(0, 7)}${l2.slice(8, 15)}${l2.slice(18, 29)}`;

  return finalise(
    "TD1",
    {
      document_code: l1.slice(0, 2).replace(/</g, ""),
      issuing_state: lettersOnly(l1.slice(2, 5).replace(/</g, "")),
      document_number: documentNumber,
      ...splitNames(l3),
      nationality: lettersOnly(l2.slice(15, 18).replace(/</g, "")),
      birth_date: mrzDate(birth, "birth"),
      expiry_date: mrzDate(expiry, "expiry"),
      sex: sexOf(l2.charAt(7)),
      optional_data: `${l1.slice(15, 30)}${l2.slice(18, 29)}`.replace(/</g, ""),
    },
    [
      verify("document_number", l1.slice(5, 14), l1.charAt(14)),
      verify("birth_date", birth, l2.charAt(6)),
      verify("expiry_date", expiry, l2.charAt(14)),
      verify("composite", composite, l2.charAt(29)),
    ],
    [l1, l2, l3],
  );
}

function pad(line: string, length: number): string {
  return line.length >= length ? line.slice(0, length) : line.padEnd(length, FILLER);
}

/**
 * Extrait la MRZ d'un texte OCR brut (plusieurs lignes, bruit toléré).
 * Retourne `null` si aucun gabarit exploitable n'est reconnu.
 */
export function parseMrz(rawText: string): MrzData | null {
  const candidates = rawText
    .split(/\r?\n/)
    .map(normaliseMrzLine)
    .filter((l) => l.length >= 25 && ALPHABET.test(l) && l.includes(FILLER));

  if (candidates.length === 0) return null;

  const byLength = (min: number, max: number) =>
    candidates.filter((l) => l.length >= min && l.length <= max);

  // TD3 : 2 lignes de 44 (tolérance ±2 sur un OCR imparfait).
  const td3 = byLength(42, 46);
  for (let i = 0; i + 1 < td3.length; i += 1) {
    const l1 = pad(td3[i]!, 44);
    const l2 = pad(td3[i + 1]!, 44);
    if (l1.startsWith("P")) return parseTd3(l1, l2);
  }

  // TD1 : 3 lignes de 30.
  const td1 = byLength(28, 32);
  if (td1.length >= 3) {
    return parseTd1(pad(td1[0]!, 30), pad(td1[1]!, 30), pad(td1[2]!, 30));
  }

  // TD2 : 2 lignes de 36.
  const td2 = byLength(34, 38);
  if (td2.length >= 2) return parseTd2(pad(td2[0]!, 36), pad(td2[1]!, 36));

  if (td3.length >= 2) return parseTd3(pad(td3[0]!, 44), pad(td3[1]!, 44));
  return null;
}

/** La pièce est-elle encore valide à la date donnée ? */
export function mrzExpired(
  mrz: Pick<MrzData, "expiry_date">,
  at: Date = new Date(),
): boolean | null {
  if (!mrz.expiry_date) return null;
  const expiry = Date.parse(`${mrz.expiry_date}T23:59:59Z`);
  if (!Number.isFinite(expiry)) return null;
  return expiry < at.getTime();
}
