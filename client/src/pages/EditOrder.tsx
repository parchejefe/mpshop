import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { formatCurrency, formatPriceInput, parsePrice } from "@/lib/currency";
import { useAuth } from "@/_core/hooks/useAuth";
import { CustomerLookup } from "@/components/CustomerLookup";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, Clipboard, ArrowLeft, Plus, Search } from "lucide-react";

export default function EditOrder() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const orderId = parseInt(id || "0");

  const [showSummary, setShowSummary] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [formData, setFormData] = useState({
    orderNumber: "",
    clientNumber: "",
    clientName: "",
    zone: "",
    sourceChannel: "other" as "facebook" | "tiktok" | "marketplace" | "referral" | "other",
    deliveryDate: "",
    deliveryTime: "",
    paymentMethod: "cash" as "qr" | "cash" | "transfer",
    deliveryPersonId: "",
    notes: "",
    status: "",
    customerType: "retail" as "retail" | "wholesale",
    items: [] as { productId: number; productCode: string; quantity: number; price: number; pricingType: "unit" | "wholesale" | "discount" }[],
  });

  const { data: products } = (trpc.inventory as any).getProductsWithStock.useQuery();
  const { data: deliveryPersons } = trpc.users.listDeliveryPersons.useQuery();
  const { data: orderDetails, isLoading: isLoadingOrder } = trpc.orders.getDetails.useQuery(
    { orderId },
    { enabled: !!orderId }
  );

  const updateOrderMutation = trpc.orders.update.useMutation({
    onSuccess: async () => {
      toast.success("Pedido actualizado exitosamente");
      await Promise.all([
        utils.orders.list.invalidate(),
        utils.orders.getDetails.invalidate({ orderId }),
      ]);
      setLocation("/orders");
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  useEffect(() => {
    if (orderDetails) {
      const { order, items, customer } = orderDetails;
      setFormData({
        orderNumber: order.orderNumber || "",
        clientNumber: customer?.clientNumber || "",
        clientName: customer?.name || "",
        zone: order.zone || "",
        sourceChannel: (order.sourceChannel as any) || "other",
        deliveryDate: order.deliveryDate || "",
        deliveryTime: order.deliveryTime || "",
        paymentMethod: (order.paymentMethod as any) || "cash",
        deliveryPersonId: order.deliveryPersonId?.toString() || "",
        notes: order.notes || "",
        status: order.status || "pending",
        customerType: (customer?.customerType as any) || "retail",
        items: items.map((item: any) => ({
          productId: item.productId,
          productCode: item.productCode || "",
          quantity: item.quantity,
          price: item.price,
          pricingType: (item.pricingType as any) || "unit",
        })),
      });
    }
  }, [orderDetails]);

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600">Solo administradores pueden editar pedidos</p>
      </div>
    );
  }

  if (isLoadingOrder) {
    return <div className="p-8 text-center font-bold text-slate-500 animate-pulse">Cargando datos del pedido...</div>;
  }

  const handleAddItem = () => {
    const defaultProduct = products?.[0];
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        {
          productId: defaultProduct?.id || 0,
          productCode: defaultProduct?.code || "",
          quantity: 1,
          price: formData.customerType === "wholesale" ? (defaultProduct?.wholesalePrice || defaultProduct?.salePrice || 0) : (defaultProduct?.salePrice || 0),
          pricingType: formData.customerType === "wholesale" ? "wholesale" : "unit",
        },
      ],
    });
  };

  const handleRemoveItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const handleUpdateSubmit = () => {
    const totalPrice = formData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    
    updateOrderMutation.mutate({
      id: orderId,
      ...formData,
      deliveryPersonId: formData.deliveryPersonId ? parseInt(formData.deliveryPersonId) : undefined,
      customerType: formData.customerType,
      totalPrice,
    });
  };

  const totalPrice = formData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const getSummaryText = () => {
    const itemsText = formData.items
      .map((item) => {
        const prod = (products as any)?.find((p: any) => p.id === item.productId);
        return `• ${item.quantity}x ${prod?.name || item.productCode} - ${formatCurrency(item.price * item.quantity)}`;
      })
      .join("\n");

    return `*RESUMEN DE PEDIDO #${formData.orderNumber}*\n\n` +
      `*Cliente:* ${formData.clientName}\n` +
      `*Celular:* ${formData.clientNumber}\n` +
      `*Zona:* ${formData.zone}\n` +
      `*Fecha:* ${formData.deliveryDate}\n` +
      `*Método:* ${formData.paymentMethod.toUpperCase()}\n\n` +
      `*Productos:*\n${itemsText}\n\n` +
      `*TOTAL:* ${formatCurrency(totalPrice)}\n\n` +
      `_MP Shop - Operación Diaria_`;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getSummaryText());
    toast.success("Resumen copiado al portapapeles");
  };

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-8 pb-24">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")} className="rounded-full bg-white shadow-sm border border-slate-200">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Editar Pedido</h1>
            <p className="text-slate-500 font-medium">Actualiza los detalles del pedido #{formData.orderNumber}</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Información del Cliente */}
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden rounded-[2rem]">
            <CardHeader className="bg-slate-900 text-white p-6">
              <CardTitle className="text-xl flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-400" />
                Información del Cliente
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <CustomerLookup
                clientNumber={formData.clientNumber}
                clientName={formData.clientName}
                zone={formData.zone}
                sourceChannel={formData.sourceChannel}
                onChange={(patch) => {
                  const newCustomerType = patch.customerType || formData.customerType;
                  
                  // Auto-update cart prices if becoming wholesale
                  let updatedItems = formData.items;
                  if (newCustomerType !== formData.customerType) {
                    updatedItems = formData.items.map(item => {
                      const prod = (products as any)?.find((p: any) => p.id === item.productId);
                      if (newCustomerType === "wholesale") {
                        return {
                          ...item,
                          pricingType: "wholesale",
                          price: prod?.wholesalePrice || item.price
                        };
                      } else {
                        return {
                          ...item,
                          pricingType: "unit",
                          price: prod?.salePrice || item.price
                        };
                      }
                    });
                  }

                  setFormData((prev) => ({
                    ...prev,
                    ...patch,
                    items: updatedItems,
                  }));
                }}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Estado del Pedido</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(val) => setFormData(prev => ({ ...prev, status: val }))}
                  >
                    <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pendiente</SelectItem>
                      <SelectItem value="assigned">Asignado</SelectItem>
                      <SelectItem value="in_transit">En tránsito</SelectItem>
                      <SelectItem value="delivered">Entregado</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                      <SelectItem value="rescheduled">Reprogramado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Número de Pedido</Label>
                  <Input value={formData.orderNumber} readOnly className="h-12 bg-slate-50 border-slate-100 font-mono font-bold text-slate-600" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Celular</Label>
                  <Input
                    className="h-12 rounded-xl border-slate-200 shadow-sm"
                    value={formData.clientNumber}
                    onChange={(e) => setFormData({ ...formData, clientNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Nombre Completo</Label>
                  <Input
                    className="h-12 rounded-xl border-slate-200 shadow-sm"
                    value={formData.clientName}
                    onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-bold text-slate-700">Zona / Dirección</Label>
                <Input
                  className="h-12 rounded-xl border-slate-200 shadow-sm"
                  value={formData.zone}
                  onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Canal</Label>
                  <Select
                    value={formData.sourceChannel}
                    onValueChange={(val: any) => setFormData(prev => ({ ...prev, sourceChannel: val }))}
                  >
                    <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="tiktok">TikTok</SelectItem>
                      <SelectItem value="marketplace">Marketplace</SelectItem>
                      <SelectItem value="referral">Referido</SelectItem>
                      <SelectItem value="other">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Pago</Label>
                  <Select
                    value={formData.paymentMethod}
                    onValueChange={(val: any) => setFormData(prev => ({ ...prev, paymentMethod: val }))}
                  >
                    <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Efectivo</SelectItem>
                      <SelectItem value="qr">QR</SelectItem>
                      <SelectItem value="transfer">Transferencia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Fecha Entrega</Label>
                  <Input
                    type="date"
                    className="h-12 rounded-xl border-slate-200 shadow-sm"
                    value={formData.deliveryDate}
                    onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">Hora</Label>
                  <Input
                    type="time"
                    className="h-12 rounded-xl border-slate-200 shadow-sm"
                    value={formData.deliveryTime}
                    onChange={(e) => setFormData({ ...formData, deliveryTime: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-bold text-slate-700">Repartidor Asignado</Label>
                <Select
                  value={formData.deliveryPersonId}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, deliveryPersonId: val }))}
                >
                  <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-white shadow-sm">
                    <SelectValue placeholder="Seleccionar repartidor" />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryPersons?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-bold text-slate-700">Observaciones</Label>
                <Textarea
                  className="rounded-xl border-slate-200 shadow-sm min-h-[100px]"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Instrucciones especiales para la entrega..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Productos */}
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden rounded-[2rem]">
            <CardHeader className="bg-emerald-600 text-white p-6 flex flex-row items-center justify-between">
              <CardTitle className="text-xl">Lista de Productos</CardTitle>
              <Button variant="secondary" size="sm" onClick={handleAddItem} className="rounded-full font-bold shadow-lg">
                + Añadir Item
              </Button>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {formData.items.length === 0 && (
                <p className="text-center py-8 text-slate-400 italic">No hay productos en el pedido</p>
              )}
              {formData.items.map((item, index) => (
                <div key={index} className="p-5 rounded-3xl bg-slate-50/50 border border-slate-100 flex flex-col gap-4 relative group">
                   <div className="flex flex-col gap-4 w-full">
                    <div className="space-y-1 w-full">
                      <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Producto Seleccionado</Label>
                      <Select
                        value={item.productCode}
                        onValueChange={(val) => {
                          const prod = (products as any)?.find((p: any) => p.code === val);
                          const newItems = [...formData.items];
                          const pricingType = formData.customerType === "wholesale" ? "wholesale" : "unit";
                          const price = formData.customerType === "wholesale" ? (prod?.wholesalePrice || prod?.salePrice || 0) : (prod?.salePrice || 0);
                          
                          newItems[index] = {
                            ...newItems[index],
                            productCode: val,
                            productId: prod?.id || 0,
                            price: price,
                            pricingType: pricingType,
                          };
                          setFormData({ ...formData, items: newItems });
                        }}
                      >
                        <SelectTrigger className="w-full h-12 rounded-2xl border-slate-200 bg-white shadow-sm">
                          <SelectValue placeholder="Seleccionar producto..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px] w-[--radix-select-trigger-width]">
                          <div className="p-2 sticky top-0 bg-white z-10 border-b">
                             <div className="relative">
                               <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                               <Input
                                 placeholder="Buscar producto..."
                                 className="pl-8 h-9 text-xs"
                                 value={productSearch}
                                 onChange={(e) => setProductSearch(e.target.value)}
                                 onClick={(e) => e.stopPropagation()}
                                 onKeyDown={(e) => e.stopPropagation()}
                               />
                             </div>
                          </div>
                          {products?.filter((p: any) => 
                            p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
                            p.code.toLowerCase().includes(productSearch.toLowerCase())
                          ).map((p: any) => (
                            <SelectItem key={p.id} value={p.code}>
                              <div className="flex flex-col">
                                <span className="font-bold">{p.name}</span>
                                <span className={`text-[10px] ${p.stock <= p.minStock ? 'text-red-500 font-black' : 'text-slate-400'}`}>
                                  Stock: {p.stock} uds.
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cantidad</Label>
                      <Input
                        type="number"
                        className="h-12 rounded-2xl border-slate-200 bg-white shadow-sm text-center font-bold"
                        value={item.quantity}
                        onChange={(e) => {
                          const newItems = [...formData.items];
                          newItems[index].quantity = parseInt(e.target.value) || 1;
                          setFormData({ ...formData, items: newItems });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Precio Bs.</Label>
                      <Input
                        className="h-12 rounded-2xl border-slate-200 bg-white shadow-sm text-right font-mono font-bold"
                        value={formatPriceInput(item.price)}
                        onChange={(e) => {
                          const newItems = [...formData.items];
                          newItems[index].price = parsePrice(e.target.value);
                          setFormData({ ...formData, items: newItems });
                        }}
                      />
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 self-center font-bold text-xs" 
                    onClick={() => handleRemoveItem(index)}
                  >
                    Quitar Producto
                  </Button>
                </div>
              ))}
              {formData.items.length > 0 && (
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-14 rounded-2xl border-dashed border-2 border-emerald-200 text-emerald-600 hover:bg-emerald-50 font-bold gap-2"
                    onClick={handleAddItem}
                  >
                    <Plus className="h-5 w-5" />
                    Añadir otro producto a la lista
                  </Button>
                </div>
              )}

              <div className="pt-6 flex justify-between items-center border-t border-slate-100">
                <div className="flex flex-col">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Monto Total</span>
                  <span className="text-4xl font-black text-emerald-600 tracking-tighter">{formatCurrency(totalPrice)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button variant="outline" className="flex-1 h-16 rounded-[1.5rem] font-bold text-slate-600 border-slate-200 shadow-sm" onClick={() => setLocation("/orders")}>
              Descartar
            </Button>
            <Button
              className="flex-1 h-16 rounded-[1.5rem] font-black text-lg bg-slate-900 shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all"
              onClick={() => setShowSummary(true)}
              disabled={formData.items.length === 0}
            >
              Guardar Cambios
            </Button>
          </div>
        </div>
      </div>

      {/* Diálogo de Resumen */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-md rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl z-[150]">
          <DialogHeader className="bg-slate-900 text-white p-8 text-center">
            <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/30">
                <Check className="h-8 w-8 text-white" />
            </div>
            <DialogTitle className="text-2xl font-black">Revisar Pedido</DialogTitle>
            <DialogDescription className="text-slate-400 font-medium">
              Verifica los datos antes de actualizar la base de datos.
            </DialogDescription>
          </DialogHeader>
          <div className="p-8 space-y-6 bg-white">
            <div className="space-y-4">
               <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                 <span className="text-slate-400 text-xs font-bold uppercase">Cliente</span>
                 <span className="font-bold text-slate-800">{formData.clientName}</span>
               </div>
               <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                 <span className="text-slate-400 text-xs font-bold uppercase">Zona</span>
                 <span className="font-bold text-slate-800">{formData.zone}</span>
               </div>
               <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                 <span className="text-slate-400 text-xs font-bold uppercase">Entrega</span>
                 <span className="font-bold text-slate-800">{formData.deliveryDate} {formData.deliveryTime}</span>
               </div>
               <div className="pt-4 flex justify-between items-center">
                 <span className="text-slate-900 font-black text-lg uppercase">Total</span>
                 <span className="text-3xl font-black text-emerald-600">{formatCurrency(totalPrice)}</span>
               </div>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <Button onClick={copyToClipboard} variant="outline" className="w-full h-14 rounded-2xl gap-3 font-bold border-slate-200 text-slate-600 hover:bg-slate-50">
                <Clipboard className="h-5 w-5" />
                Copiar para WhatsApp
              </Button>
              <Button onClick={handleUpdateSubmit} className="w-full h-16 rounded-2xl gap-3 font-black text-xl bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-100" disabled={updateOrderMutation.isPending}>
                {updateOrderMutation.isPending ? "Procesando..." : "Confirmar Cambios"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
