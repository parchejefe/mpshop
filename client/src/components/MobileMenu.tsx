import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  DollarSign,
  Home,
  LogOut,
  Menu,
  Package,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  Truck,
  Users,
  X,
  CreditCard,
  Landmark,
  Wallet,
  Store,
} from "lucide-react";

/* ─── admin sections with categories ───────────────────────────── */
const ADMIN_SECTIONS = [
  {
    title: "Operaciones",
    items: [
      { href: "/",               label: "Inicio",            icon: Home },
      { href: "/catalog",        label: "📦 Catálogo",       icon: Package },
      { href: "/units",          label: "Unidades",          icon: Tag },
      { href: "/repairs",        label: "Taller & Técnico",  icon: Package },
      { href: "/warranties",     label: "Garantías",         icon: Tag },
      { href: "/returns",        label: "Devoluciones (RMA)",icon: Package },
      { href: "/generate-codes", label: "Códigos QR",        icon: Tag },
      { href: "/sales",          label: "Ventas",            icon: ShoppingBag },
      // { href: "/orders",      label: "Pedidos",            icon: ShoppingCart },    // OCULTO
    ],
  },
  {
    title: "Análisis & Reportes",
    items: [
      { href: "/dashboard-kpis", label: "📊 KPIs Tiempo Real",   icon: BarChart3 },
      { href: "/reports",        label: "📈 Reportes",            icon: BarChart3 },
      { href: "/analytics",      label: "Analítica Avanzada",     icon: TrendingUp },
      { href: "/admin/rentabilidad", label: "💰 Rentabilidad Real", icon: TrendingUp },
    ],
  },
  {
    title: "Gestión",
    items: [
      { href: "/users",          label: "👥 Usuarios & Permisos", icon: Users },
      { href: "/branches",       label: "Sucursales",             icon: Package },
      { href: "/customers",      label: "Clientes",               icon: Users },
      { href: "/suppliers",      label: "Proveedores",            icon: Users },
      // { href: "/delivery-persons", label: "Repartidores",       icon: Truck }, // OCULTO
    ],
  },
  {
    title: "Finanzas",
    items: [
      { href: "/purchases",                 label: "Compras",               icon: ShoppingCart },
      { href: "/finance",                   label: "Finanzas & Caja",       icon: DollarSign },
      { href: "/admin/cajas-vendedores",    label: "Cajas Vendedores",      icon: Store },
      { href: "/accounts-receivable",       label: "C. por Cobrar",         icon: CreditCard },
      { href: "/accounts-payable",          label: "C. por Pagar",          icon: Landmark },
      { href: "/expenses",                  label: "Gastos",                icon: Receipt },
      // { href: "/admin/control-financiero",  label: "🔔 Control Financiero", icon: DollarSign }, // OCULTO
      // { href: "/admin/auditoria-datos",     label: "🔍 Auditoría Datos",    icon: Receipt }, // OCULTO
      // { href: "/repartidor/finance",     label: "Caja Reparto",          icon: DollarSign }, // OCULTO
    ],
  },
];

const DELIVERY_ITEMS = [
  { href: "/",                   label: "Inicio",        icon: Home },
  { href: "/orders",             label: "Mis Pedidos",   icon: ShoppingCart },
  { href: "/delivery-load",      label: "Mi Carga",      icon: Package },
  { href: "/sales",              label: "Ventas",        icon: ShoppingBag },
  { href: "/repartidor/finance", label: "Cierre de caja",icon: DollarSign },
];

const SELLER_ITEMS = [
  { href: "/",                label: "Inicio",        icon: Home },
  { href: "/sales",           label: "Ventas",        icon: ShoppingBag },
  { href: "/catalog",         label: "Catalogo",      icon: Package },
  { href: "/customers",       label: "Clientes",      icon: Users },
  { href: "/vendedor/caja",   label: "Mi Caja",       icon: Wallet },
];

/* ─── component ─────────────────────────────────────────────────── */
export default function MobileMenu({ triggerClassName }: { triggerClassName?: string }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const isActive = (path: string) => location === path;
  const close = () => setOpen(false);

  const roleLabel = user?.role === "admin" ? "Administrador" : 
                    user?.role === "seller" ? "Vendedor" :
                    user?.role === "delivery" ? "Repartidor" :
                    user?.role === "technician" ? "Tecnico" : "Usuario";
  const initial = user?.name?.charAt(0).toUpperCase() ?? "U";

  return (
    <Sheet open={open} onOpenChange={setOpen}>

      {/* ── Trigger button ─────────────────────────────────────────── */}
      <SheetTrigger asChild>
        {triggerClassName ? (
          <button aria-label="Abrir menú" className={triggerClassName}>
            <div className="flex flex-col items-center justify-center gap-0.5 py-2.5 px-1">
              <div className="flex items-center justify-center w-8 h-8 rounded-xl">
                <Menu className="h-5 w-5 shrink-0" />
              </div>
              <span className="text-[10px] font-semibold leading-none tracking-tight">Más</span>
            </div>
          </button>
        ) : (
          <button
            aria-label="Abrir menú"
            className="
              flex items-center justify-center
              h-10 w-10 rounded-xl
              border border-slate-200 bg-white
              text-slate-600 shadow-sm
              transition-all duration-200
              hover:bg-slate-50 hover:text-slate-900 hover:shadow-md
              active:scale-95
            "
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
      </SheetTrigger>

      {/* ── Drawer ─────────────────────────────────────────────────── */}
      <SheetContent
        side="left"
        className="w-[82vw] max-w-[320px] p-0 border-0 bg-transparent shadow-none"
      >
        <div className="flex h-full flex-col bg-white/96 backdrop-blur-2xl rounded-r-3xl border-r border-white/60 shadow-[4px_0_40px_-10px_rgba(15,23,42,0.22)] overflow-hidden">

          {/* ── Header ───────────────────────────────────────────── */}
          <div className="relative flex items-center justify-between px-5 pt-6 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="
                flex h-11 w-11 items-center justify-center rounded-2xl shrink-0
                bg-gradient-to-br from-slate-800 to-slate-600
                shadow-[0_8px_20px_-8px_rgba(15,23,42,0.55)]
                text-white text-sm font-extrabold tracking-wide
              ">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-slate-900 truncate leading-tight">
                  {user?.name ?? "Usuario"}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-slate-400 font-medium">{roleLabel}</span>
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 leading-none">
                    <Sparkles className="h-2.5 w-2.5" />
                    Online
                  </span>
                </div>
              </div>
            </div>
            {/* Close button */}
            <button
              onClick={close}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Nav items ────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
            {user?.role === "admin" ? (
              ADMIN_SECTIONS.map((section) => (
                <div key={section.title}>
                  {/* Section label */}
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 px-2 mb-1.5">
                    {section.title}
                  </p>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = isActive(item.href);
                      const Icon = item.icon;
                      return (
                        <Link key={item.href} href={item.href} onClick={close}>
                          <div className={`
                            flex items-center gap-3 rounded-xl px-3 py-2.5
                            text-[13px] font-semibold
                            transition-all duration-150 cursor-pointer
                            ${active
                              ? "bg-primary text-white shadow-[0_4px_14px_-4px_var(--primary)]"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            }
                          `}>
                            <div className={`
                              flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
                              ${active
                                ? "bg-white/20"
                                : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                              }
                            `}>
                              <Icon className="h-4 w-4" />
                            </div>
                            {item.label}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-0.5">
                {(user?.role === "seller" ? SELLER_ITEMS : DELIVERY_ITEMS).map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={close}>
                      <div className={`
                        flex items-center gap-3 rounded-xl px-3 py-2.5
                        text-[13px] font-semibold
                        transition-all duration-150 cursor-pointer
                        ${active
                          ? "bg-primary text-white shadow-[0_4px_14px_-4px_var(--primary)]"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }
                      `}>
                        <div className={`
                          flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
                          ${active ? "bg-white/20" : "bg-slate-100 text-slate-500"}
                        `}>
                          <Icon className="h-4 w-4" />
                        </div>
                        {item.label}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Footer / logout ───────────────────────────────────── */}
          <div className="px-3 pb-6 pt-3 border-t border-slate-100">
            <button
              onClick={() => { logout(); close(); }}
              className="
                flex w-full items-center gap-3 rounded-xl px-3 py-3
                text-[13px] font-semibold text-red-500
                bg-red-50 border border-red-100
                transition-all duration-150
                hover:bg-red-100 hover:text-red-700 hover:border-red-200
                active:scale-[0.98]
              "
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100">
                <LogOut className="h-4 w-4" />
              </div>
              Cerrar sesión
            </button>
          </div>

        </div>
      </SheetContent>
    </Sheet>
  );
}
