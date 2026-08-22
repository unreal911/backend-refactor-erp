import sanitizeHtml from 'sanitize-html';

const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i;
const FONT_FAMILY_VALUE = /^[a-z0-9 ,.'"-]{1,100}$/i;
const FONT_SIZE_VALUE = /^(?:[1-9]\d?(?:\.\d+)?(?:px|rem|em|%)|(?:small|medium|large|x-large))$/i;

/** Conserva solamente el subconjunto de HTML que genera el editor de productos. */
export function sanitizeProductDescriptionHtml(value: string | null | undefined): string {
    if (!value) return '';

    return sanitizeHtml(String(value), {
        allowedTags: [
            'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span',
            'h2', 'h3', 'blockquote', 'ul', 'ol', 'li',
            'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
            'a', 'code', 'pre', 'hr',
        ],
        allowedAttributes: {
            a: ['href', 'title'],
            p: ['style'], h2: ['style'], h3: ['style'], span: ['style'], table: ['style'],
            th: ['colspan', 'rowspan', 'style'], td: ['colspan', 'rowspan', 'style'],
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        allowProtocolRelative: false,
        allowedStyles: {
            '*': {
                color: [COLOR_VALUE],
                'font-family': [FONT_FAMILY_VALUE],
                'font-size': [FONT_SIZE_VALUE],
                'text-align': [/^(?:left|center|right|justify)$/i],
            },
        },
        disallowedTagsMode: 'discard',
        enforceHtmlBoundary: true,
    }).trim();
}
