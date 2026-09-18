/**
 * Import d'une liste de sanctions / PEP dans la base Moonyp.
 *
 *   bun run scripts/kyc-import-screening-list.ts \
 *     --file data/eu-consolidated.csv \
 *     --source "EU FSF" --name "EU consolidated list" \
 *     --kind sanctions --version 2026-01-15
 *
 * Options :
 *   --file      fichier local CSV ou JSON (obligatoire)
 *   --source    émetteur de la liste (obligatoire)
 *   --name      libellé de la liste (défaut : --source)
 *   --kind      sanctions | pep (défaut : sanctions)
 *   --version   version/horodatage de la liste (défaut : sha256 court)
 *   --deactivate-previous   désactive les autres listes du même émetteur
 *   --dry-run   analyse le fichier sans écrire en base
 *
 * Aucune liste n'est embarquée dans le code et aucun appel n'est fait à un
 * fournisseur : l'exploitant récupère lui-même le fichier officiel, ce script
 * le lit localement, calcule son SHA-256 et l'enregistre versionné dans
 * `kyc_screening_lists` / `kyc_screening_entries`.
 *
 * Formats acceptés :
 *   - JSON : tableau d'objets, ou { entries: [...] }
 *   - CSV  : en-tête obligatoire ; colonnes reconnues (insensibles à la casse)
 *            name / full_name / primary_name, aliases / alias / also_known_as,
 *            birth_date / dob / birthdate, nationality / nationalities /
 *            citizenship, program / programme / programs, type / entry_type,
 *            id / external_id
 *   Les séparateurs multivalués sont `;` et `|`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

interface ParsedEntry {
  external_id: string | null;
  entry_type: "person" | "entity" | "unknown";
  primary_name: string;
  names: string[];
  birth_dates: string[];
  nationalities: string[];
  programs: string[];
  raw: Record<string, unknown>;
}

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

/* ------------------------------ Lecture ------------------------------- */

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function multi(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/[;|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const found = Object.keys(row).find((k) => k.toLowerCase().replace(/[\s_-]/g, "") === key);
    if (found !== undefined && row[found] !== undefined && row[found] !== "") return row[found];
  }
  return undefined;
}

export function normaliseEntry(row: Record<string, unknown>): ParsedEntry | null {
  const primary = String(pick(row, ["name", "fullname", "primaryname", "wholename"]) ?? "").trim();
  if (primary.length < 2) return null;
  const aliases = multi(pick(row, ["aliases", "alias", "alsoknownas", "aka", "names"]));
  const typeRaw = String(pick(row, ["type", "entrytype", "subjecttype"]) ?? "").toLowerCase();
  const entry_type: ParsedEntry["entry_type"] =
    typeRaw.includes("person") || typeRaw.includes("individual")
      ? "person"
      : typeRaw.includes("entity") || typeRaw.includes("organis") || typeRaw.includes("organiz")
        ? "entity"
        : "unknown";
  return {
    external_id: pick(row, ["id", "externalid", "logicalid", "reference"])
      ? String(pick(row, ["id", "externalid", "logicalid", "reference"]))
      : null,
    entry_type,
    primary_name: primary,
    names: [...new Set([primary, ...aliases])],
    birth_dates: multi(pick(row, ["birthdate", "dob", "dateofbirth", "birthdates"])),
    nationalities: multi(pick(row, ["nationality", "nationalities", "citizenship", "country"])),
    programs: multi(
      pick(row, ["program", "programme", "programs", "regulation", "sanctionprogram"]),
    ),
    raw: row,
  };
}

export function parseFile(content: string, fileName: string): ParsedEntry[] {
  const trimmed = content.trim();
  let rows: Record<string, unknown>[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const json = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(json)
      ? json
      : Array.isArray((json as { entries?: unknown[] }).entries)
        ? (json as { entries: unknown[] }).entries
        : null;
    if (!list) throw new Error(`json_shape_unsupported:${fileName}`);
    rows = list as Record<string, unknown>[];
  } else {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error(`csv_without_rows:${fileName}`);
    const header = splitCsvLine(lines[0]!);
    rows = lines.slice(1).map((line) => {
      const cells = splitCsvLine(line);
      const row: Record<string, unknown> = {};
      header.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      return row;
    });
  }
  const entries: ParsedEntry[] = [];
  for (const row of rows) {
    const entry = normaliseEntry(row);
    if (entry) entries.push(entry);
  }
  return entries;
}

/* ------------------------------ Import -------------------------------- */

async function main() {
  const file = arg("file");
  const source = arg("source");
  if (!file || !source) {
    console.error(
      "Usage : bun run scripts/kyc-import-screening-list.ts --file <chemin> --source <émetteur> [--name <libellé>] [--kind sanctions|pep] [--version <version>] [--deactivate-previous] [--dry-run]",
    );
    process.exit(2);
  }
  const kind = (arg("kind", "sanctions") ?? "sanctions") === "pep" ? "pep" : "sanctions";
  const dryRun = arg("dry-run") !== null;
  const deactivatePrevious = arg("deactivate-previous") !== null;

  const path = resolve(file);
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entries = parseFile(bytes.toString("utf8"), basename(path));
  const version = arg("version", sha256.slice(0, 12))!;
  const format = path.toLowerCase().endsWith(".json") ? "json" : "csv";

  console.log(`fichier      ${path}`);
  console.log(`sha256       ${sha256}`);
  console.log(`format       ${format}`);
  console.log(`entrées      ${entries.length}`);
  console.log(`personnes    ${entries.filter((e) => e.entry_type === "person").length}`);
  console.log(`avec date    ${entries.filter((e) => e.birth_dates.length > 0).length}`);
  console.log(
    `alias moyen  ${(entries.reduce((s, e) => s + e.names.length, 0) / Math.max(1, entries.length)).toFixed(2)}`,
  );

  if (entries.length === 0) {
    console.error("Aucune entrée exploitable : import refusé (le filtrage resterait non vérifié).");
    process.exit(1);
  }
  if (dryRun) {
    console.log("\n--dry-run : rien n'a été écrit en base.");
    return;
  }

  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[key]) {
      console.error(
        `[import] ${key} absent : l'import s'exécute sur l'infrastructure Moonyp avec la clé service_role.`,
      );
      process.exit(3);
    }
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const existing = await client
    .from("kyc_screening_lists")
    .select("id")
    .eq("source", source)
    .eq("sha256", sha256)
    .maybeSingle();
  if (existing.data) {
    console.log(`\nListe déjà importée (id ${existing.data.id}) — aucune duplication.`);
    return;
  }

  const inserted = await client
    .from("kyc_screening_lists")
    .insert({
      source,
      list_kind: kind,
      list_name: arg("name", source),
      version,
      sha256,
      entry_count: entries.length,
      format,
      active: true,
      notes: `import local ${basename(path)}`,
    } as never)
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    console.error(`[import] échec : ${inserted.error?.message ?? "insertion refusée"}`);
    process.exit(1);
  }
  const listId = (inserted.data as { id: string }).id;

  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK).map((e) => ({
      list_id: listId,
      external_id: e.external_id,
      entry_type: e.entry_type,
      primary_name: e.primary_name,
      names: e.names,
      birth_dates: e.birth_dates,
      nationalities: e.nationalities,
      programs: e.programs,
      raw: e.raw,
    }));
    const res = await client.from("kyc_screening_entries").insert(slice as never);
    if (res.error) {
      console.error(`[import] échec lot ${i}: ${res.error.message}`);
      await client
        .from("kyc_screening_lists")
        .update({ active: false } as never)
        .eq("id", listId);
      process.exit(1);
    }
    written += slice.length;
    process.stdout.write(`\rentrées écrites ${written}/${entries.length}`);
  }
  process.stdout.write("\n");

  if (deactivatePrevious) {
    await client
      .from("kyc_screening_lists")
      .update({ active: false } as never)
      .eq("source", source)
      .neq("id", listId);
    console.log("listes précédentes du même émetteur désactivées.");
  }

  console.log(
    `\nListe ${source}@${version} active : ${written} entrées. Le filtrage sanctions/PEP est désormais réellement exécuté ; sans liste active il resterait NOT_VERIFIED.`,
  );
}

if (process.argv[1] && process.argv[1].includes("kyc-import-screening-list")) void main();
