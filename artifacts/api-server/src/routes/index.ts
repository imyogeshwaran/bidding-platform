import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import auctionsRouter from "./auctions";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(auctionsRouter);
router.use(accountRouter);

export default router;
