-- TEN-005 / TEN-006 / TEN-012
-- Aisla catalogo, inventario, ventas y datos auxiliares por tenant.

DO $$
DECLARE
    table_name TEXT;
    tenant_tables TEXT[] := ARRAY[
        'Category',
        'Color',
        'Size',
        'Product',
        'ProductImage',
        'ProductVariant',
        'Store',
        'Inventory',
        'InventoryMovement',
        'StockTransfer',
        'StockTransferItem',
        'Reservation',
        'PickingSession',
        'PickingItem',
        'Order',
        'OrderItem',
        'OrderReturn',
        'OrderReturnItem',
        'PaymentMethod',
        'SystemSetting',
        'MarketplaceCustomer',
        'UserActivityLog',
        'PickingSharedResponsibility',
        'PickingResponsibilityRequest',
        'PickingItemContribution',
        'PickingUnpickRequest',
        'PickingOrderItemDetail'
    ];
BEGIN
    FOREACH table_name IN ARRAY tenant_tables LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD COLUMN "tenantId" UUID NOT NULL DEFAULT %L::uuid',
            table_name,
            '00000000-0000-4000-8000-000000000001'
        );
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
            table_name,
            table_name || '_tenantId_fkey'
        );
        EXECUTE format(
            'CREATE INDEX %I ON %I ("tenantId")',
            table_name || '_tenantId_idx',
            table_name
        );
    END LOOP;
END $$;

-- La auditoria admite eventos de plataforma o en cuarentena sin tenant. Los
-- eventos empresariales siempre deben tener tenant verificable.
ALTER TABLE "AuditLog"
    ADD COLUMN "dataScope" TEXT NOT NULL DEFAULT 'QUARANTINE';

UPDATE "AuditLog"
SET "dataScope" = CASE
    WHEN "tenantId" IS NULL THEN 'QUARANTINE'
    ELSE 'TENANT'
END;

ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_data_scope_check"
    CHECK (
        ("dataScope" = 'TENANT' AND "tenantId" IS NOT NULL)
        OR ("dataScope" IN ('PLATFORM', 'QUARANTINE') AND "tenantId" IS NULL)
    );

CREATE INDEX "AuditLog_tenantId_dataScope_createdAt_idx"
    ON "AuditLog"("tenantId", "dataScope", "createdAt" DESC);

-- Reemplaza unicidades globales por unicidades dentro de cada empresa.
DROP INDEX "Category_name_key";
DROP INDEX "Color_name_key";
DROP INDEX "Size_name_key";
DROP INDEX "ProductVariant_sku_key";
DROP INDEX "ProductVariant_productId_variantKey_key";
DROP INDEX "Store_code_key";
DROP INDEX "StockTransfer_code_key";
DROP INDEX "Order_code_key";
DROP INDEX "Order_idempotencyKey_key";
DROP INDEX "PaymentMethod_name_key";
DROP INDEX "PaymentMethod_code_key";
DROP INDEX "SystemSetting_key_key";
DROP INDEX "MarketplaceCustomer_email_key";

CREATE UNIQUE INDEX "Category_tenantId_name_key"
    ON "Category"("tenantId", "name");
CREATE UNIQUE INDEX "Color_tenantId_name_key"
    ON "Color"("tenantId", "name");
CREATE UNIQUE INDEX "Size_tenantId_name_key"
    ON "Size"("tenantId", "name");
CREATE UNIQUE INDEX "ProductVariant_tenantId_sku_key"
    ON "ProductVariant"("tenantId", "sku");
CREATE UNIQUE INDEX "ProductVariant_tenantId_productId_variantKey_key"
    ON "ProductVariant"("tenantId", "productId", "variantKey");
CREATE UNIQUE INDEX "Store_tenantId_code_key"
    ON "Store"("tenantId", "code");
CREATE UNIQUE INDEX "Inventory_tenantId_storeId_variantId_key"
    ON "Inventory"("tenantId", "storeId", "variantId");
CREATE UNIQUE INDEX "StockTransfer_tenantId_code_key"
    ON "StockTransfer"("tenantId", "code");
CREATE UNIQUE INDEX "StockTransfer_orderId_tenantId_key"
    ON "StockTransfer"("orderId", "tenantId");
CREATE UNIQUE INDEX "PickingSession_orderId_tenantId_key"
    ON "PickingSession"("orderId", "tenantId");
CREATE UNIQUE INDEX "Order_tenantId_code_key"
    ON "Order"("tenantId", "code");
CREATE UNIQUE INDEX "Order_tenantId_idempotencyKey_key"
    ON "Order"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "PaymentMethod_tenantId_name_key"
    ON "PaymentMethod"("tenantId", "name");
CREATE UNIQUE INDEX "PaymentMethod_tenantId_code_key"
    ON "PaymentMethod"("tenantId", "code");
CREATE UNIQUE INDEX "SystemSetting_tenantId_key_key"
    ON "SystemSetting"("tenantId", "key");
CREATE UNIQUE INDEX "MarketplaceCustomer_tenantId_email_key"
    ON "MarketplaceCustomer"("tenantId", lower("email"));

-- Las claves (id, tenantId) son destinos de FKs compuestas defensivas.
DO $$
DECLARE
    table_name TEXT;
    relation_tables TEXT[] := ARRAY[
        'Category',
        'Color',
        'Size',
        'Product',
        'ProductImage',
        'ProductVariant',
        'Store',
        'Inventory',
        'InventoryMovement',
        'StockTransfer',
        'StockTransferItem',
        'Reservation',
        'PickingSession',
        'PickingItem',
        'Order',
        'OrderItem',
        'OrderReturn',
        'OrderReturnItem',
        'PaymentMethod'
    ];
BEGIN
    FOREACH table_name IN ARRAY relation_tables LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE ("id", "tenantId")',
            table_name,
            table_name || '_id_tenantId_key'
        );
    END LOOP;
END $$;

-- Una funcion comun deriva el tenant desde todas las entidades padre y rechaza
-- relaciones cruzadas antes de evaluar las claves foraneas.
CREATE OR REPLACE FUNCTION "derive_tenant_from_parents"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_spec TEXT;
    parent_table TEXT;
    foreign_key TEXT;
    foreign_id BIGINT;
    resolved_tenant UUID;
    parent_tenant UUID;
BEGIN
    FOREACH parent_spec IN ARRAY TG_ARGV LOOP
        parent_table := split_part(parent_spec, ':', 1);
        foreign_key := split_part(parent_spec, ':', 2);
        foreign_id := NULLIF(to_jsonb(NEW) ->> foreign_key, '')::BIGINT;

        IF foreign_id IS NULL THEN
            CONTINUE;
        END IF;

        EXECUTE format(
            'SELECT "tenantId" FROM %I WHERE "id" = $1',
            parent_table
        )
        INTO parent_tenant
        USING foreign_id;

        IF parent_tenant IS NULL THEN
            RAISE EXCEPTION 'No existe %.id=%', parent_table, foreign_id
                USING ERRCODE = '23503';
        END IF;

        IF resolved_tenant IS NULL THEN
            resolved_tenant := parent_tenant;
        ELSIF resolved_tenant <> parent_tenant THEN
            RAISE EXCEPTION 'Relacion cruzada entre tenants en %', TG_TABLE_NAME
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    IF resolved_tenant IS NOT NULL
       AND NEW."tenantId" IS DISTINCT FROM resolved_tenant THEN
        RAISE EXCEPTION 'Relacion cruzada de tenant en %: fila=%, padre=%',
            TG_TABLE_NAME,
            NEW."tenantId",
            resolved_tenant
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "prevent_tenant_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
        RAISE EXCEPTION 'tenantId es inmutable en %', TG_TABLE_NAME
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "a_Product_derive_tenant"
    BEFORE INSERT OR UPDATE ON "Product"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Category:categoryId');
CREATE TRIGGER "a_ProductImage_derive_tenant"
    BEFORE INSERT OR UPDATE ON "ProductImage"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Product:productId');
CREATE TRIGGER "a_ProductVariant_derive_tenant"
    BEFORE INSERT OR UPDATE ON "ProductVariant"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Product:productId',
        'Color:colorId',
        'Size:sizeId'
    );
CREATE TRIGGER "a_Inventory_derive_tenant"
    BEFORE INSERT OR UPDATE ON "Inventory"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Store:storeId',
        'ProductVariant:variantId'
    );
CREATE TRIGGER "a_InventoryMovement_derive_tenant"
    BEFORE INSERT OR UPDATE ON "InventoryMovement"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Inventory:inventoryId',
        'StockTransfer:transferId',
        'Reservation:reservationId'
    );
CREATE TRIGGER "a_StockTransfer_derive_tenant"
    BEFORE INSERT OR UPDATE ON "StockTransfer"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Store:fromStoreId',
        'Store:toStoreId',
        'Order:orderId'
    );
CREATE TRIGGER "a_StockTransferItem_derive_tenant"
    BEFORE INSERT OR UPDATE ON "StockTransferItem"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'StockTransfer:transferId',
        'ProductVariant:variantId'
    );
CREATE TRIGGER "a_Reservation_derive_tenant"
    BEFORE INSERT OR UPDATE ON "Reservation"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Inventory:inventoryId',
        'ProductVariant:variantId',
        'Order:orderId',
        'OrderItem:orderItemId'
    );
CREATE TRIGGER "a_PickingSession_derive_tenant"
    BEFORE INSERT OR UPDATE ON "PickingSession"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Order:orderId');
CREATE TRIGGER "a_PickingItem_derive_tenant"
    BEFORE INSERT OR UPDATE ON "PickingItem"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'PickingSession:sessionId',
        'ProductVariant:variantId'
    );
CREATE TRIGGER "a_Order_derive_tenant"
    BEFORE INSERT OR UPDATE ON "Order"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Store:sourceStoreId',
        'Store:fulfillmentStoreId'
    );
CREATE TRIGGER "a_OrderItem_derive_tenant"
    BEFORE INSERT OR UPDATE ON "OrderItem"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Order:orderId',
        'ProductVariant:variantId',
        'Store:fulfillmentStoreId'
    );
CREATE TRIGGER "a_OrderReturn_derive_tenant"
    BEFORE INSERT OR UPDATE ON "OrderReturn"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Order:orderId',
        'Store:storeId'
    );
CREATE TRIGGER "a_OrderReturnItem_derive_tenant"
    BEFORE INSERT OR UPDATE ON "OrderReturnItem"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'OrderReturn:returnId',
        'OrderItem:orderItemId',
        'ProductVariant:variantId'
    );
CREATE TRIGGER "a_PickingSharedResponsibility_derive_tenant"
    BEFORE INSERT OR UPDATE ON "PickingSharedResponsibility"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Order:orderId');
CREATE TRIGGER "a_PickingResponsibilityRequest_derive_tenant"
    BEFORE INSERT OR UPDATE ON "PickingResponsibilityRequest"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Order:orderId');
CREATE TRIGGER "a_PickingItemContribution_derive_tenant"
    BEFORE INSERT OR UPDATE ON "PickingItemContribution"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Order:orderId',
        'PickingItem:pickingItemId'
    );
CREATE TRIGGER "a_PickingUnpickRequest_derive_tenant"
    BEFORE INSERT OR UPDATE ON "PickingUnpickRequest"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Order:orderId',
        'PickingItem:pickingItemId'
    );
CREATE TRIGGER "a_PickingOrderItemDetail_derive_tenant"
    BEFORE INSERT OR UPDATE ON "PickingOrderItemDetail"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Order:orderId',
        'OrderItem:orderItemId',
        'PickingItem:pickingItemId',
        'ProductVariant:variantId'
    );

DO $$
DECLARE
    table_name TEXT;
    immutable_tables TEXT[] := ARRAY[
        'Category',
        'Color',
        'Size',
        'Product',
        'ProductImage',
        'ProductVariant',
        'Store',
        'Inventory',
        'InventoryMovement',
        'StockTransfer',
        'StockTransferItem',
        'Reservation',
        'PickingSession',
        'PickingItem',
        'Order',
        'OrderItem',
        'OrderReturn',
        'OrderReturnItem',
        'PaymentMethod',
        'SystemSetting',
        'MarketplaceCustomer',
        'UserActivityLog',
        'PickingSharedResponsibility',
        'PickingResponsibilityRequest',
        'PickingItemContribution',
        'PickingUnpickRequest',
        'PickingOrderItemDetail'
    ];
BEGIN
    FOREACH table_name IN ARRAY immutable_tables LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_change"()',
            'z_' || table_name || '_tenant_immutable',
            table_name
        );
    END LOOP;
END $$;

-- FKs compuestas: toda relacion operativa debe permanecer dentro del tenant.
ALTER TABLE "Product"
    ADD CONSTRAINT "Product_category_tenant_fkey"
    FOREIGN KEY ("categoryId", "tenantId")
    REFERENCES "Category"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImage"
    ADD CONSTRAINT "ProductImage_product_tenant_fkey"
    FOREIGN KEY ("productId", "tenantId")
    REFERENCES "Product"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant"
    ADD CONSTRAINT "ProductVariant_product_tenant_fkey"
    FOREIGN KEY ("productId", "tenantId")
    REFERENCES "Product"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ProductVariant_color_tenant_fkey"
    FOREIGN KEY ("colorId", "tenantId")
    REFERENCES "Color"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ProductVariant_size_tenant_fkey"
    FOREIGN KEY ("sizeId", "tenantId")
    REFERENCES "Size"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Inventory"
    ADD CONSTRAINT "Inventory_store_tenant_fkey"
    FOREIGN KEY ("storeId", "tenantId")
    REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Inventory_variant_tenant_fkey"
    FOREIGN KEY ("variantId", "tenantId")
    REFERENCES "ProductVariant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_inventory_tenant_fkey"
    FOREIGN KEY ("inventoryId", "tenantId")
    REFERENCES "Inventory"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "InventoryMovement_transfer_tenant_fkey"
    FOREIGN KEY ("transferId", "tenantId")
    REFERENCES "StockTransfer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "InventoryMovement_reservation_tenant_fkey"
    FOREIGN KEY ("reservationId", "tenantId")
    REFERENCES "Reservation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "InventoryMovement_user_tenant_fkey"
    FOREIGN KEY ("responsibleUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransfer"
    ADD CONSTRAINT "StockTransfer_from_store_tenant_fkey"
    FOREIGN KEY ("fromStoreId", "tenantId")
    REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "StockTransfer_to_store_tenant_fkey"
    FOREIGN KEY ("toStoreId", "tenantId")
    REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "StockTransfer_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE,
    ADD CONSTRAINT "StockTransfer_created_user_tenant_fkey"
    FOREIGN KEY ("createdById", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "StockTransfer_received_user_tenant_fkey"
    FOREIGN KEY ("receivedById", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockTransferItem"
    ADD CONSTRAINT "StockTransferItem_transfer_tenant_fkey"
    FOREIGN KEY ("transferId", "tenantId")
    REFERENCES "StockTransfer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "StockTransferItem_variant_tenant_fkey"
    FOREIGN KEY ("variantId", "tenantId")
    REFERENCES "ProductVariant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation"
    ADD CONSTRAINT "Reservation_inventory_tenant_fkey"
    FOREIGN KEY ("inventoryId", "tenantId")
    REFERENCES "Inventory"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Reservation_variant_tenant_fkey"
    FOREIGN KEY ("variantId", "tenantId")
    REFERENCES "ProductVariant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Reservation_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "Reservation_order_item_tenant_fkey"
    FOREIGN KEY ("orderItemId", "tenantId")
    REFERENCES "OrderItem"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Reservation_user_tenant_fkey"
    FOREIGN KEY ("reservedById", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickingSession"
    ADD CONSTRAINT "PickingSession_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingSession_user_tenant_fkey"
    FOREIGN KEY ("assignedUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickingItem"
    ADD CONSTRAINT "PickingItem_session_tenant_fkey"
    FOREIGN KEY ("sessionId", "tenantId")
    REFERENCES "PickingSession"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingItem_variant_tenant_fkey"
    FOREIGN KEY ("variantId", "tenantId")
    REFERENCES "ProductVariant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order"
    ADD CONSTRAINT "Order_source_store_tenant_fkey"
    FOREIGN KEY ("sourceStoreId", "tenantId")
    REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Order_fulfillment_store_tenant_fkey"
    FOREIGN KEY ("fulfillmentStoreId", "tenantId")
    REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Order_seller_tenant_fkey"
    FOREIGN KEY ("sellerUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Order_picker_tenant_fkey"
    FOREIGN KEY ("pickerUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Order_dispenser_tenant_fkey"
    FOREIGN KEY ("dispenserUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Order_cancelled_by_tenant_fkey"
    FOREIGN KEY ("cancelledByUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Order_return_responsible_tenant_fkey"
    FOREIGN KEY ("returnResponsibleUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Order_return_delegated_by_tenant_fkey"
    FOREIGN KEY ("returnResponsibilityDelegatedById", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "OrderItem_variant_tenant_fkey"
    FOREIGN KEY ("variantId", "tenantId")
    REFERENCES "ProductVariant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "OrderItem_store_tenant_fkey"
    FOREIGN KEY ("fulfillmentStoreId", "tenantId")
    REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReturn"
    ADD CONSTRAINT "OrderReturn_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "OrderReturn_store_tenant_fkey"
    FOREIGN KEY ("storeId", "tenantId")
    REFERENCES "Store"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "OrderReturn_user_tenant_fkey"
    FOREIGN KEY ("responsibleUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReturnItem"
    ADD CONSTRAINT "OrderReturnItem_return_tenant_fkey"
    FOREIGN KEY ("returnId", "tenantId")
    REFERENCES "OrderReturn"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "OrderReturnItem_order_item_tenant_fkey"
    FOREIGN KEY ("orderItemId", "tenantId")
    REFERENCES "OrderItem"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "OrderReturnItem_variant_tenant_fkey"
    FOREIGN KEY ("variantId", "tenantId")
    REFERENCES "ProductVariant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tablas auxiliares y trazabilidad.
ALTER TABLE "UserActivityLog"
    ADD CONSTRAINT "UserActivityLog_user_tenant_fkey"
    FOREIGN KEY ("userId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickingSharedResponsibility"
    ADD CONSTRAINT "PickingSharedResponsibility_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingSharedResponsibility_user_tenant_fkey"
    FOREIGN KEY ("userId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingSharedResponsibility_assigner_tenant_fkey"
    FOREIGN KEY ("assignedByUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickingResponsibilityRequest"
    ADD CONSTRAINT "PickingResponsibilityRequest_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingResponsibilityRequest_requester_tenant_fkey"
    FOREIGN KEY ("requesterUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingResponsibilityRequest_resolver_tenant_fkey"
    FOREIGN KEY ("resolvedByUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickingItemContribution"
    ADD CONSTRAINT "PickingItemContribution_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingItemContribution_item_tenant_fkey"
    FOREIGN KEY ("pickingItemId", "tenantId")
    REFERENCES "PickingItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingItemContribution_user_tenant_fkey"
    FOREIGN KEY ("userId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickingUnpickRequest"
    ADD CONSTRAINT "PickingUnpickRequest_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingUnpickRequest_item_tenant_fkey"
    FOREIGN KEY ("pickingItemId", "tenantId")
    REFERENCES "PickingItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingUnpickRequest_requester_tenant_fkey"
    FOREIGN KEY ("requesterUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingUnpickRequest_resolver_tenant_fkey"
    FOREIGN KEY ("resolvedByUserId", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickingOrderItemDetail"
    ADD CONSTRAINT "PickingOrderItemDetail_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingOrderItemDetail_order_item_tenant_fkey"
    FOREIGN KEY ("orderItemId", "tenantId")
    REFERENCES "OrderItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingOrderItemDetail_picking_item_tenant_fkey"
    FOREIGN KEY ("pickingItemId", "tenantId")
    REFERENCES "PickingItem"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "PickingOrderItemDetail_variant_tenant_fkey"
    FOREIGN KEY ("variantId", "tenantId")
    REFERENCES "ProductVariant"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los indices auxiliares que antes eran globales tambien quedan acotados.
DROP INDEX "PickingSharedResponsibility_order_user_key";
DROP INDEX "PickingResponsibilityRequest_pending_unique_idx";
DROP INDEX "PickingItemContribution_item_user_key";
DROP INDEX "PickingUnpickRequest_pending_unique_idx";
DROP INDEX "PickingOrderItemDetail_orderItem_unique_idx";

CREATE UNIQUE INDEX "PickingSharedResponsibility_tenant_order_user_key"
    ON "PickingSharedResponsibility"("tenantId", "orderId", "userId");
CREATE UNIQUE INDEX "PickingResponsibilityRequest_tenant_pending_unique_idx"
    ON "PickingResponsibilityRequest"(
        "tenantId",
        "orderId",
        "requesterUserId",
        "mode",
        "status"
    );
CREATE UNIQUE INDEX "PickingItemContribution_tenant_item_user_key"
    ON "PickingItemContribution"("tenantId", "pickingItemId", "userId");
CREATE UNIQUE INDEX "PickingUnpickRequest_tenant_pending_unique_idx"
    ON "PickingUnpickRequest"("tenantId", "pickingItemId", "requesterUserId")
    WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "PickingOrderItemDetail_tenant_orderItem_unique_idx"
    ON "PickingOrderItemDetail"("tenantId", "orderItemId");

-- Clasificacion de datos globales: identidad/roles/permisos son de plataforma.
COMMENT ON TABLE "Role" IS
    'Catalogo global de compatibilidad RBAC; los permisos efectivos se derivan de TenantMembership.';
COMMENT ON TABLE "Permission" IS
    'Catalogo global e inmutable de codigos de permiso de la plataforma.';
COMMENT ON TABLE "RolePermission" IS
    'Mapeo global de permisos por rol de compatibilidad.';
COMMENT ON COLUMN "AuditLog"."dataScope" IS
    'TENANT: visible dentro de empresa; PLATFORM: administracion separada; QUARANTINE: tenant no verificable.';

UPDATE "TenantMigrationCheckpoint"
SET
    "status" = 'COMPLETED',
    "completedAt" = CURRENT_TIMESTAMP,
    "details" = jsonb_build_object(
        'migration', '20260729150000_tenant_scope_commerce',
        'backfillTenantId', '00000000-0000-4000-8000-000000000001'
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "storyId" IN (
    'MIG-004',
    'MIG-005',
    'MIG-006',
    'MIG-007',
    'MIG-008',
    'MIG-009',
    'MIG-010'
)
  AND "tenantId" = '00000000-0000-4000-8000-000000000001'::uuid;
