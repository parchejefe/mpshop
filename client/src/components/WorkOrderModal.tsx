import React, { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Printer,
  X,
  Wrench,
  Laptop,
  CheckCircle2,
  AlertCircle,
  Share2,
  Copy,
  QrCode as QrIcon,
  Shield,
  Phone,
  MapPin,
  Calendar,
  User,
  FileText,
  Clock,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { formatCurrency } from "@/lib/currency";

interface WorkOrderModalProps {
  repairId?: number | null;
  unitId?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LETTER_W = 215.9; // mm
const LETTER_H = 279.4; // mm
const PAGE_PX_W = 816;  // 8.5in * 96dpi

export function WorkOrderModal({
  repairId,
  unitId,
  open,
  onOpenChange,
}: WorkOrderModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [copied, setCopied] = useState(false);
  const printContainerRef = useRef<HTMLDivElement>(null);

  const numericRepairId = repairId ? Number(repairId) : undefined;
  const numericUnitId = unitId ? Number(unitId) : undefined;

  const { data: orderData, isLoading, error, refetch } = trpc.repairs.getWorkOrder.useQuery(
    {
      repairId: numericRepairId,
      unitId: numericUnitId,
    },
    {
      enabled: open && (!!numericRepairId || !!numericUnitId),
      retry: 1,
    }
  );

  const { data: companySettings } = trpc.settings.getCompanyConfig.useQuery(undefined, { enabled: open });

  const workOrder = orderData?.workOrder;
  const unit = orderData?.unit;
  const customer = orderData?.customer;
  const warranty = orderData?.warranty;
  const company = {
    name: "MP SHOP TIENDA ONLINE",
    subName: "MP SHOP - SERVICIO TÉCNICO ESPECIALIZADO",
    slogan: "Tecnología que conecta contigo · Soporte Especializado",
    phone: "+591 70000000",
    whatsapp: "+591 70000000",
    email: "taller@mpshop.com",
    address: "Ciudad satelite , Av escalon Aguero nro 300, El Alto La Paz, Bolivia",
    city: "El Alto La Paz, Bolivia",
    taxId: "1234567890",
    logo: null as string | null,
    receiptFooterNotes: "El cliente declara que el equipo ingresa en las condiciones detalladas y acepta las políticas del taller.",
    ...(orderData?.company || {}),
    ...(companySettings || {}),
  };

  const specs = unit?.specs || {};
  const damageChecklist = unit?.damageChecklist || {};

  // Generar QR para la OT
  useEffect(() => {
    if (workOrder?.otNumber) {
      const qrPayload = `OT:${workOrder.otNumber}|RMA:${workOrder.rmaNumber || unit?.code || ""}|EQUIPO:${unit?.brand || ""} ${unit?.model || ""}|FECHA:${workOrder.entryDate ? new Date(workOrder.entryDate).toLocaleDateString("es-BO") : ""}`;
      QRCode.toDataURL(qrPayload, { width: 140, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
        .then((url) => setQrDataUrl(url))
        .catch(() => setQrDataUrl(null));
    } else {
      setQrDataUrl(null);
    }
  }, [workOrder?.otNumber, workOrder?.rmaNumber, unit?.code, unit?.brand, unit?.model, workOrder?.entryDate]);

  // Helper para generar el documento jsPDF a partir del canvas DOM
  const generatePdfDocument = useCallback(async () => {
    if (!workOrder || !unit) return null;
    await document.fonts?.ready;

    const specs = typeof unit.specs === "string" ? JSON.parse(unit.specs) : (unit.specs || {});
    const damageChecklist = typeof unit.damageChecklist === "string" ? JSON.parse(unit.damageChecklist) : (unit.damageChecklist || {});

    // Crear contenedor invisible fuera de pantalla
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.width = `${PAGE_PX_W}px`;
    wrapper.style.height = "1056px";
    wrapper.style.background = "#ffffff";
    wrapper.style.zIndex = "-9999";
    wrapper.style.overflow = "hidden";
    wrapper.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    // Renderizar el contenido exacto de la orden
    wrapper.innerHTML = `
      <div style="width:${PAGE_PX_W}px; height:1056px; padding:24px 28px; box-sizing:border-box; background:#ffffff; color:#0f172a; display:flex; flex-direction:column; justify-content:space-between; font-size:12px;">
        
        <!-- CABECERA -->
        <div style="border-bottom:2px solid #2563eb; padding-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:14px;">
              ${company.logo ? `
                <img src="${company.logo}" style="height:48px; max-width:140px; object-fit:contain;" />
              ` : `
                <div style="background:#2563eb; color:white; font-weight:900; font-size:22px; padding:6px 14px; border-radius:8px;">HK</div>
              `}
              <div>
                <div style="font-size:18px; font-weight:900; text-transform:uppercase; color:#0f172a; line-height:1.1;">${company.name}</div>
                <div style="font-size:11px; font-weight:700; color:#2563eb; text-transform:uppercase; margin-top:2px;">TALLER DE SERVICIO TÉCNICO & MANTENIMIENTO</div>
                <div style="font-size:10px; color:#64748b;">${company.address} · Tel: ${company.phone || company.whatsapp}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="display:inline-block; background:#0f172a; color:white; font-weight:900; font-size:14px; padding:6px 12px; border-radius:6px; font-family:monospace;">
                ${workOrder.otNumber}
              </div>
              ${workOrder.rmaNumber ? `<div style="font-size:10px; color:#2563eb; font-weight:700; margin-top:3px; font-family:monospace;">RMA: ${workOrder.rmaNumber}</div>` : ""}
              <div style="font-size:10px; color:#64748b; margin-top:2px;">Fecha Ingreso: ${new Date(workOrder.entryDate).toLocaleDateString("es-BO")} ${new Date(workOrder.entryDate).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </div>
        </div>

        <!-- TÍTULO DE DOCUMENTO -->
        <div style="background:#f1f5f9; border-left:4px solid #2563eb; padding:6px 12px; margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:13px; font-weight:900; text-transform:uppercase; color:#1e293b;">
            📋 FORMULARIO DE INGRESO Y ORDEN DE SERVICIO TÉCNICO
          </div>
          <div style="font-size:10px; font-weight:700; color:#475569; text-transform:uppercase;">
            Estado: <span style="color:#2563eb;">${workOrder.status === "in_progress" ? "EN DIAGNÓSTICO / TALLER" : workOrder.status === "completed" ? "COMPLETADO" : "CANCELADO"}</span>
          </div>
        </div>

        <!-- DATOS CLIENTE & RECEPTOR -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">
          <div style="border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; background:#fafafa;">
            <div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#475569; margin-bottom:4px; border-bottom:1px solid #e2e8f0; padding-bottom:2px;">👤 Datos del Propietario / Cliente</div>
            <div style="font-size:11px; line-height:1.4;">
              <div><strong>Nombre:</strong> ${customer?.name || "Cliente Particular / Mostrador"}</div>
              <div><strong>Teléfono/WhatsApp:</strong> ${customer?.phone || customer?.whatsapp || company.phone}</div>
              <div><strong>CI / NIT:</strong> ${customer?.taxId || "S/N"} · <strong>Ciudad:</strong> ${customer?.address || company.city}</div>
            </div>
          </div>
          <div style="border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; background:#fafafa;">
            <div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#475569; margin-bottom:4px; border-bottom:1px solid #e2e8f0; padding-bottom:2px;">🔧 Responsable Técnico & Garantía</div>
            <div style="font-size:11px; line-height:1.4;">
              <div><strong>Técnico Receptor:</strong> ${workOrder.technicianName}</div>
              <div><strong>Cargo:</strong> ${workOrder.technicianRole}</div>
              <div><strong>Garantía:</strong> ${warranty ? `Activa (${warranty.days} días - hasta ${new Date(warranty.endDate).toLocaleDateString("es-BO")})` : "Servicio técnico regular"}</div>
            </div>
          </div>
        </div>

        <!-- DATOS DEL EQUIPO -->
        <div style="border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; margin-top:8px;">
          <div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#2563eb; margin-bottom:4px; border-bottom:1px solid #e2e8f0; padding-bottom:2px;">💻 Identificación y Especificaciones del Equipo</div>
          <div style="display:grid; grid-template-columns:1.5fr 1fr 1fr; gap:8px; font-size:11px;">
            <div>
              <div><strong>Equipo:</strong> ${unit.brand} ${unit.model}</div>
              <div><strong>Código Interno:</strong> <span style="font-family:monospace; font-weight:700;">${unit.code}</span></div>
              <div><strong>Nº de Serie (S/N):</strong> <span style="font-family:monospace;">${unit.serialNumber || "No especificado"}</span></div>
            </div>
            <div>
              <div><strong>Procesador:</strong> ${specs.cpu || "—"}</div>
              <div><strong>RAM:</strong> ${specs.ram || "—"} · <strong>Disco:</strong> ${specs.storage || "—"}</div>
              <div><strong>Pantalla:</strong> ${specs.screen || "—"}</div>
            </div>
            <div>
              <div><strong>Estado Físico:</strong> ${unit.condition === "new" ? "Nuevo" : unit.condition === "like_new" ? "Como nuevo" : "Usado / Regular"}</div>
              <div><strong>Salud Batería:</strong> ${unit.batteryHealth === "plugged_only" || unit.batteryHealth === "bad_plugged_only" ? "Solo conectada" : unit.batteryHealth === "good" ? "100%" : unit.batteryHealth === "fair" ? "70%" : /^\d+$/.test(unit.batteryHealth) ? `${unit.batteryHealth}%` : (unit.batteryHealth || "—")}</div>
              <div><strong>Cargador:</strong> ${damageChecklist.chargerIncluded ? "✅ Sí incluye" : "❌ No entregó"}</div>
            </div>
          </div>
        </div>

        <!-- MOTIVO DE INGRESO & DIAGNÓSTICO -->
        <div style="border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; margin-top:8px;">
          <div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#dc2626; margin-bottom:4px; border-bottom:1px solid #e2e8f0; padding-bottom:2px;">⚠️ Falla Reportada por el Cliente & Motivo de Ingreso</div>
          <div style="font-size:11px; color:#1e293b; background:#fff1f2; border:1px dashed #fca5a5; padding:6px 8px; border-radius:4px; margin-top:3px; min-height:36px;">
            ${workOrder.reportedIssue || "Revisión técnica, diagnóstico integral y mantenimiento preventivo."}
          </div>
        </div>

        <!-- ESTADO FÍSICO / CHECKLIST DE RECEPCIÓN -->
        <div style="border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; margin-top:8px;">
          <div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#475569; margin-bottom:4px; border-bottom:1px solid #e2e8f0; padding-bottom:2px;">🔍 Checklist de Estado Físico al Momento de la Recepción</div>
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; font-size:10px; margin-top:4px;">
            <div style="background:#f8fafc; padding:3px 6px; border-radius:3px;">
              ${damageChecklist.screenScratched ? "⚠️ Pantalla: Con rayas" : "✅ Pantalla: Íntegra"}
            </div>
            <div style="background:#f8fafc; padding:3px 6px; border-radius:3px;">
              ${damageChecklist.bodyScratched ? "⚠️ Carcasa: Con detalles" : "✅ Carcasa: Buen estado"}
            </div>
            <div style="background:#f8fafc; padding:3px 6px; border-radius:3px;">
              ${damageChecklist.hingesLoose ? "⚠️ Bisagras: Con holgura" : "✅ Bisagras: Firmes"}
            </div>
            <div style="background:#f8fafc; padding:3px 6px; border-radius:3px;">
              ${damageChecklist.keyboardFaulty ? "⚠️ Teclado: Con fallas" : "✅ Teclado: Funcional"}
            </div>
          </div>
          ${unit.damageNotes ? `
            <div style="font-size:10px; color:#64748b; margin-top:4px; font-style:italic;">Observaciones de daños: ${unit.damageNotes}</div>
          ` : ""}
        </div>

        <!-- COSTOS & PRESUPUESTO -->
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-top:8px; align-items:center;">
          <div style="font-size:9.5px; color:#64748b; line-height:1.3;">
            <strong>Términos del Servicio:</strong> El cliente autoriza la revisión y desarme del equipo para su diagnóstico. El taller no se responsabiliza por pérdida de información no respaldada. Equipos no retirados pasados los 30 días generarán costo de almacenaje.
          </div>
          <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:6px 10px; text-align:right;">
            <div style="font-size:10px; color:#64748b;">Costo Estimado / Reparación</div>
            <div style="font-size:14px; font-weight:900; color:#0f172a;">
              ${workOrder.totalCost > 0 ? formatCurrency(workOrder.totalCost) : "Por Diagnosticar"}
            </div>
          </div>
        </div>

        <!-- FIRMAS DE CONFORMIDAD -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:14px; padding:0 20px;">
          <div style="border-top:1px solid #0f172a; text-align:center; padding-top:4px;">
            <div style="font-size:10px; font-weight:800; text-transform:uppercase;">Firma del Técnico Receptor</div>
            <div style="font-size:9px; color:#64748b;">${workOrder.technicianName}</div>
          </div>
          <div style="border-top:1px solid #0f172a; text-align:center; padding-top:4px;">
            <div style="font-size:10px; font-weight:800; text-transform:uppercase;">Firma del Cliente / Propietario</div>
            <div style="font-size:9px; color:#64748b;">Conformidad de Entrega y Términos</div>
          </div>
        </div>

        <!-- TALÓN DESGLOSABLE / TICKET DE RETIRO -->
        <div style="border-top:2px dashed #94a3b8; margin-top:12px; padding-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              ${qrDataUrl ? `
                <img src="${qrDataUrl}" style="height:55px; width:55px; border-radius:4px; border:1px solid #cbd5e1;" />
              ` : ""}
              <div>
                <div style="font-size:9px; font-weight:900; color:#2563eb; text-transform:uppercase;">🎟️ TALÓN DE RETIRO PARA EL CLIENTE</div>
                <div style="font-size:12px; font-weight:900; color:#0f172a;">${company.name} · OT: ${workOrder.otNumber}</div>
                <div style="font-size:10px; color:#475569;">Equipo: <strong>${unit.brand} ${unit.model}</strong> (${unit.code})</div>
                <div style="font-size:9px; color:#64748b;">Presenta este comprobante para recoger tu equipo. Consultas al WhatsApp: ${company.whatsapp}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:9px; color:#64748b;">Recepción</div>
              <div style="font-size:11px; font-weight:800;">${new Date(workOrder.entryDate).toLocaleDateString("es-BO")}</div>
              <div style="font-size:9px; color:#2563eb; font-weight:700; margin-top:2px;">${company.phone}</div>
            </div>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(wrapper);

    const canvas = await html2canvas(wrapper, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: PAGE_PX_W,
      height: 1056,
      windowWidth: PAGE_PX_W,
      windowHeight: 1056,
    });

    document.body.removeChild(wrapper);

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [LETTER_W, LETTER_H],
    });

    pdf.addImage(imgData, "JPEG", 0, 0, LETTER_W, LETTER_H);
    return pdf;
  }, [workOrder, unit, customer, warranty, company, qrDataUrl]);

  // Generar PDF Carta y descargar
  const handleExportPDF = useCallback(async () => {
    if (!workOrder || !unit) {
      toast.error("No se encontró información de la orden para generar el PDF");
      return;
    }

    try {
      setIsGeneratingPdf(true);
      toast.info("Generando Orden de Trabajo en PDF...", { duration: 2500 });
      const pdf = await generatePdfDocument();
      if (!pdf) return;

      const fileName = `Orden_Trabajo_${workOrder.otNumber}_${unit.code}.pdf`;
      pdf.save(fileName);
      toast.success("✅ Orden de Trabajo descargada correctamente");
    } catch (err: any) {
      console.error("[PDF Error]", err);
      toast.error("Error al generar PDF: " + (err.message || "Error desconocido"));
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [workOrder, unit, generatePdfDocument]);

  // Imprimir directo con iframe / PDF (cero páginas en blanco)
  const handlePrint = useCallback(async () => {
    if (!workOrder || !unit) {
      toast.error("No se encontró información de la orden");
      return;
    }

    try {
      setIsGeneratingPdf(true);
      toast.info("Preparando impresión...", { duration: 2000 });
      const pdf = await generatePdfDocument();
      if (!pdf) return;

      const blobUrl = pdf.output("bloburl");
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.src = blobUrl.toString();
      document.body.appendChild(iframe);
      iframe.onload = () => {
        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        }, 300);
      };
    } catch (err: any) {
      console.error("[Print Error]", err);
      toast.error("Error al preparar impresión: " + (err.message || "Error desconocido"));
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [workOrder, unit, generatePdfDocument]);

  // Copiar resumen al portapapeles
  const handleCopySummary = useCallback(() => {
    if (!workOrder || !unit) return;
    const text = `📋 *ORDEN DE TRABAJO - ${company.name}*
🔢 *OT:* ${workOrder.otNumber} ${workOrder.rmaNumber ? `(RMA: ${workOrder.rmaNumber})` : ""}
💻 *Equipo:* ${unit.brand} ${unit.model} (${unit.code})
📅 *Fecha de Ingreso:* ${new Date(workOrder.entryDate).toLocaleDateString("es-BO")}
👤 *Cliente:* ${customer?.name || "Mostrador"}
⚠️ *Motivo:* ${workOrder.reportedIssue}
🔧 *Técnico:* ${workOrder.technicianName}
📲 *Consultas WhatsApp:* ${company.whatsapp}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Resumen de la orden copiado al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  }, [workOrder, unit, customer, company]);

  // Compartir por WhatsApp
  const handleShareWhatsApp = useCallback(() => {
    if (!workOrder || !unit) return;
    const text = encodeURIComponent(`Hola! 👋 Te enviamos el comprobante de ingreso a taller de tu equipo:

🏢 *${company.name}*
📋 *Orden de Trabajo:* ${workOrder.otNumber}
💻 *Equipo:* ${unit.brand} ${unit.model} (${unit.code})
📅 *Fecha de Recepción:* ${new Date(workOrder.entryDate).toLocaleDateString("es-BO")}
⚠️ *Falla Declarada:* ${workOrder.reportedIssue}
🔧 *Técnico Asignado:* ${workOrder.technicianName}

Te avisaremos apenas tengamos el diagnóstico listo. Puedes consultar el estado en cualquier momento respondiendo a este mensaje. ¡Gracias por tu confianza!`);

    const phone = (customer?.whatsapp || customer?.phone || "").replace(/\D/g, "");
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
    } else {
      window.open(`https://wa.me/?text=${text}`, "_blank");
    }
  }, [workOrder, unit, customer, company]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 border-0 bg-slate-900/95 text-white">
        
        {/* BARRA DE HERRAMIENTAS SUPERIOR */}
        <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600 rounded-xl text-white">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-base text-white flex items-center gap-2">
                Orden de Trabajo {workOrder?.otNumber || ""}
                {workOrder?.status === "in_progress" && (
                  <Badge className="bg-amber-500 text-slate-950 font-bold text-[10px]">En Taller</Badge>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Formulario oficial de ingreso a servicio técnico y comprobante para el cliente
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleExportPDF}
              disabled={isGeneratingPdf || isLoading}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold gap-1.5 shadow-lg"
            >
              {isGeneratingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Descargar PDF Carta
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              disabled={isLoading}
              className="gap-1.5 bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
            >
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleShareWhatsApp}
              disabled={isLoading}
              className="gap-1.5 bg-emerald-700 hover:bg-emerald-600 border-emerald-600 text-white font-bold"
            >
              <Phone className="h-3.5 w-3.5" />
              WhatsApp
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCopySummary}
              className="h-8 px-2 text-slate-400 hover:text-white"
              title="Copiar resumen"
            >
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* CONTENIDO DEL FORMULARIO DE INGRESO */}
        <div className="p-4 md:p-6 flex justify-center bg-slate-950/60">
          {isLoading ? (
            <div className="py-20 text-center text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-500" />
              <p>Cargando orden de trabajo...</p>
            </div>
          ) : !workOrder || !unit ? (
            <div className="py-20 text-center text-red-400 space-y-3">
              <AlertCircle className="h-8 w-8 mx-auto" />
              <p className="font-semibold">{error?.message || "No se pudo cargar la información del equipo u orden de trabajo."}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                className="text-white border-white/20 hover:bg-white/10"
              >
                Reintentar
              </Button>
            </div>
          ) : (
            <div
              ref={printContainerRef}
              className="w-full max-w-[816px] bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 p-6 md:p-8 space-y-4 font-sans text-xs"
            >
              {/* ── CABECERA CORPORATIVA ── */}
              <div className="border-b-2 border-blue-600 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {company.logo ? (
                      <img
                        src={company.logo}
                        alt={company.name}
                        className="h-12 w-auto max-w-[130px] object-contain"
                      />
                    ) : (
                      <div className="bg-blue-600 text-white font-black text-xl px-3.5 py-2 rounded-xl shadow-sm">
                        HK
                      </div>
                    )}
                    <div>
                      <h1 className="text-base md:text-lg font-black uppercase text-slate-900 leading-tight tracking-tight">
                        {company.name}
                      </h1>
                      <p className="text-[11px] font-bold text-blue-600 uppercase tracking-wide">
                        Taller y Servicio Técnico Especializado
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        📍 {company.address} · 📲 Tel: {company.phone || company.whatsapp}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono text-sm md:text-base font-black bg-slate-900 text-white px-3 py-1 rounded-lg inline-block shadow-sm">
                      {workOrder.otNumber}
                    </span>
                    {workOrder.rmaNumber && (
                      <p className="font-mono text-[11px] text-blue-600 font-bold mt-1">
                        RMA Equipo: {workOrder.rmaNumber}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
                      Recepción: {new Date(workOrder.entryDate).toLocaleDateString("es-BO")} {new Date(workOrder.entryDate).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              </div>

              {/* ── BANNER TITULAR ── */}
              <div className="bg-slate-100 border-l-4 border-blue-600 p-2.5 rounded flex items-center justify-between">
                <div className="font-black text-slate-800 text-xs md:text-sm uppercase tracking-wide flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-600" />
                  ORDEN DE SERVICIO TÉCNICO & INGRESO A TALLER
                </div>
                <Badge className="bg-blue-600 text-white text-[10px] font-bold">
                  {workOrder.status === "in_progress" ? "EN REPARACIÓN / DIAGNÓSTICO" : workOrder.status === "completed" ? "COMPLETADO" : "CANCELADO"}
                </Badge>
              </div>

              {/* ── DATOS DE CLIENTE & TÉCNICO ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-1">
                  <p className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider flex items-center gap-1 border-b pb-1">
                    <User className="h-3.5 w-3.5 text-blue-600" /> Datos del Propietario / Cliente
                  </p>
                  <div className="text-xs space-y-0.5 pt-1 text-slate-800">
                    <p><strong>Nombre:</strong> {customer?.name || "Cliente Particular / Mostrador"}</p>
                    <p><strong>Teléfono / WhatsApp:</strong> {customer?.phone || customer?.whatsapp || company.phone}</p>
                    <p><strong>CI / NIT:</strong> {customer?.taxId || "S/N"} · <strong>Ciudad:</strong> {customer?.address || company.city}</p>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-1">
                  <p className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider flex items-center gap-1 border-b pb-1">
                    <Wrench className="h-3.5 w-3.5 text-blue-600" /> Técnico Receptor & Garantía
                  </p>
                  <div className="text-xs space-y-0.5 pt-1 text-slate-800">
                    <p><strong>Técnico Asignado:</strong> {workOrder.technicianName}</p>
                    <p><strong>Cargo:</strong> {workOrder.technicianRole}</p>
                    <p><strong>Garantía:</strong> {warranty ? `Activa (${warranty.days} días - vence ${new Date(warranty.endDate).toLocaleDateString("es-BO")})` : "Servicio técnico estándar"}</p>
                  </div>
                </div>
              </div>

              {/* ── DATOS TÉCNICOS DEL EQUIPO ── */}
              <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
                <p className="text-[10px] font-extrabold uppercase text-blue-600 tracking-wider flex items-center gap-1 border-b pb-1">
                  <Laptop className="h-3.5 w-3.5" /> Identificación y Especificaciones Técnicas del Equipo
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-800">
                  <div className="space-y-0.5">
                    <p><strong>Equipo:</strong> {unit.brand} {unit.model}</p>
                    <p><strong>Código Unidad:</strong> <span className="font-mono font-bold text-blue-700">{unit.code}</span></p>
                    <p><strong>Nº Serie (S/N):</strong> <span className="font-mono">{unit.serialNumber || "No especificado"}</span></p>
                  </div>
                  <div className="space-y-0.5">
                    <p><strong>Procesador:</strong> {specs.cpu || "—"}</p>
                    <p><strong>Memoria RAM:</strong> {specs.ram || "—"}</p>
                    <p><strong>Almacenamiento:</strong> {specs.storage || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p><strong>Pantalla:</strong> {specs.screen || "—"}</p>
                    <p><strong>Salud Batería:</strong> {unit.batteryHealth === "plugged_only" || unit.batteryHealth === "bad_plugged_only" ? "Solo conectada" : unit.batteryHealth === "good" ? "100%" : unit.batteryHealth === "fair" ? "70%" : /^\d+$/.test(unit.batteryHealth) ? `${unit.batteryHealth}%` : (unit.batteryHealth || "—")}</p>
                    <p><strong>Cargador:</strong> {damageChecklist.chargerIncluded ? "✅ Sí entregó cargador" : "❌ Sin cargador"}</p>
                  </div>
                </div>
              </div>

              {/* ── FALLA REPORTADA & MOTIVO ── */}
              <div className="border border-red-200 rounded-xl p-3 bg-red-50/40 space-y-1.5">
                <p className="text-[10px] font-extrabold uppercase text-red-600 tracking-wider flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> Falla Declarada por el Cliente & Motivo de Ingreso
                </p>
                <div className="bg-white p-2.5 rounded-lg border border-red-200 font-medium text-slate-800">
                  {workOrder.reportedIssue || "Revisión técnica general, diagnóstico y mantenimiento."}
                </div>
              </div>

              {/* ── ESTADO FÍSICO / CHECKLIST ── */}
              <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-1.5">
                <p className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider border-b pb-1">
                  🔍 Checklist de Estado Físico Inicial al Recibir el Equipo
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                  <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                    {damageChecklist.screenScratched ? "⚠️ Pantalla: Con rayas" : "✅ Pantalla: Sin rayas"}
                  </div>
                  <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                    {damageChecklist.bodyScratched ? "⚠️ Carcasa: Con detalles" : "✅ Carcasa: Buen estado"}
                  </div>
                  <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                    {damageChecklist.hingesLoose ? "⚠️ Bisagras: Con holgura" : "✅ Bisagras: Firmes"}
                  </div>
                  <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                    {damageChecklist.keyboardFaulty ? "⚠️ Teclado: Falla teclas" : "✅ Teclado: Operativo"}
                  </div>
                </div>
                {unit.damageNotes && (
                  <p className="text-[11px] text-slate-600 italic bg-slate-50 p-2 rounded">
                    <strong>Observaciones adicionales:</strong> {unit.damageNotes}
                  </p>
                )}
              </div>

              {/* ── TÉRMINOS & COSTO ESTIMADO ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <div className="md:col-span-2 text-[10px] text-slate-500 leading-tight space-y-0.5">
                  <p><strong>Cláusula de Servicio:</strong> El cliente autoriza la apertura y pruebas requeridas para el diagnóstico técnico. La empresa no se responsabiliza por pérdida de software o datos no respaldados previamente.</p>
                  <p>Equipos no retirados pasados los 30 días de notificada la finalización generarán cargo de almacenaje.</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-right">
                  <p className="text-[10px] text-slate-500">Presupuesto / Costo Estimado</p>
                  <p className="text-base font-black text-slate-900">
                    {workOrder.totalCost > 0 ? formatCurrency(workOrder.totalCost) : "Por Diagnosticar"}
                  </p>
                </div>
              </div>

              {/* ── SECCIÓN DE FIRMAS ── */}
              <div className="grid grid-cols-2 gap-12 pt-6 px-6">
                <div className="border-t border-slate-900 text-center pt-1.5">
                  <p className="font-extrabold uppercase text-[10px] text-slate-800">Firma del Técnico Receptor</p>
                  <p className="text-[9px] text-slate-500">{workOrder.technicianName}</p>
                </div>
                <div className="border-t border-slate-900 text-center pt-1.5">
                  <p className="font-extrabold uppercase text-[10px] text-slate-800">Firma del Cliente / Titular</p>
                  <p className="text-[9px] text-slate-500">Conformidad de Entrega e Ingreso</p>
                </div>
              </div>

              {/* ── TALÓN DESGLOSABLE DE RETIRO ── */}
              <div className="border-t-2 border-dashed border-slate-300 pt-3">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    {qrDataUrl && (
                      <img
                        src={qrDataUrl}
                        alt="QR OT"
                        className="h-14 w-14 rounded border border-slate-300 bg-white p-0.5 shrink-0"
                      />
                    )}
                    <div>
                      <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">
                        🎟️ TALÓN DE RETIRO PARA EL CLIENTE
                      </p>
                      <p className="text-xs font-black text-slate-900">
                        {company.name} · OT: <span className="text-blue-700 font-mono">{workOrder.otNumber}</span>
                      </p>
                      <p className="text-[11px] text-slate-600">
                        Equipo: <strong>{unit.brand} {unit.model}</strong> ({unit.code})
                      </p>
                      <p className="text-[9px] text-slate-500">
                        Presenta este talón para recoger tu equipo. Consultas al WhatsApp: <strong>{company.whatsapp}</strong>
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] text-slate-400">Fecha de Ingreso</p>
                    <p className="text-xs font-black text-slate-800">{new Date(workOrder.entryDate).toLocaleDateString("es-BO")}</p>
                    <p className="text-[10px] text-blue-600 font-bold">{company.phone}</p>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
