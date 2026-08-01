/**
 * Entrada explicita para operaciones globales de plataforma.
 *
 * El codigo empresarial debe importar `tenant-prisma`; este cliente se reserva
 * para identidad global, catalogos RBAC, resolucion de empresas y mantenimiento.
 */
export { platformPrisma } from "./prisma";
