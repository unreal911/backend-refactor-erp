import { describe, expect, it } from "vitest";
import { normalizeCloudinaryUsage } from "../src/modules/platform-admin/image-provider-profile.service";

describe("Cloudinary usage para Superadmin", () => {
    it("normaliza consumo, límites y rate limit sin conservar la respuesta completa", () => {
        const result = normalizeCloudinaryUsage({
            plan: "Plus",
            last_updated: "2026-08-13",
            credits: { usage: 12.5, limit: 25, used_percent: 50 },
            storage: { usage: 1_073_741_824, limit: 5_368_709_120 },
            bandwidth: { usage: 536_870_912 },
            transformations: { usage: 1234, limit: 5000 },
            resources: 140,
            derived_resources: 320,
            rate_limit_allowed: 500,
            rate_limit_remaining: 497,
            rate_limit_reset_at: "2026-08-13T18:00:00Z",
            api_secret: "no-debe-persistirse",
        });

        expect(result).toEqual({
            source: "CLOUDINARY_ADMIN_API",
            plan: "Plus",
            lastUpdated: "2026-08-13",
            credits: { used: 12.5, limit: 25, percent: 50 },
            storage: { used: 1_073_741_824, limit: 5_368_709_120, percent: 20 },
            bandwidth: { used: 536_870_912, limit: null, percent: null },
            transformations: { used: 1234, limit: 5000, percent: 24.68 },
            resources: 140,
            derivedResources: 320,
            adminApi: { limit: 500, remaining: 497, resetAt: "2026-08-13T18:00:00Z" },
        });
        expect(JSON.stringify(result)).not.toContain("no-debe-persistirse");
    });

    it("tolera campos ausentes o agregados por Cloudinary", () => {
        const result = normalizeCloudinaryUsage({ objects: { usage: 9 }, future_field: true });
        expect(result.resources).toBe(9);
        expect(result.credits).toEqual({ used: null, limit: null, percent: null });
        expect(result.storage).toEqual({ used: null, limit: null, percent: null });
    });
});
