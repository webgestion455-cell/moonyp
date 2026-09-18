/**
 * Installation des poids du moteur facial auto-hébergé.
 *
 *   bun run scripts/kyc-face-models.ts
 *   bun run scripts/kyc-face-models.ts --dir models/face-api --verify
 *
 * Les poids proviennent du dépôt officiel `@vladmandic/face-api` (MIT). Ils
 * sont téléchargés UNE FOIS puis exécutés localement : pendant les contrôles,
 * aucune image ne sort de l'infrastructure Moonyp, seuls ces fichiers de
 * modèle ont transité, au moment de l'installation.
 *
 * Une source alternative (miroir interne) peut être imposée via
 * KYC_FACE_MODELS_BASE_URL, par exemple un bucket privé Moonyp.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model.bin",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];

const DEFAULT_BASE =
  process.env["KYC_FACE_MODELS_BASE_URL"] ??
  "https://raw.githubusercontent.com/vladmandic/face-api/master/model";

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

async function main() {
  const dir = resolve(arg("dir", process.env["KYC_FACE_MODELS_DIR"] ?? "models/face-api")!);
  const verifyOnly = arg("verify") !== null;
  mkdirSync(dir, { recursive: true });

  let missing = 0;
  for (const file of FILES) {
    const target = resolve(dir, file);
    if (existsSync(target)) {
      const sha = createHash("sha256").update(readFileSync(target)).digest("hex").slice(0, 16);
      console.log(`ok       ${file} (sha256:${sha}…)`);
      continue;
    }
    missing++;
    if (verifyOnly) {
      console.log(`absent   ${file}`);
      continue;
    }
    const url = `${DEFAULT_BASE}/${file}`;
    process.stdout.write(`download ${file} … `);
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`échec HTTP ${res.status}`);
      console.error(
        `[kyc-face-models] téléchargement impossible : ${url}. Renseignez KYC_FACE_MODELS_BASE_URL (miroir interne) ou copiez les fichiers manuellement dans ${dir}.`,
      );
      process.exit(1);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(target, bytes);
    console.log(`${bytes.byteLength} octets`);
  }

  const { modelsAvailable } = await import("../src/lib/kyc/face-engine.node");
  const ready = modelsAvailable(dir);
  console.log(
    ready
      ? `\nMoteur facial prêt dans ${dir}. Les contrôles biométriques peuvent être réellement exécutés par scripts/kyc-face-worker.ts.`
      : `\nMoteur facial INCOMPLET dans ${dir} (${missing} fichier(s) manquant(s)). Les contrôles biométriques resteront NOT_VERIFIED / INCONCLUSIVE — aucun résultat ne sera simulé.`,
  );
  process.exit(ready ? 0 : 1);
}

void main();
