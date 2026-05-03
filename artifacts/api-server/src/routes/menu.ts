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

    const prompt = `Tu es le chef cuisinier derrière un blogue culinaire québécois populaire — dans l'esprit de Trois fois par jour (Marilou), K pour Katrine et Passion Bouffe. Tu crées des recettes qui font envie : noms évocateurs, associations de saveurs audacieuses, textures contrastées, présentation soignée. Génère un menu de 7 jours pour ${N} personne(s). Seed:${seed}.

PROFIL:
- Budget: ${preferences.weeklyBudget}$ CAD/sem | Temps max: ${preferences.cookingTimePerDay} min/jour
- Allergies STRICTES: ${allergiesStr} | Régime: ${regimeStr} | Cuisines: ${cuisinesStr}
- Frigo disponible: ${ingredientList}

REPAS REQUIS PAR JOUR (7 jours, Lundi à Dimanche):
${fieldDirectives}
CRITIQUE: Ne jamais mettre null pour un repas marqué "obligatoire". Chaque jour doit avoir exactement les champs ci-dessus.

NIVEAU DE DIFFICULTÉ — RESPECTER STRICTEMENT:
${diffInstruction}
Définitions: ${diffTimings}

══════════════════════════════════════════
ADN CULINAIRE QUÉBÉCOIS — À INTÉGRER PARTOUT
══════════════════════════════════════════

SAVEURS SIGNATURES (utiliser généreusement):
• Sirop d'érable: dans les marinades (poulet, tofu, porc), les vinaigrettes, les sauces glacées
• Moutarde de Dijon: vinaigrettes, croûtes, sauces crémeuses
• Vinaigre de cidre de pomme: vinaigrettes, pickles rapides
• Beurre et ail dans tout ce qui saute — jamais d'huile seule sans aromates
• Cheddar vieilli, fromage en grains, ricotta, brie québécois
• Bacon, lardons, pancetta — même en petite quantité pour la profondeur
• Herbes fraîches EN FIN DE CUISSON: ciboulette, persil plat, basilic, aneth, coriandre

GARNITURES OBLIGATOIRES (au moins 1 par repas — comme au resto):
• Zeste de citron ou lime râpé sur les poissons et salades
• Graines de sésame grillées ou noix caramélisées sur les bols et salades
• Ciboulette fraîche ciselée sur les soupes, omelettes, risottos
• Flocons de piment rouge sur les pâtes et pizzas
• Filet d'huile d'olive extra-vierge ou de sésame grillé en finition
• Parmesan ou cheddar râpé sur les gratins et pâtes
• Piment jalapeño ou gochujang pour le kick

TECHNIQUE DES CONTRASTES (obligatoire dans chaque souper):
• CROQUANT + CRÉMEUX: panko sur poisson + sauce avocat | noix grillées sur salade + vinaigrette crémeuse
• FROID + CHAUD: salade fraîche sur protéine grillée chaude | crème fraîche sur soupe brûlante
• ACIDITÉ + RICHESSE: citron/lime sur viande grasse | vinaigre sur fromage fondu
• DOUCEUR + UMAMI: érable sur porc/tofu + tamari | miel sur feta + olives

══════════════════════════════════════════
RÈGLES PAR TYPE DE REPAS
══════════════════════════════════════════

DÉJEUNER (breakfast) — INSPIRANT, pas banal:
• 4-6 ingrédients AVEC QUANTITÉS PRÉCISES, 3 étapes, 12 mots de description max
• NOMS CRÉATIFS OBLIGATOIRES — jamais "Gruau simple" ou "Toast avocat":
  ✓ "Toast brioche avocat-œuf coulant, flocons de chili & ciboulette"
  ✓ "Bol de gruau banane-beurre d'érable, noix de Grenoble caramélisées"
  ✓ "Crêpes avoine-banane, compote framboises & ricotta vanillée"
  ✓ "Smoothie bowl mangue-gingembre, granola croustillant & kiwi"
  ✓ "Omelette roulée aux champignons, cheddar vieilli & ciboulette"
  ✓ "Pain doré brioche, pêches rôties au miel & yogourt grec"
  ✓ "Bol açaï, fruits des champs, noix de coco grillée & sirop d'érable"
  ✓ "Bagel maison gravlax-fromage à la crème-câpres-aneth"

DÎNER (midi) — REPAS VOYAGE / PRÉPARÉ D'AVANCE:
• 6-8 ingrédients AVEC QUANTITÉS PRÉCISES, 3-4 étapes, 15 mots de description max
• TYPES: wrap signature, salade-repas composée, bol froid style buddha, soupe-repas, sandwich gastronomique — jamais un sauté chaud
• NOMS CRÉATIFS OBLIGATOIRES:
  ✓ "Wrap au poulet BBQ, coleslaw au miel-lime & coriandre fraîche"
  ✓ "Bol de quinoa style Buddha, edamame, carotte marinée & vinaigrette tahini-gingembre"
  ✓ "Sandwich au thon grillé, avocat, câpres & rémoulade au citron sur pain de seigle"
  ✓ "Salade de lentilles beluga, betteraves rôties, feta & vinaigrette moutarde-érable"
  ✓ "Soupe-repas aux champignons & saucisse italienne, raviolis & parmesan"
  ✓ "Bento saumon-riz jasmin, concombre mariné, edamame & sauce soya-sésame"
  ✓ "Pita falafels maison, houmous, tomates confites & salade de persil"
  ✓ "Salade de kale massé, courge rôtie, canneberges séchées & noix de Grenoble"

SOUPER (soir) — PLAT PRINCIPAL SIGNATURE:
• 9-11 ingrédients AVEC QUANTITÉS PRÉCISES, 5-6 étapes riches, 20 mots de description max
• CHAQUE SOUPER DOIT AVOIR: une protéine + un féculent/légume de base + une sauce/jus maison + une garniture fraîche
• FORMAT INSPIRANT (varier chaque soir):
  - Plaque au four (sheet pan): tout rôti ensemble, jus de cuisson récupéré en sauce
  - One-pot/chaudron: braisé, mijoté, risotto, curry
  - Planche/grill: protéine grillée + accompagnement chaud + sauce froide
  - Sauté wok: légumes croquants, sauce umami, riz ou nouilles
  - Assemblé/bowl: composantes séparées montées à table
• NOMS ÉVOCATEURS OBLIGATOIRES (style blogue):
  ✓ "Cuisses de poulet glacées à l'érable & à la moutarde, patates douces rôties au romarin"
  ✓ "Risotto crémeux aux champignons sauvages & poireaux, bacon croustillant & ciboulette"
  ✓ "Morue en croûte de panko au paprika fumé, salade style tacos & crème d'avocat au lime"
  ✓ "Soupe florentine à la saucisse italienne, raviolis au fromage & épinards frais"
  ✓ "Pâtes au beurre brun, noisettes grillées, sauge & parmesan reggiano"
  ✓ "Tofu croustillant laqué au tamari-gingembre, bok choy sauté & riz jasmin au sésame"
  ✓ "Filet de porc à l'érable & au bourbon, purée de céleri-rave & pommes caramélisées"
  ✓ "Tacos smashed au saumon, pico de gallo, guacamole au miel & tortillas de maïs"
  ✓ "Cari rouge de pois chiches & épinards, riz basmati à la citronnelle & naan grillé"
  ✓ "Boulettes de poulet à la bière & à l'érable, sauce tomate maison & polenta crémeuse"
  ✓ "Tempeh miso-érable, brocoli caramélisé & quinoa aux herbes fraîches"
  ✓ "Saumon poché au lait de coco-curry rouge, basmati & chutney de mangue fraîche"

══════════════════════════════════════════
FORMAT INGRÉDIENTS — RÈGLE ABSOLUE
══════════════════════════════════════════
Chaque ingrédient DOIT inclure quantité + unité + nom précis + préparation:
• Protéines: "300 g de cuisses de poulet désossées, sans peau", "2 filets de morue (150 g chacun)", "1 boîte (540 ml) de pois chiches, rincés et égouttés", "200 g de tofu ferme, coupé en cubes de 2 cm"
• Légumes: "2 poivrons rouges, tranchés en fines lanières", "200 g de brocoli en fleurons", "1 gros oignon jaune, haché finement", "2 gousses d'ail, émincées"
• Liquides/sauces: "250 ml de bouillon de poulet faible en sodium", "1 boîte (400 ml) de lait de coco entier", "30 ml de sauce tamari", "15 ml de sirop d'érable pur", "15 ml d'huile d'olive extra-vierge"
• Épices: "5 ml de cumin moulu", "5 ml de paprika fumé", "2 ml de sel de mer", "1 pincée de flocons de piment rouge"
• Féculents: "200 g de riz basmati (sec)", "180 g de pâtes penne de blé entier (sèches)", "100 g de quinoa (sec, rincé)"
• Garnitures: "30 ml de ciboulette fraîche, ciselée", "15 ml de graines de sésame grillées", "1 citron (zeste et jus)", "50 g de parmesan, fraîchement râpé"
JAMAIS sans quantité — TOUJOURS: nombre + unité + nom + préparation

══════════════════════════════════════════
INSTRUCTIONS — STYLE BLOGUE CULINAIRE QUÉBÉCOIS
══════════════════════════════════════════
Écrire comme Marilou (Trois fois par jour) ou Katrine Paradis (K pour Katrine) — chaleureux, précis, visuel, avec astuces:
• Déjeuner: 3 étapes (max 40 mots/étape) — direct et engageant
• Dîner: 3-4 étapes (max 55 mots/étape) — technique + conseil de prep avance
• Souper: 5-6 étapes (max 75 mots/étape) — inclure: température exacte, durée, résultat visuel attendu, et 1 conseil de chef par étape
EXEMPLES DE STYLE:
✓ "Faire chauffer l'huile dans une grande poêle en fonte à feu vif. Ajouter les cuisses de poulet côté peau vers le bas — ne pas bouger pendant 6-7 min pour obtenir une peau bien dorée et croustillante."
✓ "Déglacer avec le bouillon de poulet en grattant bien les sucs de cuisson caramélisés — c'est là que réside toute la saveur. Ajouter l'érable et la moutarde, laisser réduire 3-4 min à feu moyen."
✓ "Servir dans des bols chauds, garnir généreusement de ciboulette fraîche, d'un filet d'huile d'olive et d'un tour de moulin à poivre. C'est le genre de plat qu'on mange en fermant les yeux."
JAMAIS: "Cuire le poulet." "Faire revenir les légumes." — trop vague, trop fade.

══════════════════════════════════════════
NUTRITION JOURNALIÈRE — OBLIGATOIRE
══════════════════════════════════════════
Le champ "dailyNutrition" DOIT figurer dans les 7 jours, jamais absent ni null.
Viser par personne: ~2000 kcal | ~55g protéines | ~250g glucides | ~65g lipides | ~30g fibres
Format: {"calories": 1950, "proteinG": 56, "carbsG": 242, "fatG": 66, "fiberG": 30}

══════════════════════════════════════════
VARIÉTÉ — RÈGLES CRITIQUES
══════════════════════════════════════════
1. MÊME JOURNÉE: jamais la même protéine principale dans 2 repas du même jour.
2. SEMAINE: alterner les protéines chaque soir (ex: poulet → poisson → légumineuses → porc → bœuf/veau → végétarien → œufs). Max 2× la même protéine sur 7 jours.
3. LÉGUMES: max 2× le même légume principal sur la semaine. Au moins 2 légumes colorés différents par jour.
4. MINIMUM: 2 soupers végétariens (riches en protéines végétales) + 1 souper poisson par semaine.
5. RESTES INTELLIGENTS: si poulet rôti au souper lundi → sandwich au poulet au dîner mardi (mentionner "avec les restes du poulet de la veille").

══════════════════════════════════════════
BUDGET — ÉCONOMIES INTELLIGENTES
══════════════════════════════════════════
- Cuisses de poulet > poitrines (30% moins cher, plus de saveur)
- Légumineuses (pois chiches, lentilles) ≥ 3x/semaine comme protéine principale
- Légumes de saison (mai-sept: asperges, courgettes, tomates, maïs, poivrons | oct-avr: chou, courge, carottes, navet)
- Vrac: avoine, riz, lentilles, pâtes — jamais format individuel
- Éviter: ingrédients luxueux inutiles sauf si déjà dans le frigo

══════════════════════════════════════════
FORMAT JSON — RÉPONSE OBLIGATOIRE
══════════════════════════════════════════
RÉPONDS UNIQUEMENT AVEC DU JSON VALIDE — zéro texte avant ou après, zéro markdown, zéro commentaire.
{"days":[{"dayName":"Lundi","breakfast":RECETTE|null,"lunch":RECETTE|null,"dinner":RECETTE|null,"dailyNutrition":{"calories":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number}}, ... ×7],"estimatedCost":number}
Chaque RECETTE: {"name":"...","description":"...","cookingTime":number,"servings":${N},"ingredients":["..."],"instructions":["..."],"estimatedCost":number,"difficultyLevel":"Facile"|"Moyen"|"Avancé"}
Commence IMMÉDIATEMENT par { sans aucun texte avant.`;


    const { client: openai, model } = getOpenAI();
    req.log.info({ model }, "Generating menu with model");

    const stream = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 4500,
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

  // ── Ingredient parser ──────────────────────────────────────────────────────
  type Parsed = { displayName: string; groupKey: string; totalG: number; totalMl: number; totalUnits: number; rawUnit: string };

  function parseIngredientLine(raw: string): { groupKey: string; displayName: string; amountG: number; amountMl: number; units: number; rawUnit: string } {
    const s = raw.trim();
    // Match leading number (int, decimal, fraction) + optional unit + "de/d'/du/des..." + name
    const re = /^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(g|kg|ml|l|litre[s]?|tasse[s]?|c\.?\s*à\s*soupe|c\.?\s*à\s*thé|lb[s]?|livre[s]?|oz|boîte[s]?|boite[s]?|sachet[s]?|paquet[s]?|tranche[s]?|filet[s]?|pot[s]?|bouteille[s]?|portion[s]?|gousse[s]?)?\s*(?:de\s+|d[''\s]|du\s+|des\s+|de\s+la\s+|de\s+l[''\s])?\s*(.+)/i;
    const m = s.match(re);
    if (!m) return { groupKey: s.toLowerCase(), displayName: s, amountG: 0, amountMl: 0, units: 1, rawUnit: "unité" };

    // Parse amount (handle "1/2")
    const rawNum = m[1].replace(",", ".");
    let amount = rawNum.includes("/") ? rawNum.split("/").reduce((a, b, i) => i === 0 ? parseFloat(a as unknown as string) : (a as unknown as number) / parseFloat(b), 0 as unknown as number) as unknown as number : parseFloat(rawNum);
    const rawUnit = (m[2] || "unité").toLowerCase().replace(/s$/, "").trim();
    // Clean name: remove parenthetical notes, trailing qualifiers
    const displayName = m[3].trim().replace(/\s*\([^)]*\)/g, "").replace(/,\s*[a-zéèêëàâîïùûôœ].*$/i, "").trim();
    const groupKey = displayName.toLowerCase().replace(/[éèêë]/g, "e").replace(/[àâ]/g, "a").replace(/[îï]/g, "i").replace(/[ùû]/g, "u").replace(/[ôœ]/g, "o").replace(/\s+/g, " ");

    // Convert to base units
    const toG: Record<string, number> = { kg: 1000, g: 1, lb: 454, livre: 454, oz: 28 };
    const toMl: Record<string, number> = { l: 1000, litre: 1000, ml: 1, tasse: 250, "c. a soupe": 15, "c. a the": 5 };
    const gMult = toG[rawUnit] ?? 0;
    const mlMult = toMl[rawUnit] ?? 0;
    const isUnit = !gMult && !mlMult;
    return {
      groupKey, displayName,
      amountG: gMult ? amount * gMult : 0,
      amountMl: mlMult ? amount * mlMult : 0,
      units: isUnit ? amount : 0,
      rawUnit,
    };
  }

  function toGroceryFormat(p: Parsed): { quantity: string; unit: string; price: number } {
    const n = p.groupKey;
    if (p.totalG > 0) {
      const g = p.totalG;
      if (/poulet|dinde|veau|porc(?!el)|agneau|boeuf|bœuf/.test(n))    return { quantity: `${Math.max(1, Math.ceil(g / 450))}`, unit: "paquet(s) 450 g",  price: Math.max(1, Math.ceil(g / 450)) * 7.99 };
      if (/saumon|tilapia|morue|dore|doré|truite|poisson|flétan|sole|basa|mahi/.test(n)) return { quantity: `${Math.max(1, Math.ceil(g / 400))}`, unit: "paquet(s) 400 g",  price: Math.max(1, Math.ceil(g / 400)) * 8.99 };
      if (/crevette/.test(n))  return { quantity: `${Math.max(1, Math.ceil(g / 340))}`, unit: "sac(s) 340 g",    price: Math.max(1, Math.ceil(g / 340)) * 9.99 };
      if (/tofu/.test(n))      return { quantity: `${Math.max(1, Math.ceil(g / 350))}`, unit: "bloc(s) 350 g",   price: Math.max(1, Math.ceil(g / 350)) * 3.49 };
      if (/tempeh/.test(n))    return { quantity: `${Math.max(1, Math.ceil(g / 240))}`, unit: "paquet(s) 240 g", price: Math.max(1, Math.ceil(g / 240)) * 4.49 };
      if (/fromage|mozzarella|cheddar|parmesan|feta|feta|ricotta/.test(n)) return { quantity: `${Math.max(1, Math.ceil(g / 250))}`, unit: "bloc(s) 250 g", price: Math.max(1, Math.ceil(g / 250)) * 5.49 };
      if (/beurre(?! d)/.test(n))  return { quantity: `${Math.max(1, Math.ceil(g / 250))}`, unit: "plaquette(s) 250 g", price: Math.max(1, Math.ceil(g / 250)) * 4.29 };
      if (/epinard|roquette|mache|laitue/.test(n)) return { quantity: `${Math.max(1, Math.ceil(g / 142))}`, unit: "contenant(s) 142 g", price: Math.max(1, Math.ceil(g / 142)) * 3.99 };
      if (/farine|sucre/.test(n))  return { quantity: `${Math.max(1, Math.ceil(g / 1000))}`, unit: "sac(s) 1 kg",   price: Math.max(1, Math.ceil(g / 1000)) * 4.49 };
      if (/riz|pate|avoine|gruau|quinoa|couscous|lentille/.test(n)) return { quantity: `${Math.max(1, Math.ceil(g / 900))}`, unit: "sac(s) 900 g", price: Math.max(1, Math.ceil(g / 900)) * 4.99 };
      const rounded = Math.ceil(g / 100) * 100;
      return { quantity: `${rounded} g`, unit: "", price: Math.ceil(g / 100) * 1.50 };
    }
    if (p.totalMl > 0) {
      const ml = p.totalMl;
      if (/lait(?! de coco)/.test(n))  return { quantity: `${Math.max(1, Math.ceil(ml / 2000))}`, unit: "carton(s) 2 L",   price: Math.max(1, Math.ceil(ml / 2000)) * 5.49 };
      if (/bouillon/.test(n))           return { quantity: `${Math.max(1, Math.ceil(ml / 900))}`,  unit: "carton(s) 900 ml",price: Math.max(1, Math.ceil(ml / 900)) * 3.49 };
      if (/lait de coco|creme de coco/.test(n)) return { quantity: `${Math.max(1, Math.ceil(ml / 400))}`, unit: "boîte(s) 400 ml", price: Math.max(1, Math.ceil(ml / 400)) * 2.99 };
      if (/creme|crème/.test(n))        return { quantity: `${Math.max(1, Math.ceil(ml / 473))}`,  unit: "contenant(s) 473 ml", price: Math.max(1, Math.ceil(ml / 473)) * 3.99 };
      if (/passata|sauce tomate|coulis/.test(n)) return { quantity: `${Math.max(1, Math.ceil(ml / 680))}`, unit: "bocal(s) 680 ml", price: Math.max(1, Math.ceil(ml / 680)) * 2.99 };
      if (/huile/.test(n))              return { quantity: "1", unit: "bouteille 750 ml", price: 7.99 };
      if (/tamari|sauce soya|soya/.test(n)) return { quantity: "1", unit: "bouteille 250 ml", price: 4.99 };
      if (/vinaigre/.test(n))           return { quantity: "1", unit: "bouteille 500 ml", price: 3.99 };
      const containers = Math.max(1, Math.ceil(ml / 500));
      return { quantity: `${containers}`, unit: "contenant(s) 500 ml", price: containers * 3.99 };
    }
    // Unit-based
    const u = Math.max(1, Math.ceil(p.totalUnits));
    if (/oeuf|œuf/.test(n))         return { quantity: `${Math.max(1, Math.ceil(u / 12))}`, unit: "douzaine(s)", price: Math.max(1, Math.ceil(u / 12)) * 5.49 };
    if (/oignon|echalote/.test(n))  return { quantity: `${Math.max(1, Math.ceil(u / 6))}`,  unit: "sac(s) de 6", price: Math.max(1, Math.ceil(u / 6)) * 3.99 };
    if (/carotte/.test(n))          return { quantity: `${Math.max(1, Math.ceil(u / 6))}`,  unit: "sac(s) de 6", price: Math.max(1, Math.ceil(u / 6)) * 3.49 };
    if (/pomme de terre|patate/.test(n)) return { quantity: `${Math.max(1, Math.ceil(u / 5))}`, unit: "sac(s) 2.27 kg", price: Math.max(1, Math.ceil(u / 5)) * 5.99 };
    if (/citron|lime/.test(n))      return { quantity: `${Math.max(1, Math.ceil(u / 3))}`,  unit: "filet(s) de 3",price: Math.max(1, Math.ceil(u / 3)) * 2.99 };
    if (/boite|boîte|conserve/.test(p.rawUnit)) return { quantity: `${u}`, unit: "boîte(s) 540 ml", price: u * 2.29 };
    if (/gousse/.test(p.rawUnit))   return { quantity: "1", unit: "tête d'ail", price: 1.49 };
    return { quantity: `${u}`, unit: "unité(s)", price: u * 2.49 };
  }

  // Accumulate parsed ingredient totals per group key
  const parsedMap = new Map<string, Parsed>();

  const days = menu.days as Array<{
    dayName: string;
    breakfast: { ingredients: string[] };
    lunch: { ingredients: string[] };
    dinner: { ingredients: string[] };
  }>;

  for (const day of days) {
    for (const meal of [day.breakfast, day.lunch, day.dinner]) {
      for (const raw of (meal?.ingredients ?? [])) {
        const p = parseIngredientLine(raw);
        const existing = parsedMap.get(p.groupKey);
        if (existing) {
          existing.totalG     += p.amountG;
          existing.totalMl    += p.amountMl;
          existing.totalUnits += p.units;
        } else {
          parsedMap.set(p.groupKey, {
            displayName: p.displayName,
            groupKey: p.groupKey,
            totalG:     p.amountG,
            totalMl:    p.amountMl,
            totalUnits: p.units,
            rawUnit:    p.rawUnit,
          });
        }
      }
    }
  }

  const shoppingList = Array.from(parsedMap.values()).map((p) => {
    const grocery = toGroceryFormat(p);
    const category = getCategoryForIngredient(p.groupKey);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return {
      name: cap(p.displayName),
      quantity: grocery.quantity,
      unit: grocery.unit,
      category,
      estimatedPrice: Math.round(grocery.price * 100) / 100,
      inFridge: fridgeNames.some(f => f.includes(p.groupKey) || p.groupKey.includes(f)),
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
