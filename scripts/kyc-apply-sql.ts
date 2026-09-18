/**
 * Application d'un fichier SQL de migration sur la base Moonyp.
 *
 *   bun run scripts/kyc-apply-sql.ts supabase/migrations/0004_15_kyc_face_jobs.sql
 *   bun run scripts/kyc-apply-sql.ts --all
 *
 * Nécessite DATABASE_URL (ou SUPABASE_DB_URL) et le client `psql`.
 * Le script n'invente rien : il délègue à psql et relaie son code de sortie.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env["DATABASE_URL"] ?? process.env["SUPABASE_DB_URL"];
if (!url) {
  console.error("[apply-sql] DATABASE_URL (ou SUPABASE_DB_URL) absent.");
  process.exit(2);
}

const args = process.argv.slice(2);
const files = args.includes("--all")
  ? readdirSync(resolve("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => resolve("supabase/migrations", f))
  : args.filter((a) => a.endsWith(".sql")).map((a) => resolve(a));

if (files.length === 0) {
  console.error("[apply-sql] aucun fichier .sql indiqué.");
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`[apply-sql] introuvable : ${file}`);
    failed++;
    continue;
  }
  console.log(`\n=== ${file}`);
  const res = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}

console.log(
  failed === 0 ? `\n${files.length} fichier(s) appliqué(s).` : `\n${failed} fichier(s) en échec.`,
);
process.exit(failed === 0 ? 0 : 1);
