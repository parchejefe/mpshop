import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import MobileMenu from "./MobileMenu";
import { Link, useLocation } from "wouter";
import {
  ChevronRight,
  ShoppingBag,
  Package,
  TrendingUp,
  ShoppingCart,
  Users,
  DollarSign,
  Receipt,
  Tag,
  Truck,
  BarChart3,
  LogOut,
  Sparkles,
  Search,
  CreditCard,
  Landmark,
  BookOpen,
  ScanLine,
  Settings,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  Wallet,
  Bell,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "./ui/input";

/* ─── nav item type ─────────────────────────────────────────────── */
type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  moduleKey?: string;
  adminOnly?: boolean;   // si true, solo admins lo ven en el nav
  sellerOnly?: boolean;  // si true, solo sellers lo ven en el nav
};

import { useBranch } from "@/contexts/BranchContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Store } from "lucide-react";

/* ─── shared nav data — ROW 1: Operativo | ROW 2: Gestión ───────── */
export const ADMIN_NAV_ROW1: NavItem[] = [
  { href: "/sales",            label: "Ventas",       icon: ShoppingBag, moduleKey: "sales" },
  { href: "/catalog",          label: "Catálogo",     icon: BookOpen,    moduleKey: "catalog" },
  { href: "/units",            label: "Unidades",     icon: Tag,         moduleKey: "units" },
  { href: "/repairs",          label: "Taller",       icon: Package,     moduleKey: "repairs" },
  { href: "/warranties",       label: "Garantías",    icon: Tag,         moduleKey: "warranties" },
  // { href: "/returns",          label: "Devoluciones", icon: Package,     moduleKey: "returns" }, // OCULTO
  // { href: "/orders",           label: "Pedidos",      icon: ShoppingCart, moduleKey: "orders" },      // OCULTO
  // { href: "/delivery-load",    label: "Mi Carga",     icon: Package,     moduleKey: "delivery-load" }, // OCULTO
  { href: "/generate-codes",   label: "Códigos QR",   icon: Tag,         moduleKey: "generate-codes" },
  { href: "/customers",        label: "Clientes",     icon: Users,       moduleKey: "customers" },
  { href: "/suppliers",        label: "Proveedores",  icon: Users,       moduleKey: "suppliers" },
  { href: "/purchases",        label: "Compras",      icon: ShoppingCart, moduleKey: "purchases" },
];

export const ADMIN_NAV_ROW2: NavItem[] = [
  { href: "/dashboard-kpis",              label: "📊 KPIs",               icon: BarChart3,  moduleKey: "dashboard-kpis" },
  { href: "/reports",                      label: "📈 Reportes",           icon: BarChart3,  moduleKey: "reports" },
  { href: "/analytics",                   label: "Analítica",              icon: TrendingUp, moduleKey: "analytics" },
  { href: "/admin/rentabilidad",          label: "💰 Rentabilidad",       icon: TrendingUp, moduleKey: "finance", adminOnly: true },
  // { href: "/admin/control-financiero",    label: "🔔 Control Financiero", icon: DollarSign, moduleKey: "finance", adminOnly: true }, // OCULTO
  { href: "/finance",                     label: "Finanzas",               icon: DollarSign, moduleKey: "finance" },
  { href: "/admin/cajas-vendedores",      label: "🏪 Cajas Vendedores",   icon: Store,      moduleKey: "seller-boxes-admin", adminOnly: true },
  // { href: "/admin/auditoria-datos",       label: "🔍 Auditoría Datos",    icon: BarChart3,  moduleKey: "seller-boxes-admin", adminOnly: true }, // OCULTO
  // { href: "/repartidor/finance",       label: "Caja Reparto",           icon: DollarSign, moduleKey: "repartidor-finance" },  // OCULTO
  { href: "/vendedor/caja",               label: "Mi Caja",                icon: Wallet,     moduleKey: "seller-cash",  sellerOnly: true },
  { href: "/accounts-receivable",         label: "C. por Cobrar",          icon: CreditCard, moduleKey: "accounts-receivable" },
  { href: "/accounts-payable",            label: "C. por Pagar",           icon: Landmark,   moduleKey: "accounts-payable" },
  { href: "/expenses",                    label: "Gastos",                 icon: Receipt,    moduleKey: "expenses" },
  { href: "/branches",                    label: "Sucursales",             icon: Store,      moduleKey: "branches" },
  { href: "/users",                       label: "👥 Usuarios",            icon: Users,      moduleKey: "users" },
  // { href: "/delivery-persons",         label: "Repartidores",           icon: Truck,      moduleKey: "delivery-persons" }, // OCULTO
  { href: "/settings",                    label: "⚙️ Config.",             icon: Settings,   moduleKey: "settings-admin" },
];

// Flat list for mobile / command menu
export const ADMIN_NAV: NavItem[] = [...ADMIN_NAV_ROW1, ...ADMIN_NAV_ROW2];

/* ─── Quick Scanner Input Component ─────────────────────────────── */
function QuickScannerInput() {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pulse, setPulse] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [, navigate] = useLocation();

  const lookupQuery = trpc.units.getByCode.useQuery(
    { code: code.trim() },
    { enabled: false }
  );

  // Animación de pulso
  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 750);
    return () => clearInterval(interval);
  }, []);

  const handleScan = async (scannedCode: string) => {
    const trimmed = scannedCode.trim();
    if (!trimmed || trimmed.length < 2) return;

    setScanning(true);

    try {
      const res = await lookupQuery.refetch();
      const data = res.data;

      if (data?.found && data.unit) {
        const unit = data.unit;
        
        if (unit.status !== "available") {
          toast.error("❌ Equipo no disponible", {
            description: `${unit.brand} ${unit.model} - Estado: ${unit.status}`,
            duration: 3000,
          });
          setScanning(false);
          setCode("");
          return;
        }

        toast.success("✅ Equipo encontrado", {
          description: `${unit.brand} ${unit.model} - Abriendo venta...`,
          duration: 2000,
        });

        setTimeout(() => {
          sessionStorage.setItem("quickSaleUnitId", unit.id.toString());
          sessionStorage.setItem("quickSaleUnitCode", trimmed);
          navigate("/sales");
          setCode("");
          setScanning(false);
        }, 500);

      } else {
        toast.error("❌ CÓDIGO NO EXISTE", {
          description: `El código "${trimmed}" no se encuentra en el inventario`,
          duration: 3000,
        });
        setCode("");
        setScanning(false);
      }
    } catch (err) {
      toast.error("Error al buscar el código");
      console.error(err);
      setCode("");
      setScanning(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCode(value);

    // Limpiar timeout anterior
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Si hay contenido, configurar timeout para búsqueda automática
    if (value.trim().length >= 2) {
      timeoutRef.current = setTimeout(() => {
        handleScan(value);
      }, 300); // 300ms después de que se deja de escribir
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && code.trim()) {
      // Limpiar timeout si existe
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      handleScan(code.trim());
    }
  };

  // Limpiar timeout al desmontar
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="hidden lg:flex items-center gap-2 h-9 px-3 rounded-full border-2 border-emerald-300 bg-emerald-50/80 relative min-w-[240px] group hover:border-emerald-400 transition-all">
      {/* Indicador parpadeante */}
      <div className={`h-2.5 w-2.5 rounded-full transition-all duration-300 shrink-0 ${
        scanning ? "bg-yellow-500 animate-pulse" : pulse ? "bg-emerald-600 scale-110" : "bg-emerald-400"
      }`} />
      
      {/* Icono */}
      {scanning ? (
        <Loader2 className="h-3.5 w-3.5 text-emerald-700 animate-spin" />
      ) : (
        <ScanLine className="h-3.5 w-3.5 text-emerald-700" />
      )}
      
      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={code}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={scanning ? "Buscando..." : "Escanear código..."}
        disabled={scanning}
        className="flex-1 bg-transparent border-none outline-none text-xs font-mono font-semibold text-emerald-900 placeholder:text-emerald-600 disabled:opacity-50"
        autoComplete="off"
      />
      
      {/* Badge indicador */}
      <div className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-md uppercase tracking-wide">
        {scanning ? "..." : "Venta rápida"}
      </div>
    </div>
  );
}

/* ─── Tab Link Component ────────────────────────────────────────── */
function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`
        group relative flex shrink-0 items-center gap-1.5
        h-9 px-2.5 rounded-lg
        text-[12px] font-semibold tracking-wide whitespace-nowrap
        transition-all duration-200 select-none
        ${active
          ? "text-primary bg-primary/8 font-bold"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
        }
      `}
    >
      <Icon className={`shrink-0 h-3.5 w-3.5 transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-110"}`} />
      {item.label}
      {active && (
        <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
      )}
    </Link>
  );
}

/* ─── Notification Bell ─────────────────────────────────────────── */
function NotificationBell() {
  const { data } = trpc.notifications.getAll.useQuery({}, {
    refetchInterval: 60_000, // refresca cada 60s
    staleTime: 30_000,
  });

  const criticalCount = data?.criticalCount ?? 0;
  const warningCount  = data?.warningCount  ?? 0;
  const total = criticalCount + warningCount;

  return (
    <Link href="/admin/control-financiero">
      <button
        title={total > 0 ? `${total} alerta(s) activa(s)` : "Sin alertas"}
        className="relative flex items-center justify-center h-9 w-9 rounded-full border border-slate-200 bg-slate-50 hover:bg-white hover:border-primary/40 hover:shadow-sm transition-all"
      >
        <Bell className={`h-4 w-4 ${criticalCount > 0 ? "text-red-500" : warningCount > 0 ? "text-amber-500" : "text-slate-400"}`} />
        {total > 0 && (
          <span className={`absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 rounded-full text-[10px] font-bold text-white ${criticalCount > 0 ? "bg-red-500" : "bg-amber-500"}`}>
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>
    </Link>
  );
}

/* ─── main header ───────────────────────────────────────────────── */
export default function AppHeader() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const { data: companyConfig } = trpc.settings.getCompanyConfig.useQuery();

  const isAdmin = user?.role === "admin";
  let allowedModules: string[] = [];
  try {
    if (typeof (user as any)?.allowedModules === "string") {
      allowedModules = JSON.parse((user as any)?.allowedModules);
    } else if (Array.isArray((user as any)?.allowedModules)) {
      allowedModules = (user as any)?.allowedModules;
    }
  } catch {
    allowedModules = [];
  }

  const isModuleAllowed = (moduleKey?: string) => {
    if (isAdmin || !moduleKey) return true;
    if (allowedModules.length === 0) return true;
    return allowedModules.includes(moduleKey);
  };

  // Cada empleado ve exactamente los módulos que tiene asignados en allowedModules
  const visibleRow1 = ADMIN_NAV_ROW1.filter(item => isModuleAllowed(item.moduleKey));
  const visibleRow2 = ADMIN_NAV_ROW2.filter(item => {
    // adminOnly: solo admins lo ven
    if (item.adminOnly && !isAdmin) return false;
    // sellerOnly: solo sellers lo ven, y siempre aparece sin importar allowedModules
    if (item.sellerOnly) return user?.role === "seller";
    return isModuleAllowed(item.moduleKey);
  });

  const initial = user?.name?.charAt(0).toUpperCase() ?? "U";

  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  
  // Determinar qué mostrar en el selector
  const branchDisplayName = activeBranch?.name || (activeBranchId > 0 ? `Sucursal #${activeBranchId}` : "Seleccionar Sucursal");

  return (
    <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-2xl border-b border-slate-200/80 shadow-[0_4px_20px_-10px_rgba(15,23,42,0.1)]">

      {/* ══ TOP TIER: Brand & Profile (Desktop) ════════════════════ */}
      <div className="hidden lg:flex w-full items-center justify-between px-6 py-3">
        {/* Logo & Brand */}
        <Link href="/">
          <div className="group flex shrink-0 cursor-pointer items-center gap-3">
            <img
              src={companyConfig?.logo || "/logo.png"}
              alt={companyConfig?.name || "MP Shop"}
              className="h-10 w-auto max-w-[120px] object-contain transition-transform duration-300 group-hover:scale-105"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary/60 leading-none mb-1">
                Operación Diaria
              </span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold text-slate-900 tracking-tight leading-none">
                  {companyConfig?.name || "MP SHOP TIENDA ONLINE"}
                </span>
                <span className="bg-slate-100 text-[10px] px-1.5 py-0.5 rounded-md text-slate-600 font-mono border border-slate-200 leading-none">
                  v1.5.0
                </span>
              </div>
            </div>
          </div>
        </Link>

        {/* Right side: User Profile & Logout */}
        {user && (
          <div className="flex items-center gap-4">
            {/* Branch Selector */}
            <div className="flex items-center mr-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-9 gap-2 border-slate-200 font-semibold bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                    <Store className="h-4 w-4 text-primary" />
                    {branchDisplayName}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {branches.map(branch => (
                    <DropdownMenuItem 
                      key={branch.id} 
                      onClick={() => setActiveBranchId(branch.id)}
                      className={activeBranchId === branch.id ? "bg-slate-100 font-bold" : ""}
                    >
                      {branch.name}
                      {branch.isWarehouse && <span className="ml-auto text-[10px] text-muted-foreground uppercase">Bodega</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Campo de Escáner Rápido */}
            {user?.role === "admin" && (
              <QuickScannerInput />
            )}

            {/* 🔔 Notificaciones — Badge de alertas para admin (Oculto a petición) */}
            {/* {user?.role === "admin" && (
              <NotificationBell />
            )} */}

            {/* Ctrl+K Search Trigger */}
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}
              className="hidden lg:flex items-center gap-2 h-9 px-4 rounded-full border border-slate-200 bg-slate-50 hover:bg-white hover:border-primary/40 hover:shadow-sm transition-all text-sm text-slate-400 hover:text-slate-700 group"
              title="Búsqueda global (Ctrl+K)"
            >
              <Search className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
              <span>Buscar...</span>
              <kbd className="ml-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-400">Ctrl+K</kbd>
            </button>
            {/* User Badge */}
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-full pl-1.5 pr-4 py-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-white text-xs font-bold shadow-sm">
                {initial}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-800 leading-none">{user.name}</span>
                <span className="text-[10px] font-medium text-slate-500 mt-0.5 leading-none">
                  {user.role === "admin" ? "Administrador" : 
                   user.role === "seller" ? "Vendedor" :
                   user.role === "technician" ? "Técnico" :
                   user.role === "cashier" ? "Cajero" :
                   user.role === "delivery" ? "Repartidor" :
                   user.role === "warehouse" ? "Bodeguero" :
                   user.role === "manager" ? "Gerente" : "Usuario"}
                </span>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-200" />

            <button
              onClick={logout}
              title="Cerrar sesión"
              className="
                flex items-center gap-2 h-9 px-3 rounded-xl
                text-sm font-semibold text-slate-500
                transition-all duration-200
                hover:bg-red-50 hover:text-red-600 active:scale-95
              "
            >
              <LogOut className="h-4 w-4" />
              Salir
            </button>
          </div>
        )}
      </div>

      {/* ══ BOTTOM TIER: Navigation — 2 Rows (Desktop) ════════════ */}
      {user && (
        <div className="hidden lg:block w-full border-t border-slate-100/80 bg-slate-50/40">
          {/* Fila 1 — Módulos Operativos */}
          {visibleRow1.length > 0 && (
            <div className="flex items-center gap-x-1 w-full px-6 pt-1.5 pb-0 overflow-x-auto scrollbar-none">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mr-2 shrink-0">Operativo</span>
              {visibleRow1.map((item) => (
                <TabLink key={item.href} item={item} active={location === item.href} />
              ))}
            </div>
          )}
          {/* Fila 2 — Gestión & Análisis */}
          {visibleRow2.length > 0 && (
            <div className="flex items-center gap-x-1 w-full px-6 pb-1.5 pt-0.5 border-t border-slate-100/60 overflow-x-auto scrollbar-none">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mr-2 shrink-0">Gestión</span>
              {visibleRow2.map((item) => (
                <TabLink key={item.href} item={item} active={location === item.href} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ MOBILE & TABLET (< lg) ════════════════════════════════════ */}
      <div className="flex lg:hidden items-center justify-between w-full px-4 py-3">
        <Link href="/">
          <div className="flex items-center gap-2.5">
            <img src={companyConfig?.logo || "/logo.png"} alt={companyConfig?.name || "Logo"} className="h-9 w-auto object-contain" />
            <div className="flex flex-col">
              <span className="text-[14px] font-extrabold text-slate-900 leading-tight tracking-tight">{companyConfig?.name || "MP SHOP TIENDA ONLINE"}</span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-primary/60 leading-none">
                Op. diaria
              </span>
            </div>
            <span className="bg-slate-100 text-[9px] px-1.5 py-0.5 rounded-md text-slate-600 font-mono border border-slate-200 leading-none self-center">
              v1.5.0
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-1.5">
          {branches.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-slate-200 bg-slate-50 text-slate-700" title={`Sucursal: ${activeBranch?.name}`}>
                  <Store className="h-4 w-4 text-primary" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {branches.map(branch => (
                  <DropdownMenuItem 
                    key={branch.id} 
                    onClick={() => setActiveBranchId(branch.id)}
                    className={activeBranchId === branch.id ? "bg-slate-100 font-bold" : ""}
                  >
                    {branch.name}
                    {branch.isWarehouse && <span className="ml-auto text-[10px] text-muted-foreground uppercase">Bodega</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
