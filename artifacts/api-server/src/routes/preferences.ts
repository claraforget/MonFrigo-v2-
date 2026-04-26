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

  res.json(GetPreferencesResponse.parse({
    ...prefs,
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

  let prefs;
  if (existing) {
    const [updated] = await db
      .update(userPreferencesTable)
      .set(parsed.data)
      .where(eq(userPreferencesTable.userId, userId))
      .returning();
    prefs = updated;
  } else {
    const [created] = await db
      .insert(userPreferencesTable)
      .values({ ...parsed.data, userId })
      .returning();
    prefs = created;
  }

  res.json(SavePreferencesResponse.parse({
    ...prefs,
    updatedAt: prefs.updatedAt.toISOString(),
  }));
});

export default router;
