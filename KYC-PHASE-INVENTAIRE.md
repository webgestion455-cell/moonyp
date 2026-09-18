# Phase corrective KYC

## Portée réelle

Cette phase sécurise le précontrôle existant. Elle ne livre pas un système bancaire KYC complet et ne certifie pas la conformité réglementaire.

- Plus de validation automatique à partir de mesures/OCR envoyés par le navigateur, même avec une MRZ parfaite.
- Sans MRZ exploitable ou session de vivacité, résultat « identité non vérifiée », identique à chaque tentative. Ce résultat ne signifie pas « fraude prouvée » ni « crédit refusé ».
- Les contrôles indépendants absents sont explicitement journalisés : authenticité documentaire, comparaison biométrique, domicile et relevé bancaire.
- L'évaluation attend la fin de la lecture OCR. Sa signature dépend du contenu des preuves, pas seulement de la présence d'OCR.
- Une erreur d'évaluation n'est plus affichée comme une décision de revue manuelle.
- Au dépôt, l'identité comparée vient du dossier enregistré, pas de l'identité librement renvoyée avec les documents.
- Les erreurs d'écriture de la décision et de son statut ne sont plus ignorées.
- Les messages visibles de décision sont traduits dans les 15 langues ; le texte ne prétend plus qu'une comparaison visage/pièce a été effectuée.
- La file administrative signale les vérifications indépendantes non raccordées et traduit les états supplémentaires. Elle ne constitue pas un nouveau back-office complet.

## Vérifications exécutées

```sh
bun run scripts/kyc-selftest.ts
bun run scripts/liveness-selftest.ts
node scripts/kyc-decision-i18n-audit.mjs
```

Résultats : 27/27, 24/24 et 15 langues sans clé de décision manquante ou copie anglaise identique. Ces tests de logique ne sont pas des essais biométriques ni une qualification bancaire.

Essai navigateur sur `/de/apply` : la page atteint un écran d'erreur signalant l'absence de configuration de connexion à la base. Parcours réel, dépôt, caméra et administration non validés de bout en bout dans cet environnement.

## Restant bloqué

Un service de vérification indépendant doit être sélectionné et autorisé avant de traiter les documents et données biométriques : contrat, confidentialité, résidence des données, identifiants et accès de test. Aucun envoi de données à un tiers n'a été ajouté.

Authenticité des pièces, extraction indépendante des justificatifs/relevés, rapprochement d'adresse/IBAN, comparaison visage–portrait, contrôle anti-injection et filtrage sanctions/PEP ne sont pas implémentés par cette phase. Les mesures navigateur ne constituent pas des preuves authentifiées. Les traductions des autres écrans et les libellés internes résiduels n'ont pas fait l'objet d'une revue exhaustive.

## Inventaire exhaustif de cette phase uniquement

### Fichiers ajoutés

- `roadmap.md`
- `KYC-PHASE-INVENTAIRE.md`
- `scripts/kyc-decision-i18n-audit.mjs`

### Fichiers modifiés

- `src/lib/kyc/decision.server.ts`
- `src/lib/applications.functions.ts`
- `src/components/finance/KycFlow.tsx`
- `src/routes/admin.kyc.tsx`
- `scripts/kyc-selftest.ts`
- `src/i18n/locales/bg.json`
- `src/i18n/locales/de.json`
- `src/i18n/locales/el.json`
- `src/i18n/locales/en.json`
- `src/i18n/locales/es.json`
- `src/i18n/locales/fi.json`
- `src/i18n/locales/fr.json`
- `src/i18n/locales/hr.json`
- `src/i18n/locales/hu.json`
- `src/i18n/locales/it.json`
- `src/i18n/locales/nl.json`
- `src/i18n/locales/pl.json`
- `src/i18n/locales/ro.json`
- `src/i18n/locales/sk.json`
- `src/i18n/locales/sl.json`

### Fichiers supprimés

Aucun.

### Fichiers renommés

Aucun.

### SQL ajoutés

Aucun.

### SQL modifiés

Aucun.

### SQL supprimés

Aucun.

### SQL renommés

Aucun.

Aucune migration ni modification de données n'a été exécutée contre votre base. Les scripts temporaires et captures de diagnostic sous `/tmp` ne sont pas des fichiers du projet à transférer.
