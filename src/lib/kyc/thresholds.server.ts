/**
 * Seuils KYC — source unique de vérité, strictement serveur.
 *
 * Aucun de ces nombres n'est exposé au navigateur, aucun n'est lisible ni
 * modifiable depuis le client : le navigateur envoie des mesures et des
 * pixels, le serveur applique ces seuils et rend la décision.
 *
 * Toute valeur est justifiée par le moteur qui la consomme réellement. On ne
 * revendique jamais une précision biométrique que le moteur ne garantit pas :
 * la bande intermédiaire existe précisément pour envoyer le dossier en revue
 * humaine plutôt que de trancher à tort.
 */

/* --------------------------------------------------------------------- */
/* 1. Correspondance faciale                                              */
/* --------------------------------------------------------------------- */

/**
 * Moteur de comparaison exécutable dans le runtime applicatif
 * (`face-compare.server.ts`) : descripteurs classiques HOG + LBP calculés sur
 * les pixels réels des deux visages. C'est un moteur de premier niveau,
 * déterministe et auditable, PAS un réseau de reconnaissance faciale profond.
 *
 * Conséquence assumée sur les seuils : la zone de décision est volontairement
 * large, et tout ce qui n'est pas franchement au-dessus ou franchement en
 * dessous part en revue manuelle.
 *
 * Le moteur profond (`face-engine.node.ts`, descripteur ResNet 128D exécuté
 * par le worker interne) reste prioritaire : lorsqu'un résultat de worker
 * existe pour le dossier, il prime sur le moteur classique.
 */
export const FACE_MATCH_THRESHOLD = 0.6;

/** En dessous : correspondance clairement absente → dossier refusé. */
export const FACE_MISMATCH_THRESHOLD = 0.42;

/** Qualité minimale d'un visage pour que la comparaison ait un sens. */
export const FACE_QUALITY_LIMITS = {
  /** Côté minimal du visage détecté, en pixels de l'image source. */
  minFaceSizePx: 56,
  /** Variance du Laplacien sur le visage recadré (netteté). */
  minSharpness: 8,
  /** Luminance moyenne 0..255. */
  minBrightness: 30,
  maxBrightness: 240,
  /** Contraste minimal (écart-type des niveaux de gris). */
  minContrast: 12,
} as const;

/** Distances euclidiennes du moteur profond (descripteur 128D ResNet). */
export const FACE_DESCRIPTOR_DISTANCE = {
  /** Seuil publié du modèle, resserré : en dessous, correspondance. */
  match: 0.45,
  /** Au-dessus, non-correspondance démontrée. */
  mismatch: 0.6,
} as const;

/* --------------------------------------------------------------------- */
/* 2. Vivacité                                                            */
/* --------------------------------------------------------------------- */

/** Score de vivacité minimal (0..100) calculé par `evidence.server.ts`. */
export const LIVENESS_THRESHOLD = 70;

/* --------------------------------------------------------------------- */
/* 3. Qualité documentaire                                                */
/* --------------------------------------------------------------------- */

/** Score de capture minimal (0..100) d'une pièce pour une validation auto. */
export const DOCUMENT_QUALITY_THRESHOLD = 60;

/** En dessous : capture inexploitable, reprise demandée. */
export const DOCUMENT_QUALITY_FLOOR = 30;

/* --------------------------------------------------------------------- */
/* 4. Lecture OCR / croisement d'identité                                 */
/* --------------------------------------------------------------------- */

/** Confiance OCR minimale pour exploiter la MRZ sans revue humaine. */
export const OCR_CONFIDENCE_THRESHOLD = 55;

/** Score de croisement d'identité minimal pour une validation automatique. */
export const IDENTITY_MATCH_THRESHOLD = 88;

/** En dessous, l'identité lue contredit l'identité déclarée. */
export const IDENTITY_MATCH_FLOOR = 45;

/** Version du jeu de seuils, journalisée avec chaque décision. */
export const KYC_THRESHOLDS_VERSION = "moonyp-kyc-thresholds/1.0.0";

/** Vue lisible, destinée au back-office et à la piste d'audit. */
export const KYC_THRESHOLDS = {
  version: KYC_THRESHOLDS_VERSION,
  face_match: FACE_MATCH_THRESHOLD,
  face_mismatch: FACE_MISMATCH_THRESHOLD,
  liveness: LIVENESS_THRESHOLD,
  document_quality: DOCUMENT_QUALITY_THRESHOLD,
  document_quality_floor: DOCUMENT_QUALITY_FLOOR,
  ocr_confidence: OCR_CONFIDENCE_THRESHOLD,
  identity_match: IDENTITY_MATCH_THRESHOLD,
  identity_match_floor: IDENTITY_MATCH_FLOOR,
} as const;
