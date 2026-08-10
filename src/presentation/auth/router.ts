import { Router } from "express";
import { AuthController } from "./controller";
import { AuthMiddleware } from "./middleware";
import { authRateLimiter } from "../middlewares/rate-limit";
import { PasswordResetController } from "../../modules/auth/password-reset.controller";
import { createPasswordResetServiceFromEnvironment } from "../../modules/auth/password-reset.factory";

export class AuthRouter {
    static get router(): Router {
        const router = Router();
        const passwordResetController = new PasswordResetController(
            createPasswordResetServiceFromEnvironment(),
        );

        router.post('/login', authRateLimiter, AuthController.login);
        router.post('/password-reset/request', authRateLimiter, passwordResetController.request);
        router.post('/password-reset/confirm', authRateLimiter, passwordResetController.confirm);
        router.post('/platform/login', authRateLimiter, AuthController.platformLogin);
        router.get('/me', AuthMiddleware.validateJWT, AuthController.me);
        router.post('/logout', AuthController.logout);

        return router;
    }
}
