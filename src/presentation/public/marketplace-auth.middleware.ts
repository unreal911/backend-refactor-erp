import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { envs } from '../../config/envs';

export interface MarketplaceAuthRequest extends Request {
    marketplaceCustomer?: {
        id: number;
        email: string;
    };
}

type MarketplaceTokenPayload = {
    customerId: number;
    email: string;
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

            if (!decoded || decoded.tokenType !== 'MARKETPLACE_CUSTOMER') {
                return res.status(401).json({ message: 'Token de cliente invalido' });
            }

            req.marketplaceCustomer = {
                id: Number(decoded.customerId),
                email: String(decoded.email || ''),
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

