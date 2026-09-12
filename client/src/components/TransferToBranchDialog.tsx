import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Package,
  Search,
  Minus,
  Plus,
  X,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Printer,
  MessageCircle,
} from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CartItem = {
  productId: number;
  productName: string;
  quantity: number;
  availableQty: number;
  unit: string;
};

function generateTransferPDF(data: {
  transferNumber: string;
  sourceBranchName: string;
  destBranchName: string;
  items: { productName: string; quantity: number; unit?: string }[];
  notes?: string;
  date: string;
}) {
  const { transferNumber, sourceBranchName, destBranchName, items, notes, date } = data;
  const rows = items.map((item, i) => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:10px 12px;color:#64748b;font-size:13px;">${i + 1}</td>
      <td style="padding:10px 12px;font-weight:600;font-size:13px;">${item.productName}</td>
      <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px;color:#1e293b;">${item.quantity}</td>
      <td style="padding:10px 12px;text-align:right;color:#64748b;font-size:13px;">${item.unit || "uds"}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Traspaso ${transferNumber}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#fff;padding:40px;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #1e293b;}
    .company{font-size:22px;font-weight:900;letter-spacing:-0.5px;}
    .doc-type{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#64748b;margin-top:4px;}
    .badge{background:#1e40af;color:#fff;padding:6px 16px;border-radius:8px;font-size:18px;font-weight:800;}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px;}
    .info-box{background:#f8fafc;border-radius:12px;padding:16px 20px;border:1px solid #e2e8f0;}
    .info-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin-bottom:6px;}
    .info-value{font-size:15px;font-weight:700;color:#1e293b;}
    table{width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;}
    thead tr{background:#1e293b;color:#fff;}
    thead th{padding:12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;}
    thead th:nth-child(3),thead th:nth-child(4){text-align:right;}
    .total-row{background:#eff6ff;font-weight:700;}
    .notes-box{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:24px;}
    .notes-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#92400e;margin-bottom:4px;}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:48px;}
    .sig-line{border-top:1.5px solid #cbd5e1;padding-top:10px;text-align:center;font-size:12px;color:#64748b;}
    .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;}
    @media print{body{padding:20px;}}
  </style></head><body>
  <div class="header">
    <div><div class="company">MP Shop Pedidos</div><div class="doc-type">Formulario de Traspaso de Inventario</div></div>
    <div class="badge">${transferNumber}</div>
  </div>
  <div class="info-grid">
    <div class="info-box"><div class="info-label">📤 Origen (Sale de)</div><div class="info-value">${sourceBranchName}</div></div>
    <div class="info-box"><div class="info-label">📥 Destino (Llega a)</div><div class="info-value">${destBranchName}</div></div>
    <div class="info-box"><div class="info-label">📅 Fecha</div><div class="info-value">${date}</div></div>
    <div class="info-box"><div class="info-label">📦 Total Líneas</div><div class="info-value">${items.length} producto${items.length !== 1 ? "s" : ""}</div></div>
  </div>
  ${notes ? `<div class="notes-box"><div class="notes-label">📝 Observaciones</div><p style="font-size:14px;color:#78350f;">${notes}</p></div>` : ""}
  <table>
    <thead><tr><th>#</th><th>Producto</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Unidad</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="2" style="padding:12px;font-size:13px;">TOTAL UNIDADES</td>
        <td style="padding:12px;text-align:right;font-size:15px;">${items.reduce((s, i) => s + i.quantity, 0)}</td>
        <td style="padding:12px;"></td>
      </tr>
    </tbody>
  </table>
  <div class="signatures">
    <div><div class="sig-line">Entrega Conforme<br/><strong>${sourceBranchName}</strong></div></div>
    <div><div class="sig-line">Recibe Conforme<br/><strong>${destBranchName}</strong></div></div>
  </div>
  <div class="footer">MP Shop Pedidos · ${date} · ${transferNumber}</div>
  </body></html>`;

  const win = window.open("", "_blank", "width=850,height=1100");
  if (!win) { alert("Permite ventanas emergentes para imprimir el comprobante"); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

export function TransferToBranchDialog({
  inventoryItems,
  onSuccess,
}: {
  inventoryItems: any[];
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState<string>("");
  const [successData, setSuccessData] = useState<any>(null);

  const { activeBranchId, branches } = useBranch();

  const destinationBranches = useMemo(
    () => branches.filter((b) => b.id !== activeBranchId && b.status === "active"),
    [branches, activeBranchId]
  );

  const sourceBranchName = branches.find((b) => b.id === activeBranchId)?.name || `Sucursal #${activeBranchId}`;
  const destBranchName = branches.find((b) => b.id === Number(destinationBranchId))?.name;

  const transferMutation = (trpc.inventory as any).createBranchTransfer.useMutation({
    onSuccess: (data: any) => {
      const destName = branches.find((b) => b.id === Number(destinationBranchId))?.name || `Sucursal #${destinationBranchId}`;
      toast.success(`Traspaso ${data.transferNumber} creado exitosamente`);

      setSuccessData({
        transferNumber: data.transferNumber,
        sourceBranchName,
        destBranchName: destName,
        destBranchId: destinationBranchId,
        items: data.items.map((i: any) => ({
          productName: i.productName,
          quantity: i.quantity,
          unit: cart.find((c) => c.productId === i.productId)?.unit || "uds",
        })),
        notes: data.notes,
        date: new Date().toLocaleDateString("es-BO", { year: "numeric", month: "long", day: "numeric" }),
      });

      setCart([]);
      setNotes("");
      setDestinationBranchId("");
      onSuccess();
    },
    onError: (err: any) => {
      toast.error(err.message || "Error al realizar el traspaso");
    },
  });

  const handleWhatsAppShare = () => {
    if (!successData) return;
    const destBranch = branches.find((b) => b.id === Number(successData.destBranchId));
    let phone = destBranch?.phone;
    
    // Clean phone number (remove spaces, plus sign, etc)
    if (phone && typeof phone === 'string') {
      phone = phone.replace(/\D/g, '');
    } else if (phone) {
      phone = String(phone).replace(/\D/g, '');
    }

    if (!phone) {
      toast.error("La sucursal de destino no tiene un número de teléfono registrado.");
      return;
    }

    const itemsText = successData.items.map((i: any) => `- ${i.quantity}x ${i.productName}`).join('\n');
    const now = new Date();
    const dateStr = now.toLocaleDateString("es-BO", { year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
    const message = `*MP SHOP PEDIDOS - NUEVO TRASPASO*\n📦 Traspaso #${successData.transferNumber}\n🏢 Destino: ${successData.destBranchName}\n📅 Fecha: ${dateStr}\n🕐 Hora: ${timeStr}\n\n*Detalle de Productos:*\n${itemsText}\n\n_Enviado desde el Sistema Central_`;
    
    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${phone}?text=${encodedMessage}`, '_blank');
  };

  const handlePrint = () => {
    if (!successData) return;
    generateTransferPDF(successData);
  };

  const handleCloseSuccess = () => {
    setSuccessData(null);
    setOpen(false);
  };

  const filteredItems = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return inventoryItems
      .filter(
        (item) =>
          (item.quantity || 0) > 0 &&
          (item.product?.name?.toLowerCase().includes(lowerSearch) ||
            item.product?.code?.toLowerCase().includes(lowerSearch))
      )
      .slice(0, 50);
  }, [inventoryItems, search]);

  const addToCart = (item: any) => {
    const productId = item.productId;
    const existing = cart.find((c) => c.productId === productId);
    if (existing) {
      if (existing.quantity < existing.availableQty) {
        setCart(
          cart.map((c) =>
            c.productId === productId ? { ...c, quantity: c.quantity + 1 } : c
          )
        );
      } else {
        toast.warning("No puedes transferir más del stock disponible");
      }
      return;
    }
    setCart([
      ...cart,
      {
        productId,
        productName: item.product?.name || "Producto",
        quantity: 1,
        availableQty: item.quantity || 0,
        unit: item.product?.unit || "unidad",
      },
    ]);
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart(
      cart
        .map((c) => {
          if (c.productId !== productId) return c;
          const newQty = c.quantity + delta;
          if (newQty < 1) return null as any;
          if (newQty > c.availableQty) {
            toast.warning("No puedes transferir más del stock disponible");
            return c;
          }
          return { ...c, quantity: newQty };
        })
        .filter(Boolean)
    );
  };

  const removeFromCart = (productId: number) => {
    setCart(cart.filter((c) => c.productId !== productId));
  };

  const handleSubmit = () => {
    if (!destinationBranchId) {
      toast.error("Selecciona la sucursal de destino");
      return;
    }
    if (cart.length === 0) {
      toast.error("Agrega al menos un producto al traspaso");
      return;
    }
    transferMutation.mutate({
      destinationBranchId: Number(destinationBranchId),
      items: cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        productName: c.productName,
      })),
      notes: notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setCart([]); setSearch(""); setNotes(""); setDestinationBranchId(""); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 bg-white/80 border-2 border-transparent hover:border-blue-500 transition-all duration-200">
          <ArrowRightLeft className="h-4 w-4 text-blue-600" />
          Traspaso a Sucursal
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        {successData ? (
          <div className="p-8 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Traspaso Exitoso</h2>
            <p className="text-slate-500 mb-8 text-lg">
              El traspaso <span className="font-semibold text-slate-700">{successData.transferNumber}</span> a <span className="font-semibold text-slate-700">{successData.destBranchName}</span> se ha registrado correctamente.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center">
              <Button onClick={handlePrint} size="lg" className="gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                <Printer className="h-5 w-5" />
                Imprimir Comprobante
              </Button>
              <Button onClick={handleWhatsAppShare} size="lg" className="gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold">
                <MessageCircle className="h-5 w-5" />
                Enviar por WhatsApp
              </Button>
            </div>
            
            <Button onClick={handleCloseSuccess} variant="ghost" className="mt-8 text-slate-500">
              Cerrar
            </Button>
          </div>
        ) : (
          <>
        <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
          <DialogTitle className="flex items-center gap-2 text-white text-lg font-bold">
            <ArrowRightLeft className="h-5 w-5" />
            Traspaso entre Sucursales
          </DialogTitle>
          <p className="text-blue-100 text-sm mt-1">
            Origen: <span className="font-bold text-white">{sourceBranchName}</span>
            {destBranchName && (
              <> → Destino: <span className="font-bold text-white">{destBranchName}</span></>
            )}
          </p>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Product selector */}
          <div className="flex-1 flex flex-col overflow-hidden border-r">
            <div className="p-4 border-b">
              <Label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">
                Sucursal Destino
              </Label>
              <Select value={destinationBranchId} onValueChange={setDestinationBranchId}>
                <SelectTrigger className="h-10 rounded-xl border-slate-200">
                  <SelectValue placeholder="Selecciona la sucursal de destino..." />
                </SelectTrigger>
                <SelectContent>
                  {destinationBranches.length === 0 ? (
                    <SelectItem value="none" disabled>No hay otras sucursales activas</SelectItem>
                  ) : (
                    destinationBranches.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-slate-400" />
                          {b.name}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar producto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-10 rounded-xl border-slate-200"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm">
                  <Package className="h-8 w-8 mb-2 opacity-40" />
                  No hay productos con stock disponible
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredItems.map((item: any) => {
                    const inCart = cart.find((c) => c.productId === item.productId);
                    return (
                      <button
                        key={item.productId}
                        onClick={() => addToCart(item)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-blue-50 transition-colors text-left group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {inCart ? (
                            <CheckCircle2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
                          ) : (
                            <Package className="h-4 w-4 text-slate-400 flex-shrink-0 group-hover:text-blue-400" />
                          )}
                          <span className="text-sm font-medium text-slate-800 truncate">
                            {item.product?.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          {item.quantity <= (item.product?.minStock || 5) && (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          )}
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            item.quantity <= 0
                              ? "bg-red-100 text-red-600"
                              : item.quantity <= (item.product?.minStock || 5)
                              ? "bg-amber-100 text-amber-700"
                              : "bg-green-100 text-green-700"
                          }`}>
                            {item.quantity} {item.product?.unit || "uds"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Cart */}
          <div className="w-72 flex flex-col overflow-hidden bg-slate-50">
            <div className="p-4 border-b bg-white">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                Productos a transferir
              </p>
              <p className="text-2xl font-black text-slate-900 mt-1">{cart.length}</p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm text-center px-4">
                  <ArrowRightLeft className="h-8 w-8 mb-2 opacity-30" />
                  Haz clic en un producto para agregarlo al traspaso
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map((item) => (
                    <div key={item.productId} className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-semibold text-slate-800 leading-tight pr-2">{item.productName}</p>
                        <button
                          onClick={() => removeFromCart(item.productId)}
                          className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                          <button
                            onClick={() => updateCartQty(item.productId, -1)}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-white transition-colors text-slate-600"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-bold text-slate-900">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateCartQty(item.productId, 1)}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-white transition-colors text-slate-600"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="text-xs text-slate-400">
                          de {item.availableQty} {item.unit}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-white space-y-3">
              <div>
                <Label htmlFor="notes" className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1 block">
                  Notas (Opcional)
                </Label>
                <Input
                  id="notes"
                  placeholder="Ej: Pedido urgente para evento"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-9 rounded-xl text-sm border-slate-200"
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={transferMutation.isPending || cart.length === 0 || !destinationBranchId}
                className="w-full h-11 gap-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white"
              >
                {transferMutation.isPending ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <ArrowRightLeft className="h-4 w-4" />
                )}
                {transferMutation.isPending ? "Procesando..." : "Confirmar Traspaso"}
              </Button>
            </div>
          </div>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
