import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { OperationalMetrics } from "../../modules/operations/operational-metrics";
import { AuthRequest } from "../auth/middleware";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function observeRequest(req: Request, res: Response, next: NextFunction): void {
    const supplied = String(req.header("x-correlation-id") || "").trim();
    const correlationId = UUID_PATTERN.test(supplied) ? supplied.toLowerCase() : randomUUID();
    (req as Request & { correlationId: string }).correlationId = correlationId;
    res.setHeader("x-correlation-id", correlationId);
    const startedAt = Date.now();
    res.on("finish", () => {
        const tenantId = (req as AuthRequest).tenant?.tenant.id ?? null;
        OperationalMetrics.observeApi(tenantId, res.statusCode, Date.now() - startedAt);
    });
    next();
}
