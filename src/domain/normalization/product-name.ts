const PRODUCT_NAME_DIACRITICS: Record<string, string> = {
    á: 'a', à: 'a', â: 'a', ä: 'a', ã: 'a', å: 'a',
    é: 'e', è: 'e', ê: 'e', ë: 'e',
    í: 'i', ì: 'i', î: 'i', ï: 'i',
    ó: 'o', ò: 'o', ô: 'o', ö: 'o', õ: 'o',
    ú: 'u', ù: 'u', û: 'u', ü: 'u',
    ñ: 'n', ç: 'c',
};

/** Conserva el nombre visible, pero elimina espacios accidentales. */
export function normalizeProductDisplayName(value: string): string {
    return String(value || '')
        .normalize('NFC')
        .trim()
        .replace(/\s+/gu, ' ');
}

/**
 * Clave de comparación compartida con la migración PostgreSQL.
 * Intencionalmente trata mayúsculas, espacios y tildes como equivalentes.
 */
export function normalizeProductNameKey(value: string): string {
    return normalizeProductDisplayName(value)
        .toLocaleLowerCase('es-PE')
        .replace(/[áàâäãåéèêëíìîïóòôöõúùûüñç]/gu, (character) => (
            PRODUCT_NAME_DIACRITICS[character] || character
        ));
}
