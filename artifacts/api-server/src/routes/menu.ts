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

  const prompt = `Tu es un chef cuisinier québécois passionné, auteur de livres de recettes, et nutritionniste diplômé. Tu rédiges des menus hebdomadaires pour ${preferences.numberOfPeople} personne(s), comme si tu écrivais pour un blogue culinaire professionnel (style Trois fois par jour, Le Coup de Grâce, ou Mordu de Radio-Canada).

━━━ PROFIL DU FOYER ━━━
• Temps max de cuisson par jour : ${preferences.cookingTimePerDay} min
• Budget hebdomadaire : ${preferences.weeklyBudget} $ CAD
• Nombre de personnes : ${preferences.numberOfPeople}
• Allergies (STRICT — ne jamais inclure) : ${preferences.allergies.length > 0 ? preferences.allergies.join(", ") : "aucune"}
• Préférences alimentaires : ${preferences.dietaryPreferences.length > 0 ? preferences.dietaryPreferences.join(", ") : "aucune restriction"}
• Cuisines préférées : ${preferences.cuisinePreferences.length > 0 ? preferences.cuisinePreferences.join(", ") : "toutes les cuisines du monde"}
• Ingrédients disponibles au frigo : ${ingredientList}

━━━ REPAS À GÉNÉRER ━━━
• Génère UNIQUEMENT : ${mealsToGenerate}
• Pour tout repas NON listé ci-dessus : mettre null dans le JSON

━━━ QUALITÉ DES RECETTES — CRITIQUE ━━━
Chaque recette doit être PRÉCISE et ACTIONNABLE, comme dans un vrai livre de recettes. Interdit :
✗ "Cuire le quinoa" → ✓ "Rincer 180 ml (3/4 tasse) de quinoa sous l'eau froide. Porter 360 ml d'eau salée à ébullition, ajouter le quinoa, couvrir et réduire à feu doux. Cuire 15 min jusqu'à absorption complète, puis retirer du feu et laisser gonfler 5 min à couvert."
✗ "Assaisonner" → ✓ "Assaisonner de 1/2 c. à thé de sel kasher et d'un généreux tour de moulin à poivre."
✗ "Chauffer l'huile" → ✓ "Chauffer 15 ml (1 c. à soupe) d'huile d'olive à feu moyen-vif dans une poêle en fonte jusqu'à ce qu'elle commence à frémir légèrement."
✗ "Cuire jusqu'à doré" → ✓ "Saisir 3-4 minutes sans bouger, jusqu'à ce qu'une belle croûte dorée se forme et que la viande se détache naturellement de la poêle."

RÈGLES D'OR pour les instructions :
1. Chaque étape = UNE action concrète avec quantité, température, durée ET indice visuel/sensoriel
2. Minimum 6 étapes par recette (8-10 pour les plats principaux)
3. Toujours préciser : le format de coupe (brunoise, julienne, en dés de 1 cm, émincé finement), la température de cuisson (feu vif, moyen-vif, doux), la durée exacte, et le signe visuel de réussite
4. Mentionner les astuces de chef : "ne pas surcharger la poêle", "laisser reposer la viande 5 min avant de couper", "déglacer avec 60 ml de vin blanc pour décoller les sucs"

RÈGLES pour les ingrédients :
• Format : "quantité précise + unité + ingrédient + précision si nécessaire" → ex: "200 g de poitrine de poulet, coupée en lanières de 2 cm", "2 gousses d'ail, hachées finement", "1 boîte (400 ml) de lait de coco léger"
• Toujours inclure : huiles, épices, sel, poivre, herbes fraîches, garnitures

━━━ ÉQUILIBRE NUTRITIONNEL (Guide alimentaire canadien) ━━━
• Chaque repas principal : ½ légumes variés, ¼ protéines maigres, ¼ grains entiers
• Minimum 2 repas de poisson/fruits de mer dans la semaine
• Minimum 2 repas 100 % végétariens (tofu, légumineuses)
• Favoriser grains entiers : quinoa, riz brun, épeautre, pâtes intégrales, avoine
• Méthodes saines : vapeur, four, poché, sauté léger, grillé

━━━ VARIÉTÉ (${totalRecipes} recettes uniques) ━━━
• Aucune recette répétée dans la semaine
• Varier les protéines chaque jour (pas la même 2 jours de suite)
• Varier les cuisines : québécoise revisitée, méditerranéenne, asiatique, mexicaine, etc.
• Petits-déjeuners : alterner sucré/salé, chaud/froid, rapide/élaboré
• Inclure 1-2 plats québécois revisités en version santé (bol de bouillon, cipâte léger, tartine de fromage en grains, etc.)
• Graine créative de la semaine : ${seed} — chaque semaine doit être unique

━━━ PRIORITÉS PRATIQUES ━━━
• Utiliser EN PRIORITÉ les ingrédients du frigo (réduire le gaspillage)
• Jours de semaine : recettes ≤ 35 min, simples et rapides
• Weekend : recettes plus élaborées, techniques ou festives
• Répartir intelligemment le budget sur la semaine

Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de texte avant ou après) :
{
  "days": [
    {
      "dayName": "Lundi",
      "breakfast": {
        "name": "Nom accrocheur et appétissant",
        "description": "2-3 phrases évocatrices qui donnent envie de cuisiner : textures, saveurs, contexte",
        "cookingTime": 20,
        "servings": ${preferences.numberOfPeople},
        "ingredients": [
          "180 ml (3/4 tasse) de flocons d'avoine à cuisson rapide",
          "500 ml (2 tasses) de lait d'amande non sucré",
          "1 c. à soupe de sirop d'érable pur",
          "1/2 c. à thé de cannelle moulue",
          "1 pomme Cortland, pelée et coupée en petits dés"
        ],
        "instructions": [
          "Dans une casserole moyenne, porter le lait d'amande à ébullition à feu moyen en remuant de temps en temps pour éviter qu'il colle.",
          "Réduire le feu à moyen-doux et verser les flocons d'avoine en pluie. Remuer continuellement à la cuillère de bois.",
          "Cuire 3 à 4 minutes en remuant, jusqu'à ce que le gruau épaississe et que la consistance crémeuse se forme — il ne doit pas coller au fond.",
          "Pendant ce temps, faire sauter les dés de pomme dans une petite poêle avec 1 c. à thé de beurre et la cannelle, 2 minutes à feu vif, jusqu'à ce qu'ils soient légèrement caramélisés.",
          "Retirer le gruau du feu, incorporer le sirop d'érable et une pincée de sel.",
          "Servir dans des bols chauds, garnir des pommes caramélisées et d'un filet de sirop d'érable supplémentaire si désiré."
        ],
        "estimatedCost": 3.50
      },
      "lunch": null,
      "dinner": { "..." }
    }
  ],
  "estimatedCost": 115.00
}
Les 7 jours : Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi, Dimanche`;

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

    const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const menuData: { days: object[]; estimatedCost: number } = JSON.parse(jsonMatch[0]);

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
    } else if (errMsg.includes("No JSON") || errMsg.includes("JSON")) {
      userMsg = "La réponse IA n'est pas au bon format — réessayez.";
    } else {
      userMsg = `Erreur lors de la génération (${errStatus || errMsg.slice(0, 60)})`;
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
