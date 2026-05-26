import { prisma } from "../prisma";
import { PermissionService } from "../../presentation/services/permission.service";
import { RoleSeedSummary } from "./types";

const ROLE_DEFINITIONS: Array<{ name: string; description: string }> = [
    { name: "ADMIN", description: "Acceso total al sistema" },
    { name: "MANAGER", description: "Gestion operativa del negocio" },
    { name: "SELLER", description: "Operacion de ventas y POS" },
    { name: "WAREHOUSE", description: "Operacion de inventario y transferencias" },
    { name: "PICKER", description: "Operacion de picking y preparacion de pedidos" },
    { name: "USER", description: "Acceso basico de consulta" },
];

export async function seedBaseRolesAndPermissions(): Promise<RoleSeedSummary> {
    const roleByName = new Map<string, { id: number; name: string }>();

    for (const definition of ROLE_DEFINITIONS) {
        const role = await prisma.role.upsert({
            where: { name: definition.name },
            update: {
                description: definition.description,
                isActive: true,
            },
            create: {
                name: definition.name,
                description: definition.description,
                isActive: true,
            },
        });

        roleByName.set(role.name, { id: role.id, name: role.name });
    }

    await PermissionService.seedDefaultPermissionsForRoles(
        new Map(Array.from(roleByName.values()).map((role) => [role.id, role.name])),
    );

    return {
        roles: Array.from(roleByName.keys()),
        roleByName,
    };
}
