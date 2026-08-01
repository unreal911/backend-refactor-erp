import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { envs } from '../../config/envs';
import { PublicTenantRequest } from './tenant.middleware';

export interface MarketplaceAuthRequest extends PublicTenantRequest {
    marketplaceCustomer?: {
        id: number;
        email: string;
        tenantId: string;
    };
}

type MarketplaceTokenPayload = {
    customerId: number;
    email: string;
    tenantId: string;
    tokenType: 'MARKETPLACE_CUSTOMER';
};

export class MarketplaceAuthMiddleware {
    static validateJWT(req: MarketplaceAuthRequest, res: Response, next: NextFunction) {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'Token de cliente no proporcionado' });
        }

        try {
            const decoded = jwt.verify(token, envs.JWT_SECRET) as MarketplaceTokenPayload;

            if (
                !decoded
                || decoded.tokenType !== 'MARKETPLACE_CUSTOMER'
                || !decoded.tenantId
                || decoded.tenantId !== req.publicTenant?.id
            ) {
                return res.status(401).json({ message: 'Token de cliente invalido' });
            }

            req.marketplaceCustomer = {
                id: Number(decoded.customerId),
                email: String(decoded.email || ''),
                tenantId: decoded.tenantId,
            };
            next();
        } catch (error: unknown) {
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({ message: 'Token de cliente expirado' });
            }
            return res.status(401).json({ message: 'Token de cliente invalido' });
        }
    }
}
