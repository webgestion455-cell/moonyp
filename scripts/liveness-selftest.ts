/**
 * Auto-test du contrôle du visage : validation des gestes, retour au repos,
 * et consignes affichées pendant les défis de rotation.
 *
 * Exécution locale depuis le terminal du projet :
 *
 *   bun run scripts/liveness-selftest.ts
 *
 * Aucune caméra, aucun réseau, aucune base : le script rejoue des mesures
 * représentatives d'un vrai visage et vérifie que la règle de décision réagit
 * comme attendu. Il doit rester vert avant toute mise en ligne touchant au
 * contrôle du visage.
 */

import {
  LIVENESS_THRESHOLDS as TH,
  challengeAtRest,
  challengeSatisfied,
  challengeValue,
  drawChallenges,
  issueMutedDuring,
  type FaceMetrics,
  type LivenessChallenge,
} from "../src/lib/kyc/liveness-engine";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

/** Visage de face, immobile, bien éclairé : l'état de repos de référence. */
function neutral(): FaceMetrics {
  return {
    faces: 1,
    faceFill: 0.5,
    offCenter: 0.04,
    yaw: 0,
    yawRatio: 0,
    pitch: 2,
    roll: 0,
    blinkLeft: 0.05,
    blinkRight: 0.05,
    smile: 0.05,
    jawOpen: 0.03,
    depthVariance: 0.03,
    brightness: 140,
    sharpness: 90,
    screenLikelihood: 0.2,
  };
}

function face(patch: Partial<FaceMetrics>): FaceMetrics {
  return { ...neutral(), ...patch };
}

/* ----------------------- 1. Tour de tête naturel ------------------------ */
console.log("\nTour de tête");

// Une personne qui tourne franchement la tête vers sa gauche : la pose et la
// géométrie concordent, le défi doit passer sans discussion.
check(
  "tour à gauche franc validé",
  challengeSatisfied("turn_left", face({ yaw: 26, yawRatio: 0.24 })),
);
check(
  "tour à droite franc validé",
  challengeSatisfied("turn_right", face({ yaw: -26, yawRatio: -0.24 })),
);

// Appareil qui sous-estime l'angle : la seconde mesure, purement géométrique,
// doit suffire à valider le geste. C'est le cas qui bloquait les utilisateurs.
check(
  "géométrie seule suffit quand la pose sous-estime l'angle",
  challengeSatisfied("turn_left", face({ yaw: 9, yawRatio: 0.2 })),
);

// Sens inverse : tourner à droite ne valide jamais un défi « à gauche ».
check(
  "sens respecté (droite ne valide pas gauche)",
  !challengeSatisfied("turn_left", face({ yaw: -30, yawRatio: -0.3 })),
);

// Pencher la tête vers l'épaule n'est PAS un tour de tête : c'était l'ancien
// comportement à bannir.
check(
  "inclinaison vers l'épaule ne vaut pas un tour de tête",
  !challengeSatisfied("turn_left", face({ roll: 35 })),
);

// Immobile : rien ne doit passer.
check("visage immobile ne valide rien", !challengeSatisfied("turn_left", neutral()));

check("seuil de tour de tête resté accessible", TH.turnYaw <= 20, TH.turnYaw);

/* --------------------------- 2. Autres gestes --------------------------- */
console.log("\nClignement, sourire, bouche");
check(
  "clignement validé",
  challengeSatisfied("blink", face({ blinkLeft: 0.62, blinkRight: 0.58 })),
);
check("sourire validé", challengeSatisfied("smile", face({ smile: 0.55 })));
check("bouche ouverte validée", challengeSatisfied("open_mouth", face({ jawOpen: 0.45 })));
check(
  "bouche à peine entrouverte refusée",
  !challengeSatisfied("open_mouth", face({ jawOpen: 0.1 })),
);

/* ------------------------------ 3. Repos -------------------------------- */
console.log("\nRetour au repos");
check("visage de face reconnu au repos", challengeAtRest("turn_left", neutral()));
check(
  "tête encore tournée n'est pas au repos",
  !challengeAtRest("turn_left", face({ yaw: 20, yawRatio: 0.18 })),
);
check("bouche fermée reconnue au repos", challengeAtRest("open_mouth", neutral()));

/* --------------------------- 4. Consignes ------------------------------- */
console.log("\nConsignes affichées");
check(
  "« regardez droit » tu pendant un tour à gauche",
  issueMutedDuring("turn_left", "not_frontal"),
);
check(
  "« recentrez-vous » tu pendant un tour à droite",
  issueMutedDuring("turn_right", "off_center"),
);
check(
  "visage absent toujours signalé, même en plein défi",
  !issueMutedDuring("turn_left", "no_face"),
);
check("hors défi, rien n'est tu", !issueMutedDuring(null, "not_frontal"));

/* --------------------------- 5. Tirage des défis ------------------------ */
console.log("\nTirage des défis");
const drawn = drawChallenges(4);
check("quatre défis tirés", drawn.length === 4, drawn);
check("aucun doublon", new Set(drawn).size === drawn.length, drawn);

// Chaque défi tiré doit avoir une mesure exploitable quand il est exécuté.
const perfect: Record<LivenessChallenge, FaceMetrics> = {
  blink: face({ blinkLeft: 0.7, blinkRight: 0.7 }),
  turn_left: face({ yaw: 28, yawRatio: 0.26 }),
  turn_right: face({ yaw: -28, yawRatio: -0.26 }),
  smile: face({ smile: 0.6 }),
  open_mouth: face({ jawOpen: 0.5 }),
};
for (const c of drawn) {
  check(
    `défi « ${c} » réalisable`,
    challengeValue(c, perfect[c]) > 0 && challengeSatisfied(c, perfect[c]),
  );
}

/* -------------------------------- Bilan --------------------------------- */
console.log(`\n${passed} vérifications passées, ${failed} en échec.\n`);
if (failed > 0) process.exit(1);
