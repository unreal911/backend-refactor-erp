import { Request, Response } from "express";
import { PasswordResetConfirmDto, PasswordResetRequestDto } from "./password-reset.dto";
import { PasswordResetService, PasswordResetTokenError } from "./password-reset.service";

const GENERIC_REQUEST_RESPONSE =
    "Si existe una cuenta activa con ese correo, recibirás un enlace para crear una nueva contraseña.";

export class PasswordResetController {
    constructor(private readonly service: PasswordResetService | null) {}

    request = async (req: Request, res: Response) => {
        const [error, dto] = PasswordResetRequestDto.create(req.body ?? {});
        if (error) return res.status(400).json({ message: error });
        if (!this.service) {
            return res.status(503).json({ message: "La recuperación de contraseña no está disponible." });
        }

        await this.service.request(dto!.email);
        return res.status(202).json({ message: GENERIC_REQUEST_RESPONSE });
    };

    confirm = async (req: Request, res: Response) => {
        const [error, dto] = PasswordResetConfirmDto.create(req.body ?? {});
        if (error) return res.status(400).json({ message: error });
        if (!this.service) {
            return res.status(503).json({ message: "La recuperación de contraseña no está disponible." });
        }

        try {
            await this.service.confirm(dto!.token, dto!.password);
            return res.json({ message: "Contraseña actualizada. Ya puedes iniciar sesión." });
        } catch (caught) {
            if (caught instanceof PasswordResetTokenError) {
                return res.status(caught.statusCode).json({ message: caught.message });
            }
            console.error("[password-reset] confirmation failed", caught);
            return res.status(500).json({ message: "No se pudo actualizar la contraseña." });
        }
    };
}
