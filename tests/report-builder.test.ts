import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseReportRequest, publicReportSources } from '../src/modules/reports/report.registry';
import { buildReportXlsx } from '../src/modules/reports/report.xlsx';

describe('constructor de reportes', () => {
    it('expone solo fuentes autorizadas y valida columnas y filtros', () => {
        expect(publicReportSources(['orders.view']).map((source) => source.id)).toEqual(['sales']);
        const parsed = parseReportRequest({
            source: 'sales', columns: ['total', 'code', 'total'],
            filters: [{ field: 'total', operator: 'greaterThan', value: 10 }],
            sort: { field: 'createdAt', direction: 'desc' }, limit: 999,
        }, 250);
        expect(parsed.columns).toEqual(['total', 'code']);
        expect(parsed.limit).toBe(250);
        expect(() => parseReportRequest({
            source: 'sales', columns: ['code'], filters: [{ field: 'total', operator: 'contains', value: '1' }],
        }, 100)).toThrow('Operador no valido');
    });

    it('genera un libro xlsx real con encabezados y autofiltro', async () => {
        const buffer = await buildReportXlsx({
            source: {
                id: 'sales', label: 'Ventas', description: '', defaultColumns: ['code', 'total'],
                fields: [{ key: 'code', label: 'Codigo', type: 'text' }, { key: 'total', label: 'Total', type: 'number' }],
            },
            columns: [{ key: 'code', label: 'Codigo', type: 'text' }, { key: 'total', label: 'Total', type: 'number' }],
            rows: [{ code: '=PELIGRO', total: 25.5 }], total: 1, truncated: false,
        });
        const zip = await JSZip.loadAsync(buffer);
        expect(zip.file('xl/workbook.xml')).toBeTruthy();
        const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
        expect(sheet).toContain('<autoFilter ref="A1:B2"/>');
        expect(sheet).toContain('=PELIGRO');
        expect(sheet).toContain('t="inlineStr"');
    });
});
