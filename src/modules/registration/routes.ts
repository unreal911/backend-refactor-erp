import { Router } from "express";
import { authRateLimiter } from "../../presentation/middlewares/rate-limit";
import { OwnerRegistrationController } from "./controller";
import { createOwnerRegistrationServiceFromEnvironment } from "./factory";
import { OwnerRegistrationService } from "./owner-registration.service";

export function registerOwnerRegistrationRoutes(
    router: Router,
    service: OwnerRegistrationService | null = createOwnerRegistrationServiceFromEnvironment(),
): void {
    const controller = new OwnerRegistrationController(service);
    router.post("/api/public/signup", authRateLimiter, controller.signup);
    router.post("/api/public/signup/verify", authRateLimiter, controller.verifyEmail);
}
