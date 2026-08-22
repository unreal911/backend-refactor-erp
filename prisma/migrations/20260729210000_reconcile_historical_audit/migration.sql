-- MIG-010: atribuye únicamente auditorías con actor unívoco y minimiza los
-- payloads históricos anteriores al inventario MIG-001.
CREATE FUNCTION "sanitize_historical_audit_json"(value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    result JSONB;
BEGIN
    IF value IS NULL THEN
        RETURN NULL;
    END IF;
    IF jsonb_typeof(value) = 'object' THEN
        SELECT COALESCE(
            jsonb_object_agg(
                key,
                CASE
                    WHEN lower(key) ~
                        '(password|token|secret|authorization|cookie|apikey|api_key|access|refresh|card|cvv|p12|pfx|cert|email|phone|telefono|address|direccion|document|dni|ruc)'
                    THEN '"[redacted]"'::jsonb
                    ELSE "sanitize_historical_audit_json"(child)
                END
            ),
            '{}'::jsonb
        )
        INTO result
        FROM jsonb_each(value) entry(key, child);
        RETURN result;
    END IF;
    IF jsonb_typeof(value) = 'array' THEN
        SELECT COALESCE(
            jsonb_agg("sanitize_historical_audit_json"(child)),
            '[]'::jsonb
        )
        INTO result
        FROM jsonb_array_elements(value) entry(child);
        RETURN result;
    END IF;
    RETURN value;
END;
$$;

UPDATE "AuditLog"
SET
    "requestQuery" =
        "sanitize_historical_audit_json"("requestQuery"),
    "requestParams" =
        "sanitize_historical_audit_json"("requestParams"),
    "requestBody" =
        "sanitize_historical_audit_json"("requestBody")
WHERE "createdAt" <= TIMESTAMPTZ '2026-07-29T16:27:05.069Z';

UPDATE "UserActivityLog"
SET
    "products" = "sanitize_historical_audit_json"("products"),
    "context" = "sanitize_historical_audit_json"("context")
WHERE "createdAt" <= TIMESTAMPTZ '2026-07-29T16:27:05.069Z';

WITH unambiguous_actor AS (
    SELECT
        membership."userId",
        MIN(membership."tenantId"::text)::uuid AS "tenantId"
    FROM "TenantMembership" membership
    GROUP BY membership."userId"
    HAVING COUNT(DISTINCT membership."tenantId") = 1
)
UPDATE "AuditLog" audit
SET
    "tenantId" = actor."tenantId",
    "dataScope" = 'TENANT'
FROM unambiguous_actor actor
WHERE audit."actorUserId" = actor."userId"
  AND audit."tenantId" IS NULL
  AND audit."dataScope" = 'QUARANTINE'
  AND audit."createdAt" <= TIMESTAMPTZ '2026-07-29T16:27:05.069Z';

DROP FUNCTION "sanitize_historical_audit_json"(JSONB);

COMMENT ON COLUMN "AuditLog"."dataScope" IS
    'MIG-010: TENANT solo con atribución verificable; filas ambiguas permanecen QUARANTINE.';
