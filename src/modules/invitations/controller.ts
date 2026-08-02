import { Request, Response } from "express";
import { AuthRequest } from "../../presentation/auth/middleware";
import {
    AcceptTenantInvitationDto,
    CreateTenantInvitationDto,
    InvitationTokenDto,
} from "./tenant-invitation.dto";
import {
    TenantInvitationError,
    TenantInvitationService,
} from "./tenant-invitation.service";

function handleInvitationError(caught: unknown, res: Response): Response {
    if (caught instanceof TenantInvitationError) {
        return res.status(caught.statusCode).json({ message: caught.message });
    }
    return res.status(500).json({ message: "No se pudo procesar la invitaci\u00f3n" });
}

export class TenantInvitationController {
    constructor(private readonly service: TenantInvitationService | null) {}

    private unavailable(res: Response): Response | null {
        return this.service
            ? null
            : res.status(503).json({ message: "Las invitaciones no est\u00e1n disponibles" });
    }

    create = async (req: AuthRequest, res: Response) => {
        const unavailable = this.unavailable(res);
        if (unavailable) return unavailable;
        if (!req.user || !req.tenant) {
            return res.status(403).json({ message: "Contexto de empresa requerido" });
        }
        const [error, dto] = CreateTenantInvitationDto.create(req.body);
        if (error) return res.status(400).json({ message: error });
        try {
            const invitation = await this.service!.invite(dto!, {
                userId: req.user.id,
                email: req.user.email,
                tenant: req.tenant,
            });
            return res.status(invitation.resent ? 200 : 201).json({ invitation });
        } catch (caught) {
            return handleInvitationError(caught, res);
        }
    };

    list = async (req: AuthRequest, res: Response) => {
        const unavailable = this.unavailable(res);
        if (unavailable) return unavailable;
        if (!req.tenant) {
            return res.status(403).json({ message: "Contexto de empresa requerido" });
        }
        try {
            return res.json({ invitations: await this.service!.list(req.tenant) });
        } catch (caught) {
            return handleInvitationError(caught, res);
        }
    };

    revoke = async (req: AuthRequest, res: Response) => {
        const unavailable = this.unavailable(res);
        if (unavailable) return unavailable;
        if (!req.tenant) {
            return res.status(403).json({ message: "Contexto de empresa requerido" });
        }
        const id = String(req.params.id || "").trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ message: "Identificador de invitaci\u00f3n inv\u00e1lido" });
        }
        try {
            return res.json(await this.service!.revoke(id, req.tenant));
        } catch (caught) {
            return handleInvitationError(caught, res);
        }
    };

    inspect = async (req: Request, res: Response) => {
        const unavailable = this.unavailable(res);
        if (unavailable) return unavailable;
        const [error, dto] = InvitationTokenDto.create(req.body);
        if (error) return res.status(400).json({ message: error });
        try {
            return res.json({ invitation: await this.service!.inspect(dto!.token) });
        } catch (caught) {
            return handleInvitationError(caught, res);
        }
    };

    accept = async (req: Request, res: Response) => {
        const unavailable = this.unavailable(res);
        if (unavailable) return unavailable;
        const [error, dto] = AcceptTenantInvitationDto.create(req.body);
        if (error) return res.status(400).json({ message: error });
        try {
            const accepted = await this.service!.accept(dto!);
            return res.status(accepted.idempotentReplay ? 200 : 201).json(accepted);
        } catch (caught) {
            return handleInvitationError(caught, res);
        }
    };
}
