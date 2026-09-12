import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { Plus, Eye, MapPin, Search, Edit, Trash2, Calendar, DollarSign, MessageCircle, Building2, Package, Filter, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock as ClockIcon, Calendar as CalendarIcon, CheckCircle, XCircle, MoreHorizontal, CheckSquare } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";

export default function Orders() {
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const { user } = useAuth();
  const getLocalDateInputValue = () => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - offsetMs).toISOString().split("T")[0];
  };
  const today = getLocalDateInputValue();

  const { data: displayOrders, isLoading } = trpc.orders.list.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const { data: deliveryOrders, isLoading: isLoadingDelivery } = trpc.orders.listForDelivery.useQuery(undefined, {
    enabled: user?.role === "user",
  });
  const { data: deliveryPersons } = trpc.users.listDeliveryPersons.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const orders = user?.role === "admin" ? displayOrders : deliveryOrders;

  const [isFiltersVisible, setIsFiltersVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [deliveryPersonFilter, setDeliveryPersonFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"time_asc" | "time_desc" | "none">("time_asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [deliveredPage, setDeliveredPage] = useState(1);
  const [cancelledPage, setCancelledPage] = useState(1);
  const ORDERS_PER_PAGE = 10;

  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);

  const toggleSelection = (id: number) => {
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };
  const selectAllRouteOrders = () => {
    if (selectedOrderIds.length === paginatedRouteOrders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(paginatedRouteOrders.map((o: any) => o.id));
    }
  };

  const [dismissOrderId, setDismissOrderId] = useState<number | null>(null);
  const [cancelData, setCancelData] = useState<{ cancelledBy: "client" | "company" | "system"; reason: string }>({
    cancelledBy: "client",
    reason: "",
  });

  const [cancellationRequestOrderId, setCancellationRequestOrderId] = useState<number | null>(null);
  const [cancellationRequestReason, setCancellationRequestReason] = useState<string>("");

  const [rescheduleOrderId, setRescheduleOrderId] = useState<number | null>(null);
  const [rescheduleData, setRescheduleData] = useState({ reason: "", date: "", time: "" });

  const [viewDeliveredOrderId, setViewDeliveredOrderId] = useState<number | null>(null);
  const { data: deliveredOrderDetails, isLoading: isLoadingDeliveredOrderDetails } = trpc.orders.getDetails.useQuery(
    { orderId: viewDeliveredOrderId ?? 0 },
    { enabled: viewDeliveredOrderId !== null }
  );

  const [deliverOrderId, setDeliverOrderId] = useState<number | null>(null);
  const [deliverPaymentMethod, setDeliverPaymentMethod] = useState<"cash" | "qr" | "transfer">("cash");
  const { data: openingStatus } = trpc.finance.hasActiveOpening.useQuery({ paymentMethod: deliverPaymentMethod });

  const recordPaymentMutation = trpc.orders.recordPayment.useMutation({
    onSuccess: () => {
      toast.success(`Pedido entregado y pago registrado correctamente`);
      setDeliverOrderId(null);
      utils.orders.list.invalidate();
      utils.orders.listForDelivery.invalidate();
      utils.finance.getExpectedDaily.invalidate();
      utils.finance.getMyStatus.invalidate();
      utils.units.list.invalidate();
      utils.finance.getTransactions.invalidate();
    },
    onError: (err: any) => toast.error(err.message || "Error al registrar entrega"),
  });

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const sheetDeliveryPersonId = Number.isFinite(Number(deliveryPersonFilter)) ? Number(deliveryPersonFilter) : null;
  const sheetDate = dateFilter || today;
  const { data: deliverySheet, isLoading: isLoadingSheet } = trpc.orders.getDeliverySheet.useQuery(
    { deliveryPersonId: sheetDeliveryPersonId ?? 0, date: sheetDate },
    { enabled: user?.role === "admin" && isSheetOpen && sheetDeliveryPersonId !== null }
  );

  const utils = trpc.useUtils();

  const dismissMutation = trpc.orders.dismissOrder.useMutation({
    onSuccess: () => {
      toast.success("Pedido dado de baja");
      setDismissOrderId(null);
      setCancelData({ cancelledBy: "client", reason: "" });
      utils.orders.list.invalidate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const requestCancellationMutation = trpc.orders.requestCancellation.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de baja enviada al administrador");
      setCancellationRequestOrderId(null);
      setCancellationRequestReason("");
      utils.orders.listForDelivery.invalidate();
      utils.orders.list.invalidate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const rescheduleMutation = trpc.orders.rescheduleOrder.useMutation({
    onSuccess: () => {
      toast.success("Pedido reprogramado");
      setRescheduleOrderId(null);
      setRescheduleData({ reason: "", date: "", time: "" });
      utils.orders.list.invalidate();
      utils.orders.listForDelivery.invalidate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const requestRescheduleMutation = trpc.orders.requestReschedule.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de reprogramación enviada");
      setRescheduleOrderId(null);
      setRescheduleData({ reason: "", date: "", time: "" });
      utils.orders.list.invalidate();
      utils.orders.listForDelivery.invalidate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const rejectRescheduleMutation = trpc.orders.rejectRescheduleRequest.useMutation({
    onSuccess: () => {
      toast.success("Solicitud rechazada");
      setRescheduleOrderId(null);
      utils.orders.list.invalidate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const bulkUpdateMutation = trpc.orders.bulkUpdateStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.updatedCount} pedidos actualizados correctamente`);
      setSelectedOrderIds([]);
      utils.orders.list.invalidate();
      utils.orders.listForDelivery.invalidate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  const sortedOrders = useMemo(() => {
    if (!orders) return [];
    
    let filtered = orders.filter((order: any) => {
      const searchMatch = order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase());
      const statusMatch = statusFilter === "all" || order.status === statusFilter;
      const dateMatch = !dateFilter || !order.deliveryDate || order.deliveryDate === dateFilter;
      const deliveryPersonMatch = deliveryPersonFilter === "all" || 
                                 (deliveryPersonFilter === "none" ? !order.deliveryPersonId : order.deliveryPersonId === parseInt(deliveryPersonFilter));
      
      return searchMatch && statusMatch && dateMatch && deliveryPersonMatch;
    });

    if (sortOrder === "none") return filtered;

    return [...filtered].sort((a: any, b: any) => {
      const dateA = a.deliveryDate || "9999-12-31";
      const dateB = b.deliveryDate || "9999-12-31";
      const dateCompare = sortOrder === "time_asc" ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;
      const timeA = a.deliveryTime || "99:99";
      const timeB = b.deliveryTime || "99:99";
      return sortOrder === "time_asc" ? timeA.localeCompare(timeB) : timeB.localeCompare(timeA);
    });
  }, [orders, searchTerm, statusFilter, sortOrder, dateFilter, deliveryPersonFilter]);

  // Pedidos por categoría
  const routeOrders = sortedOrders.filter((o: any) => ["pending", "assigned", "in_transit", "rescheduled"].includes(o.status));
  const deliveredOrders = sortedOrders.filter((o: any) => o.status === "delivered");
  const cancelledOrders = sortedOrders.filter((o: any) => o.status === "cancelled");

  // Pedidos paginados por categoría
  const paginatedRouteOrders = routeOrders.slice((currentPage - 1) * ORDERS_PER_PAGE, currentPage * ORDERS_PER_PAGE);
  const paginatedDeliveredOrders = deliveredOrders.slice((deliveredPage - 1) * ORDERS_PER_PAGE, deliveredPage * ORDERS_PER_PAGE);
  const paginatedCancelledOrders = cancelledOrders.slice((cancelledPage - 1) * ORDERS_PER_PAGE, cancelledPage * ORDERS_PER_PAGE);

  const totalRoutePages = Math.ceil(routeOrders.length / ORDERS_PER_PAGE);
  const totalDeliveredPages = Math.ceil(deliveredOrders.length / ORDERS_PER_PAGE);
  const totalCancelledPages = Math.ceil(cancelledOrders.length / ORDERS_PER_PAGE);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-100 text-yellow-800";
      case "assigned": return "bg-blue-100 text-blue-800";
      case "in_transit": return "bg-purple-100 text-purple-800";
      case "delivered": return "bg-green-100 text-green-800";
      case "cancelled": return "bg-red-100 text-red-800";
      case "rescheduled": return "bg-orange-100 text-orange-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: "Pendiente", assigned: "Asignado", in_transit: "En tránsito",
      delivered: "Entregado", cancelled: "Cancelado", rescheduled: "Reprogramado",
    };
    return labels[status] || status;
  };

  const openWhatsApp = (phone: string | null | undefined, orderNumber: string) => {
    // Si no hay teléfono directamente en el objeto, intentamos buscarlo en campos alternativos
    if (!phone) {
      toast.error("Este pedido no tiene un número de teléfono registrado");
      return;
    }

    // Limpiar el número: dejar solo dígitos
    const cleaned = String(phone || "").replace(/\D/g, "");
    if (!cleaned || cleaned.length < 7) {
      toast.error("El número de teléfono no es válido");
      return;
    }

    let formatted = cleaned;
    if (cleaned.length === 8) {
      formatted = "591" + cleaned;
    } else if (cleaned.startsWith("0") && cleaned.length === 9) {
      formatted = "591" + cleaned.slice(1);
    } else if (cleaned.length > 8 && !cleaned.startsWith("591")) {
      // Si ya tiene un formato largo pero no empieza con 591, 
      // verificamos si es de 11 dígitos (posiblemente ya tiene otro código)
      // o si simplemente le falta el 591
      if (cleaned.length !== 11) {
        formatted = "591" + cleaned;
      }
    }
    
    // El formato wa.me/+591... es aceptado y preferido por algunos navegadores
    const url = `https://wa.me/+${formatted}?text=Hola!%20Te%20contactamos%20de%20MP%20Shop%20sobre%20tu%20pedido%20%23${orderNumber}`;
    window.open(url, "_blank");
  };

  const paymentMethodLabel = (method?: string) => {
    if (method === "cash") return "Efectivo";
    if (method === "qr") return "QR";
    if (method === "transfer") return "Transferencia";
    return "â€”";
  };

  const exportSheetCsv = () => {
    if (!deliverySheet) return;

    const lines: string[] = [];
    const sep = ";";
    const q = (value: any) => `"${String(value ?? "").replaceAll('"', '""')}"`;

    lines.push(
      [
        "N",
        "Pedido",
        "Cliente",
        "Tel",
        "Hora",
        "Zona",
        "Productos",
        "Total productos",
        "MÃ©todo pago",
        "Cohorte",
        "Total Bs",
        "Observaciones",
      ].map(q).join(sep)
    );

    (deliverySheet.entries || []).forEach((row: any, idx: number) => {
      const order = row.order;
      const customer = row.customer;
      const products = (row.items || [])
        .map((item: any) => `${item.productName || `Producto #${item.productId}`} x${item.quantity}`)
        .join(" | ");
      const totalProducts = (row.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
      const tel = customer?.phone || customer?.whatsapp || customer?.clientNumber || "";

      lines.push(
        [
          idx + 1,
          order.orderNumber || order.id,
          customer?.name || "",
          tel,
          order.deliveryTime || "",
          order.zone || "",
          products,
          totalProducts,
          paymentMethodLabel(order.paymentMethod),
          row.cohort === "new" ? "Nuevo" : "Recompra",
          ((order.totalPrice || 0) / 100).toFixed(2),
          "",
        ].map(q).join(sep)
      );
    });

    lines.push("");
    lines.push(
      q("TOTAL") + sep + q("") + sep + q("") + sep + q("") + sep + q("") + sep + q("") + sep + q("") + sep +
      q(deliverySheet.totals?.totalProducts || 0) + sep + q("") + sep + q("") + sep +
      q(((deliverySheet.totals?.totalBs || 0) / 100).toFixed(2)) + sep + q("")
    );

    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hoja-reparto-${deliverySheet.deliveryPersonName || deliverySheet.deliveryPersonId}-${deliverySheet.date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const printSheet = () => {
    if (!deliverySheet) return;

    const escapeHtml = (value: any) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

    const rowsHtml = (deliverySheet.entries || []).map((row: any, idx: number) => {
      const order = row.order;
      const customer = row.customer;
      const tel = customer?.phone || customer?.whatsapp || customer?.clientNumber || "";
      const productsHtml = (row.items || [])
        .map((item: any) => `${escapeHtml(item.productName || `Producto #${item.productId}`)} x${escapeHtml(item.quantity)}`)
        .join("<br/>");
      const totalProducts = (row.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);

      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(order.orderNumber || order.id)}</td>
          <td>${escapeHtml(customer?.name || "")}</td>
          <td>${escapeHtml(tel)}</td>
          <td>${escapeHtml(order.deliveryTime || "")}</td>
          <td>${escapeHtml(order.zone || "")}</td>
          <td>${productsHtml}</td>
          <td style="text-align:right">${escapeHtml(totalProducts)}</td>
          <td>${escapeHtml(paymentMethodLabel(order.paymentMethod))}</td>
          <td>${row.cohort === "new" ? "Nuevo" : "Recompra"}</td>
          <td style="text-align:right">${((order.totalPrice || 0) / 100).toFixed(2)}</td>
          <td></td>
        </tr>
      `;
    }).join("");

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Hoja de reparto</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 18px; }
            h1 { font-size: 16px; margin: 0 0 6px 0; }
            .meta { font-size: 12px; color: #333; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #222; padding: 6px; vertical-align: top; }
            th { background: #f2f2f2; text-align: left; }
            .totals { margin-top: 10px; font-size: 12px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
            .totals div { border: 1px solid #ddd; padding: 8px; }
            @page { size: landscape; margin: 10mm; }
          </style>
        </head>
        <body>
          <h1>Hoja de reparto del dÃ­a</h1>
          <div class="meta">
            Fecha: <strong>${escapeHtml(deliverySheet.date)}</strong> &nbsp;|&nbsp;
            Repartidor: <strong>${escapeHtml(deliverySheet.deliveryPersonName || `#${deliverySheet.deliveryPersonId}`)}</strong>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:36px">NÂ°</th>
                <th style="width:90px">Pedido</th>
                <th style="width:160px">Cliente</th>
                <th style="width:100px">Tel</th>
                <th style="width:64px">Hora</th>
                <th style="width:120px">Zona</th>
                <th>Productos</th>
                <th style="width:70px; text-align:right">Cant.</th>
                <th style="width:90px">Pago</th>
                <th style="width:90px">Nuevo/Recompra</th>
                <th style="width:90px; text-align:right">Total Bs</th>
                <th style="width:140px">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="totals">
            <div><strong>Total Bs:</strong> ${((deliverySheet.totals?.totalBs || 0) / 100).toFixed(2)}</div>
            <div><strong>Total productos:</strong> ${deliverySheet.totals?.totalProducts || 0}</div>
            <div><strong>Nuevos:</strong> ${deliverySheet.totals?.newCustomers || 0} &nbsp; <strong>Recompra:</strong> ${deliverySheet.totals?.repeatCustomers || 0}</div>
            <div><strong>Efectivo Bs:</strong> ${((deliverySheet.totals?.cashBs || 0) / 100).toFixed(2)}</div>
            <div><strong>QR Bs:</strong> ${((deliverySheet.totals?.qrBs || 0) / 100).toFixed(2)}</div>
            <div><strong>Transferencia Bs:</strong> ${((deliverySheet.totals?.transferBs || 0) / 100).toFixed(2)}</div>
          </div>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const { data: closureStatus } = trpc.finance.hasPendingClosure.useQuery();
  const isLocked = user?.role === "user" && closureStatus?.hasPending;

  if (isLocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-t-4 border-t-blue-500 shadow-xl">
          <CardHeader className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-8 h-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Aplicación Inhabilitada</CardTitle>
            <CardDescription className="text-slate-500 font-medium text-base">
              Para poder utilizar la aplicación, solicite la habilitación en administración.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-6">
            <p className="text-sm text-slate-500 mb-6">
              Una vez el administrador apruebe tu cierre, podrás volver a gestionar tus entregas.
            </p>
            <Link href="/repartidor/finance">
              <Button className="w-full">Ir a Cierre de Caja</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || isLoadingDelivery) {
    return <div className="p-8 text-center">Cargando pedidos...</div>;
  }

  return (
    <div className="min-h-full bg-slate-50 p-0 md:p-8 pb-32">
      <div className="max-w-7xl mx-auto p-4 md:p-0">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight">Gestión de <span className="text-blue-600">Pedidos</span></h1>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sucursal:</span>
                <select
                  value={activeBranchId}
                  onChange={(e) => setActiveBranchId(Number(e.target.value))}
                  className="bg-transparent text-sm font-extrabold text-blue-600 outline-none cursor-pointer"
                >
                  {branches.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.isMainWarehouse ? '🏢 ' : '🏪 '}{b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-slate-500 font-medium mt-1">Administra y monitorea todas las entregas de MP Shop</p>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === "admin" && (
              <Link href="/create-order">
                <Button className="h-14 px-8 rounded-2xl bg-slate-900 hover:bg-slate-800 shadow-xl shadow-slate-200 gap-3 font-bold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]">
                  <Plus className="h-6 w-6" />
                  Nuevo Pedido
                </Button>
              </Link>
            )}
            {user?.role === "user" && (
              <Link href="/delivery-load">
                <Button className="h-14 px-8 rounded-2xl bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-100 gap-3 font-bold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]">
                  <Package className="h-6 w-6" />
                  Ver mi carga
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Barra de Filtros Sticky */}
        <div className="sticky top-14 md:top-0 z-30 -mx-4 px-4 md:mx-0 md:px-0 mb-8 pt-2 pb-4 bg-slate-50/80 backdrop-blur-md">
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[2.5rem] overflow-hidden bg-white/90">
            {/* Header del Filtro para Móvil */}
            <div 
              className="flex items-center justify-between px-6 py-4 md:hidden cursor-pointer active:bg-slate-50 transition-colors"
              onClick={() => setIsFiltersVisible(!isFiltersVisible)}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-900 rounded-xl text-white">
                  <Filter className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-sm">Filtros de Búsqueda</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                    {isFiltersVisible ? 'Toca para contraer' : 'Toca para expandir'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(statusFilter !== 'all' || dateFilter !== today || searchTerm !== "" || deliveryPersonFilter !== "all") && (
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                )}
                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${isFiltersVisible ? 'rotate-180' : ''}`} />
              </div>
            </div>

            <CardContent className={`p-4 md:p-6 transition-all duration-300 ${isFiltersVisible ? 'block' : 'hidden md:block'}`}>
              <div className="flex flex-col gap-6">
                {/* Primera Fila: Búsqueda y Fecha */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  <div className="md:col-span-4 relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                    <Input 
                      placeholder="Buscar pedido o cliente..." 
                      className="h-12 pl-12 rounded-2xl border-slate-100 bg-white shadow-sm focus:ring-2 focus:ring-primary/20 transition-all"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  
                  <div className="md:col-span-8 flex flex-col sm:flex-row gap-4 items-center">
                    <div className="relative w-full sm:w-auto">
                      <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
                      <Input 
                        type="date"
                        className="h-12 pl-12 rounded-2xl border-slate-100 bg-white shadow-sm focus:ring-2 focus:ring-primary/20 transition-all w-full sm:w-56"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                      />
                    </div>
                    
                    <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
                      <Button
                        variant={dateFilter === today ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl font-bold h-10 px-4 whitespace-nowrap"
                        onClick={() => setDateFilter(today)}
                      >
                        Hoy
                      </Button>
                      <Button
                        variant={dateFilter === new Date(Date.now() + 86400000).toISOString().split('T')[0] ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl font-bold h-10 px-4 whitespace-nowrap"
                        onClick={() => {
                          const tomorrow = new Date();
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          setDateFilter(tomorrow.toISOString().split('T')[0]);
                        }}
                      >
                        Mañana
                      </Button>
                      <Button
                        variant={dateFilter === "" ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl font-bold h-10 px-4 whitespace-nowrap"
                        onClick={() => setDateFilter("")}
                      >
                        Ver Todo
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Segunda Fila: Otros Filtros */}
                <div className="flex flex-wrap items-center gap-4">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-12 min-w-[180px] rounded-2xl border-slate-100 bg-white shadow-sm">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 shadow-xl">
                      <SelectItem value="all">Todos los estados</SelectItem>
                      <SelectItem value="pending">Pendientes</SelectItem>
                      <SelectItem value="assigned">Asignados</SelectItem>
                      <SelectItem value="in_transit">En tránsito</SelectItem>
                      <SelectItem value="delivered">Entregados</SelectItem>
                      <SelectItem value="cancelled">Cancelados</SelectItem>
                      <SelectItem value="rescheduled">Reprogramados</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={sortOrder} onValueChange={(val: any) => setSortOrder(val)}>
                    <SelectTrigger className="h-12 min-w-[150px] rounded-2xl border-slate-100 bg-white shadow-sm">
                      <SelectValue placeholder="Ordenar" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 shadow-xl">
                      <SelectItem value="time_asc">Hora (Más temprano)</SelectItem>
                      <SelectItem value="time_desc">Hora (Más tarde)</SelectItem>
                    </SelectContent>
                  </Select>

                  {user?.role === "admin" && (
                    <Select value={deliveryPersonFilter} onValueChange={setDeliveryPersonFilter}>
                      <SelectTrigger className="h-12 min-w-[200px] rounded-2xl border-slate-100 bg-white shadow-sm">
                        <SelectValue placeholder="Repartidor" />
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl border-slate-100 shadow-xl">
                        <SelectItem value="all">Todos los repartidores</SelectItem>
                        <SelectItem value="none">Sin repartidor</SelectItem>
                        {((deliveryPersons as any[]) || [])
                          .filter((u: any) => u?.role === "user")
                          .map((u: any) => (
                            <SelectItem key={u.id} value={String(u.id)}>
                              {u.name || u.username || `Usuario #${u.id}`}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Button 
                    variant="ghost" 
                    className="h-12 rounded-2xl text-slate-400 hover:text-slate-600 hover:bg-slate-100/50 font-bold ml-auto"
                    onClick={() => {
                      setSearchTerm("");
                      setStatusFilter("all");
                      setDateFilter("");
                      setSortOrder("time_asc");
                      setDeliveryPersonFilter("all");
                    }}
                  >
                    Restablecer
                  </Button>
                </div>
              </div>

              {user?.role === "admin" && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-50">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Hoja de repartidor: <span className="text-slate-600">{sheetDate}</span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 px-6 rounded-xl border-slate-200 text-slate-600 font-bold hover:bg-slate-50 shadow-sm"
                    disabled={sheetDeliveryPersonId === null}
                    onClick={() => setIsSheetOpen(true)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Hoja de Reparto
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabs de Segmentación */}
        <Tabs defaultValue="route" className="space-y-8">
          <div className="flex items-center justify-between">
            <TabsList className="bg-slate-100 p-1 rounded-[1.5rem] h-14 w-full sm:w-auto">
              <TabsTrigger value="route" className="rounded-[1.2rem] h-12 px-6 font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm">
                En Ruta
                <Badge className="ml-2 bg-slate-900 text-white border-none text-[10px]">
                  {sortedOrders.filter((o: any) => ["pending", "assigned", "in_transit", "rescheduled"].includes(o.status)).length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="delivered" className="rounded-[1.2rem] h-12 px-6 font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm">
                Entregados
                <Badge className="ml-2 bg-emerald-500 text-white border-none text-[10px]">
                  {sortedOrders.filter((o: any) => o.status === "delivered").length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="cancelled" className="rounded-[1.2rem] h-12 px-6 font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm">
                Bajas
                <Badge className="ml-2 bg-red-500 text-white border-none text-[10px]">
                  {sortedOrders.filter((o: any) => o.status === "cancelled").length}
                </Badge>
              </TabsTrigger>
            </TabsList>
            <div className="hidden sm:block">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Total: {sortedOrders.length} pedidos
              </p>
            </div>
          </div>

          <TabsContent value="route" className="space-y-6">
            {selectedOrderIds.length > 0 && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between shadow-sm animate-in slide-in-from-top-4">
                <div className="flex items-center gap-3">
                  <Badge className="bg-indigo-600 text-white hover:bg-indigo-700">{selectedOrderIds.length} seleccionados</Badge>
                  <span className="text-sm font-medium text-indigo-900">¿Qué deseas hacer con estos pedidos?</span>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                    onClick={() => setSelectedOrderIds([])}
                  >
                    Cancelar
                  </Button>
                  <Button 
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm"
                    onClick={() => {
                      bulkUpdateMutation.mutate({
                        orderIds: selectedOrderIds,
                        status: "delivered"
                      });
                    }}
                    disabled={bulkUpdateMutation.isPending}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Marcar como Entregados
                  </Button>
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-2 mb-4">
              <Checkbox 
                id="selectAll" 
                checked={paginatedRouteOrders.length > 0 && selectedOrderIds.length === paginatedRouteOrders.length}
                onCheckedChange={selectAllRouteOrders}
              />
              <label htmlFor="selectAll" className="text-sm font-medium cursor-pointer text-slate-600">
                Seleccionar todos en esta página
              </label>
            </div>

            <OrderGrid orders={paginatedRouteOrders} user={user} openWhatsApp={openWhatsApp} setRescheduleOrderId={setRescheduleOrderId} setRescheduleData={setRescheduleData} setDeliverOrderId={setDeliverOrderId} setCancellationRequestOrderId={setCancellationRequestOrderId} setDismissOrderId={setDismissOrderId} selectedOrderIds={selectedOrderIds} toggleSelection={toggleSelection} />
            {totalRoutePages > 1 && (
              <PaginationControls currentPage={currentPage} totalPages={totalRoutePages} onPageChange={setCurrentPage} />
            )}
          </TabsContent>

          <TabsContent value="delivered" className="space-y-6">
            <OrderGrid orders={paginatedDeliveredOrders} user={user} openWhatsApp={openWhatsApp} setRescheduleOrderId={setRescheduleOrderId} setRescheduleData={setRescheduleData} setDeliverOrderId={setDeliverOrderId} setCancellationRequestOrderId={setCancellationRequestOrderId} setDismissOrderId={setDismissOrderId} />
            {totalDeliveredPages > 1 && (
              <PaginationControls currentPage={deliveredPage} totalPages={totalDeliveredPages} onPageChange={setDeliveredPage} />
            )}
          </TabsContent>

          <TabsContent value="cancelled" className="space-y-6">
            <OrderGrid orders={paginatedCancelledOrders} user={user} openWhatsApp={openWhatsApp} setRescheduleOrderId={setRescheduleOrderId} setRescheduleData={setRescheduleData} setDeliverOrderId={setDeliverOrderId} setCancellationRequestOrderId={setCancellationRequestOrderId} setDismissOrderId={setDismissOrderId} />
            {totalCancelledPages > 1 && (
              <PaginationControls currentPage={cancelledPage} totalPages={totalCancelledPages} onPageChange={setCancelledPage} />
            )}
          </TabsContent>
        </Tabs>

        {/* Diálogo: solicitar baja (repartidor) */}
        <Dialog open={cancellationRequestOrderId !== null} onOpenChange={(open) => !open && setCancellationRequestOrderId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Solicitar baja / entrega cancelada</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Esto enviará una solicitud al administrador para dar de baja el pedido.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo</label>
                <Textarea
                  placeholder="Ej: Cliente no responde, dirección incorrecta, cliente canceló, etc."
                  value={cancellationRequestReason}
                  onChange={(e) => setCancellationRequestReason(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancellationRequestOrderId(null)}>Cancelar</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!cancellationRequestOrderId) return;
                  requestCancellationMutation.mutate({
                    orderId: cancellationRequestOrderId,
                    reason: cancellationRequestReason,
                  });
                }}
                disabled={requestCancellationMutation.isPending || cancellationRequestReason.trim().length < 3}
              >
                Enviar solicitud
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diálogo: productos entregados */}
        <Dialog open={viewDeliveredOrderId !== null} onOpenChange={(open) => !open && setViewDeliveredOrderId(null)}>
          <DialogContent className="sm:max-w-[650px]">
            <DialogHeader>
              <DialogTitle>Detalle de Entrega</DialogTitle>
            </DialogHeader>

            {isLoadingDeliveredOrderDetails || !deliveredOrderDetails ? (
              <div className="space-y-3 py-2">
                <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
                <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
                <div className="h-28 bg-muted animate-pulse rounded" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border bg-slate-50/50 p-3 text-sm">
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <span className="font-semibold">Pedido:</span>
                    <span>{deliveredOrderDetails.order.orderNumber}</span>
                    <span className="font-semibold">Zona:</span>
                    <span>{deliveredOrderDetails.order.zone}</span>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Producto</th>
                        <th className="text-right px-3 py-2 font-semibold w-24">Cantidad</th>
                        <th className="text-right px-3 py-2 font-semibold w-28">Precio</th>
                        <th className="text-right px-3 py-2 font-semibold w-28">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(deliveredOrderDetails.items || []).map((item: any) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2">{item.productName || `Producto #${item.productId}`}</td>
                          <td className="px-3 py-2 text-right font-mono">{item.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.price)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency((item.price || 0) * (item.quantity || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50/50 border-t">
                      <tr>
                        <td className="px-3 py-2 font-bold" colSpan={3}>Total</td>
                        <td className="px-3 py-2 text-right font-black">{formatCurrency(deliveredOrderDetails.order.totalPrice)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setViewDeliveredOrderId(null)}>Cerrar</Button>
              {viewDeliveredOrderId ? (
                <Link href={`/order/${viewDeliveredOrderId}`}>
                  <Button className="gap-2">
                    <Eye className="h-4 w-4" />
                    Ver completo
                  </Button>
                </Link>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diálogo: entregar pedido (repartidor) */}
        <Dialog open={deliverOrderId !== null} onOpenChange={(open) => !open && setDeliverOrderId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Entregar Pedido</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Selecciona el método de pago con el que el cliente canceló el pedido para registrar la entrega y actualizar el inventario.
              </p>
              
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setDeliverPaymentMethod("cash")}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                    deliverPaymentMethod === "cash"
                      ? "border-emerald-500 bg-emerald-100 shadow-md"
                      : "border-slate-200 bg-white hover:border-emerald-300"
                  }`}
                >
                  <DollarSign className={`h-6 w-6 ${deliverPaymentMethod === "cash" ? "text-emerald-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-bold ${deliverPaymentMethod === "cash" ? "text-emerald-700" : "text-slate-600"}`}>Efectivo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeliverPaymentMethod("qr")}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                    deliverPaymentMethod === "qr"
                      ? "border-blue-500 bg-blue-100 shadow-md"
                      : "border-slate-200 bg-white hover:border-blue-300"
                  }`}
                >
                  <span className={`font-bold ${deliverPaymentMethod === "qr" ? "text-blue-600" : "text-slate-400"}`}>QR</span>
                  <span className={`text-sm font-bold ${deliverPaymentMethod === "qr" ? "text-blue-700" : "text-slate-600"}`}>QR</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeliverPaymentMethod("transfer")}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                    deliverPaymentMethod === "transfer"
                      ? "border-purple-500 bg-purple-100 shadow-md"
                      : "border-slate-200 bg-white hover:border-purple-300"
                  }`}
                >
                  <Building2 className={`h-6 w-6 ${deliverPaymentMethod === "transfer" ? "text-purple-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-bold ${deliverPaymentMethod === "transfer" ? "text-purple-700" : "text-slate-600"}`}>Transferencia</span>
                </button>
              </div>

              {!openingStatus?.hasActive && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold mt-2">
                  TU CAJA DE {deliverPaymentMethod === 'cash' ? 'EFECTIVO' : deliverPaymentMethod.toUpperCase()} ESTÁ CERRADA. ABRE TU CAJA ANTES DE COBRAR.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeliverOrderId(null)}>Cancelar</Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => {
                  const order = orders?.find((o: any) => o.id === deliverOrderId);
                  if (!order || !openingStatus?.hasActive) return;
                  recordPaymentMutation.mutate({
                    orderId: order.id,
                    amount: order.totalPrice,
                    method: deliverPaymentMethod,
                  });
                }}
                disabled={recordPaymentMutation.isPending || !openingStatus?.hasActive}
              >
                {recordPaymentMutation.isPending ? "Procesando..." : "Confirmar Entrega"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diálogo: hoja de reparto (admin) */}
        <Dialog open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <DialogContent className="sm:max-w-[980px]">
            <DialogHeader>
              <DialogTitle>Hoja de reparto del día</DialogTitle>
            </DialogHeader>

            {sheetDeliveryPersonId === null ? (
              <div className="py-4 text-sm text-muted-foreground">Selecciona un repartidor para ver la hoja.</div>
            ) : isLoadingSheet || !deliverySheet ? (
              <div className="py-4 text-sm text-muted-foreground">Cargando hoja...</div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border bg-slate-50/60 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span><strong>Fecha:</strong> {deliverySheet.date}</span>
                      <span><strong>Repartidor:</strong> {deliverySheet.deliveryPersonName || `#${deliverySheet.deliveryPersonId}`}</span>
                      <span><strong>Pedidos:</strong> {deliverySheet.entries.length}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => printSheet()}>
                        Imprimir
                      </Button>
                      <Button type="button" variant="outline" onClick={() => exportSheetCsv()}>
                        Exportar CSV
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold w-12">N°</th>
                        <th className="text-left px-3 py-2 font-semibold w-28">Pedido</th>
                        <th className="text-left px-3 py-2 font-semibold">Cliente</th>
                        <th className="text-left px-3 py-2 font-semibold w-28">Tel</th>
                        <th className="text-left px-3 py-2 font-semibold w-20">Hora</th>
                        <th className="text-left px-3 py-2 font-semibold w-40">Zona</th>
                        <th className="text-left px-3 py-2 font-semibold">Productos</th>
                        <th className="text-right px-3 py-2 font-semibold w-16">Cant.</th>
                        <th className="text-left px-3 py-2 font-semibold w-28">Pago</th>
                        <th className="text-left px-3 py-2 font-semibold w-28">Nuevo</th>
                        <th className="text-right px-3 py-2 font-semibold w-28">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {deliverySheet.entries.map((row: any, idx: number) => {
                        const order = row.order;
                        const customer = row.customer;
                        const tel = customer?.phone || customer?.whatsapp || "—";
                        const totalProducts = (row.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
                        const products = (row.items || []).map((item: any) => `${item.productName || `Producto #${item.productId}`} x${item.quantity}`).join(", ");

                        return (
                          <tr key={order.id}>
                            <td className="px-3 py-2">{idx + 1}</td>
                            <td className="px-3 py-2 font-mono">{order.orderNumber}</td>
                            <td className="px-3 py-2">{customer?.name || "—"}</td>
                            <td className="px-3 py-2 font-mono">{tel}</td>
                            <td className="px-3 py-2 font-mono">{order.deliveryTime || "—"}</td>
                            <td className="px-3 py-2">{order.zone || "—"}</td>
                            <td className="px-3 py-2">{products || "—"}</td>
                            <td className="px-3 py-2 text-right font-mono">{totalProducts}</td>
                            <td className="px-3 py-2">{paymentMethodLabel(order.paymentMethod)}</td>
                            <td className="px-3 py-2">
                              {row.cohort === "new" ? (
                                <Badge variant="default">Nuevo</Badge>
                              ) : (
                                <Badge variant="outline">Recompra</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(order.totalPrice)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50/60 border-t">
                      <tr>
                        <td className="px-3 py-2 font-bold" colSpan={7}>Totales</td>
                        <td className="px-3 py-2 text-right font-bold font-mono">{deliverySheet.totals?.totalProducts || 0}</td>
                        <td className="px-3 py-2" colSpan={2}>
                          <span className="text-xs text-muted-foreground">
                            Nuevos: {deliverySheet.totals?.newCustomers || 0} · Recompra: {deliverySheet.totals?.repeatCustomers || 0}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-black font-mono">{formatCurrency(deliverySheet.totals?.totalBs || 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="grid gap-3 md:grid-cols-3 text-sm">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Efectivo</p>
                      <p className="font-semibold">{formatCurrency(deliverySheet.totals?.cashBs || 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">QR</p>
                      <p className="font-semibold">{formatCurrency(deliverySheet.totals?.qrBs || 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Transferencia</p>
                      <p className="font-semibold">{formatCurrency(deliverySheet.totals?.transferBs || 0)}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSheetOpen(false)}>Cerrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diálogo de Baja */}
        <Dialog open={dismissOrderId !== null} onOpenChange={(open) => !open && setDismissOrderId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dar de baja pedido</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                ⚠️ Los productos de este pedido volverán al inventario automáticamente.
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">¿Quién cancela?</label>
                <div className="flex gap-2">
                  {(["client", "company", "system"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCancelData(prev => ({ ...prev, cancelledBy: opt })); }}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer ${
                        cancelData.cancelledBy === opt
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                      }`}
                    >
                      {opt === "client" ? "Cliente" : opt === "company" ? "Empresa" : "Sistema"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Motivo de la baja <span className="text-red-500">*</span>
                </label>
                <Textarea 
                  placeholder="Escribe el motivo aquí (obligatorio)..."
                  value={cancelData.reason}
                  onChange={(e) => setCancelData(prev => ({ ...prev, reason: e.target.value }))}
                  className={!cancelData.reason ? "border-red-200 focus-visible:ring-red-300" : ""}
                />
                {!cancelData.reason && (
                  <p className="text-xs text-red-500">Debes escribir el motivo para confirmar la baja.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDismissOrderId(null); setCancelData({ cancelledBy: "client", reason: "" }); }}>Cancelar</Button>
              <Button
                variant="destructive"
                disabled={dismissMutation.isPending || !cancelData.reason.trim()}
                onClick={() => dismissOrderId && dismissMutation.mutate({ orderId: dismissOrderId, ...cancelData })}
              >
                {dismissMutation.isPending ? "Procesando..." : "Confirmar Baja"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* Diálogo de Reprogramación */}
        <Dialog open={rescheduleOrderId !== null} onOpenChange={(open) => !open && setRescheduleOrderId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reprogramar pedido</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {rescheduleOrderId && sortedOrders.find((o: any) => o.id === rescheduleOrderId)?.rescheduleRequested === 1 && (
                <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 mb-2">
                  <p className="text-xs font-bold text-orange-800 uppercase mb-1">Solicitud del Repartidor:</p>
                  <p className="text-sm text-orange-700 italic">"{sortedOrders.find((o: any) => o.id === rescheduleOrderId)?.rescheduleReason}"</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nueva Fecha</label>
                  <Input type="date" value={rescheduleData.date} onChange={(e) => setRescheduleData({ ...rescheduleData, date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nueva Hora</label>
                  <Input type="time" value={rescheduleData.time} onChange={(e) => setRescheduleData({ ...rescheduleData, time: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo de reprogramación</label>
                <Textarea 
                  placeholder="Escribe por qué se reprograma..."
                  value={rescheduleData.reason}
                  onChange={(e) => setRescheduleData({ ...rescheduleData, reason: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="flex justify-between sm:justify-between w-full">
              <div>
                {rescheduleOrderId && sortedOrders.find((o: any) => o.id === rescheduleOrderId)?.rescheduleRequested === 1 && (
                  <Button 
                    variant="ghost" 
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 p-0 h-auto font-bold"
                    onClick={() => rescheduleOrderId && rejectRescheduleMutation.mutate({ orderId: rescheduleOrderId })}
                    disabled={rejectRescheduleMutation.isPending}
                  >
                    Rechazar Solicitud
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setRescheduleOrderId(null)}>Cancelar</Button>
                <Button 
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={() => {
                    if (!rescheduleOrderId) return;
                    const data = {
                      orderId: rescheduleOrderId,
                      reason: rescheduleData.reason,
                      newDate: rescheduleData.date,
                      newTime: rescheduleData.time
                    };
                    if (user?.role === "admin") {
                      rescheduleMutation.mutate(data);
                    } else {
                      requestRescheduleMutation.mutate(data);
                    }
                  }}
                  disabled={rescheduleMutation.isPending || requestRescheduleMutation.isPending || !rescheduleData.reason}
                >
                  {user?.role === "admin" ? "Aprobar y Guardar" : "Solicitar Reprogramación"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
function OrderGrid({ orders, user, openWhatsApp, setRescheduleOrderId, setRescheduleData, setDeliverOrderId, setCancellationRequestOrderId, setDismissOrderId, selectedOrderIds = [], toggleSelection = () => {} }: any) {
  if (orders.length === 0) {
    return (
      <div className="bg-white/40 rounded-3xl p-12 text-center border-2 border-dashed border-slate-200">
        <Package className="h-12 w-12 text-slate-200 mx-auto mb-4" />
        <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">No hay pedidos en esta categoría</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {orders.map((order: any) => (
        <Card key={order.id} className="border-2 border-transparent hover:border-blue-500 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_50px_rgb(0,0,0,0.08)] transition-all duration-300 rounded-[2.5rem] overflow-hidden bg-white group">
          <CardContent className="p-0">
            <div className="p-6 md:p-8 flex flex-col gap-6 relative">
              <div className="absolute top-6 left-6 z-10">
                <Checkbox 
                  checked={selectedOrderIds.includes(order.id)} 
                  onCheckedChange={() => toggleSelection(order.id)}
                  className="h-5 w-5 rounded data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                />
              </div>
              <div className="flex items-start justify-between pl-8">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">#{order.orderNumber}</h3>
                    <StatusBadge status={order.status} />
                  </div>
                  <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">{order.zone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Total</p>
                  <p className="text-2xl font-black text-emerald-600 tracking-tighter">{formatCurrency(order.totalPrice)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-3xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Entrega</p>
                  <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                     <CalendarIcon className="h-3.5 w-3.5 text-slate-400" />
                     {order.deliveryDate}
                  </div>
                  {order.deliveryTime && (
                     <p className="text-xs text-slate-500 font-medium mt-0.5 ml-5">{order.deliveryTime}</p>
                  )}
                </div>
                <div className="p-4 rounded-3xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Repartidor</p>
                  <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                     <MapPin className="h-3.5 w-3.5 text-slate-400" />
                     <span className="truncate">{order.deliveryPersonName || "Sin asignar"}</span>
                  </div>
                </div>
              </div>

              {(order.rescheduleRequested === 1 || order.cancellationRequested === 1) && (
                <div className="flex flex-col gap-2">
                  {order.rescheduleRequested === 1 && (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-50 text-orange-700 border border-orange-100">
                      <CalendarIcon className="h-4 w-4 animate-pulse" />
                      <span className="text-xs font-black uppercase">Reprogramación Solicitada</span>
                    </div>
                  )}
                  {order.cancellationRequested === 1 && (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-700 border border-red-100">
                      <Trash2 className="h-4 w-4 animate-pulse" />
                      <span className="text-xs font-black uppercase">Baja Solicitada</span>
                    </div>
                  )}
                </div>
              )}

              {order.notes && (
                <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-100/50">
                  <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Observaciones</p>
                  <p className="text-sm text-amber-800 font-medium leading-relaxed italic">"{order.notes}"</p>
                </div>
              )}
            </div>

            <div className="p-4 md:p-5 bg-slate-50/50 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    className="h-10 px-4 rounded-xl bg-white text-emerald-600 hover:bg-emerald-50 border-emerald-200 shadow-sm font-bold gap-2 text-sm"
                    onClick={() => openWhatsApp(order.customerWhatsapp || order.customerPhone || order.customerNumber, order.orderNumber)}
                  >
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </Button>
                  <Link href={`/order/${order.id}`}>
                    <Button
                      className={`h-10 px-4 rounded-xl font-bold gap-2 text-sm ${
                        user?.role === "user" && (order.status === "assigned" || order.status === "in_transit" || order.status === "rescheduled")
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200"
                          : "bg-white text-blue-600 hover:bg-blue-50 border border-blue-200 shadow-sm"
                      }`}
                    >
                      <Eye className="h-4 w-4" />
                      {user?.role === "user" && (order.status === "assigned" || order.status === "in_transit" || order.status === "rescheduled")
                        ? "Ver detalle / Entregar"
                        : "Ver detalle"}
                    </Button>
                  </Link>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {user?.role === "admin" && (
                    <Link href={`/edit-order/${order.id}`}>
                      <Button variant="outline" className="h-10 px-4 rounded-xl border-slate-200 text-slate-700 font-bold hover:bg-white hover:shadow-md transition-all gap-2 text-sm">
                        <Edit className="h-4 w-4" />
                        Editar
                      </Button>
                    </Link>
                  )}

                  {user?.role === "admin" && order.status !== "cancelled" && (
                    <Button 
                      variant={order.rescheduleRequested === 1 ? "default" : "outline"}
                      className={`h-10 px-4 rounded-xl font-bold transition-all gap-2 text-sm ${
                        order.rescheduleRequested === 1 
                          ? 'bg-orange-600 text-white shadow-lg shadow-orange-200 hover:bg-orange-700' 
                          : 'border-orange-200 text-orange-600 hover:bg-orange-50'
                      }`}
                      onClick={() => {
                        setRescheduleOrderId(order.id);
                        if (order.rescheduleRequested === 1) {
                          setRescheduleData({
                            date: order.requestedDate || "",
                            time: order.requestedTime || "",
                            reason: order.rescheduleReason || ""
                          });
                        } else {
                          setRescheduleData({
                            date: order.deliveryDate || "",
                            time: order.deliveryTime || "",
                            reason: order.rescheduleReason || ""
                          });
                        }
                      }}
                    >
                      <CalendarIcon className="h-4 w-4" />
                      {order.rescheduleRequested === 1 ? "Revisar" : "Reprogramar"}
                    </Button>
                  )}



                  {user?.role === "user" && order.status !== "cancelled" && order.status !== "delivered" && order.cancellationRequested !== 1 && (
                    <Button
                      variant="outline"
                      className="h-10 px-4 rounded-xl border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 font-bold gap-2 text-sm"
                      onClick={() => setCancellationRequestOrderId(order.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Dar de Baja
                    </Button>
                  )}
                  
                  {user?.role === "admin" && order.status !== "cancelled" && (
                    <Button 
                      variant="outline"
                      className="h-10 px-4 rounded-xl border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 font-bold gap-2 text-sm"
                      onClick={() => setDismissOrderId(order.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-100 text-yellow-800";
      case "assigned": return "bg-blue-100 text-blue-800";
      case "in_transit": return "bg-purple-100 text-purple-800";
      case "delivered": return "bg-green-100 text-green-800";
      case "cancelled": return "bg-red-100 text-red-800";
      case "rescheduled": return "bg-orange-100 text-orange-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: "Pendiente", assigned: "Asignado", in_transit: "En tránsito",
      delivered: "Entregado", cancelled: "Cancelado", rescheduled: "Reprogramado",
    };
    return labels[status] || status;
  };

  return (
    <Badge className={`${getStatusColor(status)} px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border-none shadow-sm`}>
      {getStatusLabel(status)}
    </Badge>
  );
}

function PaginationControls({ currentPage, totalPages, onPageChange }: { currentPage: number; totalPages: number; onPageChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <Button
        variant="outline"
        size="sm"
        className="h-10 w-10 p-0 rounded-full"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-1">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <Button
            key={page}
            variant={page === currentPage ? "default" : "outline"}
            size="sm"
            className={`h-10 w-10 p-0 rounded-full font-bold ${page === currentPage ? "bg-slate-900" : "text-slate-500"}`}
            onClick={() => onPageChange(page)}
          >
            {page}
          </Button>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-10 w-10 p-0 rounded-full"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
