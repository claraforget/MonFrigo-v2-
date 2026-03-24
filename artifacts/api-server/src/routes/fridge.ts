import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, fridgeIngredientsTable } from "@workspace/db";
import {
  GetFridgeIngredientsResponse,
  AddFridgeIngredientBody,
  UpdateFridgeIngredientParams,
  UpdateFridgeIngredientBody,
  UpdateFridgeIngredientResponse,
  DeleteFridgeIngredientParams,
  DeleteFridgeIngredientResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/fridge/ingredients", async (req, res): Promise<void> => {
  const ingredients = await db
    .select()
    .from(fridgeIngredientsTable)
    .orderBy(fridgeIngredientsTable.createdAt);

  res.json(GetFridgeIngredientsResponse.parse(ingredients.map(i => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    expiryDate: i.expiryDate ?? null,
  }))));
});

router.post("/fridge/ingredients", async (req, res): Promise<void> => {
  const parsed = AddFridgeIngredientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [ingredient] = await db
    .insert(fridgeIngredientsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json({
    ...ingredient,
    createdAt: ingredient.createdAt.toISOString(),
    expiryDate: ingredient.expiryDate ?? null,
  });
});

router.put("/fridge/ingredients/:id", async (req, res): Promise<void> => {
  const params = UpdateFridgeIngredientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateFridgeIngredientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [ingredient] = await db
    .update(fridgeIngredientsTable)
    .set(parsed.data)
    .where(eq(fridgeIngredientsTable.id, id))
    .returning();

  if (!ingredient) {
    res.status(404).json({ error: "Ingrédient non trouvé" });
    return;
  }

  res.json(UpdateFridgeIngredientResponse.parse({
    ...ingredient,
    createdAt: ingredient.createdAt.toISOString(),
    expiryDate: ingredient.expiryDate ?? null,
  }));
});

router.delete("/fridge/ingredients/:id", async (req, res): Promise<void> => {
  const params = DeleteFridgeIngredientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [ingredient] = await db
    .delete(fridgeIngredientsTable)
    .where(eq(fridgeIngredientsTable.id, id))
    .returning();

  if (!ingredient) {
    res.status(404).json({ error: "Ingrédient non trouvé" });
    return;
  }

  res.json(DeleteFridgeIngredientResponse.parse({ success: true }));
});

export default router;
