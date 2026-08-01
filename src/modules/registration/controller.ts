import { Request, Response } from "express";
import {
    OwnerSignupDto,
    VerifyOwnerEmailDto,
} from "./owner-registration.dto";
import {
    OwnerRegistrationService,
    OwnerRegistrationTokenError,
} from "./owner-registration.service";

export const GENERIC_SIGNUP_RESPONSE = {
    message: "Si los datos son válidos, recibirás instrucciones para verificar tu correo.",
};

export class OwnerRegistrationController {
    constructor(private readonly service: OwnerRegistrationService | null) {}

    signup = async (req: Request, res: Response) => {
        if (!this.service) {
            return res.status(503).json({ message: "El registro no está disponible temporalmente" });
        }
        const [error, dto] = OwnerSignupDto.create(req.body as { [key: string]: unknown });
        if (error) return res.status(400).json({ message: error });

        try {
            await this.service.signup(dto!);
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
}
