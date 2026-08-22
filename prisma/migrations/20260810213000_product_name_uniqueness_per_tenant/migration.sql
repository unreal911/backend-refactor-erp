-- REL-001: un nombre lógico de producto sólo puede existir una vez por empresa.
-- La comparación ignora mayúsculas, espacios repetidos y tildes comunes.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Product"
        GROUP BY
            "tenantId",
            regexp_replace(
                btrim(translate(
                    lower("name"),
                    'áàâäãåéèêëíìîïóòôöõúùûüñç',
                    'aaaaaaeeeeiiiiooooouuuunc'
                )),
                '[[:space:]]+',
                ' ',
                'g'
            )
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'REL-001: existen nombres de producto duplicados dentro de una empresa; deben reconciliarse antes de aplicar la restricción';
    END IF;
END $$;

CREATE UNIQUE INDEX "Product_tenantId_name_normalized_key"
ON "Product" (
    "tenantId",
    regexp_replace(
        btrim(translate(
            lower("name"),
            'áàâäãåéèêëíìîïóòôöõúùûüñç',
            'aaaaaaeeeeiiiiooooouuuunc'
        )),
        '[[:space:]]+',
        ' ',
        'g'
    )
);
