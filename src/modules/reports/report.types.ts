export type ReportSourceId = 'sales' | 'products' | 'customers' | 'inventory';
export type ReportFieldType = 'text' | 'number' | 'date' | 'boolean';

export type ReportOperator =
    | 'contains'
    | 'equals'
    | 'startsWith'
    | 'isEmpty'
    | 'greaterThan'
    | 'lessThan'
    | 'between'
    | 'on'
    | 'after'
    | 'before';

export interface ReportFieldDefinition {
    key: string;
    label: string;
    type: ReportFieldType;
}

export interface PublicReportSource {
    id: ReportSourceId;
    label: string;
    description: string;
    defaultColumns: string[];
    fields: ReportFieldDefinition[];
}

export interface ReportFilterInput {
    field: string;
    operator: ReportOperator;
    value?: unknown;
    valueTo?: unknown;
}

export interface ReportRequestInput {
    source?: unknown;
    columns?: unknown;
    filters?: unknown;
    sort?: unknown;
    limit?: unknown;
}

export interface ParsedReportRequest {
    source: ReportSourceId;
    columns: string[];
    filters: ReportFilterInput[];
    sort: { field: string; direction: 'asc' | 'desc' };
    limit: number;
}

export type ReportCellValue = string | number | boolean | null;

export interface ReportResult {
    source: PublicReportSource;
    columns: ReportFieldDefinition[];
    rows: Array<Record<string, ReportCellValue>>;
    total: number;
    truncated: boolean;
}
