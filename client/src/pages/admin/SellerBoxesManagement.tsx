import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import {
  Wallet, QrCode, Landmark, CheckCircle2, XCircle,
  AlertCircle, Store, Users, TrendingUp, Receipt,
  Lock, Send, RefreshCw, Eye, Edit, Shield, History,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getLocalDateInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
}

function openingStatusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-500 text-white">Apertura Aprobada</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Apertura Rechazada</Badge>;
  return <Badge className="bg-amber-500 text-white">Apertura Pendiente</Badge>;
}

function closingStatusBadge(status: string) {
  if (status === "approved")      return <Badge className="bg-emerald-600 text-white">Cerrada</Badge>;
  if (status === "pending")       return <Badge className="bg-blue-500 text-white">Cierre Pendiente</Badge>;
  if (status === "forced_closed") return <Badge variant="destructive">Cierre Forzoso</Badge>;
  if (status === "rejected")      return <Badge variant="destructive">Cierre Rechazado</Badge>;
  return <Badge className="bg-slate-500 text-white">Activa</Badge>;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SellerBoxesManagement() {
  const today = getLocalDateInputValue();
  const [filterDate, setFilterDate] = useState(today);
  const [activeTab, setActiveTab] = useState("pending");
  const [expenseFilterStatus, setExpenseFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");

  // Diálogos de aprobación / rechazo
  const [approveDialog, setApproveDialog] = useState<{ open: boolean; type: string; id: number; sellerName: string } | null>(null);
  const [rejectDialog,  setRejectDialog]  = useState<{ open: boolean; type: string; id: number; sellerName: string } | null>(null);
  const [forceCloseDialog, setForceCloseDialog] = useState<{ open: boolean; id: number; sellerName: string } | null>(null);
  const [editDialog, setEditDialog] = useState<{ open: boolean; box: any } | null>(null);
  const [detailDialog, setDetailDialog] = useState<{ open: boolean; box: any; sellerName: string } | null>(null);
  const [openBoxDialog, setOpenBoxDialog] = useState(false);
  const [openBoxForm, setOpenBoxForm] = useState({ sellerId: "", initialCash: "", notes: "", date: today });

  const [actionNotes, setActionNotes]     = useState("");
  const [editAmounts, setEditAmounts]     = useState({ initialCash: "", reportedCash: "", reportedQr: "", reportedTransfer: "", notes: "" });
  const [isSubmitting, setIsSubmitting]   = useState(false);

  const utils = trpc.useUtils();

  // ─── Queries ───────────────────────────────────────────────────────────────
  const { data: pending, refetch: refetchPending } =
    trpc.sellerCash.admin_getPendingRequests.useQuery();

  const { data: allBoxes, refetch: refetchBoxes } =
    trpc.sellerCash.admin_listAllBoxes.useQuery({ date: filterDate, status: "all" });

  const { data: allExpenses } = trpc.sellerCash.admin_listAllExpenses.useQuery({ date: filterDate });

  const { data: sellers, refetch: refetchSellers } = trpc.sellerCash.admin_listSellers.useQuery();

  const invalidateAll = () => {
    utils.sellerCash.admin_getPendingRequests.invalidate();
    utils.sellerCash.admin_listAllBoxes.invalidate();
  };

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const approveOpeningMut   = trpc.sellerCash.admin_approveOpening.useMutation({ onSuccess: () => { toast.success("Apertura aprobada"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const rejectOpeningMut    = trpc.sellerCash.admin_rejectOpening.useMutation({  onSuccess: () => { toast.success("Apertura rechazada"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const approveClosingMut   = trpc.sellerCash.admin_approveClosing.useMutation({ onSuccess: () => { toast.success("Cierre aprobado"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const rejectClosingMut    = trpc.sellerCash.admin_rejectClosing.useMutation({  onSuccess: () => { toast.success("Cierre rechazado"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const approveDeliveryMut  = trpc.sellerCash.admin_approvePartialDelivery.useMutation({ onSuccess: () => { toast.success("Entrega aprobada"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const rejectDeliveryMut   = trpc.sellerCash.admin_rejectPartialDelivery.useMutation({  onSuccess: () => { toast.success("Entrega rechazada"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const approveExpenseMut   = trpc.sellerCash.admin_approveExpense.useMutation({ onSuccess: () => { toast.success("Gasto aprobado"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const rejectExpenseMut    = trpc.sellerCash.admin_rejectExpense.useMutation({  onSuccess: () => { toast.success("Gasto rechazado"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const forceCloseMut       = trpc.sellerCash.admin_forceClose.useMutation({     onSuccess: () => { toast.success("Caja cerrada forzosamente"); invalidateAll(); setForceCloseDialog(null); }, onError: e => toast.error(e.message) });
  const editAmountsMut      = trpc.sellerCash.admin_editAmounts.useMutation({    onSuccess: () => { toast.success("Montos actualizados"); invalidateAll(); setEditDialog(null); }, onError: e => toast.error(e.message) });
  const deleteBoxMut        = trpc.sellerCash.admin_deleteBox.useMutation({      onSuccess: () => { toast.success("Registro eliminado"); invalidateAll(); }, onError: e => toast.error(e.message) });
  const openBoxForSellerMut = trpc.sellerCash.admin_openBoxForSeller.useMutation({
    onSuccess: () => {
      toast.success("Caja abierta correctamente para el vendedor");
      invalidateAll();
      setOpenBoxDialog(false);
      setOpenBoxForm({ sellerId: "", initialCash: "", notes: "", date: today });
    },
    onError: e => toast.error(e.message),
  });

  // ─── Action handlers ───────────────────────────────────────────────────────

  const handleApprove = async () => {
    if (!approveDialog) return;
    setIsSubmitting(true);
    try {
      const notes = actionNotes || undefined;
      switch (approveDialog.type) {
        case "opening":  await approveOpeningMut.mutateAsync({  cashRegisterId: approveDialog.id, notes }); break;
        case "closing":  await approveClosingMut.mutateAsync({  cashRegisterId: approveDialog.id, notes }); break;
        case "delivery": await approveDeliveryMut.mutateAsync({ deliveryId:     approveDialog.id, notes }); break;
        case "expense":  await approveExpenseMut.mutateAsync({  expenseId:      approveDialog.id, notes }); break;
      }
      setApproveDialog(null);
      setActionNotes("");
    } finally { setIsSubmitting(false); }
  };

  const handleReject = async () => {
    if (!rejectDialog) return;
    if (!actionNotes.trim()) { toast.error("Debes ingresar una razón de rechazo"); return; }
    setIsSubmitting(true);
    try {
      const notes = actionNotes;
      switch (rejectDialog.type) {
        case "opening":  await rejectOpeningMut.mutateAsync({  cashRegisterId: rejectDialog.id, notes }); break;
        case "closing":  await rejectClosingMut.mutateAsync({  cashRegisterId: rejectDialog.id, notes }); break;
        case "delivery": await rejectDeliveryMut.mutateAsync({ deliveryId:     rejectDialog.id, notes }); break;
        case "expense":  await rejectExpenseMut.mutateAsync({  expenseId:      rejectDialog.id, notes }); break;
      }
      setRejectDialog(null);
      setActionNotes("");
    } finally { setIsSubmitting(false); }
  };

  const handleForceClose = async () => {
    if (!forceCloseDialog) return;
    if (!actionNotes.trim()) { toast.error("Debes ingresar una razón"); return; }
    setIsSubmitting(true);
    try {
      await forceCloseMut.mutateAsync({ cashRegisterId: forceCloseDialog.id, notes: actionNotes });
      setActionNotes("");
    } finally { setIsSubmitting(false); }
  };

  const handleOpenBoxForSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openBoxForm.sellerId) { toast.error("Selecciona un vendedor"); return; }
    setIsSubmitting(true);
    try {
      await openBoxForSellerMut.mutateAsync({
        sellerId:    parseInt(openBoxForm.sellerId),
        initialCash: parseFloat(openBoxForm.initialCash) || 0,
        notes:       openBoxForm.notes || undefined,
        date:        openBoxForm.date || undefined,
      });
    } finally { setIsSubmitting(false); }
  };

  const handleEditAmounts = async () => {
    if (!editDialog) return;
    if (!editAmounts.notes.trim()) { toast.error("Debes ingresar una razón de edición"); return; }
    setIsSubmitting(true);
    try {
      await editAmountsMut.mutateAsync({
        cashRegisterId: editDialog.box.cashRegister.id,
        initialCash:    editAmounts.initialCash    ? parseFloat(editAmounts.initialCash)    : undefined,
        reportedCash:   editAmounts.reportedCash   ? parseFloat(editAmounts.reportedCash)   : undefined,
        reportedQr:     editAmounts.reportedQr     ? parseFloat(editAmounts.reportedQr)     : undefined,
        reportedTransfer: editAmounts.reportedTransfer ? parseFloat(editAmounts.reportedTransfer) : undefined,
        notes: editAmounts.notes,
      });
    } finally { setIsSubmitting(false); }
  };

  const openApprove = (type: string, id: number, sellerName: string) => {
    setActionNotes("");
    setApproveDialog({ open: true, type, id, sellerName });
  };
  const openReject = (type: string, id: number, sellerName: string) => {
    setActionNotes("");
    setRejectDialog({ open: true, type, id, sellerName });
  };

  // ─── Computed totals ───────────────────────────────────────────────────────
  const totalPending = pending?.totalPending ?? 0;

  const activeBoxes = (allBoxes ?? []).filter(b => b.cashRegister.closingStatus === "open");
  const closedBoxes = (allBoxes ?? []).filter(b => b.cashRegister.closingStatus !== "open");

  // KPI totals across all open boxes
  const totalCash     = activeBoxes.reduce((s, b) => s + (b.cashRegister.salesCash     ?? 0), 0);
  const totalQr       = activeBoxes.reduce((s, b) => s + (b.cashRegister.salesQr       ?? 0), 0);
  const totalTransfer = activeBoxes.reduce((s, b) => s + (b.cashRegister.salesTransfer ?? 0), 0);
  const totalSales    = totalCash + totalQr + totalTransfer;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 mb-20">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Cajas Vendedores</h1>
          <p className="text-slate-500 font-medium">Panel de administración de cajas personales</p>
        </div>
        <div className="flex gap-2">
          <Input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="w-auto font-bold"
          />
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 font-bold gap-2"
            onClick={() => { refetchSellers(); setOpenBoxDialog(true); }}
          >
            <Wallet className="w-4 h-4" /> Abrir Caja a Vendedor
          </Button>
          <Button variant="outline" size="icon" onClick={() => { refetchPending(); refetchBoxes(); }}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-indigo-500 to-indigo-700 text-white border-none shadow-xl">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl"><Users className="w-5 h-5" /></div>
              <div>
                <p className="text-indigo-100 text-[10px] font-bold uppercase tracking-wider">Cajas Activas</p>
                <p className="text-3xl font-black">{activeBoxes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white border-none shadow-xl">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl"><Wallet className="w-5 h-5" /></div>
              <div>
                <p className="text-emerald-100 text-[10px] font-bold uppercase tracking-wider">Efectivo Total</p>
                <p className="text-2xl font-black">{formatCurrency(totalCash)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none shadow-xl">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl"><QrCode className="w-5 h-5" /></div>
              <div>
                <p className="text-blue-100 text-[10px] font-bold uppercase tracking-wider">QR Total</p>
                <p className="text-2xl font-black">{formatCurrency(totalQr)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500 to-amber-700 text-white border-none shadow-xl">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl"><AlertCircle className="w-5 h-5" /></div>
              <div>
                <p className="text-amber-100 text-[10px] font-bold uppercase tracking-wider">Pendientes</p>
                <p className="text-3xl font-black">{totalPending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pending" className="relative">
            Aprobaciones
            {totalPending > 0 && (
              <span className="ml-2 bg-red-500 text-white text-[10px] font-black rounded-full w-5 h-5 inline-flex items-center justify-center">
                {totalPending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="active">Cajas Activas ({activeBoxes.length})</TabsTrigger>
          <TabsTrigger value="expenses">💰 Gastos</TabsTrigger>
          <TabsTrigger value="history">Historial ({closedBoxes.length})</TabsTrigger>
        </TabsList>

        {/* ════════════════════════════════════════════════
            TAB: APROBACIONES PENDIENTES
        ════════════════════════════════════════════════ */}
        <TabsContent value="pending" className="space-y-6 pt-4">

          {totalPending === 0 && (
            <Card className="bg-slate-50 border-dashed">
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-slate-600 font-bold">Sin solicitudes pendientes</p>
                <p className="text-slate-400 text-sm">Todo está al día.</p>
              </CardContent>
            </Card>
          )}

          {/* Aperturas pendientes */}
          {(pending?.pendingOpenings?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Aperturas Pendientes ({pending!.pendingOpenings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Turno</TableHead>
                      <TableHead>Efectivo Inicial</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead>Hora</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending!.pendingOpenings.map(({ cashRegister: cr, seller }) => (
                      <TableRow key={cr.id}>
                        <TableCell className="font-bold">{seller?.name ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-bold text-xs">T{cr.turnNumber || 1}</Badge>
                        </TableCell>
                        <TableCell className="font-mono font-bold text-emerald-700">{formatCurrency(cr.initialCash ?? 0)}</TableCell>
                        <TableCell className="text-sm text-slate-500 max-w-[180px] truncate">{cr.openingNotes ?? "—"}</TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {cr.openedAt ? new Date(cr.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 px-3" onClick={() => openApprove("opening", cr.id, seller?.name ?? "")}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprobar
                            </Button>
                            <Button size="sm" variant="destructive" className="h-8 px-3" onClick={() => openReject("opening", cr.id, seller?.name ?? "")}>
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Rechazar
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => { if (confirm(`¿Eliminar este registro de caja de ${seller?.name}? (monto incorrecto)`)) deleteBoxMut.mutate({ cashRegisterId: cr.id }); }}>
                              🗑
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Cierres pendientes */}
          {(pending?.pendingClosings?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Cierres Pendientes ({pending!.pendingClosings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Ef. Declarado</TableHead>
                      <TableHead>QR Declarado</TableHead>
                      <TableHead>Transf. Declarada</TableHead>
                      <TableHead>Ef. Sistema</TableHead>
                      <TableHead>Dif. Efectivo</TableHead>
                      <TableHead>Dif. QR</TableHead>
                      <TableHead>Dif. Transfer</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending!.pendingClosings.map(({ cashRegister: cr, seller }) => {
                      const sysCash   = (cr.initialCash ?? 0) + (cr.salesCash ?? 0) - (cr.partialDeliveriesCash ?? 0) - (cr.totalExpenses ?? 0);
                      const sysQr     = cr.salesQr ?? 0;
                      const sysTrans  = cr.salesTransfer ?? 0;
                      
                      // Calcular diferencias en tiempo real con respecto al estado actual del sistema
                      const diffCash  = (cr.reportedCash ?? 0) - sysCash;
                      const diffQr    = (cr.reportedQr ?? 0) - sysQr;
                      const diffTrans = (cr.reportedTransfer ?? 0) - sysTrans;
                      
                      const diffCashOk = Math.abs(diffCash) < 100; // < Bs 1
                      const diffQrOk = Math.abs(diffQr) < 100;
                      const diffTransOk = Math.abs(diffTrans) < 100;
                      
                      return (
                        <TableRow key={cr.id}>
                          <TableCell className="font-bold">{seller?.name ?? "—"}</TableCell>
                          <TableCell className="font-mono">{formatCurrency(cr.reportedCash ?? 0)}</TableCell>
                          <TableCell className="font-mono">{formatCurrency(cr.reportedQr ?? 0)}</TableCell>
                          <TableCell className="font-mono">{formatCurrency(cr.reportedTransfer ?? 0)}</TableCell>
                          <TableCell className="font-mono text-slate-500">{formatCurrency(sysCash)}</TableCell>
                          <TableCell>
                            <span className={`font-bold font-mono ${diffCashOk ? "text-emerald-600" : diffCash > 0 ? "text-blue-600" : "text-red-600"}`}>
                              {diffCashOk ? "+Bs. 0,00" : `${diffCash > 0 ? "+" : "-"}${formatCurrency(Math.abs(diffCash))}`}
                              {!diffCashOk && <span className="ml-1 text-[10px]">{diffCash > 0 ? "💰 (Sobrante)" : "⚠️ (Faltante)"}</span>}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`font-bold font-mono ${diffQrOk ? "text-emerald-600" : diffQr > 0 ? "text-blue-600" : "text-red-600"}`}>
                              {diffQrOk ? "+Bs. 0,00" : `${diffQr > 0 ? "+" : "-"}${formatCurrency(Math.abs(diffQr))}`}
                              {!diffQrOk && <span className="ml-1 text-[10px]">{diffQr > 0 ? "💰" : "⚠️"}</span>}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`font-bold font-mono ${diffTransOk ? "text-emerald-600" : diffTrans > 0 ? "text-blue-600" : "text-red-600"}`}>
                              {diffTransOk ? "+Bs. 0,00" : `${diffTrans > 0 ? "+" : "-"}${formatCurrency(Math.abs(diffTrans))}`}
                              {!diffTransOk && <span className="ml-1 text-[10px]">{diffTrans > 0 ? "💰" : "⚠️"}</span>}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 px-3" onClick={() => openApprove("closing", cr.id, seller?.name ?? "")}>
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprobar
                              </Button>
                              <Button size="sm" variant="destructive" className="h-8 px-3" onClick={() => openReject("closing", cr.id, seller?.name ?? "")}>
                                <XCircle className="w-3.5 h-3.5 mr-1" /> Rechazar
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Entregas parciales pendientes */}
          {(pending?.pendingDeliveries?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  Entregas Parciales Pendientes ({pending!.pendingDeliveries.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead>Hora</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending!.pendingDeliveries.map(({ delivery: d, seller }) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-bold">{seller?.name ?? "—"}</TableCell>
                        <TableCell className="font-mono font-bold text-purple-700">{formatCurrency(d.amount ?? 0)}</TableCell>
                        <TableCell className="text-sm text-slate-500 max-w-[160px] truncate">{d.notes ?? "—"}</TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {d.requestDate ? new Date(d.requestDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 px-3" onClick={() => openApprove("delivery", d.id, seller?.name ?? "")}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprobar
                            </Button>
                            <Button size="sm" variant="destructive" className="h-8 px-3" onClick={() => openReject("delivery", d.id, seller?.name ?? "")}>
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Rechazar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Gastos pendientes */}
          {(pending?.pendingExpenses?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  Gastos Pendientes ({pending!.pendingExpenses.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead>Hora</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending!.pendingExpenses.map(({ expense: ex, seller }) => (
                      <TableRow key={ex.id}>
                        <TableCell className="font-bold">{seller?.name ?? "—"}</TableCell>
                        <TableCell className="font-medium">{ex.concept}</TableCell>
                        <TableCell className="font-mono font-bold text-orange-700">{formatCurrency(ex.amount ?? 0)}</TableCell>
                        <TableCell className="text-sm text-slate-500 max-w-[140px] truncate">{ex.notes ?? "—"}</TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {ex.requestDate ? new Date(ex.requestDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 px-3" onClick={() => openApprove("expense", ex.id, seller?.name ?? "")}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprobar
                            </Button>
                            <Button size="sm" variant="destructive" className="h-8 px-3" onClick={() => openReject("expense", ex.id, seller?.name ?? "")}>
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Rechazar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════════
            TAB: CAJAS ACTIVAS
        ════════════════════════════════════════════════ */}
        <TabsContent value="active" className="pt-4">
          {activeBoxes.length === 0 ? (
            <Card className="bg-slate-50 border-dashed">
              <CardContent className="p-12 text-center">
                <Store className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-bold">No hay cajas activas para {filterDate}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {activeBoxes.map(({ cashRegister: cr, seller, branch }) => {
                const totalSalesBs = (cr.salesCash ?? 0) + (cr.salesQr ?? 0) + (cr.salesTransfer ?? 0);
                const cashInBox = (cr.initialCash ?? 0) + (cr.salesCash ?? 0) - (cr.partialDeliveriesCash ?? 0) - (cr.totalExpenses ?? 0);
                return (
                  <Card key={cr.id} className="border border-slate-100 shadow-md hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base font-black">
                            {seller?.name ?? "—"}
                            {cr.turnNumber && cr.turnNumber > 1 && (
                              <span className="text-emerald-600 ml-1">· T{cr.turnNumber}</span>
                            )}
                          </CardTitle>
                          <CardDescription className="text-xs">{branch?.name ?? "—"} · Caja #{cr.id}</CardDescription>
                        </div>
                        {openingStatusBadge(cr.openingStatus ?? "pending")}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-emerald-50 rounded-xl p-2">
                          <p className="text-[9px] text-emerald-600 font-black uppercase">Efectivo</p>
                          <p className="text-sm font-black text-emerald-800">{formatCurrency(cashInBox)}</p>
                        </div>
                        <div className="bg-blue-50 rounded-xl p-2">
                          <p className="text-[9px] text-blue-600 font-black uppercase">QR</p>
                          <p className="text-sm font-black text-blue-800">{formatCurrency(cr.salesQr ?? 0)}</p>
                        </div>
                        <div className="bg-purple-50 rounded-xl p-2">
                          <p className="text-[9px] text-purple-600 font-black uppercase">Transfer</p>
                          <p className="text-sm font-black text-purple-800">{formatCurrency(cr.salesTransfer ?? 0)}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between px-2 py-1 bg-slate-900 rounded-lg text-white">
                        <span className="text-[10px] font-black uppercase tracking-wider">Total Ventas</span>
                        <span className="font-black text-emerald-400">{formatCurrency(totalSalesBs)}</span>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm" variant="outline" className="flex-1 h-8 text-xs"
                          onClick={() => setDetailDialog({ open: true, box: { cashRegister: cr, branch }, sellerName: seller?.name ?? "—" })}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> Ver Detalle
                        </Button>
                        <Button
                          size="sm" variant="outline" className="flex-1 h-8 text-xs"
                          onClick={() => {
                            setEditAmounts({ initialCash: "", reportedCash: "", reportedQr: "", reportedTransfer: "", notes: "" });
                            setEditDialog({ open: true, box: { cashRegister: cr, seller } });
                          }}
                        >
                          <Edit className="w-3.5 h-3.5 mr-1" /> Editar
                        </Button>
                        <Button
                          size="sm" variant="destructive" className="h-8 text-xs px-2"
                          onClick={() => { setActionNotes(""); setForceCloseDialog({ open: true, id: cr.id, sellerName: seller?.name ?? "—" }); }}
                        >
                          <Lock className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════════
            TAB: GASTOS (Reporte Completo)
        ════════════════════════════════════════════════ */}
        <TabsContent value="expenses" className="pt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-orange-600" />
                    Reporte de Gastos
                  </CardTitle>
                  <CardDescription>Control completo de gastos de vendedores</CardDescription>
                </div>
                <div className="flex gap-2">
                  <select
                    className="px-3 py-1.5 border rounded-lg text-sm font-medium"
                    value={expenseFilterStatus}
                    onChange={(e) => setExpenseFilterStatus(e.target.value as any)}
                  >
                    <option value="all">Todos</option>
                    <option value="pending">Pendientes</option>
                    <option value="approved">Aprobados</option>
                    <option value="rejected">Rechazados</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!allExpenses ? (
                <p className="text-center py-8 text-slate-400">Cargando gastos...</p>
              ) : allExpenses.expenses.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="w-16 h-16 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 font-bold">No hay gastos para {filterDate}</p>
                </div>
              ) : (
                <>
                  {/* KPIs */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                      <p className="text-xs text-amber-600 font-bold uppercase">Pendientes</p>
                      <p className="text-2xl font-black text-amber-700">{allExpenses.totals.pending}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                      <p className="text-xs text-emerald-600 font-bold uppercase">Aprobados</p>
                      <p className="text-2xl font-black text-emerald-700">{allExpenses.totals.approved}</p>
                    </div>
                    <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                      <p className="text-xs text-red-600 font-bold uppercase">Rechazados</p>
                      <p className="text-2xl font-black text-red-700">{allExpenses.totals.rejected}</p>
                    </div>
                    <div className="bg-slate-900 rounded-xl p-3">
                      <p className="text-xs text-slate-300 font-bold uppercase">Total Gastado</p>
                      <p className="text-2xl font-black text-emerald-400">{formatCurrency(allExpenses.totals.totalAmount)}</p>
                    </div>
                  </div>

                  {/* Tabla */}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Vendedor</TableHead>
                        <TableHead>Concepto</TableHead>
                        <TableHead>Monto</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Aprobado Por</TableHead>
                        <TableHead>Notas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allExpenses.expenses
                        .filter(({ expense }) => 
                          expenseFilterStatus === "all" || expense.status === expenseFilterStatus
                        )
                        .map(({ expense, seller }) => (
                        <TableRow key={expense.id}>
                          <TableCell className="text-xs text-slate-400 font-mono">{expense.id}</TableCell>
                          <TableCell className="font-bold">{seller?.name ?? "—"}</TableCell>
                          <TableCell className="font-medium">{expense.concept}</TableCell>
                          <TableCell className="font-mono font-bold text-orange-700">{formatCurrency(expense.amount ?? 0)}</TableCell>
                          <TableCell>
                            {expense.status === "approved" && <Badge className="bg-emerald-500">Aprobado</Badge>}
                            {expense.status === "pending" && <Badge className="bg-amber-500">Pendiente</Badge>}
                            {expense.status === "rejected" && <Badge variant="destructive">Rechazado</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {expense.requestDate ? new Date(expense.requestDate).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {expense.approvedBy ? `Admin #${expense.approvedBy}` : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 max-w-[200px] truncate">
                            {expense.adminNotes || expense.notes || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════════════════════════════
            TAB: HISTORIAL
        ════════════════════════════════════════════════ */}
        <TabsContent value="history" className="pt-4">
          {closedBoxes.length === 0 ? (
            <Card className="bg-slate-50 border-dashed">
              <CardContent className="p-12 text-center">
                <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-bold">Sin cajas cerradas para {filterDate}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Turno</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Sucursal</TableHead>
                      <TableHead>Efectivo</TableHead>
                      <TableHead>QR</TableHead>
                      <TableHead>Transfer.</TableHead>
                      <TableHead>Entregas</TableHead>
                      <TableHead>Gastos</TableHead>
                      <TableHead>Total Ventas</TableHead>
                      <TableHead>Estado Apertura</TableHead>
                      <TableHead>Estado Cierre</TableHead>
                      <TableHead>Hora Cierre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedBoxes.map(({ cashRegister: cr, seller, branch }) => {
                      const total = (cr.salesCash ?? 0) + (cr.salesQr ?? 0) + (cr.salesTransfer ?? 0);
                      return (
                        <TableRow key={cr.id}>
                          <TableCell className="text-xs text-slate-400 font-mono">{cr.id}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="font-bold">
                              T{cr.turnNumber || 1}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-bold">{seller?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm text-slate-500">{branch?.name ?? "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{formatCurrency(cr.salesCash ?? 0)}</TableCell>
                          <TableCell className="font-mono text-sm">{formatCurrency(cr.salesQr ?? 0)}</TableCell>
                          <TableCell className="font-mono text-sm">{formatCurrency(cr.salesTransfer ?? 0)}</TableCell>
                          <TableCell className="font-mono text-sm text-red-600">−{formatCurrency(cr.partialDeliveriesCash ?? 0)}</TableCell>
                          <TableCell className="font-mono text-sm text-orange-600 font-bold">−{formatCurrency(cr.totalExpenses ?? 0)}</TableCell>
                          <TableCell className="font-mono font-bold">{formatCurrency(total)}</TableCell>
                          <TableCell>{openingStatusBadge(cr.openingStatus ?? "pending")}</TableCell>
                          <TableCell>{closingStatusBadge(cr.closingStatus ?? "open")}</TableCell>
                          <TableCell className="text-xs text-slate-400">
                            {cr.closedAt ? new Date(cr.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ════════════════════════════════════════════════
          DIALOGS
      ════════════════════════════════════════════════ */}

      {/* Aprobar */}
      <Dialog open={!!approveDialog?.open} onOpenChange={() => setApproveDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Confirmar Aprobación
            </DialogTitle>
            <DialogDescription>
              ¿Aprobar la solicitud de <strong>{approveDialog?.sellerName}</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Notas (opcional)</Label>
            <Textarea
              placeholder="Comentario para el vendedor..."
              value={actionNotes}
              onChange={e => setActionNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialog(null)}>Cancelar</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleApprove} disabled={isSubmitting}>
              {isSubmitting ? "Aprobando..." : "Aprobar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rechazar */}
      <Dialog open={!!rejectDialog?.open} onOpenChange={() => setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" /> Rechazar Solicitud
            </DialogTitle>
            <DialogDescription>
              Rechazar la solicitud de <strong>{rejectDialog?.sellerName}</strong>. Debes indicar el motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Motivo de Rechazo *</Label>
            <Textarea
              placeholder="Explica el motivo del rechazo..."
              value={actionNotes}
              onChange={e => setActionNotes(e.target.value)}
              rows={3}
              required
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReject} disabled={isSubmitting || !actionNotes.trim()}>
              {isSubmitting ? "Rechazando..." : "Rechazar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cierre Forzoso */}
      <Dialog open={!!forceCloseDialog?.open} onOpenChange={() => setForceCloseDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Shield className="w-5 h-5" /> Cierre Forzoso
            </DialogTitle>
            <DialogDescription>
              Cerrar forzosamente la caja de <strong>{forceCloseDialog?.sellerName}</strong>.
              Esta acción no requiere consentimiento del vendedor.
            </DialogDescription>
          </DialogHeader>
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2 items-start">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <p className="text-xs text-red-800 font-medium">Esta acción no se puede deshacer. La caja quedará marcada como "Cierre Forzoso".</p>
          </div>
          <div className="space-y-3">
            <Label>Motivo *</Label>
            <Textarea
              placeholder="Razón del cierre forzoso..."
              value={actionNotes}
              onChange={e => setActionNotes(e.target.value)}
              rows={3}
              required
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForceCloseDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleForceClose} disabled={isSubmitting || !actionNotes.trim()}>
              {isSubmitting ? "Cerrando..." : "Cerrar Forzosamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar Montos */}
      <Dialog open={!!editDialog?.open} onOpenChange={() => setEditDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-blue-600" /> Editar Montos
            </DialogTitle>
            <DialogDescription>
              Corregir montos de la caja de <strong>{editDialog?.box?.seller?.name}</strong>. Deja vacío para no modificar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "initialCash",     label: "Efectivo Inicial",      color: "slate" },
              { key: "reportedCash",    label: "Efectivo Declarado",     color: "emerald" },
              { key: "reportedQr",      label: "QR Declarado",           color: "blue" },
              { key: "reportedTransfer",label: "Transfer. Declarada",    color: "purple" },
            ].map(f => (
              <div key={f.key}>
                <Label className="text-xs font-bold uppercase text-slate-500">{f.label}</Label>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-slate-400 font-bold">Bs.</span>
                  <Input
                    type="number" step="0.01" placeholder="Sin cambio"
                    value={(editAmounts as any)[f.key]}
                    onChange={e => setEditAmounts(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="font-bold"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Razón de la Edición *</Label>
            <Textarea
              placeholder="Explica por qué se editan los montos..."
              value={editAmounts.notes}
              onChange={e => setEditAmounts(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              required
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>Cancelar</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleEditAmounts} disabled={isSubmitting || !editAmounts.notes.trim()}>
              {isSubmitting ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle de Caja */}
      <Dialog open={!!detailDialog?.open} onOpenChange={() => setDetailDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-slate-600" /> Detalle de Caja
            </DialogTitle>
            <DialogDescription>
              <strong>{detailDialog?.sellerName}</strong> · {detailDialog?.box?.branch?.name} · Caja #{detailDialog?.box?.cashRegister?.id}
            </DialogDescription>
          </DialogHeader>
          {detailDialog?.box?.cashRegister && (() => {
            const cr = detailDialog.box.cashRegister;
            const rows = [
              { label: "Efectivo Inicial",         value: cr.initialCash ?? 0,            color: "text-slate-700" },
              { label: "Ventas Efectivo",           value: cr.salesCash ?? 0,              color: "text-emerald-700" },
              { label: "Ventas QR",                 value: cr.salesQr ?? 0,                color: "text-blue-700" },
              { label: "Ventas Transferencia",      value: cr.salesTransfer ?? 0,          color: "text-purple-700" },
              { label: "Entregas Parciales",        value: -(cr.partialDeliveriesCash ?? 0), color: "text-red-600" },
              { label: "Gastos Aprobados",          value: -(cr.totalExpenses ?? 0),       color: "text-red-600" },
            ];
            const cashInBox = (cr.initialCash ?? 0) + (cr.salesCash ?? 0) - (cr.partialDeliveriesCash ?? 0) - (cr.totalExpenses ?? 0);
            return (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  {rows.map(r => (
                    <div key={r.label} className="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
                      <span className="text-sm text-slate-600">{r.label}</span>
                      <span className={`font-bold font-mono text-sm ${r.color}`}>{formatCurrency(Math.abs(r.value))}{r.value < 0 ? " (−)" : ""}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-slate-900 text-white rounded-xl p-4 flex justify-between items-center">
                  <span className="font-black uppercase text-xs tracking-widest">Efectivo en Caja</span>
                  <span className="font-black text-emerald-400 text-xl">{formatCurrency(cashInBox)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                  <div>
                    <p className="font-bold">Estado Apertura</p>
                    <p>{openingStatusBadge(cr.openingStatus ?? "pending")}</p>
                  </div>
                  <div>
                    <p className="font-bold">Estado Cierre</p>
                    <p>{closingStatusBadge(cr.closingStatus ?? "open")}</p>
                  </div>
                  {cr.openingNotes && <div className="col-span-2"><p className="font-bold">Notas Apertura</p><p>{cr.openingNotes}</p></div>}
                  {cr.closingNotes && <div className="col-span-2"><p className="font-bold">Notas Cierre</p><p>{cr.closingNotes}</p></div>}
                  {cr.differenceJustification && <div className="col-span-2"><p className="font-bold text-red-600">Justificación Diferencia</p><p>{cr.differenceJustification}</p></div>}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialog(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Abrir Caja directamente a Vendedor ── */}
      <Dialog open={openBoxDialog} onOpenChange={v => { if (!v) { setOpenBoxDialog(false); setOpenBoxForm({ sellerId: "", initialCash: "", notes: "", date: today }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-emerald-600" /> Abrir Caja a Vendedor
            </DialogTitle>
            <DialogDescription>
              La caja quedará aprobada inmediatamente sin necesidad de que el vendedor la solicite.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleOpenBoxForSeller} className="space-y-4">
            {/* Selector de vendedor */}
            <div className="space-y-1.5">
              <Label>Vendedor *</Label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                value={openBoxForm.sellerId}
                onChange={e => setOpenBoxForm(p => ({ ...p, sellerId: e.target.value }))}
                required
              >
                <option value="">— Selecciona un vendedor —</option>
                {(sellers ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.username} (@{s.username}) {s.role ? `[${s.role === 'seller' ? 'Vendedor' : s.role === 'cashier' ? 'Cajero' : s.role === 'user' ? 'Repartidor' : s.role === 'admin' ? 'Administrador' : s.role}]` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Fecha */}
            <div className="space-y-1.5">
              <Label>Fecha de apertura</Label>
              <Input
                type="date"
                value={openBoxForm.date}
                onChange={e => setOpenBoxForm(p => ({ ...p, date: e.target.value }))}
                className="font-bold"
              />
            </div>

            {/* Efectivo inicial */}
            <div className="space-y-1.5">
              <Label>Efectivo Inicial (cambio)</Label>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-bold">Bs.</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={openBoxForm.initialCash}
                  onChange={e => setOpenBoxForm(p => ({ ...p, initialCash: e.target.value }))}
                  className="font-bold text-lg"
                />
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Textarea
                placeholder="Observaciones sobre la apertura..."
                value={openBoxForm.notes}
                onChange={e => setOpenBoxForm(p => ({ ...p, notes: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex gap-2 items-start">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-800 font-medium">
                La caja se creará con estado <strong>Aprobada</strong> y el vendedor podrá operar inmediatamente.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenBoxDialog(false)}>Cancelar</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={isSubmitting || !openBoxForm.sellerId}>
                {isSubmitting ? "Abriendo..." : "Abrir Caja"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
