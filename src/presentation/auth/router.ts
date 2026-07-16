import { Router } from "express";
import { AuthController } from "./controller";
import { AuthMiddleware } from "./middleware";
import { authRateLimiter } from "../middlewares/rate-limit";

export class AuthRouter {
    static get router(): Router {
        const router = Router();

        router.post('/login', authRateLimiter, AuthController.login);
        router.get('/me', AuthMiddleware.validateJWT, AuthController.me);
        router.post('/logout', AuthController.logout);

        return router;
    }
}
