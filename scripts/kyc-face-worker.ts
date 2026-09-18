/**
 * Worker facial interne Moonyp.
 *
 *   bun run scripts/kyc-face-worker.ts --once
 *   bun run scripts/kyc-face-worker.ts --interval 5 --limit 5
 *
 * Variables requises (infrastructure Moonyp uniquement) :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   KYC_FACE_MODELS_DIR (défaut : models/face-api)
 *
 * Les poids sont installés au préalable :
 *   bun run scripts/kyc-face-models.ts
 *
 * Aucune image, aucun descripteur, aucune donnée biométrique n'est envoyée à
 * un tiers : lecture du stockage privé Moonyp, calcul local CPU, écriture en
 * base Moonyp. Les journaux ci-dessous ne contiennent que des identifiants
 * techniques et des métriques (nombre de visages, distance, motifs).
 */

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  return value && !value.startsWith("--") ? value : "true";
}

async function main() {
  const once = arg("once") !== null;
  const limit = Number(arg("limit", "5"));
  const intervalSeconds = Number(arg("interval", "5"));

  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[key]) {
      console.error(
        `[kyc-face-worker] ${key} absent. Le worker s'exécute sur l'infrastructure Moonyp avec la clé service_role ; il ne peut pas tourner sans.`,
      );
      process.exit(2);
    }
  }

  const { modelsAvailable, modelsDirectory, FACE_ENGINE } =
    await import("../src/lib/kyc/face-engine.node");
  if (!modelsAvailable()) {
    console.error(
      `[kyc-face-worker] poids absents dans ${modelsDirectory()} — exécutez : bun run scripts/kyc-face-models.ts`,
    );
    process.exit(3);
  }
  console.log(
    `[kyc-face-worker] moteur ${FACE_ENGINE.library}@${FACE_ENGINE.library_version} (${FACE_ENGINE.backend}), poids ${modelsDirectory()}`,
  );

  const { processPendingFaceJobs } = await import("../src/lib/kyc/face-worker.server");

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  do {
    let outcomes: Awaited<ReturnType<typeof processPendingFaceJobs>> = [];
    try {
      outcomes = await processPendingFaceJobs(limit);
    } catch (err) {
      console.error("[kyc-face-worker] erreur de file :", err instanceof Error ? err.message : err);
    }
    for (const o of outcomes) {
      console.log(
        `[kyc-face-worker] ${o.kind} ${o.job_id} → ${o.status} ${JSON.stringify(o.summary)}${
          o.controls_recorded?.length ? ` contrôles=${o.controls_recorded.join(",")}` : ""
        }${o.error ? ` erreur=${o.error}` : ""}`,
      );
    }
    if (once) break;
    if (outcomes.length === 0) await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  } while (!stopping);

  console.log("[kyc-face-worker] arrêt.");
}

void main();
