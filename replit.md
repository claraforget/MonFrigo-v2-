# FrigoMenu Workspace

## Overview

FrigoMenu is a smart meal planning app built with React + Vite (frontend) and Express (backend). Users enter their fridge ingredients, configure preferences, and the AI generates a weekly menu with shopping list and grocery store recommendations.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui + Framer Motion
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2 for menu generation)
- **Build**: esbuild (CJS bundle)

## Features

1. **Mon Frigo** - Add/edit/delete fridge ingredients with name, quantity, unit, category, expiry date
2. **Préférences** - Configure cooking time, budget, number of people, allergies, dietary & cuisine preferences
3. **Menu de la semaine** - AI-generated 7-day menu (breakfast/lunch/dinner), PDF export via print
4. **Liste & Épiceries** - Shopping list grouped by category + geolocation-based store comparison

## Structure

```text
artifacts/
  frigomenu/          # React + Vite frontend
  api-server/         # Express 5 API server
lib/
  api-spec/           # OpenAPI spec + Orval codegen
  api-client-react/   # Generated React Query hooks
  api-zod/            # Generated Zod schemas
  db/                 # Drizzle ORM schema + DB connection
```

## Database Schema

- `fridge_ingredients` — ingredients with name, quantity, unit, category, expiry date
- `user_preferences` — cooking time, budget, people count, allergies, dietary/cuisine prefs
- `weekly_menus` — AI-generated menus stored as JSONB

## Authentication

Custom JWT auth (no Clerk). Cookie name: `__mf_sess`, 30-day httpOnly lax cookie.
- `POST /api/auth/register` — email + password → bcrypt hash, JWT cookie
- `POST /api/auth/login` — email + password → JWT cookie
- `POST /api/auth/logout` — clears cookie
- `GET /api/auth/me` — returns current user
- `requireAuth` middleware reads JWT from cookie, injects `req.user`
- `JWT_SECRET` set as shared env var in Replit and in Vercel env
- `users` table in PostgreSQL: id, email, passwordHash, name, createdAt

## AI Menu Generation

- Provider: OpenAI via Replit AI Integrations (gpt-5.2 / fallback to groq llama)
- Prompt includes ANREF Canada nutritional targets per day per person
- Response includes `dailyNutrition` per day: calories, proteinG, carbsG, fatG, fiberG
- Savings optimization: budget proteins, seasonal veg, bulk buying, smart leftovers
- UI displays nutritional summary in each day card header

## Design

- Dark premium theme: #080808 background, white foreground, #27c266 primary green
- Font: Bricolage Grotesque (display), Inter (body)
- Matching teaser aesthetic with glassmorphism cards

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client/Zod from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `pnpm --filter @workspace/api-server run dev` — start API server
- `pnpm --filter @workspace/frigomenu run dev` — start frontend
