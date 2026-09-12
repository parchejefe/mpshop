import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useLocation } from "wouter";
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
} from "@/components/ui/dialog";
import { Check, Clipboard, ArrowLeft, Search, Grid, Plus, ShoppingCart } from "lucide-react";

export default function CreateOrder() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
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
    customerType: "retail" as "retail" | "wholesale",
    items: [{ productId: 0, productCode: "", quantity: 1, price: 0, pricingType: "unit" as "unit" | "wholesale" | "discount" }],
  });

  const [showSummary, setShowSummary] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Todos los hooks deben estar antes de cualquier condicional o return
  const { data: products } = (trpc.inventory as any).getProductsWithStock.useQuery();
  const { data: nextOrderData } = trpc.orders.getNextOrderNumber.useQuery();
  const { data: deliveryPersons } = trpc.users.listDeliveryPersons.useQuery();
  const createOrderMutation = trpc.orders.create.useMutation({
    onSuccess: async () => {
      toast.success("Pedido creado exitosamente");
      await Promise.all([
        utils.orders.list.invalidate(),
        utils.orders.list.refetch(),
        utils.orders.listForDelivery.invalidate(),
        utils.stats.getDashboardStats.invalidate(),
        utils.customers.list.invalidate(),
        utils.customers.getInsights.invalidate(),
      ]);
      setLocation("/orders");
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  // Establecer el número de pedido automáticamente
  useEffect(() => {
    if (nextOrderData?.orderNumber && !formData.orderNumber) {
      setFormData((prev) => ({ ...prev, orderNumber: nextOrderData.orderNumber }));
    }
  }, [nextOrderData?.orderNumber, formData.orderNumber]);

  // Inicializar el primer producto cuando se carguen los productos
  useEffect(() => {
    if (products && products.length > 0 && !formData.items[0].productCode) {
      const firstProduct = products[0];
      setFormData((prev) => ({
        ...prev,
        items: [{ productId: firstProduct.id, productCode: firstProduct.code, quantity: 1, price: firstProduct.salePrice || 0, pricingType: "unit" }],
      }));
    }
  }, [products]);


  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600">Solo administradores pueden crear pedidos</p>
      </div>
    );
  }

  const handleAddItem = () => {
    const defaultProduct = products?.[0];
    const pricingType = formData.customerType === "wholesale" ? "wholesale" : "unit";
    const price = pricingType === "wholesale" ? (defaultProduct?.wholesalePrice || 0) : (defaultProduct?.salePrice || 0);

    setFormData({
      ...formData,
      items: [...formData.items, { 
        productId: defaultProduct?.id || 0, 
        productCode: defaultProduct?.code || "COCO", 
        quantity: 1, 
        price: price, 
        pricingType: pricingType 
      }],
    });
  };

  const handleRemoveItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  const addToCartFromGallery = (product: any) => {
    const existingIndex = formData.items.findIndex(i => i.productId === product.id);
    if (existingIndex >= 0) {
      const newItems = [...formData.items];
      newItems[existingIndex].quantity += 1;
      setFormData({ ...formData, items: newItems });
    } else {
      setFormData({
        ...formData,
        items: [...formData.items, { 
          productId: product.id, 
          productCode: product.code, 
          quantity: 1, 
          price: formData.customerType === "wholesale" ? (product.wholesalePrice || 0) : (product.salePrice || 0),
          pricingType: formData.customerType === "wholesale" ? "wholesale" : "unit"
        }]
      });
    }
    toast.success(`${product.name} añadido`);
  };

  const handleConfirmSubmit = () => {
    const totalPrice = formData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    createOrderMutation.mutate({
      orderNumber: formData.orderNumber,
      clientNumber: formData.clientNumber,
      clientName: formData.clientName,
      zone: formData.zone,
      sourceChannel: formData.sourceChannel,
      deliveryDate: formData.deliveryDate,
      deliveryTime: formData.deliveryTime,
      paymentMethod: formData.paymentMethod,
      deliveryPersonId: formData.deliveryPersonId ? parseInt(formData.deliveryPersonId) : undefined,
      notes: formData.notes.trim() || undefined,
      customerType: formData.customerType,
      totalPrice,
      items: formData.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        pricingType: item.pricingType,
      })),
    });
  };

  const getSummaryText = () => {
    const itemsText = formData.items
      .map((item) => {
        const prod = products?.find((p: any) => p.code === item.productCode);
        return `• ${item.quantity}x ${prod?.name || item.productCode} - ${formatCurrency(item.price * item.quantity)}`;
      })
      .join("\n");

    return `*RESUMEN DE NUEVO PEDIDO #${formData.orderNumber}*\n\n` +
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validar campos requeridos
    if (!formData.clientName.trim()) {
      toast.error("El nombre del cliente es requerido");
      return;
    }

    if (!formData.deliveryDate) {
      toast.error("La fecha de entrega es requerida");
      return;
    }

    if (formData.items.some(item => item.productId === 0)) {
      toast.error("Selecciona productos válidos");
      return;
    }

    setShowSummary(true);
  };

  const totalPrice = formData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-8 pb-24">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")} className="rounded-full bg-white shadow-sm border border-slate-200">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Crear Pedido</h1>
            <p className="text-slate-500 font-medium">Registra una nueva entrega para MP Shop</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Información básica */}
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden rounded-[2rem]">
            <CardHeader className="bg-slate-900 text-white p-6">
              <CardTitle className="text-xl flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-400" />
                Información del Pedido
              </CardTitle>
            </CardHeader>
          <CardContent className="space-y-4">
            <CustomerLookup
              clientNumber={formData.clientNumber}
              clientName={formData.clientName}
              zone={formData.zone}
              sourceChannel={formData.sourceChannel}
              onChange={(patch) => {
                const isBecomingWholesale = patch.customerType === "wholesale" && formData.customerType !== "wholesale";
                const isBecomingRetail = patch.customerType === "retail" && formData.customerType !== "retail";

                setFormData((prev) => {
                  let newItems = [...prev.items];
                  
                  if (isBecomingWholesale) {
                    newItems = newItems.map(item => {
                      const prod = (products as any)?.find((p: any) => p.id === item.productId);
                      return {
                        ...item,
                        pricingType: "wholesale",
                        price: prod?.wholesalePrice || item.price
                      };
                    });
                  } else if (isBecomingRetail) {
                    newItems = newItems.map(item => {
                      const prod = (products as any)?.find((p: any) => p.id === item.productId);
                      return {
                        ...item,
                        pricingType: "unit",
                        price: prod?.salePrice || item.price
                      };
                    });
                  }

                  return {
                    ...prev,
                    ...patch,
                    items: newItems
                  };
                });
              }}
            />

            <div>
              <Label htmlFor="orderNumber">Número de Pedido</Label>
              <Input
                  id="orderNumber"
                  value={formData.orderNumber}
                  readOnly
                  className="bg-muted cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1">Se genera automáticamente de forma correlativa</p>
              </div>

              <div>
                <Label htmlFor="clientNumber">Número de Cliente</Label>
                <Input
                  id="clientNumber"
                  value={formData.clientNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, clientNumber: e.target.value })
                  }
                  placeholder="ej: 7887295"
                  required
                />
              </div>

              <div>
                <Label htmlFor="clientName">Nombre del Cliente</Label>
                <Input
                  id="clientName"
                  value={formData.clientName}
                  onChange={(e) =>
                    setFormData({ ...formData, clientName: e.target.value })
                  }
                  placeholder="ej: Juan García"
                  required
                />
              </div>

              <div>
                <Label htmlFor="zone">Zona de Entrega</Label>
                <Input
                  id="zone"
                  value={formData.zone}
                  onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
                  placeholder="ej: OBELISCO"
                  required
                />
              </div>

              <div>
                <Label htmlFor="sourceChannel">Canal de venta</Label>
                <Select
                  value={formData.sourceChannel}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      sourceChannel: value as "facebook" | "tiktok" | "marketplace" | "referral" | "other",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un canal" />
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

              <div>
                <Label htmlFor="paymentMethod">Método de Pago</Label>
                <Select
                  value={formData.paymentMethod}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      paymentMethod: value as "qr" | "cash" | "transfer",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="qr">QR</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="deliveryDate">Fecha de Entrega</Label>
                <Input
                  id="deliveryDate"
                  type="date"
                  value={formData.deliveryDate}
                  onChange={(e) =>
                    setFormData({ ...formData, deliveryDate: e.target.value })
                  }
                  required
                />
              </div>

              <div>
                <Label htmlFor="deliveryTime">Hora de Entrega</Label>
                <Input
                  id="deliveryTime"
                  type="time"
                  value={formData.deliveryTime}
                  onChange={(e) =>
                    setFormData({ ...formData, deliveryTime: e.target.value })
                  }
                />
              </div>

              <div>
                <Label htmlFor="deliveryPerson">Asignar a Repartidor</Label>
                <Select
                  value={formData.deliveryPersonId}
                  onValueChange={(value) =>
                    setFormData({ ...formData, deliveryPersonId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un repartidor" />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryPersons?.map((person) => (
                      <SelectItem key={person.id} value={person.id.toString()}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-sm font-bold text-slate-700">Notas del pedido</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Ej: Llamar antes de entregar, dejar en conserjería, etc."
                  rows={2}
                  className="rounded-xl border-slate-200 shadow-sm min-h-[100px]"
                />
              </div>
            </CardContent>
          </Card>

          {/* Items del pedido */}
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden rounded-[2rem]">
            <CardHeader className="bg-emerald-600 text-white p-6 flex flex-row items-center justify-between">
              <CardTitle className="text-xl">Lista de Productos</CardTitle>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setIsGalleryOpen(true)} className="rounded-full font-bold shadow-lg gap-2">
                  <Grid className="h-4 w-4" /> Catálogo
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={handleAddItem} className="rounded-full font-bold shadow-lg gap-2">
                  <Plus className="h-4 w-4" /> Añadir Item
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {formData.items.map((item, index) => (
                <div key={index} className="p-5 rounded-3xl bg-slate-50/50 border border-slate-100 flex flex-col gap-4 relative group">
                  <div className="flex flex-col gap-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Producto</Label>
                      <Select
                        value={item.productCode}
                        onValueChange={(value) => {
                          const selectedProduct = products?.find((p: any) => p.code === value);
                          const newItems = [...formData.items];
                          newItems[index].productCode = value;
                          newItems[index].productId = selectedProduct?.id || 0;
                          newItems[index].price = selectedProduct?.salePrice || 0;
                          setFormData({ ...formData, items: newItems });
                        }}
                      >
                        <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white shadow-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
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
                    <div className="space-y-1">
                      <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nivel de Precio</Label>
                      <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
                        <button 
                          type="button"
                          onClick={() => {
                            const selectedProduct = products?.find((p: any) => p.code === item.productCode);
                            const newItems = [...formData.items];
                            newItems[index].pricingType = "unit";
                            newItems[index].price = selectedProduct?.salePrice || 0;
                            setFormData({ ...formData, items: newItems });
                          }}
                          className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all ${item.pricingType === "unit" ? "bg-slate-900 text-white shadow-md" : "text-slate-400 hover:text-slate-600"}`}
                        >
                          UNIT.
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            const selectedProduct = products?.find((p: any) => p.code === item.productCode);
                            const newItems = [...formData.items];
                            newItems[index].pricingType = "discount";
                            newItems[index].price = selectedProduct?.discountPrice || 0;
                            setFormData({ ...formData, items: newItems });
                          }}
                          className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all ${item.pricingType === "discount" ? "bg-slate-900 text-white shadow-md" : "text-slate-400 hover:text-slate-600"}`}
                        >
                          DESC.
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            const selectedProduct = products?.find((p: any) => p.code === item.productCode);
                            const newItems = [...formData.items];
                            newItems[index].pricingType = "wholesale";
                            newItems[index].price = selectedProduct?.wholesalePrice || 0;
                            setFormData({ ...formData, items: newItems });
                          }}
                          className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all ${item.pricingType === "wholesale" ? "bg-slate-900 text-white shadow-md" : "text-slate-400 hover:text-slate-600"}`}
                        >
                          MAYOR.
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cantidad</Label>
                      <Input
                        type="number"
                        min="1"
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
                        type="text"
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

                  {formData.items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 self-center font-bold text-xs"
                      onClick={() => handleRemoveItem(index)}
                    >
                      Quitar Producto
                    </Button>
                  )}
                </div>
              ))}
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-14 rounded-2xl border-dashed border-2 border-emerald-200 text-emerald-600 hover:bg-emerald-50 font-bold gap-2"
                  onClick={handleAddItem}
                >
                  <Plus className="h-5 w-5" />
                  {formData.items.length === 0 ? "Añadir producto" : "Añadir otro producto"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Resumen */}
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden rounded-[2rem]">
            <CardContent className="p-8">
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Monto Total</span>
                  <span className="text-4xl font-black text-emerald-600 tracking-tighter">{formatCurrency(totalPrice)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Botones de acción */}
          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocation("/orders")}
              className="flex-1 h-16 rounded-[1.5rem] font-bold text-slate-600 border-slate-200 shadow-sm"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createOrderMutation.isPending}
              className="flex-1 h-16 rounded-[1.5rem] font-black text-lg bg-slate-900 shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              {createOrderMutation.isPending ? "Procesando..." : "Siguiente"}
            </Button>
          </div>
        </form>
      </div>

      {/* Diálogo de Resumen */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-md rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl z-[150]">
          <DialogHeader className="bg-slate-900 text-white p-8 text-center">
            <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/30">
                <Check className="h-8 w-8 text-white" />
            </div>
            <DialogTitle className="text-2xl font-black">Confirmar Pedido</DialogTitle>
            <DialogDescription className="text-slate-400 font-medium">
              Verifica los datos antes de registrar el pedido.
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
              <Button onClick={handleConfirmSubmit} className="w-full h-16 rounded-2xl gap-3 font-black text-xl bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-100" disabled={createOrderMutation.isPending}>
                {createOrderMutation.isPending ? "Creando..." : "Confirmar y Crear"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Catálogo / Galería de Productos */}
      <Dialog open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-[2.5rem] p-0">
          <DialogHeader className="p-6 bg-slate-900 text-white">
            <DialogTitle className="text-2xl font-black">Catálogo de Productos</DialogTitle>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar por nombre o código..."
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-500 rounded-xl"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {products?.filter((p: any) => 
                p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
                p.code.toLowerCase().includes(productSearch.toLowerCase())
              ).map((product: any) => (
                <Card key={product.id} className="overflow-hidden border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer rounded-2xl group" onClick={() => addToCartFromGallery(product)}>
                  <div className="aspect-square bg-slate-200 relative">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <Plus className="h-8 w-8" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <Badge variant={product.stock <= product.minStock ? "destructive" : "secondary"} className="rounded-full px-2 py-0.5 text-[10px] font-bold">
                        Stock: {product.stock}
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <p className="font-bold text-sm text-slate-800 line-clamp-1">{product.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-emerald-600 font-black text-sm">{formatCurrency(product.salePrice)}</span>
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-600">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <div className="p-4 bg-white border-t flex justify-between items-center px-8">
            <div className="flex items-center gap-2 text-slate-500">
              <ShoppingCart className="h-5 w-5" />
              <span className="font-bold">{formData.items.length} productos en lista</span>
            </div>
            <Button onClick={() => setIsGalleryOpen(false)} className="rounded-xl font-bold bg-slate-900 px-8">
              Listo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
