import { Router, type IRouter } from "express";
import { db, userPreferencesTable } from "@workspace/db";
import {
  GetPreferencesResponse,
  SavePreferencesBody,
  SavePreferencesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/preferences", async (req, res): Promise<void> => {
  let [prefs] = await db.select().from(userPreferencesTable).limit(1);

  if (!prefs) {
    const [created] = await db
      .insert(userPreferencesTable)
      .values({
        cookingTimePerDay: 45,
        weeklyBudget: 150,
        numberOfPeople: 2,
        allergies: [],
        dietaryPreferences: [],
        cuisinePreferences: [],
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
  const parsed = SavePreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let [existing] = await db.select().from(userPreferencesTable).limit(1);

  let prefs;
  if (existing) {
    const [updated] = await db
      .update(userPreferencesTable)
      .set(parsed.data)
      .returning();
    prefs = updated;
  } else {
    const [created] = await db
      .insert(userPreferencesTable)
      .values(parsed.data)
      .returning();
    prefs = created;
  }

  res.json(SavePreferencesResponse.parse({
    ...prefs,
    updatedAt: prefs.updatedAt.toISOString(),
  }));
});

export default router;
