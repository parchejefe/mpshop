import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DollarSign, ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Receipt, WalletCards, Wallet, Printer, Eye, FileText, CheckCircle2, XCircle, AlertTriangle, History, Download, X, ArrowRightLeft, QrCode, Landmark, User, BadgeCheck } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, parseInputAmount } from "@/lib/currency";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArqueoDialog } from "@/components/ArqueoDialog";
import { useBranch } from "@/contexts/BranchContext";
import { Link } from "wouter";

function getLocalDateInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().split("T")[0];
}

function getToday() {
  return getLocalDateInputValue();
}

function getWeekAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
}

function getMonthAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split("T")[0];
}

function paymentMethodLabel(method: string) {
  if (method === "cash") return "Efectivo";
  if (method === "qr") return "QR";
  if (method === "transfer") return "Transferencia";
  return method || "—";
}

function categoryLabel(cat: string) {
  const labels: Record<string, string> = {
    // Ingresos
    sale: "Venta",
    sale_local: "Venta Local",
    sale_delivery: "Venta Delivery",
    order_delivery: "Pedido",
    sale_cancellation: "Anulación Venta",
    donation: "Donación",
    loan: "Préstamo",
    gift: "Regalo",
    cash_opening: "🔓 APERTURA DE CAJA",
    other_income: "Otros Ingresos",
    // Egresos operativos
    purchase: "Compra Inventario",
    cash_closure: "🔒 CIERRE DE CAJA",
    fuel: "Combustible",
    subsistence: "Viáticos",
    transfer: "Traspaso",
    transfer_between_registers: "Traspaso Cajas",
    facebook_ads: "Facebook Ads",
    google_ads: "Google Ads",
    electricity: "Luz / Electricidad",
    water: "Agua",
    internet: "Internet",
    telephone: "Teléfono",
    rent: "Alquiler",
    salaries: "Sueldos",
    maintenance: "Mantenimiento",
    supplies: "Insumos",
    taxes: "Impuestos",
    insurance: "Seguro",
    bank_fees: "Comisión Bancaria",
    other: "Otros",
    // Costos directos (nuevos)
    cogs: "📦 COGS – Costo Mercadería",
    repair_cost: "🔧 Costo Reparación",
    warranty_repair_cost: "🛡 Garantía – Reparación",
    warranty_replacement_cost: "🛡 Garantía – Reemplazo",
    warranty_refund: "💸 Garantía – Reembolso al Cliente",
  };
  return labels[cat] || cat;
}


function BoxStatusIndicator({ method, openings, adminUserId, activeUserIds }: { method: string, openings: any[], adminUserId?: number, activeUserIds?: number[] }) {
  // Filter to this payment method
  const methodOpenings = (openings || []).filter(o => o.paymentMethod === method || (!o.paymentMethod && method === "cash"));

  // Separate admin/main box from delivery boxes
  const adminOpenings = adminUserId
    ? methodOpenings.filter(o => o.responsibleUserId === adminUserId)
    : methodOpenings;

  // Only show delivery openings for existing active delivery users
  const deliveryOpenings = adminUserId
    ? methodOpenings.filter(o => {
        if (o.responsibleUserId === adminUserId) return false;
        if (activeUserIds && activeUserIds.length > 0) {
          return activeUserIds.includes(o.responsibleUserId);
        }
        return false;
      })
    : [];

  const adminActiveOpening = adminOpenings.find(o => o.status === "open");
  const adminClosedOpenings = adminOpenings.filter(o => o.status === "closed");
  const deliveryOpen = deliveryOpenings.filter(o => o.status === "open");

  return (
    <div className="space-y-0.5 mt-1">
      {/* Caja Principal */}
      {adminActiveOpening ? (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">ABIERTA · PRINCIPAL</span>
        </div>
      ) : adminClosedOpenings.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400"></span>
          </span>
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">CERRADA</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400"></span>
          </span>
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">CERRADA</span>
        </div>
      )}
      {/* Repartidores con caja abierta (sólo efectivo) */}
      {method === "cash" && deliveryOpen.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
          </span>
          <span className="text-[10px] font-black uppercase tracking-wider text-orange-700">
            {deliveryOpen.length} REPARTIDOR{deliveryOpen.length > 1 ? "ES" : ""} ABIERTO{deliveryOpen.length > 1 ? "S" : ""}
          </span>
        </div>
      )}
    </div>
  );
}


export default function Finance() {
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const { data: transactions, isLoading } = trpc.finance.getTransactions.useQuery();
  const { data: cashOpenings, isLoading: isLoadingOpenings } = trpc.finance.getCashOpenings.useQuery();
  const { data: globalBalances } = trpc.finance.getGlobalBalances.useQuery({ branchId: activeBranchId });
  const { data: currentUser } = trpc.auth.me.useQuery();
  const { data: companyData } = trpc.settings.getCompanyConfig.useQuery();
  const { data: allUsers } = trpc.finance.listResponsibleUsers.useQuery();
  const [cashHistoryOpen, setCashHistoryOpen] = useState(false);
  const [qrHistoryOpen, setQrHistoryOpen] = useState(false);
  const [transferHistoryOpen, setTransferHistoryOpen] = useState(false);

  // IDs of users that still exist in the system (to filter out deleted user openings)
  const activeUserIds = useMemo(
    () => ((allUsers as any[]) || []).map((u: any) => u.id as number),
    [allUsers]
  );

  const baseCashIncome = (transactions as any[])?.filter((t: any) => t.type === "income" && !t.isOpening && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const baseCashExpense = (transactions as any[])?.filter((t: any) => t.type === "expense" && !t.isClosure && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const cashPurchases = (transactions as any[])?.filter((t: any) => t.type === "expense" && !t.isClosure && t.category === "purchase" && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const otherExpenses = (transactions as any[])?.filter((t: any) => t.type === "expense" && !t.isClosure && t.category !== "purchase" && t.category !== "transfer_between_registers" && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const baseCashBalance = baseCashIncome - baseCashExpense;

  const baseQrIncome = (transactions as any[])?.filter((t: any) => t.type === "income" && !t.isOpening && t.paymentMethod === "qr").reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const baseQrExpense = (transactions as any[])?.filter((t: any) => t.type === "expense" && !t.isClosure && t.paymentMethod === "qr").reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const baseQrBalance = baseQrIncome - baseQrExpense;

  const baseTransferIncome = (transactions as any[])?.filter((t: any) => t.type === "income" && !t.isOpening && t.paymentMethod === "transfer").reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const baseTransferExpense = (transactions as any[])?.filter((t: any) => t.type === "expense" && !t.isClosure && t.paymentMethod === "transfer").reduce((sum: number, t: any) => sum + t.amount, 0) || 0;
  const baseTransferBalance = baseTransferIncome - baseTransferExpense;

  const today = getLocalDateInputValue();
  const adminId = (currentUser as any)?.id as number | undefined;

  const activeOpenings = useMemo(
    () => ((cashOpenings as any[]) || []).filter((opening: any) => opening.status === "open"),
    [cashOpenings]
  );

  const totalCashOpenings = ((cashOpenings as any[]) || []).filter((o: any) => o.paymentMethod === "cash" || !o.paymentMethod).reduce((sum: number, o: any) => sum + o.openingAmount, 0);
  const totalQrOpenings = ((cashOpenings as any[]) || []).filter((o: any) => o.paymentMethod === "qr").reduce((sum: number, o: any) => sum + o.openingAmount, 0);
  const totalTransferOpenings = ((cashOpenings as any[]) || []).filter((o: any) => o.paymentMethod === "transfer").reduce((sum: number, o: any) => sum + o.openingAmount, 0);

  // Saldos y Totales unificados que coinciden exactamente con el Historial de cada caja
  const cashBalance = globalBalances?.details?.cash?.balance ?? (baseCashBalance + totalCashOpenings);
  const qrBalance = globalBalances?.details?.qr?.balance ?? (baseQrBalance + totalQrOpenings);
  const transferBalance = globalBalances?.details?.transfer?.balance ?? (baseTransferBalance + totalTransferOpenings);

  const cashIncome = globalBalances?.details?.cash?.totalIncome ?? (baseCashIncome + totalCashOpenings);
  const cashExpense = globalBalances?.details?.cash?.totalExpense ?? baseCashExpense;

  const qrIncome = globalBalances?.details?.qr?.totalIncome ?? (baseQrIncome + totalQrOpenings);
  const qrExpense = globalBalances?.details?.qr?.totalExpense ?? baseQrExpense;

  const transferIncome = globalBalances?.details?.transfer?.totalIncome ?? (baseTransferIncome + totalTransferOpenings);
  const transferExpense = globalBalances?.details?.transfer?.totalExpense ?? baseTransferExpense;

  // Only consider the admin's own opening for enabling/disabling the Arqueo button
  const isAnyBoxOpen = useMemo(() => {
    if (!adminId) return activeOpenings.length > 0;
    return activeOpenings.some((o: any) => o.responsibleUserId === adminId);
  }, [activeOpenings, adminId]);

  const todaysOpenings = useMemo(
    () => ((cashOpenings as any[]) || []).filter((opening: any) => opening.openingDate === today),
    [cashOpenings, today]
  );
  const todaysOpenedAmount = todaysOpenings.reduce((sum: number, o: any) => sum + o.openingAmount, 0);

  // ── DATOS DIARIOS PARA EL CIERRE DE CAJA ─────────────────────────────────
  // Encontrar la apertura activa del admin (o la más reciente del día)
  // y filtrar transacciones DESDE esa apertura para el arqueo diario.
  const activeAdminOpening = useMemo(() => {
    const adminOpenings = activeOpenings.filter(
      (o: any) => !adminId || o.responsibleUserId === adminId
    );
    if (adminOpenings.length === 0) return null;
    // La apertura con createdAt más reciente
    return adminOpenings.reduce((latest: any, o: any) => {
      if (!latest) return o;
      const latestDate = latest.createdAt ? new Date(latest.createdAt).getTime() : 0;
      const oDate = o.createdAt ? new Date(o.createdAt).getTime() : 0;
      return oDate > latestDate ? o : latest;
    }, null);
  }, [activeOpenings, adminId]);

  // Timestamp de la apertura activa (en ms) para filtrar transacciones desde ese momento
  const openingSinceMs = useMemo(() => {
    if (!activeAdminOpening) return 0;
    // Intentar con createdAt (timestamp exacto), luego con openingDate (solo fecha)
    if (activeAdminOpening.createdAt) {
      return new Date(activeAdminOpening.createdAt).getTime();
    }
    if (activeAdminOpening.openingDate) {
      return new Date(`${activeAdminOpening.openingDate}T00:00:00`).getTime();
    }
    return 0;
  }, [activeAdminOpening]);

  // Transacciones SOLO del período actual (desde apertura)
  const dailyTransactions = useMemo(() => {
    if (!openingSinceMs || !(transactions as any[])?.length) return (transactions as any[]) || [];
    return ((transactions as any[]) || []).filter((t: any) => {
      if (!t.createdAt) return true; // si no tiene fecha, incluir
      return new Date(t.createdAt).getTime() >= openingSinceMs;
    });
  }, [transactions, openingSinceMs]);

  // Ingresos y egresos del DÍA (solo período de la apertura activa)
  const dailyCashIncome   = dailyTransactions.filter((t: any) => t.type === "income"  && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((s: number, t: any) => s + t.amount, 0);
  const dailyCashExpense  = dailyTransactions.filter((t: any) => t.type === "expense" && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((s: number, t: any) => s + t.amount, 0);
  const dailyCashPurchases = dailyTransactions.filter((t: any) => t.type === "expense" && t.category === "purchase" && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((s: number, t: any) => s + t.amount, 0);
  const dailyOtherExpenses = dailyTransactions.filter((t: any) => t.type === "expense" && t.category !== "purchase" && t.category !== "transfer_between_registers" && (t.paymentMethod === "cash" || !t.paymentMethod)).reduce((s: number, t: any) => s + t.amount, 0);

  const dailyQrIncome     = dailyTransactions.filter((t: any) => t.type === "income"  && t.paymentMethod === "qr").reduce((s: number, t: any) => s + t.amount, 0);
  const dailyQrExpense    = dailyTransactions.filter((t: any) => t.type === "expense" && t.paymentMethod === "qr").reduce((s: number, t: any) => s + t.amount, 0);

  const dailyTransferIncome  = dailyTransactions.filter((t: any) => t.type === "income"  && t.paymentMethod === "transfer").reduce((s: number, t: any) => s + t.amount, 0);
  const dailyTransferExpense = dailyTransactions.filter((t: any) => t.type === "expense" && t.paymentMethod === "transfer").reduce((s: number, t: any) => s + t.amount, 0);

  // Saldo esperado del día = saldo apertura ACTIVA + movimientos del día
  const activeOpeningCash     = activeAdminOpening?.paymentMethod === "cash" || !activeAdminOpening?.paymentMethod ? (activeAdminOpening?.openingAmount || 0) : 0;
  const activeOpeningQr       = activeAdminOpening?.paymentMethod === "qr" ? (activeAdminOpening?.openingAmount || 0) : 0;
  const activeOpeningTransfer = activeAdminOpening?.paymentMethod === "transfer" ? (activeAdminOpening?.openingAmount || 0) : 0;

  const expectedDailyCash     = activeOpeningCash     + dailyCashIncome     - dailyCashExpense;
  const expectedDailyQr       = activeOpeningQr       + dailyQrIncome       - dailyQrExpense;
  const expectedDailyTransfer = activeOpeningTransfer + dailyTransferIncome - dailyTransferExpense;

  return (

    <div className="p-3 sm:p-4 md:p-6 space-y-5 max-w-5xl mx-auto mb-20 md:mb-10 min-h-full">
      {/* Header */}
      <div className="flex flex-col gap-3 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight"><span className="text-green-600">Finanzas</span></h1>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-1 shadow-sm">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">Sucursal:</span>
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
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Resumen de ingresos, egresos y rentabilidad.</p>
          </div>
        </div>
        {/* Action buttons - scrollable row on mobile */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none flex-nowrap">
          <ArqueoDialog
            expectedCash={expectedDailyCash}
            expectedQr={expectedDailyQr}
            expectedTransfer={expectedDailyTransfer}
            disabled={!isAnyBoxOpen}
            branchName={branches.find((b: any) => b.id === activeBranchId)?.name}
            companyConfig={companyData}
            openingAmount={activeOpeningCash}
            cashSales={dailyCashIncome}
            cashPurchases={dailyCashPurchases}
            otherExpenses={dailyOtherExpenses}
          />
          <TransferDialog />
          <OpenCashDialog />
          <AddIncomeDialog />
          <Link href="/expenses">
            <Button className="gap-2 bg-slate-900 hover:bg-slate-800 text-white h-10 px-3 sm:px-4 whitespace-nowrap text-xs sm:text-sm">
              <Receipt className="h-4 w-4 shrink-0" /> <span className="hidden sm:inline">Módulo de</span> Gastos
            </Button>
          </Link>
        </div>
      </div>


      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {/* Caja Efectivo */}
        <Card className="relative overflow-hidden border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[2.5rem] bg-white group transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-500" />
          <CardHeader className="flex flex-col pb-2">
            <div className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 rounded-2xl text-emerald-600">
                  <Wallet className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black tracking-tight text-slate-800">Caja Efectivo</CardTitle>
                  <BoxStatusIndicator method="cash" openings={todaysOpenings} adminUserId={(currentUser as any)?.id} activeUserIds={activeUserIds} />
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 rounded-2xl hover:bg-emerald-50 hover:text-emerald-600 transition-all"
                onClick={() => setCashHistoryOpen(true)}
              >
                <History className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Saldo Disponible</span>
              <div className={`text-3xl font-black tracking-tighter ${cashBalance < 0 ? "text-red-600" : "text-emerald-600"}`}>
                {formatCurrency(cashBalance)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-50">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Ingresos</p>
                <p className="text-sm font-bold text-emerald-600">{formatCurrency(cashIncome)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Egresos</p>
                <p className="text-sm font-bold text-red-500">{formatCurrency(cashExpense)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Caja QR */}
        <Card className="relative overflow-hidden border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[2.5rem] bg-white group transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-500" />
          <CardHeader className="flex flex-col pb-2">
            <div className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 rounded-2xl text-blue-600">
                  <QrCode className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black tracking-tight text-slate-800">Caja QR</CardTitle>
                  <BoxStatusIndicator method="qr" openings={todaysOpenings} adminUserId={(currentUser as any)?.id} activeUserIds={activeUserIds} />
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 rounded-2xl hover:bg-blue-50 hover:text-blue-600 transition-all"
                onClick={() => setQrHistoryOpen(true)}
              >
                <History className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Saldo Disponible</span>
              <div className={`text-3xl font-black tracking-tighter ${qrBalance < 0 ? "text-red-600" : "text-blue-600"}`}>
                {formatCurrency(qrBalance)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-50">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Ingresos</p>
                <p className="text-sm font-bold text-emerald-600">{formatCurrency(qrIncome)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Egresos</p>
                <p className="text-sm font-bold text-red-500">{formatCurrency(qrExpense)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cuenta Bancaria */}
        <Card className="relative overflow-hidden border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[2.5rem] bg-white group transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-purple-500" />
          <CardHeader className="flex flex-col pb-2">
            <div className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-50 rounded-2xl text-purple-600">
                  <Landmark className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black tracking-tight text-slate-800">Cta. Bancaria</CardTitle>
                  <BoxStatusIndicator method="transfer" openings={todaysOpenings} adminUserId={(currentUser as any)?.id} activeUserIds={activeUserIds} />
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 rounded-2xl hover:bg-purple-50 hover:text-purple-600 transition-all"
                onClick={() => setTransferHistoryOpen(true)}
              >
                <History className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Saldo Disponible</span>
              <div className={`text-3xl font-black tracking-tighter ${transferBalance < 0 ? "text-red-600" : "text-purple-600"}`}>
                {formatCurrency(transferBalance)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-50">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Ingresos</p>
                <p className="text-sm font-bold text-emerald-600">{formatCurrency(transferIncome)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Egresos</p>
                <p className="text-sm font-bold text-red-500">{formatCurrency(transferExpense)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modales de Historial */}
      <BoxHistoryModal paymentMethod="cash" title="Caja Efectivo" colorClass="emerald" open={cashHistoryOpen} onOpenChange={setCashHistoryOpen} branchId={activeBranchId} />
      <BoxHistoryModal paymentMethod="qr" title="Caja QR" colorClass="blue" open={qrHistoryOpen} onOpenChange={setQrHistoryOpen} branchId={activeBranchId} />
      <BoxHistoryModal paymentMethod="transfer" title="Cuenta Bancaria" colorClass="purple" open={transferHistoryOpen} onOpenChange={setTransferHistoryOpen} branchId={activeBranchId} />



      <Tabs defaultValue="transactions" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-8 bg-slate-100/50 p-1.5 rounded-[1.5rem] h-14">
          <TabsTrigger value="transactions" className="rounded-xl font-bold text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all h-full">
            <Receipt className="h-4 w-4 mr-2" />
            Libro de Transacciones
          </TabsTrigger>
          <TabsTrigger value="closures" className="rounded-xl font-bold text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all h-full">
            <BadgeCheck className="h-4 w-4 mr-2" />
            Cierres de Repartidores
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[2.5rem] bg-white overflow-hidden">
            <CardHeader className="bg-slate-50/30 pb-6 border-b border-slate-50">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 font-black text-slate-800 text-xl">
                    Libro de Movimientos
                  </CardTitle>
                  <CardDescription className="font-medium text-slate-500">Historial de todas las operaciones económicas.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                   <div className="hidden sm:flex bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm items-center gap-4 px-6 h-12">
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Saldo Total</p>
                        <p className="text-sm font-black text-slate-900">{formatCurrency(cashBalance + qrBalance + transferBalance)}</p>
                      </div>
                      <div className="w-px h-6 bg-slate-100" />
                      <div className="text-right">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Movimientos</p>
                        <p className="text-sm font-black text-slate-900">{transactions?.length || 0}</p>
                      </div>
                   </div>
                   <Button variant="outline" className="h-12 rounded-xl bg-white border-slate-200 shadow-sm gap-2 font-bold no-print" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" /> Imprimir
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-12 space-y-4">
                  {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-slate-50 animate-pulse rounded-[1.5rem]" />)}
                </div>
              ) : (
                <div className="p-4 sm:p-6" id="transactions-book">
                   <div className="space-y-4">
                      {(transactions as any[])?.map((t: any) => (
                        <div key={t.id} className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-[1.5rem] bg-white border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-all group">
                           <div className="flex items-center gap-4 flex-1">
                              <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${t.type === 'income' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                 {t.type === 'income' ? <ArrowUpRight className="h-6 w-6" /> : <ArrowDownRight className="h-6 w-6" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                 <div className="flex items-center gap-2 mb-0.5">
                                    <p className="font-black text-slate-800 text-sm">{categoryLabel(t.category)}</p>
                                    <Badge variant="outline" className={`text-[8px] font-black uppercase tracking-widest border-none px-1.5 h-4 flex items-center ${t.paymentMethod === 'cash' ? 'bg-emerald-100 text-emerald-700' : t.paymentMethod === 'qr' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                       {paymentMethodLabel(t.paymentMethod)}
                                    </Badge>
                                 </div>
                                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                    {new Date(t.createdAt).toLocaleDateString()} · {new Date(t.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                 </p>
                              </div>
                           </div>
                           <div className="flex items-center justify-between sm:justify-end gap-6 border-t sm:border-none pt-3 sm:pt-0">
                              <div className="text-left sm:text-right">
                                 <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Saldo Posterior</p>
                                 <p className="text-xs font-bold text-slate-400 font-mono">{formatCurrency(t.runningBalance)}</p>
                              </div>
                              <div className="text-right">
                                 <p className={`text-lg font-black font-mono tracking-tighter ${t.type === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                                 </p>
                              </div>
                           </div>
                        </div>
                      ))}
                   </div>
                  {transactions?.length === 0 && (
                    <div className="py-20 text-center bg-slate-50/50 rounded-[2.5rem] border-dashed border-2">
                       <Receipt className="h-12 w-12 text-slate-200 mx-auto mb-4" />
                       <p className="text-sm font-bold text-slate-400 italic">No hay transacciones registradas todavia.</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="closures">
          <CashClosuresAdmin />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// MODAL DE HISTORIAL POR CAJA
// ============================================================
interface BoxHistoryModalProps {
  paymentMethod: "cash" | "qr" | "transfer";
  title: string;
  colorClass: "emerald" | "blue" | "purple";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: number;
}

function BoxHistoryModal({ paymentMethod, title, colorClass, open, onOpenChange, branchId }: BoxHistoryModalProps) {
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "custom">("month");
  const [startDate, setStartDate] = useState(getMonthAgo());
  const [endDate, setEndDate] = useState(getToday());
  const [showPrintArea, setShowPrintArea] = useState(false);

  // Reset dates when modal opens with "month" preset
  useEffect(() => {
    if (open && dateRange === "month") {
      setStartDate(getMonthAgo());
      setEndDate(getToday());
    }
  }, [open]);

  const colorStyles: Record<string, { bg: string; border: string; text: string; light: string }> = {
    emerald: { bg: "bg-emerald-600", border: "border-emerald-200", text: "text-emerald-700", light: "bg-emerald-50" },
    blue: { bg: "bg-blue-600", border: "border-blue-200", text: "text-blue-700", light: "bg-blue-50" },
    purple: { bg: "bg-purple-600", border: "border-purple-200", text: "text-purple-700", light: "bg-purple-50" },
  };

  const colors = colorStyles[colorClass];

  const { data, isLoading, refetch } = trpc.finance.getBoxHistory.useQuery(
    { paymentMethod, startDate, endDate, type: filter, branchId },
    { enabled: open }
  );


  useEffect(() => {
    if (open) {
      refetch();
    }
  }, [open, filter, startDate, endDate, refetch]);

  useEffect(() => {
    if (!open) return;
    switch (dateRange) {
      case "today":
        setStartDate(getToday());
        setEndDate(getToday());
        break;
      case "week":
        setStartDate(getWeekAgo());
        setEndDate(getToday());
        break;
      case "month":
        setStartDate(getMonthAgo());
        setEndDate(getToday());
        break;
    }
  }, [dateRange, open]);

  const handleExportCsv = () => {
    if (!data?.transactions) return;

    const headers = ["Fecha", "Hora", "Usuario", "Tipo", "Categoría", "Referencia", "Método", "Monto", "Ingreso", "Egreso", "Saldo", "Notas"];
    const rows = data.transactions.map((t: any) => [
      new Date(t.createdAt).toLocaleDateString("es-BO"),
      new Date(t.createdAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" }),
      `Usuario #${t.userId || "—"}`,
      t.type === "income" ? "Ingreso" : "Egreso",
      categoryLabel(t.category),
      t.referenceId ? `#${t.referenceId}` : "—",
      paymentMethodLabel(paymentMethod),
      (t.amount / 100).toFixed(2),
      t.type === "income" ? (t.amount / 100).toFixed(2) : "",
      t.type === "expense" ? (t.amount / 100).toFixed(2) : "",
      (t.runningBalance / 100).toFixed(2),
      t.notes || "",
    ]);

    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(title || "Reporte").replace(/\s+/g, "_")}_${startDate}_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    setShowPrintArea(true);
    setTimeout(() => {
      window.print();
      setShowPrintArea(false);
    }, 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !translate-x-0 !translate-y-0 !w-full !max-w-none !h-full sm:!inset-auto sm:!top-[50%] sm:!left-[50%] sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:!h-[95vh] sm:!max-w-4xl flex flex-col p-0 overflow-hidden rounded-none sm:rounded-[1.5rem] border-none sm:border bg-white" showCloseButton={false}>
        <div className={`${colors.light} p-4 sm:p-6 border-b ${colors.border} shrink-0`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 md:p-3 rounded-2xl ${colors.bg} text-white shadow-lg`}>
                <History className="h-5 w-5 md:h-6 md:w-6" />
              </div>
              <div>
                <h3 className={`text-lg md:text-2xl font-black tracking-tight ${colors.text}`}>Historial {title}</h3>
                <p className="text-[10px] md:text-xs font-bold text-muted-foreground/60 flex items-center gap-1.5 uppercase tracking-widest">
                  <span className={`inline-block w-2 h-2 rounded-full ${colors.bg} opacity-50`} />
                  Flujo de caja detallado
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-2xl hover:bg-black/5 transition-colors h-10 w-10"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-6 w-6 text-slate-500" />
            </Button>
          </div>
        </div>

        {/* Filtros y Resumen */}
        <div className="p-4 md:p-6 border-b bg-white/50 backdrop-blur-sm space-y-4 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50 flex items-center">
              <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
                <SelectTrigger className="flex-1 border-none shadow-none focus:ring-0 font-bold text-xs h-9 bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-slate-100 shadow-xl">
                  <SelectItem value="today" className="rounded-xl font-bold">Hoy</SelectItem>
                  <SelectItem value="week" className="rounded-xl font-bold">Última semana</SelectItem>
                  <SelectItem value="month" className="rounded-xl font-bold">Último mes</SelectItem>
                  <SelectItem value="custom" className="rounded-xl font-bold">Personalizado</SelectItem>
                </SelectContent>
              </Select>

              {dateRange === "custom" && (
                <div className="flex items-center gap-1 px-2 border-l border-slate-200 ml-1">
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-[100px] border-none h-7 shadow-none focus-visible:ring-0 px-1 text-[10px] font-bold bg-transparent"
                  />
                  <span className="text-slate-400 font-bold">—</span>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-[100px] border-none h-7 shadow-none focus-visible:ring-0 px-1 text-[10px] font-bold bg-transparent"
                  />
                </div>
              )}
            </div>

            <div className="flex bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50">
              <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                <SelectTrigger className="w-full sm:w-36 border-none shadow-none focus:ring-0 font-bold text-xs h-9 bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-slate-100 shadow-xl">
                  <SelectItem value="all" className="rounded-xl font-bold">Todas</SelectItem>
                  <SelectItem value="income" className="rounded-xl font-bold">Ingresos</SelectItem>
                  <SelectItem value="expense" className="rounded-xl font-bold">Egresos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Totales Cards - Mobile Optimized */}
          {data && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4">
              <div className="bg-emerald-50/50 p-3 md:p-4 rounded-2xl border border-emerald-100 shadow-sm">
                <p className="text-[9px] uppercase font-black text-emerald-600 tracking-widest mb-1">Ingresos</p>
                <p className="text-lg md:text-2xl font-black text-emerald-700 tracking-tighter">{formatCurrency(data.summary.totalIncome)}</p>
              </div>

              <div className={`p-3 md:p-4 rounded-2xl border shadow-sm ${data.summary.finalBalance >= 0 ? "border-slate-800 bg-slate-900" : "border-red-800 bg-red-900"}`}>
                <p className="text-[9px] uppercase font-black text-slate-400 tracking-widest mb-1">Saldo Actual</p>
                <p className="text-lg md:text-2xl font-black text-white tracking-tighter">{formatCurrency(data.summary.finalBalance)}</p>
              </div>

              <div className="col-span-2 md:col-span-1 bg-red-50/50 p-3 md:p-4 rounded-2xl border border-red-100 shadow-sm">
                <p className="text-[9px] uppercase font-black text-red-600 tracking-widest mb-1">Egresos</p>
                <p className="text-lg md:text-2xl font-black text-red-700 tracking-tighter">{formatCurrency(data.summary.totalExpense)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Lista de Transacciones - Mobile Optimized */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y scrollbar-thin scrollbar-thumb-slate-200 bg-slate-50/20" style={{ WebkitOverflowScrolling: 'touch' }}>

          {isLoading ? (
            <div className="p-12 text-center flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-slate-900" />
              <p className="text-sm font-black uppercase tracking-widest text-slate-400">Cargando movimientos...</p>
            </div>
          ) : data?.transactions.length === 0 ? (
            <div className="p-20 text-center flex flex-col items-center gap-4">
              <div className="p-6 rounded-[2rem] bg-white shadow-sm text-slate-200">
                <History className="h-12 w-12" />
              </div>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sin transacciones en este periodo</p>
            </div>
          ) : (
            <>
              {/* Vista Mobile: Cards */}
              <div className="block md:hidden">
                {data?.transactions.map((t: any) => (
                  <div key={t.id} className="p-5 bg-white border-b border-slate-100 active:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                           <div className={`h-2 w-2 rounded-full shrink-0 ${t.type === "income" ? "bg-emerald-500" : "bg-red-500"}`} />
                           <span className="font-black text-slate-900 text-sm truncate uppercase tracking-tight">{categoryLabel(t.category)}</span>
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                          {new Date(t.createdAt).toLocaleDateString("es-BO")} · {new Date(t.createdAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-base font-black font-mono leading-none mb-1 ${t.type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                          {t.type === "income" ? "+" : "-"}{formatCurrency(t.amount)}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                          Saldo: {formatCurrency(t.runningBalance)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-3 flex flex-col gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100/50">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-black text-slate-400 uppercase tracking-widest">Responsable</span>
                        <span className="font-bold text-slate-700">{t.userName || t.responsibleUserName || `Usuario #${t.userId || "—"}`}</span>
                      </div>
                      {(t.referenceId || t.notes) && (
                        <div className="flex flex-col gap-0.5 pt-1 border-t border-slate-200/50">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Referencia / Notas</span>
                          <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                            {t.referenceId ? <span className="font-bold text-primary mr-1">#{t.referenceId}</span> : ""}
                            {t.notes || "Sin notas adicionales"}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Vista Desktop: Table */}
              <div className="hidden md:block">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th className="text-left px-6 py-5 font-black text-slate-400 uppercase text-[10px] tracking-widest bg-slate-50/95 backdrop-blur-sm border-b">Fecha / Hora</th>
                      <th className="text-left px-6 py-5 font-black text-slate-400 uppercase text-[10px] tracking-widest bg-slate-50/95 backdrop-blur-sm border-b">Detalle y Usuario</th>
                      <th className="text-right px-6 py-5 font-black text-slate-400 uppercase text-[10px] tracking-widest bg-slate-50/95 backdrop-blur-sm border-b">Monto</th>
                      <th className="text-right px-6 py-5 font-black text-slate-400 uppercase text-[10px] tracking-widest bg-slate-50/95 backdrop-blur-sm border-b pr-8">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data?.transactions.map((t: any) => (
                      <tr key={t.id} className="group hover:bg-white transition-colors">
                        <td className="px-6 py-5 whitespace-nowrap">
                          <div className="font-black text-slate-900">{new Date(t.createdAt).toLocaleDateString("es-BO")}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{new Date(t.createdAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`w-2 h-2 rounded-full ${t.type === "income" ? "bg-emerald-500" : "bg-red-500"}`} />
                            <span className="font-black text-slate-800 uppercase tracking-tight">{categoryLabel(t.category)}</span>
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold">{t.userName || t.responsibleUserName || (t.userId ? `ID: ${t.userId}` : "Administrador")}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium max-w-md line-clamp-2">
                            {t.referenceId ? <span className="font-bold text-primary mr-1">#{t.referenceId}</span> : ""}
                            {t.notes}
                          </div>
                        </td>
                        <td className={`px-6 py-5 text-right font-mono font-black text-lg whitespace-nowrap ${t.type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                          {t.type === "income" ? `+${formatCurrency(t.amount)}` : `-${formatCurrency(t.amount)}`}
                        </td>
                        <td className="px-6 py-5 text-right pr-8 whitespace-nowrap">
                           <span className={`inline-block font-black font-mono text-base ${t.runningBalance >= 0 ? "text-slate-900" : "text-red-700"}`}>
                            {formatCurrency(t.runningBalance)}
                           </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Acciones */}
        <div className="p-4 md:p-6 border-t bg-slate-50 flex flex-row items-center justify-between gap-3 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="hidden md:flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-slate-300"></span>
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              {data?.transactions.length || 0} registros encontrados
            </span>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleExportCsv} 
              className="flex-1 md:flex-initial gap-2 bg-white font-bold text-slate-700 shadow-sm text-[10px] h-10 rounded-xl border-slate-200"
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handlePrint} 
              className="flex-1 md:flex-initial gap-2 bg-white font-bold text-slate-700 shadow-sm text-[10px] h-10 rounded-xl border-slate-200"
            >
              <Printer className="h-4 w-4" /> PDF
            </Button>
            <Button
              variant="default"
              size="sm"
              className="flex-1 md:flex-initial font-black uppercase tracking-widest text-[10px] px-8 h-10 rounded-xl bg-slate-900 hover:bg-slate-800"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
          </div>
        </div>

        {/* Área de impresión */}
        {showPrintArea && (
          <div className="hidden print:block p-8" id={`print-area-${paymentMethod}`}>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold uppercase">Historial de {title}</h1>
              <p className="text-sm">Del {startDate} al {endDate}</p>
            </div>
            <table className="w-full text-sm border-collapse mb-4">
              <thead>
                <tr className="bg-gray-100 border">
                  <th className="p-2 text-left border">Fecha/Hora</th>
                  <th className="p-2 text-left border">Tipo</th>
                  <th className="p-2 text-left border">Categoría</th>
                  <th className="p-2 text-right border">Ingreso</th>
                  <th className="p-2 text-right border">Egreso</th>
                  <th className="p-2 text-right border">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data?.transactions.map((t: any) => (
                  <tr key={t.id}>
                    <td className="p-2 border">
                      {new Date(t.createdAt).toLocaleDateString("es-BO")}{" "}
                      {new Date(t.createdAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="p-2 border">{t.type === "income" ? "Ingreso" : "Egreso"}</td>
                    <td className="p-2 border">{categoryLabel(t.category)}</td>
                    <td className="p-2 text-right border text-green-600">
                      {t.type === "income" ? formatCurrency(t.amount) : ""}
                    </td>
                    <td className="p-2 text-right border text-red-600">
                      {t.type === "expense" ? formatCurrency(t.amount) : ""}
                    </td>
                    <td className="p-2 text-right border font-bold">{formatCurrency(t.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold">
                  <td className="p-2 border" colSpan={3}>TOTALES</td>
                  <td className="p-2 text-right border text-green-600">{formatCurrency(data?.summary.totalIncome || 0)}</td>
                  <td className="p-2 text-right border text-red-600">{formatCurrency(data?.summary.totalExpense || 0)}</td>
                  <td className="p-2 text-right border">{formatCurrency(data?.summary.finalBalance || 0)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="text-center text-xs text-gray-400 mt-4">
              Generado por MP Shop App - {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// DIÁLOGOS EXISTENTES (OpenCashDialog, AddExpenseDialog, etc.)
// ============================================================

function OpenCashDialog() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: responsibleUsers } = trpc.finance.listResponsibleUsers.useQuery(undefined, { enabled: open });
  const [form, setForm] = useState({
    openingAmount: "",
    paymentMethod: "cash",
    openingDate: getLocalDateInputValue(),
    responsibleUserId: "",
  });

  useEffect(() => {
    if (!open) return;
    if (form.responsibleUserId) return;
    const firstUser = (responsibleUsers as any[])?.[0];
    if (firstUser) setForm((current) => ({ ...current, responsibleUserId: String(firstUser.id) }));
  }, [open, responsibleUsers, form.responsibleUserId]);

  const mutation = trpc.finance.openCashRegister.useMutation({
    onSuccess: () => {
      toast.success("Apertura de caja registrada");
      setOpen(false);
      setForm({ openingAmount: "", paymentMethod: "cash", openingDate: getLocalDateInputValue(), responsibleUserId: "" });
      void utils.finance.getCashOpenings.invalidate();
    },
    onError: (error) => toast.error(error.message || "No se pudo registrar la apertura de caja"),
  });

  const handleSubmit = () => {
    const openingAmount = parseInputAmount(form.openingAmount);
    if (Number.isNaN(openingAmount) || openingAmount < 0) { toast.error("Ingresa un fondo inicial valido"); return; }
    if (!form.openingDate) { toast.error("Selecciona la fecha de apertura"); return; }
    if (!form.responsibleUserId) { toast.error("Selecciona el usuario responsable"); return; }
    mutation.mutate({
      openingAmount: Math.round(openingAmount * 100), paymentMethod: form.paymentMethod as "cash" | "qr" | "transfer",
      openingDate: form.openingDate, responsibleUserId: parseInt(form.responsibleUserId, 10),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="gap-2">
          <WalletCards className="h-4 w-4" /> Apertura de Caja
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apertura de Caja</DialogTitle>
          <DialogDescription>Registra fondo inicial, fecha de apertura y usuario responsable.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2"><Label htmlFor="openingAmount">Fondo inicial</Label>
            <Input id="openingAmount" type="text" inputMode="decimal" onFocus={(e) => e.target.select()} placeholder="0.00" value={form.openingAmount} onChange={(e) => setForm({ ...form, openingAmount: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="paymentMethod">Caja a Aperturar</Label>
            <Select value={form.paymentMethod} onValueChange={(val: any) => setForm({ ...form, paymentMethod: val })}>
              <SelectTrigger id="paymentMethod"><SelectValue placeholder="Seleccione Caja" /></SelectTrigger>
              <SelectContent><SelectItem value="cash">Efectivo</SelectItem><SelectItem value="qr">Caja QR</SelectItem><SelectItem value="transfer">Cuenta Bancaria</SelectItem></SelectContent>
            </Select></div>
          <div className="space-y-2"><Label htmlFor="openingDate">F. de apertura</Label>
            <Input id="openingDate" type="date" value={form.openingDate} onChange={(e) => setForm({ ...form, openingDate: e.target.value })} /></div>
          <div className="space-y-2"><Label>Usuario Resp.</Label>
            <Select value={form.responsibleUserId} onValueChange={(value) => setForm({ ...form, responsibleUserId: value })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar responsable" /></SelectTrigger>
              <SelectContent>{((responsibleUsers as any[]) || []).map((user: any) => (
                <SelectItem key={user.id} value={String(user.id)}>{user.name || user.username || `Usuario #${user.id}`}</SelectItem>
              ))}</SelectContent>
            </Select></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>{mutation.isPending ? "Aperturando..." : "Aperturar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CashClosuresAdmin() {
  const { data: closures, isLoading, refetch } = trpc.finance.listAllClosures.useQuery();
  const utils = trpc.useUtils();
  const updateMutation = trpc.finance.updateClosureStatus.useMutation({
    onSuccess: () => { toast.success("Cierre actualizado y nueva caja abierta"); refetch(); utils.finance.getCashOpenings.invalidate(); },
    onError: (err) => toast.error(`Error: ${err.message}`)
  });
  const repairMutation = trpc.finance.repairClosure.useMutation({
    onSuccess: () => { toast.success("Cierre reparado. Recarga el historial."); refetch(); utils.finance.getBoxHistory.invalidate(); },
    onError: (err) => toast.error(`Error al reparar: ${err.message}`)
  });
  const cleanupMutation = trpc.finance.cleanupDuplicateClosures.useMutation({
    onSuccess: (res: any) => { toast.success(`Limpieza completada: ${res.deleted} duplicados eliminados.`); refetch(); utils.finance.getBoxHistory.invalidate(); },
    onError: (err) => toast.error(`Error: ${err.message}`)
  });
  const [selectedClosure, setSelectedClosure] = useState<any>(null);
  if (isLoading) return <div>Cargando cierres...</div>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Cierres de Caja Pendientes y Recientes</CardTitle>
            <CardDescription>Valida los montos reportados por los repartidores contra el sistema.</CardDescription>
          </div>
          <Button size="sm" variant="outline" className="text-slate-500 border-slate-200" onClick={() => cleanupMutation.mutate()} disabled={cleanupMutation.isPending}>
            {cleanupMutation.isPending ? "Limpiando..." : "🧹 Limpiar Duplicados"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table><TableHeader><TableRow>
          <TableHead>Fecha</TableHead><TableHead>Repartidor</TableHead>
          <TableHead className="text-right">Esperado</TableHead><TableHead className="text-right">Reportado</TableHead>
          <TableHead className="text-right">Pendiente</TableHead>
          <TableHead className="text-center">Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
        </TableRow></TableHeader><TableBody>
          {(closures as any[])?.map((c) => {
            const totalExp = c.expectedCash + c.expectedQr + c.expectedTransfer;
            const totalRep = c.reportedCash + c.reportedQr + c.reportedTransfer;
            const diff = totalRep - totalExp;
            const pending = c.pendingOrders || 0;
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium text-slate-900">{new Date(c.createdAt).toLocaleDateString("es-BO")}</div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{new Date(c.createdAt).toLocaleTimeString("es-BO", { hour: '2-digit', minute: '2-digit' })}</div>
                </TableCell>
                <TableCell>{c.userName}</TableCell>
                <TableCell className="text-right">{formatCurrency(totalExp)}</TableCell>
                <TableCell className="text-right font-bold">{formatCurrency(totalRep)}
                  <p className={`text-[10px] ${diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>{diff === 0 ? "OK" : diff > 0 ? `+${formatCurrency(diff)}` : `${formatCurrency(diff)}`}</p>
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary">{formatCurrency(pending)}</Badge>
                </TableCell>
                <TableCell className="text-center"><Badge variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "secondary"}>{c.status.toUpperCase()}</Badge></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {c.status === "pending" ? (<>
                      <Button size="sm" variant="ghost" className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 font-bold" onClick={() => updateMutation.mutate({ id: c.id, status: "approved" })} disabled={updateMutation.isPending}>Aprobar</Button>
                      <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50 font-bold" onClick={() => updateMutation.mutate({ id: c.id, status: "rejected" })} disabled={updateMutation.isPending}>Rechazar</Button>
                    </>) : (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-8 text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => repairMutation.mutate({ id: c.id })} disabled={repairMutation.isPending} title="Forzar registro de ingresos si el saldo no se actualizó">
                          {repairMutation.isPending ? "..." : "⚙ Reparar"}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 gap-2" onClick={() => setSelectedClosure(c)}><Printer className="h-3 w-3" />Imprimir</Button>
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody></Table>
        {selectedClosure && <ClosureDetailDialog closure={selectedClosure} onClose={() => setSelectedClosure(null)} />}
      </CardContent>
    </Card>
  );
}

function ClosureDetailDialog({ closure, onClose }: { closure: any, onClose: () => void }) {
  const totalExp = closure.expectedCash + closure.expectedQr + closure.expectedTransfer;
  const totalRep = closure.reportedCash + closure.reportedQr + closure.reportedTransfer;
  const diff = totalRep - totalExp;
  const handlePrint = () => window.print();

  return (
    <Dialog open={!!closure} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl overflow-hidden p-0">
        <div className="p-6 print:p-0 no-print">
          <DialogHeader className="mb-4"><div className="flex items-center justify-between">
            <div><DialogTitle className="text-xl">Resumen de Cierre de Caja</DialogTitle>
              <DialogDescription>Detalle de liquidacion del repartidor {closure.userName}</DialogDescription></div>
            <Badge className={closure.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>{closure.status === 'approved' ? 'APROBADO' : 'RECHAZADO'}</Badge>
          </div></DialogHeader>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <Card><CardContent className="pt-4"><p className="text-xs uppercase font-bold text-muted-foreground mb-1">Fecha de Cierre</p><p className="font-semibold">{closure.date}</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-xs uppercase font-bold text-muted-foreground mb-1">Responsable</p><p className="font-semibold">{closure.userName}</p></CardContent></Card>
          </div>
          <div className="space-y-3 mb-6">
            <h4 className="font-bold text-sm text-slate-800">Desglose de Montos</h4>
            <div className="border rounded-lg overflow-hidden">
              <Table><TableHeader className="bg-slate-50"><TableRow><TableHead>Concepto</TableHead><TableHead className="text-right">Sistema</TableHead><TableHead className="text-right">Reportado</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell className="font-medium">Efectivo</TableCell><TableCell className="text-right">{formatCurrency(closure.expectedCash)}</TableCell><TableCell className="text-right">{formatCurrency(closure.reportedCash)}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">QR / Digital</TableCell><TableCell className="text-right">{formatCurrency(closure.expectedQr)}</TableCell><TableCell className="text-right">{formatCurrency(closure.reportedQr)}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Transferencia</TableCell><TableCell className="text-right">{formatCurrency(closure.expectedTransfer)}</TableCell><TableCell className="text-right">{formatCurrency(closure.reportedTransfer)}</TableCell></TableRow>
                  <TableRow className="bg-slate-50 font-bold"><TableCell>TOTAL RECAUDADO</TableCell><TableCell className="text-right">{formatCurrency(totalExp)}</TableCell><TableCell className="text-right">{formatCurrency(totalRep)}</TableCell></TableRow>
                </TableBody></Table>
            </div>
          </div>
          <div className={`p-4 rounded-lg flex items-center gap-3 ${diff === 0 ? 'bg-green-50 border border-green-200 text-green-800' : diff > 0 ? 'bg-blue-50 border border-blue-200 text-blue-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
            {diff === 0 ? <CheckCircle2 className="h-5 w-5" /> : diff > 0 ? <TrendingUp className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            <div>
              <p className="font-bold text-sm">{diff === 0 ? 'CUADRE PERFECTO' : diff > 0 ? 'SOBRANTE DETECTADO' : 'FALTANTE DETECTADO'}</p>
              <p className="text-xs">{diff === 0 ? 'No se detectaron diferencias.' : `Existe una diferencia de ${formatCurrency(diff)}.`}</p>
            </div>
          </div>
          {closure.adminNotes && <div className="mt-4 p-3 bg-slate-50 rounded border text-sm italic"><span className="font-bold not-italic">Notas Admin: </span>{closure.adminNotes}</div>}
          <DialogFooter className="mt-6 flex gap-2">
            <Button variant="outline" onClick={onClose}>Cerrar</Button>
            <Button onClick={handlePrint} className="gap-2 bg-slate-900 group"><Printer className="h-4 w-4" />Imprimir Recibo</Button>
          </DialogFooter>
        </div>
        <div className="hidden print:block p-8 bg-white text-slate-900 w-full font-sans" id="print-area-closure">
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
            <div>
              <h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900">LiquidaciÃ³n de Caja</h1>
              <p className="text-slate-500 font-bold tracking-widest text-xs uppercase">Control de Pedidos Â· Sistema de GestiÃ³n</p>
            </div>
            <div className="text-right">
              <div className="bg-slate-900 text-white px-4 py-2 rounded-lg font-black text-xl mb-1">
                #{String(closure.id).padStart(5, '0')}
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Arqueo ID</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-8 mb-10">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Responsable</p>
              <p className="text-lg font-bold text-slate-900">{closure.userName}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha de OperaciÃ³n</p>
              <p className="text-lg font-bold text-slate-900">{closure.date}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado Final</p>
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${closure.status === 'approved' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <p className="text-lg font-black text-slate-900 uppercase">{closure.status === 'approved' ? 'Aprobado' : 'Rechazado'}</p>
              </div>
            </div>
          </div>

          <div className="mb-10">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-4 border-b pb-2">Desglose Detallado</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200">
                  <th className="text-left px-4 py-3 font-black text-slate-600 uppercase text-[10px]">Concepto</th>
                  <th className="text-right px-4 py-3 font-black text-slate-600 uppercase text-[10px]">Sugerido Sistema</th>
                  <th className="text-right px-4 py-3 font-black text-slate-600 uppercase text-[10px]">Declarado Repartidor</th>
                  <th className="text-right px-4 py-3 font-black text-slate-600 uppercase text-[10px]">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-4 py-4 font-bold text-slate-700">Efectivo en Caja</td>
                  <td className="px-4 py-4 text-right font-mono text-slate-500">{formatCurrency(closure.expectedCash)}</td>
                  <td className="px-4 py-4 text-right font-bold text-slate-900">{formatCurrency(closure.reportedCash)}</td>
                  <td className={`px-4 py-4 text-right font-black ${closure.reportedCash - closure.expectedCash === 0 ? 'text-slate-400' : closure.reportedCash - closure.expectedCash > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(closure.reportedCash - closure.expectedCash)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-bold text-slate-700">Pagos Digitales (QR)</td>
                  <td className="px-4 py-4 text-right font-mono text-slate-500">{formatCurrency(closure.expectedQr)}</td>
                  <td className="px-4 py-4 text-right font-bold text-slate-900">{formatCurrency(closure.reportedQr)}</td>
                  <td className={`px-4 py-4 text-right font-black ${closure.reportedQr - closure.expectedQr === 0 ? 'text-slate-400' : closure.reportedQr - closure.expectedQr > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(closure.reportedQr - closure.expectedQr)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-4 font-bold text-slate-700">Transferencias Bancarias</td>
                  <td className="px-4 py-4 text-right font-mono text-slate-500">{formatCurrency(closure.expectedTransfer)}</td>
                  <td className="px-4 py-4 text-right font-bold text-slate-900">{formatCurrency(closure.reportedTransfer)}</td>
                  <td className={`px-4 py-4 text-right font-black ${closure.reportedTransfer - closure.expectedTransfer === 0 ? 'text-slate-400' : closure.reportedTransfer - closure.expectedTransfer > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(closure.reportedTransfer - closure.expectedTransfer)}
                  </td>
                </tr>
                <tr className="bg-slate-900 text-white">
                  <td className="px-4 py-4 font-black uppercase text-[10px] tracking-widest">Totales Consolidados</td>
                  <td className="px-4 py-4 text-right font-mono text-slate-300">{formatCurrency(totalExp)}</td>
                  <td className="px-4 py-4 text-right font-black">{formatCurrency(totalRep)}</td>
                  <td className={`px-4 py-4 text-right font-black ${diff === 0 ? 'text-white/50' : diff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(diff)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-10 mb-12">
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Observaciones del Administrador</p>
                <p className="text-sm italic text-slate-600">
                  {closure.adminNotes || "No se registraron observaciones adicionales durante la liquidaciÃ³n."}
                </p>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-900">
                <div className={`p-2 rounded-lg ${diff === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {diff === 0 ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider">{diff === 0 ? 'LiquidaciÃ³n Exitosa' : 'Diferencia en Caja'}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{diff === 0 ? 'Los montos coinciden perfectamente' : `Se detectÃ³ un desfase de ${formatCurrency(diff)}`}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase">Fondo Inicial</span>
                <span className="font-bold text-slate-900">{formatCurrency(closure.initialCash)}</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase">Gastos Declarados</span>
                <span className="font-bold text-red-600">-{formatCurrency(closure.expenses || 0)}</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase">Pedidos Pendientes</span>
                <span className="font-bold text-slate-900">{formatCurrency(closure.pendingOrders || 0)}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-sm font-black uppercase text-slate-900">Saldo Final Real</span>
                <span className="text-xl font-black text-slate-900">{formatCurrency(totalRep - (closure.expenses || 0))}</span>
              </div>
            </div>
          </div>

          <div className="mt-20 flex justify-between gap-20">
            <div className="flex-1 text-center">
              <div className="border-t-2 border-slate-900 pt-3">
                <p className="text-xs font-black uppercase tracking-widest text-slate-900">Firma Administrador</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">Sello y Firma de AutorizaciÃ³n</p>
              </div>
            </div>
            <div className="flex-1 text-center">
              <div className="border-t-2 border-slate-900 pt-3">
                <p className="text-xs font-black uppercase tracking-widest text-slate-900">Firma {closure.userName}</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">DeclaraciÃ³n de Conformidad</p>
              </div>
            </div>
          </div>

          <div className="mt-12 text-center">
            <p className="text-[8px] font-bold text-slate-300 uppercase tracking-[0.3em]">
              Documento generado digitalmente por Control de Pedidos App Â· {new Date().toLocaleString('es-BO')}
            </p>
          </div>
        </div>
      </DialogContent>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * { visibility: hidden; }
          #print-area-closure, #print-area-closure * { visibility: visible; }
          #print-area-closure { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 9999; background: white !important; padding: 40px !important; }
          .no-print { display: none !important; }
        }
      `}} />
    </Dialog>
  );
}

function AddIncomeDialog() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const [income, setIncome] = useState({ amount: "", paymentMethod: "cash" as const, category: "donation" as const, notes: "" });

  const mutation = trpc.finance.addExtraordinaryIncome.useMutation({
    onSuccess: () => { 
      toast.success("Ingreso registrado con exito"); 
      setOpen(false); 
      setIncome({ amount: "", paymentMethod: "cash", category: "donation", notes: "" });
      utils.finance.getTransactions.invalidate(); 
    },
    onError: (error) => toast.error(error.message || "Error al registrar ingreso")
  });

  const handleSubmit = () => {
    const amount = parseInputAmount(income.amount);
    if (isNaN(amount) || amount <= 0) { toast.error("Ingresa un monto valido"); return; }
    mutation.mutate({ ...income, amount: Math.round(amount * 100) });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
          <ArrowUpRight className="h-4 w-4" /> Registrar Ingreso Extra
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo Ingreso Extraordinario</DialogTitle>
          <DialogDescription>Registra donaciones, prestamos o regalos que entran a caja.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Monto</Label>
              <Input 
                type="text" 
                inputMode="decimal" 
                onFocus={(e) => e.target.select()} 
                placeholder="0.00" 
                value={income.amount}
                onChange={(e) => setIncome({ ...income, amount: e.target.value })} 
              />
            </div>
            <div className="space-y-2">
              <Label>Metodo de Pago</Label>
              <Select value={income.paymentMethod} onValueChange={(v: any) => setIncome({ ...income, paymentMethod: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Efectivo</SelectItem>
                  <SelectItem value="qr">QR</SelectItem>
                  <SelectItem value="transfer">Cuenta Bancaria</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Categoria de Ingreso</Label>
            <Select value={income.category} onValueChange={(v: any) => setIncome({ ...income, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="donation">Donación</SelectItem>
                <SelectItem value="loan">Préstamo</SelectItem>
                <SelectItem value="gift">Regalo</SelectItem>
                <SelectItem value="other_income">Otros Ingresos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Descripcion / Notas</Label>
            <Input 
              placeholder="Ej: Donacion de socio fundador" 
              value={income.notes}
              onChange={(e) => setIncome({ ...income, notes: e.target.value })} 
            />
          </div>
          <Button 
            className="w-full bg-emerald-600 hover:bg-emerald-700" 
            onClick={handleSubmit} 
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Registrando..." : "Confirmar Ingreso"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddExpenseDialog() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: deliveryPersons } = trpc.users.listDeliveryPersons.useQuery();
  const [expense, setExpense] = useState({ deliveryPersonId: 0, amount: 0, type: "fuel" as const, notes: "" });

  const mutation = trpc.finance.addDeliveryExpense.useMutation({
    onSuccess: () => { toast.success("Gasto registrado"); setOpen(false); utils.finance.getTransactions.invalidate(); }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" className="gap-2 bg-red-600 hover:bg-red-700"><ArrowDownRight className="h-4 w-4" /> Registrar Gasto Logistico</Button></DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>Nuevo Gasto de Repartidor</DialogTitle><DialogDescription>Registra combustible, viaticos o reparaciones.</DialogDescription></DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2"><Label>Repartidor</Label>
            <Select onValueChange={(v) => setExpense({ ...expense, deliveryPersonId: parseInt(v) })}>
              <SelectTrigger><SelectValue placeholder="Seleccionar repartidor" /></SelectTrigger>
              <SelectContent>{(deliveryPersons as any[])?.filter((u: any) => u.role === 'user').map((u: any) => (
                <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
              ))}</SelectContent></Select></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Monto</Label><Input type="text" inputMode="decimal" onFocus={(e) => e.target.select()} placeholder="0.00" onChange={(e) => setExpense({ ...expense, amount: e.target.value as any })} /></div>
            <div className="space-y-2"><Label>Categoria</Label>
              <Select onValueChange={(v: any) => setExpense({ ...expense, type: v })}>
                <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent><SelectItem value="fuel">Combustible</SelectItem><SelectItem value="subsistence">Viaticos / Comida</SelectItem><SelectItem value="other">Otros</SelectItem></SelectContent>
              </Select></div>
          </div>
          <div className="space-y-2"><Label>Descripcion</Label><Input placeholder="Ej: Carga de Nafta" onChange={(e) => setExpense({ ...expense, notes: e.target.value })} /></div>
          <Button className="w-full bg-red-600 hover:bg-red-700" onClick={() => mutation.mutate({ ...expense, amount: Math.round(expense.amount * 100) })} disabled={mutation.isPending}>{mutation.isPending ? "Registrando..." : "Registrar Gasto"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ fromMethod: "cash", toMethod: "transfer", amount: "", notes: "" });
  const mutation = trpc.finance.transferFunds.useMutation({
    onSuccess: () => { toast.success("Traspaso realizado con exito"); setOpen(false); setForm({ fromMethod: "cash", toMethod: "transfer", amount: "", notes: "" }); void utils.finance.getTransactions.invalidate(); },
    onError: (error) => toast.error(error.message || "Error al realizar el traspaso"),
  });
  const handleSubmit = () => {
    const amount = parseInputAmount(form.amount);
    if (isNaN(amount) || amount <= 0) { toast.error("Ingresa un monto valido"); return; }
    if (form.fromMethod === form.toMethod) { toast.error("Las cajas deben ser distintas"); return; }
    mutation.mutate({ fromMethod: form.fromMethod as "cash" | "qr" | "transfer", toMethod: form.toMethod as "cash" | "qr" | "transfer", amount: Math.round(amount * 100), notes: form.notes });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" className="gap-2"><ArrowRightLeft className="h-4 w-4" />Traspaso</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Traspaso de Fondos</DialogTitle><DialogDescription>Mueve dinero entre tus diferentes cajas.</DialogDescription></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2"><Label>Dinero sale de:</Label>
            <Select value={form.fromMethod} onValueChange={(val) => setForm({ ...form, fromMethod: val })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="cash">Caja Efectivo</SelectItem><SelectItem value="qr">Caja QR</SelectItem><SelectItem value="transfer">Cuenta Bancaria</SelectItem></SelectContent>
            </Select></div>
          <div className="space-y-2"><Label>Dinero entra a:</Label>
            <Select value={form.toMethod} onValueChange={(val) => setForm({ ...form, toMethod: val })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="cash">Caja Efectivo</SelectItem><SelectItem value="qr">Caja QR</SelectItem><SelectItem value="transfer">Cuenta Bancaria</SelectItem></SelectContent>
            </Select></div>
          <div className="space-y-2"><Label>Monto a transferir</Label><Input type="text" inputMode="decimal" onFocus={(e) => e.target.select()} placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
          <div className="space-y-2"><Label>Concepto (Opcional)</Label><Input placeholder="Ej. Deposito al banco" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <Button className="w-full" onClick={handleSubmit} disabled={mutation.isPending}>{mutation.isPending ? "Procesando..." : "Confirmar Traspaso"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// TRANSACCION ROW & DETAIL DIALOGS
// ============================================================

function TransactionRow({ transaction }: { transaction: any }) {
  const [showDetail, setShowDetail] = useState(false);
  const categoryLabels: Record<string, string> = {
    sale: "Venta",
    sale_local: "Venta Local",
    sale_delivery: "Venta Delivery",
    purchase: "Compra",
    order_delivery: "Pedido",
    sale_cancellation: "Anulacion de Venta",
    fuel: "Combustible",
    subsistence: "Viaticos / Comida",
    transfer: "Traspaso",
    transfer_between_registers: "Traspaso Cajas",
  };

  return (
    <>
      <div className="flex justify-between items-center p-3 border rounded-lg hover:bg-muted/5 transition-colors print:border-black">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-8 rounded-full flex items-center justify-center ${transaction.type === "income" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"}`}>
            {transaction.type === "income" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          </div>
          <div>
            <p className="font-semibold text-sm">{transaction.notes || transaction.category}</p>
            <p className="text-xs text-muted-foreground">{new Date(transaction.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={`font-mono font-bold ${transaction.type === "income" ? "text-green-600" : "text-red-600"}`}>
              {transaction.type === "income" ? "+" : "-"} {formatCurrency(transaction.amount)}
            </p>
            <Badge variant="outline" className="text-[10px] uppercase font-light">
              {categoryLabels[transaction.category] || transaction.category}
            </Badge>
          </div>
          <div className="flex gap-1 no-print">
            <Button 
              size="sm" 
              variant="outline" 
              className="h-8 px-3 gap-2 text-xs font-bold border-slate-200 hover:bg-slate-50" 
              onClick={() => setShowDetail(true)}
            >
              <Eye className="h-3.5 w-3.5" />
              Ver detalle
            </Button>
          </div>
        </div>
      </div>
      {showDetail && <TransactionDetailDialog transaction={transaction} onClose={() => setShowDetail(false)} />}
    </>
  );
}

function TransactionDetailDialog({ transaction, onClose }: { transaction: any, onClose: () => void }) {
  const handlePrint = () => window.print();

  if (transaction.category === "purchase" && transaction.referenceId) {
    return <PurchaseTransactionDialog purchaseId={transaction.referenceId} transaction={transaction} onClose={onClose} onPrint={handlePrint} />;
  }
  if ((transaction.category === "sale" || transaction.category === "order_delivery") && transaction.referenceId) {
    return <SaleTransactionDialog saleId={transaction.referenceId} transaction={transaction} onClose={onClose} onPrint={handlePrint} />;
  }
  return <BasicTransactionDialog transaction={transaction} onClose={onClose} onPrint={handlePrint} />;
}

// ---- COMPRA ----
function PurchaseTransactionDialog({ purchaseId, transaction, onClose, onPrint }: { purchaseId: number; transaction: any; onClose: () => void; onPrint: () => void }) {
  const { data: purchase } = (trpc.purchases as any).getById.useQuery({ id: purchaseId }, { enabled: !!purchaseId });
  const { data: items } = (trpc.purchases as any).getItems.useQuery({ purchaseId }, { enabled: !!purchaseId });

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Detalle de Compra: {purchase?.purchaseNumber || `#${purchaseId}`}</DialogTitle></DialogHeader>
        {!purchase ? (
          <div className="py-10 text-center text-muted-foreground">Cargando...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-muted/30 p-3 rounded-lg text-sm">
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Nro de Compra</p><p className="font-semibold">{purchase.purchaseNumber}</p></div>
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Fecha</p><p className="font-semibold">{new Date(purchase.createdAt).toLocaleString()}</p></div>
              {purchase.supplierName && <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Proveedor</p><p className="font-semibold">{purchase.supplierName}</p></div>}
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Metodo de Pago</p><Badge variant="outline" className="capitalize">{purchase.paymentMethod}</Badge></div>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground"><tr>
                  <th className="px-3 py-2 text-left font-medium">Producto</th>
                  <th className="px-3 py-2 text-center font-medium">Cant.</th>
                  <th className="px-3 py-2 text-right font-medium">Precio Uni.</th>
                  <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                </tr></thead>
                <tbody className="divide-y">
                  {items?.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2"><p className="font-medium">{item.productName}</p><p className="text-[10px] text-muted-foreground">{item.productCode}</p></td>
                      <td className="px-3 py-2 text-center font-bold">{item.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.price)}</td>
                      <td className="px-3 py-2 text-right font-bold text-blue-700">{formatCurrency(item.quantity * item.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-slate-50 p-3 flex justify-between items-center border-t border-slate-200">
                <span className="text-xs font-bold text-slate-500 uppercase">Total Compra</span>
                <span className="text-xl font-black text-slate-900 font-mono">{formatCurrency(purchase.totalAmount)}</span>
              </div>
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cerrar</Button>
              <Button onClick={onPrint} className="gap-2 bg-slate-900"><Printer className="h-4 w-4" />Imprimir Comprobante</Button>
            </DialogFooter>
          </div>
        )}
        {purchase && items && (
          <div className="hidden print:block p-8 bg-white text-black w-full" id={`purchase-print-${purchaseId}`}>
            <PrintPurchaseContent purchase={purchase} items={items} />
          </div>
        )}
      </DialogContent>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * { visibility: hidden; }
          #purchase-print-${purchaseId}, #purchase-print-${purchaseId} * { visibility: visible; }
          #purchase-print-${purchaseId} { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 9999; background: white !important; padding: 40px !important; }
          .no-print { display: none !important; }
        }
      `}} />
    </Dialog>
  );
}

function PrintPurchaseContent({ purchase, items }: { purchase: any; items: any[] }) {
  return (
    <>
      <div className="text-center mb-6 border-b pb-4"><h1 className="text-2xl font-bold uppercase">Comprobante de Compra</h1><p className="text-sm">Control de Pedidos App</p></div>
      <div className="grid grid-cols-2 gap-y-4 mb-8 text-sm">
        <div><span className="font-bold">Nro:</span> {purchase.purchaseNumber}</div>
        <div><span className="font-bold">Fecha:</span> {new Date(purchase.createdAt).toLocaleString()}</div>
        {purchase.supplierName && <div><span className="font-bold">Proveedor:</span> {purchase.supplierName}</div>}
        <div><span className="font-bold">Metodo:</span> {paymentMethodLabel(purchase.paymentMethod)}</div>
        <div><span className="font-bold">Estado:</span> {purchase.status}</div>
      </div>
      <table className="w-full text-sm border-collapse mb-8">
        <thead><tr className="bg-gray-100 border border-gray-300">
          <th className="p-2 text-left border-r border-gray-300">Producto</th>
          <th className="p-2 text-center border-r border-gray-300">Cant.</th>
          <th className="p-2 text-right border-r border-gray-300">P. Unit.</th>
          <th className="p-2 text-right">Subtotal</th>
        </tr></thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
              <td className="p-2 border border-gray-300">{item.productName}</td>
              <td className="p-2 border text-center border-gray-300">{item.quantity}</td>
              <td className="p-2 border text-right border-gray-300">{formatCurrency(item.price)}</td>
              <td className="p-2 border text-right border-gray-300">{formatCurrency(item.quantity * item.price)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="bg-gray-100 font-bold">
          <td className="p-2 border border-gray-300 text-right" colSpan={3}>TOTAL COMPRA</td>
          <td className="p-2 border text-right border-gray-300">{formatCurrency(purchase.totalAmount)}</td>
        </tr></tfoot>
      </table>
      <div className="mt-16 grid grid-cols-2 gap-12"><div className="text-center pt-8 border-t border-black"><p className="text-sm font-bold uppercase">Firma del Responsable</p></div></div>
      <div className="mt-8 text-[10px] text-center text-gray-400">Generado por Sistema de Control de Pedidos - {new Date().toLocaleString()}</div>
    </>
  );
}

// ---- VENTA ----
function SaleTransactionDialog({ saleId, transaction, onClose, onPrint }: { saleId: number; transaction: any; onClose: () => void; onPrint: () => void }) {
  const { data: detail, isLoading } = trpc.sales.getDetails.useQuery({ saleId }, { enabled: !!saleId });

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Detalle de Venta: {detail?.sale?.saleNumber || `#${saleId}`}</DialogTitle></DialogHeader>
        {isLoading || !detail ? (
          <div className="py-10 text-center text-muted-foreground">Cargando...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-muted/30 p-3 rounded-lg text-sm">
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Venta</p><p className="font-semibold">{detail.sale.saleNumber}</p></div>
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Fecha</p><p className="font-semibold">{new Date(detail.sale.createdAt).toLocaleString("es-BO")}</p></div>
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Cliente</p><p className="font-semibold">{detail.sale.customerDisplayName || "Anonimo"}</p></div>
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Vendedor</p><p className="font-semibold">{detail.sale.sellerName || "Sin nombre"}</p></div>
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Estado</p>
                <Badge variant={detail.sale.status === "cancelled" ? "destructive" : "default"}>{detail.sale.status === "cancelled" ? "Anulada" : "Activa"}</Badge></div>
              <div><p className="text-muted-foreground uppercase text-[10px] font-bold">Metodo de Pago</p><p className="font-semibold">{paymentMethodLabel(detail.sale.paymentMethod)}</p></div>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground"><tr>
                  <th className="px-3 py-2 text-left font-medium">Producto</th>
                  <th className="px-3 py-2 text-center font-medium">Cant.</th>
                  <th className="px-3 py-2 text-right font-medium">P. Unit.</th>
                  <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                </tr></thead>
                <tbody className="divide-y">
                  {(detail.items || []).map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2"><p className="font-medium">{item.productName}</p><p className="text-[10px] text-muted-foreground">{item.productCode}</p></td>
                      <td className="px-3 py-2 text-center font-bold">{item.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.finalUnitPrice || item.basePrice)}</td>
                      <td className="px-3 py-2 text-right font-bold text-green-700">{formatCurrency(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-slate-50 p-3 flex justify-between items-center border-t border-slate-200">
                <span className="text-xs font-bold text-slate-500 uppercase">Total Venta</span>
                <span className="text-xl font-black text-slate-900 font-mono">{formatCurrency(detail.sale.total)}</span>
              </div>
            </div>
            {detail.sale.notes && (
              <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 p-2 rounded">
                <p className="font-bold uppercase text-[9px] mb-1">Notas:</p>{detail.sale.notes}
              </div>
            )}
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cerrar</Button>
              <Button onClick={onPrint} className="gap-2 bg-slate-900"><Printer className="h-4 w-4" />Imprimir Ticket</Button>
            </DialogFooter>
          </div>
        )}
        {detail && (
          <div className="hidden print:block p-8 bg-white text-black w-full" id="sale-print-area">
            <PrintSaleContent detail={detail} />
          </div>
        )}
      </DialogContent>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * { visibility: hidden; }
          #sale-print-area, #sale-print-area * { visibility: visible; }
          #sale-print-area { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 9999; background: white !important; padding: 40px !important; }
          .no-print { display: none !important; }
        }
      `}} />
    </Dialog>
  );
}

function PrintSaleContent({ detail }: { detail: any }) {
  return (
    <>
      <div className="text-center mb-6 border-b pb-4"><h1 className="text-2xl font-bold uppercase">Comprobante de Venta</h1><p className="text-sm">Control de Pedidos App</p></div>
      <div className="grid grid-cols-2 gap-y-4 mb-8 text-sm">
        <div><span className="font-bold">Venta:</span> {detail.sale.saleNumber}</div>
        <div><span className="font-bold">Fecha:</span> {new Date(detail.sale.createdAt).toLocaleString("es-BO")}</div>
        <div><span className="font-bold">Cliente:</span> {detail.sale.customerDisplayName || "Anonimo"}</div>
        <div><span className="font-bold">Vendedor:</span> {detail.sale.sellerName || "Sin nombre"}</div>
        <div><span className="font-bold">Metodo:</span> {paymentMethodLabel(detail.sale.paymentMethod)}</div>
        <div><span className="font-bold">Estado:</span> {detail.sale.status === "cancelled" ? "ANULADA" : "ACTIVA"}</div>
      </div>
      <table className="w-full text-sm border-collapse mb-8">
        <thead><tr className="bg-gray-100 border border-gray-300">
          <th className="p-2 text-left border-r border-gray-300">Producto</th>
          <th className="p-2 text-center border-r border-gray-300">Cant.</th>
          <th className="p-2 text-right border-r border-gray-300">P. Unit.</th>
          <th className="p-2 text-right">Subtotal</th>
        </tr></thead>
        <tbody>
          {(detail.items || []).map((item: any) => (
            <tr key={item.id} className="border-b">
              <td className="p-2">{item.productName}</td>
              <td className="p-2 text-center">{item.quantity}</td>
              <td className="p-2 text-right">{formatCurrency(item.finalUnitPrice || item.basePrice)}</td>
              <td className="p-2 text-right">{formatCurrency(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="bg-gray-100 font-bold">
          <td className="p-2 border border-gray-300 text-right" colSpan={3}>TOTAL VENTA</td>
          <td className="p-2 border text-right border-gray-300">{formatCurrency(detail.sale.total)}</td>
        </tr></tfoot>
      </table>
      {detail.sale.notes && <div className="mb-6 text-sm italic border-l-4 border-gray-300 pl-3">Notas: {detail.sale.notes}</div>}
      <div className="mt-16 grid grid-cols-2 gap-12"><div className="text-center pt-8 border-t border-black"><p className="text-sm font-bold uppercase">Firma del Responsable</p></div></div>
      <div className="mt-8 text-[10px] text-center text-gray-400">Generado por Sistema de Control de Pedidos - {new Date().toLocaleString()}</div>
    </>
  );
}

// ---- BASICO (otros) ----
function BasicTransactionDialog({ transaction, onClose, onPrint }: { transaction: any; onClose: () => void; onPrint: () => void }) {
  const typeLabel = transaction.type === "income" ? "INGRESO" : "EGRESO";
  const categoryLabels: Record<string, string> = {
    sale: "Venta",
    sale_local: "Venta Local",
    sale_delivery: "Venta Delivery",
    purchase: "Compra Inventario",
    order_delivery: "Pedido",
    sale_cancellation: "Anulacion de Venta",
    fuel: "Combustible",
    subsistence: "Viaticos / Comida",
    transfer: "Traspaso",
    transfer_between_registers: "Traspaso Cajas",
    donation: "Donación",
    loan: "Préstamo",
    gift: "Regalo",
    other_income: "Otros Ingresos",
    cogs: "📦 COGS – Costo Mercadería",
    repair_cost: "🔧 Costo Reparación",
    warranty_repair_cost: "🛡 Garantía – Reparación",
    warranty_replacement_cost: "🛡 Garantía – Reemplazo",
  };
  const methodLabels: Record<string, string> = { cash: "Caja Efectivo", qr: "Caja QR", transfer: "Cuenta Bancaria" };

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg overflow-hidden p-0">
        <div className="p-6 print:p-0 no-print">
          <DialogHeader className="mb-4">
            <div className="flex items-center justify-between">
              <div><DialogTitle className="text-xl">Detalle de Transaccion</DialogTitle>
                <DialogDescription>{typeLabel} #{`TXN-${String(transaction.id).padStart(5, "0")}`}</DialogDescription></div>
              <Badge className={transaction.type === "income" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>{typeLabel}</Badge>
            </div>
          </DialogHeader>
          <div className="space-y-3 mb-6">
            <div className="border rounded-lg overflow-hidden">
              <Table><TableBody>
                <TableRow><TableCell className="font-bold text-muted-foreground w-40">Fecha y Hora</TableCell><TableCell>{new Date(transaction.createdAt).toLocaleString()}</TableCell></TableRow>
                <TableRow><TableCell className="font-bold text-muted-foreground">Concepto</TableCell><TableCell className="font-semibold">{transaction.notes || transaction.category}</TableCell></TableRow>
                <TableRow><TableCell className="font-bold text-muted-foreground">Categoria</TableCell><TableCell>{categoryLabels[transaction.category] || transaction.category}</TableCell></TableRow>
                <TableRow><TableCell className="font-bold text-muted-foreground">Metodo de Pago</TableCell><TableCell>{methodLabels[transaction.paymentMethod] || transaction.paymentMethod || "—"}</TableCell></TableRow>
                <TableRow><TableCell className="font-bold text-muted-foreground">Monto</TableCell>
                  <TableCell className={`font-mono font-bold text-lg ${transaction.type === "income" ? "text-green-600" : "text-red-600"}`}>{transaction.type === "income" ? "+" : "-"} {formatCurrency(transaction.amount)}</TableCell></TableRow>
                <TableRow><TableCell className="font-bold text-muted-foreground">ID Referencia</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{transaction.referenceId || "—"}</TableCell></TableRow>
              </TableBody></Table>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cerrar</Button>
            <Button onClick={onPrint} className="gap-2 bg-slate-900"><Printer className="h-4 w-4" />Imprimir Comprobante</Button>
          </DialogFooter>
        </div>
        <div className="hidden print:block p-8 bg-white text-black w-full" id="print-area">
          <div className="text-center mb-6 border-b pb-4"><h1 className="text-2xl font-bold uppercase">Comprobante de Transaccion</h1><p className="text-sm">Control de Pedidos App</p></div>
          <div className="grid grid-cols-2 gap-y-4 mb-8 text-sm">
            <div><span className="font-bold">Nro.:</span> #{`TXN-${String(transaction.id).padStart(5, "0")}`}</div>
            <div><span className="font-bold">Fecha:</span> {new Date(transaction.createdAt).toLocaleString()}</div>
            <div><span className="font-bold">Tipo:</span> {typeLabel}</div>
            <div><span className="font-bold">Categoria:</span> {categoryLabels[transaction.category] || transaction.category}</div>
            <div><span className="font-bold">Metodo:</span> {methodLabels[transaction.paymentMethod] || transaction.paymentMethod || "—"}</div>
          </div>
          <div className="p-4 border-2 border-black rounded-lg text-center mb-8">
            <p className="text-xs uppercase font-bold text-gray-500 mb-1">Monto Total</p>
            <p className="text-3xl font-bold">{transaction.type === "income" ? "+" : "-"} {formatCurrency(transaction.amount)}</p>
          </div>
          {transaction.notes && <div className="mb-10 p-3 bg-gray-50 border rounded text-sm italic"><span className="font-bold not-italic">Concepto: </span>{transaction.notes}</div>}
          <div className="mt-12 pt-8 border-t border-black text-center"><p className="text-sm font-bold uppercase">Firma Responsable</p></div>
          <div className="mt-8 text-[10px] text-center text-gray-400">Generado por Sistema de Control de Pedidos - {new Date().toLocaleString()}</div>
        </div>
      </DialogContent>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 9999; background: white !important; padding: 40px !important; }
          .no-print { display: none !important; }
        }
      `}} />
    </Dialog>
  );
}


