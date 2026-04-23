import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fridgeRouter from "./fridge";
import preferencesRouter from "./preferences";
import menuRouter from "./menu";
import storesRouter from "./stores";
import stripeRouter from "./stripe";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fridgeRouter);
router.use(preferencesRouter);
router.use(menuRouter);
router.use(storesRouter);
router.use(stripeRouter);

export default router;
