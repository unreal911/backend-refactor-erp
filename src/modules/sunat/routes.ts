import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { SunatController } from "./controller";
import { EmisorConfigController } from "./config/emisor-config.controller";
import { SunatArtifactController } from "./artifact.controller";
import { getSunatArtifactServiceFromEnvironment } from "./services/sunat-artifact.service";

export function registerSunatModuleRoutes(router: Router): void {
    const sunat = Router();
    const controller = new SunatController();
    const configController = new EmisorConfigController();
    const artifactController = new SunatArtifactController(
        getSunatArtifactServiceFromEnvironment(),
    );

    // Configuracion del emisor (RUC, credenciales, certificado). Permiso dedicado.
    const requireConfig = AuthMiddleware.requirePermission("sunat.config");
    const requireView = AuthMiddleware.requirePermission("sunat.documents.view");
    const requireIssue = AuthMiddleware.requirePermission("sunat.documents.issue");
    const requireCancel = AuthMiddleware.requirePermission("sunat.documents.cancel");
    sunat.get("/config", requireConfig, configController.obtener);
    sunat.put("/config", requireConfig, configController.actualizar);
    sunat.post("/config/certificado", requireConfig, configController.subirCertificado);
    sunat.post("/config/probar", requireConfig, configController.probar);

    // Emision desde una orden (proforma)
    sunat.post("/orders/:orderId/factura", requireIssue, controller.emitirFactura);
    sunat.post("/orders/:orderId/boleta", requireIssue, controller.emitirBoleta);
    sunat.get("/orders/:orderId/comprobantes", requireView, controller.listarPorOrder);

    // Notas de credito / debito sobre un comprobante aceptado
    sunat.post("/comprobantes/:id/nota-credito", requireIssue, controller.emitirNotaCredito);
    sunat.post("/comprobantes/:id/nota-debito", requireIssue, controller.emitirNotaDebito);
    sunat.get("/comprobantes/:id", requireView, controller.obtener);
    sunat.get(
        "/comprobantes/:id/artifacts",
        AuthMiddleware.requirePermission("sunat.documents.download"),
        artifactController.listForComprobante,
    );
    sunat.get(
        "/artifacts/:id/download",
        AuthMiddleware.requirePermission("sunat.documents.download"),
        artifactController.download,
    );

    // Bandeja de declaracion: lotes de boletas/notas pendientes de informar
    sunat.get("/pendientes", requireView, controller.listarPendientes);

    // Informe del dia: comprobantes declarados vs pendientes
    sunat.get("/informe-dia", requireView, controller.informeDia);

    // Reconciliacion: ventas con comprobante solicitado pero no emitido/aceptado
    sunat.get("/reconciliacion", requireView, controller.listarReconciliacion);

    // Listado de comprobantes emitidos (con filtros) para el panel de administracion
    sunat.get("/comprobantes", requireView, controller.listarComprobantes);

    // Resumen Diario de boletas (envio asincrono): adicion y anulacion
    sunat.post("/resumen-diario", requireIssue, controller.generarResumenDiario);
    sunat.post("/resumen-diario/anulacion", requireCancel, controller.anularBoletas);
    sunat.post("/resumen-diario/:id/consultar", requireView, controller.consultarResumen);

    // Comunicacion de Baja (anular facturas y notas aceptadas)
    sunat.post("/comunicacion-baja", requireCancel, controller.generarComunicacionBaja);
    sunat.post("/comunicacion-baja/:id/consultar", requireView, controller.consultarComunicacionBaja);

    router.use("/api/sunat", AuthMiddleware.validateJWT, sunat);
}
