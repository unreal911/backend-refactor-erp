import "dotenv/config";
import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { redactOperationalText, sanitizeOperationalValue } from "./operational-logger";

export type SentryProcessName = "api" | "worker" | "scheduler";

type CaptureOptions = {
    operation: string;
    level?: "warning" | "error" | "fatal";
    tenantId?: string | null;
    correlationId?: string | null;
    tags?: Record<string, string | number | boolean | null | undefined>;
    context?: Record<string, unknown>;
};

let initialized = false;

function tracesSampleRate(): number {
    const value = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0");
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function sanitizeSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
    if (event.message) event.message = redactOperationalText(event.message);
    for (const exception of event.exception?.values ?? []) {
        if (exception.value !== undefined) exception.value = redactOperationalText(exception.value);
    }

    if (event.request) {
        if (event.request.url) event.request.url = redactOperationalText(event.request.url.split("?", 1)[0] ?? "");
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.query_string;
        if (event.request.headers) {
            event.request.headers = sanitizeOperationalValue(event.request.headers) as Record<string, string>;
        }
    }

    if (event.user) {
        event.user = event.user.id === undefined ? {} : { id: event.user.id };
    }
    if (event.extra) {
        event.extra = sanitizeOperationalValue(event.extra) as NonNullable<Sentry.ErrorEvent["extra"]>;
    }
    if (event.contexts) {
        event.contexts = sanitizeOperationalValue(event.contexts) as NonNullable<Sentry.ErrorEvent["contexts"]>;
    }
    return event;
}

export function initializeSentry(processName: SentryProcessName): boolean {
    if (initialized) return true;
    const dsn = String(process.env.SENTRY_DSN ?? "").trim();
    if (!dsn) return false;

    const release = String(process.env.SENTRY_RELEASE ?? "").trim();
    Sentry.init({
        dsn,
        environment: String(process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development"),
        tracesSampleRate: tracesSampleRate(),
        sendDefaultPii: false,
        beforeSend: sanitizeSentryEvent,
        // Los controladores existentes ya escriben en console.error cuando
        // convierten una excepción en HTTP 500. En la API los elevamos a Sentry.
        integrations: processName === "api"
            ? [Sentry.captureConsoleIntegration({ levels: ["error"] })]
            : [],
        initialScope: {
            tags: {
                service: "backend-refactorizado",
                process: processName,
            },
        },
        ...(release ? { release } : {}),
    });
    initialized = true;
    return true;
}

export function setupExpressSentryErrorHandler(app: Express): void {
    if (initialized) Sentry.setupExpressErrorHandler(app);
}

export function captureOperationalException(caught: unknown, options: CaptureOptions): string | null {
    if (!initialized) return null;
    const error = caught instanceof Error ? caught : new Error(String(caught || "Error desconocido"));
    let eventId: string | null = null;
    Sentry.withScope((scope) => {
        scope.setLevel(options.level ?? "error");
        scope.setTag("operation", options.operation);
        if (options.tenantId) scope.setTag("tenant_id", options.tenantId);
        if (options.correlationId) scope.setTag("correlation_id", options.correlationId);
        for (const [key, value] of Object.entries(options.tags ?? {})) {
            if (value !== null && value !== undefined) scope.setTag(key, value);
        }
        if (options.context) {
            scope.setContext(
                "operation",
                sanitizeOperationalValue(options.context) as Record<string, unknown>,
            );
        }
        eventId = Sentry.captureException(error);
    });
    return eventId;
}

export async function flushSentry(timeoutMs = 2_000): Promise<boolean> {
    return initialized ? Sentry.flush(timeoutMs) : true;
}
