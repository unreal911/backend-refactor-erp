import { describe, expect, it } from "vitest";
import {
    buildBaselineComparison,
    buildFindingDecisions,
    MigrationInventoryReport,
    stableHash,
} from "../src/scripts/migration-inventory";

function report(
    overrides: {
        schemaHash?: string;
        tableCounts?: Record<string, number>;
        controlTotals?: Record<string, string>;
        findingRows?: number;
    } = {},
): MigrationInventoryReport {
    const findingRows = overrides.findingRows ?? 0;
    return {
        reportVersion: 1,
        generatedAt: "2026-07-29T00:00:00.000Z",
        scope: "LEGACY_BASELINE",
        safety: {
            transactionReadOnly: true,
            isolationLevel: "repeatable read",
            containsRowValues: false,
            fetchedRemoteMedia: false,
        },
        database: {
            schema: "public",
            postgresVersion: "16",
            transactionReadOnlyVerified: true,
        },
        schemaInventory: {
            schemaHash: overrides.schemaHash ?? "schema-a",
            tables: [],
            columns: [],
            constraints: [],
            indexes: [],
            sequences: [],
            extensions: [],
            views: [],
            appliedMigrations: [],
        },
        dataBaseline: {
            tableCounts: overrides.tableCounts ?? { Order: 1 },
            stateCounts: {},
            controlTotals: overrides.controlTotals ?? { "Order.total": "10.00" },
            sequencePositions: {},
            baselineHash: "baseline",
        },
        integrity: {
            orphanForeignKeys: [],
            logicalDuplicates: [],
            invalidValues: [],
        },
        media: {
            totalReferences: 0,
            httpsReferences: 0,
            httpReferences: 0,
            malformedOrUnsupported: 0,
            duplicateReferenceGroups: 0,
            cloudinaryReferences: 0,
            hostCounts: {},
            remoteAvailabilityChecked: false,
            remoteReachable: 0,
            remoteMissing: 0,
            remoteIndeterminate: 0,
        },
        unstructuredData: {
            ordersWithNote: findingRows,
            ordersWithPaymentMethodEvidence: findingRows,
            ordersWithPaymentReferenceEvidence: 0,
            ordersWithAmountOrChangeEvidence: 0,
            structuredPaymentTablePresent: false,
        },
        findings: findingRows > 0
            ? [
                {
                    id: "unstructured:payment-in-order-note",
                    category: "UNSTRUCTURED",
                    subject: "Order.note",
                    affectedRows: findingRows,
                    suggestedAction: "TRANSFORM",
                    decisionStatus: "PENDING_APPROVAL",
                    detail: "prueba",
                },
            ]
            : [],
    };
}

describe("inventario de migración heredada", () => {
    it("produce una huella estable aunque cambie el orden de las propiedades", () => {
        expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
        expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    });

    it("compara esquema, conteos, totales y hallazgos", () => {
        const comparison = buildBaselineComparison(
            report(),
            report({
                schemaHash: "schema-b",
                tableCounts: { Order: 2 },
                controlTotals: { "Order.total": "25.00" },
                findingRows: 1,
            }),
        );

        expect(comparison.schemaChanged).toBe(true);
        expect(comparison.changedTableCounts).toEqual([
            { table: "Order", before: 1, after: 2 },
        ]);
        expect(comparison.changedControlTotals).toEqual([
            { metric: "Order.total", before: "10.00", after: "25.00" },
        ]);
        expect(comparison.changedSequencePositions).toEqual([]);
        expect(comparison.changedFindings).toEqual([
            {
                finding: "unstructured:payment-in-order-note",
                before: 0,
                after: 1,
            },
        ]);
    });

    it("genera decisiones pendientes sin incluir valores de filas", () => {
        const findings = buildFindingDecisions(
            {
                orphanForeignKeys: [
                    {
                        constraint: "Order_store_fkey",
                        childTable: "Order",
                        parentTable: "Store",
                        affectedRows: 2,
                    },
                ],
                logicalDuplicates: [],
                invalidValues: [],
            },
            report().media,
            report().unstructuredData,
        );

        expect(findings).toEqual([
            expect.objectContaining({
                id: "orphan:Order_store_fkey",
                affectedRows: 2,
                suggestedAction: "QUARANTINE",
                decisionStatus: "PENDING_APPROVAL",
            }),
        ]);
        expect(JSON.stringify(findings)).not.toContain("postgresql://");
    });
});
