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
  const ingredients = await db
    .select()
    .from(fridgeIngredientsTable)
    .where(eq(fridgeIngredientsTable.userId, userId));
  const [prefs] = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId))
    .limit(1);

  const preferences = prefs ?? {
    cookingTimePerDay: 45,
    weeklyBudget: 150,
    numberOfPeople: 2,
    allergies: [],
    dietaryPreferences: [],
    cuisinePreferences: [],
    mealTypes: ["breakfast", "lunch", "dinner"],
  };

  const selectedMeals = preferences.mealTypes && preferences.mealTypes.length > 0
    ? preferences.mealTypes
    : ["breakfast", "lunch", "dinner"];
  const mealLabels: Record<string, string> = {
    breakfast: "déjeuner (matin)",
    lunch: "dîner (midi)",
    dinner: "souper (soir)",
  };
  const mealsToGenerate = selectedMeals
    .map((k) => mealLabels[k] ?? k)
    .join(", ");
  const totalRecipes = selectedMeals.length * 7;

  const ingredientList = ingredients.length > 0
    ? ingredients.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(", ")
    : "Aucun ingrédient spécifié – proposer des repas simples avec des ingrédients courants";

  const seed = Math.floor(Math.random() * 1_000_000);

  const prompt = `Tu es chef cuisinier québécois. Génère un menu de 7 jours pour ${preferences.numberOfPeople} personne(s). Seed: ${seed}.

PROFIL:
- Budget: ${preferences.weeklyBudget} $ CAD/semaine
- Temps max/jour: ${preferences.cookingTimePerDay} min
- Allergies (STRICT): ${preferences.allergies.length > 0 ? preferences.allergies.join(", ") : "aucune"}
- Préférences: ${preferences.dietaryPreferences.length > 0 ? preferences.dietaryPreferences.join(", ") : "aucune"}
- Cuisines: ${preferences.cuisinePreferences.length > 0 ? preferences.cuisinePreferences.join(", ") : "variées"}
- Ingrédients au frigo: ${ingredientList}

REPAS À GÉNÉRER: ${mealsToGenerate}. Tout autre repas = null.

RÈGLES NUTRITIONNELLES (OBLIGATOIRES):
- Minimum 20 g de protéines par portion dans chaque recette (viande, poisson, légumineuses, tofu, œufs, yogourt grec — jamais que du fromage ou des glucides)
- Chaque recette doit inclure des légumes variés et colorés (ou un fruit le matin au déjeuner)
- Chaque repas principal doit inclure un féculent (riz, quinoa, pâtes de blé entier, patate douce, pain de grains entiers, etc.) ou mentionner un accompagnement suggéré dans la description
- Aucune recette répétée dans la semaine
- Varier les sources de protéines chaque jour
- Utiliser en priorité les ingrédients du frigo
- Instructions: 3-4 étapes précises avec quantités et temps (ex: "Chauffer 1 c.s. d'huile à feu vif, saisir le poulet 3 min par côté jusqu'à doré")
- Ingrédients: format "quantité + unité + ingrédient" (ex: "200 g de poitrine de poulet")
- description: 1 phrase appétissante
- Minimum 2 repas végétariens (riches en protéines) et 1 repas de poisson dans la semaine

Réponds SEULEMENT avec ce JSON (sans markdown):
{"days":[{"dayName":"Lundi","breakfast":{"name":"...","description":"...","cookingTime":15,"servings":${preferences.numberOfPeople},"ingredients":["..."],"instructions":["..."],"estimatedCost":4.50},"lunch":{"name":"...","description":"...","cookingTime":20,"servings":${preferences.numberOfPeople},"ingredients":["..."],"instructions":["..."],"estimatedCost":6.00},"dinner":{"name":"...","description":"...","cookingTime":30,"servings":${preferences.numberOfPeople},"ingredients":["..."],"instructions":["..."],"estimatedCost":9.00}},{"dayName":"Mardi",...},{"dayName":"Mercredi",...},{"dayName":"Jeudi",...},{"dayName":"Vendredi",...},{"dayName":"Samedi",...},{"dayName":"Dimanche",...}],"estimatedCost":120.00}
Les repas non demandés sont null. Inclure les 7 jours.`;

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
    const { client: openai, model } = getOpenAI();
    req.log.info({ model }, "Generating menu with model");

    const stream = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 8000,
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

    // Extraire le JSON de la réponse — gérer les blocs markdown et les réponses partielles
    let rawJson = fullContent.trim();
    // Retirer les blocs ```json ... ``` si présents
    const mdMatch = rawJson.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) rawJson = mdMatch[1].trim();
    // Trouver le premier { jusqu'au dernier }
    const start = rawJson.indexOf("{");
    const end = rawJson.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      req.log.error({ fullContentLength: fullContent.length, preview: fullContent.slice(0, 200) }, "No JSON found");
      throw new Error("No JSON found in AI response");
    }
    rawJson = rawJson.slice(start, end + 1);
    const menuData: { days: object[]; estimatedCost: number } = JSON.parse(rawJson);

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
