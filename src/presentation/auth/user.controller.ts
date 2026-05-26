import { Request, Response } from 'express';
import { UserService } from '../../modules/auth/services/user.service';
import { CreateUserDto, UpdateUserDto } from '../../domain/dtos/user.dto';
import { AuthRequest } from '../auth/middleware';

export class UserController {
    static async create(req: AuthRequest, res: Response) {
        try {
            const [error, createUserDto] = CreateUserDto.create(req.body);
            if (error) {
                return res.status(400).json({ message: error });
            }

            const user = await UserService.create(createUserDto!);
            res.status(201).json(user);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    static async findAll(req: AuthRequest, res: Response) {
        try {
            const users = await UserService.findAll();
            res.json(users);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    static async findById(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const user = await UserService.findById(Number(id));
            res.json(user);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }

    static async update(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const [error, updateUserDto] = UpdateUserDto.create(req.body);
            if (error) {
                return res.status(400).json({ message: error });
            }

            const user = await UserService.update(Number(id), updateUserDto!);
            res.json(user);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    static async delete(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const result = await UserService.delete(Number(id));
            res.json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    static async changePassword(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { newPassword } = req.body;

            if (!newPassword || typeof newPassword !== 'string') {
                return res.status(400).json({ message: 'Nueva contraseña requerida' });
            }

            const result = await UserService.changePassword(Number(id), newPassword);
            res.json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }
}
