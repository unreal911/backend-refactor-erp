import { Request, Response } from "express";
import {
    OwnerSignupDto,
    VerifyOwnerEmailDto,
} from "./owner-registration.dto";
import {
    OwnerRegistrationService,
    OwnerRegistrationTokenError,
    OwnerRegistrationTrialLimitError,
} from "./owner-registration.service";
import { OwnerSignupAbuseRequestDto } from "./owner-signup-abuse.dto";
import { OwnerSignupAbuseGuard } from "./owner-signup-abuse.service";
import { ProvisionTrialDto } from "./trial-provisioning.dto";
import {
    TrialProvisioningConfigurationError,
    TrialProvisioningConflictError,
    TrialProvisioningService,
} from "./trial-provisioning.service";

export const GENERIC_SIGNUP_RESPONSE = {
    message: "Si los datos son válidos, recibirás instrucciones para verificar tu correo.",
};

export class OwnerRegistrationController {
    private readonly trialService: TrialProvisioningService | null;

    constructor(
        private readonly service: OwnerRegistrationService | null,
        private readonly abuseService: OwnerSignupAbuseGuard | null,
        trialService?: TrialProvisioningService | null,
    ) {
        this.trialService = trialService === undefined
            ? service ? new TrialProvisioningService(service) : null
            : trialService;
    }

    signup = async (req: Request, res: Response) => {
        if (!this.service || !this.abuseService) {
            return res.status(503).json({ message: "El registro no está disponible temporalmente" });
        }
        const [error, dto] = OwnerSignupDto.create(req.body as { [key: string]: unknown });
        if (error) return res.status(400).json({ message: error });
        const [abuseError, abuseDto] = OwnerSignupAbuseRequestDto.create(
            req.body,
            req.header("x-signup-device-id"),
            [req.headers["user-agent"], req.headers["accept-language"]]
                .filter((value) => typeof value === "string" && value.trim().length > 0)
                .join("|"),
        );
        if (abuseError) return res.status(400).json({ message: abuseError });

        try {
            const decision = await this.abuseService.assess({
                email: dto!.email,
                ipAddress: String(req.ip || "unknown").slice(0, 120),
                deviceId: abuseDto!.deviceId,
                captchaToken: abuseDto!.captchaToken,
            });
            if (!decision.allowed) {
                if (decision.retryAfterSeconds) {
                    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
                }
                return res.status(decision.statusCode).json({
                    message: decision.message,
                    referenceId: decision.referenceId,
                });
            }
            await this.service.signup(dto!, decision.identity);
            return res.status(202).json(GENERIC_SIGNUP_RESPONSE);
        } catch {
            return res.status(500).json({ message: "No se pudo procesar el registro" });
        }
    };

    verifyEmail = async (req: Request, res: Response) => {
        if (!this.service) {
            return res.status(503).json({ message: "El registro no está disponible temporalmente" });
        }
        const [error, dto] = VerifyOwnerEmailDto.create(
            req.body as { [key: string]: unknown },
        );
        if (error) return res.status(400).json({ message: error });

        try {
            const result = await this.service.verifyEmail(dto!.token);
            return res.status(200).json({
                message: "Correo verificado correctamente",
                trialToken: result.trialToken,
                expiresAt: result.expiresAt.toISOString(),
            });
        } catch (caught) {
            if (caught instanceof OwnerRegistrationTokenError) {
                return res.status(caught.statusCode).json({ message: caught.message });
            }
            return res.status(500).json({ message: "No se pudo verificar el correo" });
        }
    };

    provisionTrial = async (req: Request, res: Response) => {
        if (!this.trialService) {
            return res.status(503).json({ message: "El registro no está disponible temporalmente" });
        }
        const [error, dto] = ProvisionTrialDto.create(req.body);
        if (error) return res.status(400).json({ message: error });

        try {
            const result = await this.trialService.provision(dto!.trialToken);
            return res.status(result.replayed ? 200 : 201).json({
                tenant: {
                    ...result.tenant,
                    trialStartedAt: result.tenant.trialStartedAt?.toISOString() ?? null,
                    trialEndsAt: result.tenant.trialEndsAt?.toISOString() ?? null,
                },
                membership: result.membership,
                idempotentReplay: result.replayed,
            });
        } catch (caught) {
            if (
                caught instanceof OwnerRegistrationTokenError
                || caught instanceof OwnerRegistrationTrialLimitError
                || caught instanceof TrialProvisioningConflictError
                || caught instanceof TrialProvisioningConfigurationError
            ) {
                return res.status(caught.statusCode).json({ message: caught.message });
            }
            return res.status(500).json({ message: "No se pudo crear la prueba" });
        }
    };
}
