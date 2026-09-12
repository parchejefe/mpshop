import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { Package, Printer, Download, Search, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type LoadEntry = {
  order: any;
  items: any[];
  customer?: any | null;
};

function paymentMethodLabel(method?: string | null) {
  if (method === "cash") return "Efectivo";
  if (method === "qr") return "QR";
  if (method === "transfer") return "Transferencia";
  return "-";
}

export default function DeliveryLoad() {
  const getLocalDateInputValue = () => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - offsetMs).toISOString().split("T")[0];
  };

  const today = getLocalDateInputValue();
  const [date, setDate] = useState<string>(today);
  const [status, setStatus] = useState<"all" | "assigned" | "in_transit" | "rescheduled">("all");
  const [search, setSearch] = useState<string>("");

  const { data, isLoading } = trpc.orders.getMyLoad.useQuery({ date, status });
  const { data: extraLoad, refetch: refetchExtraLoad } = trpc.orders.getMyExtraLoad.useQuery({ date });
  const entries = (data as LoadEntry[]) || [];

  const updateExtraStatusMutation = trpc.orders.updateExtraLoadStatus.useMutation({
    onSuccess: () => {
      toast.success("Estado de carga extra actualizado");
      refetchExtraLoad();
    },
    onError: (err) => toast.error(err.message),
  });

  const storageKey = `deliveryLoadChecks:${date}`;
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setChecked(raw ? JSON.parse(raw) : {});
    } catch {
      setChecked({});
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(checked));
    } catch {
      // ignore
    }
  }, [checked, storageKey]);

  const filteredEntries = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return entries;

    return entries.filter((entry) => {
      const orderText = `${entry.order?.orderNumber || ""} ${entry.order?.zone || ""} ${entry.customer?.name || ""} ${entry.customer?.phone || ""} ${entry.customer?.whatsapp || ""}`.toLowerCase();
      const itemText = (entry.items || []).map((item: any) => `${item.productName || ""} ${item.productId || ""}`).join(" ").toLowerCase();
      return orderText.includes(normalized) || itemText.includes(normalized);
    });
  }, [entries, search]);

  const summary = useMemo(() => {
    const map = new Map<number, { productId: number; productName: string; quantity: number; orders: Set<string> }>();

    for (const entry of filteredEntries) {
      for (const item of entry.items || []) {
        const productId = Number(item.productId);
        const productName = item.productName || `Producto #${productId}`;
        const prev = map.get(productId) || { productId, productName, quantity: 0, orders: new Set<string>() };
        prev.quantity += Number(item.quantity || 0);
        prev.orders.add(entry.order?.orderNumber || String(entry.order?.id || ""));
        map.set(productId, prev);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  }, [filteredEntries]);

  const totals = useMemo(() => {
    return {
      orders: filteredEntries.length,
      totalBs: filteredEntries.reduce((sum, entry) => sum + Number(entry.order?.totalPrice || 0), 0),
      totalUnits: filteredEntries.reduce((sum, entry) => sum + (entry.items || []).reduce((acc: number, item: any) => acc + Number(item.quantity || 0), 0), 0),
      checkedItems: Object.values(checked).filter(Boolean).length,
    };
  }, [filteredEntries, checked]);

  const toggleItem = (key: string, value: boolean) => {
    setChecked((prev) => ({ ...prev, [key]: value }));
  };

  const setOrderAll = (orderId: number, value: boolean, items: any[]) => {
    setChecked((prev) => {
      const next = { ...prev };
      for (const item of items || []) {
        const itemKey = `${orderId}:${item.id ?? item.productId}`;
        next[itemKey] = value;
      }
      return next;
    });
  };

  const exportCsv = () => {
    const lines: string[] = [];
    const sep = ";";
    const q = (value: any) => `"${String(value ?? "").replaceAll('"', '""')}"`;

    lines.push(["Pedido", "Hora", "Zona", "Cliente", "Tel", "Pago", "Total Bs", "Productos"].map(q).join(sep));

    filteredEntries.forEach((entry) => {
      const order = entry.order;
      const customer = entry.customer;
      const tel = customer?.phone || customer?.whatsapp || customer?.clientNumber || "";
      const products = (entry.items || [])
        .map((item: any) => `${item.productName || `Producto #${item.productId}`} x${item.quantity}`)
        .join(" | ");

      lines.push(
        [
          order.orderNumber || order.id,
          order.deliveryTime || "",
          order.zone || "",
          customer?.name || "",
          tel,
          paymentMethodLabel(order.paymentMethod),
          ((order.totalPrice || 0) / 100).toFixed(2),
          products,
        ].map(q).join(sep)
      );
    });

    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mi-carga-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    const escapeHtml = (value: any) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

    const rows = filteredEntries
      .map((entry, idx) => {
        const order = entry.order;
        const customer = entry.customer;
        const tel = customer?.phone || customer?.whatsapp || customer?.clientNumber || "";
        const productsHtml = (entry.items || [])
          .map((item: any) => `${escapeHtml(item.productName || `Producto #${item.productId}`)} x${escapeHtml(item.quantity)}`)
          .join("<br/>");

        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(order.orderNumber || order.id)}</td>
            <td>${escapeHtml(order.deliveryTime || "")}</td>
            <td>${escapeHtml(order.zone || "")}</td>
            <td>${escapeHtml(customer?.name || "")}</td>
            <td>${escapeHtml(tel)}</td>
            <td>${escapeHtml(paymentMethodLabel(order.paymentMethod))}</td>
            <td style="text-align:right">${((order.totalPrice || 0) / 100).toFixed(2)}</td>
            <td>${productsHtml}</td>
          </tr>
        `;
      })
      .join("");

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Mi carga</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 18px; }
            h1 { font-size: 16px; margin: 0 0 6px 0; }
            .meta { font-size: 12px; color: #333; margin-bottom: 10px; display:flex; gap:12px; flex-wrap:wrap; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #222; padding: 6px; vertical-align: top; }
            th { background: #f2f2f2; text-align: left; }
            @page { size: landscape; margin: 10mm; }
          </style>
        </head>
        <body>
          <h1>Mi carga (repartidor)</h1>
          <div class="meta">
            <div><strong>Fecha:</strong> ${escapeHtml(date)}</div>
            <div><strong>Pedidos:</strong> ${escapeHtml(totals.orders)}</div>
            <div><strong>Unidades:</strong> ${escapeHtml(totals.totalUnits)}</div>
            <div><strong>Total Bs:</strong> ${escapeHtml((totals.totalBs / 100).toFixed(2))}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:36px">N</th>
                <th style="width:90px">Pedido</th>
                <th style="width:60px">Hora</th>
                <th style="width:120px">Zona</th>
                <th style="width:160px">Cliente</th>
                <th style="width:100px">Tel</th>
                <th style="width:90px">Pago</th>
                <th style="width:90px; text-align:right">Total Bs</th>
                <th>Productos</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
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

  const { data: user } = trpc.auth.me.useQuery();
  const { data: closureStatus } = trpc.finance.hasPendingClosure.useQuery();
  const isLocked = user?.role === "user" && closureStatus?.hasPending;

  if (isLocked) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
        <Card className="border-t-4 border-t-blue-500 shadow-xl">
          <CardHeader className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Package className="w-8 h-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Aplicación Inhabilitada</CardTitle>
            <CardDescription className="text-slate-500 font-medium text-base">
              Para poder utilizar la aplicación, solicite la habilitación en administración.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-6">
            <p className="text-sm text-slate-500 mb-6">
              Una vez el administrador apruebe tu cierre, podrás volver a ver tus pedidos asignados.
            </p>
            <Link href="/repartidor/finance">
              <Button variant="outline" className="w-full">
                Ir a Cierre de Caja
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" /> Mi carga
          </h1>
          <p className="text-sm text-muted-foreground">Control por dia (fecha/estado), busqueda y checklist.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => print()} disabled={isLoading}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => exportCsv()} disabled={isLoading}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
          <Badge variant="outline" className="bg-slate-50 border-slate-200">
            {totals.orders} pedido{totals.orders === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">Fecha</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Estado</label>
          <Select value={status} onValueChange={(val) => setStatus(val as any)}>
            <SelectTrigger>
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="assigned">Asignado</SelectItem>
              <SelectItem value="in_transit">En reparto</SelectItem>
              <SelectItem value="rescheduled">Reprogramado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Buscar</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" placeholder="Pedido, cliente o producto" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Pedidos</p>
            <p className="text-2xl font-bold">{totals.orders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Unidades</p>
            <p className="text-2xl font-bold">{totals.totalUnits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{formatCurrency(totals.totalBs)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Checklist</p>
            <p className="text-2xl font-bold">{totals.checkedItems}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">Cargando...</CardContent>
        </Card>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground italic">
            No tienes pedidos activos para preparar en esta fecha/filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumen por producto</CardTitle>
              <CardDescription>Total de unidades a entregar (segun filtros).</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {summary.map((row) => (
                  <div key={row.productId} className="px-4 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{row.productName}</p>
                      <p className="text-[10px] text-muted-foreground">{row.orders.size} pedido(s)</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-lg">{row.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detalle por pedido</CardTitle>
                <CardDescription>Checklist de carga por pedido.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {filteredEntries.map((entry) => {
                    const order = entry.order;
                    const customer = entry.customer;
                    const tel = customer?.phone || customer?.whatsapp || customer?.clientNumber || null;
                    const totalItems = (entry.items || []).length;
                    const checkedItems = (entry.items || []).filter((item: any) => checked[`${order.id}:${item.id ?? item.productId}`]).length;

                    return (
                      <div key={order.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">Pedido #{order.orderNumber}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {order.deliveryDate ? `Fecha: ${order.deliveryDate}` : ""}{order.deliveryTime ? ` | Hora: ${order.deliveryTime}` : ""} | Zona: {order.zone || "-"}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              Cliente: {customer?.name || "-"}{tel ? ` | ${tel}` : ""} | Pago: {paymentMethodLabel(order.paymentMethod)} | Total: {formatCurrency(order.totalPrice)}
                            </p>
                            {tel && (
                              <div className="flex gap-2 mt-1">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-7 px-2 text-[10px] font-bold text-emerald-600 border-emerald-200 hover:bg-emerald-50 gap-1"
                                  onClick={() => {
                                     const cleaned = String(tel || "").replace(/\D/g, "");
                                     let formatted = cleaned;
                                     if (cleaned.length === 8) formatted = "591" + cleaned;
                                     else if (cleaned.startsWith("0") && cleaned.length === 9) formatted = "591" + cleaned.slice(1);
                                     else if (cleaned.length > 8 && !cleaned.startsWith("591")) formatted = "591" + cleaned;
                                     window.open(`https://wa.me/+${formatted}?text=Hola!%20Te%20contactamos%20de%20MP%20Shop%20sobre%20tu%20pedido%20%23${order.orderNumber}`, "_blank");
                                  }}
                                >
                                  <MessageCircle className="h-3 w-3" />
                                  WhatsApp
                                </Button>
                              </div>
                            )}
                            {order.notes && (
                              <p className="text-[10px] text-amber-600 font-medium truncate mt-0.5">
                                Nota: {order.notes}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline">{order.status}</Badge>
                            <Badge variant="secondary">{checkedItems}/{totalItems}</Badge>
                          </div>
                        </div>

                        <div className="mt-3 rounded-lg border bg-white">
                          <div className="divide-y">
                            <div className="px-3 py-2 flex items-center justify-between gap-2 bg-slate-50/40">
                              <Button type="button" size="sm" variant="outline" onClick={() => setOrderAll(order.id, true, entry.items)}>
                                Marcar todo
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => setOrderAll(order.id, false, entry.items)}>
                                Limpiar
                              </Button>
                            </div>
                            {(entry.items || []).map((item: any) => {
                              const key = `${order.id}:${item.id ?? item.productId}`;
                              const isChecked = !!checked[key];
                              return (
                                <div key={key} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <Checkbox checked={isChecked} onCheckedChange={(val) => toggleItem(key, val === true)} />
                                    <span className={`truncate ${isChecked ? "line-through text-muted-foreground" : ""}`}>
                                      {item.productName || `Producto #${item.productId}`}
                                    </span>
                                  </div>
                                  <span className="font-mono font-bold">{item.quantity}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Carga Extra */}
            {extraLoad && extraLoad.length > 0 && (
              <Card className="border-emerald-100 bg-emerald-50/20">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-5 w-5 text-emerald-600" />
                    Carga Extra / Muestras
                  </CardTitle>
                  <CardDescription>Productos adicionales asignados para venta libre o degustación.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y border-t border-emerald-100">
                    {extraLoad.map((item: any) => (
                      <div key={item.id} className="px-4 py-4 flex flex-col gap-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-bold text-slate-900">{item.productName}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge variant="secondary" className="text-[10px] font-black uppercase">
                                {item.type === 'sale' ? 'Para Venta' : 'Muestra/Degustación'}
                              </Badge>
                              <Badge variant="outline" className="text-[10px] font-black uppercase">
                                Cant: {item.quantity}
                              </Badge>
                            </div>
                          </div>
                          <Badge className={
                            item.status === 'loaded' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' :
                            item.status === 'returned' ? 'bg-slate-100 text-slate-700' :
                            'bg-emerald-100 text-emerald-700'
                          }>
                            {item.status === 'loaded' ? 'En Camión' : 
                             item.status === 'sold' ? 'Vendido' : 
                             item.status === 'used' ? 'Entregado' : 'Devuelto'}
                          </Badge>
                        </div>
                        
                        {item.status === 'loaded' && (
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-10 rounded-xl"
                              onClick={() => updateExtraStatusMutation.mutate({ id: item.id, status: item.type === 'sale' ? 'sold' : 'used' })}
                            >
                              {item.type === 'sale' ? 'Marcar como Vendido' : 'Marcar como Entregado'}
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="flex-1 border-slate-200 h-10 rounded-xl"
                              onClick={() => updateExtraStatusMutation.mutate({ id: item.id, status: 'returned' })}
                            >
                              Devolver
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
