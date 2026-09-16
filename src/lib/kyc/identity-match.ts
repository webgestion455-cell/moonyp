/**
 * Croisement des données d'identité — module pur, partagé client / serveur.
 *
 * Il compare les données déclarées par le demandeur (formulaire) avec les
 * données réellement lues sur la pièce (MRZ / OCR) et produit, champ par
 * champ, un verdict objectif : concordant, divergent ou non comparable.
 * Aucune heuristique « cosmétique » : chaque score est une distance de
 * chaînes normalisées, et chaque seuil est explicite.
 */

import type { MrzData } from "./mrz";
import { mrzExpired } from "./mrz";

export type MatchStatus = "match" | "partial" | "mismatch" | "unknown";

export interface FieldComparison {
  field:
    | "surname"
    | "given_names"
    | "birth_date"
    | "nationality"
    | "expiry_date"
    | "document_number";
  declared: string | null;
  extracted: string | null;
  similarity: number;
  status: MatchStatus;
}

export interface DeclaredIdentity {
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  nationality?: string | null;
}

export interface IdentityCrossCheck {
  fields: FieldComparison[];
  /** Score global de concordance 0..100. */
  score: number;
  /** Motifs machine (journalisés, affichés au back-office). */
  reasons: string[];
  document_expired: boolean | null;
  checksums_valid: boolean;
}

/** Retire accents, ponctuation et particules pour comparer deux noms. */
export function normaliseName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Similarité 0..1 entre deux chaînes normalisées. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/**
 * Compare deux jeux de prénoms : la MRZ ne porte parfois qu'un prénom, ou les
 * porte dans un autre ordre. Chaque prénom déclaré doit trouver un équivalent.
 */
function compareGivenNames(declared: string, extracted: string): number {
  const d = normaliseName(declared).split(" ").filter(Boolean);
  const e = normaliseName(extracted).split(" ").filter(Boolean);
  if (d.length === 0 || e.length === 0) return 0;
  const scores = d.map((token) => Math.max(...e.map((other) => similarity(token, other))));
  // Un seul prénom déclaré retrouvé sur la pièce suffit à concorder ;
  // la moyenne évite qu'un second prénom absent fasse chuter le verdict.
  return Math.max(Math.max(...scores), scores.reduce((s, v) => s + v, 0) / scores.length);
}

const NAME_MATCH = 0.9;
const NAME_PARTIAL = 0.74;

function statusFor(sim: number, declared: string | null, extracted: string | null): MatchStatus {
  if (!declared || !extracted) return "unknown";
  if (sim >= NAME_MATCH) return "match";
  if (sim >= NAME_PARTIAL) return "partial";
  return "mismatch";
}

function exactStatus(declared: string | null, extracted: string | null): FieldComparison["status"] {
  if (!declared || !extracted) return "unknown";
  return declared === extracted ? "match" : "mismatch";
}

/**
 * Croise l'identité déclarée et la MRZ lue sur la pièce.
 * Le score global pondère : nom 30, prénoms 25, naissance 30, nationalité 15.
 */
export function crossCheckIdentity(
  declared: DeclaredIdentity,
  mrz: MrzData,
  options: { at?: Date } = {},
): IdentityCrossCheck {
  const at = options.at ?? new Date();
  const fields: FieldComparison[] = [];
  const reasons: string[] = [];

  const declaredSurname = declared.last_name ? normaliseName(declared.last_name) : null;
  const extractedSurname = mrz.surname ? normaliseName(mrz.surname) : null;
  const surnameSim =
    declaredSurname && extractedSurname ? similarity(declaredSurname, extractedSurname) : 0;
  fields.push({
    field: "surname",
    declared: declaredSurname,
    extracted: extractedSurname,
    similarity: Number(surnameSim.toFixed(3)),
    status: statusFor(surnameSim, declaredSurname, extractedSurname),
  });

  const declaredGiven = declared.first_name ? normaliseName(declared.first_name) : null;
  const extractedGiven = mrz.given_names ? normaliseName(mrz.given_names) : null;
  const givenSim =
    declaredGiven && extractedGiven ? compareGivenNames(declaredGiven, extractedGiven) : 0;
  fields.push({
    field: "given_names",
    declared: declaredGiven,
    extracted: extractedGiven,
    similarity: Number(givenSim.toFixed(3)),
    status: statusFor(givenSim, declaredGiven, extractedGiven),
  });

  const declaredBirth = declared.birth_date ? declared.birth_date.slice(0, 10) : null;
  const birthStatus = exactStatus(declaredBirth, mrz.birth_date);
  fields.push({
    field: "birth_date",
    declared: declaredBirth,
    extracted: mrz.birth_date,
    similarity: birthStatus === "match" ? 1 : 0,
    status: birthStatus,
  });

  const declaredNat = declared.nationality ? declared.nationality.toUpperCase().slice(0, 3) : null;
  const extractedNat = mrz.nationality ? mrz.nationality.toUpperCase().slice(0, 3) : null;
  // ISO-2 déclaré vs ISO-3 MRZ : on compare sur le préfixe commun disponible.
  const natComparable =
    declaredNat && extractedNat ? extractedNat.startsWith(declaredNat.slice(0, 2)) : false;
  const natStatus: MatchStatus =
    !declaredNat || !extractedNat ? "unknown" : natComparable ? "match" : "partial";
  fields.push({
    field: "nationality",
    declared: declaredNat,
    extracted: extractedNat,
    similarity: natStatus === "match" ? 1 : 0,
    status: natStatus,
  });

  fields.push({
    field: "expiry_date",
    declared: null,
    extracted: mrz.expiry_date,
    similarity: mrz.expiry_date ? 1 : 0,
    status: mrz.expiry_date ? "match" : "unknown",
  });

  fields.push({
    field: "document_number",
    declared: null,
    extracted: mrz.document_number || null,
    similarity: mrz.document_number ? 1 : 0,
    status: mrz.document_number ? "match" : "unknown",
  });

  const weight = (status: MatchStatus, sim: number, points: number) => {
    if (status === "match") return points;
    if (status === "partial") return points * Math.max(0.5, sim);
    if (status === "unknown") return points * 0.4;
    return 0;
  };

  const score = Math.round(
    weight(fields[0]!.status, surnameSim, 30) +
      weight(fields[1]!.status, givenSim, 25) +
      weight(fields[2]!.status, 1, 30) +
      weight(fields[3]!.status, 1, 15),
  );

  if (fields[0]!.status === "mismatch") reasons.push("surname_mismatch");
  if (fields[1]!.status === "mismatch") reasons.push("given_names_mismatch");
  if (fields[2]!.status === "mismatch") reasons.push("birth_date_mismatch");
  if (fields[2]!.status === "unknown") reasons.push("birth_date_not_readable");
  if (fields[3]!.status === "partial") reasons.push("nationality_differs");
  if (!mrz.checksums_valid) reasons.push("mrz_checksum_failed");
  if (!mrz.document_number) reasons.push("document_number_not_readable");

  const expired = mrzExpired(mrz, at);
  if (expired === true) reasons.push("document_expired");
  if (expired === null) reasons.push("expiry_not_readable");

  return {
    fields,
    score: Math.max(0, Math.min(100, score)),
    reasons,
    document_expired: expired,
    checksums_valid: mrz.checksums_valid,
  };
}
