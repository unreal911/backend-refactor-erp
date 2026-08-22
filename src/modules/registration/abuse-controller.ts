import { Response } from "express";
import { AuthRequest } from "../../presentation/auth/middleware";
import {
    SignupAbuseListDto,
    SignupAbuseReviewDto,
} from "./owner-signup-abuse.dto";
import { SignupAbuseReviewService } from "./owner-signup-abuse.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SignupAbuseController {
    constructor(private readonly service: SignupAbuseReviewService) {}

    list = async (req: AuthRequest, res: Response) => {
        const [error, dto] = SignupAbuseListDto.create(req.query);
        if (error) return res.status(400).json({ message: error });
        return res.json(await this.service.list({
            page: dto!.page,
            limit: dto!.limit,
            ...(dto!.reviewStatus ? { reviewStatus: dto!.reviewStatus } : {}),
        }));
    };

    review = async (req: AuthRequest, res: Response) => {
        if (!req.platform?.platformAdminId) {
            return res.status(403).json({ message: "Acceso de plataforma requerido" });
        }
        const eventId = String(req.params.id || "");
        if (!UUID_PATTERN.test(eventId)) {
            return res.status(400).json({ message: "Referencia no válida" });
        }
        const [error, dto] = SignupAbuseReviewDto.create(req.body);
        if (error) return res.status(400).json({ message: error });
        const reviewed = await this.service.review({
            eventId,
            platformAdminId: req.platform.platformAdminId,
            outcome: dto!.outcome,
            note: dto!.noteCode,
            overrideHours: dto!.overrideHours,
        });
        if (!reviewed) return res.status(404).json({ message: "Referencia no encontrada" });
        return res.json({
            id: reviewed.id,
            reviewStatus: reviewed.reviewStatus,
            reviewedAt: reviewed.reviewedAt,
            overrideUntil: reviewed.overrideUntil,
        });
    };
}
