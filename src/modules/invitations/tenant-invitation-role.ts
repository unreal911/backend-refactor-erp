import { TenantMembershipRole } from "@prisma/client";

const ROLE_LABELS: Partial<Record<TenantMembershipRole, string>> = {
    OWNER: "Propietario",
    ADMIN: "Administrador",
    MANAGER: "Encargado",
    SELLER: "Vendedor",
    WAREHOUSE: "Almacén",
    PICKER: "Preparador de pedidos",
    VIEWER: "Solo lectura",
};

export function tenantInvitationRoleLabel(role: TenantMembershipRole): string {
    return ROLE_LABELS[role] ?? role;
}
