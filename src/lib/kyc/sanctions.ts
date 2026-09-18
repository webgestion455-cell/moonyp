/**
 * Filtrage sanctions / PEP — moteur local Moonyp, sans fournisseur externe.
 *
 * Aucune liste n'est embarquée dans le code : les listes sont importées,
 * versionnées et horodatées en base (`kyc_screening_lists` /
 * `kyc_screening_entries`) par l'exploitant, puis confrontées ici aux noms
 * du dossier. Aucune donnée n'est envoyée à un service tiers.
 *
 * Règle absolue : sans liste chargée, le résultat est `not_verified`. Une
 * absence de correspondance exacte ne vaut jamais « personne non listée » :
 * les correspondances approchantes remontent en revue humaine.
 */

import { normaliseName, similarity } from "./identity-match";

export type ScreeningStatus = "no_match" | "possible_match" | "match_review_required";

export interface ScreeningEntry {
  id: string;
  /** Nom principal tel qu'il figure sur la liste. */
  full_name: string;
  /** Alias connus. */
  aliases?: string[];
  birth_date?: string | null;
  nationality?: string | null;
  /** `sanction` ou `pep`. */
  kind: "sanction" | "pep";
  program?: string | null;
}

export interface ScreeningCandidate {
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  nationality?: string | null;
}

export interface ScreeningHit {
  entry_id: string;
  matched_name: string;
  kind: "sanction" | "pep";
  program: string | null;
  score: number;
  birth_date_match: "match" | "mismatch" | "unknown";
  nationality_match: "match" | "mismatch" | "unknown";
}

export interface ScreeningResult {
  status: ScreeningStatus;
  hits: ScreeningHit[];
  /** Nombre d'entrées réellement comparées. */
  entries_screened: number;
  list_version: string | null;
  list_source: string | null;
  screened_at: string;
}

export const SCREENING_LIMITS = {
  /** En dessous, la correspondance n'est pas retenue comme signal. */
  minScore: 0.82,
  /** Au-dessus, la correspondance doit être revue par un humain. */
  reviewScore: 0.9,
};

function nameTokens(value: string): string[] {
  return normaliseName(value)
    .split(" ")
    .filter((t) => t.length >= 2);
}

/**
 * Similarité entre deux noms, indépendante de l'ordre des composants
 * (« DUPONT Jean » et « Jean Dupont » sont le même nom).
 */
export function compareFullNames(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let total = 0;
  const used = new Set<number>();
  for (const token of short) {
    let best = 0;
    let bestIndex = -1;
    long.forEach((other, index) => {
      if (used.has(index)) return;
      const s = similarity(token, other);
      if (s > best) {
        best = s;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) used.add(bestIndex);
    total += best;
  }
  const coverage = short.length / long.length;
  return Number(((total / short.length) * (0.7 + 0.3 * coverage)).toFixed(3));
}

/**
 * Confronte le candidat aux entrées de liste fournies.
 * `entries` vient de la base ; le moteur ne fabrique jamais d'entrée.
 */
export function screenCandidate(
  candidate: ScreeningCandidate,
  entries: ScreeningEntry[],
  list: { version: string | null; source: string | null },
  at: Date = new Date(),
): ScreeningResult {
  const full = `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim();
  const hits: ScreeningHit[] = [];

  if (full.length >= 3) {
    for (const entry of entries) {
      const names = [entry.full_name, ...(entry.aliases ?? [])].filter(Boolean);
      let best = 0;
      let bestName = entry.full_name;
      for (const name of names) {
        const score = compareFullNames(full, name);
        if (score > best) {
          best = score;
          bestName = name;
        }
      }
      if (best < SCREENING_LIMITS.minScore) continue;

      const birth_date_match: ScreeningHit["birth_date_match"] =
        !candidate.birth_date || !entry.birth_date
          ? "unknown"
          : candidate.birth_date.slice(0, 10) === entry.birth_date.slice(0, 10)
            ? "match"
            : "mismatch";
      const nationality_match: ScreeningHit["nationality_match"] =
        !candidate.nationality || !entry.nationality
          ? "unknown"
          : candidate.nationality.slice(0, 2).toUpperCase() ===
              entry.nationality.slice(0, 2).toUpperCase()
            ? "match"
            : "mismatch";

      // Une date de naissance connue et différente écarte la correspondance :
      // c'est le seul cas où un homonyme peut être levé automatiquement.
      if (birth_date_match === "mismatch") continue;

      hits.push({
        entry_id: entry.id,
        matched_name: bestName,
        kind: entry.kind,
        program: entry.program ?? null,
        score: best,
        birth_date_match,
        nationality_match,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);

  const status: ScreeningStatus =
    hits.length === 0
      ? "no_match"
      : hits.some((h) => h.score >= SCREENING_LIMITS.reviewScore)
        ? "match_review_required"
        : "possible_match";

  return {
    status,
    hits: hits.slice(0, 20),
    entries_screened: entries.length,
    list_version: list.version,
    list_source: list.source,
    screened_at: at.toISOString(),
  };
}
