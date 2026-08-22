import JSZip from 'jszip';
import { ReportResult } from './report.types';

function xml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index: number): string {
    let result = '';
    for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
        result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
    }
    return result;
}

function cell(reference: string, value: unknown, header = false): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${reference}"${header ? ' s="1"' : ' s="2"'} t="n"><v>${value}</v></c>`;
    }
    return `<c r="${reference}"${header ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

export async function buildReportXlsx(report: ReportResult): Promise<Buffer> {
    const zip = new JSZip();
    const lastColumn = columnName(Math.max(0, report.columns.length - 1));
    const header = `<row r="1">${report.columns.map((column, index) => cell(`${columnName(index)}1`, column.label, true)).join('')}</row>`;
    const body = report.rows.map((row, rowIndex) => {
        const number = rowIndex + 2;
        const cells = report.columns.map((column, columnIndex) => {
            const raw = row[column.key];
            const value = column.type === 'boolean' ? (raw ? 'Si' : 'No') : raw;
            return cell(`${columnName(columnIndex)}${number}`, value ?? '');
        }).join('');
        return `<row r="${number}">${cells}</row>`;
    }).join('');
    const widths = report.columns.map((column, index) => {
        const maxData = report.rows.reduce((max, row) => Math.max(max, String(row[column.key] ?? '').length), column.label.length);
        return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(42, Math.max(12, maxData + 2))}" customWidth="1"/>`;
    }).join('');

    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
    zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Reporte" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
    zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
    zip.folder('xl')?.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1769D2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`);
    zip.folder('xl')?.folder('worksheets')?.file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols><sheetData>${header}${body}</sheetData>
<autoFilter ref="A1:${lastColumn}${Math.max(1, report.rows.length + 1)}"/>
</worksheet>`);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
