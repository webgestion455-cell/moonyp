/**
 * Extraction et rapprochement de texte OCR — module pur, sans E/S.
 *
 * Utilisé par le moteur KYC serveur pour les justificatifs (domicile, IBAN,
 * revenus) : dates multilingues, adresse, IBAN (MOD-97 via src/lib/iban.ts),
 * montants, nature du document, qualité du texte. Toutes les fonctions
 * renvoient des mesures factuelles ; aucune ne décide.
 */
import { normaliseIban, validateIban } from "@/lib/iban";

/* --------------------------------------------------------------------- */
/* Normalisation                                                          */
/* --------------------------------------------------------------------- */

/** Minuscules, sans diacritiques, ponctuation → espaces, espaces compactés. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(value: string): string[] {
  return normalizeText(value).split(" ").filter(Boolean);
}

/** Distance de Levenshtein (bornée par la longueur des chaînes). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Vrai si `needle` apparaît dans `haystackTokens`, à une faute OCR près pour les mots longs. */
export function fuzzyIncludes(haystackTokens: readonly string[], needle: string): boolean {
  const n = normalizeText(needle);
  if (!n) return false;
  if (haystackTokens.includes(n)) return true;
  const tolerance = n.length >= 8 ? 2 : n.length >= 5 ? 1 : 0;
  if (tolerance === 0) return false;
  return haystackTokens.some((t) => Math.abs(t.length - n.length) <= tolerance && levenshtein(t, n) <= tolerance);
}

/* --------------------------------------------------------------------- */
/* Dates                                                                  */
/* --------------------------------------------------------------------- */

/**
 * Noms de mois dans les 15 langues servies (bg de el en es fi fr hr hu it nl
 * pl ro sk sl), formes pleines et abrégées usuelles, normalisés.
 */
const MONTHS: Record<number, string[]> = {
  1: ["january", "jan", "janvier", "janv", "januar", "jan", "enero", "ene", "gennaio", "gen", "januari", "styczen", "stycznia", "sty", "ianuarie", "ian", "januar", "jan", "januari", "januarja", "januar", "tammikuu", "tammikuuta", "tammi", "sijecanj", "sijecnja", "sij", "januar", "januara", "yanuari", "януари", "ιανουαριος", "ιανουαριου", "ιαν"],
  2: ["february", "feb", "fevrier", "fevr", "februar", "febrero", "febbraio", "februari", "luty", "lutego", "lut", "februarie", "februara", "februarja", "helmikuu", "helmikuuta", "helmi", "veljaca", "veljace", "velj", "февруари", "φεβρουαριος", "φεβρουαριου", "φεβ"],
  3: ["march", "mar", "mars", "marz", "maerz", "marzo", "maart", "marzec", "marca", "martie", "marec", "marca", "maaliskuu", "maaliskuuta", "maalis", "ozujak", "ozujka", "ozu", "marcius", "marc", "март", "μαρτιος", "μαρτιου", "μαρ"],
  4: ["april", "apr", "avril", "avr", "abril", "abr", "aprile", "kwiecien", "kwietnia", "kwi", "aprilie", "aprila", "huhtikuu", "huhtikuuta", "huhti", "travanj", "travnja", "tra", "aprilis", "април", "απριλιος", "απριλιου", "απρ"],
  5: ["may", "mai", "mayo", "maggio", "mag", "mei", "maj", "maja", "toukokuu", "toukokuuta", "touko", "svibanj", "svibnja", "svi", "majus", "май", "μαιος", "μαιου", "μαι"],
  6: ["june", "jun", "juin", "juni", "junio", "giugno", "giu", "czerwiec", "czerwca", "cze", "iunie", "iun", "juna", "junija", "kesakuu", "kesakuuta", "kesa", "lipanj", "lipnja", "lip", "junius", "юни", "ιουνιος", "ιουνιου", "ιουν"],
  7: ["july", "jul", "juillet", "juil", "juli", "julio", "luglio", "lug", "lipiec", "lipca", "iulie", "iul", "jula", "julija", "heinakuu", "heinakuuta", "heina", "srpanj", "srpnja", "srp", "julius", "юли", "ιουλιος", "ιουλιου", "ιουλ"],
  8: ["august", "aug", "aout", "agosto", "ago", "augustus", "sierpien", "sierpnia", "sie", "augusta", "avgust", "avgusta", "elokuu", "elokuuta", "elo", "kolovoz", "kolovoza", "kol", "augusztus", "август", "αυγουστος", "αυγουστου", "αυγ"],
  9: ["september", "sep", "sept", "septembre", "septiembre", "settembre", "set", "wrzesien", "wrzesnia", "wrz", "septembrie", "septembra", "syyskuu", "syyskuuta", "syys", "rujan", "rujna", "ruj", "szeptember", "септември", "σεπτεμβριος", "σεπτεμβριου", "σεπ"],
  10: ["october", "oct", "octobre", "oktober", "okt", "octubre", "ottobre", "ott", "pazdziernik", "pazdziernika", "paz", "octombrie", "oktobra", "lokakuu", "lokakuuta", "loka", "listopad", "listopada", "lis", "oktober", "октомври", "οκτωβριος", "οκτωβριου", "οκτ"],
  11: ["november", "nov", "novembre", "noviembre", "listopad", "listopada", "noiembrie", "noi", "novembra", "marraskuu", "marraskuuta", "marras", "studeni", "studenog", "stu", "ноември", "νοεμβριος", "νοεμβριου", "νοε"],
  12: ["december", "dec", "decembre", "dezember", "dez", "diciembre", "dic", "dicembre", "grudzien", "grudnia", "gru", "decembrie", "decembra", "joulukuu", "joulukuuta", "joulu", "prosinac", "prosinca", "pro", "декември", "δεκεμβριος", "δεκεμβριου", "δεκ"],
};

// « listopad » vaut novembre en polonais/tchèque et octobre en croate : le
// mot seul est ambigu, on le retire du mois 10 pour ne jamais rajeunir une
// pièce par erreur (l'ambiguïté est signalée dans les détails).
MONTHS[10] = MONTHS[10]!.filter((m) => !m.startsWith("listopad"));

const MONTH_LOOKUP = new Map<string, number>();
for (const [m, names] of Object.entries(MONTHS)) for (const n of names) MONTH_LOOKUP.set(normalizeText(n), Number(m));

export interface ExtractedDate {
  iso: string;
  /** Extrait brut ayant produit la date. */
  raw: string;
  format: "dmy" | "ymd" | "textual" | "mdy_textual";
}

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Toutes les dates plausibles d'un texte OCR, dédoublonnées, ordre d'apparition. */
export function extractDates(text: string): ExtractedDate[] {
  const out: ExtractedDate[] = [];
  const seen = new Set<string>();
  const push = (d: ExtractedDate) => {
    if (seen.has(d.iso)) return;
    seen.add(d.iso);
    out.push(d);
  };

  // jj/mm/aaaa, jj.mm.aaaa, jj-mm-aaaa (année sur 4 chiffres uniquement)
  for (const m of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (validDate(y, mo, d)) push({ iso: iso(y, mo, d), raw: m[0], format: "dmy" });
  }
  // aaaa-mm-jj
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (validDate(y, mo, d)) push({ iso: iso(y, mo, d), raw: m[0], format: "ymd" });
  }
  // « 12 mars 2024 », « 12. März 2024 », « 12 martie 2024 », « 12 март 2024 »…
  for (const m of text.matchAll(/\b(\d{1,2})\.?\s+([\p{L}]{3,14})\.?,?\s+(\d{4})\b/gu)) {
    const mo = MONTH_LOOKUP.get(normalizeText(m[2]!));
    if (!mo) continue;
    const d = Number(m[1]), y = Number(m[3]);
    if (validDate(y, mo, d)) push({ iso: iso(y, mo, d), raw: m[0], format: "textual" });
  }
  // « March 12, 2024 » / « 2024. március 12. » (hongrois : année d'abord)
  for (const m of text.matchAll(/\b([\p{L}]{3,14})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gu)) {
    const mo = MONTH_LOOKUP.get(normalizeText(m[1]!));
    if (!mo) continue;
    const d = Number(m[2]), y = Number(m[3]);
    if (validDate(y, mo, d)) push({ iso: iso(y, mo, d), raw: m[0], format: "mdy_textual" });
  }
  for (const m of text.matchAll(/\b(\d{4})\.?\s+([\p{L}]{3,14})\.?\s+(\d{1,2})\b/gu)) {
    const mo = MONTH_LOOKUP.get(normalizeText(m[2]!));
    if (!mo) continue;
    const y = Number(m[1]), d = Number(m[3]);
    if (validDate(y, mo, d)) push({ iso: iso(y, mo, d), raw: m[0], format: "textual" });
  }
  // « mars 2024 » sans jour : retenu au 1er du mois (utile pour les fiches de paie)
  for (const m of text.matchAll(/\b([\p{L}]{4,14})\.?\s+(\d{4})\b/gu)) {
    const mo = MONTH_LOOKUP.get(normalizeText(m[1]!));
    if (!mo) continue;
    const y = Number(m[2]);
    if (validDate(y, mo, 1)) push({ iso: iso(y, mo, 1), raw: m[0], format: "textual" });
  }
  return out;
}

/** Mois entiers écoulés entre deux dates ISO (négatif si `later` précède `earlier`). */
export function monthsBetween(earlierIso: string, laterIso: string): number {
  const a = new Date(earlierIso), b = new Date(laterIso);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
}

/**
 * Date de référence d'un justificatif : la plus récente qui n'est pas dans
 * le futur (une date future est un signal, remonté à part).
 */
export function documentReferenceDate(text: string, nowIso: string): { date: string | null; future: string[]; all: string[] } {
  const dates = extractDates(text);
  const today = nowIso.slice(0, 10);
  const future = dates.filter((d) => d.iso > today).map((d) => d.iso);
  const past = dates.filter((d) => d.iso <= today).map((d) => d.iso).sort();
  return { date: past.length ? past[past.length - 1]! : null, future, all: dates.map((d) => d.iso) };
}

/* --------------------------------------------------------------------- */
/* Adresse                                                                */
/* --------------------------------------------------------------------- */

/** Mots de voie sans valeur discriminante, dans les langues servies. */
const STREET_STOPWORDS = new Set(
  [
    "rue", "avenue", "av", "boulevard", "bd", "bld", "chemin", "allee", "impasse", "place", "route", "quai", "cours",
    "street", "st", "road", "rd", "avenue", "ave", "lane", "ln", "drive", "dr", "way", "close", "court",
    "strasse", "str", "gasse", "weg", "platz", "allee", "ring", "damm", "ufer",
    "calle", "c", "avenida", "avda", "plaza", "paseo", "camino", "carrer",
    "via", "viale", "piazza", "corso", "vicolo", "largo",
    "straat", "laan", "weg", "plein", "gracht", "kade", "dreef",
    "ulica", "ul", "aleja", "al", "plac", "pl", "osiedle", "os",
    "strada", "str", "bulevardul", "bd", "aleea", "piata", "soseaua", "sos", "calea",
    "utca", "u", "ut", "ter", "korut", "krt", "sugarut",
    "katu", "tie", "kuja", "polku", "aukio",
    "ulica", "ul", "cesta", "trg", "put", "avenija",
    "ulica", "ul", "namestie", "nam", "cesta", "trieda",
    "ulica", "ul", "cesta", "trg", "pot",
    "ул", "улица", "бул", "булевард", "пл", "площад", "жк",
    "οδος", "λεωφορος", "λεωφ", "πλατεια",
    "no", "nr", "n", "num", "numero", "bis", "ter",
  ].map(normalizeText),
);

export interface DeclaredAddress {
  address: string;
  postal_code: string;
  city: string;
}

export interface AddressMatch {
  postal_code: boolean;
  city: boolean;
  street: boolean;
  /** Numéro de voie retrouvé (si un numéro figure dans l'adresse déclarée). */
  number: boolean | null;
  /** Fraction des tokens significatifs de la voie retrouvés. */
  street_ratio: number;
  score: number;
  matched_fields: string[];
}

export function matchAddress(text: string, declared: DeclaredAddress): AddressMatch {
  const norm = normalizeText(text);
  const toks = norm.split(" ").filter(Boolean);
  const compact = norm.replace(/\s+/g, "");

  const postal = normalizeText(declared.postal_code).replace(/\s+/g, "");
  const postalOk = postal.length >= 3 && compact.includes(postal);

  const cityTokens = tokens(declared.city).filter((t) => t.length >= 2);
  const cityOk = cityTokens.length > 0 && cityTokens.every((t) => fuzzyIncludes(toks, t));

  const streetTokensAll = tokens(declared.address);
  const numberToken = streetTokensAll.find((t) => /^\d{1,5}[a-z]?$/.test(t)) ?? null;
  const streetTokens = streetTokensAll.filter((t) => !STREET_STOPWORDS.has(t) && !/^\d+[a-z]?$/.test(t) && t.length >= 3);
  const found = streetTokens.filter((t) => fuzzyIncludes(toks, t));
  const streetRatio = streetTokens.length ? found.length / streetTokens.length : 0;
  const streetOk = streetTokens.length > 0 && streetRatio >= (streetTokens.length === 1 ? 1 : 0.6);

  const numberOk = numberToken ? toks.includes(numberToken) : null;

  const matched: string[] = [];
  if (postalOk) matched.push("postal_code");
  if (cityOk) matched.push("city");
  if (streetOk) matched.push("street");
  if (numberOk) matched.push("number");

  const score = Math.round(((postalOk ? 35 : 0) + (cityOk ? 25 : 0) + streetRatio * 30 + (numberOk ? 10 : 0)) * 100) / 100;
  return { postal_code: postalOk, city: cityOk, street: streetOk, number: numberOk, street_ratio: Math.round(streetRatio * 100) / 100, score, matched_fields: matched };
}

/* --------------------------------------------------------------------- */
/* Nom                                                                    */
/* --------------------------------------------------------------------- */

export interface NameMatch {
  last_name: boolean;
  first_name: boolean;
  matched_tokens: string[];
}

/** Présence du nom et du prénom déclarés dans un texte (tolérance OCR). */
export function matchName(text: string, firstName: string, lastName: string): NameMatch {
  const toks = tokens(text);
  const last = tokens(lastName).filter((t) => t.length >= 2);
  const first = tokens(firstName).filter((t) => t.length >= 2);
  const matched: string[] = [];
  const lastOk = last.length > 0 && last.every((t) => { const ok = fuzzyIncludes(toks, t); if (ok) matched.push(t); return ok; });
  const firstOk = first.length > 0 && first.some((t) => { const ok = fuzzyIncludes(toks, t); if (ok) matched.push(t); return ok; });
  return { last_name: lastOk, first_name: firstOk, matched_tokens: matched };
}

/* --------------------------------------------------------------------- */
/* IBAN                                                                   */
/* --------------------------------------------------------------------- */

export interface ExtractedIban {
  iban: string;
  valid: boolean;
  raw: string;
}

/** IBAN candidats d'un texte OCR ; validité MOD-97 via src/lib/iban.ts. */
export function extractIbans(text: string): ExtractedIban[] {
  const out: ExtractedIban[] = [];
  const seen = new Set<string>();
  // Les OCR confondent O/0 et I/1 dans la partie numérique : on tolère ces
  // substitutions uniquement APRÈS les deux lettres pays.
  const upper = text.toUpperCase();
  for (const m of upper.matchAll(/\b([A-Z]{2})\s?([0-9OIl]{2})((?:\s?[A-Z0-9OIl]){11,30})/g)) {
    const country = m[1]!;
    const body = (m[2]! + m[3]!).replace(/\s+/g, "").replace(/O/g, "0").replace(/[Il]/g, "1");
    const candidate = normaliseIban(country + body);
    // Coupe à la longueur du pays si connue, sinon garde tel quel.
    const check = validateIban(candidate);
    const iban = candidate;
    if (seen.has(iban)) continue;
    seen.add(iban);
    out.push({ iban, valid: check === "valid", raw: m[0]! });
  }
  return out;
}

/* --------------------------------------------------------------------- */
/* Montants                                                               */
/* --------------------------------------------------------------------- */

/** Montants monétaires plausibles (≥ 10), séparateurs européens et anglo-saxons. */
export function extractAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,3}(?:[ .\u00a0']\d{3})+|\d{2,7})(?:[.,](\d{2}))?(?!\d)/g)) {
    const intPart = m[1]!.replace(/[ .\u00a0']/g, "");
    if (!/^\d+$/.test(intPart)) continue;
    const value = Number(intPart) + (m[2] ? Number(m[2]) / 100 : 0);
    // Exclut années et codes postaux isolés (entiers 1900-2100 à 4 chiffres sans décimales)
    if (!m[2] && intPart.length === 4 && value >= 1900 && value <= 2100) continue;
    if (value >= 10 && value <= 10_000_000) out.push(Math.round(value * 100) / 100);
  }
  return out;
}

/** Montant du texte le plus proche d'une valeur attendue, avec l'écart relatif. */
export function closestAmount(amounts: readonly number[], expected: number): { amount: number; deviation: number } | null {
  if (!amounts.length || !(expected > 0)) return null;
  let best: { amount: number; deviation: number } | null = null;
  for (const a of amounts) {
    const dev = Math.abs(a - expected) / expected;
    if (!best || dev < best.deviation) best = { amount: a, deviation: Math.round(dev * 1000) / 1000 };
  }
  return best;
}

/* --------------------------------------------------------------------- */
/* Nature du document                                                     */
/* --------------------------------------------------------------------- */

export type DocumentNature =
  | "utility_bill"
  | "rent_receipt"
  | "bank_statement"
  | "bank_rib"
  | "payslip"
  | "tax_notice"
  | "pension_statement"
  | "unknown";

const NATURE_KEYWORDS: Record<Exclude<DocumentNature, "unknown">, string[]> = {
  utility_bill: ["facture", "electricite", "gaz", "eau", "internet", "telecom", "abonnement", "invoice", "electricity", "energy", "water", "rechnung", "strom", "wasser", "energie", "factura", "luz", "agua", "fattura", "energia", "factuur", "energie", "faktura", "prad", "energia", "woda", "factura", "energie", "apa", "szamla", "aram", "viz", "lasku", "sahko", "vesi", "racun", "struja", "voda", "faktura", "elektrina", "voda", "racun", "elektrika", "voda", "фактура", "ток", "вода", "λογαριασμος", "ρευμα", "νερο"],
  rent_receipt: ["quittance", "loyer", "rent receipt", "rent", "landlord", "mietbescheinigung", "miete", "vermieter", "recibo de alquiler", "alquiler", "ricevuta affitto", "affitto", "huur", "huurovereenkomst", "czynsz", "najem", "chirie", "berleti dij", "berlet", "vuokra", "najamnina", "najam", "najomne", "najemnina", "наем", "ενοικιο"],
  bank_statement: ["releve de compte", "releve bancaire", "solde", "bank statement", "statement", "balance", "kontoauszug", "saldo", "extracto bancario", "extracto", "estratto conto", "rekeningafschrift", "afschrift", "wyciag z rachunku", "wyciag", "extras de cont", "bankszamlakivonat", "szamlakivonat", "tiliote", "izvod", "vypis z uctu", "vypis", "izpisek", "извлечение", "банково извлечение", "κινηση λογαριασμου", "αντιγραφο κινησης"],
  bank_rib: ["rib", "releve d identite bancaire", "iban", "bic", "swift", "titulaire", "account holder", "kontoinhaber", "bankverbindung", "titular", "intestatario", "coordinate bancarie", "rekeninghouder", "posiadacz rachunku", "titular cont", "szamlatulajdonos", "tilinomistaja", "vlasnik racuna", "majitel uctu", "imetnik racuna", "титуляр", "δικαιουχος"],
  payslip: ["bulletin de paie", "bulletin de salaire", "fiche de paie", "salaire net", "net a payer", "payslip", "pay slip", "salary", "net pay", "gross pay", "gehaltsabrechnung", "lohnabrechnung", "nettolohn", "bruttolohn", "nomina", "salario neto", "busta paga", "cedolino", "netto", "loonstrook", "salarisspecificatie", "nettoloon", "pasek wynagrodzen", "wynagrodzenie", "netto do wyplaty", "fluturas de salariu", "salariu net", "berjegyzek", "netto ber", "palkkalaskelma", "nettopalkka", "platna lista", "neto placa", "vyplatna paska", "cista mzda", "placilna lista", "neto placa", "фиш за заплата", "нетна заплата", "εκκαθαριστικο μισθοδοσιας", "καθαρες αποδοχες"],
  tax_notice: ["avis d imposition", "avis d impot", "revenu fiscal", "tax assessment", "tax return", "steuerbescheid", "einkommensteuer", "declaracion de la renta", "irpf", "dichiarazione dei redditi", "cud", "730", "aanslag inkomstenbelasting", "belastingdienst", "pit", "urzad skarbowy", "decizie de impunere", "anaf", "adobevallas", "nav", "verotuspaatos", "verotodistus", "porezno rjesenje", "danove priznanie", "dohodnina", "furs", "данъчна декларация", "нап", "εκκαθαριστικο εφοριας", "φορολογικη δηλωση"],
  pension_statement: ["pension", "retraite", "caisse de retraite", "rente", "rentenbescheid", "pension statement", "pensione", "inps", "pensioen", "emerytura", "zus", "pensie", "nyugdij", "elake", "mirovina", "dochodok", "pokojnina", "пенсия", "συνταξη"],
};

export interface NatureGuess {
  nature: DocumentNature;
  /** Nombre de mots-clés distincts trouvés pour la nature retenue. */
  hits: number;
  /** Détail par nature (mots-clés trouvés). */
  by_nature: Partial<Record<DocumentNature, number>>;
}

export function classifyDocument(text: string): NatureGuess {
  const norm = ` ${normalizeText(text)} `;
  const by: Partial<Record<DocumentNature, number>> = {};
  for (const [nature, words] of Object.entries(NATURE_KEYWORDS) as [Exclude<DocumentNature, "unknown">, string[]][]) {
    let hits = 0;
    for (const w of new Set(words.map(normalizeText))) {
      if (w.length < 3) continue;
      if (norm.includes(` ${w} `)) hits += 1;
    }
    if (hits) by[nature] = hits;
  }
  let best: DocumentNature = "unknown";
  let bestHits = 0;
  for (const [n, h] of Object.entries(by) as [DocumentNature, number][]) {
    if (h > bestHits) { best = n; bestHits = h; }
  }
  return { nature: bestHits >= 2 ? best : "unknown", hits: bestHits, by_nature: by };
}

/** Natures acceptables par catégorie d'étape. */
export const ACCEPTED_NATURES: Record<"address" | "bank" | "income", DocumentNature[]> = {
  address: ["utility_bill", "rent_receipt", "bank_statement", "tax_notice"],
  bank: ["bank_rib", "bank_statement"],
  income: ["payslip", "tax_notice", "pension_statement", "bank_statement"],
};

/* --------------------------------------------------------------------- */
/* Qualité du texte                                                       */
/* --------------------------------------------------------------------- */

export interface TextQuality {
  chars: number;
  words: number;
  /** Part de caractères alphanumériques parmi les caractères non blancs. */
  alnum_ratio: number;
  /** Part de mots « lisibles » (≥ 3 lettres/chiffres). */
  readable_word_ratio: number;
  readable: boolean;
}

export function textQuality(text: string, minWords = 25): TextQuality {
  const compact = text.replace(/\s+/g, "");
  const chars = compact.length;
  const alnum = (compact.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const words = text.split(/\s+/).filter(Boolean);
  const readableWords = words.filter((w) => /^[\p{L}\p{N}][\p{L}\p{N}.,'’-]{1,}$/u.test(w) && (w.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3);
  const alnumRatio = chars ? alnum / chars : 0;
  const readableRatio = words.length ? readableWords.length / words.length : 0;
  return {
    chars,
    words: words.length,
    alnum_ratio: Math.round(alnumRatio * 100) / 100,
    readable_word_ratio: Math.round(readableRatio * 100) / 100,
    readable: words.length >= minWords && alnumRatio >= 0.6 && readableRatio >= 0.5,
  };
}
