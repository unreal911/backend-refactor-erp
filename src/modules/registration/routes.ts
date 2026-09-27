import { Router } from "express";
import {
    authRateLimiter,
    ownerSignupEdgeRateLimiter,
} from "../../presentation/middlewares/rate-limit";
import { OwnerRegistrationController } from "./controller";
import {
    createOwnerRegistrationServiceFromEnvironment,
    createOwnerSignupAbuseServiceFromEnvironment,
} from "./factory";
import { OwnerRegistrationService } from "./owner-registration.service";
import { OwnerSignupAbuseGuard } from "./owner-signup-abuse.service";
import { TrialProvisioningService } from "./trial-provisioning.service";

export function registerOwnerRegistrationRoutes(
    router: Router,
    service?: OwnerRegistrationService | null,
    abuseService: OwnerSignupAbuseGuard | null = createOwnerSignupAbuseServiceFromEnvironment(),
        trialService?: TrialProvisioningService | null,
): void {
    const registrationService = service === undefined
        ? createOwnerRegistrationServiceFromEnvironment()
        : service;
    const controller = new OwnerRegistrationController(
        registrationService,
        abuseService,
        trialService,
    );
    router.post("/api/public/signup", ownerSignupEdgeRateLimiter, controller.signup);
    router.post("/api/public/signup/resend", authRateLimiter, controller.resendVerification);
    router.post("/api/public/signup/verify", authRateLimiter, controller.verifyEmail);
    router.post("/api/public/signup/trial", authRateLimiter, controller.provisionTrial);
}
