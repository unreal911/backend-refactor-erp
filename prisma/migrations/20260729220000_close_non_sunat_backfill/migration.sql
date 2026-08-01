-- MIG-011: cierra el backfill integral no SUNAT después de MIG-003..MIG-010.
-- La única fila operativa inválida aprobada se archiva sin perder su contexto.

CREATE TABLE "TenantMigrationQuarantine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "storyId" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "originalData" JSONB NOT NULL,
    "relatedData" JSONB,
    "originalHash" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMigrationQuarantine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantMigrationQuarantine_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TenantMigrationQuarantine_originalHash_check"
        CHECK ("originalHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "TenantMigrationQuarantine_source_key"
    ON "TenantMigrationQuarantine"(
        "tenantId",
        "storyId",
        "sourceTable",
        "sourceKey"
    );
CREATE INDEX "TenantMigrationQuarantine_tenant_reason_idx"
    ON "TenantMigrationQuarantine"("tenantId", "reasonCode");

DO $$
DECLARE
    unexpected_count INTEGER;
BEGIN
    SELECT COUNT(*)::int
    INTO unexpected_count
    FROM "PickingItem"
    WHERE id = 8
      AND NOT (
          "tenantId" = '00000000-0000-4000-8000-000000000001'::uuid
          AND "sessionId" = 8
          AND "variantId" = 1
          AND quantity = 13
          AND "pickedQuantity" = 21
      );

    IF unexpected_count > 0 THEN
        RAISE EXCEPTION
            'MIG-011: PickingItem#8 no coincide con la cuarentena aprobada';
    END IF;
END
$$;

INSERT INTO "TenantMigrationQuarantine" (
    "tenantId",
    "storyId",
    "sourceTable",
    "sourceKey",
    "reasonCode",
    "resolution",
    "originalData",
    "relatedData",
    "originalHash"
)
SELECT
    item."tenantId",
    'MIG-011',
    'PickingItem',
    item.id::text,
    'QUARANTINED_LEGACY_PICKING_OVERFLOW',
    'ARCHIVED_OUTSIDE_OPERATIONAL_FLOW',
    to_jsonb(item),
    jsonb_build_object(
        'pickingOrderItemDetails',
        COALESCE((
            SELECT jsonb_agg(to_jsonb(detail) ORDER BY detail.id)
            FROM "PickingOrderItemDetail" detail
            WHERE detail."pickingItemId" = item.id
        ), '[]'::jsonb)
    ),
    encode(
        sha256(convert_to(to_jsonb(item)::text, 'UTF8')),
        'hex'
    )
FROM "PickingItem" item
WHERE item.id = 8
  AND item."tenantId" =
      '00000000-0000-4000-8000-000000000001'::uuid
  AND item."sessionId" = 8
  AND item."variantId" = 1
  AND item.quantity = 13
  AND item."pickedQuantity" = 21
ON CONFLICT (
    "tenantId",
    "storyId",
    "sourceTable",
    "sourceKey"
) DO NOTHING;

UPDATE "PickingOrderItemDetail" detail
SET "pickingItemId" = NULL
WHERE detail."pickingItemId" = 8
  AND detail."tenantId" =
      '00000000-0000-4000-8000-000000000001'::uuid
  AND EXISTS (
      SELECT 1
      FROM "TenantMigrationQuarantine" quarantine
      WHERE quarantine."tenantId" = detail."tenantId"
        AND quarantine."storyId" = 'MIG-011'
        AND quarantine."sourceTable" = 'PickingItem'
        AND quarantine."sourceKey" = '8'
        AND quarantine."reasonCode" =
            'QUARANTINED_LEGACY_PICKING_OVERFLOW'
  );

DELETE FROM "PickingItem" item
WHERE item.id = 8
  AND item."tenantId" =
      '00000000-0000-4000-8000-000000000001'::uuid
  AND item."sessionId" = 8
  AND item."variantId" = 1
  AND item.quantity = 13
  AND item."pickedQuantity" = 21
  AND EXISTS (
      SELECT 1
      FROM "TenantMigrationQuarantine" quarantine
      WHERE quarantine."tenantId" = item."tenantId"
        AND quarantine."storyId" = 'MIG-011'
        AND quarantine."sourceTable" = 'PickingItem'
        AND quarantine."sourceKey" = item.id::text
        AND quarantine."reasonCode" =
            'QUARANTINED_LEGACY_PICKING_OVERFLOW'
  );

ALTER TABLE "PickingItem"
    VALIDATE CONSTRAINT "PickingItem_quantity_bounds_check";

COMMENT ON CONSTRAINT "PickingItem_quantity_bounds_check" ON "PickingItem" IS
    'MIG-011: validada después de archivar PickingItem#8 en TenantMigrationQuarantine.';
COMMENT ON TABLE "TenantMigrationQuarantine" IS
    'Evidencia inmutable de filas excluidas del flujo operativo por decisiones aprobadas de migración.';

-- Alinea únicamente secuencias del alcance no SUNAT. setval(max, true) hace
-- que la próxima creación reciba max + 1; una tabla vacía conserva el inicio 1.
DO $$
DECLARE
    table_name TEXT;
    sequence_name TEXT;
    maximum_id BIGINT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'AuditLog',
        'Category',
        'Color',
        'Inventory',
        'InventoryMovement',
        'MarketplaceCustomer',
        'Order',
        'OrderItem',
        'OrderReturn',
        'OrderReturnItem',
        'PaymentMethod',
        'Permission',
        'PickingItem',
        'PickingItemContribution',
        'PickingOrderItemDetail',
        'PickingResponsibilityRequest',
        'PickingSession',
        'PickingSharedResponsibility',
        'PickingUnpickRequest',
        'Product',
        'ProductImage',
        'ProductVariant',
        'Reservation',
        'Role',
        'RolePermission',
        'Size',
        'StockTransfer',
        'StockTransferItem',
        'Store',
        'SystemSetting',
        'User',
        'UserActivityLog'
    ]
    LOOP
        sequence_name := pg_get_serial_sequence(
            format('%I.%I', current_schema(), table_name),
            'id'
        );
        IF sequence_name IS NULL THEN
            RAISE EXCEPTION
                'MIG-011: falta secuencia serial para %.id',
                table_name;
        END IF;

        EXECUTE format('SELECT MAX(id)::bigint FROM %I', table_name)
        INTO maximum_id;

        IF maximum_id IS NULL THEN
            PERFORM setval(sequence_name::regclass, 1, false);
        ELSE
            PERFORM setval(sequence_name::regclass, maximum_id, true);
        END IF;
    END LOOP;
END
$$;

INSERT INTO "TenantMigrationCheckpoint" (
    "tenantId",
    "domain",
    "storyId",
    "status",
    "details",
    "updatedAt"
)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'BACKFILL',
    'MIG-011',
    'PENDING',
    jsonb_build_object(
        'version', 1,
        'migration', '20260729220000_close_non_sunat_backfill',
        'deploymentSequence',
        ARRAY[
            'EXPAND',
            'BACKFILL',
            'VALIDATE',
            'RESTRICT',
            'RETIRE_COMPATIBILITY'
        ]
    ),
    CURRENT_TIMESTAMP
)
ON CONFLICT ("tenantId", "storyId") DO NOTHING;
