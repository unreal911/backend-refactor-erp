import { prisma } from '../../data/prisma';
import bcrypt from 'bcryptjs';
import { CreateUserDto, UpdateUserDto } from '../../domain/dtos/user.dto';

export class UserService {
    private static async ensureAssignableRole(roleId: number) {
        const role = await prisma.role.findUnique({
            where: { id: roleId },
            select: { id: true, isActive: true }
        });

        if (!role) {
            throw new Error('El rol seleccionado no existe');
        }

        if (!role.isActive) {
            throw new Error('No se puede asignar un rol inactivo');
        }
    }

    static async create(createUserDto: CreateUserDto) {
        const { firstName, lastName, email, password, roleId, isActive } = createUserDto;

        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            throw new Error('El correo electronico ya esta registrado');
        }

        await this.ensureAssignableRole(roleId);

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                email,
                password: hashedPassword,
                roleId,
                isActive
            },
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    static async findAll() {
        const users = await prisma.user.findMany({
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        return users.map((user) => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });
    }

    static async findById(id: number) {
        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    static async update(id: number, updateUserDto: UpdateUserDto) {
        const updateData: {
            firstName?: string;
            lastName?: string;
            email?: string;
            roleId?: number;
            isActive?: boolean;
        } = {};

        if (updateUserDto.firstName !== undefined) updateData.firstName = updateUserDto.firstName;
        if (updateUserDto.lastName !== undefined) updateData.lastName = updateUserDto.lastName;
        if (updateUserDto.email !== undefined) updateData.email = updateUserDto.email;
        if (updateUserDto.roleId !== undefined) {
            await this.ensureAssignableRole(updateUserDto.roleId);
            updateData.roleId = updateUserDto.roleId;
        }
        if (updateUserDto.isActive !== undefined) updateData.isActive = updateUserDto.isActive;

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    static async delete(id: number) {
        await prisma.user.delete({
            where: { id }
        });
        return { message: 'Usuario eliminado exitosamente' };
    }

    static async changePassword(id: number, newPassword: string) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id },
            data: { password: hashedPassword }
        });

        return { message: 'Contrasena actualizada exitosamente' };
    }
}
