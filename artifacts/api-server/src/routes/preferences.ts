import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userPreferencesTable } from "@workspace/db";
import {
  GetPreferencesResponse,
  SavePreferencesBody,
  SavePreferencesResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/preferences", async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  let [prefs] = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId))
    .limit(1);

  if (!prefs) {
    const [created] = await db
      .insert(userPreferencesTable)
      .values({
        userId,
        cookingTimePerDay: 45,
        weeklyBudget: 150,
        numberOfPeople: 2,
        allergies: [],
        dietaryPreferences: [],
        cuisinePreferences: [],
        mealTypes: ["breakfast", "lunch", "dinner"],
      })
      .returning();
    prefs = created;
  }

  // difficultyPreference stored as JSON string in text column; parse it back to array
  let diffArr: string[];
  try {
    const parsed = JSON.parse(prefs.difficultyPreference);
    diffArr = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    diffArr = [prefs.difficultyPreference ?? "Moyen"];
  }

  res.json(GetPreferencesResponse.parse({
    ...prefs,
    difficultyPreference: diffArr,
    updatedAt: prefs.updatedAt.toISOString(),
  }));
});

router.put("/preferences", async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const parsed = SavePreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, userId))
    .limit(1);

  // Serialize the difficulty array to JSON string for the text DB column
  const dataToSave = {
    ...parsed.data,
    difficultyPreference: JSON.stringify(parsed.data.difficultyPreference),
  };

  let prefs;
  if (existing) {
    const [updated] = await db
      .update(userPreferencesTable)
      .set(dataToSave)
      .where(eq(userPreferencesTable.userId, userId))
      .returning();
    prefs = updated;
  } else {
    const [created] = await db
      .insert(userPreferencesTable)
      .values({ ...dataToSave, userId })
      .returning();
    prefs = created;
  }

  // Parse difficulty back to array for response
  let diffArr: string[];
  try {
    const d = JSON.parse(prefs.difficultyPreference);
    diffArr = Array.isArray(d) ? d : [d];
  } catch {
    diffArr = [prefs.difficultyPreference ?? "Moyen"];
  }

  res.json(SavePreferencesResponse.parse({
    ...prefs,
    difficultyPreference: diffArr,
    updatedAt: prefs.updatedAt.toISOString(),
  }));
});

export default router;
