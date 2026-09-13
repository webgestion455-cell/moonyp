/**
 * Traduction en lot pour les scripts d'audit i18n.
 *
 * Le service utilisé est `translate-shell` (binaire `trans`), lancé via
 * `nix run nixpkgs#translate-shell` lorsque le binaire n'est pas installé.
 * Les jetons `{{variable}}`, les montants et les noms propres protégés sont
 * remplacés par des sentinelles avant traduction puis restaurés à l'identique :
 * une traduction ne doit jamais casser une interpolation.
 */
import { execFileSync } from "node:child_process";

const PLACEHOLDER = /\{\{[^}]+\}\}/g;

let runner = null;

function resolveRunner() {
  if (runner) return runner;
  try {
    execFileSync("trans", ["-V"], { stdio: "ignore" });
    runner = { cmd: "trans", prefix: [] };
  } catch {
    runner = { cmd: "nix", prefix: ["run", "nixpkgs#translate-shell", "--"] };
  }
  return runner;
}

/** Protège les interpolations `{{var}}` derrière des sentinelles stables. */
function protect(text) {
  const tokens = [];
  const masked = text.replace(PLACEHOLDER, (match) => {
    tokens.push(match);
    return `ZQX${tokens.length - 1}ZQX`;
  });
  return { masked, tokens };
}

function restore(text, tokens) {
  let out = text;
  tokens.forEach((token, index) => {
    out = out.replace(new RegExp(`ZQX\\s*${index}\\s*ZQX`, "gi"), token);
  });
  return out;
}

/** Traduit une chaîne unique (source -> cible) en conservant la ponctuation. */
export function translateOne(text, target, source = "en") {
  if (!text || !text.trim()) return text;
  const { masked, tokens } = protect(text);
  const { cmd, prefix } = resolveRunner();
  const args = [...prefix, "-brief", "-no-warn", "-s", source, "-t", target, masked];
  const raw = execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return text;
  return restore(line, tokens).replace(/\s+([,.;:!?])/g, "$1").trim();
}

/** Traduit un dictionnaire plat `{ cle: texte }` avec journal de progression. */
export function translateMap(entries, target, source = "en", onProgress) {
  const out = {};
  const keys = Object.keys(entries);
  keys.forEach((key, index) => {
    try {
      out[key] = translateOne(entries[key], target, source);
    } catch (error) {
      out[key] = entries[key];
      console.error(`  ! ${target} ${key}: ${error.message}`);
    }
    if (onProgress) onProgress(index + 1, keys.length, key);
  });
  return out;
}
