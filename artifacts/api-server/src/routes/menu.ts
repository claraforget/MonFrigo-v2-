import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { db, fridgeIngredientsTable, userPreferencesTable, weeklyMenusTable } from "@workspace/db";
import {
  GenerateMenuResponse,
  GetCurrentMenuResponse,
  GetShoppingListResponse,
} from "@workspace/api-zod";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

function getOpenAI(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error("OpenAI integration env vars not set");
  }
  return new OpenAI({ baseURL, apiKey });
}

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

router.post("/menu/generate", async (req, res): Promise<void> => {
  const ingredients = await db.select().from(fridgeIngredientsTable);
  const [prefs] = await db.select().from(userPreferencesTable).limit(1);

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
  const [menu] = await db
    .select()
    .from(weeklyMenusTable)
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

router.get("/menu/shopping-list", async (req, res): Promise<void> => {
  const [menu] = await db
    .select()
    .from(weeklyMenusTable)
    .orderBy(desc(weeklyMenusTable.generatedAt))
    .limit(1);

  if (!menu) {
    res.json([]);
    return;
  }

  const fridgeItems = await db.select().from(fridgeIngredientsTable);
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

function getCategoryForIngredient(name: string): string {
  const categories: Record<string, string[]> = {
    "Légumes": ["carotte", "tomate", "oignon", "ail", "poivron", "brocoli", "épinard", "laitue", "concombre", "céleri", "poireau", "courgette", "aubergine", "haricot", "pois", "maïs", "pomme de terre", "patate"],
    "Fruits": ["pomme", "banane", "orange", "citron", "lime", "fraise", "bleuet", "framboise", "raisin", "pêche", "poire", "mangue", "ananas"],
    "Viandes": ["poulet", "bœuf", "porc", "dinde", "veau", "agneau", "bacon", "saucisse", "jambon", "bison"],
    "Poissons & Fruits de mer": ["saumon", "thon", "crevette", "morue", "tilapia", "doré", "homard", "crabe", "pétoncle"],
    "Produits laitiers": ["lait", "fromage", "yaourt", "yogourt", "beurre", "crème", "œuf", "oeuf"],
    "Féculents": ["riz", "pâtes", "pain", "farine", "couscous", "quinoa", "orge", "avoine", "céréale"],
    "Épices & Condiments": ["sel", "poivre", "herbe", "épice", "sauce", "vinaigre", "huile", "moutarde", "ketchup", "mayo", "sirop"],
    "Conserves": ["conserve", "boîte", "tomate en", "haricot en", "pois en"],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(k => name.includes(k))) {
      return category;
    }
  }

  return "Autres";
}

export default router;
