import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import {
    authRateLimiter,
    ownerSignupEdgeRateLimiter,
} from "../../presentation/middlewares/rate-limit";
import { SignupAbuseController } from "./abuse-controller";
import { OwnerRegistrationController } from "./controller";
import {
    createOwnerRegistrationServiceFromEnvironment,
    createOwnerSignupAbuseServiceFromEnvironment,
} from "./factory";
import { OwnerRegistrationService } from "./owner-registration.service";
import {
    OwnerSignupAbuseGuard,
    SignupAbuseReviewService,
} from "./owner-signup-abuse.service";
import { TrialProvisioningService } from "./trial-provisioning.service";

export function registerOwnerRegistrationRoutes(
    router: Router,
    service: OwnerRegistrationService | null = createOwnerRegistrationServiceFromEnvironment(),
    abuseService: OwnerSignupAbuseGuard | null = createOwnerSignupAbuseServiceFromEnvironment(),
    reviewService: SignupAbuseReviewService = new SignupAbuseReviewService(),
    trialService?: TrialProvisioningService | null,
): void {
    const controller = new OwnerRegistrationController(service, abuseService, trialService);
    const abuseController = new SignupAbuseController(reviewService);
    router.post("/api/public/signup", ownerSignupEdgeRateLimiter, controller.signup);
    router.post("/api/public/signup/verify", authRateLimiter, controller.verifyEmail);
    router.post("/api/public/signup/trial", authRateLimiter, controller.provisionTrial);
    router.get(
        "/api/platform/signup-abuse/events",
        AuthMiddleware.validatePlatformJWT,
        abuseController.list,
    );
    router.post(
        "/api/platform/signup-abuse/events/:id/review",
        AuthMiddleware.validatePlatformJWT,
        abuseController.review,
    );
}
