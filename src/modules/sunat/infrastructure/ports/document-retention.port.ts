export interface DeleteRetainedDocumentInput {
    tenantId: string;
    relativeKey: string;
}

/** Capacidad interna, no expuesta por el puerto de lectura/escritura normal. */
export interface DocumentRetention {
    delete(input: DeleteRetainedDocumentInput): Promise<void>;
}
