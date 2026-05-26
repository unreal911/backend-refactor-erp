import { Request, Response } from 'express';
import { AuthService } from '../../modules/auth/services/auth.service';
import { LoginDto } from '../../domain/dtos/login.dto';
import { AuthRequest } from './middleware';

export class AuthController {
    static async login(req: Request, res: Response) {
        try {
            const [error, loginDto] = LoginDto.create(req.body);
            if (error) {
                return res.status(400).json({ message: error });
            }

            const result = await AuthService.login(loginDto!);
            res.json(result);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al iniciar sesion';
            const isAuthError = message === 'Credenciales invalidas' || message === 'Usuario inactivo';

            if (isAuthError) {
                return res.status(401).json({ message });
            }

            if (message.includes('does not exist in the current database')) {
                return res.status(500).json({
                    message: 'La base de datos necesita migraciones pendientes. Ejecuta: npx prisma migrate deploy'
                });
            }

            if (message.includes('ECONNREFUSED')) {
                return res.status(500).json({
                    message: 'No se pudo conectar a la base de datos. Verifica que PostgreSQL este levantado.'
                });
            }

            return res.status(500).json({ message: 'Error interno al iniciar sesion' });
        }
    }

    static async me(req: AuthRequest, res: Response) {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ message: 'Usuario no autenticado' });
            }

            const result = await AuthService.me(req.user.id, req.user.role, req.user.permissions);
            res.json(result);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al consultar usuario';
            res.status(401).json({ message });
        }
    }

    static async logout(_req: Request, res: Response) {
        res.json({ message: 'Sesion cerrada exitosamente' });
    }
}
