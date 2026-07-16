import { prisma } from './prisma';

/**
 * Red de seguridad a nivel BD contra sobre-reserva / stock negativo.
 * Convierte cualquier casuistica de cruce no cubierta por el codigo en un error
 * transaccional (rollback) en vez de un oversell silencioso.
 *
 * Se agregan como NOT VALID: se aplican a TODO INSERT/UPDATE nuevo, pero no
 * fallan el arranque si existieran filas legacy inconsistentes (esas se detectan
 * con la auditoria `auditReservedStock`). Idempotente via pg_constraint.
 */
const INVENTORY_INTEGRITY_STATEMENTS: string[] = [
    `DO $$
     BEGIN
         IF NOT EXISTS (
             SELECT 1 FROM pg_constraint WHERE conname = 'Inventory_stock_nonneg_check'
         ) THEN
             ALTER TABLE "Inventory"
                 ADD CONSTRAINT "Inventory_stock_nonneg_check"
                 CHECK ("stock" >= 0) NOT VALID;
         END IF;

         IF NOT EXISTS (
             SELECT 1 FROM pg_constraint WHERE conname = 'Inventory_reserved_range_check'
         ) THEN
             ALTER TABLE "Inventory"
                 ADD CONSTRAINT "Inventory_reserved_range_check"
                 CHECK ("reservedStock" >= 0 AND "reservedStock" <= "stock") NOT VALID;
         END IF;
     END $$;`,
];

export async function ensureInventoryIntegritySchema(): Promise<void> {
    for (const statement of INVENTORY_INTEGRITY_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }
}
