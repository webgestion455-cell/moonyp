/**
 * Vérification statique : toute colonne sélectionnée via PostgREST dans le code
 * existe réellement dans le schéma Supabase.
 *
 * Source de vérité : `src/integrations/supabase/types.ts` (types générés depuis
 * la base Moonyp). Le script lit chaque `.from("<table>").select("<colonnes>")`
 * du dossier `src/`, décompose la liste de colonnes (alias, jointures
 * imbriquées, `count`) et signale toute colonne absente de la table réelle.
 *
 * Usage (depuis la racine du projet) :
 *   bunx tsx scripts/verify-schema-columns.ts
 *   # ou
 *   bun scripts/verify-schema-columns.ts
 *
 * Sortie : code 0 si aucune colonne inconnue, 1 sinon (utilisable en CI).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const TYPES_FILE = join(ROOT, "src/integrations/supabase/types.ts");
const SRC_DIR = join(ROOT, "src");

/* ------------------------------------------------------------------ */
/* Lecture des types générés (le fichier peut être encodé en UTF-16)   */
/* ------------------------------------------------------------------ */

function readTextFile(path: string): string {
  const buf = readFileSync(path);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf);
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buf.toString("utf8");
}

/** Colonnes réelles par table/vue, extraites des blocs `Row: { ... }`. */
function loadSchema(): Map<string, Set<string>> {
  const src = readTextFile(TYPES_FILE);
  const schema = new Map<string, Set<string>>();
  const entity = /^ {6}(\w+): \{$/gm;
  let m: RegExpExecArray | null;
  while ((m = entity.exec(src)) !== null) {
    const table = m[1]!;
    const rowStart = src.indexOf("Row: {", m.index);
    if (rowStart === -1) continue;
    const rowEnd = src.indexOf("\n        }", rowStart);
    if (rowEnd === -1) continue;
    const block = src.slice(rowStart + "Row: {".length, rowEnd);
    const cols = new Set<string>();
    for (const line of block.split("\n")) {
      const c = /^\s*([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(line);
      if (c) cols.add(c[1]!);
    }
    if (cols.size > 0) schema.set(table, cols);
  }
  return schema;
}

/* ------------------------------------------------------------------ */
/* Analyse du code source                                             */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "i18n") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".gen.ts") && p !== TYPES_FILE) {
      out.push(p);
    }
  }
  return out;
}

/** Découpe une liste de colonnes PostgREST au premier niveau. */
function splitTopLevel(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

interface Finding {
  file: string;
  line: number;
  table: string;
  column: string;
  reason: string;
}

function checkSelect(
  schema: Map<string, Set<string>>,
  table: string,
  select: string,
  file: string,
  line: number,
  findings: Finding[],
) {
  const cols = schema.get(table);
  if (!cols) return; // table inconnue des types (RPC, storage, table hors schéma public)
  for (const raw of splitTopLevel(select)) {
    let token = raw;
    // Jointure imbriquée : `relation(...)` ou `alias:relation(...)`
    const nested = /^([A-Za-z_][\w]*)\s*:?\s*([A-Za-z_][\w!.]*)?\s*\((.*)\)$/.exec(token);
    if (nested) {
      const head = nested[1]!;
      const target = (nested[2] ?? head).split("!")[0]!.split(".")[0]!;
      const childTable = schema.has(target) ? target : head;
      checkSelect(schema, childTable, nested[3] ?? "", file, line, findings);
      continue;
    }
    // Alias simple : `alias:colonne`
    if (token.includes(":")) token = token.split(":").pop()!.trim();
    token = token.replace(/::[\w ]+$/, "").trim(); // cast
    token = token.split("->")[0]!.split("->>")[0]!.trim(); // accès JSON
    if (token === "" || token === "*" || token === "count") continue;
    if (!/^[A-Za-z_][\w]*$/.test(token)) continue;
    if (!cols.has(token)) {
      findings.push({
        file,
        line,
        table,
        column: token,
        reason: `colonne absente de public.${table}`,
      });
    }
  }
}

function main() {
  const schema = loadSchema();
  if (schema.size === 0) {
    console.error("Impossible de lire le schéma depuis src/integrations/supabase/types.ts");
    process.exit(2);
  }

  const findings: Finding[] = [];
  let selects = 0;

  for (const file of walk(SRC_DIR)) {
    const text = readTextFile(file);
    const fromRe = /\.from\(\s*["'`]([A-Za-z_][\w]*)["'`]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(text)) !== null) {
      const table = m[1]!;
      // On borne la fenêtre au prochain `.from(` pour ne jamais rattacher un
      // `.select()` appartenant à une autre requête de la même fonction.
      const rest = text.slice(m.index + m[0].length);
      const nextFrom = rest.search(/\.from\(\s*["'`]/);
      const tail = nextFrom === -1 ? rest : rest.slice(0, nextFrom);
      const sel = /\.select\(\s*(["'`])([\s\S]*?)\1/.exec(tail);
      if (!sel) continue;
      const select = sel[2]!.replace(/\s+/g, " ");
      if (select.includes("${")) continue; // interpolation dynamique : non analysable
      selects += 1;
      const line = text.slice(0, m.index).split("\n").length;
      checkSelect(schema, table, select, relative(ROOT, file), line, findings);
    }
  }

  console.log(
    `Schéma : ${schema.size} tables/vues — ${selects} requêtes .select() analysées dans src/`,
  );
  if (findings.length === 0) {
    console.log("OK — aucune colonne inexistante référencée.");
    return;
  }
  console.error(`\n${findings.length} référence(s) invalide(s) :`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.table}.${f.column}  → ${f.reason}`);
  }
  process.exit(1);
}

main();
