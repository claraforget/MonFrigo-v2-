# Déployer FrigoMenu sur Vercel (frontend) + Render (backend)

Ce guide s'adresse à celles et ceux qui veulent déployer le **frontend** sur Vercel
et garder le **backend Express** sur Render (ou Railway, Fly.io, etc.).

---

## 1. Préparer Clerk (authentification)

Sur Replit, Clerk est géré gratuitement par Replit. Hors Replit, il faut votre
propre compte Clerk.

1. Créez un compte sur https://clerk.com (gratuit jusqu'à 10 000 utilisateurs/mois).
2. Créez une nouvelle application Clerk.
3. Activez les méthodes de connexion souhaitées (Email + Google).
4. Récupérez ces deux valeurs :
   - **Publishable key** (commence par `pk_test_…` ou `pk_live_…`)
   - **Secret key** (commence par `sk_test_…` ou `sk_live_…`)

---

## 2. Backend (Render)

Variables d'environnement à configurer sur Render :

| Variable | Exemple / source |
|---|---|
| `DATABASE_URL` | URL Postgres (Neon, Supabase, Render Postgres…) |
| `CLERK_SECRET_KEY` | Secret key Clerk de l'étape 1 |
| `CLERK_PUBLISHABLE_KEY` | Publishable key Clerk |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe (`sk_live_…` ou `sk_test_…`) |
| `OPENAI_API_KEY` | Clé OpenAI (créez un compte sur platform.openai.com) |
| `NODE_ENV` | `production` |

**Note CORS** : le backend autorise déjà toutes les origines avec `credentials`,
donc le frontend Vercel pourra l'appeler sans config supplémentaire.

**Note** : sur Replit, OpenAI passe par un proxy Replit (`AI_INTEGRATIONS_OPENAI_*`).
Hors Replit, il vous faut votre propre clé OpenAI. Vérifiez le code dans
`artifacts/api-server/src/lib/openai.ts` pour adapter l'initialisation si nécessaire.

Une fois Render déployé, notez l'URL publique du backend (ex :
`https://frigomenu-api.onrender.com`).

---

## 3. Frontend (Vercel)

### Importer le projet

1. Allez sur https://vercel.com → **Add New Project**.
2. Importez votre dépôt GitHub `MonFrigo-v2`.
3. **TRÈS IMPORTANT — Root Directory** : Vercel va vous demander quel dossier
   est la racine du projet. Vous avez **deux options qui marchent** :
   - **Option A (recommandée)** : laissez le champ **vide** ou mettez `/`.
     Vercel utilisera le `vercel.json` à la racine du dépôt.
   - **Option B** : mettez `artifacts/frigomenu`. Vercel utilisera le
     `vercel.json` à l'intérieur du dossier (les deux configs sont fournies).
4. Laissez les autres champs par défaut — ne touchez **PAS** au Build Command
   ni à l'Output Directory dans l'interface Vercel : laissez Vercel les lire
   depuis le `vercel.json`.

### Variables d'environnement Vercel

Dans Project Settings → Environment Variables, ajoutez :

| Variable | Valeur |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Publishable key Clerk de l'étape 1 |
| `VITE_API_URL` | URL publique du backend Render (ex: `https://frigomenu-api.onrender.com`) |

⚠️ **Important** : ne configurez **PAS** `VITE_CLERK_PROXY_URL` sur Vercel — cette
variable est spécifique au proxy Replit et ferait planter Clerk.

### Déployer

Cliquez sur **Deploy**. Vercel va :
1. Installer toutes les dépendances du monorepo (`pnpm install`)
2. Compiler uniquement le frontend (`pnpm --filter @workspace/frigomenu build`)
3. Servir le dossier `artifacts/frigomenu/dist/public`
4. Réécrire toutes les routes vers `index.html` (SPA routing pour Wouter)

---

## 4. Stripe : URLs de redirection

Stripe retourne automatiquement vers `window.location.origin + window.location.pathname`,
donc la redirection s'adapte toute seule au domaine Vercel. Aucune action requise.

Cependant, **dans le tableau de bord Stripe** :
- Ajoutez le domaine Vercel dans **Settings → Checkout → Domains** si vous
  utilisez des fonctionnalités custom checkout.
- Si vous utilisez le **Customer Portal**, configurez l'URL de retour autorisée
  dans **Settings → Billing → Customer portal**.

---

## 5. Vérifier que tout fonctionne

1. Ouvrez votre URL Vercel (ex: `https://mon-frigo.vercel.app`).
2. Inscrivez-vous avec un nouveau compte.
3. Ajoutez un ingrédient au frigo → vérifiez qu'il s'affiche (preuve que le
   frontend parle bien au backend Render).
4. Tentez une génération de menu → preuve qu'OpenAI fonctionne.
5. Tentez l'abonnement Stripe → preuve que Stripe est bien configuré côté backend.

---

## En cas de souci

| Symptôme | Cause probable | Solution |
|---|---|---|
| Page blanche au chargement | `VITE_CLERK_PUBLISHABLE_KEY` manquante | Ajouter la variable dans Vercel et redéployer |
| Erreur CORS dans la console | URL backend mal renseignée | Vérifier `VITE_API_URL` (sans slash final) |
| « Aucun abonnement trouvé » | Email Clerk différent de l'email Stripe | Voir le code de `create-portal-session` qui cherche aussi par `userId` |
| 401 sur tous les appels API | `CLERK_SECRET_KEY` mal configurée côté Render | Re-vérifier les env vars Render |
