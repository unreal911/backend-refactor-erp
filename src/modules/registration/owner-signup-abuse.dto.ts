import { SignupAbuseReviewStatus } from "@prisma/client";

type UnknownRecord = Record<string, unknown>;

function bodyRecord(value: unknown): UnknownRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as UnknownRecord
        : {};
}

function normalizedText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.normalize("NFKC").trim();
    if (!normalized || normalized.length > maxLength) return null;
    return normalized;
}

export class OwnerSignupAbuseRequestDto {
    private constructor(
        readonly captchaToken: string,
        readonly deviceId: string,
    ) {}

    static create(
        bodyValue: unknown,
        deviceHeader: unknown,
        fallbackSignal?: unknown,
    ): [string | undefined, OwnerSignupAbuseRequestDto | undefined] {
        const body = bodyRecord(bodyValue);
        const captchaToken = normalizedText(
            body.captchaToken ?? body["cf-turnstile-response"],
            2048,
        );
        if (!captchaToken) {
            return ["La verificación humana es obligatoria", undefined];
        }

        const suppliedDeviceId = normalizedText(deviceHeader, 128);
        if (
            suppliedDeviceId
            && (suppliedDeviceId.length < 16 || !/^[A-Za-z0-9_-]+$/.test(suppliedDeviceId))
        ) {
            return ["La señal del dispositivo no es válida", undefined];
        }
        const derivedSignal = normalizedText(fallbackSignal, 256);
        const deviceId = suppliedDeviceId
            ? `provided:${suppliedDeviceId}`
            : derivedSignal
                ? `derived:${derivedSignal}`
                : null;
        if (!deviceId) return ["La señal del dispositivo es obligatoria", undefined];
        return [undefined, new OwnerSignupAbuseRequestDto(captchaToken, deviceId)];
    }
}

export class SignupAbuseListDto {
    private constructor(
        readonly page: number,
        readonly limit: number,
        readonly reviewStatus?: SignupAbuseReviewStatus,
    ) {}

    static create(value: unknown): [string | undefined, SignupAbuseListDto | undefined] {
        const query = bodyRecord(value);
        const page = Number(query.page ?? 1);
        const limit = Number(query.limit ?? 50);
        if (!Number.isInteger(page) || page < 1) return ["Página no válida", undefined];
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return ["Límite no válido", undefined];
        }
        const status = query.reviewStatus;
        if (
            status !== undefined
            && !Object.values(SignupAbuseReviewStatus).includes(status as SignupAbuseReviewStatus)
        ) {
            return ["Estado de revisión no válido", undefined];
        }
        return [undefined, new SignupAbuseListDto(
            page,
            limit,
            status as SignupAbuseReviewStatus | undefined,
        )];
    }
}

export class SignupAbuseReviewDto {
    private constructor(
        readonly outcome: Extract<SignupAbuseReviewStatus, "FALSE_POSITIVE" | "CONFIRMED_ABUSE">,
        readonly noteCode: string,
        readonly overrideHours: number | null,
    ) {}

    static create(value: unknown): [string | undefined, SignupAbuseReviewDto | undefined] {
        const body = bodyRecord(value);
        if (body.outcome !== "FALSE_POSITIVE" && body.outcome !== "CONFIRMED_ABUSE") {
            return ["Resultado de revisión no válido", undefined];
        }
        if (body.note !== undefined) {
            return ["Usa un código de revisión; no se admite texto libre", undefined];
        }
        const allowedNoteCodes = [
            "NO_NOTE",
            "LEGITIMATE_CUSTOMER",
            "SHARED_NETWORK",
            "DEVICE_REPLACED",
            "AUTOMATION_CONFIRMED",
        ];
        const noteCode = body.noteCode === undefined
            ? "NO_NOTE"
            : normalizedText(body.noteCode, 50);
        if (!noteCode || !allowedNoteCodes.includes(noteCode)) {
            return ["Código de revisión no válido", undefined];
        }

        const overrideHours = body.outcome === "FALSE_POSITIVE"
            ? Number(body.overrideHours ?? 24)
            : null;
        if (
            overrideHours !== null
            && (!Number.isInteger(overrideHours) || overrideHours < 1 || overrideHours > 168)
        ) {
            return ["La excepción debe durar entre 1 y 168 horas", undefined];
        }
        return [undefined, new SignupAbuseReviewDto(
            body.outcome,
            noteCode,
            overrideHours,
        )];
    }
}
