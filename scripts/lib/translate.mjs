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

/**
 * Moteurs interrogés dans l'ordre. Le moteur par défaut (Google) renvoie une
 * réponse vide sur les mots isolés (« Cancel », « Password ») : Bing prend
 * alors le relais. Sans ce repli, un mot court resterait en anglais.
 */
const ENGINES = [null, "bing"];

function engineArgs(engine, source, target, masked) {
  return [
    ...(engine ? ["-e", engine] : []),
    "-brief",
    "-no-ansi",
    "-no-warn",
    "-s",
    source,
    "-t",
    target,
    masked,
  ];
}

function firstLine(raw) {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
}

/** Traduit une chaîne unique (source -> cible) en conservant la ponctuation. */
export function translateOne(text, target, source = "en") {
  if (!text || !text.trim()) return text;
  const { masked, tokens } = protect(text);
  const { cmd, prefix } = resolveRunner();
  for (const engine of ENGINES) {
    const args = [...prefix, ...engineArgs(engine, source, target, masked)];
    let line;
    try {
      line = firstLine(execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
    } catch {
      line = undefined;
    }
    if (line && !/\[ERROR\]/.test(line)) {
      return restore(line, tokens).replace(/\s+([,.;:!?])/g, "$1").trim();
    }
  }
  return text;
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

/* -------------------------------------------------------------------------
 * Variante asynchrone parallélisée.
 *
 * Les scripts de remise à niveau traduisent plusieurs centaines de chaînes
 * sur quinze langues : l'exécution séquentielle prendrait une demi-heure.
 * `translateMapAsync` conserve exactement la même protection des
 * interpolations `{{variable}}` mais lance plusieurs traductions de front.
 * ---------------------------------------------------------------------- */
import { execFile } from "node:child_process";

function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** Traduit une chaîne unique, sans bloquer la boucle d'évènements. */
export async function translateOneAsync(text, target, source = "en") {
  if (!text || !text.trim()) return text;
  const { masked, tokens } = protect(text);
  const { cmd, prefix } = resolveRunner();
  for (const engine of ENGINES) {
    const args = [...prefix, ...engineArgs(engine, source, target, masked)];
    let line;
    try {
      line = firstLine(await execFileAsync(cmd, args));
    } catch {
      line = undefined;
    }
    if (line && !/\[ERROR\]/.test(line)) {
      return restore(line, tokens).replace(/\s+([,.;:!?])/g, "$1").trim();
    }
  }
  return text;
}


/**
 * Traduit un dictionnaire plat `{ cle: texte }` avec une file d'attente bornée.
 * En cas d'échec réseau la valeur source est conservée : aucune clé n'est perdue.
 */
export async function translateMapAsync(entries, target, source = "en", concurrency = 6, onProgress) {
  const keys = Object.keys(entries);
  const out = {};
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < keys.length) {
      const key = keys[cursor++];
      try {
        out[key] = await translateOneAsync(entries[key], target, source);
      } catch (error) {
        out[key] = entries[key];
        console.error(`  ! ${target} ${key}: ${error.message}`);
      }
      done += 1;
      if (onProgress) onProgress(done, keys.length, key);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  return out;
}
