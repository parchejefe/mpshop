import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { 
  Wallet, QrCode, Landmark, Receipt, AlertCircle, CheckCircle2, 
  Lock, ShieldAlert, History, DollarSign, TrendingUp, Clock,
  Package, Send, FileText, Store, XCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function paymentMethodLabel(method?: string) {
  if (!method) return "—";
  if (method === "cash") return "Efectivo";
  if (method === "qr") return "QR";
  if (method === "transfer") return "Transferencia";
  if (method === "credit") return "Crédito";
  return method;
}

export default function SellerCashRegister() {
  const getLocalDateInputValue = () => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - offsetMs).toISOString().split("T")[0];
  };

  const today = getLocalDateInputValue();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  const [openingForm, setOpeningForm] = useState({
    initialCash: "",
    notes: ""
  });

  const [closingForm, setClosingForm] = useState({
    reportedCash: "",
    reportedQr: "",
    reportedTransfer: "",
    differenceJustification: ""
  });

  const [deliveryForm, setDeliveryForm] = useState({
    amount: "",
    notes: ""
  });

  const [expenseForm, setExpenseForm] = useState({
    amount: "",
    concept: "",
    notes: ""
  });

  const utils = trpc.useUtils();

  // Queries
  const { data: boxStatus, refetch: refetchStatus } = trpc.sellerCash.getMyBoxStatus.useQuery();
  const { data: pendingRequests } = trpc.sellerCash.getMyPendingRequests.useQuery();
  const { data: history } = trpc.sellerCash.getMyHistory.useQuery();

  // Mutations
  const requestOpeningMutation = trpc.sellerCash.requestOpening.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de apertura enviada al administrador");
      utils.sellerCash.getMyBoxStatus.invalidate();
      utils.sellerCash.getMyPendingRequests.invalidate();
      setOpeningForm({ initialCash: "", notes: "" });
      setActiveTab("dashboard");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    }
  });

  const requestClosingMutation = trpc.sellerCash.requestClosing.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de cierre enviada al administrador");
      utils.sellerCash.getMyBoxStatus.invalidate();
      utils.sellerCash.getMyPendingRequests.invalidate();
      setClosingForm({ reportedCash: "", reportedQr: "", reportedTransfer: "", differenceJustification: "" });
      setActiveTab("dashboard");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    }
  });

  const requestDeliveryMutation = trpc.sellerCash.requestPartialDelivery.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de entrega parcial enviada");
      utils.sellerCash.getMyBoxStatus.invalidate();
      utils.sellerCash.getMyPendingRequests.invalidate();
      setDeliveryForm({ amount: "", notes: "" });
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    }
  });

  const requestExpenseMutation = trpc.sellerCash.requestExpense.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de gasto enviada");
      utils.sellerCash.getMyBoxStatus.invalidate();
      utils.sellerCash.getMyPendingRequests.invalidate();
      setExpenseForm({ amount: "", concept: "", notes: "" });
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    }
  });

  const handleRequestOpening = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await requestOpeningMutation.mutateAsync({
        initialCash: parseFloat(openingForm.initialCash) || 0,
        notes: openingForm.notes || undefined
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestClosing = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const totalReported = (parseFloat(closingForm.reportedCash) || 0) + 
                         (parseFloat(closingForm.reportedQr) || 0) + 
                         (parseFloat(closingForm.reportedTransfer) || 0);
    
    if (totalReported === 0 && !confirm("¿Seguro que deseas solicitar cierre con Bs. 0.00?")) {
      return;
    }

    setIsSubmitting(true);
    try {
      await requestClosingMutation.mutateAsync({
        reportedCash:     parseFloat(closingForm.reportedCash)     || 0,
        reportedQr:       parseFloat(closingForm.reportedQr)       || 0,
        reportedTransfer: parseFloat(closingForm.reportedTransfer) || 0,
        differenceJustification: closingForm.differenceJustification || undefined
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const amount = parseFloat(deliveryForm.amount) || 0;
    if (amount <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestDeliveryMutation.mutateAsync({
        amount: amount,
        notes: deliveryForm.notes || undefined
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const amount = parseFloat(expenseForm.amount) || 0;
    if (amount <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    if (!expenseForm.concept) {
      toast.error("Debe especificar el concepto del gasto");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestExpenseMutation.mutateAsync({
        amount: amount,
        concept: expenseForm.concept,
        notes: expenseForm.notes || undefined
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Estado de la caja — el backend devuelve { hasBox, box: { openingStatus, closingStatus, ... } }
  const hasBox = boxStatus?.hasBox || false;
  const currentBox = boxStatus?.box;
  const isOpen = currentBox?.closingStatus === "open";
  const isApproved = currentBox?.openingStatus === "approved";
  const canOperate = hasBox && isOpen && isApproved;

  // Detectar apertura o cierre pendiente directamente del estado de la caja
  const hasPendingOpening  = hasBox && currentBox?.openingStatus === "pending";
  const hasRejectedOpening = hasBox && currentBox?.openingStatus === "rejected";
  const hasPendingClosing  = hasBox && currentBox?.closingStatus === "pending";
  const hasRejectedClosing = hasBox && currentBox?.closingStatus === "rejected";
  const hasApprovedClosing = hasBox && (currentBox?.closingStatus === "approved" || currentBox?.closingStatus === "forced_closed");

  // Si el cierre fue APROBADO → mostrar resumen final
  if (hasApprovedClosing) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 mb-10">
        <Card className="border-t-4 border-t-emerald-500 shadow-xl overflow-hidden">
          <CardHeader className="text-center pb-2 bg-emerald-50/50">
            <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Caja Cerrada</CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              Tu caja del {today} {currentBox?.turnNumber && `(Turno #${currentBox.turnNumber})`} ha sido cerrada y aprobada por el administrador.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="flex justify-between items-center px-4 py-3 bg-white border border-slate-100 rounded-xl shadow-sm">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Estado Final</span>
              <Badge className="bg-emerald-600 hover:bg-emerald-700 font-bold px-3 py-1">
                CERRADA Y APROBADA ✓
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-emerald-50/50 border-none shadow-none">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-slate-400 font-black uppercase mb-1">Efectivo Entregado</p>
                  <p className="text-2xl font-black text-emerald-700">{formatCurrency(currentBox?.reportedCash || 0)}</p>
                </CardContent>
              </Card>
              <Card className="bg-blue-50/50 border-none shadow-none">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-slate-400 font-black uppercase mb-1">QR Total</p>
                  <p className="text-2xl font-black text-blue-700">{formatCurrency(currentBox?.reportedQr || 0)}</p>
                </CardContent>
              </Card>
              <Card className="bg-purple-50/50 border-none shadow-none">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-slate-400 font-black uppercase mb-1">Transf. Total</p>
                  <p className="text-2xl font-black text-purple-700">{formatCurrency(currentBox?.reportedTransfer || 0)}</p>
                </CardContent>
              </Card>
            </div>

            <div className="p-6 bg-slate-900 rounded-xl text-center">
              <p className="text-[10px] text-slate-400 font-black uppercase mb-2 tracking-widest">Total Ventas del Día</p>
              <p className="text-4xl font-black text-emerald-400">
                {formatCurrency((currentBox?.salesCash || 0) + (currentBox?.salesQr || 0) + (currentBox?.salesTransfer || 0))}
              </p>
            </div>

            {currentBox?.closingNotes && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs font-bold text-slate-600 uppercase mb-2">Notas del Administrador</p>
                <p className="text-sm text-slate-700">{currentBox.closingNotes}</p>
              </div>
            )}

            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex gap-3 items-start">
               <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
               <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                 ¡Excelente trabajo! Tu caja del <strong>{currentBox?.date}</strong> ha sido cerrada correctamente. 
                 {currentBox?.date !== today && <span> Para trabajar hoy ({today}), solicita una nueva apertura.</span>}
               </p>
            </div>

            <div className="flex gap-3">
              <Button
                className="flex-1 h-12 text-base font-bold bg-slate-700 hover:bg-slate-800"
                onClick={() => setActiveTab("dashboard")}
              >
                <History className="w-4 h-4 mr-2" /> Ver Historial
              </Button>
              {currentBox?.date !== today && (
                <Button
                  className="flex-1 h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => {
                    refetchStatus();
                    window.location.reload();
                  }}
                >
                  <Wallet className="w-4 h-4 mr-2" /> Abrir Caja Hoy
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Si tiene cierre pendiente de aprobación
  if (hasPendingClosing) {
    
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 mb-10">
        <Card className="border-t-4 border-t-blue-500 shadow-xl overflow-hidden">
          <CardHeader className="text-center pb-2 bg-slate-50/50">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
              <Receipt className="w-8 h-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Cierre en Revisión</CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              Tu solicitud de cierre del {today} {currentBox?.turnNumber && `(Turno #${currentBox.turnNumber})`} está siendo revisada por el administrador.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="flex justify-between items-center px-4 py-3 bg-white border border-slate-100 rounded-xl shadow-sm">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Estado Actual</span>
              <Badge className="bg-blue-600 hover:bg-blue-700 font-bold px-3 py-1">
                PENDIENTE DE APROBACIÓN
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-slate-50/50 border-none shadow-none">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-slate-400 font-black uppercase mb-1">Efectivo Declarado</p>
                  <p className="text-2xl font-black text-slate-700">{formatCurrency(currentBox?.reportedCash || 0)}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-50/50 border-none shadow-none">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-slate-400 font-black uppercase mb-1">QR Declarado</p>
                  <p className="text-2xl font-black text-slate-700">{formatCurrency(currentBox?.reportedQr || 0)}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-50/50 border-none shadow-none">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-slate-400 font-black uppercase mb-1">Transf. Declarada</p>
                  <p className="text-2xl font-black text-slate-700">{formatCurrency(currentBox?.reportedTransfer || 0)}</p>
                </CardContent>
              </Card>
            </div>

            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex gap-3 items-start">
               <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
               <p className="text-xs text-blue-800 leading-relaxed font-medium">
                 Mientras el administrador revisa tu cierre, no podrás enviar nuevas solicitudes.
               </p>
            </div>

            <Button 
              variant="outline" 
              className="w-full py-6 border-slate-200 text-slate-600 font-bold hover:bg-slate-50"
              onClick={() => refetchStatus()}
            >
              <History className="w-4 h-4 mr-2" /> Verificar Estado Nuevamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Apertura RECHAZADA — mostrar mensaje y opción de solicitar nueva
  if (hasRejectedOpening) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 mb-10">
        <Card className="border-t-4 border-t-red-500 shadow-xl overflow-hidden">
          <CardHeader className="text-center pb-2 bg-red-50/50">
            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Apertura Rechazada</CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              El administrador rechazó tu solicitud de apertura.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {currentBox?.openingNotes && (
              <div className="p-4 bg-red-50 rounded-xl border border-red-200 flex gap-3 items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-red-700 uppercase mb-1">Motivo del rechazo</p>
                  <p className="text-sm text-red-800">{currentBox.openingNotes}</p>
                </div>
              </div>
            )}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-600 leading-relaxed">
                Puedes solicitar una nueva apertura de caja con el monto correcto.
                El administrador deberá aprobarla nuevamente.
              </p>
            </div>
            <form onSubmit={handleRequestOpening} className="space-y-4">
              <div>
                <Label>Nuevo Efectivo Inicial (cambio)</Label>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-lg font-bold text-slate-400">Bs.</span>
                  <Input
                    type="number" step="0.01" placeholder="0.00"
                    value={openingForm.initialCash}
                    onChange={(e) => setOpeningForm({...openingForm, initialCash: e.target.value})}
                    className="text-xl font-bold" required
                  />
                </div>
              </div>
              <div>
                <Label>Notas (opcional)</Label>
                <Textarea
                  placeholder="Observaciones..."
                  value={openingForm.notes}
                  onChange={(e) => setOpeningForm({...openingForm, notes: e.target.value})}
                  rows={2}
                />
              </div>
              <Button type="submit" className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700" disabled={isSubmitting}>
                {isSubmitting ? "Enviando..." : "Solicitar Nueva Apertura"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Cierre RECHAZADO — volver al dashboard para que el vendedor corrija
  // (closingStatus vuelve a "open" cuando se rechaza, así que esto es por si acaso)
  if (hasRejectedClosing) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 mb-10">
        <Card className="border-t-4 border-t-red-500 shadow-xl overflow-hidden">
          <CardHeader className="text-center pb-2 bg-red-50/50">
            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Cierre Rechazado</CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              El administrador rechazó tu solicitud de cierre.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {currentBox?.closingNotes && (
              <div className="p-4 bg-red-50 rounded-xl border border-red-200 flex gap-3 items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-red-700 uppercase mb-1">Motivo del rechazo</p>
                  <p className="text-sm text-red-800">{currentBox.closingNotes}</p>
                </div>
              </div>
            )}
            <Button
              className="w-full h-14 text-lg font-bold bg-slate-700 hover:bg-slate-800"
              onClick={() => refetchStatus()}
            >
              <History className="w-4 h-4 mr-2" /> Volver a Mi Caja
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Si tiene apertura pendiente de aprobación
  if (hasPendingOpening) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 mb-10">
        <Card className="border-t-4 border-t-amber-500 shadow-xl overflow-hidden">
          <CardHeader className="text-center pb-2 bg-amber-50/50">
            <div className="bg-amber-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
              <Clock className="w-8 h-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Apertura Pendiente</CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              Tu solicitud de apertura {currentBox?.turnNumber && currentBox.turnNumber > 1 && `(Turno #${currentBox.turnNumber})`} está siendo revisada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="flex justify-between items-center px-4 py-3 bg-white border border-slate-100 rounded-xl shadow-sm">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Estado</span>
              <Badge className="bg-amber-600 hover:bg-amber-700 font-bold px-3 py-1">
                ESPERANDO APROBACIÓN
              </Badge>
            </div>

            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex gap-3 items-start">
               <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
               <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                 <strong>Puedes empezar a vender:</strong> Las ventas que realices se registrarán automáticamente en tu caja una vez aprobada.
               </p>
            </div>

            <Button 
              variant="outline" 
              className="w-full py-6 border-slate-200 text-slate-600 font-bold hover:bg-slate-50"
              onClick={() => refetchStatus()}
            >
              <History className="w-4 h-4 mr-2" /> Verificar Estado Nuevamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Si no tiene caja para hoy
  if (!hasBox) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 mb-10">
        <Card className="border-t-4 border-t-slate-400 shadow-xl overflow-hidden">
          <CardHeader className="text-center pb-2 bg-slate-50/50">
            <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
              <Lock className="w-8 h-8 text-slate-600" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">Caja Cerrada</CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              Aún no tienes una caja aperturada para el día {today}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3 items-start">
               <ShieldAlert className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
               <p className="text-xs text-amber-800 leading-relaxed font-medium">
                 Para comenzar tu turno, debes solicitar la apertura de caja. El administrador revisará y aprobará tu solicitud.
               </p>
            </div>

            <form onSubmit={handleRequestOpening} className="space-y-4">
              <div>
                <Label>Efectivo Inicial (cambio)</Label>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-lg font-bold text-slate-400">Bs.</span>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={openingForm.initialCash}
                    onChange={(e) => setOpeningForm({...openingForm, initialCash: e.target.value})}
                    className="text-xl font-bold"
                    required
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">Monto que declaras tener para hacer cambio</p>
              </div>

              <div>
                <Label>Notas (opcional)</Label>
                <Textarea
                  placeholder="Observaciones adicionales..."
                  value={openingForm.notes}
                  onChange={(e) => setOpeningForm({...openingForm, notes: e.target.value})}
                  rows={3}
                />
              </div>

              <Button 
                type="submit"
                className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Enviando..." : "Solicitar Apertura de Caja"}
              </Button>
            </form>

            <Button 
              variant="outline" 
              className="w-full py-6 border-slate-200 text-slate-600 font-bold hover:bg-slate-50"
              onClick={() => refetchStatus()}
            >
              <History className="w-4 h-4 mr-2" /> Verificar Estado
            </Button>
          </CardContent>
        </Card>

        {history && history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Historial de Cajas</CardTitle>
              <CardDescription>Tus cajas anteriores</CardDescription>
            </CardHeader>
            <CardContent>
              <HistoryList history={history} />
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Dashboard principal - Caja Activa
  // currentBox ya está definido arriba como boxStatus?.box
  const totalCash = (currentBox?.salesCash || 0) + (currentBox?.initialCash || 0);
  const totalQr = currentBox?.salesQr || 0;
  const totalTransfer = currentBox?.salesTransfer || 0;
  const totalSales = totalCash + totalQr + totalTransfer - (currentBox?.initialCash || 0);

  // Las entregas y gastos vienen de pendingRequests (objeto con pendingDeliveries y pendingExpenses)
  const deliveries = (pendingRequests as any)?.pendingDeliveries || [];
  const expenses   = (pendingRequests as any)?.pendingExpenses   || [];

  const totalDelivered = deliveries
    .filter((d: any) => d.status === "approved")
    .reduce((sum: number, d: any) => sum + (d.amount || 0), 0);

  const totalExpenses = expenses
    .filter((e: any) => e.status === "approved")
    .reduce((sum: number, e: any) => sum + (e.amount || 0), 0);

  const totalPendingExpenses = expenses
    .filter((e: any) => e.status === "pending")
    .reduce((sum: number, e: any) => sum + (e.amount || 0), 0);

  // El efectivo en caja = inicial + ventas efectivo - entregas aprobadas - gastos aprobados - gastos pendientes ya desembolsados
  const cashInBox = (currentBox?.initialCash || 0)
    + (currentBox?.salesCash || 0)
    - (currentBox?.partialDeliveriesCash || 0)
    - (currentBox?.totalExpenses || 0)
    - totalPendingExpenses;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8 mb-20 md:mb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            Mi Caja {currentBox?.turnNumber && currentBox.turnNumber > 1 && (
              <span className="text-emerald-600">· Turno #{currentBox.turnNumber}</span>
            )}
          </h1>
          <p className="text-slate-500 font-medium">{today}</p>
        </div>
        <Badge
          className={
            !isApproved
              ? "bg-amber-100 text-amber-700 border-amber-200"
              : "bg-emerald-100 text-emerald-700 border-emerald-200"
          }
          variant="outline"
        >
          {!isApproved ? "Apertura Pendiente" : "Caja Activa"}
        </Badge>
      </div>

      {!isApproved && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800 font-medium">
              Tu caja está esperando aprobación del administrador. Puedes empezar a vender mientras tanto.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Resumen de Caja */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-none shadow-xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <p className="text-emerald-100 text-xs font-bold uppercase">Efectivo</p>
                <p className="text-2xl font-black">{formatCurrency(cashInBox)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none shadow-xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl">
                <QrCode className="w-6 h-6" />
              </div>
              <div>
                <p className="text-blue-100 text-xs font-bold uppercase">QR</p>
                <p className="text-2xl font-black">{formatCurrency(totalQr)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-none shadow-xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <p className="text-purple-100 text-xs font-bold uppercase">Transferencia</p>
                <p className="text-2xl font-black">{formatCurrency(totalTransfer)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-700 to-slate-900 text-white border-none shadow-xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-slate-300 text-xs font-bold uppercase">Total Ventas</p>
                <p className="text-2xl font-black">{formatCurrency(totalSales)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Resumen</TabsTrigger>
          <TabsTrigger value="delivery">Entrega Parcial</TabsTrigger>
          <TabsTrigger value="expense">Gastos</TabsTrigger>
          <TabsTrigger value="close">Cierre</TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Entregas Parciales */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Send className="w-5 h-5 text-blue-600" />
                  Entregas Parciales
                </CardTitle>
                <CardDescription>Dinero entregado al administrador</CardDescription>
              </CardHeader>
              <CardContent>
                {deliveries.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">No hay entregas registradas</p>
                ) : (
                  <div className="space-y-2">
                    {deliveries.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="font-bold text-sm">{formatCurrency(d.amount)}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(d.requestDate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                          </p>
                        </div>
                        <Badge variant={d.status === "approved" ? "default" : d.status === "rejected" ? "destructive" : "secondary"}>
                          {d.status === "approved" ? "Aprobada" : d.status === "rejected" ? "Rechazada" : "Pendiente"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 pt-4 border-t">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-sm">Total Entregado:</span>
                    <span className="text-xl font-black text-blue-600">{formatCurrency(totalDelivered)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Gastos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-orange-600" />
                  Gastos
                </CardTitle>
                <CardDescription>Gastos realizados desde tu caja</CardDescription>
              </CardHeader>
              <CardContent>
                {expenses.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">No hay gastos registrados</p>
                ) : (
                  <div className="space-y-2">
                    {expenses.map((e: any) => (
                      <div key={e.id} className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-bold text-sm">{e.concept}</p>
                          <Badge variant={e.status === "approved" ? "default" : e.status === "rejected" ? "destructive" : "secondary"}>
                            {e.status === "approved" ? "Aprobado" : e.status === "rejected" ? "Rechazado" : "Pendiente"}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-500">
                            {new Date(e.requestDate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                          </p>
                          <p className="font-bold text-orange-600">{formatCurrency(e.amount)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 pt-4 border-t">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-sm">Total Gastado:</span>
                    <span className="text-xl font-black text-orange-600">{formatCurrency(totalExpenses)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Información de la Caja */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Información de la Caja
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase">Efectivo Inicial</p>
                  <p className="text-lg font-bold">{formatCurrency(currentBox?.initialCash || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase">Ventas Efectivo</p>
                  <p className="text-lg font-bold text-emerald-600">{formatCurrency(currentBox?.salesCash || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase">Ventas QR</p>
                  <p className="text-lg font-bold text-blue-600">{formatCurrency(currentBox?.salesQr || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase">Ventas Transfer.</p>
                  <p className="text-lg font-bold text-purple-600">{formatCurrency(currentBox?.salesTransfer || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Entrega Parcial Tab */}
        <TabsContent value="delivery">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Solicitar Entrega Parcial</CardTitle>
              <CardDescription>
                Solicita entregar dinero al administrador durante tu turno
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRequestDelivery} className="space-y-4">
                <div>
                  <Label>Monto a Entregar</Label>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-lg font-bold text-slate-400">Bs.</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={deliveryForm.amount}
                      onChange={(e) => setDeliveryForm({...deliveryForm, amount: e.target.value})}
                      className="text-xl font-bold"
                      required
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Efectivo disponible: {formatCurrency(cashInBox)}</p>
                </div>

                <div>
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    placeholder="Observaciones..."
                    value={deliveryForm.notes}
                    onChange={(e) => setDeliveryForm({...deliveryForm, notes: e.target.value})}
                    rows={3}
                  />
                </div>

                <Button 
                  type="submit"
                  className="w-full h-14 text-lg font-bold bg-blue-600 hover:bg-blue-700"
                  disabled={isSubmitting || !canOperate}
                >
                  {isSubmitting ? "Enviando..." : "Solicitar Entrega"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Gastos Tab */}
        <TabsContent value="expense">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Solicitar Gasto</CardTitle>
              <CardDescription>
                Registra gastos que deben ser aprobados por el administrador
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRequestExpense} className="space-y-4">
                <div>
                  <Label>Concepto del Gasto *</Label>
                  <Input
                    type="text"
                    placeholder="Ej: Gasolina, Viáticos, Material..."
                    value={expenseForm.concept}
                    onChange={(e) => setExpenseForm({...expenseForm, concept: e.target.value})}
                    className="font-bold"
                    required
                  />
                </div>

                <div>
                  <Label>Monto del Gasto</Label>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-lg font-bold text-slate-400">Bs.</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={expenseForm.amount}
                      onChange={(e) => setExpenseForm({...expenseForm, amount: e.target.value})}
                      className="text-xl font-bold"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    placeholder="Detalles adicionales..."
                    value={expenseForm.notes}
                    onChange={(e) => setExpenseForm({...expenseForm, notes: e.target.value})}
                    rows={3}
                  />
                </div>

                <Button 
                  type="submit"
                  className="w-full h-14 text-lg font-bold bg-orange-600 hover:bg-orange-700"
                  disabled={isSubmitting || !canOperate}
                >
                  {isSubmitting ? "Enviando..." : "Solicitar Gasto"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cierre Tab */}
        <TabsContent value="close" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-bold">Solicitar Cierre de Caja</CardTitle>
              <CardDescription>
                Declara los montos finales para cerrar tu turno
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRequestClosing} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="flex items-center gap-2 text-emerald-600 font-bold">
                      <Wallet className="w-4 h-4" /> Efectivo Final
                    </Label>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-lg font-bold text-slate-400">Bs.</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={closingForm.reportedCash}
                        onChange={(e) => setClosingForm({...closingForm, reportedCash: e.target.value})}
                        className="text-xl font-bold"
                        required
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Sistema: {formatCurrency(cashInBox)}
                      {totalPendingExpenses > 0 && (
                        <span className="text-amber-600 font-medium ml-1">
                          (deducido {formatCurrency(totalPendingExpenses)} en gastos)
                        </span>
                      )}
                    </p>
                  </div>

                  <div>
                    <Label className="flex items-center gap-2 text-blue-600 font-bold">
                      <QrCode className="w-4 h-4" /> QR Final
                    </Label>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-lg font-bold text-slate-400">Bs.</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={closingForm.reportedQr}
                        onChange={(e) => setClosingForm({...closingForm, reportedQr: e.target.value})}
                        className="text-xl font-bold"
                        required
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Sistema: {formatCurrency(totalQr)}</p>
                  </div>

                  <div>
                    <Label className="flex items-center gap-2 text-purple-600 font-bold">
                      <Landmark className="w-4 h-4" /> Transfer. Final
                    </Label>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-lg font-bold text-slate-400">Bs.</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={closingForm.reportedTransfer}
                        onChange={(e) => setClosingForm({...closingForm, reportedTransfer: e.target.value})}
                        className="text-xl font-bold"
                        required
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Sistema: {formatCurrency(totalTransfer)}</p>
                  </div>
                </div>

                <div>
                  <Label>Justificación de Diferencias (opcional)</Label>
                  <Textarea
                    placeholder="Si hay diferencias, explica el motivo..."
                    value={closingForm.differenceJustification}
                    onChange={(e) => setClosingForm({...closingForm, differenceJustification: e.target.value})}
                    rows={4}
                  />
                </div>

                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-amber-900">Importante</p>
                      <p className="text-xs text-amber-700">
                        El administrador revisará físicamente el dinero antes de aprobar el cierre.
                      </p>
                    </div>
                  </div>
                </div>

                <Button 
                  type="submit"
                  className="w-full h-16 text-xl font-bold bg-red-600 hover:bg-red-700"
                  disabled={isSubmitting || !canOperate}
                >
                  {isSubmitting ? "Enviando..." : "Solicitar Cierre de Caja"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Historial */}
      {history && history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <History className="w-5 h-5" />
              Historial de Cajas
            </CardTitle>
            <CardDescription>Tus cajas anteriores</CardDescription>
          </CardHeader>
          <CardContent>
            <HistoryList history={history} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HistoryList({ history }: { history: any[] }) {
  if (!history || history.length === 0) {
    return <p className="text-sm text-slate-500 italic text-center py-4">No hay historial disponible</p>;
  }

  return (
    <div className="space-y-2">
      {history.slice(0, 10).map((box: any) => {
        const total = (box.salesCash || 0) + (box.salesQr || 0) + (box.salesTransfer || 0);
        const statusLabel = box.closingStatus === "open" ? "Abierta" : "Cerrada";
        const approvalLabel =
          box.openingStatus === "approved" ? "Aprobada" :
          box.openingStatus === "rejected" ? "Rechazada" : "Pendiente";

        return (
          <div key={box.id} className="p-4 border rounded-lg hover:bg-slate-50 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-bold text-sm">Caja #{box.id}</p>
                <p className="text-xs text-slate-500">{new Date(box.openedAt).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <Badge variant={box.closingStatus === "open" ? "default" : "secondary"}>
                  {statusLabel}
                </Badge>
                <Badge
                  variant={
                    box.openingStatus === "approved" ? "default" :
                    box.openingStatus === "rejected" ? "destructive" : "secondary"
                  }
                >
                  {approvalLabel}
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Total Ventas:</span>
              <span className="font-bold">{formatCurrency(total)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
