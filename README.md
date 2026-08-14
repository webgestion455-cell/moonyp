# Global Credit Hub

Bonjour j'espère que tu vas bien. Je t'ai joint mon projet actuel en zip et je veux ton aide pour faire tout ce que je vais écrire suivant et fais-moi tout ça bien professionnel. Voici : 

Continue immédiatement et termine 100% du refactor sans interruption.

⚠️ IMPORTANT :

Je ne veux PAS une autre réponse intermédiaire.

Je veux une implémentation complète et finale, prête production.

Tu dois TERMINER TOUS les points restants sans exception :

========================

1. 🌍 i18n COMPLET (OBLIGATOIRE)

========================

- Supprimer TOUS les textes en dur dans tout le projet

- Remplacer par i18n (t('...'))

- Couvrir 100% des fichiers :

dashboard.tsx  

auth.tsx  

loans.new.tsx  

loans.$loanId.tsx  

index.tsx  

settings.tsx  

contact.tsx  

TransferDialog.tsx  

MobileBottomNav.tsx  

admin.index.tsx  

contrat PDF  

- Traduire :

  - placeholders

  - labels

  - boutons

  - toasts

  - erreurs

  - notifications

- Aucune langue fixe dans le code

========================

2. 🔔 WEB PUSH COMPLET (OBLIGATOIRE)

========================

Implémenter complètement :

- Server function pour envoyer push (web-push)

- Utiliser table push_subscriptions

- Envoyer notification automatique :

✔ nouvelle demande → admin  

✔ validation/rejet → client  

✔ virement → admin + client  

✔ contrat envoyé → client  

- Fonction doit marcher même si utilisateur hors ligne

- Utiliser VAPID keys

========================

3. 🕒 HISTORIQUE COMPLET (OBLIGATOIRE)

========================

- Utiliser table loan_status_history

- Chaque changement de statut doit être loggé :

user_id  

loan_id  

old_status  

new_status  

timestamp  

- Afficher timeline réelle en temps réel 100% dans loans.$loanId.tsx

4. 🧠 LOGIQUE MÉTIER À CORRIGER

========================

- Dates/heures doivent être dynamiques fonctionnelles en temps réel 100% (pas figées)

- Format selon langue (i18n)

- Admin :

  - voir tous les virements

  - voir détails avant validation/rejet

- Client :

  - montant total financé = seulement prêts acceptés

- Ajouter boutons actions admin :

  - accepter

  - refuser

  - ouvrir

========================

5. 📄 VIREMENT

========================

- Quand un client émet un virement (Classique comme instantanné), il faut que cela progresse en trois étapes avec poucentage (63{virement sera bloqué avec un message bien professionel d'échec; montant à payé pour que son code lui soit générer et lui envoyer; requisition d'un code qui sera envoyé par admin si admin approuve paiement réglé}, 88{idem processus que l'étape 63} et 100{ici le virement sera avec succès}).

- Pour une cohérence absolue, dès qu'un client demande un prêt (sur chaque demande de prêt), il faut que admin ait aussi possibilité de planifié les frais des trois étapes de virement (63,88 et 100) avec une section bien dédié dans dashboard admin et aussi générer les codes de déblocage et envoyer directement aux clients par email et dans leur dashboard

========================

5. 📄 COMPLEMENT

========================

-Ajoute sur la page Connexion/d'inscription option mot de passe oublié et Connexion/Inscription directement par compte google gmail; ajoute également sur la page également bouton retour à la page d'acceuil.

-Rend vraiment fonctionnel et en temps réel les notifications.

========================

🎯 OBJECTIF FINAL

========================

Application SaaS bancaire :

- 100% multilingue

- notifications temps réel + hors ligne

- logique financière correcte

- historique complet

- sécurité propre

🚫 NE PAS s’arrêter avant d’avoir terminé 100%

🚫 NE PAS demander confirmation

🚫 NE PAS proposer une "prochaine étape"

➡️ Livrer une version finale complète.

Trouve ci-joint le fichier zip de tout le site son niveau actuel

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/08bc6359-c240-4936-80d5-15fc365b6862).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
