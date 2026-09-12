import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { toPlainObject } from "../_core/serialize";
import {
  getOperationalExpenses,
  getOperationalExpenseById,
  createOperationalExpense,
  updateOperationalExpense,
  deleteOperationalExpense,
} from "../db";
import { TRPCError } from "@trpc/server";
import { ALL_CATEGORY_KEYS, MANUAL_CATEGORY_KEYS, getCategoryLabel, getCategoryGroup, EXPENSE_CATEGORIES, getCategoriesByGroup } from "../../shared/expenseCategories";

// 🟡 MEDIO #2: Categorías normalizadas desde catálogo centralizado (shared/expenseCategories.ts)
const EXPENSE_CATEGORY_ENUM = z.enum(ALL_CATEGORY_KEYS);
const MANUAL_CATEGORY_ENUM  = z.enum(MANUAL_CATEGORY_KEYS);


// Schema de filtros compartidos
const expenseFiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  period: z.enum(["today", "week", "month", "last_month", "quarter", "year", "all", "custom"]).optional(),
  branchId: z.number().optional(),
  category: z.string().optional(),
  costType: z.string().optional(),
  status: z.enum(["all", "pending", "paid"]).optional(),
  paymentMethod: z.enum(["cash", "qr", "transfer"]).optional(),
  search: z.string().optional(),
}).optional();

function filterExpenses(expenses: any[], filters: any) {
  if (!filters) return expenses;

  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (filters.period === "custom" && filters.from && filters.to) {
    startDate = new Date(filters.from + "T00:00:00");
    endDate = new Date(filters.to + "T23:59:59");
  } else if (filters.period) {
    const now = new Date();
    switch (filters.period) {
      case "today":
        startDate = new Date(now.setHours(0, 0, 0, 0));
        endDate = new Date(now.setHours(23, 59, 59, 999));
        break;
      case "week":
        startDate = new Date(now.setDate(now.getDate() - 7));
        endDate = new Date();
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        endDate = new Date();
        break;
      case "last_month":
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case "quarter":
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1, 0, 0, 0);
        endDate = new Date();
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        endDate = new Date();
        break;
      case "all":
        startDate = null;
        endDate = null;
        break;
    }
  } else if (filters.from && filters.to) {
    startDate = new Date(filters.from + "T00:00:00");
    endDate = new Date(filters.to + "T23:59:59");
  }

  const querySearch = filters.search?.toLowerCase().trim();

  return expenses.filter((e: any) => {
    // Fecha
    if (startDate || endDate) {
      const d = new Date(e.expenseDate || e.createdAt);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
    }
    // Sucursal
    if (filters.branchId && (e.branchId || 1) !== filters.branchId) return false;
    // Categoría
    if (filters.category && filters.category !== "all" && e.category !== filters.category) return false;
    // Tipo de Costo
    if (filters.costType && filters.costType !== "all") {
      const ct = e.costType || inferCostType(e.category);
      if (ct !== filters.costType) return false;
    }
    // Estado
    if (filters.status && filters.status !== "all" && e.status !== filters.status) return false;
    // Método de Pago
    if (filters.paymentMethod && e.paymentMethod !== filters.paymentMethod) return false;
    // Búsqueda libre
    if (querySearch) {
      const matchDesc = (e.description || "").toLowerCase().includes(querySearch);
      const matchSupp = (e.supplierName || "").toLowerCase().includes(querySearch);
      const matchInv = (e.invoiceNumber || "").toLowerCase().includes(querySearch);
      const matchNotes = (e.notes || "").toLowerCase().includes(querySearch);
      if (!matchDesc && !matchSupp && !matchInv && !matchNotes) return false;
    }

    return true;
  });
}

export const expensesRouter = router({
  list: protectedProcedure
    .input(expenseFiltersSchema)
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const rawExpenses = await getOperationalExpenses(input?.branchId || ctx.branchId);
      return toPlainObject(filterExpenses(rawExpenses as any[], input));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const expense = await getOperationalExpenseById(input.id);
      if (!expense) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Gasto no encontrado" });
      }
      return toPlainObject(expense);
    }),

  create: protectedProcedure
    .input(
      z.object({
        description: z.string().min(1, "Descripción requerida"),
        category: MANUAL_CATEGORY_ENUM,
        costType: z.string().optional(),
        amount: z.number().min(1, "Monto debe ser mayor a 0"),
        paymentMethod: z.enum(["cash", "qr", "transfer"]),
        expenseDate: z.string().optional(),
        dueDate: z.string().optional(),
        status: z.enum(["pending", "paid"]).default("pending"),
        supplierName: z.string().optional(),
        invoiceNumber: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo los administradores pueden registrar gastos" });
      }

      // Determinar costType según categoría si no fue provisto
      const costType = input.costType || inferCostType(input.category);

      try {
        const result = await createOperationalExpense({
          ...input,
          costType,
          isAutomatic: 0,
          userId: ctx.user.id,
          branchId: ctx.branchId,
          expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        });
        return toPlainObject(result);
      } catch (err: any) {
        console.error("[expenses.create] Error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Error al registrar el gasto",
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        description: z.string().min(1).optional(),
        category: MANUAL_CATEGORY_ENUM.optional(),
        amount: z.number().min(1).optional(),
        paymentMethod: z.enum(["cash", "qr", "transfer"]).optional(),
        expenseDate: z.string().optional(),
        dueDate: z.string().optional(),
        status: z.enum(["pending", "paid"]).optional(),
        supplierName: z.string().optional(),
        invoiceNumber: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Verificar que no se estén editando gastos automáticos
      const existing = await getOperationalExpenseById(input.id);
      if (existing && (existing as any).isAutomatic === 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se pueden editar costos generados automáticamente por el sistema." });
      }

      const { id, ...data } = input;
      return await updateOperationalExpense(id, {
        ...data,
        userId: ctx.user.id,
        branchId: ctx.branchId,
        expenseDate: data.expenseDate ? new Date(data.expenseDate) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      });
    }),

  markAsPaid: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        paymentMethod: z.enum(["cash", "qr", "transfer"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const expense = await getOperationalExpenseById(input.id);
      if (!expense) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Gasto no encontrado" });
      }

      return await updateOperationalExpense(input.id, {
        status: "paid",
        paymentMethod: input.paymentMethod || expense.paymentMethod,
        userId: ctx.user.id,
        branchId: ctx.branchId,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // No permitir borrar costos automáticos
      const existing = await getOperationalExpenseById(input.id);
      if (existing && (existing as any).isAutomatic === 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se pueden eliminar costos generados automáticamente por el sistema." });
      }

      return await deleteOperationalExpense(input.id);
    }),

  // Resumen por categoría con agrupación por costType
  summaryByCategory: protectedProcedure
    .input(expenseFiltersSchema)
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const rawExpenses = await getOperationalExpenses(input?.branchId || ctx.branchId);
      const expenses = filterExpenses(rawExpenses as any[], input);

      const allCategories = [
        "facebook_ads", "google_ads", "electricity", "water", "internet",
        "telephone", "rent", "salaries", "maintenance", "supplies",
        "taxes", "insurance", "bank_fees",
        "repair_cost", "warranty_repair_cost", "warranty_replacement_cost", "cogs",
        "other",
      ];

      const summary: Record<string, { pending: number; paid: number; total: number; count: number; costType: string }> = {};
      for (const cat of allCategories) {
        summary[cat] = { pending: 0, paid: 0, total: 0, count: 0, costType: inferCostType(cat) };
      }

      for (const expense of expenses as any[]) {
        const cat = expense.category as string;
        if (!summary[cat]) {
          summary[cat] = { pending: 0, paid: 0, total: 0, count: 0, costType: inferCostType(cat) };
        }
        const amount = expense.amount / 100;
        summary[cat].total += amount;
        summary[cat].count += 1;
        if (expense.status === "pending") {
          summary[cat].pending += amount;
        } else {
          summary[cat].paid += amount;
        }
      }

      return toPlainObject(summary);
    }),

  // Totales generales desglosados por costType y filtros aplicados
  totals: protectedProcedure
    .input(expenseFiltersSchema)
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const rawExpenses = await getOperationalExpenses(input?.branchId || ctx.branchId);
      const expenses = filterExpenses(rawExpenses as any[], input);

      let totalPending = 0;
      let totalPaid = 0;
      let countPending = 0;
      let countPaid = 0;

      // Subtotales por tipo de costo
      const byType: Record<string, number> = {
        direct_cost: 0,
        repair_cost: 0,
        warranty_cost: 0,
        operational_expense: 0,
        admin_expense: 0,
      };

      for (const expense of expenses as any[]) {
        const amount = expense.amount / 100;
        const ct = expense.costType || inferCostType(expense.category);
        if (expense.status === "pending") {
          totalPending += amount;
          countPending += 1;
        } else {
          totalPaid += amount;
          countPaid += 1;
          if (byType[ct] !== undefined) byType[ct] += amount;
          else byType["operational_expense"] += amount;
        }
      }

      return toPlainObject({
        totalPending,
        totalPaid,
        total: totalPending + totalPaid,
        countPending,
        countPaid,
        count: (expenses as any[]).length,
        byType,
      });
    }),

  // 🟡 MEDIO #2: Endpoint que expone el catálogo normalizado al frontend
  getCatalog: protectedProcedure.query(() => {
    return {
      categories: EXPENSE_CATEGORIES,
      byGroup: getCategoriesByGroup(),
    };
  }),
});

/** Infiere el costType de una categoría cuando no está explícito */
function inferCostType(category: string): string {
  switch (category) {
    case "cogs":
      return "direct_cost";
    case "repair_cost":
      return "repair_cost";
    case "warranty_repair_cost":
    case "warranty_replacement_cost":
      return "warranty_cost";
    case "salaries":
      return "admin_expense";
    case "facebook_ads":
    case "google_ads":
    case "electricity":
    case "water":
    case "internet":
    case "telephone":
    case "rent":
    case "maintenance":
    case "supplies":
    case "taxes":
    case "insurance":
    case "bank_fees":
    default:
      return "operational_expense";
  }
}
