import { prisma } from "../prisma";
import { ProductSeedSummary } from "./types";

// -------------------------------------------------------------------------
// Catalogo demo. Cubre los 3 modos de variante del modelo unificado:
//   MATRIX     -> hasColor + hasSize  (variantes por color x talla)
//   SIZE_ONLY  -> hasSize             (variantes solo por talla)
//   SIMPLE     -> ninguna dimension   (variante unica)
// -------------------------------------------------------------------------

type VariantDef = { color?: string; size?: string; price: number; stock: number };

type ProductDef = {
    name: string;
    description: string;
    category: string;
    hasColor: boolean;
    hasSize: boolean;
    variants: VariantDef[];
};

// Placeholder deterministico (URL plana, sin Cloudinary) para poblar imagenes demo.
function placeholderImage(text: string, bg = "1E293B"): string {
    const label = encodeURIComponent(text.slice(0, 24));
    return `https://placehold.co/600x600/${bg}/FFFFFF/png?text=${label}`;
}

// Color de fondo del placeholder segun el color de la variante.
const COLOR_BG: Record<string, string> = {
    Negro: "111827",
    Blanco: "E5E7EB",
    Azul: "1E3A8A",
    Rojo: "B91C1C",
    Verde: "15803D",
};

const CATEGORIES = ["Polos", "Pantalones", "Casacas", "Accesorios"];

const COLORS: { name: string; hex: string }[] = [
    { name: "Negro", hex: "#000000" },
    { name: "Blanco", hex: "#FFFFFF" },
    { name: "Azul", hex: "#1E3A8A" },
    { name: "Rojo", hex: "#B91C1C" },
    { name: "Verde", hex: "#15803D" },
];

const SIZES = ["S", "M", "L", "XL"];

const PRODUCTS: ProductDef[] = [
    {
        name: "Polo basico algodon",
        description: "Polo cuello redondo 100% algodon.",
        category: "Polos",
        hasColor: true,
        hasSize: true,
        variants: [
            { color: "Negro", size: "S", price: 29.9, stock: 40 },
            { color: "Negro", size: "M", price: 29.9, stock: 60 },
            { color: "Negro", size: "L", price: 29.9, stock: 55 },
            { color: "Blanco", size: "S", price: 29.9, stock: 35 },
            { color: "Blanco", size: "M", price: 29.9, stock: 50 },
            { color: "Blanco", size: "L", price: 29.9, stock: 45 },
            { color: "Azul", size: "M", price: 31.9, stock: 30 },
            { color: "Azul", size: "L", price: 31.9, stock: 25 },
        ],
    },
    {
        name: "Polo pique clasico",
        description: "Polo tipo pique con cuello camisero.",
        category: "Polos",
        hasColor: true,
        hasSize: true,
        variants: [
            { color: "Rojo", size: "M", price: 45.0, stock: 20 },
            { color: "Rojo", size: "L", price: 45.0, stock: 22 },
            { color: "Verde", size: "M", price: 45.0, stock: 18 },
            { color: "Verde", size: "L", price: 45.0, stock: 15 },
        ],
    },
    {
        name: "Pantalon jean recto",
        description: "Jean corte recto denim resistente.",
        category: "Pantalones",
        hasColor: true,
        hasSize: true,
        variants: [
            { color: "Azul", size: "S", price: 89.9, stock: 15 },
            { color: "Azul", size: "M", price: 89.9, stock: 25 },
            { color: "Azul", size: "L", price: 89.9, stock: 20 },
            { color: "Negro", size: "M", price: 89.9, stock: 18 },
            { color: "Negro", size: "L", price: 89.9, stock: 16 },
        ],
    },
    {
        name: "Pantalon jogger",
        description: "Jogger deportivo con puno elastico.",
        category: "Pantalones",
        hasColor: false,
        hasSize: true,
        variants: [
            { size: "S", price: 59.9, stock: 30 },
            { size: "M", price: 59.9, stock: 40 },
            { size: "L", price: 59.9, stock: 35 },
            { size: "XL", price: 62.9, stock: 20 },
        ],
    },
    {
        name: "Casaca cortavientos",
        description: "Casaca ligera impermeable con capucha.",
        category: "Casacas",
        hasColor: true,
        hasSize: true,
        variants: [
            { color: "Negro", size: "M", price: 129.9, stock: 12 },
            { color: "Negro", size: "L", price: 129.9, stock: 10 },
            { color: "Azul", size: "M", price: 129.9, stock: 8 },
            { color: "Azul", size: "L", price: 129.9, stock: 9 },
        ],
    },
    {
        name: "Gorra ajustable",
        description: "Gorra unitalla con cierre trasero regulable.",
        category: "Accesorios",
        hasColor: true,
        hasSize: false,
        variants: [
            { color: "Negro", price: 24.9, stock: 50 },
            { color: "Blanco", price: 24.9, stock: 45 },
            { color: "Rojo", price: 24.9, stock: 30 },
        ],
    },
    {
        name: "Correa de cuero",
        description: "Correa de cuero sintetico, unica presentacion.",
        category: "Accesorios",
        hasColor: false,
        hasSize: false,
        variants: [{ price: 34.9, stock: 60 }],
    },
];

// SKU: replica product.service (skuAbbr + generateSKU) para consistencia.
function skuAbbr(name: string): string {
    const clean = name
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    return (clean.slice(0, 3) || "PRD").padEnd(3, "X");
}

function buildSku(name: string, productId: number, colorId: number | null, sizeId: number | null): string {
    const color = (colorId ?? 0).toString().padStart(3, "0");
    const size = (sizeId ?? 0).toString().padStart(3, "0");
    return `${skuAbbr(name)}-${productId.toString().padStart(5, "0")}-${color}-${size}`;
}

const variantKeyOf = (colorId: number | null, sizeId: number | null) => `${colorId ?? 0}-${sizeId ?? 0}`;

async function ensureStore(): Promise<{ id: number } | null> {
    const existing = await prisma.store.findFirst({ where: { isActive: true } });
    if (existing) return existing;
    return prisma.store.create({
        data: { name: "Almacen Principal", code: "ALM-01", type: "WAREHOUSE", isActive: true },
    });
}

export async function seedProducts(): Promise<ProductSeedSummary> {
    const summary: ProductSeedSummary = { created: [], skipped: [], warnings: [] };

    const store = await ensureStore();
    if (!store) {
        summary.warnings.push("No se pudo asegurar una tienda; inventario omitido.");
    }

    // Catalogos base (idempotente por nombre unico).
    const categoryByName = new Map<string, number>();
    for (const name of CATEGORIES) {
        const cat = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
        categoryByName.set(name, cat.id);
    }

    const colorByName = new Map<string, number>();
    for (const { name, hex } of COLORS) {
        const color = await prisma.color.upsert({ where: { name }, update: { hex }, create: { name, hex } });
        colorByName.set(name, color.id);
    }

    const sizeByName = new Map<string, number>();
    for (const name of SIZES) {
        const size = await prisma.size.upsert({ where: { name }, update: {}, create: { name } });
        sizeByName.set(name, size.id);
    }

    for (const def of PRODUCTS) {
        const categoryId = categoryByName.get(def.category);
        if (!categoryId) {
            summary.warnings.push(`Categoria ${def.category} inexistente; producto ${def.name} omitido.`);
            continue;
        }

        // Idempotencia: si ya existe un producto con el mismo nombre y categoria, se omite.
        const existing = await prisma.product.findFirst({ where: { name: def.name, categoryId } });
        if (existing) {
            summary.skipped.push(def.name);
            continue;
        }

        const product = await prisma.product.create({
            data: {
                name: def.name,
                description: def.description,
                categoryId,
                hasColor: def.hasColor,
                hasSize: def.hasSize,
                isActive: true,
                images: { create: [{ url: placeholderImage(def.name) }] },
            },
        });

        for (const v of def.variants) {
            const colorId = v.color ? colorByName.get(v.color) ?? null : null;
            const sizeId = v.size ? sizeByName.get(v.size) ?? null : null;

            const variant = await prisma.productVariant.create({
                data: {
                    productId: product.id,
                    colorId,
                    sizeId,
                    sku: buildSku(def.name, product.id, colorId, sizeId),
                    variantKey: variantKeyOf(colorId, sizeId),
                    price: v.price,
                    imageUrl: placeholderImage(v.color ?? def.name, v.color ? COLOR_BG[v.color] : undefined),
                    isActive: true,
                },
            });

            if (store) {
                await prisma.inventory.create({
                    data: { storeId: store.id, variantId: variant.id, stock: v.stock, reservedStock: 0 },
                });
            }
        }

        summary.created.push(def.name);
    }

    return summary;
}
