import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { db, fridgeIngredientsTable, userPreferencesTable, weeklyMenusTable } from "@workspace/db";
import {
  GenerateMenuResponse,
  GetCurrentMenuResponse,
  GetShoppingListResponse,
} from "@workspace/api-zod";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

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
  // llama-3.1-8b-instant : ~750 tokens/sec (vs ~330 pour 70b) → passe sous le timeout Vercel de 10s
  if (process.env.GROQ_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: process.env.OPENAI_MODEL ?? "llama-3.1-8b-instant",
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
      difficultyPreference: "Moyen",
    };

    const selectedMeals = preferences.mealTypes && preferences.mealTypes.length > 0
      ? preferences.mealTypes as string[]
      : ["breakfast", "lunch", "dinner"];
    const mealLabels: Record<string, string> = {
      breakfast: "déjeuner (matin)",
      lunch: "dîner (midi)",
      dinner: "souper (soir)",
    };
    const mealsToGenerate = selectedMeals
      .map((k) => mealLabels[k] ?? k)
      .join(", ");

    const ingredientList = ingredients.length > 0
      ? ingredients.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(", ")
      : "Aucun ingrédient spécifié – proposer des repas simples avec des ingrédients courants";

    const seed = Math.floor(Math.random() * 1_000_000);

    const N = preferences.numberOfPeople;
    const diff = preferences.difficultyPreference ?? "Moyen";
    const allergiesStr = (preferences.allergies as string[]).length > 0 ? (preferences.allergies as string[]).join(", ") : "aucune";
    const regimeStr = (preferences.dietaryPreferences as string[]).length > 0 ? (preferences.dietaryPreferences as string[]).join(", ") : "aucun";
    const cuisinesStr = (preferences.cuisinePreferences as string[]).length > 0 ? (preferences.cuisinePreferences as string[]).join(", ") : "variées";

    const prompt = `Tu es un chef cuisinier expert. Crée un menu de 7 jours pour ${N} personne(s) avec des recettes savoureuses et bien assaisonnées. Seed:${seed}.

PROFIL UTILISATEUR:
- Budget: ${preferences.weeklyBudget}$ CAD/sem | Temps: ${preferences.cookingTimePerDay} min/jour
- Allergies STRICTES (ne jamais inclure): ${allergiesStr}
- Régime: ${regimeStr} | Cuisines: ${cuisinesStr}
- Ingrédients au frigo à utiliser en priorité: ${ingredientList}

REPAS À GÉNÉRER: ${mealsToGenerate}. Repas non demandés = JSON null.

NIVEAU: ${diff} (Facile ≤25 min / Moyen 25-45 min / Avancé 45+ min). Varie un peu pour éviter la monotonie.

RÈGLES DE QUALITÉ — C'EST CRUCIAL:
Les recettes DOIVENT avoir des épices, herbes et assaisonnements précis. Jamais de recette fade.
Exemples de bonnes recettes à imiter:
• "Tofu croustillant au tamari-gingembre, bok choy sauté et riz jasmin" — protéine: tofu mariné tamari+gingembre+ail, cuit à feu vif pour croûte dorée
• "Saumon poché lait de coco et curry rouge, riz basmati à la citronnelle" — épices: pâte curry rouge, lait de coco, zeste lime, coriandre fraîche
• "Tempeh sauté sauce miso-érable, brocoli caramélisé, quinoa aux herbes" — marinade: miso blanc, sirop d'érable, vinaigre de riz, flocons de chili
• "Poulet tikka masala maison, naan grillé" — épices: garam masala, cumin, coriandre, paprika fumé, gingembre frais, yogourt grec
• "Bowl méditerranéen au poulet zaatar, houmous, tabboulé" — épices: zaatar, sumac, persil, citron confit

RÈGLES NUTRITIONNELLES:
- Aucune recette répétée, varier protéines chaque jour (poulet, bœuf, poisson, crevettes, tofu, tempeh, lentilles, pois chiches, œufs)
- ≥20g protéines/portion; légumes colorés + féculent à chaque repas principal
- Min 2 végétariens (riches en protéines) + 1 poisson dans la semaine

INGRÉDIENTS — INCLURE OBLIGATOIREMENT:
1. Protéine principale avec quantité précise (ex: "400 g de cuisse de poulet désossée", "250 g de tempeh", "300 g de filet de saumon")
2. Légume(s) principaux avec quantité (ex: "2 tasses de brocoli en fleurettes", "1 poivron rouge tranché")
3. Féculent (ex: "200 g de riz basmati", "150 g de quinoa rouge", "200 g de pâtes de blé entier")
4. Aromatics: ail, oignon, échalote, gingembre frais (ex: "3 gousses d'ail émincées", "1 c. à soupe de gingembre frais râpé")
5. Épices/herbes PRÉCISES (ex: "1 c. à thé de cumin moulu", "1/2 c. à thé de paprika fumé", "2 c. à soupe de zaatar")
6. Sauce/liquide/gras (ex: "2 c. à soupe de tamari", "400 ml de lait de coco", "2 c. à soupe d'huile d'olive extra vierge")
7. Élément acide ou umami final (ex: "jus de 1 citron", "2 c. à soupe de vinaigre balsamique", "30 g de parmesan râpé")
Liste 7 à 9 ingrédients par recette.

INSTRUCTIONS: 3 étapes précises avec techniques, temps et températures.
DESCRIPTION: 1 phrase appétissante de 15-25 mots.
NOM: créatif et spécifique (inclure technique ou épice distinctive).

RÉPONDS UNIQUEMENT AVEC DU JSON VALIDE — aucun texte avant ou après, aucun bloc markdown.
Structure: {"days":[{"dayName":"Lundi","breakfast":RECETTE_OU_null,"lunch":RECETTE_OU_null,"dinner":RECETTE_OU_null},... 7 jours Lundi-Dimanche ...],"estimatedCost":number}
Chaque recette: {"name":"...","description":"...","cookingTime":number,"servings":${N},"ingredients":["..."],"instructions":["...","...","..."],"estimatedCost":number,"difficultyLevel":"Facile"|"Moyen"|"Avancé"}
Commence par { directement.`;


    const { client: openai, model } = getOpenAI();
    req.log.info({ model }, "Generating menu with model");

    const stream = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 4096,
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
