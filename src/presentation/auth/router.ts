import { Router } from "express";
import { AuthController } from "./controller";
import { AuthMiddleware } from "./middleware";

export class AuthRouter {
    static get router(): Router {
        const router = Router();

        router.post('/login', AuthController.login);
        router.get('/me', AuthMiddleware.validateJWT, AuthController.me);
        router.post('/logout', AuthController.logout);

        return router;
    }
}
