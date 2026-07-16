/**
 * Regenera los SKU de todas las variantes al formato corto:
 *   {ABBR}-{productId:5}-{colorId:3}-{sizeId:3}   (p.ej. POL-00001-004-005)
 *
 *   npx tsx src/scripts/migrate-skus.ts          (aplica)
 *   npx tsx src/scripts/migrate-skus.ts --dry    (solo muestra, no escribe)
 *
 * Seguro: la unicidad la garantizan los ids (unique [productId,colorId,sizeId]).
 */
import { prisma } from "../data/prisma";

function skuAbbr(productName: string): string {
    const clean = productName
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    return (clean.slice(0, 3) || "PRD").padEnd(3, "X");
}

function newSku(productName: string, productId: number, colorId: number | null, sizeId: number | null): string {
    return `${skuAbbr(productName)}-${String(productId).padStart(5, "0")}-${String(colorId ?? 0).padStart(3, "0")}-${String(sizeId ?? 0).padStart(3, "0")}`;
}

async function main(): Promise<void> {
    const dryRun = process.argv.includes("--dry");

    const variants = await prisma.productVariant.findMany({
        include: { product: { select: { id: true, name: true } } },
        orderBy: { id: "asc" },
    });

    console.log(`${variants.length} variantes. Modo: ${dryRun ? "DRY-RUN" : "APLICAR"}\n`);

    let cambiados = 0;
    let maxLen = 0;
    for (const v of variants) {
        const nuevo = newSku(v.product.name, v.product.id, v.colorId, v.sizeId);
        maxLen = Math.max(maxLen, nuevo.length);
        if (nuevo === v.sku) continue;
        cambiados++;
        if (cambiados <= 10) console.log(`  #${v.id}: ${v.sku}  ->  ${nuevo}`);
        if (!dryRun) {
            await prisma.productVariant.update({ where: { id: v.id }, data: { sku: nuevo } });
        }
    }

    console.log(`\n${cambiados} SKU ${dryRun ? "se cambiarian" : "actualizados"}. Longitud maxima nueva: ${maxLen} chars.`);
}

main()
    .catch((e) => {
        console.error("ERROR:", e?.message ?? e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
