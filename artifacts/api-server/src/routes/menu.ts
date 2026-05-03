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
// Comptes avec accès illimité (beta testers / fondateurs)
const UNLIMITED_EMAILS = ["claraforget@icloud.com"];

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
  const userEmail = (req as AuthedRequest).userEmail ?? "";
  let isServerSubscribed = UNLIMITED_EMAILS.includes(userEmail.toLowerCase());
  if (!isServerSubscribed) {
    try {
      const [subRow] = await db
        .select()
        .from(userSubscriptionsTable)
        .where(eq(userSubscriptionsTable.userId, userId))
        .limit(1);
      isServerSubscribed = subRow?.status === "active" || subRow?.status === "canceling";
    } catch { /* non-bloquant */ }
  }

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
STYLE DES DESCRIPTIONS (champ "description") — CHALEUREUX ET APPÉTISSANT:
Écrire une courte phrase évocatrice à la première personne, dans le ton d'un blogue culinaire québécois. La description doit donner envie, expliquer pourquoi ce plat est bon et mentionner 1-2 contrastes de saveurs/textures.
✓ "J'adore l'équilibre de cette plaque — sucré des dattes, salé des olives et juste assez relevé. Tout cuit ensemble et le résultat est vraiment savoureux."
✓ "Un risotto onctueux qui sent bon le beurre et les champignons sauvages — le bacon croustillant ajoute ce petit quelque chose qui change tout."
✓ "Mon bol préféré pour les soirs pressés : frais, coloré et prêt en 20 minutes. La vinaigrette tahini-gingembre est absolument addictive."
✗ JAMAIS: "Ce plat est délicieux et nutritif." (trop générique) ✗ JAMAIS: "Un repas équilibré pour toute la famille." (vide)

INSTRUCTIONS — STANDARD BLOGUE (Trois fois par jour, K pour Katrine):
• Températures en °F (non en °C): "Préchauffer le four à 425 °F"
• Mentionner la position de grille: "placer la grille au centre" / "au tiers supérieur"
• Détails techniques précis: "Tapisser une plaque de papier parchemin", "arroser du jus de cuisson", "masser les ingrédients pour bien répartir la marinade", "terminer à broil 3 minutes jusqu'à ce que le poulet soit bien doré"
• Résultat visuel dans chaque étape: "jusqu'à ce que les légumes ramollissent et commencent à caraméliser", "la peau doit être bien dorée et croustillante"
• Conseil de chef naturel (1 par étape souper): "Ne pas bouger la viande pendant les premières minutes pour obtenir une belle coloration."
EXEMPLES COMPLETS:
✓ "Préchauffer le four à 425 °F et placer la grille au centre. Tapisser une grande plaque à biscuits de papier parchemin."
✓ "Dans un grand bol, fouetter l'huile, l'érable, la moutarde et les épices pour former la marinade. Ajouter le poulet et les légumes, puis masser généreusement pour bien répartir."
✓ "Étaler en une couche uniforme sur la plaque. Cuire 25 minutes, arroser du jus de cuisson, puis terminer à broil 3 minutes pour dorer le dessus."
✓ "Garnir de ciboulette fraîche et d'un bon zeste de citron. Servir directement sur la plaque — c'est le genre de plat qu'on met au centre de la table."
JAMAIS: "Cuire le poulet." ou "Faire revenir les légumes." — trop vague et sans vie.

VIANDES TRANSFORMÉES — RÉDUIRE FORTEMENT:
• LIMITER à max 1x/semaine: bacon, lardons, pancetta, saucisse italienne, chorizo, jambon, pepperoni, saucisse merguez
• FAVORISER: cuisses de poulet désossées, filets de poisson, bœuf haché extra-maigre, filet de porc, crevettes
• PRIVILÉGIER protéines végétales riches: edamame, miso, tempeh, tofu, lentilles, pois chiches, haricots, seitan, nutritional yeast (levure nutritionnelle)

INGRÉDIENTS SANTÉ & UMAMI À UTILISER RÉGULIÈREMENT:
• Fermentés & probiotiques: miso blanc ou rouge, kimchi, kéfir, yogourt nature, tempeh, kombucha (dans marinades)
• Légumes oubliés: edamame, pak choi, bok choy, fenouil, betterave, panais, céleri-rave, topinambour, butternut
• Protéines végétales: levure nutritionnelle (saveur fromagée), graines de chanvre, spiruline (smoothies)
• Aromates umami: pâte de miso, sauce miso, bouillon dashi, algues nori, kombu
• Glucides sains: orge perlé, sarrasin (kasha), farro, boulgour, patate douce violette, châtaigne d'eau

══════════════════════════════════════════
NUTRITION JOURNALIÈRE — OBLIGATOIRE ET DÉTAILLÉE
══════════════════════════════════════════
Le champ "dailyNutrition" DOIT figurer dans les 7 jours, jamais absent ni null.
Valeurs CIBLES PAR JOUR (pour ${N} personne(s), toutes les 3 repas combinés):
  Macros:   ~${N * 2000} kcal | ~${N * 55}g protéines | ~${N * 250}g glucides | ~${N * 65}g lipides | ~${N * 28}g fibres
  Minéraux: ~${N * 1500}mg sodium | ~${N * 1000}mg calcium | ~${N * 16}mg fer | ~${N * 3500}mg potassium | ~${N * 12}mg zinc | ~${N * 380}mg magnésium
  Vitamines:~${N * 900}μg vit. A | ~${N * 90}mg vit. C | ~${N * 600} UI vit. D | ~${N * 2.4}μg vit. B12 | ~${N * 400}μg folate
Format EXACT (tous les champs obligatoires, nombres entiers sauf B12):
{"calories":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number,"sodiumMg":number,"calciumMg":number,"ironMg":number,"potassiumMg":number,"zincMg":number,"magnesiumMg":number,"vitaminAug":number,"vitaminCMg":number,"vitaminDiu":number,"vitaminB12ug":number,"folateMcg":number}

══════════════════════════════════════════
VARIÉTÉ — RÈGLES CRITIQUES
══════════════════════════════════════════
1. MÊME JOURNÉE: jamais la même protéine principale dans 2 repas du même jour.
2. SEMAINE: alterner les protéines chaque soir (ex: poulet → poisson → légumineuses → porc → bœuf/veau → végétarien → œufs). Max 2× la même protéine sur 7 jours.
3. LÉGUMES: max 2× le même légume principal sur la semaine. Au moins 2 légumes colorés différents par jour.
4. MINIMUM: 2 soupers végétariens (riches en protéines végétales) + 1 souper poisson par semaine.
5. RESTES INTELLIGENTS: si poulet rôti au souper lundi → sandwich au poulet au dîner mardi (mentionner "avec les restes du poulet de la veille").

══════════════════════════════════════════
BUDGET — RÈGLE ABSOLUE NON NÉGOCIABLE
══════════════════════════════════════════
Budget total semaine: ${preferences.weeklyBudget}$ CAD pour ${N} personne(s)
→ Coût par repas MAXIMUM: ~${Math.round(preferences.weeklyBudget / 21 * 100) / 100}$ (= ${preferences.weeklyBudget}$ ÷ 21 repas)
→ estimatedCost racine JSON DOIT être ≤ ${preferences.weeklyBudget}$ — sinon réponse rejetée
→ Les ingrédients partagés entre plusieurs repas ne se comptent QU'UNE FOIS
→ VÉRIFIER avant de répondre: somme des estimatedCost de chaque recette ÷ repas/sem ≤ ${Math.round(preferences.weeklyBudget / 21 * 100) / 100}$

STRATÉGIES ÉCONOMIQUES OBLIGATOIRES:
- Cuisses de poulet > poitrines (30% moins cher, plus de saveur)
- Légumineuses (pois chiches, lentilles) ≥ 3x/semaine comme protéine principale
- Légumes de saison (mai-sept: asperges, courgettes, tomates, maïs, poivrons | oct-avr: chou, courge, carottes, navet)
- Vrac: avoine, riz, lentilles, pâtes — jamais format individuel
- Éviter: ingrédients luxueux inutiles sauf si déjà dans le frigo
- Limiter à 1 seule viande ou poisson premium (saumon, filet mignon) sur la semaine

══════════════════════════════════════════
FORMAT JSON — RÉPONSE OBLIGATOIRE
══════════════════════════════════════════
RÉPONDS UNIQUEMENT AVEC DU JSON VALIDE — zéro texte avant ou après, zéro markdown, zéro commentaire.
{"days":[{"dayName":"Lundi","breakfast":RECETTE|null,"lunch":RECETTE|null,"dinner":RECETTE|null,"dailyNutrition":{"calories":number,"proteinG":number,"carbsG":number,"fatG":number,"fiberG":number,"sodiumMg":number,"calciumMg":number,"ironMg":number,"potassiumMg":number,"zincMg":number,"magnesiumMg":number,"vitaminAug":number,"vitaminCMg":number,"vitaminDiu":number,"vitaminB12ug":number,"folateMcg":number}}, ... ×7],"estimatedCost":number}
Chaque RECETTE: {"name":"...","description":"...","cookingTime":number,"servings":${N},"ingredients":["..."],"instructions":["..."],"estimatedCost":number,"difficultyLevel":"Facile"|"Moyen"|"Avancé"}
Commence IMMÉDIATEMENT par { sans aucun texte avant.`;


    const { client: openai, model } = getOpenAI();
    req.log.info({ model }, "Generating menu with model");

    const stream = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 6000,
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
      userMsg = "Le modèle IA est temporairement surchargé — réessayez dans 30 secondes.";
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

  // Retourne null si c'est un ingrédient de base/garde-manger (pas à acheter chaque semaine)
  function isPantryStaple(n: string, rawUnit: string): boolean {
    // Épices & assaisonnements en petite quantité
    if (/cumin|paprika|curcuma|cannelle|origan|thym|basilic seche|piment|poivre|sel |cayenne|cari|garam|zaatar|sumac|harissa|coriandre moulue|curcuma|cardamome|muscade|gingembre moulu|ail en poudre|oignon en poudre|fenugrec|anis|herbes de provence|italian seasoning/.test(n)) return true;
    // Condiments très petites quantités
    if ((rawUnit === "c. a soupe" || rawUnit === "c. a the" || rawUnit === "pincee" || rawUnit === "ml") && /moutarde|sauce worcestershire|sauce pimente|sauce fish|pate miso|sambal|tahini|wasabi/.test(n)) return true;
    return false;
  }

  function toGroceryFormat(p: Parsed): { quantity: string; unit: string; price: number } | null {
    const n = p.groupKey;

    // ── Ingrédients de base / garde-manger → exclure de la liste ──────────────
    if (isPantryStaple(n, p.rawUnit)) return null;

    // ── Ingrédients basés en grammes ──────────────────────────────────────────
    if (p.totalG > 0) {
      const g = p.totalG;

      // Viandes & volailles (formats plateaux IGA/Metro)
      if (/poitrine de poulet|poitrines de poulet/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 700));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 700 g (~2 poitrines)`, price: pkgs * 11.99 };
      }
      if (/cuisse de poulet|cuisses de poulet/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 1000));
        return { quantity: String(pkgs), unit: `sac${pkgs > 1 ? "s" : ""} 1 kg (~5 cuisses)`, price: pkgs * 9.49 };
      }
      if (/poulet hache|poulet haché/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 500));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 500 g`, price: pkgs * 6.99 };
      }
      if (/poulet/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 700));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 700 g`, price: pkgs * 10.99 };
      }
      if (/boeuf hache|bœuf hache|boeuf haché|bœuf haché/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 500));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 500 g`, price: pkgs * 7.99 };
      }
      if (/boeuf|bœuf/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 450));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 450 g`, price: pkgs * 9.49 };
      }
      if (/porc hache|porc haché/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 500));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 500 g`, price: pkgs * 6.49 };
      }
      if (/filet de porc|longe de porc/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 500));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 500 g`, price: pkgs * 7.49 };
      }
      if (/porc/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 500));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 500 g`, price: pkgs * 6.99 };
      }
      if (/dinde hachee|dinde hachée/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 500));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 500 g`, price: pkgs * 6.49 };
      }
      if (/saucisse italienne|saucisse/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 500));
        return { quantity: String(pkgs), unit: `paquet${pkgs > 1 ? "s" : ""} 500 g (~5 saucisses)`, price: pkgs * 7.49 };
      }
      if (/bacon|lardons|pancetta/.test(n)) {
        return { quantity: "1", unit: "paquet 375 g", price: 6.99 };
      }
      if (/agneau/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 400));
        return { quantity: String(pkgs), unit: `plateau${pkgs > 1 ? "x" : ""} 400 g`, price: pkgs * 11.99 };
      }

      // Poissons & fruits de mer (formats IGA/Metro/Maxi)
      if (/saumon/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 450));
        return { quantity: String(pkgs), unit: `paquet${pkgs > 1 ? "s" : ""} 450 g (2 pavés)`, price: pkgs * 13.99 };
      }
      if (/tilapia/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 700));
        return { quantity: String(pkgs), unit: `sac${pkgs > 1 ? "s" : ""} surgelé 700 g`, price: pkgs * 9.99 };
      }
      if (/morue|pangasius|basa/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 400));
        return { quantity: String(pkgs), unit: `sac${pkgs > 1 ? "s" : ""} surgelé 400 g`, price: pkgs * 8.49 };
      }
      if (/crevette/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 340));
        return { quantity: String(pkgs), unit: `sac${pkgs > 1 ? "s" : ""} surgelé 340 g`, price: pkgs * 9.99 };
      }
      if (/thon/.test(n) && !/frais/.test(n)) {
        const cans = Math.max(1, Math.ceil(g / 170));
        return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 170 g`, price: cans * 2.49 };
      }
      if (/truite|doré|dore|flétan|fletan|mahi|sole|poisson/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 400));
        return { quantity: String(pkgs), unit: `paquet${pkgs > 1 ? "s" : ""} 400 g`, price: pkgs * 10.99 };
      }

      // Tofu, tempeh & protéines végétales
      if (/tofu/.test(n)) {
        const blocs = Math.max(1, Math.ceil(g / 350));
        return { quantity: String(blocs), unit: `bloc${blocs > 1 ? "s" : ""} 350 g (Sunrise/Nature's Best)`, price: blocs * 3.49 };
      }
      if (/tempeh/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 240));
        return { quantity: String(pkgs), unit: `paquet${pkgs > 1 ? "s" : ""} 240 g`, price: pkgs * 4.99 };
      }
      if (/seitan/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 250));
        return { quantity: String(pkgs), unit: `paquet${pkgs > 1 ? "s" : ""} 250 g`, price: pkgs * 5.49 };
      }
      if (/edamame/.test(n)) {
        return { quantity: "1", unit: "sac surgelé 500 g", price: 3.99 };
      }

      // Fromages (formats blocs IGA/Metro)
      if (/parmesan/.test(n)) {
        return { quantity: "1", unit: "sachet râpé 200 g (Galbani/Stella)", price: 5.99 };
      }
      if (/feta/.test(n)) {
        return { quantity: "1", unit: "bloc en saumure 200 g", price: 4.99 };
      }
      if (/cheddar/.test(n)) {
        return { quantity: "1", unit: "bloc 400 g (Black Diamond/Perron)", price: 6.99 };
      }
      if (/mozzarella/.test(n)) {
        return { quantity: "1", unit: "bloc 400 g ou bocconcini 200 g", price: 5.49 };
      }
      if (/ricotta/.test(n)) {
        return { quantity: "1", unit: "pot 475 g", price: 4.99 };
      }
      if (/fromage a la creme|fromage a la crème|fromage creme/.test(n)) {
        return { quantity: "1", unit: "bloc 250 g (Philadelphia)", price: 4.49 };
      }
      if (/fromage en grains|fromage grains/.test(n)) {
        return { quantity: "1", unit: "sac 400 g", price: 5.99 };
      }
      if (/fromage/.test(n)) {
        return { quantity: "1", unit: "bloc 400 g", price: 6.49 };
      }

      // Beurre (format 454 g = standard canadien, pas 250 g)
      if (/beurre(?! d[e'])/.test(n)) {
        return { quantity: "1", unit: "plaquette 454 g (4 bâtons)", price: 5.99 };
      }

      // Légumes feuilles & herbes fraîches en botte
      if (/rapini/.test(n)) {
        return { quantity: "1", unit: "botte (~300 g)", price: 3.49 };
      }
      if (/brocoli chinois|gai lan/.test(n)) {
        return { quantity: "1", unit: "botte (~300 g)", price: 3.49 };
      }
      if (/blette|bette a carde|bette a côte/.test(n)) {
        return { quantity: "1", unit: "botte (~300 g)", price: 2.99 };
      }
      if (/coriandre fraiche|coriandre fraîche/.test(n)) {
        return { quantity: "1", unit: "botte fraîche", price: 1.49 };
      }
      if (/persil frais/.test(n)) {
        return { quantity: "1", unit: "botte fraîche", price: 1.49 };
      }
      if (/menthe fraiche|menthe fraîche/.test(n)) {
        return { quantity: "1", unit: "botte fraîche", price: 1.49 };
      }
      if (/asperge/.test(n)) {
        const bunches = Math.max(1, Math.ceil(g / 450));
        return { quantity: String(bunches), unit: `botte${bunches > 1 ? "s" : ""} (~450 g)`, price: bunches * 4.49 };
      }
      if (/epinard|épinard/.test(n)) {
        const bags = Math.max(1, Math.ceil(g / 142));
        return { quantity: String(bags), unit: `sac${bags > 1 ? "s" : ""} 142 g (bébé épinards)`, price: bags * 3.99 };
      }
      if (/roquette/.test(n)) {
        return { quantity: "1", unit: "sac 142 g", price: 3.99 };
      }
      if (/chou kale|kale/.test(n)) {
        return { quantity: "1", unit: "botte 200 g", price: 3.49 };
      }
      if (/laitue romaine/.test(n)) {
        return { quantity: "1", unit: "cœur de romaine 3-pack (340 g)", price: 3.99 };
      }
      if (/laitue|mesclun|verdure|mizuna|mache|mâche/.test(n)) {
        return { quantity: "1", unit: "contenant 142 g", price: 3.99 };
      }
      if (/radicchio|trévise|trevise/.test(n)) {
        return { quantity: "1", unit: "tête (~300 g)", price: 3.49 };
      }
      if (/endive/.test(n)) {
        const count = Math.max(1, Math.ceil(g / 100));
        return { quantity: String(count), unit: `endive${count > 1 ? "s" : ""} fraîche${count > 1 ? "s" : ""}`, price: count * 1.49 };
      }
      if (/pak choi|pak choï|bok choy/.test(n)) {
        return { quantity: "1", unit: "botte (~400 g)", price: 2.99 };
      }

      // Champignons
      if (/shiitake/.test(n)) {
        return { quantity: "1", unit: "barquette 113 g (shiitake)", price: 4.49 };
      }
      if (/portobello/.test(n)) {
        return { quantity: "1", unit: "barquette 2 caps (~200 g)", price: 3.99 };
      }
      if (/champignon/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 227));
        return { quantity: String(pkgs), unit: `barquette${pkgs > 1 ? "s" : ""} 227 g`, price: pkgs * 3.49 };
      }

      // Tomates cerises/raisins
      if (/tomates? cerises?|tomates? raisins?/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 227));
        return { quantity: String(pkgs), unit: `barquette${pkgs > 1 ? "s" : ""} 227 g`, price: pkgs * 3.99 };
      }

      // Brocoli (rapini DOIT passer avant pour éviter match "brocoli" dans "brocoli chinois")
      if (/brocoli/.test(n)) {
        return { quantity: "1", unit: "tête (~450 g)", price: 2.99 };
      }
      // Chou-fleur
      if (/chou-fleur|choufleur/.test(n)) {
        return { quantity: "1", unit: "tête (~800 g)", price: 4.49 };
      }
      // Chou
      if (/chou rouge|chou vert|chou napa|chou savoy/.test(n)) {
        return { quantity: "1", unit: "chou entier (~800 g)", price: 3.49 };
      }
      // Poireau
      if (/poireau/.test(n)) {
        const count = Math.max(1, Math.ceil(g / 150));
        return { quantity: String(count), unit: `poireau${count > 1 ? "x" : ""} frais`, price: count * 1.79 };
      }
      // Fenouil
      if (/fenouil/.test(n)) {
        return { quantity: "1", unit: "bulbe de fenouil frais", price: 3.49 };
      }
      // Betterave
      if (/betterave/.test(n)) {
        return { quantity: "1", unit: "botte (~3 betteraves, 500 g)", price: 3.49 };
      }
      // Panais
      if (/panais/.test(n)) {
        return { quantity: "1", unit: "sac 2 lb (~900 g)", price: 3.49 };
      }
      // Navet / rutabaga
      if (/navet|rutabaga/.test(n)) {
        return { quantity: "1", unit: "navet entier (~500 g)", price: 1.99 };
      }
      // Céleri-rave
      if (/celeri.rave|celeriac/.test(n)) {
        return { quantity: "1", unit: "céleri-rave entier (~600 g)", price: 3.99 };
      }
      // Céleri
      if (/celeri|céleri/.test(n)) {
        return { quantity: "1", unit: "pied de céleri", price: 2.99 };
      }
      // Courgette / zucchini
      if (/courgette|zucchini/.test(n)) {
        const count = Math.max(1, Math.ceil(g / 200));
        return { quantity: String(count), unit: `courgette${count > 1 ? "s" : ""}`, price: count * 1.29 };
      }
      // Aubergine
      if (/aubergine/.test(n)) {
        return { quantity: "1", unit: "aubergine (~400 g)", price: 2.49 };
      }
      // Courge butternut / spaghetti
      if (/courge butternut|butternut squash/.test(n)) {
        return { quantity: "1", unit: "courge butternut (~1 kg)", price: 4.49 };
      }
      if (/courge spaghetti/.test(n)) {
        return { quantity: "1", unit: "courge spaghetti (~1 kg)", price: 3.99 };
      }
      if (/courge|citrouille/.test(n)) {
        return { quantity: "1", unit: "courge entière (~1 kg)", price: 3.99 };
      }
      // Concombre
      if (/concombre anglais|concombre/.test(n)) {
        return { quantity: "1", unit: "concombre anglais", price: 1.99 };
      }
      // Maïs
      if (/mais|maïs/.test(n)) {
        return { quantity: "2", unit: "épis de maïs frais", price: 1.99 };
      }

      // Féculents & grains (formats sacs épicerie)
      if (/riz arborio/.test(n)) {
        return { quantity: "1", unit: "sac 900 g (Zijaan/President's Choice)", price: 4.49 };
      }
      if (/riz basmati|riz jasmin|riz long|riz brun|riz/.test(n)) {
        const bags = Math.max(1, Math.ceil(g / 2000));
        return { quantity: String(bags), unit: `sac${bags > 1 ? "s" : ""} 2 kg (Mahatma/PC)`, price: bags * 5.99 };
      }
      if (/pate[s]? |pâte[s]? /.test(n) || /spaghetti|penne|linguine|rigatoni|fusilli|fettuccine|macaroni/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 450));
        return { quantity: String(pkgs), unit: `boîte${pkgs > 1 ? "s" : ""} 450 g (Barilla/Catelli)`, price: pkgs * 2.49 };
      }
      if (/quinoa/.test(n)) {
        const pkgs = Math.max(1, Math.ceil(g / 340));
        return { quantity: String(pkgs), unit: `sac${pkgs > 1 ? "s" : ""} 340 g (Alter Eco/PC)`, price: pkgs * 4.99 };
      }
      if (/couscous/.test(n)) {
        return { quantity: "1", unit: "boîte 500 g (Near East/PC)", price: 3.49 };
      }
      if (/avoine|flocons d.avoine|gruau/.test(n)) {
        return { quantity: "1", unit: "boîte 1.35 kg (Quaker Gros Flocons)", price: 5.49 };
      }
      if (/lentille/.test(n) && !/boite|boîte|conserve/.test(p.rawUnit)) {
        return { quantity: "1", unit: "sac 900 g", price: 3.99 };
      }
      if (/farine/.test(n)) {
        return { quantity: "1", unit: "sac 2 kg (Robin Hood/Five Roses)", price: 4.99 };
      }
      if (/sucre/.test(n)) {
        return { quantity: "1", unit: "sac 2 kg (Redpath)", price: 4.49 };
      }
      if (/panko|chapelure/.test(n)) {
        return { quantity: "1", unit: "sac 227 g", price: 2.99 };
      }

      // Noix & graines
      if (/noix de grenoble|noix grenoble/.test(n)) {
        return { quantity: "1", unit: "sac 200 g", price: 5.99 };
      }
      if (/amande/.test(n)) {
        return { quantity: "1", unit: "sac 200 g", price: 4.99 };
      }
      if (/noix de cajou|cajou/.test(n)) {
        return { quantity: "1", unit: "sac 200 g", price: 5.49 };
      }
      if (/graine de chia|chia/.test(n)) {
        return { quantity: "1", unit: "sac 300 g", price: 5.99 };
      }
      if (/graine de lin|lin/.test(n)) {
        return { quantity: "1", unit: "sac 500 g", price: 4.99 };
      }
      if (/graine de sesame|sesame/.test(n)) {
        return { quantity: "1", unit: "sac 100 g", price: 2.99 };
      }
      if (/pacane/.test(n)) {
        return { quantity: "1", unit: "sac 200 g", price: 7.49 };
      }
      if (/pistache/.test(n)) {
        return { quantity: "1", unit: "sac 200 g", price: 6.49 };
      }
      if (/granola/.test(n)) {
        return { quantity: "1", unit: "sac 454 g (Nature Valley/PC)", price: 5.99 };
      }

      // Miso (pâte)
      if (/miso/.test(n)) {
        return { quantity: "1", unit: "contenant 300 g (miso blanc/rouge)", price: 4.99 };
      }
      // Kimchi
      if (/kimchi/.test(n)) {
        return { quantity: "1", unit: "pot 400 g (épicerie coréenne/IGA)", price: 5.99 };
      }
      // Algues / nori
      if (/nori|algue/.test(n)) {
        return { quantity: "1", unit: "paquet 10 feuilles nori grillées", price: 3.99 };
      }
      // Levure nutritionnelle
      if (/levure nutritionnelle/.test(n)) {
        return { quantity: "1", unit: "sac 125 g (Bob's Red Mill/bulk barn)", price: 5.99 };
      }
      // Tahini
      if (/tahini|tahin/.test(n)) {
        return { quantity: "1", unit: "pot 454 g (Krinos/Alwadi)", price: 5.99 };
      }

      // Beurre de noix
      if (/beurre d.amande|beurre amande/.test(n)) {
        return { quantity: "1", unit: "pot 500 g", price: 8.99 };
      }
      if (/beurre d.arachide|beurre arachide/.test(n)) {
        return { quantity: "1", unit: "pot 1 kg (Kraft/Skippy)", price: 7.99 };
      }

      // Légumes en poids génériques
      const rounded100 = Math.ceil(g / 100) * 100;
      return { quantity: `${rounded100} g`, unit: "au poids (vrac/section légumes)", price: Math.ceil(g / 100) * 1.80 };
    }

    // ── Ingrédients basés en millilitres ──────────────────────────────────────
    if (p.totalMl > 0) {
      const ml = p.totalMl;

      // Produits laitiers liquides
      if (/lait(?! de coco)/.test(n)) {
        if (ml <= 1000) return { quantity: "1", unit: "carton 1 L (Québon/Lactantia)", price: 2.99 };
        if (ml <= 2000) return { quantity: "1", unit: "carton 2 L (Québon/Lactantia)", price: 4.29 };
        return { quantity: "1", unit: "carton 4 L (Québon/Lactantia)", price: 6.49 };
      }
      if (/creme sure|crème sure|creme aigre/.test(n)) {
        return { quantity: "1", unit: "pot 500 mL (Sealtest/Beatrice)", price: 3.49 };
      }
      if (/creme 35|creme a fouetter|crème 35|crème à fouetter/.test(n)) {
        return { quantity: "1", unit: "carton 473 mL (Québon/Gay Lea)", price: 4.49 };
      }
      if (/creme 15|creme a cuisson|crème 15|crème cuisine/.test(n)) {
        return { quantity: "1", unit: "carton 473 mL (Québon)", price: 3.49 };
      }
      if (/creme de coco|lait de coco/.test(n)) {
        const cans = Math.max(1, Math.ceil(ml / 400));
        return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 400 mL (Aroy-D/PC)`, price: cans * 2.49 };
      }

      // Bouillons (format carton 900 mL standard au Canada)
      if (/bouillon de poulet|bouillon poulet/.test(n)) {
        const cans = Math.max(1, Math.ceil(ml / 900));
        return { quantity: String(cans), unit: `carton${cans > 1 ? "s" : ""} 900 mL (Swanson/PC)`, price: cans * 2.99 };
      }
      if (/bouillon de legumes|bouillon legumes|bouillon légumes/.test(n)) {
        const cans = Math.max(1, Math.ceil(ml / 900));
        return { quantity: String(cans), unit: `carton${cans > 1 ? "s" : ""} 900 mL (Swanson/PC)`, price: cans * 2.99 };
      }
      if (/bouillon de boeuf|bouillon boeuf|bouillon bœuf/.test(n)) {
        const cans = Math.max(1, Math.ceil(ml / 900));
        return { quantity: String(cans), unit: `carton${cans > 1 ? "s" : ""} 900 mL (Swanson)`, price: cans * 2.99 };
      }
      if (/bouillon/.test(n)) {
        const cans = Math.max(1, Math.ceil(ml / 900));
        return { quantity: String(cans), unit: `carton${cans > 1 ? "s" : ""} 900 mL`, price: cans * 2.99 };
      }

      // Tomates en boîte (format 796 mL = standard Canada chez IGA/Metro)
      if (/tomate en des|tomates en dés|tomate en dé|tomates broyees|tomates broyées|tomate broyee|tomate entiere|tomates pelees|passata|coulis de tomate|sauce tomate/.test(n)) {
        const cans = Math.max(1, Math.ceil(ml / 796));
        return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 796 mL (Aylmer/Hunts)`, price: cans * 2.29 };
      }

      // Huiles
      if (/huile d.olive|huile olive/.test(n)) {
        return { quantity: "1", unit: "bouteille 500 mL (Bertolli/President's Choice)", price: 7.99 };
      }
      if (/huile de sesame|huile sesame/.test(n)) {
        return { quantity: "1", unit: "bouteille 250 mL (Lee Kum Kee)", price: 5.49 };
      }
      if (/huile de coco|huile coco/.test(n)) {
        return { quantity: "1", unit: "pot 414 mL (Nutiva/PC)", price: 8.99 };
      }
      if (/huile/.test(n)) {
        return { quantity: "1", unit: "bouteille 750 mL", price: 6.99 };
      }

      // Condiments & sauces
      if (/sauce tamari|tamari/.test(n)) {
        return { quantity: "1", unit: "bouteille 250 mL (San-J/La Choy)", price: 4.99 };
      }
      if (/sauce soya|soja/.test(n)) {
        return { quantity: "1", unit: "bouteille 250 mL (Kikkoman)", price: 2.99 };
      }
      if (/sauce sriracha|sriracha/.test(n)) {
        return { quantity: "1", unit: "bouteille 482 mL (Huy Fong)", price: 4.99 };
      }
      if (/sauce worcestershire/.test(n)) {
        return { quantity: "1", unit: "bouteille 142 mL (Lea & Perrins)", price: 3.49 };
      }
      if (/sauce poisson|fish sauce|nuoc-mam/.test(n)) {
        return { quantity: "1", unit: "bouteille 200 mL", price: 3.99 };
      }
      if (/sirop d.erable|sirop erable|sirop d'érable/.test(n)) {
        return { quantity: "1", unit: "bouteille 540 mL (sirop du Québec)", price: 12.99 };
      }
      if (/miel/.test(n)) {
        return { quantity: "1", unit: "pot 500 g (Billy Bee/miel local)", price: 7.99 };
      }
      if (/vinaigre de cidre|vinaigre cidre/.test(n)) {
        return { quantity: "1", unit: "bouteille 946 mL (Bragg/PC)", price: 4.99 };
      }
      if (/vinaigre balsamique|balsamique/.test(n)) {
        return { quantity: "1", unit: "bouteille 500 mL", price: 5.99 };
      }
      if (/vinaigre de riz|vinaigre riz/.test(n)) {
        return { quantity: "1", unit: "bouteille 355 mL (Marukan)", price: 3.99 };
      }
      if (/vinaigre/.test(n)) {
        return { quantity: "1", unit: "bouteille 946 mL", price: 3.49 };
      }
      if (/moutarde de dijon|moutarde dijon/.test(n)) {
        return { quantity: "1", unit: "pot 250 mL (Maille/President's Choice)", price: 3.49 };
      }
      if (/moutarde/.test(n)) {
        return { quantity: "1", unit: "pot 400 mL (French's)", price: 2.99 };
      }
      if (/pate de tomates|pâte de tomates/.test(n)) {
        return { quantity: "1", unit: "boîte 156 mL (Aylmer)", price: 1.49 };
      }
      if (/sauce hoisin|hoisin/.test(n)) {
        return { quantity: "1", unit: "bouteille 240 mL (Lee Kum Kee)", price: 3.99 };
      }
      if (/sauce aux huitres|sauce huitres|oyster sauce/.test(n)) {
        return { quantity: "1", unit: "bouteille 230 mL (Lee Kum Kee)", price: 3.99 };
      }
      if (/tahini|beurre de sesame/.test(n)) {
        return { quantity: "1", unit: "pot 250 g (Joyva/PC)", price: 4.99 };
      }
      if (/houmous|hummus/.test(n)) {
        return { quantity: "1", unit: "contenant 227 g (Sabra/Fontaine Santé)", price: 4.49 };
      }
      if (/yogourt grec|yogurt grec|yaourt grec/.test(n)) {
        return { quantity: "1", unit: "pot 750 g (Liberté Méditerranée)", price: 6.49 };
      }
      if (/yogourt|yogurt|yaourt/.test(n)) {
        return { quantity: "1", unit: "pot 750 g", price: 4.99 };
      }

      // Bière (pour cuisson)
      if (/biere|bière/.test(n)) {
        return { quantity: "1", unit: "canette 473 mL (bière locale Québec)", price: 2.99 };
      }
      if (/vin blanc|vin rouge/.test(n)) {
        return { quantity: "1", unit: "bouteille 750 mL", price: 12.99 };
      }

      // Générique ml
      const containers = Math.max(1, Math.ceil(ml / 500));
      return { quantity: String(containers), unit: `contenant${containers > 1 ? "s" : ""} 500 mL`, price: containers * 3.99 };
    }

    // ── Ingrédients à l'unité ──────────────────────────────────────────────────
    const u = Math.max(1, Math.ceil(p.totalUnits));

    // Œufs
    if (/oeuf|œuf/.test(n)) {
      if (u <= 12) return { quantity: "1", unit: "douzaine d'œufs (gros)", price: 4.99 };
      if (u <= 18) return { quantity: "1", unit: "boîte de 18 œufs", price: 6.99 };
      return { quantity: "1", unit: "boîte de 24 œufs", price: 8.99 };
    }

    // Ail
    if (/ail/.test(n) && /gousse|tete|tête/.test(p.rawUnit)) {
      if (u <= 6) return { quantity: "1", unit: "tête d'ail", price: 0.99 };
      return { quantity: "1", unit: "sac de 3 têtes d'ail", price: 2.49 };
    }
    if (/ail/.test(n)) {
      return { quantity: "1", unit: "tête d'ail", price: 0.99 };
    }

    // Conserves (540 mL = format standard Canada chez IGA/Metro)
    if (/pois chiche/.test(n)) {
      const cans = Math.max(1, u);
      return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 540 mL (PC/Unico)`, price: cans * 1.49 };
    }
    if (/haricot noir|haricots noirs/.test(n)) {
      const cans = Math.max(1, u);
      return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 540 mL (Unico/PC)`, price: cans * 1.49 };
    }
    if (/haricot rouge|haricots rouges/.test(n)) {
      const cans = Math.max(1, u);
      return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 540 mL (Unico)`, price: cans * 1.49 };
    }
    if (/lentille/.test(n)) {
      const cans = Math.max(1, u);
      return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 540 mL (PC)`, price: cans * 1.49 };
    }
    if (/thon/.test(n)) {
      const cans = Math.max(1, u);
      return { quantity: String(cans), unit: `boîte${cans > 1 ? "s" : ""} 170 g (Clover Leaf/PC)`, price: cans * 2.49 };
    }
    if (/sardine/.test(n)) {
      return { quantity: "1", unit: "boîte 125 g", price: 2.29 };
    }
    if (/mais en conserve|maïs en conserve|mais sucre/.test(n)) {
      return { quantity: "1", unit: "boîte 341 mL (Green Giant/PC)", price: 1.29 };
    }

    // Légumes vendus à l'unité
    if (/oignon jaune|oignon rouge|oignon espagnol/.test(n)) {
      if (u <= 3) return { quantity: "1", unit: "filet 3 lb (~6 oignons, PC/IGA)", price: 3.49 };
      return { quantity: "1", unit: "sac 10 lb (~20 oignons)", price: 5.99 };
    }
    if (/oignon|echalote|echalote/.test(n)) {
      return { quantity: "1", unit: "filet 3 lb (~6 oignons)", price: 3.49 };
    }
    if (/carotte/.test(n)) {
      return { quantity: "1", unit: "sac 2 lb (~900 g, IGA/Metro)", price: 2.99 };
    }
    if (/patates? douces?/.test(n)) {
      return { quantity: "1", unit: "sac 2 lb (~900 g)", price: 3.99 };
    }
    if (/pomme[s]? de terre|patates?(?! douce)/.test(n)) {
      return { quantity: "1", unit: "sac 5 lb (2.27 kg, Yellow Gold/Russet)", price: 5.99 };
    }
    if (/tomates? cerises?|tomates? raisins?/.test(n)) {
      const pkgs = Math.max(1, Math.ceil(u / 1));
      return { quantity: String(pkgs), unit: `barquette${pkgs > 1 ? "s" : ""} 227 g`, price: pkgs * 3.99 };
    }
    if (/feta/.test(n)) {
      return { quantity: "1", unit: "bloc en saumure 200 g", price: 4.99 };
    }
    if (/tomate(?! cerise| raisin)/.test(n)) {
      if (u <= 2) return { quantity: `${u}`, unit: "grosse(s) tomate(s) sur vigne", price: u * 1.49 };
      return { quantity: "1", unit: "sac de 6 tomates sur vigne", price: 4.99 };
    }
    if (/poivron/.test(n)) {
      if (u <= 2) return { quantity: `${u}`, unit: "poivron(s) rouge(s)/jaune(s)", price: u * 1.49 };
      return { quantity: "1", unit: "sac de 3 poivrons tricolores", price: 4.99 };
    }
    if (/concombre/.test(n)) {
      return { quantity: `${u}`, unit: "concombre(s) anglais", price: u * 1.99 };
    }
    if (/courgette|zucchini/.test(n)) {
      if (u <= 2) return { quantity: `${u}`, unit: "courgette(s)", price: u * 1.49 };
      return { quantity: "1", unit: "sac de 3 courgettes", price: 3.99 };
    }
    if (/citron/.test(n)) {
      if (u <= 2) return { quantity: `${u}`, unit: "citron(s)", price: u * 0.99 };
      return { quantity: "1", unit: "filet de 5 citrons", price: 3.99 };
    }
    if (/lime|limette/.test(n)) {
      if (u <= 2) return { quantity: `${u}`, unit: "lime(s)", price: u * 0.79 };
      return { quantity: "1", unit: "filet de 5 limes", price: 2.99 };
    }
    if (/avocat/.test(n)) {
      if (u <= 2) return { quantity: `${u}`, unit: "avocat(s) Hass bien mûr(s)", price: u * 1.99 };
      return { quantity: "1", unit: "sac de 4 avocats Hass", price: 5.99 };
    }
    if (/mangue/.test(n)) {
      return { quantity: `${u}`, unit: "mangue(s) Ataulfo", price: u * 1.99 };
    }
    if (/banane/.test(n)) {
      return { quantity: "1", unit: "régime de bananes (~6)", price: 1.99 };
    }
    if (/pomme/.test(n) && !/pate de pomme/.test(n)) {
      return { quantity: "1", unit: "sac de 6 pommes (Gala/Cortland)", price: 4.99 };
    }
    if (/poire/.test(n)) {
      return { quantity: "1", unit: "sac de 4 poires Bosc/Bartlett", price: 3.99 };
    }
    if (/fraise/.test(n)) {
      return { quantity: "1", unit: "barquette 454 g (locale en saison)", price: 4.99 };
    }
    if (/framboises|framboise/.test(n)) {
      return { quantity: "1", unit: "barquette 170 g (ou sac surgelé 600 g)", price: 3.99 };
    }
    if (/bleuet/.test(n)) {
      return { quantity: "1", unit: "barquette 170 g (bleuets du Québec/surgelé)", price: 3.99 };
    }
    if (/poireau/.test(n)) {
      return { quantity: `${u}`, unit: "poireau(x)", price: u * 1.99 };
    }
    if (/fenouil/.test(n)) {
      return { quantity: `${u}`, unit: "bulbe(s) de fenouil", price: u * 2.49 };
    }
    if (/aubergine/.test(n)) {
      return { quantity: `${u}`, unit: "aubergine(s)", price: u * 1.99 };
    }
    if (/mais|maïs/.test(n) && !/conserve/.test(n)) {
      return { quantity: `${u}`, unit: "épi(s) de maïs (en saison)", price: u * 0.99 };
    }
    if (/asperge/.test(n)) {
      return { quantity: "1", unit: "botte d'asperges (~450 g)", price: 4.99 };
    }
    if (/herbe fraiche|herbes fraiches|ciboulette|persil|basilic|coriandre|aneth|menthe|estragon/.test(n)) {
      return { quantity: "1", unit: "botte ou pot en serre (~25 g)", price: 2.49 };
    }
    if (/naan/.test(n)) {
      return { quantity: "1", unit: "paquet de 4 naans (PC/Pains Dorés)", price: 3.99 };
    }
    if (/pita/.test(n)) {
      return { quantity: "1", unit: "paquet de 6 pitas (Toufayan/Bella)", price: 3.49 };
    }
    if (/tortilla/.test(n)) {
      return { quantity: "1", unit: "paquet de 10 tortillas de blé (Mission)", price: 4.49 };
    }
    if (/pain de seigle|pain de ble|pain intégral|pain integral|pain/.test(n)) {
      return { quantity: "1", unit: "miche/pain tranché (Première Moisson/PC)", price: 4.99 };
    }
    if (/ravioli/.test(n)) {
      return { quantity: "1", unit: "paquet 350 g pâtes fraîches (Giovanni/PC)", price: 5.99 };
    }

    // Ingrédients conserves génériques (si rawUnit = boîte/conserve)
    if (/boite|boîte|conserve/.test(p.rawUnit)) {
      return { quantity: `${u}`, unit: `boîte${u > 1 ? "s" : ""} 540 mL`, price: u * 2.29 };
    }

    // Fallback générique
    return { quantity: `${u}`, unit: `unité${u > 1 ? "s" : ""}`, price: u * 2.49 };
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

  const shoppingList = Array.from(parsedMap.values()).flatMap((p) => {
    const grocery = toGroceryFormat(p);
    if (!grocery) return []; // épice/condiment de base → exclure
    const category = getCategoryForIngredient(p.groupKey);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return [{
      name: cap(p.displayName),
      quantity: grocery.quantity,
      unit: grocery.unit,
      category,
      estimatedPrice: Math.round(grocery.price * 100) / 100,
      inFridge: fridgeNames.some(f => f.includes(p.groupKey) || p.groupKey.includes(f)),
    }];
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
  // Champignons — AVANT Noix (sinon "champignon" match "pignon" et "shiitake" match rien de bon)
  {
    category: "Légumes",
    keywords: [
      "champignon", "shiitake", "portobello", "cremini", "pleurote", "chanterelle",
      "girolles", "morille", "cèpe", "cepe", "bolet", "pak choi", "bok choy",
    ],
  },
  // Noix et graines (avant Épices)
  {
    category: "Noix & Graines",
    keywords: [
      "amande", "noix de", "noisette", "pistache", "cajou", "pacane", "pignon de pin",
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
      "brocoli", "rapini", "brocoli chinois", "gai lan",
      "chou-fleur", "chou rouge", "chou vert", "chou napa", "chou", "épinard", "epinard",
      "laitue", "laitue romaine", "roquette", "mâche", "mache", "mizuna", "mesclun",
      "radicchio", "trévise", "endive", "blette", "bette à carde",
      "concombre", "céleri-rave", "celeriac", "céleri", "celeri",
      "poireau", "courgette", "zucchini", "aubergine",
      "champignon", "radis", "betterave", "navet", "rutabaga",
      "panais", "courge butternut", "courge spaghetti", "courge", "citrouille",
      "asperge", "artichaut", "fenouil", "maïs", "mais",
      "pomme de terre", "patate", "igname", "topinambour",
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
