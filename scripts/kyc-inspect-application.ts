/**
 * Lecture réelle, en base, de l'état KYC d'un dossier — miroir exact de ce que
 * le panneau admin affiche (aucun calcul, aucune donnée simulée).
 *
 * Exécution locale depuis le terminal du projet :
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     bun run scripts/kyc-inspect-application.ts CR-2026-000020
 *
 *   # ou par identifiant
 *   bun run scripts/kyc-inspect-application.ts c48e107a-704c-4f38-a585-55afb55794db
 *
 * Le script :
 *   1. lit le dossier avec EXACTEMENT les colonnes utilisées par le moteur
 *      (dont `bank_iban`, et le slug produit via `product_id`) ;
 *   2. liste la session KYC, l'état des étapes et la dernière ligne écrite
 *      pour chacun des contrôles du catalogue ;
 *   3. affiche NOT_STARTED pour un contrôle jamais exécuté — jamais « passed ».
 *
 * Toute erreur SQL est affichée telle quelle : elle n'est jamais convertie en
 * contrôle vérifié.
 */

import { createClient } from "@supabase/supabase-js";
import { CONTROL_DEFINITIONS, STEP_ORDER } from "../src/lib/kyc/controls";

const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const key =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE"] ?? undefined;

if (!url || !key) {
  console.error(
    "[kyc-inspect] SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (lecture serveur).",
  );
  process.exit(2);
}

const target = process.argv[2];
if (!target) {
  console.error("[kyc-inspect] usage : bun run scripts/kyc-inspect-application.ts <référence|uuid>");
  process.exit(2);
}

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
const db = createClient(url, key, { auth: { persistSession: false } });

function fail(step: string, message: string): never {
  console.error(`\n[kyc-inspect] ÉCHEC (${step}) : ${message}`);
  process.exit(1);
  // Inatteignable : garantit le type `never` même sans types Node.
  throw new Error(`${step}: ${message}`);
}

async function main() {
  const app = await db
    .from("loan_applications")
    .select(
      "id, reference, status, kyc_status, kyc_state, kyc_decision, kyc_decision_score, kyc_decided_at, review_required, first_name, last_name, birth_date, nationality, address, postal_code, city, country, bank_iban, bank_holder, bank_bic, monthly_income, employment_status, product_id, loan_products:product_id(slug)",
    )
    .eq(isUuid ? "id" : "reference", target)
    .maybeSingle();

  if (app.error) fail("lecture du dossier", app.error.message);
  if (!app.data) fail("lecture du dossier", `aucun dossier pour « ${target} »`);

  const row = app.data as Record<string, unknown>;
  const productRel = row["loan_products"];
  const product = Array.isArray(productRel) ? productRel[0] : productRel;

  console.log(`\nDossier ${String(row["reference"])} (${String(row["id"])})`);
  console.log(`  statut            : ${String(row["status"])}`);
  console.log(`  kyc_status        : ${String(row["kyc_status"])}`);
  console.log(`  kyc_state         : ${String(row["kyc_state"])}`);
  console.log(
    `  kyc_decision      : ${String(row["kyc_decision"] ?? "—")} (score ${String(row["kyc_decision_score"] ?? "—")}, le ${String(row["kyc_decided_at"] ?? "—")})`,
  );
  console.log(`  revue exigée      : ${String(row["review_required"])}`);
  console.log(`  produit (slug)    : ${String((product as { slug?: string } | null)?.slug ?? "—")}`);

  const iban = typeof row["bank_iban"] === "string" ? (row["bank_iban"] as string) : null;
  console.log(
    `  bank_iban         : ${iban ? `${iban.slice(0, 4)}…${iban.slice(-4)} (présent)` : "absent"}`,
  );

  for (const col of [
    "first_name",
    "last_name",
    "birth_date",
    "nationality",
    "address",
    "postal_code",
    "city",
    "country",
    "monthly_income",
    "employment_status",
  ]) {
    console.log(`  ${col.padEnd(17)} : ${row[col] === null ? "absent" : String(row[col])}`);
  }

  const session = await db
    .from("application_kyc_sessions")
    .select("id, status, current_step, created_at, updated_at")
    .eq("application_id", String(row["id"]))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (session.error) fail("lecture de la session KYC", session.error.message);
  if (!session.data) {
    console.log("\nAucune session KYC en base : tous les contrôles sont NOT_STARTED.");
    return;
  }
  const sessionId = String((session.data as { id: string }).id);
  console.log(
    `\nSession ${sessionId} — statut ${String((session.data as { status: string }).status)}`,
  );

  const steps = await db
    .from("application_kyc_steps")
    .select("step_key, status, attempt, updated_at")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: true });
  if (steps.error) fail("lecture des étapes", steps.error.message);

  console.log("\nÉtapes");
  for (const step of STEP_ORDER) {
    const rows = (steps.data ?? []).filter(
      (s) => (s as { step_key: string }).step_key === step,
    ) as { status: string; attempt: number }[];
    const last = rows[rows.length - 1];
    console.log(
      `  ${step.padEnd(10)} ${last ? `${last.status} (tentative ${last.attempt})` : "NOT_STARTED"}`,
    );
  }

  const controls = await db
    .from("application_kyc_controls")
    .select("control_key, status, executed, attempt, score, threshold, reasons, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (controls.error) fail("lecture des contrôles", controls.error.message);

  const latest = new Map<string, Record<string, unknown>>();
  for (const c of (controls.data ?? []) as Record<string, unknown>[]) {
    latest.set(String(c["control_key"]), c);
  }

  console.log(`\nContrôles (${CONTROL_DEFINITIONS.length} au catalogue)`);
  const tally: Record<string, number> = {};
  for (const def of CONTROL_DEFINITIONS.slice().sort(
    (a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step),
  )) {
    const c = latest.get(def.key);
    const status = c ? String(c["status"]) : "NOT_STARTED";
    tally[status] = (tally[status] ?? 0) + 1;
    const score = c && c["score"] !== null ? ` score=${String(c["score"])}` : "";
    const reasons =
      c && Array.isArray(c["reasons"]) && (c["reasons"] as unknown[]).length > 0
        ? ` [${(c["reasons"] as string[]).join(", ")}]`
        : "";
    console.log(`  ${def.step.padEnd(9)} ${def.key.padEnd(34)} ${status}${score}${reasons}`);
  }

  console.log("\nRécapitulatif");
  for (const [status, count] of Object.entries(tally).sort()) {
    console.log(`  ${status.padEnd(14)} ${count}`);
  }
}

main().catch((e: unknown) => fail("exécution", e instanceof Error ? e.message : String(e)));
