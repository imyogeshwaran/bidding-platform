import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import auctionsRouter from "./auctions";
import accountRouter from "./account";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(auctionsRouter);
router.use(accountRouter);
router.use(adminRouter);

export default router;
