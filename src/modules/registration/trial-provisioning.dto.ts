type UnknownBody = { [key: string]: unknown };

export class ProvisionTrialDto {
    private constructor(public readonly trialToken: string) {}

    static create(value: unknown): [string | undefined, ProvisionTrialDto | undefined] {
        const body = value && typeof value === "object" && !Array.isArray(value)
            ? value as UnknownBody
            : {};
        if (
            typeof body.trialToken !== "string"
            || body.trialToken.length < 32
            || body.trialToken.length > 256
            || !/^[A-Za-z0-9_-]+$/.test(body.trialToken)
        ) {
            return ["La credencial para crear la prueba no es válida o venció", undefined];
        }
        return [undefined, new ProvisionTrialDto(body.trialToken)];
    }
}
