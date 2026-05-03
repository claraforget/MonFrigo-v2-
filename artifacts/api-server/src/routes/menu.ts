import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { db, fridgeIngredientsTable, userPreferencesTable, weeklyMenusTable, userSubscriptionsTable } from "@workspace/db";
import {
  GenerateMenuResponse,
  GetCurrentMenuResponse,
  GetShoppingListResponse,
} from "@workspace/api-zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const FREE_GENERATIONS = 2;

const router: IRouter = Router();

router.use(requireAuth);

function getOpenAI(): { client: OpenAI; model: string } {
  // Replit environment: use built-in proxy ONLY if REPL_ID is present (true Replit env)
  const onReplit = !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT_ID || process.env.REPL_SLUG);
  if (onReplit && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      }),
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    };
  }
  // Groq: 100% gratuit, sans carte de crédit (https://console.groq.com)
  // llama-3.3-70b-versatile : contexte 32k tokens — évite le 413 que 8b-instant (8k) générait
  // sur un menu 7 jours (~1000 tokens prompt + ~4000 tokens réponse = ~5000 tokens)
  if (process.env.GROQ_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: process.env.OPENAI_MODEL ?? "llama-3.3-70b-versatile",
    };
  }
  // Google Gemini: clé sur https://aistudio.google.com/apikey
  if (process.env.GEMINI_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: process.env.GEMINI_API_KEY,
      }),
      model: process.env.OPENAI_MODEL ?? "gemini-2.0-flash",
    };
  }
  // Standard OpenAI (payant)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing AI key: set GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY");
  }
  return {
    client: new OpenAI({ apiKey }),
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

router.post("/menu/generate", async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;

  // Envoyer les headers SSE EN PREMIER — avant tout appel DB ou IA.
  // Ainsi, même si quelque chose plante ensuite, le client reçoit un événement SSE
  // d'erreur au lieu d'un 500 HTTP brut.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ── Enforcement paywall côté serveur ─────────────────────────────────────
  let isServerSubscribed = false;
  try {
    const [subRow] = await db
      .select()
      .from(userSubscriptionsTable)
      .where(eq(userSubscriptionsTable.userId, userId))
      .limit(1);
    isServerSubscribed = subRow?.status === "active" || subRow?.status === "canceling";
  } catch { /* non-bloquant */ }

  if (!isServerSubscribed) {
    let currentCount = 0;
    try {
      const [prefRow] = await db
        .select({ generationCount: userPreferencesTable.generationCount })
        .from(userPreferencesTable)
        .where(eq(userPreferencesTable.userId, userId))
        .limit(1);
      currentCount = prefRow?.generationCount ?? 0;
    } catch { /* non-bloquant */ }

    if (currentCount >= FREE_GENERATIONS) {
      send({ status: "error", code: "PAYWALL", message: "Limite gratuite atteinte — abonnez-vous pour continuer." });
      res.end();
      return;
    }

    // Incrémenter atomiquement le compteur de générations
    try {
      await db
        .insert(userPreferencesTable)
        .values({ userId, generationCount: 1 })
        .onConflictDoUpdate({
          target: userPreferencesTable.userId,
          set: { generationCount: sql`${userPreferencesTable.generationCount} + 1` },
        });
    } catch { /* non-bloquant */ }
  }
  // ─────────────────────────────────────────────────────────────────────────

  send({ status: "start" });

  try {
    const ingredients = await db
      .select()
      .from(fridgeIngredientsTable)
      .where(eq(fridgeIngredientsTable.userId, userId));

    // Lecture des préférences avec fallback complet si la colonne n'existe pas encore
    // (ex: migration DB non encore appliquée en production)
    let prefs: typeof userPreferencesTable.$inferSelect | undefined;
    try {
      const rows = await db
        .select()
        .from(userPreferencesTable)
        .where(eq(userPreferencesTable.userId, userId))
        .limit(1);
      prefs = rows[0];
    } catch {
      // La table ou une colonne est absente → on continue avec les valeurs par défaut
      prefs = undefined;
    }

    const preferences = prefs ?? {
      cookingTimePerDay: 45,
      weeklyBudget: 150,
      numberOfPeople: 2,
      allergies: [] as string[],
      dietaryPreferences: [] as string[],
      cuisinePreferences: [] as string[],
      mealTypes: ["breakfast", "lunch", "dinner"] as string[],
      difficultyPreference: "Moyen" as string | string[],
    };

    const selectedMeals = preferences.mealTypes && preferences.mealTypes.length > 0
      ? preferences.mealTypes as string[]
      : ["breakfast", "lunch", "dinner"];
    const mealLabels: Record<string, string> = {
      breakfast: "déjeuner (matin)",
      lunch: "dîner (midi)",
      dinner: "souper (soir)",
    };
    // Build explicit per-field JSON instructions so the model never guesses
    const allFields = ["breakfast", "lunch", "dinner"] as const;
    const fieldDirectives = allFields
      .map((f) => `"${f}": ${selectedMeals.includes(f) ? "RECETTE (obligatoire, jamais null)" : "null (non demandé)"}`)
      .join(" | ");

    const ingredientList = ingredients.length > 0
      ? ingredients.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(", ")
      : "Aucun ingrédient spécifié – proposer des repas simples avec des ingrédients courants";

    const seed = Math.floor(Math.random() * 1_000_000);

    const N = preferences.numberOfPeople;
    // Parse difficulty — DB stores either a plain string ("Moyen") or JSON array ('["Facile","Moyen"]')
    let diffLevels: string[];
    const rawDiff = preferences.difficultyPreference ?? "Moyen";
    try {
      const parsed = typeof rawDiff === "string" ? JSON.parse(rawDiff) : rawDiff;
      diffLevels = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      diffLevels = [String(rawDiff)];
    }
    const diffStr = diffLevels.join(", ");
    const diffInstruction = diffLevels.length === 1
      ? `TOUTES les recettes DOIVENT être de niveau "${diffLevels[0]}". Aucune exception.`
      : `Distribuer équitablement entre les niveaux [${diffStr}]. Chaque niveau doit apparaître plusieurs fois dans la semaine.`;
    const diffTimings = diffLevels.map(l =>
      l === "Facile" ? "Facile = ≤25 min, 1 technique" :
      l === "Moyen"  ? "Moyen = 25-45 min, 2-3 techniques" :
                       "Avancé = 45+ min, techniques élaborées"
    ).join(" · ");
    const allergiesStr = (preferences.allergies as string[]).length > 0 ? (preferences.allergies as string[]).join(", ") : "aucune";
    const regimeStr = (preferences.dietaryPreferences as string[]).length > 0 ? (preferences.dietaryPreferences as string[]).join(", ") : "aucun";
    const cuisinesStr = (preferences.cuisinePreferences as string[]).length > 0 ? (preferences.cuisinePreferences as string[]).join(", ") : "variées";

    const prompt = `Tu es un chef cuisinier expert. Génère un menu de 7 jours savoureux et bien assaisonné pour ${N} personne(s). Seed:${seed}.

PROFIL:
- Budget: ${preferences.weeklyBudget}$ CAD/sem | Temps max: ${preferences.cookingTimePerDay} min/jour
- Allergies STRICTES: ${allergiesStr} | Régime: ${regimeStr} | Cuisines: ${cuisinesStr}
- Frigo: ${ingredientList}

REPAS REQUIS PAR JOUR (7 jours, Lundi à Dimanche):
${fieldDirectives}
CRITIQUE: Ne jamais mettre null pour un repas marqué "obligatoire". Chaque jour doit avoir exactement les champs ci-dessus.

NIVEAU DE DIFFICULTÉ — RESPECTER STRICTEMENT:
${diffInstruction}
Définitions: ${diffTimings}

═══ RÈGLES PAR TYPE DE REPAS ═══

DÉJEUNER (breakfast) = repas du matin rapide et nutritif:
• Format compact: 4-5 ingrédients, 2 étapes, description 10 mots max
• Exemples: bol de gruau banane-beurre d'amande-cannelle | toast avocat-œuf poché-flocons de chili | smoothie bowl mangue-gingembre-graines de chia | omelette feta-épinards-herbes fraîches | yogourt grec-granola-fruits rouges-miel

DÎNER (lunch, midi) = repas froid/tiède facile à préparer à l'avance ou apporter:
• Format compact: 5-6 ingrédients, 2-3 étapes, description 12 mots max
• TYPES OBLIGATOIRES: sandwich, wrap, salade-repas, bol froid, pita, bento ou soupe+pain — PAS un sauté chaud de restaurant
• Exemples: wrap de poulet pesto-tomates séchées-roquette | sandwich thon-avocat-câpres sur pain de seigle | bol de quinoa poulet-feta-olives-citron | salade de lentilles aux herbes et vinaigrette moutarde | pita falafels-houmous-taboulé | bento saumon-riz-crudités-sésame

SOUPER (dinner) = repas principal chaud, savoureux et bien assaisonné:
• Format riche: 7-8 ingrédients, 3 étapes précises, description 15-20 mots
• Épices/herbes obligatoires (ex: cumin, paprika fumé, zaatar, gingembre, coriandre, garam masala, tamari, harissa, sumac)
• Protéines à varier (inclure des végétales!): poulet, bœuf, porc, agneau, saumon, crevettes, tilapia, morue ET tofu ferme, tempeh, seitan, lentilles, pois chiches, haricots noirs, edamame, œufs
• Exemples végétaux inspirants: tofu croustillant tamari-sésame + bok choy sauté + riz jasmin | tempeh miso-érable + brocoli caramélisé + quinoa | curry rouge pois chiches-épinards + riz basmati | lentilles beluga sauce tomate-harissa + couscous | seitan grillé marinade chimichurri + patate douce rôtie | dhal de lentilles corail au lait de coco + naan grillé
• Exemples avec protéines animales: saumon poché lait de coco-curry rouge + basmati à la citronnelle | poulet tikka masala maison + naan | bowl zaatar-sumac poulet + houmous + tabboulé | crevettes sautées à l'ail-citron-persil + linguines | agneau braisé aux épices marocaines + couscous

RÈGLES DE VARIÉTÉ — CRITIQUE:
1. MÊME JOURNÉE: jamais le même ingrédient vedette (légume, protéine, féculent) dans deux repas du même jour. Si lunch=épinards → souper SANS épinards. Si lunch=poulet → souper SANS poulet. Si lunch=quinoa → souper SANS quinoa.
2. JOURS CONSÉCUTIFS: distribuer les protéines et légumes sur la semaine — éviter le même légume principal 2 jours de suite, alterner les protéines (ex: poulet lundi → bœuf mardi → poisson mercredi → légumineuses jeudi...).
3. DIVERSITÉ MAXIMUM: viser à n'utiliser le même ingrédient principal (épinards, brocoli, pois chiches, etc.) que 2 fois max sur la semaine entière.

ANREF CANADA — OBJECTIFS NUTRITIONNELS PAR JOUR PAR PERSONNE (adultes 19-50 ans):
- Énergie: 1800-2200 kcal (viser ~2000 kcal pour 1 personne, multiplier par ${N})
- Protéines: ≥52g (0.8g/kg; inclure au moins 20g/repas principal)
- Glucides: ≥130g (favoriser glucides complexes: avoine, riz brun, quinoa, légumineuses)
- Lipides: 44-78g (20-35% des calories; huile d'olive, noix, avocat)
- Fibres: ≥28g (légumes, légumineuses, grains entiers)
- Calcium: ≥1000mg (produits laitiers, légumes verts, tofu au calcium)
- Vitamines: inclure ≥2 légumes colorés différents par jour
- Minimum 2 soupers végétariens riches en protéines + 1 souper poisson par semaine

MAXIMISER LES ÉCONOMIES — OBJECTIF: économiser 50$+/semaine vs épicerie standard:
- PROTÉINES BUDGET: prioriser œufs (~0.30$/portion), légumineuses sèches (~0.20$/portion), tofu (~0.80$/portion), cuisses de poulet > poitrines (30% moins cher), thon/sardines en conserve
- LÉGUMES SAISON (mai-sept): asperges, courgettes, maïs, tomates, poivrons, fraises — (oct-avr): chou, carottes, pommes de terre, navet, courge, pommes
- ACHATS EN VRAC: flocons d'avoine, riz long grain, lentilles, pâtes, farine — jamais en format individuel
- RÉUTILISATION INTELLIGENTE: si tu cuisines un poulet entier, planifier les restes le lendemain (ex: poulet rôti lundi soir → sandwich poulet mardi midi)
- ÉVITER: ingrédients premium inutiles (truffe, safran, burrata, saumon fumé) sauf si dans le frigo
- FORMAT GROS: préférer 4L de lait, 5kg riz, 2kg avoine — mentionner "format grand format" dans les ingrédients quand pertinent
- LÉGUMINEUSES comme protéine principale ≥3x/semaine

RÉPONDS UNIQUEMENT AVEC DU JSON VALIDE — zéro texte avant ou après, zéro markdown.
Format: {"days":[{"dayName":"Lundi","breakfast":...,"lunch":...,"dinner":...,"dailyNutrition":{"calories":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number}}, ×7 jours],"estimatedCost":number}
Chaque recette: {"name":"...","description":"...","cookingTime":number,"servings":${N},"ingredients":["..."],"instructions":["..."],"estimatedCost":number,"difficultyLevel":"Facile"|"Moyen"|"Avancé"}
Le champ dailyNutrition = valeurs estimées pour 1 personne/jour selon les ANREF. Viser: ~2000 kcal, ~55g protéines, ~250g glucides, ~65g lipides, ~30g fibres.
Commence IMMÉDIATEMENT par { sans aucun texte avant.`;


    const { client: openai, model } = getOpenAI();
    req.log.info({ model }, "Generating menu with model");

    const stream = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 3500,
    });

    let fullContent = "";
    let charsSinceLastPing = 0;
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      fullContent += token;
      charsSinceLastPing += token.length;
      if (charsSinceLastPing >= 150) {
        send({ status: "generating" });
        charsSinceLastPing = 0;
      }
    }

    // Extraire et réparer le JSON de la réponse IA
    req.log.info({ contentLength: fullContent.length, preview: fullContent.slice(0, 300) }, "AI raw response preview");

    let rawJson = fullContent.trim();

    // 1. Retirer les blocs markdown ```json ... ``` si présents
    const mdMatch = rawJson.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) rawJson = mdMatch[1].trim();

    // 2. Trouver le premier { jusqu'au dernier }
    const jsonStart = rawJson.indexOf("{");
    if (jsonStart === -1) {
      req.log.error({ preview: rawJson.slice(0, 500) }, "No JSON object found in AI response");
      throw new Error("No JSON found in AI response");
    }
    rawJson = rawJson.slice(jsonStart);

    // 3. Essayer de parser directement
    let menuData: { days: object[]; estimatedCost: number };
    try {
      // Chercher le dernier } valide
      const jsonEnd = rawJson.lastIndexOf("}");
      const candidate = jsonEnd > 0 ? rawJson.slice(0, jsonEnd + 1) : rawJson;
      menuData = JSON.parse(candidate);
    } catch (parseErr) {
      // 4. Tentative de réparation : le JSON a peut-être été tronqué par max_tokens
      req.log.warn({ parseErr, rawJsonLength: rawJson.length, tail: rawJson.slice(-200) }, "JSON parse failed, attempting repair");

      // Fermer les structures ouvertes (tableaux et objets) pour réparer un JSON tronqué
      let depth = 0;
      let inString = false;
      let escaped = false;
      const stack: string[] = [];
      for (const ch of rawJson) {
        if (escaped) { escaped = false; continue; }
        if (ch === "\\" && inString) { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") { stack.push("}"); depth++; }
        else if (ch === "[") { stack.push("]"); depth++; }
        else if (ch === "}" || ch === "]") { stack.pop(); depth--; }
      }
      // Enlever la virgule trailing si présente
      const repaired = rawJson.trimEnd().replace(/,\s*$/, "") + stack.reverse().join("");
      try {
        menuData = JSON.parse(repaired);
        req.log.info({ repairedLength: repaired.length }, "JSON repair succeeded");
      } catch {
        req.log.error({ rawJsonPreview: rawJson.slice(0, 500), repairedPreview: repaired.slice(-200) }, "JSON repair failed");
        throw new Error("No JSON found in AI response");
      }
    }

    const weekStart = new Date().toISOString().split("T")[0];
    const [savedMenu] = await db
      .insert(weeklyMenusTable)
      .values({
        userId,
        weekStart,
        days: menuData.days,
        estimatedCost: menuData.estimatedCost ?? 0,
      })
      .returning();

    const result = GenerateMenuResponse.safeParse({
      id: savedMenu.id,
      weekStart: savedMenu.weekStart,
      days: savedMenu.days,
      estimatedCost: savedMenu.estimatedCost,
      generatedAt: savedMenu.generatedAt.toISOString(),
    });

    send({
      status: "done",
      menu: result.success ? result.data : {
        id: savedMenu.id,
        weekStart: savedMenu.weekStart,
        days: savedMenu.days,
        estimatedCost: Number(savedMenu.estimatedCost) || 0,
        generatedAt: savedMenu.generatedAt.toISOString(),
      },
    });
    res.end();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStatus = (err as { status?: number }).status ?? 0;
    req.log.error({ err, errMsg, errStatus }, "Menu generation failed");
    let userMsg: string;
    if (errStatus === 401 || errStatus === 403 || errMsg.includes("API key") || errMsg.includes("auth")) {
      userMsg = "Clé API IA invalide (401/403) — vérifiez votre clé.";
    } else if (errStatus === 400) {
      const onReplit = !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT_ID);
      const provider = process.env.GEMINI_API_KEY ? "Gemini" : process.env.GROQ_API_KEY ? "Groq" : "OpenAI";
      userMsg = onReplit
        ? "Erreur 400 du proxy Replit — modèle incorrect."
        : `Erreur 400 de ${provider} — clé incorrecte ou modèle invalide.`;
    } else if (errStatus === 413) {
      userMsg = "Menu trop grand pour ce modèle IA — réessayez dans quelques secondes.";
    } else if (errStatus === 429) {
      userMsg = "Limite de quota atteinte — réessayez dans quelques instants.";
    } else if (errMsg.includes("No JSON") || errMsg.toLowerCase().includes("json") || errMsg.includes("parse") || errMsg.includes("Unexpected")) {
      userMsg = `Format invalide — réessayez dans quelques secondes.`;
    } else {
      userMsg = `Erreur lors de la génération (${errStatus || errMsg.slice(0, 80)})`;
    }
    send({ status: "error", message: userMsg });
    res.end();
    return;
  }
});

router.get("/menu/current", async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const [menu] = await db
    .select()
    .from(weeklyMenusTable)
    .where(eq(weeklyMenusTable.userId, userId))
    .orderBy(desc(weeklyMenusTable.generatedAt))
    .limit(1);

  if (!menu) {
    res.json(GetCurrentMenuResponse.parse({ found: false }));
    return;
  }

  const menuPayload = {
    found: true,
    menu: {
      id: menu.id,
      weekStart: menu.weekStart,
      days: menu.days,
      estimatedCost: Number(menu.estimatedCost) || 0,
      generatedAt: menu.generatedAt.toISOString(),
    },
  };
  const parsed = GetCurrentMenuResponse.safeParse(menuPayload);
  res.json(parsed.success ? parsed.data : menuPayload);
});

router.delete("/menu/current", async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const [latest] = await db
    .select()
    .from(weeklyMenusTable)
    .where(eq(weeklyMenusTable.userId, userId))
    .orderBy(desc(weeklyMenusTable.generatedAt))
    .limit(1);

  if (!latest) {
    res.status(404).json({ error: "Aucun menu à supprimer" });
    return;
  }

  await db.delete(weeklyMenusTable).where(and(eq(weeklyMenusTable.id, latest.id), eq(weeklyMenusTable.userId, userId)));
  res.json({ success: true });
});

router.get("/menu/shopping-list", async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const [menu] = await db
    .select()
    .from(weeklyMenusTable)
    .where(eq(weeklyMenusTable.userId, userId))
    .orderBy(desc(weeklyMenusTable.generatedAt))
    .limit(1);

  if (!menu) {
    res.json([]);
    return;
  }

  const fridgeItems = await db
    .select()
    .from(fridgeIngredientsTable)
    .where(eq(fridgeIngredientsTable.userId, userId));
  const fridgeNames = fridgeItems.map(i => i.name.toLowerCase().trim());

  const ingredientMap = new Map<string, { quantity: string; unit: string; estimatedPrice: number }>();

  const days = menu.days as Array<{
    dayName: string;
    breakfast: { ingredients: string[] };
    lunch: { ingredients: string[] };
    dinner: { ingredients: string[] };
  }>;

  for (const day of days) {
    for (const meal of [day.breakfast, day.lunch, day.dinner]) {
      for (const ingredient of (meal?.ingredients ?? [])) {
        const name = ingredient.toLowerCase().trim();
        if (!ingredientMap.has(name)) {
          ingredientMap.set(name, {
            quantity: "1",
            unit: "unité",
            estimatedPrice: 2 + Math.random() * 5,
          });
        }
      }
    }
  }

  const shoppingList = Array.from(ingredientMap.entries()).map(([name, data]) => {
    const category = getCategoryForIngredient(name);
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      quantity: data.quantity,
      unit: data.unit,
      category,
      estimatedPrice: Math.round(data.estimatedPrice * 100) / 100,
      inFridge: fridgeNames.some(f => f.includes(name) || name.includes(f)),
    };
  });

  res.json(GetShoppingListResponse.parse(shoppingList));
});

// Catégories ordonnées du plus spécifique au plus général.
// Les premiers matchs gagnent — placez les phrases composées AVANT les mots simples.
const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  // Doit passer avant "Produits laitiers" (sinon "beurre" matche) et avant "Épices & Condiments"
  {
    category: "Tartinades & Beurres de noix",
    keywords: [
      "beurre d'arachide", "beurre d arachide", "beurre de noix", "beurre d'amande",
      "beurre d amande", "beurre de cajou", "beurre de tournesol", "beurre de noisette",
      "tahini", "tahin", "nutella", "pâte à tartiner", "pate a tartiner", "confiture",
      "gelée", "gelee", "marmelade", "miel", "sirop d'érable", "sirop d erable",
    ],
  },
  // Avant "Légumes" (haricot/pois/tomate) et "Produits laitiers"
  {
    category: "Conserves & Bocaux",
    keywords: [
      "en conserve", "en boîte", "en boite", "en bocal",
      "tomates en conserve", "haricots en conserve", "pois chiches en conserve",
      "thon en conserve", "maïs en conserve", "olives", "cornichons",
      "soupe en conserve", "lait de coco",
    ],
  },
  // Légumineuses séparées des légumes (pois chiches, lentilles…)
  {
    category: "Légumineuses",
    keywords: [
      "pois chiche", "lentille", "haricot rouge", "haricot noir", "haricot blanc",
      "haricot pinto", "fève", "feve", "edamame", "soya", "soja", "tofu", "tempeh",
    ],
  },
  // Noix et graines (avant Épices)
  {
    category: "Noix & Graines",
    keywords: [
      "amande", "noix", "noisette", "pistache", "cajou", "pacane", "pignon",
      "graine de tournesol", "graine de citrouille", "graine de chia", "graine de lin",
      "graine de sésame", "sésame", "sesame", "arachide", "pépite",
    ],
  },
  // Boulangerie (avant Féculents pour "pain")
  {
    category: "Boulangerie",
    keywords: [
      "pain", "baguette", "bagel", "brioche", "croissant", "tortilla", "pita",
      "naan", "muffin anglais", "ciabatta",
    ],
  },
  // Poissons & fruits de mer (avant Viandes)
  {
    category: "Poissons & Fruits de mer",
    keywords: [
      "saumon", "thon", "crevette", "morue", "tilapia", "doré", "dore", "homard",
      "crabe", "pétoncle", "petoncle", "moule", "huître", "huitre", "calmar",
      "sardine", "maquereau", "truite", "hareng", "anchois", "poisson",
    ],
  },
  // Viandes
  {
    category: "Viandes",
    keywords: [
      "poulet", "bœuf", "boeuf", "porc", "dinde", "veau", "agneau", "bacon",
      "saucisse", "jambon", "bison", "canard", "lapin", "côtelette", "cotelette",
      "steak", "haché", "hache", "rôti", "roti", "filet", "escalope", "merguez",
      "chorizo", "salami", "pepperoni", "prosciutto",
    ],
  },
  // Produits laitiers — APRÈS tartinades et boulangerie pour éviter les faux positifs
  {
    category: "Produits laitiers & Œufs",
    keywords: [
      "lait", "fromage", "cheddar", "mozzarella", "parmesan", "feta", "ricotta",
      "brie", "camembert", "yaourt", "yogourt", "beurre", "crème", "creme",
      "œuf", "oeuf", "kéfir", "kefir", "skyr",
    ],
  },
  // Fruits (avant Légumes pour éviter chevauchement avec "tomate")
  {
    category: "Fruits",
    keywords: [
      "pomme", "banane", "orange", "citron", "lime", "fraise", "bleuet",
      "framboise", "mûre", "mure", "raisin", "pêche", "peche", "poire", "mangue",
      "ananas", "kiwi", "melon", "pastèque", "pasteque", "abricot", "prune",
      "cerise", "papaye", "grenade", "figue", "datte", "canneberge",
    ],
  },
  // Légumes
  {
    category: "Légumes",
    keywords: [
      "carotte", "tomate", "oignon", "échalote", "echalote", "ail", "poivron",
      "brocoli", "chou-fleur", "chou", "épinard", "epinard", "laitue", "roquette",
      "concombre", "céleri", "celeri", "poireau", "courgette", "zucchini",
      "aubergine", "champignon", "radis", "betterave", "navet", "rutabaga",
      "panais", "courge", "citrouille", "asperge", "artichaut", "fenouil",
      "maïs", "mais", "pomme de terre", "patate", "igname",
      "gingembre", "persil", "coriandre", "basilic", "menthe", "ciboulette",
      "estragon", "thym frais", "romarin frais",
    ],
  },
  // Féculents & céréales (sans pain)
  {
    category: "Féculents & Céréales",
    keywords: [
      "riz", "pâtes", "pates", "spaghetti", "macaroni", "lasagne", "linguine",
      "penne", "fusilli", "nouilles", "couscous", "quinoa", "orge", "avoine",
      "boulgour", "millet", "sarrasin", "céréales", "cereales", "granola",
      "farine", "semoule",
    ],
  },
  // Huiles & vinaigres
  {
    category: "Huiles & Vinaigres",
    keywords: [
      "huile", "vinaigre",
    ],
  },
  // Épices, herbes séchées et condiments
  {
    category: "Épices & Condiments",
    keywords: [
      "sel", "poivre", "épice", "epice", "herbe", "sauce", "moutarde", "ketchup",
      "mayonnaise", "mayo", "soya", "tamari", "sriracha", "tabasco", "harissa",
      "pesto", "salsa", "wasabi", "raifort", "câpre", "capre", "curry", "paprika",
      "cumin", "cannelle", "muscade", "clou de girofle", "cardamome", "safran",
      "origan", "thym", "romarin", "laurier", "anis", "fenouil moulu",
      "bouillon", "cube de bouillon", "ail en poudre", "oignon en poudre",
    ],
  },
  // Boissons
  {
    category: "Boissons",
    keywords: [
      "jus", "café", "cafe", "thé", "the", "eau", "boisson", "vin", "bière", "biere",
      "soda", "limonade", "lait d'amande", "lait de soya", "lait d'avoine",
    ],
  },
  // Sucres & desserts
  {
    category: "Sucres & Desserts",
    keywords: [
      "sucre", "cassonade", "chocolat", "cacao", "vanille", "levure", "poudre à pâte",
      "poudre a pate", "bicarbonate", "fécule", "fecule", "biscuit", "gâteau", "gateau",
      "tarte", "muffin",
    ],
  },
  // Surgelés (mot-clé explicite)
  {
    category: "Surgelés",
    keywords: ["surgelé", "surgele", "congelé", "congele"],
  },
];

function getCategoryForIngredient(name: string): string {
  const n = name.toLowerCase();
  for (const { category, keywords } of CATEGORY_RULES) {
    if (keywords.some(k => n.includes(k))) {
      return category;
    }
  }
  return "Autres";
}

export default router;
