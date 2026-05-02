# Déployer MonFrigo sur Vercel — Guide complet d'indépendance

Ce guide te permet de déployer MonFrigo **entièrement hors de Replit** :
frontend + API sur Vercel, base de données sur Neon, authentification sur Clerk,
IA sur Groq. Une fois fait, l'app tourne indépendamment même si tu quittais Replit.

---

## Vue d'ensemble

| Service | Rôle | Coût |
|---|---|---|
| **Vercel** | Frontend React + API Express (serverless) | Gratuit |
| **Neon** | Base de données PostgreSQL | Gratuit (0.5 GB) |
| **Clerk** | Authentification utilisateurs | Gratuit (10 000 MAU) |
| **Groq** | Intelligence artificielle (génération menus) | Gratuit (~14 400 req/jour) |
| **Stripe** | Paiements abonnements | Gratuit + 2,9% par transaction |

---

## Étape 1 — Neon (base de données)

> ⚠️ La base de données Replit n'est pas accessible depuis Vercel. Il te faut ta propre base Neon.

1. Va sur **https://neon.tech** → **Sign up** (gratuit)
2. **Create a new project** → donne-lui le nom `monfrigo`
3. Dans le projet : **Connection Details** → sélectionne **Pooled connection**
4. Copie l'URL qui ressemble à :
   ```
   postgresql://user:password@ep-cool-name-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
5. Garde cette URL — tu en auras besoin pour l'étape 4 (Vercel) et pour migrer le schéma.

**Migrer le schéma sur la nouvelle base :**

Dans le terminal Replit (Shell), lance :

```bash
DATABASE_URL="postgresql://..." pnpm --filter @workspace/db run push
```

Remplace `postgresql://...` par ton URL Neon complète. Cette commande crée toutes les tables nécessaires.

---

## Étape 2 — Clerk (authentification)

> ⚠️ Le Clerk géré par Replit ne fonctionnera pas hors Replit. Il te faut ton propre compte.

1. Va sur **https://clerk.com** → **Sign up** (gratuit)
2. **Create application** → donne le nom `MonFrigo`
3. Active les méthodes de connexion : ✅ Email + ✅ Google (optionnel)
4. Va dans **API Keys** et copie :
   - **Publishable key** → commence par `pk_live_...`
   - **Secret key** → commence par `sk_live_...`
5. Va dans **Domains** → **Add domain** → entre ton URL Vercel (ex: `monfrigo.vercel.app`)
   - Si tu n'as pas encore ton URL Vercel, reviens faire ça après l'étape 4

---

## Étape 3 — Groq (intelligence artificielle, gratuit)

1. Va sur **https://console.groq.com** → **Sign up** (gratuit)
2. **API Keys** → **Create API Key** → copie la clé qui commence par `gsk_...`

Limites gratuites : 30 req/min, ~14 400 req/jour pour `llama-3.1-8b-instant`.
Suffisant pour ~800–1 000 utilisateurs actifs.

---

## Étape 4 — Vercel (déploiement)

### 4.1 Importer depuis GitHub

1. Va sur **https://vercel.com** → **Sign up** ou connecte-toi
2. **Add New Project** → **Import Git Repository**
3. Connecte ton compte GitHub et sélectionne **`MonFrigo-v2-`**
4. **Root Directory** : laisse **vide** (le `vercel.json` est à la racine)
5. **Build Command** et **Output Directory** : ne touche pas — Vercel les lit depuis `vercel.json`
6. **Ne clique pas encore Deploy** — configure d'abord les variables d'environnement

### 4.2 Variables d'environnement Vercel

Dans la section **Environment Variables** du projet Vercel, ajoute les variables suivantes.
Sélectionne les environnements **Production**, **Preview** et **Development** pour chaque.

| Variable | Valeur | Source |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | Clerk → API Keys |
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` | Idem (même valeur) |
| `CLERK_SECRET_KEY` | `sk_live_...` | Clerk → API Keys |
| `DATABASE_URL` | `postgresql://...` | Neon → Connection Details (pooled) |
| `GROQ_API_KEY` | `gsk_...` | console.groq.com → API Keys |
| `STRIPE_SECRET_KEY` | `sk_live_...` | dashboard.stripe.com → API Keys |

> ⚠️ Ne configure **PAS** `VITE_CLERK_PROXY_URL` ni `VITE_API_URL` pour l'instant.

### 4.3 Déployer

Clique sur **Deploy**. Vercel va :
1. Installer les dépendances pnpm du monorepo
2. Compiler l'API Express → serverless function sous `/api/*`
3. Compiler le frontend React → fichiers statiques
4. Tout servir sur un seul domaine (ex: `monfrigo.vercel.app`)

Le premier déploiement prend ~3 minutes.

---

## Étape 5 — Après le déploiement

### 5.1 Stripe Webhook

Il faut configurer un webhook Stripe pour que les abonnements se synchronisent correctement.

1. Va sur **https://dashboard.stripe.com** → **Developers** → **Webhooks**
2. **Add endpoint**
3. **Endpoint URL** : `https://monfrigo.vercel.app/api/stripe/webhook`
   (remplace `monfrigo` par ton vrai sous-domaine Vercel)
4. **Events to send** → sélectionne :
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
5. Clique **Add endpoint**
6. Dans la page du webhook → **Signing secret** → **Reveal** → copie la valeur `whsec_...`
7. Dans Vercel → **Environment Variables** → ajoute :
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...`
8. Dans Vercel → **Deployments** → **Redeploy** (pour que la variable soit prise en compte)

### 5.2 Clerk Proxy (optionnel, recommandé)

Le proxy Clerk améliore la fiabilité de l'authentification sur les domaines `.vercel.app`.

1. Dans Vercel → **Environment Variables** → ajoute :
   - `VITE_CLERK_PROXY_URL` = `https://monfrigo.vercel.app/api/__clerk`
2. Dans Vercel → **Redeploy**

### 5.3 Vérifier que tout fonctionne

1. Ouvre `https://monfrigo.vercel.app` (ou ton URL)
2. ✅ Crée un compte — preuve que Clerk fonctionne
3. ✅ Ajoute un ingrédient au frigo — preuve que la DB fonctionne
4. ✅ Génère un menu — preuve que Groq fonctionne
5. ✅ Lance un abonnement test Stripe → vérifie que le statut passe à Premium

---

## Variables d'environnement — résumé final

Voir le fichier `.env.example` à la racine du projet pour la liste complète.

---

## Domaine personnalisé (optionnel)

Si tu veux `monfrigo.ca` au lieu de `monfrigo.vercel.app` :

1. Vercel → **Settings** → **Domains** → **Add** → entre ton domaine
2. Vercel t'indique les DNS à configurer chez ton registrar
3. Dans Clerk → **Domains** → ajoute aussi ton domaine personnalisé
4. Met à jour `VITE_CLERK_PROXY_URL` avec le nouveau domaine → Redeploy
5. Met à jour l'endpoint Stripe webhook avec le nouveau domaine

---

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Page blanche / erreur Clerk | `VITE_CLERK_PUBLISHABLE_KEY` manquante ou mauvaise | Vérifier les env vars Vercel, redéployer |
| 401 sur tous les appels API | `CLERK_SECRET_KEY` incorrect | Re-vérifier, redéployer |
| Erreur « relation does not exist » | Schéma non migré sur Neon | Lancer `DATABASE_URL=... pnpm --filter @workspace/db run push` |
| Génération de menu échoue | `GROQ_API_KEY` manquante ou invalide | Vérifier la clé sur console.groq.com |
| Webhook Stripe non reçu | `STRIPE_WEBHOOK_SECRET` manquant | Étape 5.1 — ajouter la variable et redéployer |
| Abonnement non reconnu après paiement | Webhook pas configuré | Vérifier l'endpoint Stripe pointe sur ton URL Vercel |

---

## En cas de build Vercel qui échoue

Vercel → **Deployments** → clique sur le déploiement en erreur → **Build Logs**.

Problèmes courants :
- `pnpm install` échoue → vérifier `pnpm-lock.yaml` est committé sur GitHub
- TypeScript errors → ce sont des erreurs connues du client API généré, elles n'empêchent pas le build esbuild de fonctionner
- Timeout → l'API a `maxDuration: 60` dans `vercel.json`, suffisant pour Groq
