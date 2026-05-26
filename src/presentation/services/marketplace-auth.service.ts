import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../../data/prisma';
import { envs } from '../../config/envs';
import { CustomError } from '../../domain/errors/custom.error';
import { RegisterMarketplaceCustomerDto } from '../../domain/dtos/register-marketplace-customer.dto';
import { LoginMarketplaceCustomerDto } from '../../domain/dtos/login-marketplace-customer.dto';
import { UpdateMarketplaceCustomerProfileDto } from '../../domain/dtos/update-marketplace-customer-profile.dto';

type MarketplaceCustomerRow = {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string | null;
    password: string;
    isActive: boolean;
};

type MarketplaceCustomerSafe = {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string | null;
};

type MarketplaceTokenPayload = {
    customerId: number;
    email: string;
    tokenType: 'MARKETPLACE_CUSTOMER';
};

export class MarketplaceAuthService {
    private toSafeUser(row: MarketplaceCustomerRow): MarketplaceCustomerSafe {
        return {
            id: Number(row.id),
            firstName: String(row.firstName),
            lastName: String(row.lastName),
            email: String(row.email),
            phone: String(row.phone),
            address: row.address ? String(row.address) : null,
        };
    }

    private buildToken(user: MarketplaceCustomerSafe): string {
        const payload: MarketplaceTokenPayload = {
            customerId: user.id,
            email: user.email,
            tokenType: 'MARKETPLACE_CUSTOMER',
        };

        return jwt.sign(payload, envs.JWT_SECRET, { expiresIn: '7d' });
    }

    private async findByEmail(email: string): Promise<MarketplaceCustomerRow | null> {
        const rows = await prisma.$queryRaw<MarketplaceCustomerRow[]>(
            Prisma.sql`
                SELECT
                    "id",
                    "firstName",
                    "lastName",
                    "email",
                    "phone",
                    "address",
                    "password",
                    "isActive"
                FROM "MarketplaceCustomer"
                WHERE lower("email") = lower(${email})
                LIMIT 1
            `,
        );

        return rows[0] ?? null;
    }

    async register(dto: RegisterMarketplaceCustomerDto) {
        const existing = await this.findByEmail(dto.email);
        if (existing) {
            throw CustomError.badRequest('Ya existe una cuenta con ese email');
        }

        const hashedPassword = await bcrypt.hash(dto.password, 10);
        const rows = await prisma.$queryRaw<MarketplaceCustomerRow[]>(
            Prisma.sql`
                INSERT INTO "MarketplaceCustomer" (
                    "firstName",
                    "lastName",
                    "email",
                    "phone",
                    "address",
                    "password",
                    "isActive"
                )
                VALUES (
                    ${dto.firstName},
                    ${dto.lastName},
                    ${dto.email},
                    ${dto.phone},
                    ${dto.address ?? null},
                    ${hashedPassword},
                    true
                )
                RETURNING
                    "id",
                    "firstName",
                    "lastName",
                    "email",
                    "phone",
                    "address",
                    "password",
                    "isActive"
            `,
        );

        const created = rows[0];
        if (!created) {
            throw CustomError.internal('No se pudo crear la cuenta');
        }

        const user = this.toSafeUser(created);
        const token = this.buildToken(user);
        return { token, user };
    }

    async login(dto: LoginMarketplaceCustomerDto) {
        const customer = await this.findByEmail(dto.email);
        if (!customer) {
            throw CustomError.unauthorized('Credenciales invalidas');
        }

        if (!customer.isActive) {
            throw CustomError.unauthorized('Tu cuenta esta inactiva');
        }

        const isValidPassword = await bcrypt.compare(dto.password, customer.password);
        if (!isValidPassword) {
            throw CustomError.unauthorized('Credenciales invalidas');
        }

        const user = this.toSafeUser(customer);
        const token = this.buildToken(user);
        return { token, user };
    }

    async me(customerId: number) {
        const rows = await prisma.$queryRaw<MarketplaceCustomerRow[]>(
            Prisma.sql`
                SELECT
                    "id",
                    "firstName",
                    "lastName",
                    "email",
                    "phone",
                    "address",
                    "password",
                    "isActive"
                FROM "MarketplaceCustomer"
                WHERE "id" = ${customerId}
                LIMIT 1
            `,
        );
        const customer = rows[0];

        if (!customer || !customer.isActive) {
            throw CustomError.unauthorized('Cliente no autenticado');
        }

        return { user: this.toSafeUser(customer) };
    }

    async updateProfile(customerId: number, dto: UpdateMarketplaceCustomerProfileDto) {
        const rows = await prisma.$queryRaw<MarketplaceCustomerRow[]>(
            Prisma.sql`
                UPDATE "MarketplaceCustomer"
                SET
                    "firstName" = COALESCE(${dto.firstName ?? null}, "firstName"),
                    "lastName" = COALESCE(${dto.lastName ?? null}, "lastName"),
                    "phone" = COALESCE(${dto.phone ?? null}, "phone"),
                    "address" = ${dto.address === undefined ? Prisma.sql`"address"` : dto.address},
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "id" = ${customerId}
                RETURNING
                    "id",
                    "firstName",
                    "lastName",
                    "email",
                    "phone",
                    "address",
                    "password",
                    "isActive"
            `,
        );

        const updated = rows[0];
        if (!updated || !updated.isActive) {
            throw CustomError.notFound('No se pudo actualizar el perfil');
        }

        return { user: this.toSafeUser(updated) };
    }
}
