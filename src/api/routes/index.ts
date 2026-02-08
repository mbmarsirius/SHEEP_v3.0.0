/**
 * Route Aggregation
 */

import { Router, type Router as ExpressRouter } from "express";
import billingRouter from "./billing.js";
import federationRouter from "./federation.js";
import healthRouter from "./health.js";
import memoryRouter from "./memory.js";

const router: ExpressRouter = Router();

router.use("/health", healthRouter);
router.use("/federation", federationRouter);
router.use("/memory", memoryRouter);
router.use("/billing", billingRouter);

export default router;
