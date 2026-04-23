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

function getOpenAI(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error("OpenAI integration env vars not set");
  }
  return new OpenAI({ baseURL, apiKey });
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
  };

  const ingredientList = ingredients.length > 0
    ? ingredients.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(", ")
    : "Aucun ingrédient spécifié – proposer des repas simples avec des ingrédients courants";

  const prompt = `Tu es un chef cuisinier québécois expert en planification de repas. Génère un menu complet pour 7 jours en JSON.

CONTRAINTES:
- Temps de cuisson max par jour: ${preferences.cookingTimePerDay} minutes
- Budget hebdomadaire: ${preferences.weeklyBudget}$ CAD
- Nombre de personnes: ${preferences.numberOfPeople}
- Allergies à éviter: ${preferences.allergies.length > 0 ? preferences.allergies.join(", ") : "aucune"}
- Préférences alimentaires: ${preferences.dietaryPreferences.length > 0 ? preferences.dietaryPreferences.join(", ") : "aucune"}
- Cuisines préférées: ${preferences.cuisinePreferences.length > 0 ? preferences.cuisinePreferences.join(", ") : "toutes les cuisines"}
- Ingrédients disponibles au frigo: ${ingredientList}

INSTRUCTIONS:
- Utilise en priorité les ingrédients du frigo
- Propose des recettes variées et savoureuses
- Inclus les recettes québécoises traditionnelles
- Assure-toi que la somme de tous les repas respecte le budget
- Répartis équitablement les temps de cuisson sur la semaine

Réponds UNIQUEMENT avec un JSON valide dans ce format exact:
{
  "days": [
    {
      "dayName": "Lundi",
      "breakfast": {
        "name": "...",
        "description": "...",
        "cookingTime": 15,
        "servings": 2,
        "ingredients": ["...", "..."],
        "instructions": ["...", "..."],
        "estimatedCost": 5.50
      },
      "lunch": { ... },
      "dinner": { ... }
    }
  ],
  "estimatedCost": 120.00
}

Les 7 jours doivent être: Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi, Dimanche`;

  const openai = getOpenAI();

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = completion.choices[0]?.message?.content ?? "";

  let menuData: { days: object[]; estimatedCost: number };
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    menuData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    req.log.error({ err: e, content }, "Failed to parse AI menu response");
    res.status(500).json({ error: "Erreur lors de la génération du menu" });
    return;
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

  res.json(GenerateMenuResponse.parse({
    id: savedMenu.id,
    weekStart: savedMenu.weekStart,
    days: savedMenu.days as object[],
    estimatedCost: savedMenu.estimatedCost,
    generatedAt: savedMenu.generatedAt.toISOString(),
  }));
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

  res.json(GetCurrentMenuResponse.parse({
    found: true,
    menu: {
      id: menu.id,
      weekStart: menu.weekStart,
      days: menu.days as object[],
      estimatedCost: menu.estimatedCost,
      generatedAt: menu.generatedAt.toISOString(),
    },
  }));
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
