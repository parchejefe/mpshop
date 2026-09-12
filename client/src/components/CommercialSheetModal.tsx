import React, { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download, X, Laptop, Smartphone, Tablet, Monitor, Package,
  ShieldCheck, Truck, Headset, ExternalLink, Share2, Copy, Play, Check,
  QrCode as QrIcon, FileText, Sparkles, Star, Battery, Cpu, HardDrive, Loader2,
  CheckCircle2, Flame, Award, Zap, PhoneCall, ShoppingCart
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface CommercialSheetModalProps {
  unitId?: number | null;
  code?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LETTER_W = 215.9; // mm
const LETTER_H = 279.4; // mm
const PAGE_PX_W = 816;  // 8.5in * 96dpi

export function CommercialSheetModal({
  unitId,
  code,
  open,
  onOpenChange,
}: CommercialSheetModalProps) {
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [tiktokQrDataUrl, setTiktokQrDataUrl] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const { data: sheetData, isLoading } = trpc.units.getCommercialSheet.useQuery(
    {
      unitId: unitId || undefined,
      code: code || undefined,
    },
    {
      enabled: open && (!!unitId || !!code),
    }
  );

  // Datos dinámicos de empresa desde configuración
  const { data: companySettings } = trpc.settings.getCompanyConfig.useQuery(undefined, { enabled: open });

  const unit = sheetData?.unit;
  // Merge: sheetData.company como base, companySettings tiene prioridad (logo, city, taxId, etc.)
  const company = {
    name: "MP SHOP TIENDA ONLINE",
    subName: "MP SHOP - CONTROL & VENTAS",
    slogan: "Tecnología que conecta contigo · Equipos Garantizados",
    phone: "+591 70000000",
    whatsapp: "+591 70000000",
    email: "ventas@mpshop.com",
    address: "Ciudad satelite , Av escalon Aguero nro 300, El Alto La Paz, Bolivia",
    city: "El Alto La Paz, Bolivia",
    taxId: "",
    logo: null as string | null,
    tiktokUrl: "",
    warrantyBadge: "Garantía Real & Soporte Especializado",
    shippingBadge: "Envíos asegurados a todo el país",
    qualityBadge: "Equipos 100% probados y verificados",
    receiptFooterNotes: "",
    ...sheetData?.company,
    ...companySettings,
  };

  const photos: string[] = unit?.photos || [];
  const specs = unit?.specs || {};

  // URL de TikTok: primero la del producto, si no la default de empresa
  const effectiveTiktokUrl = unit?.tiktokUrl || company.tiktokUrl || "";

  // Generar QR para el video de TikTok
  useEffect(() => {
    if (effectiveTiktokUrl) {
      QRCode.toDataURL(effectiveTiktokUrl, { width: 140, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
        .then((url) => setTiktokQrDataUrl(url))
        .catch(() => setTiktokQrDataUrl(null));
    } else {
      setTiktokQrDataUrl(null);
    }
  }, [effectiveTiktokUrl]);

  // Generación directa y fiable de PDF en formato Carta (Letter)
  const handleExportPDF = useCallback(async () => {
    if (!unit) {
      toast.error("No se encontró información del equipo para generar el PDF");
      return;
    }
    setIsGeneratingPdf(true);
    toast.info("Generando Ficha Comercial en formato Carta...");

    try {
      // Crear contenedor temporal adjunto al body
      const wrapper = document.createElement("div");
      wrapper.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: ${PAGE_PX_W}px;
        background: white;
        z-index: 99999;
        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        overflow: visible;
      `;
      const pageDiv = document.createElement("div");
      pageDiv.style.cssText = `width:${PAGE_PX_W}px; background:white; overflow:visible;`;
      wrapper.appendChild(pageDiv);
      document.body.appendChild(wrapper);

      // Renderizar con ReactDOM en el nodo temporal
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(pageDiv);
      await new Promise<void>((resolve) => {
        root.render(
          <CommercialSheetPrintable
            unit={unit}
            company={company}
            photos={photos}
            specs={specs}
            tiktokQrDataUrl={tiktokQrDataUrl}
          />
        );
        setTimeout(resolve, 400);
      });

      // Captura con html2canvas
      const canvas = await html2canvas(pageDiv, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        width: PAGE_PX_W,
        height: pageDiv.scrollHeight,
        windowWidth: PAGE_PX_W,
      });

      // Limpiar DOM temporal
      root.unmount();
      document.body.removeChild(wrapper);

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const canvasW = canvas.width / 2;
      const canvasH = canvas.height / 2;
      const ratio = LETTER_W / canvasW;
      const imgW = LETTER_W;
      const imgH = canvasH * ratio;
      const offsetY = Math.max(0, (LETTER_H - imgH) / 2);

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
      pdf.addImage(imgData, "JPEG", 0, offsetY, imgW, Math.min(imgH, LETTER_H));

      const filename = `ficha-${unit.code || "equipo"}-${unit.brand || ""}-${unit.model || ""}`
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-");
      pdf.save(`${filename}.pdf`);
      toast.success("✅ Ficha Comercial descargada correctamente en PDF");
    } catch (err: any) {
      console.error("Error al exportar PDF de ficha:", err);
      toast.error(`Error al generar el PDF: ${err?.message || "Intente nuevamente"}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [unit, company, photos, specs, tiktokQrDataUrl]);

  const handleShareWhatsApp = () => {
    if (!unit) return;
    const priceStr = unit.salePrice > 0 ? `Bs. ${(unit.salePrice / 100).toFixed(0)}` : "Consultar";
    const specsList = Object.entries(specs)
      .slice(0, 5)
      .map(([k, v]) => `• ${k.toUpperCase()}: ${v}`)
      .join("\n");

    const message = `✨ *${company.name}* ✨\n` +
      `🔥 *FICHA COMERCIAL — ${unit.brand} ${unit.model}*\n` +
      `📌 *Código:* ${unit.code}\n` +
      `⭐ *Estado Estético:* ${unit.condition ? `${unit.condition}/10` : "Excelente"}\n` +
      (unit.damageNotes ? `📝 *Detalle Adicional:* ${unit.damageNotes}\n` : "") +
      `💰 *PRECIO:* ${priceStr}\n\n` +
      `📋 *Especificaciones Principales:*\n${specsList}\n\n` +
      (unit.tiktokUrl ? `🎵 *Ver Video del Equipo en TikTok:* ${unit.tiktokUrl}\n\n` : "") +
      `🛡️ *Garantía:* 30 Días de Garantía Real\n` +
      `🚚 *Envíos:* A todo el país con entrega inmediata\n` +
      `📲 *Contacto / Pedidos:* ${company.whatsapp}`;

    const encoded = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, "_blank");
    toast.success("Abriendo WhatsApp para compartir...");
  };

  const handleCopyText = () => {
    if (!unit) return;
    const priceStr = unit.salePrice > 0 ? `Bs. ${(unit.salePrice / 100).toFixed(0)}` : "Consultar";
    const specsList = Object.entries(specs)
      .map(([k, v]) => `• ${k.toUpperCase()}: ${v}`)
      .join("\n");

    const message = `✨ ${company.name} ✨\n` +
      `🔥 ${unit.brand} ${unit.model}\n` +
      `Código: ${unit.code}\n` +
      `Estado: ${unit.condition}/10\n` +
      (unit.damageNotes ? `Detalle Adicional: ${unit.damageNotes}\n` : "") +
      `Precio: ${priceStr}\n\n` +
      `Especificaciones:\n${specsList}\n\n` +
      (unit.tiktokUrl ? `Video en TikTok: ${unit.tiktokUrl}\n\n` : "") +
      `Garantía: 30 Días\nWhatsApp: ${company.whatsapp}`;

    navigator.clipboard.writeText(message);
    toast.success("Texto comercial copiado al portapapeles");
  };

  // Preparar las 3 fotos principales
  const photo1 = photos[0] || null;
  const photo2 = photos[1] || null;
  const photo3 = photos[2] || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-4xl max-h-[95vh] p-0 overflow-hidden flex flex-col bg-slate-900 border-slate-700 text-white" showCloseButton={false}>
        {/* Toolbar */}
        <div className="bg-slate-950 p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-red-600 via-red-700 to-slate-900 rounded-xl shadow-md shadow-red-900/40">
              <Flame className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-white flex items-center gap-2">
                Ficha Comercial de Venta (Flyer Carta)
                {unit && (
                  <Badge className="bg-red-600 text-white font-mono text-[10px] font-bold">
                    {unit.code}
                  </Badge>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                {unit ? `${unit.brand} ${unit.model} · 3 Fotografías Principales` : "Cargando..."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopyText}
              className="h-9 text-xs gap-1.5 border-slate-700 text-slate-200 hover:bg-slate-800"
              title="Copiar texto para cotización rápida"
            >
              <Copy className="h-3.5 w-3.5" /> Copiar
            </Button>
            <Button
              size="sm"
              onClick={handleShareWhatsApp}
              className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5 shadow-md text-xs"
            >
              <Share2 className="h-3.5 w-3.5" /> WhatsApp
            </Button>
            <Button
              size="sm"
              onClick={handleExportPDF}
              disabled={isGeneratingPdf || isLoading || !unit}
              className="h-9 bg-red-600 hover:bg-red-700 text-white font-bold gap-1.5 shadow-md text-xs"
            >
              {isGeneratingPdf ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generando PDF...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> Descargar PDF (Carta)
                </>
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-9 w-9 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Body — Vista previa en pantalla */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950/90 flex justify-center">
          {isLoading ? (
            <div className="py-20 text-center text-slate-400">
              <div className="animate-spin h-8 w-8 border-3 border-red-500 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-xs font-bold uppercase tracking-wider">Generando Ficha Comercial...</p>
            </div>
          ) : !unit ? (
            <div className="py-20 text-center text-slate-400">
              <Package className="h-12 w-12 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-bold">No se encontró la información del producto.</p>
            </div>
          ) : (
            /* Flyer Comercial en Pantalla con las 3 Fotografías */
            <div className="w-full max-w-3xl bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
              {/* Header Flyer */}
              <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-red-950 text-white p-5 relative overflow-hidden">
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-3">
                    {company.logo ? (
                      <img
                        src={company.logo}
                        alt={company.name}
                        className="h-12 w-auto object-contain bg-white rounded-lg p-1 shadow-lg"
                      />
                    ) : (
                      <div className="bg-red-600 text-white font-black px-3.5 py-1.5 rounded-xl text-xl tracking-wider shadow-lg shadow-red-900/50">
                        HK
                      </div>
                    )}
                    <div>
                      <h3 className="text-lg font-black uppercase tracking-tight text-white leading-tight">
                        {company.name}
                      </h3>
                      <p className="text-xs font-bold text-red-300">
                        {company.slogan}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs font-black bg-red-600/90 text-white px-3 py-1 rounded-lg block shadow-sm">
                      {unit.code}
                    </span>
                    <span className="text-[10px] text-slate-300 font-bold mt-1 block">
                      Emisión: {new Date().toLocaleDateString("es-BO")}
                    </span>
                  </div>
                </div>

                {/* Subtitle hook */}
                <div className="mt-3 pt-2.5 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-300 font-medium">
                  <span className="text-red-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-red-500" /> RENDIMIENTO QUE IMPULSA TU PRODUCTIVIDAD
                  </span>
                  <span>EQUIPO 100% PROBADO Y GARANTIZADO</span>
                </div>
              </div>

              {/* Contenido del Flyer */}
              <div className="p-6 space-y-5">
                {/* Título & Badges */}
                <div className="border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-black uppercase text-red-700 bg-red-50 px-2.5 py-0.5 rounded-md border border-red-200">
                      {unit.type || "LAPTOP"}
                    </span>
                    {unit.condition && (
                      <span className="text-xs font-bold bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-md">
                        ⭐ Estado Estético: {unit.condition}/10
                      </span>
                    )}
                    {unit.batteryHealth && unit.batteryHealth !== "n_a" && (
                      <span className="text-xs font-bold bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-md">
                        🔋 Batería: {unit.batteryHealth === "plugged_only" || unit.batteryHealth === "bad_plugged_only" ? "Solo conectada" : unit.batteryHealth === "good" ? "100%" : unit.batteryHealth === "fair" ? "70%" : /^\d+$/.test(unit.batteryHealth) ? `${unit.batteryHealth}%` : unit.batteryHealth}
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-black text-slate-950 uppercase tracking-tight">
                    {unit.brand} <span className="text-red-600">{unit.model}</span>
                  </h2>
                  <div className="text-xs font-black uppercase tracking-wider text-slate-700 mt-1">
                    POTENCIA TU DÍA. <span className="text-red-600 underline decoration-red-500 underline-offset-4">IMPULSA TU NEGOCIO.</span>
                  </div>
                </div>

                {/* ─── SECCIÓN DE LAS 3 FOTOGRAFÍAS PRINCIPALES (PROPORCIÓN EXACTA 100%) ─── */}
                <div>
                  <div className="text-xs font-black uppercase text-slate-800 tracking-wider mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Award className="h-4 w-4 text-red-600" /> Fotografías Reales del Equipo (3 Vistas)
                    </span>
                    <span className="text-[10px] text-slate-500 font-semibold">
                      Proporción original 100% conservada
                    </span>
                  </div>

                  {/* Galería de 3 Fotos con Proporción Intacta */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Foto 1: Principal */}
                    <div className="bg-slate-50 border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
                      <div className="bg-slate-900 text-white text-[9px] font-black px-2.5 py-1 flex items-center justify-between">
                        <span>1. VISTA FRONTAL / PRINCIPAL</span>
                        <span className="text-red-400">★ PRINCIPAL</span>
                      </div>
                      <div className="h-48 p-2 flex items-center justify-center bg-white overflow-hidden">
                        {photo1 ? (
                          <img
                            src={photo1}
                            alt="Foto Principal"
                            className="max-h-full max-w-full w-auto h-auto object-contain transition-transform hover:scale-105"
                          />
                        ) : (
                          <div className="text-center text-slate-300">
                            <Laptop className="h-12 w-12 mx-auto mb-1 opacity-40" />
                            <span className="text-[10px] font-bold">Sin Foto 1</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Foto 2: Teclado / Detalle */}
                    <div className="bg-slate-50 border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
                      <div className="bg-slate-800 text-slate-200 text-[9px] font-black px-2.5 py-1">
                        2. VISTA TECLADO / DETALLE
                      </div>
                      <div className="h-48 p-2 flex items-center justify-center bg-white overflow-hidden">
                        {photo2 ? (
                          <img
                            src={photo2}
                            alt="Foto Teclado"
                            className="max-h-full max-w-full w-auto h-auto object-contain transition-transform hover:scale-105"
                          />
                        ) : (
                          <div className="text-center text-slate-300">
                            <Laptop className="h-12 w-12 mx-auto mb-1 opacity-40" />
                            <span className="text-[10px] font-bold">Sin Foto 2</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Foto 3: Puertos / Lateral */}
                    <div className="bg-slate-50 border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
                      <div className="bg-slate-800 text-slate-200 text-[9px] font-black px-2.5 py-1">
                        3. ESTADO FÍSICO / PUERTOS
                      </div>
                      <div className="h-48 p-2 flex items-center justify-center bg-white overflow-hidden">
                        {photo3 ? (
                          <img
                            src={photo3}
                            alt="Foto Puertos"
                            className="max-h-full max-w-full w-auto h-auto object-contain transition-transform hover:scale-105"
                          />
                        ) : (
                          <div className="text-center text-slate-300">
                            <Laptop className="h-12 w-12 mx-auto mb-1 opacity-40" />
                            <span className="text-[10px] font-bold">Sin Foto 3</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ─── BANNER DEDICADO DE VIDEO TIKTOK (QR + LINK) ─── */}
                <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-black text-white p-3.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md">
                  <div className="flex items-center gap-3.5 w-full sm:w-auto">
                    {tiktokQrDataUrl ? (
                      <div className="bg-white p-1 rounded-lg shrink-0 shadow-sm">
                        <img src={tiktokQrDataUrl} alt="QR TikTok" className="w-14 h-14 object-contain" />
                      </div>
                    ) : (
                      <div className="w-14 h-14 bg-slate-800 rounded-lg flex items-center justify-center shrink-0 border border-slate-700 text-pink-500">
                        <Play className="h-6 w-6 fill-current" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-pink-400 uppercase tracking-wider flex items-center gap-1">
                          🎵 Video Demostrativo en TikTok
                        </span>
                        <span className="bg-pink-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded uppercase">
                          Prueba Real
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-300 mt-0.5 leading-tight">
                        Escanea el código QR con tu celular o accede al enlace para ver el encendido y prueba funcional.
                      </p>
                      {unit.tiktokUrl && (
                        <a
                          href={unit.tiktokUrl.startsWith("http") ? unit.tiktokUrl : `https://${unit.tiktokUrl}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-pink-300 hover:text-pink-200 underline font-mono font-bold mt-1 block truncate max-w-md"
                        >
                          🔗 {unit.tiktokUrl}
                        </a>
                      )}
                    </div>
                  </div>

                  {unit.tiktokUrl && (
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = unit.tiktokUrl!.startsWith("http") ? unit.tiktokUrl! : `https://${unit.tiktokUrl}`;
                        window.open(url, "_blank");
                      }}
                      className="bg-pink-600 hover:bg-pink-700 text-white font-bold text-xs gap-1.5 shrink-0 w-full sm:w-auto shadow-md"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" /> Ver Video en TikTok
                    </Button>
                  )}
                </div>

                {/* ─── ESPECIFICACIONES TÉCNICAS (ESTILO ICON CARDS) ─── */}
                <div>
                  <div className="text-xs font-black uppercase text-slate-800 tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-red-600" /> Especificaciones Clave de Alto Rendimiento
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {specs.cpu && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-start gap-2.5">
                        <div className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0">
                          <Cpu className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 font-black block uppercase">PROCESADOR</span>
                          <strong className="text-xs text-slate-950 leading-tight block">{specs.cpu}</strong>
                        </div>
                      </div>
                    )}
                    {specs.ram && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-start gap-2.5">
                        <div className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0">
                          <HardDrive className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 font-black block uppercase">MEMORIA RAM</span>
                          <strong className="text-xs text-slate-950 leading-tight block">{specs.ram}</strong>
                        </div>
                      </div>
                    )}
                    {specs.storage && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-start gap-2.5">
                        <div className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0">
                          <HardDrive className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 font-black block uppercase">ALMACENAMIENTO</span>
                          <strong className="text-xs text-slate-950 leading-tight block">{specs.storage}</strong>
                        </div>
                      </div>
                    )}
                    {specs.screenSize && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-start gap-2.5">
                        <div className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0">
                          <Monitor className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 font-black block uppercase">PANTALLA</span>
                          <strong className="text-xs text-slate-950 leading-tight block">{specs.screenSize}</strong>
                        </div>
                      </div>
                    )}
                    {specs.gpu && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-start gap-2.5">
                        <div className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0">
                          <Zap className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 font-black block uppercase">GRÁFICOS</span>
                          <strong className="text-xs text-slate-950 leading-tight block">{specs.gpu}</strong>
                        </div>
                      </div>
                    )}
                    {Object.entries(specs)
                      .filter(([k]) => !["cpu", "ram", "storage", "screenSize", "gpu"].includes(k))
                      .slice(0, 1)
                      .map(([k, v]) => (
                        <div key={k} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-start gap-2.5">
                          <div className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0">
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="text-[9px] text-slate-500 font-black block uppercase">{k}</span>
                            <strong className="text-xs text-slate-950 leading-tight block">{String(v)}</strong>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* ─── DETALLE ADICIONAL DEL EQUIPO / OBSERVACIONES ─── */}
                {unit.damageNotes && (
                  <div className="bg-amber-50/90 border-2 border-amber-300/80 rounded-xl p-3.5 flex items-start gap-3 shadow-sm">
                    <div className="p-2 bg-amber-200/80 text-amber-900 rounded-lg shrink-0 text-base">
                      📝
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] text-amber-900 font-black block uppercase tracking-wider">
                        Detalle adicional del equipo:
                      </span>
                      <p className="text-xs text-amber-950 font-bold leading-relaxed mt-0.5 whitespace-pre-line">
                        {unit.damageNotes}
                      </p>
                    </div>
                  </div>
                )}

                {/* ─── BANNER DE PRECIO DE OFERTA DE ALTO IMPACTO (ESTILO FLYER) ─── */}
                <div className="bg-gradient-to-r from-red-600 via-red-700 to-slate-950 text-white rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
                  <div>
                    <span className="text-xs font-black uppercase tracking-widest text-red-200 block">
                      🔥 PRECIO ESPECIAL DE OFERTA
                    </span>
                    <div className="flex items-baseline gap-3 mt-1">
                      <span className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                        {unit.salePrice > 0 ? `Bs. ${(unit.salePrice / 100).toFixed(0)}` : "Consultar Precio"}
                      </span>
                      {unit.discountPrice && unit.discountPrice > unit.salePrice && (
                        <span className="text-sm font-bold text-red-200 line-through">
                          Antes Bs. {(unit.discountPrice / 100).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-1.5">
                    <span className="bg-white text-red-700 font-black px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow-md inline-flex items-center gap-1.5">
                      <ShoppingCart className="h-3.5 w-3.5" /> ¡Comprar Ahora / Entrega Inmediata!
                    </span>
                    <span className="text-[11px] text-red-100 font-semibold">
                      📲 Pedidos WhatsApp: {company.whatsapp}
                    </span>
                  </div>
                </div>

                {/* ─── 4 PILARES DE CONFIANZA AL PIE ─── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center text-xs font-bold text-slate-700">
                  <div className="bg-slate-100 py-2 px-2 rounded-xl border border-slate-200 flex flex-col items-center gap-1">
                    <ShieldCheck className="h-4 w-4 text-red-600" />
                    <span className="text-[10px]">CONFIABILIDAD QUE DURA</span>
                  </div>
                  <div className="bg-slate-100 py-2 px-2 rounded-xl border border-slate-200 flex flex-col items-center gap-1">
                    <Zap className="h-4 w-4 text-red-600" />
                    <span className="text-[10px]">MÁXIMO RENDIMIENTO</span>
                  </div>
                  <div className="bg-slate-100 py-2 px-2 rounded-xl border border-slate-200 flex flex-col items-center gap-1">
                    <Truck className="h-4 w-4 text-red-600" />
                    <span className="text-[10px]">ENVÍOS ASEGURADOS</span>
                  </div>
                  <div className="bg-slate-100 py-2 px-2 rounded-xl border border-slate-200 flex flex-col items-center gap-1">
                    <Headset className="h-4 w-4 text-red-600" />
                    <span className="text-[10px]">SOPORTE CONFIABLE</span>
                  </div>
                </div>

                {/* Footer Corporativo */}
                <div className="border-t border-slate-200 pt-3 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-1">
                  <div><strong>WhatsApp / Pedidos:</strong> {company.whatsapp} &nbsp;·&nbsp; <strong>Ubicación:</strong> {company.address}</div>
                  <div><strong>{company.name}</strong> · Material Comercial Oficial</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════ COMPONENTE IMPRIMIBLE PARA GENERACIÓN DE PDF (CARTA EXACTO) ═══════════ */
function CommercialSheetPrintable({
  unit,
  company,
  photos,
  specs,
  tiktokQrDataUrl,
}: {
  unit: any;
  company: any;
  photos: string[];
  specs: Record<string, any>;
  tiktokQrDataUrl: string | null;
}) {
  const today = new Date().toLocaleDateString("es-BO", { year: "numeric", month: "long", day: "numeric" });
  const photo1 = photos[0] || null;
  const photo2 = photos[1] || null;
  const photo3 = photos[2] || null;

  return (
    <div
      style={{
        width: `${PAGE_PX_W}px`,
        boxSizing: "border-box",
        padding: "20px 24px",
        background: "#ffffff",
        color: "#0f172a",
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      {/* ── HEADER CORPORATIVO TIPO FLYER COMERCIAL ── */}
      <div
        style={{
          background: "linear-gradient(135deg, #090d16 0%, #0f172a 60%, #7f1d1d 100%)",
          color: "#ffffff",
          borderRadius: "14px",
          padding: "14px 18px",
          marginBottom: "10px",
          border: "1px solid #1e293b",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                background: "#dc2626",
                color: "#ffffff",
                padding: "8px 14px",
                borderRadius: "10px",
                fontWeight: 900,
                fontSize: "20px",
                letterSpacing: "1px",
                boxShadow: "0 4px 10px rgba(220, 38, 38, 0.4)",
              }}
            >
              HK
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "17px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {company.name}
              </h1>
              <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#fca5a5", fontWeight: 600 }}>
                {company.slogan}
              </p>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div
              style={{
                background: "#dc2626",
                color: "#ffffff",
                padding: "4px 10px",
                borderRadius: "8px",
                fontFamily: "monospace",
                fontWeight: 900,
                fontSize: "12px",
                display: "inline-block",
              }}
            >
              CÓDIGO: {unit.code}
            </div>
            <div style={{ fontSize: "10px", color: "#cbd5e1", marginTop: "3px" }}>
              Emisión: {today}
            </div>
          </div>
        </div>

        {/* Hook sub-header */}
        <div
          style={{
            marginTop: "10px",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.15)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "10px",
            color: "#e2e8f0",
            fontWeight: 700,
          }}
        >
          <span style={{ color: "#f87171", textTransform: "uppercase" }}>
            ⚡ RENDIMIENTO QUE IMPULSA TU PRODUCTIVIDAD
          </span>
          <span>EQUIPOS 100% PROBADOS Y GARANTIZADOS</span>
        </div>
      </div>

      {/* ── TÍTULO DEL PRODUCTO & GANCHO COMERCIAL ── */}
      <div style={{ marginBottom: "12px", borderBottom: "1.5px solid #e2e8f0", paddingBottom: "8px" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
          <span
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "10px",
              fontWeight: 900,
              textTransform: "uppercase",
            }}
          >
            {unit.type || "EQUIPO"}
          </span>
          {unit.condition && (
            <span
              style={{
                background: "#fef3c7",
                color: "#92400e",
                padding: "2px 8px",
                borderRadius: "6px",
                fontSize: "10px",
                fontWeight: 800,
              }}
            >
              ⭐ Condición Estética: {unit.condition}/10
            </span>
          )}
          {unit.batteryHealth && unit.batteryHealth !== "n_a" && (
            <span
              style={{
                background: "#d1fae5",
                color: "#065f46",
                padding: "2px 8px",
                borderRadius: "6px",
                fontSize: "10px",
                fontWeight: 800,
              }}
            >
              🔋 Salud de Batería: {unit.batteryHealth === "plugged_only" || unit.batteryHealth === "bad_plugged_only" ? "Solo conectada" : unit.batteryHealth === "good" ? "100%" : unit.batteryHealth === "fair" ? "70%" : /^\d+$/.test(unit.batteryHealth) ? `${unit.batteryHealth}%` : unit.batteryHealth}
            </span>
          )}
        </div>

        <h2 style={{ margin: "2px 0 0 0", fontSize: "24px", fontWeight: 900, textTransform: "uppercase", color: "#0f172a" }}>
          {unit.brand} <span style={{ color: "#dc2626" }}>{unit.model}</span>
        </h2>

        <div style={{ fontSize: "12px", fontWeight: 900, textTransform: "uppercase", color: "#334155", marginTop: "2px" }}>
          POTENCIA TU DÍA. <span style={{ color: "#dc2626", textDecoration: "underline" }}>IMPULSA TU NEGOCIO.</span>
        </div>
      </div>

      {/* ── SECCIÓN DE LAS 3 FOTOGRAFÍAS PRINCIPALES (PROPORCIÓN ORIGINAL 100% INTACTA) ── */}
      <div style={{ marginBottom: "10px" }}>
        <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", color: "#dc2626", letterSpacing: "0.5px", marginBottom: "6px" }}>
          📸 Fotografías Reales del Equipo (3 Vistas)
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          {/* FOTO 1: VISTA PRINCIPAL */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              border: "2px solid #e2e8f0",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                background: "#0f172a",
                color: "#ffffff",
                fontSize: "8px",
                fontWeight: 900,
                padding: "3px 8px",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>1. VISTA FRONTAL / PRINCIPAL</span>
              <span style={{ color: "#f87171" }}>★ PRINCIPAL</span>
            </div>
            <div
              style={{
                height: "155px",
                padding: "6px",
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {photo1 ? (
                <img
                  src={photo1}
                  alt={unit.model}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    display: "block",
                    margin: "auto",
                  }}
                />
              ) : (
                <div style={{ textAlign: "center", color: "#94a3b8" }}>
                  <Laptop style={{ width: "36px", height: "36px", margin: "0 auto", opacity: 0.4 }} />
                  <div style={{ fontSize: "9px", fontWeight: 800 }}>Foto 1</div>
                </div>
              )}
            </div>
          </div>

          {/* FOTO 2: VISTA TECLADO / DETALLE */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              border: "2px solid #e2e8f0",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                background: "#1e293b",
                color: "#f1f5f9",
                fontSize: "8px",
                fontWeight: 900,
                padding: "3px 8px",
              }}
            >
              2. VISTA TECLADO / DETALLE
            </div>
            <div
              style={{
                height: "155px",
                padding: "6px",
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {photo2 ? (
                <img
                  src={photo2}
                  alt="Ángulo 2"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    display: "block",
                    margin: "auto",
                  }}
                />
              ) : (
                <div style={{ textAlign: "center", color: "#94a3b8" }}>
                  <Laptop style={{ width: "36px", height: "36px", margin: "0 auto", opacity: 0.4 }} />
                  <div style={{ fontSize: "9px", fontWeight: 800 }}>Foto 2</div>
                </div>
              )}
            </div>
          </div>

          {/* FOTO 3: ESTADO FÍSICO / PUERTOS */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              border: "2px solid #e2e8f0",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                background: "#1e293b",
                color: "#f1f5f9",
                fontSize: "8px",
                fontWeight: 900,
                padding: "3px 8px",
              }}
            >
              3. ESTADO FÍSICO / PUERTOS
            </div>
            <div
              style={{
                height: "155px",
                padding: "6px",
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {photo3 ? (
                <img
                  src={photo3}
                  alt="Ángulo 3"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    display: "block",
                    margin: "auto",
                  }}
                />
              ) : (
                <div style={{ textAlign: "center", color: "#94a3b8" }}>
                  <Laptop style={{ width: "36px", height: "36px", margin: "0 auto", opacity: 0.4 }} />
                  <div style={{ fontSize: "9px", fontWeight: 800 }}>Foto 3</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BANNER DEDICADO DE VIDEO TIKTOK (QR + LINK) ── */}
      <div
        style={{
          background: "linear-gradient(135deg, #090d16 0%, #0f172a 100%)",
          color: "#ffffff",
          borderRadius: "10px",
          padding: "10px 14px",
          marginBottom: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "1px solid #1e293b",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {tiktokQrDataUrl ? (
            <img
              src={tiktokQrDataUrl}
              alt="QR"
              style={{
                width: "56px",
                height: "56px",
                background: "#ffffff",
                borderRadius: "8px",
                padding: "3px",
                boxSizing: "border-box",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: "56px",
                height: "56px",
                background: "#1e293b",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#f472b6",
                fontSize: "20px",
              }}
            >
              🎵
            </div>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: 900, color: "#f472b6", textTransform: "uppercase" }}>
                🎵 Video Demostrativo en TikTok
              </span>
              <span
                style={{
                  background: "#db2777",
                  color: "#ffffff",
                  fontSize: "8px",
                  fontWeight: 900,
                  padding: "1px 5px",
                  borderRadius: "4px",
                  textTransform: "uppercase",
                }}
              >
                Prueba Real
              </span>
            </div>
            <div style={{ fontSize: "9px", color: "#cbd5e1", marginTop: "2px", lineHeight: "1.2" }}>
              Escanea el código QR con tu teléfono para ver la prueba funcional, encendido y estado físico real.
            </div>
            {unit.tiktokUrl && (
              <div style={{ fontSize: "9px", color: "#fbcfe8", marginTop: "2px", fontFamily: "monospace", fontWeight: 700 }}>
                🔗 {unit.tiktokUrl}
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              background: "rgba(219, 39, 119, 0.2)",
              border: "1px solid #db2777",
              color: "#f472b6",
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "9px",
              fontWeight: 800,
            }}
          >
            ✓ Video Verificado
          </div>
        </div>
      </div>

      {/* ── ESPECIFICACIONES TÉCNICAS (ESTILO ICON CARDS DELL) ── */}
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", color: "#0f172a", letterSpacing: "0.5px", marginBottom: "6px" }}>
          ⚙️ Especificaciones Técnicas Clave
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          {specs.cpu && (
            <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0" }}>
              <div style={{ fontSize: "8px", color: "#dc2626", fontWeight: 900, textTransform: "uppercase" }}>PROCESADOR / CPU</div>
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#0f172a", marginTop: "1px" }}>{specs.cpu}</div>
            </div>
          )}
          {specs.ram && (
            <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0" }}>
              <div style={{ fontSize: "8px", color: "#dc2626", fontWeight: 900, textTransform: "uppercase" }}>MEMORIA RAM</div>
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#0f172a", marginTop: "1px" }}>{specs.ram}</div>
            </div>
          )}
          {specs.storage && (
            <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0" }}>
              <div style={{ fontSize: "8px", color: "#dc2626", fontWeight: 900, textTransform: "uppercase" }}>ALMACENAMIENTO / SSD</div>
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#0f172a", marginTop: "1px" }}>{specs.storage}</div>
            </div>
          )}
          {specs.screenSize && (
            <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0" }}>
              <div style={{ fontSize: "8px", color: "#dc2626", fontWeight: 900, textTransform: "uppercase" }}>PANTALLA</div>
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#0f172a", marginTop: "1px" }}>{specs.screenSize}</div>
            </div>
          )}
          {specs.gpu && (
            <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0" }}>
              <div style={{ fontSize: "8px", color: "#dc2626", fontWeight: 900, textTransform: "uppercase" }}>TARJETA GRÁFICA</div>
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#0f172a", marginTop: "1px" }}>{specs.gpu}</div>
            </div>
          )}
          {Object.entries(specs)
            .filter(([k]) => !["cpu", "ram", "storage", "screenSize", "gpu"].includes(k))
            .slice(0, 1)
            .map(([k, v]) => (
              <div key={k} style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0" }}>
                <div style={{ fontSize: "8px", color: "#dc2626", fontWeight: 900, textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: "11px", fontWeight: 900, color: "#0f172a", marginTop: "1px" }}>{String(v)}</div>
              </div>
            ))}
        </div>
      </div>

      {/* ── DETALLE ADICIONAL DEL EQUIPO / OBSERVACIONES ── */}
      {unit.damageNotes && (
        <div
          style={{
            background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
            border: "1.5px solid #fde68a",
            borderLeft: "5px solid #d97706",
            borderRadius: "10px",
            padding: "8px 12px",
            marginBottom: "10px",
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: "16px", lineHeight: "1", marginTop: "1px" }}>📝</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "9px", fontWeight: 900, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Detalle adicional del equipo:
            </div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#78350f", marginTop: "2px", lineHeight: "1.35", wordBreak: "break-word" }}>
              {unit.damageNotes}
            </div>
          </div>
        </div>
      )}

      {/* ── BANNER DE PRECIO ESPECIAL DE OFERTA (ESTILO DELL VOSTRO) ── */}
      <div
        style={{
          background: "linear-gradient(135deg, #b91c1c 0%, #dc2626 50%, #0f172a 100%)",
          color: "#ffffff",
          borderRadius: "14px",
          padding: "12px 18px",
          marginBottom: "10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 6px 14px rgba(220, 38, 38, 0.25)",
        }}
      >
        <div>
          <div style={{ fontSize: "10px", fontWeight: 900, color: "#fecaca", textTransform: "uppercase", letterSpacing: "1px" }}>
            🔥 PRECIO ESPECIAL DE OFERTA
          </div>
          <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "1px", letterSpacing: "-0.5px" }}>
            {unit.salePrice > 0 ? `Bs. ${(unit.salePrice / 100).toFixed(0)}` : "Consultar Precio"}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              background: "#ffffff",
              color: "#dc2626",
              padding: "6px 14px",
              borderRadius: "8px",
              fontSize: "11px",
              fontWeight: 900,
              textTransform: "uppercase",
              display: "inline-block",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            }}
          >
            🛒 ¡COMPRAR AHORA!
          </div>
          <div style={{ fontSize: "10px", color: "#fee2e2", marginTop: "4px", fontWeight: 700 }}>
            📲 WhatsApp Pedidos: {company.whatsapp}
          </div>
        </div>
      </div>

      {/* ── 4 PILARES DE CONFIANZA AL PIE (ESTILO REFERENCIA 1) ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "8px",
          marginBottom: "12px",
          textAlign: "center",
        }}
      >
        <div style={{ background: "#f8fafc", padding: "8px 6px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "13px" }}>🛡️</div>
          <div style={{ fontSize: "8px", fontWeight: 900, color: "#0f172a", marginTop: "2px" }}>CONFIABILIDAD QUE DURA</div>
          <div style={{ fontSize: "7px", color: "#64748b" }}>Garantía real por escrito</div>
        </div>

        <div style={{ background: "#f8fafc", padding: "8px 6px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "13px" }}>⚡</div>
          <div style={{ fontSize: "8px", fontWeight: 900, color: "#0f172a", marginTop: "2px" }}>MÁXIMO RENDIMIENTO</div>
          <div style={{ fontSize: "7px", color: "#64748b" }}>100% probado en laboratorio</div>
        </div>

        <div style={{ background: "#f8fafc", padding: "8px 6px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "13px" }}>📦</div>
          <div style={{ fontSize: "8px", fontWeight: 900, color: "#0f172a", marginTop: "2px" }}>ENVÍOS ASEGURADOS</div>
          <div style={{ fontSize: "7px", color: "#64748b" }}>A todo el país inmediato</div>
        </div>

        <div style={{ background: "#f8fafc", padding: "8px 6px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "13px" }}>🎧</div>
          <div style={{ fontSize: "8px", fontWeight: 900, color: "#0f172a", marginTop: "2px" }}>SOPORTE CONFIABLE</div>
          <div style={{ fontSize: "7px", color: "#64748b" }}>Atención personalizada</div>
        </div>
      </div>

      {/* ── FOOTER CORPORATIVO FINAL ── */}
      <div
        style={{
          borderTop: "1.5px solid #e2e8f0",
          paddingTop: "8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "9px",
          color: "#64748b",
        }}
      >
        <div>
          <strong style={{ color: "#0f172a" }}>WhatsApp / Ventas:</strong> {company.whatsapp} &nbsp;·&nbsp;
          <strong style={{ color: "#0f172a" }}>Ubicación:</strong> {company.address}
        </div>
        <div>
          <strong style={{ color: "#0f172a" }}>{company.name}</strong> · Material Comercial Oficial
        </div>
      </div>
    </div>
  );
}
