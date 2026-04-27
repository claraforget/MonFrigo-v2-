# Déployer FrigoMenu sur Vercel (frontend + backend)

Ce guide explique comment déployer **tout** sur Vercel : le frontend React et le
backend Express (en serverless function). La base de données est hébergée sur Neon
(PostgreSQL gratuit).

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

## 2. Base de données (Neon)

1. Créez un compte sur https://neon.tech (gratuit).
2. Créez un nouveau projet et notez l'URL de connexion (pooler).
3. Poussez le schéma avec : `DATABASE_URL="<votre-url>" pnpm --filter @workspace/db run push`

---

## 3. Déployer sur Vercel

### Importer le projet

1. Allez sur https://vercel.com → **Add New Project**.
2. Importez votre dépôt GitHub `MonFrigo-v2`.
3. **Root Directory** : laissez le champ **vide** ou mettez `/`.
4. Laissez les autres champs par défaut — ne touchez **PAS** au Build Command
   ni à l'Output Directory : laissez Vercel les lire depuis le `vercel.json`.

### Variables d'environnement Vercel

Dans Project Settings → Environment Variables, ajoutez :

| Variable | Valeur |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Publishable key Clerk |
| `CLERK_SECRET_KEY` | Secret key Clerk |
| `CLERK_PUBLISHABLE_KEY` | Publishable key Clerk |
| `DATABASE_URL` | URL Postgres Neon (pooler) |
| `OPENAI_API_KEY` | Clé OpenAI (https://platform.openai.com/api-keys) |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe (`sk_test_…` ou `sk_live_…`) |

⚠️ **Important** : ne configurez **PAS** `VITE_CLERK_PROXY_URL` ni `VITE_API_URL`
sur Vercel — le backend tourne maintenant sur le même domaine.

### Déployer

Cliquez sur **Deploy**. Vercel va :
1. Installer toutes les dépendances du monorepo (`pnpm install`)
2. Compiler le backend Express (`pnpm --filter @workspace/api-server build`)
3. Compiler le frontend (`pnpm --filter @workspace/frigomenu build`)
4. Servir le frontend comme SPA et le backend comme serverless function sous `/api/*`

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
3. Ajoutez un ingrédient au frigo → vérifiez qu'il s'affiche.
4. Tentez une génération de menu → preuve qu'OpenAI fonctionne.
5. Tentez l'abonnement Stripe → preuve que Stripe est bien configuré.

---

## En cas de souci

| Symptôme | Cause probable | Solution |
|---|---|---|
| Page blanche au chargement | `VITE_CLERK_PUBLISHABLE_KEY` manquante | Ajouter la variable dans Vercel et redéployer |
| 401 sur tous les appels API | `CLERK_SECRET_KEY` mal configurée | Re-vérifier les env vars Vercel |
| « Aucun abonnement trouvé » | Email Clerk différent de l'email Stripe | Voir le code de `create-portal-session` qui cherche aussi par `userId` |
| Erreur « relation does not exist » | Schéma non poussé dans Neon | Exécuter `pnpm --filter @workspace/db run push` avec `DATABASE_URL` |
