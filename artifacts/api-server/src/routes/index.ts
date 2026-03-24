import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fridgeRouter from "./fridge";
import preferencesRouter from "./preferences";
import menuRouter from "./menu";
import storesRouter from "./stores";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fridgeRouter);
router.use(preferencesRouter);
router.use(menuRouter);
router.use(storesRouter);

export default router;
