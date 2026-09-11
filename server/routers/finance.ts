import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { toPlainObject } from "../_core/serialize";
import {
  getCashClosureByUserIdAndDate,
  createCashClosure,
  getAllCashClosures,
  updateCashClosure,
  getCashClosureById,
  getCashClosuresByUserId,
  getExpectedDailyTotals,
  getFinancialTransactions,
  createDeliveryExpense,
  getAllCashOpenings,
  getCashOpeningByUserIdAndDateMethod,
  getActiveCashOpeningByUserIdAndMethod,
  createCashOpening,
  getAllUsers,
  getPendingOrdersTotal,
  createFinancialTransactionsForDeliveries,
  getAllOrders,
  getOrderItems,
  updateCashOpeningStatus,
  processFinancialLiquidation,
} from "../db";
import { getLocalDateKey, pad2 } from "../_core/date_utils";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { sellerCashRegisters } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";


export const financeRouter = router({
  getTransactions: protectedProcedure
    .input(z.object({ branchId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // Si es repartidor, solo ve las suyas. Si es admin, ve todas.
      const userId = ctx.user?.role === "admin" ? undefined : ctx.user?.id;
      const branchId = input?.branchId ?? ctx.branchId;
    
    const allTransactions = await getFinancialTransactions(userId, branchId);
    const allOpenings = await getAllCashOpenings();
    const allClosures = await getAllCashClosures();
    const allUsers = await getAllUsers();
    const activeUsersMap = new Map((allUsers as any[]).map((u: any) => [u.id, u.name || u.username]));

    // Construir filas de aperturas
    const openingRows = (allOpenings as any[])
      .filter((o: any) => activeUsersMap.has(o.responsibleUserId))
      .map((o: any) => ({
        id: `opening-${o.id}`,
        type: "income",
        category: "cash_opening",
        amount: o.openingAmount,
        paymentMethod: o.paymentMethod || "cash",
        notes: o.notes || `Apertura de caja - ${o.responsibleUserName || activeUsersMap.get(o.responsibleUserId) || `Usuario #${o.responsibleUserId}`}`,
        userId: o.responsibleUserId,
        userName: o.responsibleUserName || activeUsersMap.get(o.responsibleUserId) || `Usuario #${o.responsibleUserId}`,
        createdAt: o.createdAt ? new Date(o.createdAt) : new Date(o.openingDate + "T12:00:00"),
        runningBalance: 0,
        isOpening: true,
        isClosure: false,
      }));

    // Construir filas de cierres separadas por método de pago
    const closureRows: any[] = [];
    (allClosures as any[])
      .filter((c: any) => activeUsersMap.has(c.userId))
      .forEach((c: any) => {
        const uName = activeUsersMap.get(c.userId) || `Usuario #${c.userId}`;
        const cDate = c.createdAt ? new Date(c.createdAt) : new Date(c.date + "T23:59:59");
        let hasAny = false;

        if (c.reportedCash && c.reportedCash > 0) {
          hasAny = true;
          closureRows.push({
            id: `closure-${c.id}-cash`,
            type: "expense",
            category: "cash_closure",
            amount: c.reportedCash,
            paymentMethod: "cash",
            notes: `Cierre de caja Efectivo - ${uName}`,
            userId: c.userId,
            userName: uName,
            createdAt: cDate,
            runningBalance: 0,
            isOpening: false,
            isClosure: true,
          });
        }

        if (c.reportedQr && c.reportedQr > 0) {
          hasAny = true;
          closureRows.push({
            id: `closure-${c.id}-qr`,
            type: "expense",
            category: "cash_closure",
            amount: c.reportedQr,
            paymentMethod: "qr",
            notes: `Cierre de caja QR - ${uName}`,
            userId: c.userId,
            userName: uName,
            createdAt: cDate,
            runningBalance: 0,
            isOpening: false,
            isClosure: true,
          });
        }

        if (c.reportedTransfer && c.reportedTransfer > 0) {
          hasAny = true;
          closureRows.push({
            id: `closure-${c.id}-transfer`,
            type: "expense",
            category: "cash_closure",
            amount: c.reportedTransfer,
            paymentMethod: "transfer",
            notes: `Cierre de caja Banco - ${uName}`,
            userId: c.userId,
            userName: uName,
            createdAt: cDate,
            runningBalance: 0,
            isOpening: false,
            isClosure: true,
          });
        }

        if (!hasAny) {
          closureRows.push({
            id: `closure-${c.id}-zero`,
            type: "expense",
            category: "cash_closure",
            amount: 0,
            paymentMethod: "cash",
            notes: `Cierre de caja - ${uName}`,
            userId: c.userId,
            userName: uName,
            createdAt: cDate,
            runningBalance: 0,
            isOpening: false,
            isClosure: true,
          });
        }
      });

    // Construir filas de transacciones
    const txRows = (allTransactions as any[]).map((t: any) => ({
      ...t,
      userName: t.userName || activeUsersMap.get(t.userId) || (t.userId ? `Usuario #${t.userId}` : "Administrador"),
      runningBalance: 0,
      isOpening: false,
      isClosure: false,
    }));

    // Combinar todo y ordenar por fecha ASCENDENTE para calcular saldo
    const sortedAsc = [...openingRows, ...closureRows, ...txRows].sort((a: any, b: any) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB) return timeA - timeB;
      if (a.isOpening && !b.isOpening) return -1;
      if (!a.isOpening && b.isOpening) return 1;
      if (a.isClosure && !b.isClosure) return 1;
      if (!a.isClosure && b.isClosure) return -1;
      return 0;
    });

    // Calcular saldo acumulado
    let runningBalance = 0;
    const calculatedRows = sortedAsc.map((t: any) => {
      if (t.isOpening || (t.type === "income" && !t.isClosure)) {
        runningBalance += t.amount;
      } else {
        runningBalance -= t.amount;
      }
      return { ...t, runningBalance };
    });

    // Ordenar DESC para mostrar lo más reciente primero
    return toPlainObject(calculatedRows.sort((a: any, b: any) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB) return timeB - timeA;
      if (a.isClosure && !b.isClosure) return -1;
      if (!a.isClosure && b.isClosure) return 1;
      if (a.isOpening && !b.isOpening) return 1;
      if (!a.isOpening && b.isOpening) return -1;
      return 0;
    }));
  }),

  getGlobalBalances: protectedProcedure
    .input(z.object({ branchId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const branchId = input?.branchId ?? ctx.branchId;
      const transactions = await getFinancialTransactions(undefined, branchId);
      const openings = await getAllCashOpenings();
      const closures = await getAllCashClosures();
      const allUsers = await getAllUsers();
      const activeUsersMap = new Map((allUsers as any[]).map((u: any) => [u.id, u.name || u.username]));

      const calc = (method: "cash" | "qr" | "transfer") => {
        // 1. Ingresos operativos (ventas, ingresos extraordinarios, etc.)
        const txIncome = (transactions as any[])
          .filter((t: any) => t.type === "income" && (t.paymentMethod === method || (method === "cash" && !t.paymentMethod)))
          .reduce((s: number, t: any) => s + (t.amount || 0), 0);

        // 2. Aperturas de caja (fondos iniciales ingresados a la caja)
        const openingTotal = (openings as any[])
          .filter((o: any) => (o.paymentMethod === method || (method === "cash" && !o.paymentMethod)) && activeUsersMap.has(o.responsibleUserId))
          .reduce((s: number, o: any) => s + (o.openingAmount || 0), 0);

        // 3. Egresos operativos (compras de inventario, gastos, etc.)
        const txExpense = (transactions as any[])
          .filter((t: any) => t.type === "expense" && (t.paymentMethod === method || (method === "cash" && !t.paymentMethod)))
          .reduce((s: number, t: any) => s + (t.amount || 0), 0);

        // 4. Cierres de caja (fondos retirados/arqueados al cerrar caja)
        const closureTotal = (closures as any[])
          .filter((c: any) => activeUsersMap.has(c.userId))
          .reduce((s: number, c: any) => {
            const amt = method === "cash" ? (c.reportedCash || 0) : method === "qr" ? (c.reportedQr || 0) : (c.reportedTransfer || 0);
            return s + amt;
          }, 0);

        // Totales consolidados (idénticos a getBoxHistory)
        const totalIncome = txIncome + openingTotal;
        const totalExpense = txExpense + closureTotal;
        const balance = totalIncome - totalExpense;

        return {
          balance,
          totalIncome,
          totalExpense,
          txIncome,
          txExpense,
          openingTotal,
          closureTotal,
        };
      };

      const cashData = calc("cash");
      const qrData = calc("qr");
      const transferData = calc("transfer");

      return toPlainObject({
        cash: cashData.balance,
        qr: qrData.balance,
        transfer: transferData.balance,
        details: {
          cash: cashData,
          qr: qrData,
          transfer: transferData,
        }
      });
    }),


  getCashOpenings: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return await getAllCashOpenings();
  }),

  listResponsibleUsers: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return await getAllUsers();
  }),

  openCashRegister: protectedProcedure
    .input(
      z.object({
        openingAmount: z.number().min(0, "El fondo inicial no puede ser negativo"),
        paymentMethod: z.enum(["cash", "qr", "transfer"]),
        openingDate: z.string().min(1, "La fecha de apertura es requerida"),
        responsibleUserId: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const methods: ("cash" | "qr" | "transfer")[] = ["cash", "qr", "transfer"];
      const results = [];

      for (const method of methods) {
        const existing = await getCashOpeningByUserIdAndDateMethod(
          input.responsibleUserId,
          input.openingDate,
          method
        );

        if (!existing) {
          // Si es el método solicitado, usamos el monto enviado, sino 0
          const amount = method === input.paymentMethod ? Math.round(input.openingAmount) : 0;
          
          const result = await createCashOpening({
            openingAmount: amount,
            paymentMethod: method,
            openingDate: input.openingDate,
            responsibleUserId: input.responsibleUserId,
            openedByUserId: ctx.user.id,
            notes: method === input.paymentMethod ? input.notes : `Apertura automática (${input.paymentMethod.toUpperCase()})`,
            status: "open",
            createdAt: new Date(),
          });

          results.push(result);
        }
      }

      if (results.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Este usuario ya tiene todas las cajas abiertas para esta fecha.`,
        });
      }

      return results[0]; // Retornamos el primero para mantener compatibilidad
    }),

  transferFunds: protectedProcedure
    .input(z.object({
      fromMethod: z.enum(["cash", "qr", "transfer"]),
      toMethod: z.enum(["cash", "qr", "transfer"]),
      amount: z.number().min(0.01, "Monto inválido"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      if (input.fromMethod === input.toMethod) throw new TRPCError({ code: "BAD_REQUEST", message: "Las cajas de origen y destino deben ser distintas." });

      const amountInCents = Math.round(input.amount);
      const { createFinancialTransaction } = await import("../db");
      
      await createFinancialTransaction({
        type: "expense",
        category: "transfer_between_registers",
        amount: amountInCents,
        paymentMethod: input.fromMethod,
        userId: ctx.user.id,
        branchId: ctx.branchId,
        notes: `Traspaso hacia ${input.toMethod.toUpperCase()}` + (input.notes ? ` - ${input.notes}` : ""),
      });

      await createFinancialTransaction({
        type: "income",
        category: "transfer_between_registers",
        amount: amountInCents,
        paymentMethod: input.toMethod,
        userId: ctx.user.id,
        branchId: ctx.branchId,
        notes: `Traspaso desde ${input.fromMethod.toUpperCase()}` + (input.notes ? ` - ${input.notes}` : ""),
      });

      return { success: true };
    }),

  addExtraordinaryIncome: protectedProcedure
    .input(
      z.object({
        amount: z.number().min(1, "El monto debe ser mayor a 0"),
        paymentMethod: z.enum(["cash", "qr", "transfer"]),
        category: z.enum(["donation", "loan", "gift", "other_income"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { createFinancialTransaction } = await import("../db");
      
      return await createFinancialTransaction({
        type: "income",
        category: input.category,
        paymentMethod: input.paymentMethod,
        amount: input.amount,
        userId: ctx.user.id,
        branchId: ctx.branchId,
        notes: input.notes,
      });
    }),

  addDeliveryExpense: protectedProcedure
    .input(z.object({
      deliveryPersonId: z.number(),
      amount: z.number(),
      type: z.enum(["fuel", "subsistence", "other"]),
      notes: z.string().optional(),
      orderId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return await createDeliveryExpense({
        deliveryPersonId: input.deliveryPersonId,
        amount: Math.round(input.amount),
        type: input.type,
        notes: input.notes,
        orderId: input.orderId,
        branchId: ctx.branchId,
      });

    }),
  // Obtener historial de entregas del repartidor hoy
  getDeliveryHistory: protectedProcedure
    .input(z.object({ date: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const targetUserId = ctx.user?.role === "admin" ? undefined : Number(ctx.user?.id);
      if (!targetUserId && ctx.user?.role !== "admin") throw new TRPCError({ code: "BAD_REQUEST" });

      const { getDb } = await import("../db");
      const { orders, users, customers } = await import("../../drizzle/schema");
      const { and, eq, sql } = await import("drizzle-orm");
      const db = await getDb();

      if (!db) {
        const { getAllOrders, getOrderItems } = await import("../db");
        const allOrders = await getAllOrders();
        const ordersForUser = allOrders.filter((o: any) =>
          o.deliveryPersonId === targetUserId &&
          o.status === "delivered" &&
          (!input.date || getLocalDateKey(o.deliveredAt) === input.date)
        );

        const results = await Promise.all(ordersForUser.map(async (order: any) => {
          const items = await getOrderItems(order.id);
          return { order, items };
        }));
        return results;
      }

      // Consulta directa a DB optimizada
      const date = input.date || getLocalDateKey(new Date());
      const ordersForUser = await db.select({
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber,
          totalPrice: orders.totalPrice,
          paymentMethod: orders.paymentMethod,
          deliveredAt: orders.deliveredAt,
          status: orders.status,
          deliveryPersonId: orders.deliveryPersonId,
        }
      })
      .from(orders)
      .where(and(
        eq(orders.deliveryPersonId, targetUserId!),
        eq(orders.status, "delivered"),
        sql`DATE(DATE_SUB(${orders.deliveredAt}, INTERVAL 4 HOUR)) = ${date}`
      ));

      const results = await Promise.all(ordersForUser.map(async (row: any) => {
        const { getOrderItems } = await import("../db");
        const items = await getOrderItems(row.order.id);
        return { order: row.order, items };
      }));

      return results;
    }),

  // Obtener totales esperados para un repartidor en una fecha específica
  getExpectedDaily: protectedProcedure
    .input(z.object({ 
      userId: z.number().optional(), 
      date: z.string() 
    }))
    .query(async ({ ctx, input }) => {
      const targetUserId = input.userId || ctx.user?.id;
      if (!targetUserId) throw new TRPCError({ code: "BAD_REQUEST" });
      
      // Solo el mismo usuario o un admin pueden ver esto
      if (ctx.user?.role !== "admin" && targetUserId !== ctx.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return await getExpectedDailyTotals(targetUserId, input.date);
    }),

  // Enviar un nuevo cierre de caja
  submitClosure: protectedProcedure
    .input(z.object({
      date: z.string(),
      initialCash: z.number(),
      reportedCash: z.number(),
      reportedQr: z.number(),
      reportedTransfer: z.number(),
      expenses: z.number().optional(),
      expectedCash: z.number(),
      expectedQr: z.number(),
      expectedTransfer: z.number(),
      pendingOrders: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Verificar si ya existe un cierre para esta fecha en esta sucursal
      const lastClosure = await getCashClosureByUserIdAndDate(userId, input.date, ctx.branchId);
      if (lastClosure?.status === "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ya tienes un cierre de caja pendiente de aprobación en esta sucursal. Espera a que el administrador lo valide."
        });
      }

      const pending = input.pendingOrders ?? 0;
      const isAdmin = ctx.user?.role === "admin";
      const finalStatus = isAdmin ? "approved" : "pending";

      const result = await createCashClosure({
        userId,
        branchId: ctx.branchId,
        date: input.date,
        initialCash: Math.round(input.initialCash),
        reportedCash: Math.round(input.reportedCash),
        reportedQr: Math.round(input.reportedQr),
        reportedTransfer: Math.round(input.reportedTransfer),
        expectedCash: Math.round(input.expectedCash),
        expectedQr: Math.round(input.expectedQr),
        expectedTransfer: Math.round(input.expectedTransfer),
        expenses: Math.round(input.expenses || 0),
        pendingOrders: Math.round(pending),
        status: finalStatus
      });

      // Independientemente de si es admin o repartidor, al enviar un cierre
      // se deben cerrar las aperturas activas para bloquear nuevas ventas
      const { closeAllActiveOpeningsForUser } = await import("../db");
      await closeAllActiveOpeningsForUser(userId, input.date);

      // Capturar ID de forma robusta (soporta diferentes drivers de DB)
      const closureId = (result as any).insertId || (Array.isArray(result) && result[0]?.insertId);

      // Si es admin, liquidar financieramente ahora
      if (isAdmin && closureId) {
        await processFinancialLiquidation(Number(closureId));
      }

      return result;
    }),

  // Obtener mi estado de cierre para hoy
  getMyStatus: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) return null;
      return await getCashClosureByUserIdAndDate(userId, input.date, ctx.branchId);
    }),
  
  // Verificar si tiene algún cierre pendiente (de cualquier fecha)
  hasPendingClosure: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user?.id;
    if (!userId) return { hasPending: false };
    const closures = await getCashClosuresByUserId(userId);
    const pendingClosure = closures.find((c: any) => c.status === "pending");
    return toPlainObject({ 
      hasPending: !!pendingClosure,
      pendingClosure 
    });
  }),

  hasActiveOpening: protectedProcedure
    .input(z.object({ paymentMethod: z.enum(["cash", "qr", "transfer"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
    const userId = ctx.user?.id;
    if (!userId) return { hasActive: false };

    // Para vendedores: verificar en seller_cash_registers en lugar de cash_openings
    if (ctx.user?.role === "seller") {
      const db = await getDb();
      if (!db) return { hasActive: true }; // en modo demo, permitir ventas

      const today = getLocalDateKey();
      const [sellerBox] = await db
        .select({ id: sellerCashRegisters.id, openingStatus: sellerCashRegisters.openingStatus, closingStatus: sellerCashRegisters.closingStatus })
        .from(sellerCashRegisters)
        .where(
          and(
            eq(sellerCashRegisters.sellerId, userId),
            eq(sellerCashRegisters.date, today),
            eq(sellerCashRegisters.openingStatus, "approved"),
            eq(sellerCashRegisters.closingStatus, "open")
          )
        )
        .limit(1);

      return toPlainObject({ hasActive: !!sellerBox, activeOpening: sellerBox || null });
    }

    const method = input?.paymentMethod || "cash";
    let activeOpening = await getActiveCashOpeningByUserIdAndMethod(userId, method);
    
    // Fallback de compatibilidad: Si pidió QR o Transferencia y no está, verificamos si la de Efectivo está abierta.
    if (!activeOpening && method !== "cash") {
      activeOpening = await getActiveCashOpeningByUserIdAndMethod(userId, "cash");
    }

    return toPlainObject({ 
      hasActive: !!activeOpening && activeOpening.status === "open",
      activeOpening 
    });
  }),

  // Obtener monto pendiente de órdenes sin entregar del repartidor
  getPendingOrders: protectedProcedure
    .input(z.object({ userId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const targetUserId = input.userId || ctx.user?.id;
      if (!targetUserId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (ctx.user?.role !== "admin" && targetUserId !== ctx.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return await getPendingOrdersTotal(targetUserId);
    }),

  // Listar todos los cierres (Solo Admin)
  listAllClosures: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return await getAllCashClosures();
  }),

  // Listar mis cierres (Repartidor)
  listMyClosures: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    return await getCashClosuresByUserId(userId);
  }),

  // Aprobar/Rechazar cierre (Solo Admin)
  updateClosureStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["approved", "rejected"]),
      adminNotes: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const result = await updateCashClosure(input.id, {
        status: input.status,
        adminNotes: input.adminNotes
      });

      // Si se aprueba, creamos las transacciones financieras y la próxima apertura
      // Si se aprueba, creamos las transacciones financieras
      if (input.status === "approved") {
        const closure = await getCashClosureById(input.id);
        if (closure) {
          // Liquidar financieramente el cierre (registra ventas, ajustes y retiro)
          await processFinancialLiquidation(input.id);
          
          // Cerrar TODAS las aperturas de caja activas de este usuario (Efectivo, QR, Transferencia)
          const methods = ["cash", "qr", "transfer"];
          for (const method of methods) {
            const activeOpening = await getCashOpeningByUserIdAndDateMethod(closure.userId, closure.date, method);
            if (activeOpening) {
              await updateCashOpeningStatus(activeOpening.id, "closed");
            }
          }
        }
      }

      return result;
    }),

  // Reparar un cierre específico (solo admin) - ejecutar una vez
  repairClosure: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      // force=true para ignorar anti-duplicado y registrar siempre
      await processFinancialLiquidation(input.id, true);
      return { success: true };
    }),

  // Limpiar transacciones duplicadas de closure_report (solo admin)
  cleanupDuplicateClosures: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { cleanupDuplicateClosureReports } = await import("../db");
      const result = await cleanupDuplicateClosureReports();
      return result;
    }),

  // Historial de transacciones por caja con filtros de fecha
  getBoxHistory: protectedProcedure
    .input(z.object({
      paymentMethod: z.enum(["cash", "qr", "transfer"]),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      type: z.enum(["all", "income", "expense"]).default("all"),
      branchId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const branchId = input.branchId || ctx.branchId;
      const allTransactions = await getFinancialTransactions(undefined, branchId);
      const allOpenings = await getAllCashOpenings();
      const allClosures = await getAllCashClosures();
      const allUsers = await getAllUsers();
      const activeUsersMap = new Map((allUsers as any[]).map((u: any) => [u.id, u.name || u.username]));

      // Filtrar transacciones por método de pago
      let filtered = allTransactions.filter((t: any) => 
        t.paymentMethod === input.paymentMethod || (!t.paymentMethod && input.paymentMethod === "cash")
      );

      // Filtrar openings por método de pago y que pertenezcan a usuarios activos
      const filteredOpenings = allOpenings.filter((o: any) => 
        (o.paymentMethod === input.paymentMethod || (!o.paymentMethod && input.paymentMethod === "cash")) &&
        activeUsersMap.has(o.responsibleUserId)
      );

      // Filtrar por tipo
      if (input.type !== "all") {
        filtered = filtered.filter((t: any) => t.type === input.type);
      }

      // Filtrar openings por tipo (siempre "income")
      const visibleOpenings = input.type === "expense" ? [] : filteredOpenings;

      // Filtrar closures por método de pago
      const filteredClosures = (allClosures as any[]).filter((c: any) => {
        // Los cierres tienen múltiples métodos, debemos mostrar según el método actual
        if (!activeUsersMap.has(c.userId)) return false;
        // Mostrar el cierre en el historial del método correspondiente
        return true; // mostraremos en todos, pero con monto específico por método
      });
      const visibleClosures = input.type === "income" ? [] : filteredClosures;

      // Construir filas de aperturas para intercalar en el historial
      const openingRows = visibleOpenings.map((o: any) => ({
        id: `opening-${o.id}`,
        type: "income",
        category: "cash_opening",
        amount: o.openingAmount,
        paymentMethod: o.paymentMethod || "cash",
        notes: o.notes || `Apertura de caja - ${o.responsibleUserName || activeUsersMap.get(o.responsibleUserId) || `Usuario #${o.responsibleUserId}`}`,
        userId: o.responsibleUserId,
        userName: o.responsibleUserName || activeUsersMap.get(o.responsibleUserId) || `Usuario #${o.responsibleUserId}`,
        responsibleUserName: o.responsibleUserName || activeUsersMap.get(o.responsibleUserId) || `Usuario #${o.responsibleUserId}`,
        createdAt: o.createdAt ? new Date(o.createdAt) : new Date(o.openingDate + "T12:00:00"),
        runningBalance: 0,
        direction: "entry",
        isOpening: true,
        isClosure: false,
      }));

      // Construir filas de cierres para intercalar en el historial
      const closureRows = visibleClosures.map((c: any) => {
        // Determinar el monto según el método de pago
        let closureAmount = 0;
        if (input.paymentMethod === "cash") closureAmount = c.reportedCash || 0;
        else if (input.paymentMethod === "qr") closureAmount = c.reportedQr || 0;
        else if (input.paymentMethod === "transfer") closureAmount = c.reportedTransfer || 0;

        return {
          id: `closure-${c.id}`,
          type: "expense",
          category: "cash_closure",
          amount: closureAmount,
          paymentMethod: input.paymentMethod,
          notes: `Cierre de caja - ${activeUsersMap.get(c.userId) || `Usuario #${c.userId}`}`,
          userId: c.userId,
          userName: activeUsersMap.get(c.userId) || `Usuario #${c.userId}`,
          responsibleUserName: activeUsersMap.get(c.userId) || `Usuario #${c.userId}`,
          createdAt: c.createdAt ? new Date(c.createdAt) : new Date(c.date + "T23:59:59"),
          runningBalance: 0,
          direction: "exit",
          isOpening: false,
          isClosure: true,
        };
      });

      // Construir filas de transacciones
      const txRows = filtered.map((t: any) => ({
        ...t,
        userName: t.userName || activeUsersMap.get(t.userId) || (t.userId ? `Usuario #${t.userId}` : "Administrador"),
        runningBalance: 0,
        direction: t.type === "income" ? "entry" : "exit",
        isOpening: false,
        isClosure: false,
      }));

      // Combinar aperturas, cierres y transacciones, ordenar por fecha ASCENDENTE
      const sortedAsc = [...openingRows, ...closureRows, ...txRows].sort((a: any, b: any) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        if (timeA !== timeB) return timeA - timeB;
        // Prioridad: apertura primero, luego transacciones, luego cierre
        if (a.isOpening && !b.isOpening) return -1;
        if (!a.isOpening && b.isOpening) return 1;
        if (a.isClosure && !b.isClosure) return 1;
        if (!a.isClosure && b.isClosure) return -1;
        return 0;
      });

      // Calcular saldo acumulado correlativo
      let runningBalance = 0;
      const calculatedRows = sortedAsc.map((t: any) => {
        if (t.isOpening || (t.type === "income" && !t.isClosure)) {
          runningBalance += t.amount;
        } else {
          runningBalance -= t.amount;
        }
        return {
          ...t,
          runningBalance,
        };
      });

      // Filtrar por rango de fechas
      let finalRows = calculatedRows;
      if (input.startDate) {
        finalRows = finalRows.filter((t: any) => {
          const txDate = getLocalDateKey(t.createdAt);
          return txDate && txDate >= input.startDate!;
        });
      }
      if (input.endDate) {
        finalRows = finalRows.filter((t: any) => {
          const txDate = getLocalDateKey(t.createdAt);
          return txDate && txDate <= input.endDate!;
        });
      }

      // Ordenar por fecha DESCENDENTE para mostrar lo más reciente arriba (Historial)
      const transactionsWithBalance = [...finalRows].sort((a: any, b: any) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        if (timeA !== timeB) return timeB - timeA;
        // Prioridad inversa: cierre primero al final del día, luego transacciones, luego apertura
        if (a.isClosure && !b.isClosure) return -1;
        if (!a.isClosure && b.isClosure) return 1;
        if (a.isOpening && !b.isOpening) return 1;
        if (!a.isOpening && b.isOpening) return -1;
        return 0;
      });

      const totalIncome = finalRows
        .filter((t: any) => t.type === "income")
        .reduce((sum: number, t: any) => sum + t.amount, 0);
      
      const totalExpense = finalRows
        .filter((t: any) => t.type === "expense")
        .reduce((sum: number, t: any) => sum + t.amount, 0);

      return {
        transactions: transactionsWithBalance,
        summary: {
          totalIncome,
          totalExpense,
          finalBalance: runningBalance,
          count: transactionsWithBalance.length,
        },
      };
    }),

  // Exportar transacciones de caja a CSV
  exportBoxCsv: protectedProcedure
    .input(z.object({
      paymentMethod: z.enum(["cash", "qr", "transfer"]),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const allTransactions = await getFinancialTransactions();
      const allUsers = await getAllUsers();

      // Filtrar por método de pago
      let filtered = allTransactions.filter((t: any) => t.paymentMethod === input.paymentMethod);

      // Filtrar por rango de fechas
      if (input.startDate) {
        filtered = filtered.filter((t: any) => {
          const txDate = getLocalDateKey(t.createdAt);
          return txDate && txDate >= input.startDate!;
        });
      }

      if (input.endDate) {
        filtered = filtered.filter((t: any) => {
          const txDate = getLocalDateKey(t.createdAt);
          return txDate && txDate <= input.endDate!;
        });
      }

      // Ordenar por fecha
      filtered.sort((a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      // Calcular saldo acumulado
      let runningBalance = 0;
      const rows = filtered.map((t: any) => {
        const date = new Date(t.createdAt);
        const user = allUsers.find((u: any) => u.id === t.userId);
        if (t.type === "income") {
          runningBalance += t.amount;
        } else {
          runningBalance -= t.amount;
        }

        return {
          fecha: date.toLocaleDateString("es-BO"),
          hora: date.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" }),
          usuario: user?.name || user?.username || `Usuario #${t.userId}` || "—",
          tipo: t.type === "income" ? "Ingreso" : "Egreso",
          categoria: t.category,
          referencia: t.referenceId ? `#${t.referenceId}` : "—",
          metodo: input.paymentMethod === "cash" ? "Efectivo" : input.paymentMethod === "qr" ? "QR" : "Transferencia",
          monto: t.amount / 100,
          ingreso: t.type === "income" ? t.amount / 100 : "",
          egreso: t.type === "expense" ? t.amount / 100 : "",
          saldo: runningBalance / 100,
          notas: t.notes || "",
        };
      });

      return { rows, methodName: input.paymentMethod === "cash" ? "Caja_Efectivo" : input.paymentMethod === "qr" ? "Caja_QR" : "Cuenta_Bancaria" };
    }),

  // Retorna repartidores que tienen caja abierta hoy (para alertar al admin en arqueo)
  getDeliveryOpenBoxStatus: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const allUsers = await getAllUsers();
    const allOpenings = await getAllCashOpenings();
    const today = getLocalDateKey(new Date());

    // Repartidores = usuarios que no son admin
    const deliveryUsers = (allUsers as any[]).filter((u: any) => u.role !== "admin");

    const result = deliveryUsers.map((u: any) => {
      const userOpenings = (allOpenings as any[]).filter(
        (o: any) => o.responsibleUserId === u.id && o.openingDate === today
      );
      const hasOpen = userOpenings.some((o: any) => o.status === "open");
      const hasClosed = userOpenings.some((o: any) => o.status === "closed");
      const hasAny = userOpenings.length > 0;

      return {
        userId: u.id,
        name: u.name || u.username,
        role: u.role,
        hasOpenBox: hasOpen,
        hasClosedBox: hasClosed && !hasOpen,
        hasNoBox: !hasAny,
      };
    });

    return {
      deliveryUsers: result,
      pendingCount: result.filter((u: any) => u.hasOpenBox).length,
    };
  }),

  resetFinancialData: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Solo administradores pueden reiniciar finanzas" });
    }

    const { getDb } = await import("../db");
    const db = await getDb();

    if (!db) {
      const {
        MOCK_FINANCIAL_TRANSACTIONS,
        MOCK_CASH_OPENINGS,
        MOCK_CASH_CLOSURES,
        MOCK_OPERATIONAL_EXPENSES,
        MOCK_DELIVERY_EXPENSES,
        syncMocksToDisk,
      } = await import("../db");
      MOCK_FINANCIAL_TRANSACTIONS.length = 0;
      MOCK_CASH_OPENINGS.length = 0;
      MOCK_CASH_CLOSURES.length = 0;
      MOCK_OPERATIONAL_EXPENSES.length = 0;
      MOCK_DELIVERY_EXPENSES.length = 0;
      syncMocksToDisk();
      return { success: true, message: "Finanzas reiniciadas a 0 (Modo Demo)" };
    }

    const mysql = await import("mysql2/promise");
    if (process.env.DATABASE_URL) {
      const connection = await mysql.default.createConnection(process.env.DATABASE_URL);
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 0");
        const tables = [
          "financialTransactions",
          "financial_transactions",
          "operationalExpenses",
          "operational_expenses",
          "deliveryExpenses",
          "delivery_expenses",
          "cash_closures",
          "cashClosures",
          "cash_openings",
          "cashOpenings",
          "creditPayments",
          "credit_payments",
          "accountsPayable",
          "accounts_payable",
          "accountsReceivable",
          "accounts_receivable",
        ];
        for (const t of tables) {
          try {
            await connection.query(`TRUNCATE TABLE \`${t}\``);
          } catch (_) {}
        }
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } finally {
        await connection.end();
      }
    }

    return { success: true, message: "Módulo de finanzas reiniciado a 0 exitosamente" };
  }),
});

