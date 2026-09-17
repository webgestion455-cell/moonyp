/**
 * Ajoute (sans écraser) les libellés du verdict d'identité KYC dans toutes les
 * locales. Les textes français et anglais sont définitifs ; les autres langues
 * reçoivent l'anglais en attendant une traduction humaine.
 *
 *   bun run scripts/kyc-i18n-decision.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/i18n/locales";

const EN = {
  "kyc.decision.checking": "Checking your identity",
  "kyc.decision.checkingDesc": "Our verification engine is cross-checking your document with your declared details.",
  "kyc.decision.passedNotice": "Your document and your selfie match the details you provided.",
  "kyc.decision.failedNotice": "The checks could not confirm your identity. Please capture your document again.",
  "kyc.decision.retry": "Start the verification again",
  "kyc.decision.field.surname": "Surname",
  "kyc.decision.field.given_names": "Given names",
  "kyc.decision.field.birth_date": "Date of birth",
  "kyc.decision.field.nationality": "Nationality",
  "kyc.decision.field.expiry_date": "Expiry date",
  "kyc.decision.field.document_number": "Document number",
  "kyc.decision.reason.generic": "An additional check is required.",
  "kyc.decision.reason.no_identity_document": "No identity document was provided.",
  "kyc.decision.reason.mrz_not_readable": "The machine-readable zone could not be read.",
  "kyc.decision.reason.ocr_not_performed": "The document could not be read automatically.",
  "kyc.decision.reason.low_ocr_confidence": "The document reading is not sharp enough.",
  "kyc.decision.reason.surname_mismatch": "The surname does not match your document.",
  "kyc.decision.reason.given_names_mismatch": "The given names do not match your document.",
  "kyc.decision.reason.birth_date_mismatch": "The date of birth does not match your document.",
  "kyc.decision.reason.birth_date_not_readable": "The date of birth could not be read.",
  "kyc.decision.reason.nationality_differs": "The nationality differs from your document.",
  "kyc.decision.reason.document_expired": "The document has expired.",
  "kyc.decision.reason.low_capture_quality": "The capture quality is too low.",
  "kyc.decision.reason.screen_presentation_suspected": "A screen presentation is suspected.",
  "kyc.decision.reason.identity_document_uploaded": "The identity document was uploaded instead of scanned.",
  "kyc.decision.reason.capture_failed": "One capture did not pass the checks.",
  "kyc.decision.reason.no_liveness_session": "The liveness check is missing.",
  "kyc.decision.reason.liveness_failed": "The liveness check did not pass.",
  "kyc.decision.reason.liveness_doubt": "The liveness check requires a review.",
  "kyc.decision.reason.not_enough_challenges": "Not enough liveness actions were completed.",
  "kyc.decision.reason.challenges_incomplete": "The liveness actions were not completed.",
  "kyc.decision.reason.flat_face_suspected": "The face appears flat, as on a photo.",
  "kyc.decision.reason.reaction_too_fast": "The reaction was too fast to be genuine.",
  "kyc.decision.reason.slow_reaction": "The reaction took too long.",
  "kyc.decision.reason.multiple_faces_seen": "More than one face was detected.",
  "kyc.decision.reason.face_rarely_detected": "The face was rarely visible.",
  "kyc.decision.reason.session_too_short": "The liveness session was too short.",
  "kyc.decision.reason.blurry": "The image is blurry.",
  "kyc.decision.reason.too_dark": "The image is too dark.",
  "kyc.decision.reason.overexposed": "The image is overexposed.",
  "kyc.decision.reason.glare": "There is glare on the document.",
  "kyc.decision.reason.unstable_capture": "The capture was not stable enough.",
  "kyc.decision.reason.insufficient_analysis": "The capture was too brief to be analysed.",
  "kyc.decision.reason.missing_score": "The capture measurements are missing.",
  "kyc.decision.reason.manual_review_required": "A compliance review is required.",
};

const FR = {
  "kyc.decision.checking": "Vérification de votre identité",
  "kyc.decision.checkingDesc": "Nos contrôles croisent votre pièce avec les informations que vous avez déclarées.",
  "kyc.decision.passedNotice": "Votre pièce et votre selfie correspondent aux informations déclarées.",
  "kyc.decision.failedNotice": "Les contrôles n'ont pas pu confirmer votre identité. Reprenez la capture de votre pièce.",
  "kyc.decision.retry": "Recommencer la vérification",
  "kyc.decision.field.surname": "Nom",
  "kyc.decision.field.given_names": "Prénoms",
  "kyc.decision.field.birth_date": "Date de naissance",
  "kyc.decision.field.nationality": "Nationalité",
  "kyc.decision.field.expiry_date": "Date d'expiration",
  "kyc.decision.field.document_number": "Numéro de la pièce",
  "kyc.decision.reason.generic": "Un contrôle complémentaire est nécessaire.",
  "kyc.decision.reason.no_identity_document": "Aucune pièce d'identité n'a été fournie.",
  "kyc.decision.reason.mrz_not_readable": "La bande lisible par machine n'a pas pu être lue.",
  "kyc.decision.reason.ocr_not_performed": "La pièce n'a pas pu être lue automatiquement.",
  "kyc.decision.reason.low_ocr_confidence": "La lecture de la pièce manque de netteté.",
  "kyc.decision.reason.surname_mismatch": "Le nom ne correspond pas à votre pièce.",
  "kyc.decision.reason.given_names_mismatch": "Les prénoms ne correspondent pas à votre pièce.",
  "kyc.decision.reason.birth_date_mismatch": "La date de naissance ne correspond pas à votre pièce.",
  "kyc.decision.reason.birth_date_not_readable": "La date de naissance n'a pas pu être lue.",
  "kyc.decision.reason.nationality_differs": "La nationalité diffère de celle de votre pièce.",
  "kyc.decision.reason.document_expired": "La pièce est expirée.",
  "kyc.decision.reason.low_capture_quality": "La qualité de capture est insuffisante.",
  "kyc.decision.reason.screen_presentation_suspected": "Une présentation depuis un écran est suspectée.",
  "kyc.decision.reason.identity_document_uploaded": "La pièce d'identité a été importée au lieu d'être scannée.",
  "kyc.decision.reason.capture_failed": "Une capture n'a pas passé les contrôles.",
  "kyc.decision.reason.no_liveness_session": "Le contrôle de vivacité est manquant.",
  "kyc.decision.reason.liveness_failed": "Le contrôle de vivacité n'a pas abouti.",
  "kyc.decision.reason.liveness_doubt": "Le contrôle de vivacité demande un examen.",
  "kyc.decision.reason.not_enough_challenges": "Trop peu de gestes de vivacité ont été réalisés.",
  "kyc.decision.reason.challenges_incomplete": "Les gestes de vivacité n'ont pas été terminés.",
  "kyc.decision.reason.flat_face_suspected": "Le visage paraît plat, comme sur une photo.",
  "kyc.decision.reason.reaction_too_fast": "La réaction a été trop rapide pour être réelle.",
  "kyc.decision.reason.slow_reaction": "La réaction a été trop lente.",
  "kyc.decision.reason.multiple_faces_seen": "Plusieurs visages ont été détectés.",
  "kyc.decision.reason.face_rarely_detected": "Le visage a rarement été visible.",
  "kyc.decision.reason.session_too_short": "La session de vivacité a été trop courte.",
  "kyc.decision.reason.blurry": "L'image est floue.",
  "kyc.decision.reason.too_dark": "L'image est trop sombre.",
  "kyc.decision.reason.overexposed": "L'image est surexposée.",
  "kyc.decision.reason.glare": "Un reflet gêne la lecture de la pièce.",
  "kyc.decision.reason.unstable_capture": "La capture n'était pas assez stable.",
  "kyc.decision.reason.insufficient_analysis": "La capture a été trop brève pour être analysée.",
  "kyc.decision.reason.missing_score": "Les mesures de capture sont absentes.",
  "kyc.decision.reason.manual_review_required": "Un examen de conformité est nécessaire.",
};

function setDeep(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  const last = parts[parts.length - 1];
  if (node[last] === undefined) {
    node[last] = value;
    return 1;
  }
  return 0;
}

let total = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const lang = file.replace(/\.json$/, "");
  const path = join(DIR, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const source = lang === "fr" ? FR : EN;
  let added = 0;
  for (const [key, value] of Object.entries(source)) added += setDeep(json, key, value);
  if (added > 0) writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  total += added;
  console.log(`${lang}: +${added}`);
}
console.log(`Total: ${total} clés ajoutées.`);
