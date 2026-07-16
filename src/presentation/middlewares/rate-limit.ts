import rateLimit from 'express-rate-limit';

// NOTA (serverless): con el MemoryStore por defecto el conteo es por instancia y
// no se comparte entre invocaciones/instancias (ej. Netlify Functions). Protege
// de forma efectiva en modo servidor de larga vida y es defensa en profundidad
// en serverless. Para un límite robusto en producción serverless, usar un store
// compartido (Redis) con `store:`.

const jsonMessage = (message: string) => ({ message });

// Login / registro: frena fuerza bruta y enumeración de cuentas.
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: jsonMessage('Demasiados intentos. Espera unos minutos e intenta de nuevo.'),
});

// Escritura pública (crear pedidos): frena spam/DoS de proformas.
export const publicWriteRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: jsonMessage('Demasiadas solicitudes. Espera un momento e intenta de nuevo.'),
});

// Lectura pública de pedidos (por código/teléfono): frena enumeración/scraping
// de PII sin bloquear el uso legítimo. Mitigación de la fuga tipo IDOR.
export const publicReadRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: jsonMessage('Demasiadas consultas. Espera un momento e intenta de nuevo.'),
});
