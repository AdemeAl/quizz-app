# Quiz App

## Description

Application de quiz interactive (Front + API) pour générer et jouer des quiz, analyser les erreurs avec IA, et enregistrer les scores.

## Fonctionnalités

- Chargement de questions locales depuis `src/questions_data/questions.json`
- Génération de questions via API Google Gemini (`/api/quiz/theme`, `/api/quiz/pdf`)
- Authentification utilisateur (signup/login + JWT)
- Analyse de résultats avec IA (`/api/quiz/analyse`)
- Partage de quiz via Supabase (optionnel)
- Timer et comptage correct/incorrect

## Prérequis

- Node.js >= 18
- MongoDB accessible
- Clé Gemini API (GEMINI_API_KEY)
- JWT_SECRET
- Supabase (optionnel, seulement pour partage/leaderboard)

## Configuration

Créer un fichier `.env` à la racine :

```ini
PORT=3000
MONGO_URI=mongodb://<username>:<password>@<host>:<port>/<db>
JWT_SECRET=ta_super_cle_secrete
GEMINI_API_KEY=ta_cle_gemini
# SUPABASE_URL et SUPABASE_KEY ne doivent pas être exposés côté client.
```

## Installation

```bash
npm install
```

## Scripts

- `npm run auth` : démarre l'API d'authentification/quiz (`server.cjs`)
- `npm run api` : démarre l'API de génération de questions (`api/generateQuestions.js`)
- `npm run dev` : lance les deux en parallèle (concurrently)

## Démarrage

```bash
npm run dev
```

Puis ouvrir `quiz.html` dans le navigateur ou via un serveur static.

## Sécurité

- Ne jamais exposer de clés d'API ou `JWT_SECRET` dans le code client.
- Supabase est optionnel : si non configuré, le jeu continue en local.

## Bonnes pratiques pour publication

1. Ajouter des tests unitaires / e2e.
2. Ajouter l'analyse du format JSON IA (surtout PDF) et des limites de timeout.
3. Utiliser HTTPS et config de CORS strict.
4. Désactiver le débogage en production.

## Auteur

ADM
