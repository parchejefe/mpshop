import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRoute, useLocation, Link } from "wouter";
import { MessageCircle, MapPin, DollarSign, Receipt, Banknote, QrCode, Building2, AlertCircle, Calendar, Trash2, Edit } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function OrderDetail() {
  const { user } = useAuth();
  const [, params] = useRoute("/order/:orderId");
  const [, setLocation] = useLocation();
  const orderId = params?.orderId ? parseInt(params.orderId) : null;
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qr" | "transfer">("cash");

  // Estado para diálogo de baja (admin)
  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const [cancelData, setCancelData] = useState<{ cancelledBy: "client" | "company" | "system"; reason: string }>({
    cancelledBy: "client",
    reason: "",
  });

  // Estado para diálogo de solicitud de baja (repartidor)
  const [showCancellationRequestDialog, setShowCancellationRequestDialog] = useState(false);
  const [cancellationRequestReason, setCancellationRequestReason] = useState("");

  const { data: orderDetails, isLoading } = trpc.orders.getDetails.useQuery(
    { orderId: orderId || 0 },
    { enabled: !!orderId }
  );
  const { data: companyConfig } = trpc.settings.getCompanyConfig.useQuery();

  const utils = trpc.useUtils();
  const recordPaymentMutation = trpc.orders.recordPayment.useMutation();
  const updateStatusMutation = trpc.orders.updateStatus.useMutation();
  const { data: openingStatus } = trpc.finance.hasActiveOpening.useQuery({ paymentMethod });

  // Mutación: dar de baja definitiva (Admin) — restaura inventario automáticamente
  const dismissMutation = trpc.orders.dismissOrder.useMutation({
    onSuccess: () => {
      toast.success("Pedido dado de baja. El inventario ha sido restaurado.");
      setShowDismissDialog(false);
      setCancelData({ cancelledBy: "client", reason: "" });
      utils.orders.getDetails.invalidate({ orderId: orderId! });
      utils.orders.list.invalidate();
      utils.orders.listForDelivery.invalidate();
      utils.units.list.invalidate();
      setLocation("/orders");
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  // Mutación: solicitar baja (Repartidor) — el admin debe aprobar
  const requestCancellationMutation = trpc.orders.requestCancellation.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de baja enviada al administrador.");
      setShowCancellationRequestDialog(false);
      setCancellationRequestReason("");
      utils.orders.getDetails.invalidate({ orderId: orderId! });
      utils.orders.listForDelivery.invalidate();
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  if (!orderId || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Cargando detalles del pedido...</p>
      </div>
    );
  }

  if (!orderDetails) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600">Pedido no encontrado</p>
      </div>
    );
  }

  const { order, items, customer } = orderDetails;

  const cleanPhone = (phone: string | null | undefined) => {
    if (!phone) return "";
    const cleaned = String(phone || "").replace(/\D/g, "");
    if (cleaned.length === 8) return "591" + cleaned;
    if (cleaned.startsWith("0") && cleaned.length === 9) return "591" + cleaned.slice(1);
    if (cleaned.length > 8 && !cleaned.startsWith("591")) return "591" + cleaned;
    return cleaned;
  };

  const handleMarkAsDelivered = () => {
    if (user?.role === "user") {
      updateStatusMutation.mutate({
        orderId: order.id,
        status: "delivered",
      });
    }
  };

  const handleRecordPayment = () => {
    if (!openingStatus?.hasActive) {
      toast.error(`Abre la caja: La caja de ${paymentMethod === 'cash' ? 'Efectivo' : paymentMethod.toUpperCase()} se encuentra cerrada. Primero debes realizar la apertura de caja.`);
      return;
    }
    recordPaymentMutation.mutate({
      orderId: order.id,
      amount: order.totalPrice,
      method: paymentMethod,
    }, {
      onSuccess: () => {
        toast.success(`Pago registrado correctamente (${paymentMethod === "cash" ? "Efectivo" : paymentMethod === "qr" ? "QR" : "Transferencia"})`);
        setShowPaymentForm(false);
        // Invalidar todas las consultas relacionadas para refrescar datos
        utils.orders.getDetails.invalidate({ orderId: order.id });
        utils.orders.list.invalidate();
        utils.orders.listForDelivery.invalidate();
        utils.finance.getExpectedDaily.invalidate();
        utils.finance.getMyStatus.invalidate();
        utils.units.list.invalidate();
        utils.finance.getTransactions.invalidate();
      },
      onError: (err: any) => toast.error(err.message || "Error al registrar pago"),
    });
  };

  return (
    <div className="min-h-full bg-background p-4 md:p-6 pb-20 md:pb-6">
      <div className="max-w-4xl mx-auto">
        {/* Botón de Impresión */}
        <div className="mb-6 flex justify-end no-print">
          <Button 
            variant="outline" 
            className="gap-2 border-primary text-primary hover:bg-primary/5"
            onClick={() => window.print()}
          >
            <Receipt className="h-4 w-4" />
            Generar Recibo / PDF
          </Button>
          {user?.role === "admin" && (
            <Link href={`/edit-order/${orderId}`}>
              <Button variant="default" className="gap-2 bg-slate-900 shadow-lg">
                <Edit className="h-4 w-4" />
                Editar Pedido
              </Button>
            </Link>
          )}
        </div>

        {/* Estilos para impresión */}
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            body * { visibility: hidden; }
            .print-receipt, .print-receipt * { visibility: visible; }
            .print-receipt { 
              position: absolute; 
              left: 0; 
              top: 0; 
              width: 100%; 
              padding: 20px;
              color: black !important;
              background: white !important;
            }
            .no-print { display: none !important; }
          }
        `}} />

        {/* Vista de Recibo para Impresión */}
        <div className="hidden print-receipt p-8 border-2 border-gray-100 rounded-xl bg-white text-black">
          <div className="flex justify-between items-start mb-8 border-b pb-6">
            <div className="flex items-center gap-4">
              {companyConfig?.logo ? (
                <img
                  src={companyConfig.logo}
                  alt="Logo"
                  className="h-16 w-auto object-contain"
                />
              ) : null}
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter text-black">
                  {companyConfig?.name || "COMPROBANTE DE ENTREGA"}
                </h2>
                {companyConfig?.subName && (
                  <p className="text-xs text-gray-500 font-semibold">{companyConfig.subName}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">Pedido # {order.orderNumber}</p>
                {companyConfig?.taxId && (
                  <p className="text-xs text-gray-400">NIT / CI: {companyConfig.taxId}</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-sm">{companyConfig?.address || "Casa Central"}</p>
              {companyConfig?.phone && (
                <p className="text-xs text-gray-500">Tel: {companyConfig.phone}</p>
              )}
              {companyConfig?.whatsapp && (
                <p className="text-xs text-green-600 font-semibold">WhatsApp: {companyConfig.whatsapp}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">Fecha: {new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 mb-8 bg-gray-50 p-4 rounded-lg">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Cliente</p>
              <p className="font-bold text-lg">{customer?.name || "Consumidor Final"}</p>
              <p className="text-sm text-gray-600">Zona: {order.zone}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Estado de Pago</p>
              <p className={`font-bold text-lg ${order.paymentStatus === 'completed' ? 'text-green-600' : 'text-orange-600'}`}>
                {order.paymentStatus === 'completed' ? 'PAGADO' : 'PENDIENTE'}
              </p>
              <p className="text-sm text-gray-600">Metodo: {order.paymentMethod || 'Efectivo'}</p>
            </div>
          </div>

          <table className="w-full mb-8">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-2 font-black uppercase text-xs">Descripción</th>
                <th className="text-center py-2 font-black uppercase text-xs">Cant.</th>
                <th className="text-right py-2 font-black uppercase text-xs">Precio</th>
                <th className="text-right py-2 font-black uppercase text-xs">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-3 text-sm">{item.productName || `Producto #${item.productId}`}</td>
                  <td className="py-3 text-center text-sm">{item.quantity}</td>
                  <td className="py-3 text-right text-sm">{formatCurrency(item.price)}</td>
                  <td className="py-3 text-right font-bold text-sm">
                    {formatCurrency(item.price * item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Alertas de solicitud */}
          {order.rescheduleRequested === 1 && (
            <Alert className="mb-6 bg-orange-50 border-orange-200">
              <Calendar className="h-4 w-4 text-orange-600" />
              <AlertTitle className="text-orange-800">Reprogramación Solicitada</AlertTitle>
              <AlertDescription className="text-orange-700">
                El repartidor ha solicitado reprogramar para el {order.requestedDate} {order.requestedTime}.
                Razón: {order.rescheduleReason}
              </AlertDescription>
            </Alert>
          )}

          {order.cancellationRequested === 1 && (
            <Alert className="mb-6 bg-red-50 border-red-200">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-800">Solicitud de Baja</AlertTitle>
              <AlertDescription className="text-red-700">
                Se ha solicitado la baja de este pedido. Razón: {order.cancellationReason}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end mb-12">
            <div className="w-64 bg-black p-4 rounded-xl text-white">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-400">Subtotal</span>
                <span className="text-sm">{formatCurrency(order.totalPrice)}</span>
              </div>
              <div className="flex justify-between items-center border-t border-white/20 pt-2 mt-2">
                <span className="text-sm font-bold uppercase tracking-widest">Total Final</span>
                <span className="text-xl font-black">{formatCurrency(order.totalPrice)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-20 px-8 pt-20">
            <div className="border-t border-black text-center pt-2">
              <p className="text-xs font-bold uppercase">Firma del Repartidor</p>
              <p className="text-[10px] text-gray-500 mt-1">{order.deliveryPersonName || "Entregado por la Empresa"}</p>
            </div>
            <div className="border-t border-black text-center pt-2">
              <p className="text-xs font-bold uppercase">Firma del Cliente</p>
              <p className="text-[10px] text-gray-500 mt-1">Conformidad de Recepción</p>
            </div>
          </div>
          
          <div className="mt-14 text-center text-xs text-gray-500 border-t border-gray-200 pt-4">
            {companyConfig?.receiptFooterNotes || "Gracias por su preferencia • Documento de Control Interno"}
          </div>
        </div>

        {/* Estado del pedido */}
        <Card className="mb-6 no-print">
          <CardHeader>
            <CardTitle>Estado del Pedido</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Estado</p>
                <Badge className="mt-2">
                  {order.status === "pending" && "Pendiente"}
                  {order.status === "assigned" && "Asignado"}
                  {order.status === "in_transit" && "En tránsito"}
                  {order.status === "delivered" && "Entregado"}
                  {order.status === "cancelled" && "Cancelado"}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pago</p>
                <Badge className="mt-2" variant={order.paymentStatus === "completed" ? "default" : "outline"}>
                  {order.paymentStatus === "completed" && "Pagado"}
                  {order.paymentStatus === "pending" && "Pendiente"}
                  {order.paymentStatus === "failed" && "Fallido"}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Zona</p>
                <p className="font-semibold mt-2">{order.zone}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Entrega Programada</p>
                <p className="font-semibold mt-2">
                  {order.deliveryDate ? (
                    <>
                      {order.deliveryDate}
                      {order.deliveryTime && <span className="text-muted-foreground block text-xs">a las {order.deliveryTime}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground font-normal">No especificada</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm font-bold text-red-500 uppercase tracking-widest">Celular</p>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-3xl font-black text-red-600 tracking-tighter">
                    {customer?.phone || customer?.whatsapp || customer?.clientNumber || "No registrado"}
                  </p>
                  {(customer?.phone || customer?.whatsapp || customer?.clientNumber) && (
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100 shadow-sm"
                      onClick={() => {
                        const tel = cleanPhone(customer?.whatsapp || customer?.phone || customer?.clientNumber);
                        if (!tel) {
                          toast.error("El cliente no tiene un número válido");
                          return;
                        }
                        window.open(`https://wa.me/+${tel}?text=Hola!%20Te%20contactamos%20de%20MP%20Shop%20por%20tu%20pedido%20%23${order.orderNumber}`, "_blank");
                      }}
                    >
                      <MessageCircle className="h-5 w-5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Detalles del pedido */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Detalles del Pedido</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold">Producto</th>
                    <th className="text-left py-3 px-4 font-semibold">Cantidad</th>
                    <th className="text-left py-3 px-4 font-semibold">Precio Unit.</th>
                    <th className="text-left py-3 px-4 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{(item as any).productName || `Producto #${item.productId}`}</td>
                      <td className="py-3 px-4">{item.quantity}</td>
                      <td className="py-3 px-4">{formatCurrency(item.price)}</td>
                      <td className="py-3 px-4 font-semibold">
                        {formatCurrency(item.price * item.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total */}
            <div className="mt-6 pt-4 border-t flex justify-between items-center">
              <p className="text-lg font-bold">Total:</p>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(order.totalPrice)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Acciones según el rol */}
        {user?.role === "user" && order.status === "in_transit" && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Acciones Adicionales</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button 
                variant="outline" 
                className="w-full gap-2 bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                onClick={() => {
                  const tel = cleanPhone(customer?.whatsapp || customer?.phone || customer?.clientNumber);
                  if (!tel) {
                    toast.error("El cliente no tiene un número válido");
                    return;
                  }
                  window.open(`https://wa.me/+${tel}?text=Hola!%20Te%20contactamos%20de%20MP%20Shop%20por%20tu%20pedido%20%23${order.orderNumber}`, "_blank");
                }}
              >
                <MessageCircle className="h-4 w-4" />
                Contactar por WhatsApp
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Botón: Dar de baja (Admin) */}
        {user?.role === "admin" && order.status !== "cancelled" && order.status !== "delivered" && (
          <Card className="mb-6 border-red-100 bg-red-50/30">
            <CardHeader>
              <CardTitle className="text-red-700 text-base flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Cancelar Pedido
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Al dar de baja este pedido, los productos asignados volverán automáticamente al inventario.
              </p>
              <Button
                variant="destructive"
                className="gap-2"
                onClick={() => setShowDismissDialog(true)}
              >
                <Trash2 className="h-4 w-4" />
                Dar de Baja el Pedido
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Botón: Solicitar baja (Repartidor) */}
        {user?.role === "user" && order.status !== "cancelled" && order.status !== "delivered" && order.cancellationRequested !== 1 && (
          <Card className="mb-6 border-orange-100 bg-orange-50/30">
            <CardHeader>
              <CardTitle className="text-orange-700 text-base flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Solicitar Baja
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Si el cliente canceló o no se pudo entregar, solicita la baja al administrador. Los productos volverán al inventario una vez aprobado.
              </p>
              <Button
                variant="outline"
                className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={() => setShowCancellationRequestDialog(true)}
              >
                <Trash2 className="h-4 w-4" />
                Solicitar Dar de Baja
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Alerta: baja ya solicitada */}
        {order.cancellationRequested === 1 && order.status !== "cancelled" && (
          <Alert className="mb-6 bg-orange-50 border-orange-200">
            <Trash2 className="h-4 w-4 text-orange-600" />
            <AlertTitle className="text-orange-800">Solicitud de Baja Pendiente</AlertTitle>
            <AlertDescription className="text-orange-700">
              Este pedido tiene una solicitud de baja pendiente de aprobación por el administrador.
              {order.cancellationReason && ` Motivo: ${order.cancellationReason}`}
            </AlertDescription>
          </Alert>
        )}

        {/* Formulario de pago y entrega */}
        {order.paymentStatus === "pending" && (
          <Card className="mb-6 border-2 border-emerald-200 bg-emerald-50/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-800">
                <MapPin className="h-5 w-5" />
                Entregar y Registrar Pago — {formatCurrency(order.totalPrice)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground font-medium">Selecciona el método con el que el cliente pagó para entregar el pedido y actualizar el inventario:</p>
              <div className="grid grid-cols-3 gap-3">
                {/* Efectivo */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("cash")}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                    paymentMethod === "cash"
                      ? "border-emerald-500 bg-emerald-100 shadow-md"
                      : "border-slate-200 bg-white hover:border-emerald-300"
                  }`}
                >
                  <Banknote className={`h-7 w-7 ${paymentMethod === "cash" ? "text-emerald-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-bold ${paymentMethod === "cash" ? "text-emerald-700" : "text-slate-600"}`}>Efectivo</span>
                </button>

                {/* QR */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("qr")}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                    paymentMethod === "qr"
                      ? "border-blue-500 bg-blue-100 shadow-md"
                      : "border-slate-200 bg-white hover:border-blue-300"
                  }`}
                >
                  <QrCode className={`h-7 w-7 ${paymentMethod === "qr" ? "text-blue-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-bold ${paymentMethod === "qr" ? "text-blue-700" : "text-slate-600"}`}>QR</span>
                </button>

                {/* Transferencia */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod("transfer")}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                    paymentMethod === "transfer"
                      ? "border-purple-500 bg-purple-100 shadow-md"
                      : "border-slate-200 bg-white hover:border-purple-300"
                  }`}
                >
                  <Building2 className={`h-7 w-7 ${paymentMethod === "transfer" ? "text-purple-600" : "text-slate-400"}`} />
                  <span className={`text-sm font-bold ${paymentMethod === "transfer" ? "text-purple-700" : "text-slate-600"}`}>Transferencia</span>
                </button>
              </div>

              {!openingStatus?.hasActive && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  TU CAJA DE {paymentMethod === 'cash' ? 'EFECTIVO' : paymentMethod.toUpperCase()} ESTÁ CERRADA. ABRE TU CAJA PARA PODER COBRAR.
                </div>
              )}

              <Button
                className="w-full h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700 gap-2"
                onClick={handleRecordPayment}
                disabled={recordPaymentMutation.isPending || !openingStatus?.hasActive}
              >
                <DollarSign className="h-5 w-5" />
                {recordPaymentMutation.isPending ? "Registrando..." : `Entregar y Cobrar con ${paymentMethod === "cash" ? "Efectivo" : paymentMethod === "qr" ? "QR" : "Transferencia"}`}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Diálogo: Dar de Baja definitiva (Admin) */}
      <Dialog open={showDismissDialog} onOpenChange={setShowDismissDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dar de Baja el Pedido</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              ⚠️ Los productos de este pedido volverán al inventario automáticamente.
            </div>
            <div className="space-y-2">
              <Label>¿Quién cancela?</Label>
              <Select
                value={cancelData.cancelledBy}
                onValueChange={(val: any) => setCancelData({ ...cancelData, cancelledBy: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona quién cancela" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Cliente</SelectItem>
                  <SelectItem value="company">Empresa</SelectItem>
                  <SelectItem value="system">Sistema</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Motivo de la baja</Label>
              <Textarea
                placeholder="Escribe el motivo aquí..."
                value={cancelData.reason}
                onChange={(e) => setCancelData({ ...cancelData, reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDismissDialog(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={dismissMutation.isPending || !cancelData.reason.trim()}
              onClick={() => {
                if (!orderId) return;
                dismissMutation.mutate({
                  orderId,
                  cancelledBy: cancelData.cancelledBy,
                  reason: cancelData.reason,
                });
              }}
            >
              {dismissMutation.isPending ? "Procesando..." : "Confirmar Baja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: Solicitar baja (Repartidor) */}
      <Dialog open={showCancellationRequestDialog} onOpenChange={setShowCancellationRequestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar Dar de Baja</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Esta solicitud será enviada al administrador para su aprobación. Los productos volverán al inventario una vez aprobada.
            </p>
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Textarea
                placeholder="Ej: Cliente no responde, dirección incorrecta, cliente canceló, etc."
                value={cancellationRequestReason}
                onChange={(e) => setCancellationRequestReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancellationRequestDialog(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={requestCancellationMutation.isPending || cancellationRequestReason.trim().length < 3}
              onClick={() => {
                if (!orderId) return;
                requestCancellationMutation.mutate({
                  orderId,
                  reason: cancellationRequestReason,
                });
              }}
            >
              {requestCancellationMutation.isPending ? "Enviando..." : "Enviar Solicitud"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
