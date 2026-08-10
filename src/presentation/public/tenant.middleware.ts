import { NextFunction, Request, Response } from "express";
import {
    runTenantDatabaseTransaction,
} from "../../data/prisma";
import { platformPrisma } from "../../data/platform-prisma";
import { TenantStatus } from "@prisma/client";
import { continueThroughResponse } from "../response-tasks";

export interface PublicTenantRequest extends Request {
    publicTenant?: {
        id: string;
        marketplaceSlug: string;
    };
}

export class PublicTenantMiddleware {
    static async resolve(req: PublicTenantRequest, res: Response, next: NextFunction) {
        const headerSlug = req.header("x-tenant-slug");
        const querySlug = typeof req.query.tenantSlug === "string"
            ? req.query.tenantSlug
            : null;
        const requestedSlug = String(headerSlug || querySlug || "").trim().toLowerCase();
        const activeWhere = {
            status: { in: [TenantStatus.TRIAL, TenantStatus.ACTIVE] },
            OR: [
                { status: TenantStatus.ACTIVE },
                { trialEndsAt: { gt: new Date() } },
            ],
        };

        const tenants = requestedSlug
            ? await platformPrisma.tenant.findMany({
                where: {
                    AND: [
                        {
                            OR: [
                                { marketplaceSlug: requestedSlug },
                                // Compatibilidad para tenants creados antes de la separacion.
                                { marketplaceSlug: null, slug: requestedSlug },
                            ],
                        },
                        activeWhere,
                    ],
                },
                select: { id: true, slug: true, marketplaceSlug: true },
                take: 1,
            })
            : await platformPrisma.tenant.findMany({
                where: activeWhere,
                select: { id: true, slug: true, marketplaceSlug: true },
                orderBy: { createdAt: "asc" },
                take: 2,
            });

        if (tenants.length === 0) {
            return res.status(404).json({ message: "Empresa no disponible" });
        }
        if (!requestedSlug && tenants.length > 1) {
            return res.status(400).json({
                message: "Debes indicar x-tenant-slug para acceder al marketplace",
            });
        }

        const tenant = tenants[0]!;
        req.publicTenant = {
            id: tenant.id,
            marketplaceSlug: tenant.marketplaceSlug || tenant.slug,
        };
        return runTenantDatabaseTransaction(
            tenant.id,
            () => continueThroughResponse(res, next),
        );
    }
}
