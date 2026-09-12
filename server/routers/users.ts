import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { toPlainObject } from "../_core/serialize";
import { hashPassword } from "../auth";
import { 
  getAllUsers, 
  getUserByUsername, 
  createUser, 
  updateUser, 
  deleteUser, 
  getUserById 
} from "../db";

export const ALL_SYSTEM_MODULES = [
  // Categoría: Operativo (13 módulos)
  { key: "sales", label: "Ventas", category: "operativo", icon: "ShoppingBag", description: "Punto de venta y facturación rápida" },
  { key: "catalog", label: "Catálogo", category: "operativo", icon: "BookOpen", description: "Listado y catálogo de productos con precios" },
  { key: "units", label: "Unidades", category: "operativo", icon: "Tag", description: "Inventario serializado, números de serie y estados" },
  { key: "repairs", label: "Taller", category: "operativo", icon: "Package", description: "Órdenes de servicio técnico y reparaciones" },
  { key: "warranties", label: "Garantías", category: "operativo", icon: "Tag", description: "Control de pólizas, días restantes y RMA" },
  { key: "returns", label: "Devoluciones", category: "operativo", icon: "Package", description: "Gestión de devoluciones y cambios de producto" },
  { key: "orders", label: "Pedidos / Despachos", category: "operativo", icon: "ShoppingCart", description: "Gestión y asignación de pedidos" },
  { key: "delivery-load", label: "Mi Carga de Reparto", category: "operativo", icon: "Package", description: "Carga de ruta y productos asignados al repartidor" },
  { key: "generate-codes", label: "Códigos QR", category: "operativo", icon: "Tag", description: "Generador de códigos QR y de barras para impresión" },
  { key: "customers", label: "Clientes", category: "operativo", icon: "Users", description: "Directorio de clientes y créditos" },
  { key: "suppliers", label: "Proveedores", category: "operativo", icon: "Users", description: "Directorio de proveedores y contactos" },
  { key: "purchases", label: "Compras", category: "operativo", icon: "ShoppingCart", description: "Registro de compras y órdenes de entrada" },

  // Categoría: Gestión & Análisis (12 módulos)
  { key: "dashboard-kpis", label: "📊 KPIs", category: "gestion", icon: "BarChart3", description: "6 indicadores clave en tiempo real" },
  { key: "reports", label: "📈 Reportes", category: "gestion", icon: "BarChart3", description: "Generación de reportes ejecutivos y PDF" },
  { key: "dashboard", label: "Dashboard", category: "gestion", icon: "LayoutDashboard", description: "Panel operativo y resúmenes" },
  { key: "analytics", label: "Analítica", category: "gestion", icon: "TrendingUp", description: "Estadísticas avanzadas de rendimiento" },
  { key: "rentabilidad", label: "💰 Rentabilidad", category: "gestion", icon: "TrendingUp", description: "Estado de resultados real, márgenes y P&L" },
  { key: "finance", label: "Finanzas", category: "gestion", icon: "DollarSign", description: "Apertura y cierre de cajas, movimientos" },
  { key: "repartidor-finance", label: "Caja Repartidor", category: "gestion", icon: "DollarSign", description: "Arqueo y entrega de dinero en ruta" },
  { key: "accounts-receivable", label: "C. por Cobrar", category: "gestion", icon: "CreditCard", description: "Gestión de cartera y cuentas por cobrar" },
  { key: "accounts-payable", label: "C. por Pagar", category: "gestion", icon: "Landmark", description: "Cuentas por pagar a proveedores" },
  { key: "expenses", label: "Gastos", category: "gestion", icon: "Receipt", description: "Registro y control de gastos operativos" },
  { key: "branches", label: "Sucursales", category: "gestion", icon: "Store", description: "Administración de tiendas y bodegas" },
  { key: "users", label: "Usuarios & Permisos", category: "gestion", icon: "Users", description: "Control de acceso, roles y permisos de usuarios" },
  { key: "delivery-persons", label: "Control Repartidores", category: "gestion", icon: "Truck", description: "Asignación y monitoreo de hojas de ruta de repartidores" },
];

export const ROLE_TEMPLATES: Record<string, {
  name: string;
  description: string;
  allowedModules: string[];
  specialPermissions: {
    canViewPurchaseCost: boolean;
    canApplyDiscounts: boolean;
    canViewFinancialReports: boolean;
    canManageInventory: boolean;
    canDeleteRecords: boolean;
  };
}> = {
  admin: {
    name: "Administrador",
    description: "Acceso total a todos los módulos y control maestro del sistema",
    allowedModules: ALL_SYSTEM_MODULES.map(m => m.key),
    specialPermissions: {
      canViewPurchaseCost: true,
      canApplyDiscounts: true,
      canViewFinancialReports: true,
      canManageInventory: true,
      canDeleteRecords: true,
    }
  },
  seller: {
    name: "Vendedor / Comercial",
    description: "Ventas de mostrador, consulta de catálogo, clientes, garantías y pedidos",
    allowedModules: ["sales", "catalog", "units", "warranties", "returns", "orders", "generate-codes", "customers"],
    specialPermissions: {
      canViewPurchaseCost: false,
      canApplyDiscounts: true,
      canViewFinancialReports: false,
      canManageInventory: false,
      canDeleteRecords: false,
    }
  },
  technician: {
    name: "Técnico de Taller",
    description: "Taller técnico, diagnóstico de unidades, recepción de garantías y catálogo",
    allowedModules: ["repairs", "units", "warranties", "returns", "catalog", "generate-codes"],
    specialPermissions: {
      canViewPurchaseCost: false,
      canApplyDiscounts: false,
      canViewFinancialReports: false,
      canManageInventory: true,
      canDeleteRecords: false,
    }
  },
  cashier: {
    name: "Cajero / Finanzas",
    description: "Ventas, control de caja, cobros, pagos, gastos y reportes financieros",
    allowedModules: ["sales", "orders", "finance", "accounts-receivable", "accounts-payable", "expenses", "dashboard-kpis", "reports", "customers"],
    specialPermissions: {
      canViewPurchaseCost: false,
      canApplyDiscounts: true,
      canViewFinancialReports: true,
      canManageInventory: false,
      canDeleteRecords: false,
    }
  },
  user: {
    name: "Repartidor / Entregas",
    description: "Empleado de reparto: Mis pedidos de despacho, carga de ruta, entregas y cobros",
    allowedModules: ["orders", "delivery-load", "repartidor-finance", "sales", "catalog", "customers"],
    specialPermissions: {
      canViewPurchaseCost: false,
      canApplyDiscounts: false,
      canViewFinancialReports: false,
      canManageInventory: false,
      canDeleteRecords: false,
    }
  },
};

function formatUserResponse(u: any) {
  let allowedModules: string[] = [];
  try {
    if (typeof u.allowedModules === "string") {
      allowedModules = JSON.parse(u.allowedModules);
    } else if (Array.isArray(u.allowedModules)) {
      allowedModules = u.allowedModules;
    } else if (u.role === "admin") {
      allowedModules = ALL_SYSTEM_MODULES.map(m => m.key);
    }
  } catch {
    allowedModules = [];
  }

  let specialPermissions = {
    canViewPurchaseCost: false,
    canApplyDiscounts: false,
    canViewFinancialReports: false,
    canManageInventory: false,
    canDeleteRecords: false,
  };
  try {
    if (typeof u.specialPermissions === "string") {
      specialPermissions = { ...specialPermissions, ...JSON.parse(u.specialPermissions) };
    } else if (typeof u.specialPermissions === "object" && u.specialPermissions !== null) {
      specialPermissions = { ...specialPermissions, ...u.specialPermissions };
    } else if (u.role === "admin") {
      specialPermissions = {
        canViewPurchaseCost: true,
        canApplyDiscounts: true,
        canViewFinancialReports: true,
        canManageInventory: true,
        canDeleteRecords: true,
      };
    }
  } catch {
    // defaults
  }

  let assignedBranchIds: any[] = ["all"];
  try {
    if (typeof u.assignedBranchIds === "string") {
      assignedBranchIds = JSON.parse(u.assignedBranchIds);
    } else if (Array.isArray(u.assignedBranchIds)) {
      assignedBranchIds = u.assignedBranchIds;
    }
  } catch {
    assignedBranchIds = ["all"];
  }

  return {
    id: u.id,
    username: u.username,
    name: u.name || u.username,
    email: u.email || "",
    phone: u.phone || "",
    role: u.role || "seller",
    status: u.status || "active",
    allowedModules,
    specialPermissions,
    assignedBranchIds,
    createdAt: u.createdAt ? (u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt)) : null,
    lastSignedIn: u.lastSignedIn ? (u.lastSignedIn instanceof Date ? u.lastSignedIn.toISOString() : String(u.lastSignedIn)) : null,
  };
}

export const usersRouter = router({
  // Obtener plantillas de roles y catálogo de módulos del sistema
  getRoleTemplates: publicProcedure.query(async () => {
    return {
      modules: ALL_SYSTEM_MODULES,
      templates: ROLE_TEMPLATES,
    };
  }),

  // Listar todos los usuarios
  list: protectedProcedure.query(async () => {
    const allUsers = await getAllUsers();
    const formatted = (allUsers as any[]).map(formatUserResponse);
    return formatted;
  }),

  // Obtener usuario por ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const user = await getUserById(input.id);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Usuario no encontrado",
        });
      }
      return formatUserResponse(user);
    }),

  // Crear usuario con permisos completos
  create: protectedProcedure
    .input(
      z.object({
        username: z.string().min(3, "El usuario debe tener al menos 3 caracteres"),
        password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
        name: z.string().min(1, "El nombre es requerido"),
        email: z.string().email("Email inválido").optional().or(z.literal("")),
        phone: z.string().optional().or(z.literal("")),
        role: z.enum(["admin", "technician", "seller", "cashier", "user"]).default("seller"),
        status: z.enum(["active", "inactive"]).default("active"),
        allowedModules: z.array(z.string()).optional(),
        specialPermissions: z.object({
          canViewPurchaseCost: z.boolean().default(false),
          canApplyDiscounts: z.boolean().default(false),
          canViewFinancialReports: z.boolean().default(false),
          canManageInventory: z.boolean().default(false),
          canDeleteRecords: z.boolean().default(false),
        }).optional(),
        assignedBranchIds: z.array(z.union([z.number(), z.string()])).default(["all"]),
      })
    )
    .mutation(async ({ input }) => {
      const existingUser = await getUserByUsername(input.username);
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El nombre de usuario ya está registrado en el sistema",
        });
      }

      const passwordHash = await hashPassword(input.password);

      // Usar plantilla si no se especifican módulos
      let modules = input.allowedModules;
      let special = input.specialPermissions;
      if (!modules && ROLE_TEMPLATES[input.role]) {
        modules = ROLE_TEMPLATES[input.role].allowedModules;
      }
      if (!special && ROLE_TEMPLATES[input.role]) {
        special = ROLE_TEMPLATES[input.role].specialPermissions;
      }

      try {
        const result = await createUser({
          username: input.username,
          passwordHash,
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          role: input.role,
          status: input.status,
          allowedModules: JSON.stringify(modules || []),
          specialPermissions: JSON.stringify(special || {}),
          assignedBranchIds: JSON.stringify(input.assignedBranchIds || ["all"]),
          loginMethod: "traditional",
        });

        // Extraer el insertId de forma segura
        let userId: number | undefined;
        if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && 'insertId' in result[0]) {
          userId = Number(result[0].insertId);
        } else if (result && typeof result === 'object' && 'insertId' in result) {
          userId = Number((result as any).insertId);
        }

        return toPlainObject({
          success: true,
          message: "Usuario creado exitosamente con permisos asignados",
          userId,
        });
      } catch (err: any) {
        console.error("[users.create] Error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Error al crear el usuario",
        });
      }
    }),

  // Actualizar usuario
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1, "El nombre es requerido").optional(),
        email: z.string().email("Email inválido").optional().or(z.literal("")),
        phone: z.string().optional().or(z.literal("")),
        password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").optional().or(z.literal("")),
        role: z.enum(["admin", "technician", "seller", "cashier", "user"]).optional(),
        status: z.enum(["active", "inactive"]).optional(),
        allowedModules: z.array(z.string()).optional(),
        specialPermissions: z.object({
          canViewPurchaseCost: z.boolean(),
          canApplyDiscounts: z.boolean(),
          canViewFinancialReports: z.boolean(),
          canManageInventory: z.boolean(),
          canDeleteRecords: z.boolean(),
        }).optional(),
        assignedBranchIds: z.array(z.union([z.number(), z.string()])).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updateData: any = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.email !== undefined) updateData.email = input.email || null;
      if (input.phone !== undefined) updateData.phone = input.phone || null;
      if (input.password && input.password.trim().length > 0) {
        updateData.passwordHash = await hashPassword(input.password);
      }
      if (input.role !== undefined) updateData.role = input.role;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.allowedModules !== undefined) updateData.allowedModules = JSON.stringify(input.allowedModules);
      if (input.specialPermissions !== undefined) updateData.specialPermissions = JSON.stringify(input.specialPermissions);
      if (input.assignedBranchIds !== undefined) updateData.assignedBranchIds = JSON.stringify(input.assignedBranchIds);

      try {
        await updateUser(input.id, updateData);
        return toPlainObject({
          success: true,
          message: "Usuario actualizado correctamente",
        });
      } catch (err: any) {
        console.error("[users.update] Error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Error al actualizar el usuario",
        });
      }
    }),

  // Alternar estado activo / inactivo
  toggleStatus: protectedProcedure
    .input(z.object({ id: z.number(), status: z.enum(["active", "inactive"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user?.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No puedes desactivar tu propio usuario",
        });
      }

      try {
        await updateUser(input.id, { status: input.status });
        return toPlainObject({
          success: true,
          message: `Usuario ${input.status === "active" ? "activado" : "desactivado"} con éxito`,
        });
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Error al cambiar estado",
        });
      }
    }),

  // Eliminar usuario
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user?.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No puedes eliminar tu propio usuario",
        });
      }

      if (input.id === 999 || input.id === 1000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede eliminar la cuenta de administrador principal",
        });
      }

      try {
        await deleteUser(input.id);
        return toPlainObject({
          success: true,
          message: "Usuario eliminado correctamente",
        });
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Error al eliminar usuario",
        });
      }
    }),

  // ─── Retrocompatibilidad con nombres anteriores ───
  listDeliveryPersons: protectedProcedure.query(async () => {
    const allUsers = await getAllUsers();
    return (allUsers as any[]).map(formatUserResponse);
  }),

  getDeliveryPerson: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const user = await getUserById(input.id);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado" });
      return formatUserResponse(user);
    }),

  createDeliveryPerson: protectedProcedure
    .input(
      z.object({
        username: z.string().min(3),
        password: z.string().min(6),
        name: z.string().min(1),
        email: z.string().email().optional(),
        role: z.enum(["admin", "technician", "seller", "user"]).default("seller"),
      })
    )
    .mutation(async ({ input }) => {
      const existingUser = await getUserByUsername(input.username);
      if (existingUser) throw new TRPCError({ code: "CONFLICT", message: "El usuario ya existe" });
      const passwordHash = await hashPassword(input.password);
      await createUser({
        username: input.username,
        passwordHash,
        name: input.name,
        email: input.email,
        role: input.role,
        loginMethod: "traditional",
      });
      return { success: true, message: "Usuario creado exitosamente" };
    }),

  updateDeliveryPerson: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        password: z.string().min(6).optional(),
        role: z.enum(["admin", "technician", "seller", "user"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const updateData: any = {};
      if (input.name) updateData.name = input.name;
      if (input.email) updateData.email = input.email;
      if (input.password) updateData.passwordHash = await hashPassword(input.password);
      if (input.role) updateData.role = input.role;
      await updateUser(input.id, updateData);
      return { success: true };
    }),

  deleteDeliveryPerson: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user?.id) throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes eliminar tu propio usuario" });
      await deleteUser(input.id);
      return { success: true };
    }),

  register: publicProcedure
    .input(
      z.object({
        username: z.string().min(3, "El usuario debe tener al menos 3 caracteres"),
        password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
        name: z.string().min(1, "El nombre es requerido"),
        email: z.string().email("Email inválido").optional(),
        role: z.enum(["admin", "technician", "seller", "cashier", "user"]).default("seller"),
      })
    )
    .mutation(async ({ input }) => {
      const existingUser = await getUserByUsername(input.username);
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El nombre de usuario ya está en uso",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const template = ROLE_TEMPLATES[input.role] || ROLE_TEMPLATES.seller;

      const result = await createUser({
        username: input.username,
        passwordHash,
        name: input.name,
        email: input.email,
        role: input.role,
        status: "active",
        allowedModules: JSON.stringify(template.allowedModules),
        specialPermissions: JSON.stringify(template.specialPermissions),
        assignedBranchIds: JSON.stringify(["all"]),
        loginMethod: "traditional",
      });

      // Extraer el insertId de forma segura
      let userId: number | undefined;
      if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && 'insertId' in result[0]) {
        userId = Number(result[0].insertId);
      } else if (result && typeof result === 'object' && 'insertId' in result) {
        userId = Number((result as any).insertId);
      }

      return {
        success: true,
        userId,
      };
    }),
});
