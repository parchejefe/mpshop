import React, { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Printer, X, Search, ChevronLeft, ChevronRight,
  Package, LayoutGrid, FileText, Loader2
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface CommercialCatalogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTypeFilter?: string;
}

const TYPE_LABELS: Record<string, string> = {
  all: "Todos",
  laptop: "Laptops",
  phone: "Celulares",
  tablet: "Tablets",
  monitor: "Monitores",
  charger: "Cargadores",
  accessory: "Accesorios",
};

const CONDITION_LABEL: Record<string, { label: string; color: string }> = {
  "10": { label: "COMO NUEVO", color: "#059669" },
  "9": { label: "EXCELENTE", color: "#059669" },
  "8": { label: "MUY BUENO", color: "#2563eb" },
  "7": { label: "BUENO", color: "#7c3aed" },
  "6": { label: "ACEPTABLE", color: "#d97706" },
};

export function CommercialCatalogModal({
  open,
  onOpenChange,
  initialTypeFilter = "all",
}: CommercialCatalogModalProps) {
  const [typeFilter, setTypeFilter] = useState<string>(initialTypeFilter);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewAllPages, setViewAllPages] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const { data: catalogData, isLoading } = trpc.units.getCommercialCatalog.useQuery(
    {
      type: typeFilter !== "all" ? (typeFilter as any) : undefined,
      search: search.trim() || undefined,
    },
    { enabled: open }
  );

  const items = catalogData?.items || [];

  // Datos dinámicos de empresa desde configuración
  const { data: companySettings } = trpc.settings.getCompanyConfig.useQuery(undefined, { enabled: open });

  const company = {
    name: "MP SHOP TIENDA ONLINE",
    subName: "MP SHOP - CONTROL & VENTAS",
    slogan: "Tecnologia que conecta contigo · Equipos Garantizados",
    phone: "+591 70000000",
    whatsapp: "+591 70000000",
    email: "ventas@mpshop.com",
    address: "Ciudad satelite , Av escalon Aguero nro 300, El Alto La Paz, Bolivia",
    logo: null as string | null,
    warrantyBadge: "Garantia Real",
    shippingBadge: "Envios a todo Bolivia",
    qualityBadge: "100% Verificados",
    ...catalogData?.company,
    ...companySettings,
  };

  const ITEMS_PER_PAGE = 3;
  const pages = useMemo(() => {
    const chunks: Array<typeof items> = [];
    for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) {
      chunks.push(items.slice(i, i + ITEMS_PER_PAGE));
    }
    return chunks;
  }, [items]);

  const totalPages = Math.max(1, pages.length);
  const activePageIdx = Math.min(currentPage - 1, totalPages - 1);
  const currentItems = pages[activePageIdx] || [];

  // Formato Carta (Letter): 215.9mm × 279.4mm
  const LETTER_W = 215.9;
  const LETTER_H = 279.4;
  const PAGE_PX_W = 816; // 8.5 pulgadas × 96dpi

  // Genera el HTML de una página del catálogo sin depender de ReactDOM
  const buildPageHTML = useCallback((pageItems: any[], pageIndex: number, totalPages: number): string => {
    const today = new Date().toLocaleDateString("es-BO", { year: "numeric", month: "long", day: "numeric" });

    const ACCENTS = ["#2563eb", "#7c3aed", "#059669"];
    const PRICE_GRADIENTS = [
      "linear-gradient(135deg,#eff6ff,#dbeafe)",
      "linear-gradient(135deg,#f5f3ff,#ede9fe)",
      "linear-gradient(135deg,#f0fdf4,#dcfce7)",
    ];
    const PRICE_BORDERS = ["#93c5fd", "#c4b5fd", "#86efac"];

    const conditionLabels: Record<string, { label: string; color: string }> = {
      "10": { label: "COMO NUEVO", color: "#059669" },
      "9":  { label: "EXCELENTE",  color: "#059669" },
      "8":  { label: "MUY BUENO", color: "#2563eb" },
      "7":  { label: "BUENO",     color: "#7c3aed" },
      "6":  { label: "ACEPTABLE", color: "#d97706" },
    };

    const itemsHTML = pageItems.map((unit: any, idx: number) => {
      const acc = ACCENTS[idx % 3];
      const pg = PRICE_GRADIENTS[idx % 3];
      const pb = PRICE_BORDERS[idx % 3];
      const specs = unit.specs || {};
      const condKey = unit.condition ? String(Math.round(Number(unit.condition))) : null;
      const cond = condKey && conditionLabels[condKey] ? conditionLabels[condKey] : null;
      const price = unit.salePrice > 0 ? `Bs. ${(unit.salePrice / 100).toFixed(0)}` : "Consultar";
      const discountPrice = unit.discountPrice && unit.discountPrice > 0
        ? `Bs. ${(unit.discountPrice / 100).toFixed(0)}` : null;
      const posStr = String(unit.catalogIndex ?? idx + 1).padStart(2, "0");

      const specsRows = ([
        specs.cpu     && ["⚙️ CPU", specs.cpu],
        specs.ram     && ["🧠 RAM", specs.ram],
        specs.storage && ["💾 Disco", specs.storage],
        specs.screenSize && ["🖥️ Pantalla", specs.screenSize],
        specs.gpu     && ["🎮 Gráfica", specs.gpu],
        specs.resolution && ["📐 Res.", specs.resolution],
      ].filter(Boolean) as [string, string][]).slice(0, 6)
        .map(([k, v]) => `
          <div style="font-size:12.5px;color:#1e293b;display:flex;align-items:center;gap:6px;min-height:22px;line-height:1.35;">
            <span style="font-weight:800;color:#0f172a;white-space:nowrap;flex-shrink:0;font-size:12.5px;">${k}:</span>
            <span style="color:#1e293b;font-weight:700;font-size:12.5px;word-break:break-word;">${v}</span>
          </div>`).join("");

      const photoHTML = unit.mainPhoto
        ? `<img src="${unit.mainPhoto}" alt="${unit.brand} ${unit.model}" crossorigin="anonymous" style="width:100%;height:150px;object-fit:contain;" />`
        : `<div style="text-align:center;color:#94a3b8;"><div style="font-size:38px;">💻</div><div style="font-size:11px;font-weight:700;margin-top:4px;">Sin Fotografía</div></div>`;

      const priceHTML = `
        <div style="display:flex;flex-direction:column;align-items:flex-end;">
          <div style="font-size:10px;color:#475569;font-weight:800;letter-spacing:0.5px;margin-bottom:3px;text-transform:uppercase;">PRECIO VENTA UNIT (BS)</div>
          <div style="display:inline-flex;align-items:center;justify-content:center;background:${pg};padding:6px 16px;border-radius:10px;border:1.5px solid ${pb};box-sizing:border-box;">
            <span style="font-size:22px;font-weight:900;color:${acc};line-height:1.2;white-space:nowrap;">${price}</span>
          </div>
        </div>
      `;

      return `
        <div style="background:white;border-radius:12px;border:1.5px solid #e2e8f0;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.05);display:flex;position:relative;box-sizing:border-box;">
          <div style="width:5px;background:linear-gradient(180deg,${acc},${acc}88);flex-shrink:0;"></div>
          <div style="position:absolute;top:8px;left:14px;background:${acc};color:white;font-weight:900;font-size:13px;border-radius:8px;padding:3px 9px;box-shadow:0 2px 8px rgba(0,0,0,0.2);">#${posStr}</div>
          <div style="width:175px;min-width:175px;background:linear-gradient(135deg,#f8fafc,#f1f5f9);display:flex;align-items:center;justify-content:center;padding:8px;border-right:1px solid #e2e8f0;box-sizing:border-box;">
            ${photoHTML}
          </div>
          <div style="flex:1;padding:10px 14px 10px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
            <div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;margin-top:1px;">
                <span style="font-family:monospace;font-size:11.5px;font-weight:800;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:6px;border:1px solid #bfdbfe;">COD: ${unit.code}</span>
                ${cond ? `<span style="font-size:11.5px;font-weight:800;background:${cond.color}20;color:${cond.color};padding:2px 8px;border-radius:6px;border:1px solid ${cond.color}40;">⭐ ${cond.label}</span>` : ""}
                ${unit.batteryHealth && unit.batteryHealth !== "n_a" ? `<span style="font-size:11.5px;font-weight:800;background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:6px;">🔋 Batería: ${unit.batteryHealth === "plugged_only" || unit.batteryHealth === "bad_plugged_only" ? "Solo conectada" : unit.batteryHealth === "good" ? "100%" : unit.batteryHealth === "fair" ? "70%" : /^\d+$/.test(unit.batteryHealth) ? `${unit.batteryHealth}%` : unit.batteryHealth}</span>` : ""}
                ${unit.tiktokUrl ? `<span style="font-size:11px;font-weight:800;background:#fce7f3;color:#9d174d;padding:2px 8px;border-radius:6px;">🎵 Video TikTok</span>` : ""}
              </div>
              <div style="font-weight:900;font-size:19px;color:#0f172a;letter-spacing:-0.4px;line-height:1.25;">${unit.brand} ${unit.model}</div>
              <div style="font-size:11.5px;color:#475569;font-weight:700;margin-top:1px;text-transform:uppercase;letter-spacing:0.5px;">${unit.type === "laptop" ? "LAPTOP / COMPUTADOR PORTÁTIL" : unit.type === "phone" ? "TELÉFONO INTELIGENTE" : unit.type === "tablet" ? "TABLET" : unit.type === "monitor" ? "MONITOR" : (unit.type || "")}</div>
            </div>
            ${Object.keys(specs).length > 0 ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;background:#f8fafc;border-radius:8px;padding:6px 12px;border:1.5px solid #e2e8f0;margin:5px 0;">
              ${specsRows}
            </div>` : ""}
            ${unit.damageNotes ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:6px;padding:5px 10px;margin:3px 0;display:flex;align-items:center;gap:6px;box-sizing:border-box;">
              <span style="font-size:11.5px;font-weight:900;color:#92400e;flex-shrink:0;white-space:nowrap;">📝 Detalle adicional:</span>
              <span style="font-size:11.5px;font-weight:700;color:#78350f;line-height:1.4;word-break:break-word;flex:1;">${unit.damageNotes}</span>
            </div>` : ""}
            <div style="display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid #f1f5f9;padding-top:7px;margin-top:3px;">
              <div style="display:flex;flex-direction:column;gap:3px;">
                <span style="font-size:11px;font-weight:800;background:#dcfce7;color:#166534;padding:3px 10px;border-radius:20px;border:1px solid #86efac;display:inline-block;">✓ STOCK DISPONIBLE</span>
                <div style="font-size:11.5px;color:#334155;font-weight:700;">📲 ${company.whatsapp}</div>
              </div>
              <div>${priceHTML}</div>
            </div>
          </div>
        </div>`;
    }).join("");

    return `
      <div style="display:flex;flex-direction:column;height:100%;min-height:1056px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;box-sizing:border-box;">
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#0f172a 100%);padding:14px 22px 12px;position:relative;overflow:hidden;box-sizing:border-box;">
          <div style="display:flex;align-items:center;justify-content:space-between;position:relative;">
            <div style="display:flex;align-items:center;gap:14px;">
              ${company.logo
                ? `<img src="${company.logo}" alt="${company.name}" style="height:48px;width:auto;object-fit:contain;background:white;border-radius:10px;padding:3px;box-shadow:0 4px 14px rgba(0,0,0,0.3);" />`
                : `<div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:12px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(37,99,235,0.5);border:2px solid rgba(255,255,255,0.15);"><span style="color:white;font-weight:900;font-size:20px;letter-spacing:-1px;">HK</span></div>`
              }
              <div>
                <div style="color:white;font-weight:900;font-size:21px;letter-spacing:0.5px;line-height:1.1;">${company.name}</div>
                <div style="color:#93c5fd;font-size:11.5px;font-weight:700;margin-top:2px;letter-spacing:0.8px;">CATÁLOGO OFICIAL DE EQUIPOS TECNOLÓGICOS</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="color:white;font-weight:900;font-size:13px;">Pág. ${pageIndex + 1} / ${totalPages}</div>
              <div style="color:#94a3b8;font-size:10.5px;margin-top:2px;">${today}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
            ${[["🛡️", company.warrantyBadge], ["🚚", company.shippingBadge], ["✅", company.qualityBadge], ["⚡", "Entrega Inmediata"]]
              .map(([icon, text]) => `<div style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);border-radius:20px;padding:3px 12px;color:white;font-size:11px;font-weight:700;">${icon} ${text}</div>`).join("")}
          </div>
        </div>
        <div style="height:3px;background:linear-gradient(90deg,#2563eb,#7c3aed,#2563eb);"></div>
        <div style="flex:1;padding:12px 18px;display:flex;flex-direction:column;gap:10px;background:#f8fafc;box-sizing:border-box;">
          ${itemsHTML}
        </div>
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:10px 22px;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;">
          <div style="display:flex;gap:18px;align-items:center;">
            <div style="color:white;font-size:12px;font-weight:700;">📱 WhatsApp: <span style="color:#93c5fd;">${company.whatsapp}</span></div>
            <div style="color:#64748b;font-size:11px;">|</div>
            <div style="color:#94a3b8;font-size:11px;font-weight:600;">📍 ${company.address}</div>
          </div>
          <div style="text-align:right;">
            <div style="color:#60a5fa;font-size:11px;font-weight:800;">${company.name}</div>
            <div style="color:#64748b;font-size:10px;">Pág. ${pageIndex + 1} de ${totalPages}</div>
          </div>
        </div>
      </div>`;
  }, [company]);

  const handleExportPDF = useCallback(async () => {
    if (pages.length === 0) {
      toast.error("No hay productos disponibles para generar el PDF");
      return;
    }
    setIsPrinting(true);
    toast.info(`Generando PDF (${pages.length} página${pages.length > 1 ? "s" : ""})...`, { duration: 3000 });

    try {
      await document.fonts?.ready;

      // Crear todos los wrappers DOM de golpe (sin React, sin setTimeout por página)
      const wrappers = pages.map((pageItems, i) => {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_PX_W}px;height:1056px;background:#ffffff;z-index:-1;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`;
        wrapper.innerHTML = buildPageHTML(pageItems, i, pages.length);
        document.body.appendChild(wrapper);
        return wrapper;
      });

      // Esperar un solo frame para que el navegador pinte todos los wrappers
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

      // Capturar todas las páginas en paralelo a escala optimizada
      const canvases = await Promise.all(
        wrappers.map((wrapper) =>
          html2canvas(wrapper, {
            scale: 1.2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: "#ffffff",
            logging: false,
            imageTimeout: 1200,
            width: PAGE_PX_W,
            height: 1056,
            windowWidth: PAGE_PX_W,
            windowHeight: 1056,
          })
        )
      );

      // Limpiar todos los wrappers
      wrappers.forEach((w) => {
        if (w.parentNode) w.parentNode.removeChild(w);
      });

      // Ensamblar el PDF
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
      canvases.forEach((canvas, i) => {
        const imgData = canvas.toDataURL("image/jpeg", 0.85);
        const imgW = LETTER_W;
        const imgH = (canvas.height / canvas.width) * imgW;
        const offsetY = Math.max(0, (LETTER_H - imgH) / 2);
        if (i > 0) pdf.addPage("letter", "portrait");
        pdf.addImage(imgData, "JPEG", 0, offsetY, imgW, imgH);
      });

      const today = new Date().toLocaleDateString("es-BO")?.replace(/\//g, "-") || "";
      pdf.save(`catalogo-hk-${today}.pdf`);
      toast.success("✅ PDF carta generado y descargado correctamente");
    } catch (err: any) {
      console.error("PDF error:", err);
      toast.error(`Error al generar el PDF: ${err?.message || "Intente nuevamente"}`);
    } finally {
      setIsPrinting(false);
    }
  }, [pages, company, buildPageHTML]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[98vw] max-w-4xl max-h-[95vh] p-0 overflow-hidden flex flex-col bg-slate-900 border-slate-700 text-white" showCloseButton={false}>
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl shadow-lg shadow-blue-900/40">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-black tracking-tight text-white flex items-center gap-2">
                  Catalogo Comercial
                  <Badge className="bg-emerald-500 text-white text-[10px] font-bold px-2">
                    {items.length} Disponibles
                  </Badge>
                </h2>
                <p className="text-xs text-slate-400">
                  {totalPages} pagina{totalPages !== 1 ? "s" : ""} · 3 productos por hoja A4
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant={viewAllPages ? "default" : "outline"}
                onClick={() => setViewAllPages(!viewAllPages)}
                className="h-9 text-xs gap-1.5 border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {viewAllPages ? "Ver por Hoja" : "Ver Todas"}
              </Button>
              <Button
                size="sm"
                onClick={handleExportPDF}
                disabled={isPrinting || items.length === 0}
                className="h-9 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold gap-1.5 shadow-md border-0"
              >
                {isPrinting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Generando PDF...</>
                ) : (
                  <><Printer className="h-4 w-4" /> Descargar PDF</>
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="h-9 w-9 text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {Object.entries(TYPE_LABELS).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setTypeFilter(k); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
                    typeFilter === k ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative w-44 shrink-0">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                placeholder="Buscar modelo..."
                className="h-8 pl-8 text-xs bg-slate-800 border-slate-700 text-white placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950/80 flex justify-center">
            {isLoading ? (
              <div className="py-20 text-center text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-blue-500" />
                <p className="text-xs font-bold uppercase tracking-wider">Cargando catalogo comercial...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="py-20 text-center text-slate-400">
                <Package className="h-12 w-12 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-bold">No hay productos disponibles con los filtros seleccionados.</p>
              </div>
            ) : viewAllPages ? (
              <div className="space-y-8 w-full max-w-2xl">
                {pages.map((pageItems, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="text-xs font-bold text-slate-400 flex items-center justify-between px-1">
                      <span className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-blue-600 text-white flex items-center justify-center text-[10px] font-black">{idx + 1}</span>
                        HOJA {idx + 1} DE {totalPages}
                      </span>
                      <span className="text-slate-500">{pageItems.length} equipos</span>
                    </div>
                    <PreviewPageSheet pageItems={pageItems} pageIndex={idx} totalPages={totalPages} company={company} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="w-full max-w-2xl flex flex-col items-center">
                <PreviewPageSheet pageItems={currentItems} pageIndex={activePageIdx} totalPages={totalPages} company={company} />
              </div>
            )}
          </div>

          {!viewAllPages && totalPages > 1 && (
            <div className="bg-slate-950 px-4 py-3 border-t border-slate-800 flex items-center justify-between">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 text-xs gap-1 border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    className={`w-7 h-7 rounded-md text-xs font-bold transition-all ${
                      currentPage === i + 1 ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-8 text-xs gap-1 border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                Siguiente <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewPageSheet({ pageItems, pageIndex, totalPages, company }: { pageItems: any[]; pageIndex: number; totalPages: number; company: any }) {
  return (
    <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full border border-slate-200 overflow-hidden" style={{ fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      <CatalogPageContent pageItems={pageItems} pageIndex={pageIndex} totalPages={totalPages} company={company} />
    </div>
  );
}


function CatalogPageContent({ pageItems, pageIndex, totalPages, company }: { pageItems: any[]; pageIndex: number; totalPages: number; company: any }) {
  const today = new Date().toLocaleDateString("es-BO", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "1056px", boxSizing: "border-box" }}>
      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)", padding: "14px 22px 12px", position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(59,130,246,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(99,102,241,0.1) 0%, transparent 40%)" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {company.logo ? (
              <img
                src={company.logo}
                alt={company.name}
                style={{ height: "48px", width: "auto", objectFit: "contain", background: "white", borderRadius: "10px", padding: "3px", boxShadow: "0 4px 14px rgba(0,0,0,0.3)" }}
              />
            ) : (
              <div style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", borderRadius: "12px", width: "48px", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(37,99,235,0.5)", border: "2px solid rgba(255,255,255,0.15)" }}>
                <span style={{ color: "white", fontWeight: 900, fontSize: "20px", letterSpacing: "-1px" }}>HK</span>
              </div>
            )}
            <div>
              <div style={{ color: "white", fontWeight: 900, fontSize: "21px", letterSpacing: "0.5px", lineHeight: "1.1" }}>{company.name}</div>
              <div style={{ color: "#93c5fd", fontSize: "11.5px", fontWeight: 700, margin: "2px 0 0 0", letterSpacing: "0.8px" }}>CATÁLOGO OFICIAL DE EQUIPOS TECNOLÓGICOS</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "white", fontWeight: 900, fontSize: "13px" }}>Pág. {pageIndex + 1} / {totalPages}</div>
            <div style={{ color: "#94a3b8", fontSize: "10.5px", marginTop: "2px" }}>{today}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
          {[["🛡️", company.warrantyBadge], ["🚚", company.shippingBadge], ["✅", company.qualityBadge], ["⚡", "Entrega Inmediata"]].map((b, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "20px", padding: "3px 12px", color: "white", fontSize: "11px", fontWeight: 700 }}>
              {b[0]} {b[1]}
            </div>
          ))}
        </div>
      </div>

      {/* Separador */}
      <div style={{ height: "3px", background: "linear-gradient(90deg, #2563eb, #7c3aed, #2563eb)" }} />

      {/* PRODUCTOS */}
      <div style={{ flex: 1, padding: "12px 18px", display: "flex", flexDirection: "column", gap: "10px", background: "#f8fafc", boxSizing: "border-box" }}>
        {pageItems.map((unit: any, unitIdx: number) => {
          const posStr = String(unit.catalogIndex ?? unitIdx + 1).padStart(2, "0");
          const specs = unit.specs || {};
          const condKey = unit.condition ? String(Math.round(Number(unit.condition))) : null;
          const cond = condKey && CONDITION_LABEL[condKey] ? CONDITION_LABEL[condKey] : null;
          const price = unit.salePrice > 0 ? `Bs. ${(unit.salePrice / 100).toFixed(0)}` : "Consultar";
          const accentColor = unitIdx === 0 ? "#2563eb" : unitIdx === 1 ? "#7c3aed" : "#059669";
          const priceGradient = unitIdx === 0 ? "linear-gradient(135deg, #eff6ff, #dbeafe)" : unitIdx === 1 ? "linear-gradient(135deg, #f5f3ff, #ede9fe)" : "linear-gradient(135deg, #f0fdf4, #dcfce7)";
          const priceBorder = unitIdx === 0 ? "#93c5fd" : unitIdx === 1 ? "#c4b5fd" : "#86efac";

          return (
            <div key={unit.id} style={{ background: "white", borderRadius: "12px", border: "1.5px solid #e2e8f0", overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", display: "flex", position: "relative", boxSizing: "border-box" }}>
              <div style={{ width: "5px", background: `linear-gradient(180deg, ${accentColor}, ${accentColor}88)`, flexShrink: 0 }} />
              <div style={{ position: "absolute", top: "8px", left: "14px", background: accentColor, color: "white", fontWeight: 900, fontSize: "13px", borderRadius: "8px", padding: "3px 9px", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>#{posStr}</div>
              <div style={{ width: "175px", minWidth: "175px", background: "linear-gradient(135deg, #f8fafc, #f1f5f9)", display: "flex", alignItems: "center", justifyContent: "center", padding: "8px", borderRight: "1px solid #e2e8f0", boxSizing: "border-box" }}>
                {unit.mainPhoto ? (
                  <img src={unit.mainPhoto} alt={`${unit.brand} ${unit.model}`} style={{ width: "100%", height: "150px", objectFit: "contain" }} crossOrigin="anonymous" />
                ) : (
                  <div style={{ textAlign: "center", color: "#94a3b8" }}>
                    <div style={{ fontSize: "38px" }}>💻</div>
                    <div style={{ fontSize: "11px", fontWeight: 700, marginTop: "4px" }}>Sin Fotografía</div>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, padding: "10px 14px 10px", display: "flex", flexDirection: "column", justifyContent: "space-between", boxSizing: "border-box" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "4px", marginTop: "1px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "11.5px", fontWeight: 800, background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: "6px", border: "1px solid #bfdbfe" }}>COD: {unit.code}</span>
                    {cond && <span style={{ fontSize: "11.5px", fontWeight: 800, background: cond.color + "20", color: cond.color, padding: "2px 8px", borderRadius: "6px", border: `1px solid ${cond.color}40` }}>⭐ {cond.label}</span>}
                    {unit.batteryHealth && unit.batteryHealth !== "n_a" && <span style={{ fontSize: "11.5px", fontWeight: 800, background: "#d1fae5", color: "#065f46", padding: "2px 8px", borderRadius: "6px" }}>🔋 Batería: {unit.batteryHealth === "plugged_only" || unit.batteryHealth === "bad_plugged_only" ? "Solo conectada" : unit.batteryHealth === "good" ? "100%" : unit.batteryHealth === "fair" ? "70%" : /^\d+$/.test(unit.batteryHealth) ? `${unit.batteryHealth}%` : unit.batteryHealth}</span>}
                    {unit.tiktokUrl && <span style={{ fontSize: "11px", fontWeight: 800, background: "#fce7f3", color: "#9d174d", padding: "2px 8px", borderRadius: "6px" }}>🎵 Video TikTok</span>}
                  </div>
                  <div style={{ fontWeight: 900, fontSize: "19px", color: "#0f172a", letterSpacing: "-0.4px", lineHeight: "1.25" }}>{unit.brand} {unit.model}</div>
                  {unit.type && <div style={{ fontSize: "11.5px", color: "#475569", fontWeight: 700, marginTop: "1px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{unit.type === "laptop" ? "LAPTOP / COMPUTADOR PORTÁTIL" : unit.type === "phone" ? "TELÉFONO INTELIGENTE" : unit.type === "tablet" ? "TABLET" : unit.type === "monitor" ? "MONITOR" : unit.type === "charger" ? "CARGADOR" : unit.type === "accessory" ? "ACCESORIO" : unit.type}</div>}
                </div>
                {Object.keys(specs).length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px", background: "#f8fafc", borderRadius: "8px", padding: "6px 12px", border: "1.5px solid #e2e8f0", margin: "5px 0" }}>
                    {([
                      specs.cpu && ["⚙️ CPU", specs.cpu],
                      specs.ram && ["🧠 RAM", specs.ram],
                      specs.storage && ["💾 Disco", specs.storage],
                      specs.screenSize && ["🖥️ Pantalla", specs.screenSize],
                      specs.gpu && ["🎮 Gráfica", specs.gpu],
                      specs.resolution && ["📐 Res.", specs.resolution],
                    ].filter(Boolean) as [string, string][]).slice(0, 6).map((item, i) => (
                      <div key={i} style={{ fontSize: "12.5px", color: "#1e293b", display: "flex", alignItems: "center", gap: "6px", minHeight: "22px", lineHeight: "1.35" }}>
                        <span style={{ fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", flexShrink: 0, fontSize: "12.5px" }}>{item[0]}:</span>
                        <span style={{ color: "#1e293b", fontWeight: 700, fontSize: "12.5px", wordBreak: "break-word" }}>{item[1]}</span>
                      </div>
                    ))}
                  </div>
                )}
                {unit.damageNotes && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderLeft: "4px solid #d97706", borderRadius: "6px", padding: "5px 10px", margin: "3px 0", display: "flex", alignItems: "center", gap: "6px", boxSizing: "border-box" }}>
                    <span style={{ fontSize: "11.5px", fontWeight: 900, color: "#92400e", flexShrink: 0, whiteSpace: "nowrap" }}>📝 Detalle adicional:</span>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#78350f", lineHeight: 1.4, wordBreak: "break-word", flex: 1 }}>{unit.damageNotes}</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1.5px solid #f1f5f9", paddingTop: "7px", marginTop: "3px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 800, background: "#dcfce7", color: "#166534", padding: "3px 10px", borderRadius: "20px", border: "1px solid #86efac", display: "inline-block" }}>✓ STOCK DISPONIBLE</span>
                    <div style={{ fontSize: "11.5px", color: "#334155", fontWeight: 700 }}>📲 {company.whatsapp}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <div style={{ fontSize: "10px", color: "#475569", fontWeight: 800, letterSpacing: "0.5px", marginBottom: "3px", textTransform: "uppercase" }}>PRECIO VENTA UNIT (BS)</div>
                    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: priceGradient, padding: "6px 16px", borderRadius: "10px", border: `1.5px solid ${priceBorder}`, boxSizing: "border-box" }}>
                      <span style={{ fontSize: "22px", fontWeight: 900, color: accentColor, lineHeight: 1.2, whiteSpace: "nowrap" }}>{price}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* FOOTER */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)", padding: "10px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: "18px", alignItems: "center" }}>
          <div style={{ color: "white", fontSize: "12px", fontWeight: 700 }}>📱 WhatsApp: <span style={{ color: "#93c5fd" }}>{company.whatsapp}</span></div>
          <div style={{ color: "#64748b", fontSize: "11px" }}>|</div>
          <div style={{ color: "#94a3b8", fontSize: "11px", fontWeight: 600 }}>📍 {company.address}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#60a5fa", fontSize: "11px", fontWeight: 800 }}>{company.name}</div>
          <div style={{ color: "#64748b", fontSize: "10px" }}>Pág. {pageIndex + 1} de {totalPages}</div>
        </div>
      </div>
    </div>
  );
}
