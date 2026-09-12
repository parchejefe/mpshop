import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb, getAllUsers } from "../db";
import { toPlainObject } from "../_core/serialize";
import { 
  sellerCashRegisters, 
  sellerPartialDeliveries, 
  sellerCashExpenses,
  financialTransactions,
  operationalExpenses,
  sales,
  users,
  branches
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getLocalDateKey } from "../_core/date_utils";

/**
 * Router para el sistema de cajas de vendedores
 * Gestiona aperturas, cierres, entregas parciales y gastos
 */
export const sellerCashRouter = router({
  
  // ═══════════════════════════════════════════════════════════════
  // ENDPOINTS PARA VENDEDOR
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Obtener estado de mi caja del día actual
   */
  getMyBoxStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    
    const today = getLocalDateKey();
    
    // Buscar la ÚLTIMA caja del día que NO esté cerrada (open o pending)
    // O si todas están cerradas, retornar que no tiene caja activa
    const cashRegisters = await db
      .select()
      .from(sellerCashRegisters)
      .where(
        and(
          eq(sellerCashRegisters.sellerId, userId),
          eq(sellerCashRegisters.date, today)
        )
      )
      .orderBy(desc(sellerCashRegisters.turnNumber));
    
    // Buscar la primera caja que no esté cerrada (approved o forced_closed)
    const activeCashRegister = cashRegisters.find(
      cr => cr.closingStatus !== "approved" && cr.closingStatus !== "forced_closed"
    );
    
    if (!activeCashRegister) {
      return { hasBox: false, box: null };
    }
    
    // Calcular totales esperados
    const expectedCash = activeCashRegister.initialCash + activeCashRegister.salesCash - activeCashRegister.partialDeliveriesCash - activeCashRegister.totalExpenses;
    const expectedQr = activeCashRegister.salesQr;
    const expectedTransfer = activeCashRegister.salesTransfer;
    
    return toPlainObject({
      hasBox: true,
      box: {
        ...activeCashRegister,
        expectedCash,
        expectedQr,
        expectedTransfer,
      }
    });
  }),
  
  /**
   * Solicitar apertura de caja
   */
  requestOpening: protectedProcedure
    .input(z.object({
      initialCash: z.number().min(0),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      
      // Verificar que el usuario es vendedor
      if (ctx.user?.role !== "seller" && ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo vendedores pueden solicitar apertura de caja" });
      }
      
      const today = getLocalDateKey();
      const branchId = ctx.branchId;
      
      // Calcular el siguiente turnNumber para hoy
      const existingBoxes = await db
        .select()
        .from(sellerCashRegisters)
        .where(
          and(
            eq(sellerCashRegisters.sellerId, userId),
            eq(sellerCashRegisters.date, today)
          )
        )
        .orderBy(desc(sellerCashRegisters.turnNumber));

      // Verificar si hay alguna caja activa (no cerrada)
      const activeBox = existingBoxes.find(
        box => box.closingStatus !== "approved" && box.closingStatus !== "forced_closed"
      );

      if (activeBox) {
        // Si hay una caja activa y fue rechazada, eliminarla para permitir nueva solicitud
        if (activeBox.openingStatus === "rejected") {
          await db.delete(sellerCashRegisters).where(eq(sellerCashRegisters.id, activeBox.id));
        } else {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Ya tienes una caja activa (Turno #${activeBox.turnNumber}). Debes cerrarla antes de abrir una nueva.`
          });
        }
      }

      // Calcular el siguiente número de turno
      const maxTurnNumber = existingBoxes.length > 0 
        ? Math.max(...existingBoxes.map(b => b.turnNumber || 1))
        : 0;
      const nextTurnNumber = maxTurnNumber + 1;
      
      // Crear solicitud de apertura
      const [result] = await db.insert(sellerCashRegisters).values({
        sellerId: userId,
        branchId: branchId,
        date: today,
        turnNumber: nextTurnNumber,
        openingStatus: "pending",
        initialCash: Math.round(input.initialCash * 100), // Convertir a centavos
        openedAt: new Date(),
        openingNotes: input.notes || null,
        closingStatus: "open",
      });
      
      return { 
        success: true, 
        message: "Solicitud de apertura enviada. Espera la aprobación del administrador.",
        cashRegisterId: Number((result as any).insertId ?? 0)
      };
    }),
  
  /**
   * Solicitar entrega parcial de efectivo
   */
  requestPartialDelivery: protectedProcedure
    .input(z.object({
      amount: z.number().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      
      const today = getLocalDateKey();
      
      // Obtener caja actual
      const [cashRegister] = await db
        .select()
        .from(sellerCashRegisters)
        .where(
          and(
            eq(sellerCashRegisters.sellerId, userId),
            eq(sellerCashRegisters.date, today),
            eq(sellerCashRegisters.closingStatus, "open")
          )
        )
        .limit(1);
      
      if (!cashRegister) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No tienes una caja abierta" });
      }
      
      if (cashRegister.openingStatus !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tu caja aún no ha sido aprobada" });
      }
      
      // Verificar que tenga suficiente efectivo
      const availableCash = cashRegister.initialCash + cashRegister.salesCash - cashRegister.partialDeliveriesCash - cashRegister.totalExpenses;
      if (input.amount * 100 > availableCash) {
        throw new TRPCError({ 
          code: "BAD_REQUEST", 
          message: `No tienes suficiente efectivo. Disponible: Bs. ${(availableCash / 100).toFixed(2)}` 
        });
      }
      
      // Crear solicitud de entrega parcial
      await db.insert(sellerPartialDeliveries).values({
        cashRegisterId: cashRegister.id,
        sellerId: userId,
        amount: Math.round(input.amount * 100),
        status: "pending",
        notes: input.notes || null,
      });
      
      return { 
        success: true, 
        message: "Solicitud de entrega parcial enviada. Espera la aprobación del administrador." 
      };
    }),
  
  /**
   * Solicitar gasto desde caja
   */
  requestExpense: protectedProcedure
    .input(z.object({
      amount: z.number().min(1),
      concept: z.string().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      
      const today = getLocalDateKey();
      
      // Obtener caja actual
      const [cashRegister] = await db
        .select()
        .from(sellerCashRegisters)
        .where(
          and(
            eq(sellerCashRegisters.sellerId, userId),
            eq(sellerCashRegisters.date, today),
            eq(sellerCashRegisters.closingStatus, "open")
          )
        )
        .limit(1);
      
      if (!cashRegister) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No tienes una caja abierta" });
      }
      
      if (cashRegister.openingStatus !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tu caja aún no ha sido aprobada" });
      }
      
      // Crear solicitud de gasto
      await db.insert(sellerCashExpenses).values({
        cashRegisterId: cashRegister.id,
        sellerId: userId,
        amount: Math.round(input.amount * 100),
        concept: input.concept,
        status: "pending",
        notes: input.notes || null,
      });
      
      return { 
        success: true, 
        message: "Solicitud de gasto enviada. Espera la aprobación del administrador." 
      };
    }),
  
  /**
   * Solicitar cierre de caja
   */
  requestClosing: protectedProcedure
    .input(z.object({
      reportedCash: z.number().min(0),
      reportedQr: z.number().min(0),
      reportedTransfer: z.number().min(0),
      differenceJustification: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      
      const today = getLocalDateKey();
      
      // Obtener caja actual
      const [cashRegister] = await db
        .select()
        .from(sellerCashRegisters)
        .where(
          and(
            eq(sellerCashRegisters.sellerId, userId),
            eq(sellerCashRegisters.date, today),
            eq(sellerCashRegisters.closingStatus, "open")
          )
        )
        .limit(1);
      
      if (!cashRegister) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No tienes una caja abierta" });
      }
      
      if (cashRegister.openingStatus !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tu caja aún no ha sido aprobada para poder cerrarla" });
      }
      
      // ═══════════════════════════════════════════════════════════════
      // CÁLCULO AUTOMÁTICO DE DIFERENCIAS (CRÍTICO #1 - AUDITORÍA)
      // ═══════════════════════════════════════════════════════════════
      
      // Efectivo esperado en sistema
      const expectedCash = cashRegister.initialCash 
        + cashRegister.salesCash 
        - cashRegister.partialDeliveriesCash 
        - cashRegister.totalExpenses;
      
      // QR esperado (solo ventas, sin deducciones)
      const expectedQr = cashRegister.salesQr;
      
      // Transfer esperado (solo ventas, sin deducciones)
      const expectedTransfer = cashRegister.salesTransfer;
      
      // Calcular diferencias (reportado - esperado)
      const reportedCashCents = Math.round(input.reportedCash * 100);
      const reportedQrCents = Math.round(input.reportedQr * 100);
      const reportedTransferCents = Math.round(input.reportedTransfer * 100);
      
      const differenceCash = reportedCashCents - expectedCash;
      const differenceQr = reportedQrCents - expectedQr;
      const differenceTransfer = reportedTransferCents - expectedTransfer;
      
      // Validación: diferencias mayores a Bs. 10 requieren justificación
      const totalDifference = Math.abs(differenceCash) + Math.abs(differenceQr) + Math.abs(differenceTransfer);
      const significantDifference = totalDifference > 1000; // > Bs. 10.00
      
      if (significantDifference && !input.differenceJustification) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Diferencia significativa detectada (Bs. ${(totalDifference/100).toFixed(2)}). Debes proporcionar una justificación.`
        });
      }
      
      // Actualizar con datos de cierre y diferencias calculadas
      await db
        .update(sellerCashRegisters)
        .set({
          closingStatus: "pending",
          reportedCash: reportedCashCents,
          reportedQr: reportedQrCents,
          reportedTransfer: reportedTransferCents,
          differenceCash,              // ✅ Calculado automáticamente
          differenceQr,                // ✅ NUEVO
          differenceTransfer,          // ✅ NUEVO
          differenceJustification: input.differenceJustification || null,
          closedAt: new Date(),
        })
        .where(eq(sellerCashRegisters.id, cashRegister.id));
      
      return { 
        success: true, 
        message: "Solicitud de cierre enviada. Espera la aprobación del administrador.",
        differences: {
          cash: differenceCash / 100,
          qr: differenceQr / 100,
          transfer: differenceTransfer / 100,
          total: totalDifference / 100,
        },
        expected: {
          cash: expectedCash / 100,
          qr: expectedQr / 100,
          transfer: expectedTransfer / 100,
        },
      };
    }),
  
  /**
   * Obtener historial de mis cajas
   */
  getMyHistory: protectedProcedure
    .input(z.object({
      limit: z.number().optional().default(10),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      
      const history = await db
        .select()
        .from(sellerCashRegisters)
        .where(eq(sellerCashRegisters.sellerId, userId))
        .orderBy(desc(sellerCashRegisters.date))
        .limit(input.limit);
      
      return toPlainObject(history);
    }),
  
  /**
   * Obtener solicitudes pendientes (entregas y gastos)
   */
  getMyPendingRequests: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    
    const userId = ctx.user?.id;
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    
    const [pendingDeliveries, pendingExpenses] = await Promise.all([
      db.select().from(sellerPartialDeliveries)
        .where(
          and(
            eq(sellerPartialDeliveries.sellerId, userId),
            eq(sellerPartialDeliveries.status, "pending")
          )
        ),
      db.select().from(sellerCashExpenses)
        .where(
          and(
            eq(sellerCashExpenses.sellerId, userId),
            eq(sellerCashExpenses.status, "pending")
          )
        ),
    ]);
    
    return toPlainObject({
      pendingDeliveries,
      pendingExpenses,
    });
  }),

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINTS PARA ADMINISTRADOR
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Listar todas las cajas (filtradas por fecha y sucursal)
   */
  admin_listAllBoxes: protectedProcedure
    .input(z.object({
      date: z.string().optional(),
      branchId: z.number().optional(),
      status: z.enum(["all", "open", "pending", "approved", "rejected"]).optional().default("all"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo administradores pueden ver todas las cajas" });
      }
      
      const today = input.date || getLocalDateKey();
      
      let conditions = [eq(sellerCashRegisters.date, today)];
      
      if (input.branchId) {
        conditions.push(eq(sellerCashRegisters.branchId, input.branchId));
      }
      
      if (input.status !== "all") {
        conditions.push(eq(sellerCashRegisters.closingStatus, input.status));
      }
      
      const boxes = await db
        .select({
          cashRegister: sellerCashRegisters,
          seller: {
            id: users.id,
            name: users.name,
            username: users.username,
          },
          branch: {
            id: branches.id,
            name: branches.name,
          },
        })
        .from(sellerCashRegisters)
        .leftJoin(users, eq(sellerCashRegisters.sellerId, users.id))
        .leftJoin(branches, eq(sellerCashRegisters.branchId, branches.id))
        .where(and(...conditions))
        .orderBy(desc(sellerCashRegisters.turnNumber), desc(sellerCashRegisters.createdAt));
      
      return toPlainObject(boxes);
    }),
  
  /**
   * Obtener todas las solicitudes pendientes de aprobación
   */
  admin_getPendingRequests: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    
    const [pendingOpenings, pendingClosings, pendingDeliveries, pendingExpenses] = await Promise.all([
      // Aperturas pendientes
      db.select({
        cashRegister: sellerCashRegisters,
        seller: {
          id: users.id,
          name: users.name,
          username: users.username,
        },
      })
        .from(sellerCashRegisters)
        .leftJoin(users, eq(sellerCashRegisters.sellerId, users.id))
        .where(eq(sellerCashRegisters.openingStatus, "pending")),
      
      // Cierres pendientes
      db.select({
        cashRegister: sellerCashRegisters,
        seller: {
          id: users.id,
          name: users.name,
          username: users.username,
        },
      })
        .from(sellerCashRegisters)
        .leftJoin(users, eq(sellerCashRegisters.sellerId, users.id))
        .where(eq(sellerCashRegisters.closingStatus, "pending")),
      
      // Entregas parciales pendientes
      db.select({
        delivery: sellerPartialDeliveries,
        seller: {
          id: users.id,
          name: users.name,
          username: users.username,
        },
      })
        .from(sellerPartialDeliveries)
        .leftJoin(users, eq(sellerPartialDeliveries.sellerId, users.id))
        .where(eq(sellerPartialDeliveries.status, "pending")),
      
      // Gastos pendientes
      db.select({
        expense: sellerCashExpenses,
        seller: {
          id: users.id,
          name: users.name,
          username: users.username,
        },
      })
        .from(sellerCashExpenses)
        .leftJoin(users, eq(sellerCashExpenses.sellerId, users.id))
        .where(eq(sellerCashExpenses.status, "pending")),
    ]);
    
    return toPlainObject({
      pendingOpenings,
      pendingClosings,
      pendingDeliveries,
      pendingExpenses,
      totalPending: pendingOpenings.length + pendingClosings.length + pendingDeliveries.length + pendingExpenses.length,
    });
  }),
  
  /**
   * Aprobar apertura de caja
   */
  admin_approveOpening: protectedProcedure
    .input(z.object({
      cashRegisterId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const now = new Date();
      
      // Actualizar con query builder de Drizzle
      await db
        .update(sellerCashRegisters)
        .set({
          openingStatus: "approved",
          openingApprovedBy: ctx.user.id,
          openingApprovedAt: now,
          openingNotes: input.notes || null,
        })
        .where(eq(sellerCashRegisters.id, input.cashRegisterId));
      
      return { success: true, message: "Apertura aprobada correctamente" };
    }),

  admin_rejectOpening: protectedProcedure
    .input(z.object({
      cashRegisterId: z.number(),
      notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const now = new Date();
      
      await db
        .update(sellerCashRegisters)
        .set({
          openingStatus: "rejected",
          openingApprovedBy: ctx.user.id,
          openingApprovedAt: now,
          closingNotes: input.notes,
        })
        .where(eq(sellerCashRegisters.id, input.cashRegisterId));
      
      return { success: true, message: "Apertura rechazada" };
    }),

  admin_approveClosing: protectedProcedure
    .input(z.object({
      cashRegisterId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const now = new Date();
      
      await db
        .update(sellerCashRegisters)
        .set({
          closingStatus: "approved",
          closingApprovedBy: ctx.user.id,
          closingApprovedAt: now,
          closedAt: now,
          closingNotes: input.notes || null,
        })
        .where(eq(sellerCashRegisters.id, input.cashRegisterId));
      
      return { success: true, message: "Cierre aprobado correctamente" };
    }),

  admin_rejectClosing: protectedProcedure
    .input(z.object({
      cashRegisterId: z.number(),
      notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      await db
        .update(sellerCashRegisters)
        .set({
          closingStatus: "open",
          closingNotes: input.notes,
        })
        .where(eq(sellerCashRegisters.id, input.cashRegisterId));
      
      return { success: true, message: "Cierre rechazado. El vendedor debe corregir." };
    }),

  admin_approvePartialDelivery: protectedProcedure
    .input(z.object({
      deliveryId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const [delivery] = await db.select().from(sellerPartialDeliveries).where(eq(sellerPartialDeliveries.id, input.deliveryId)).limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "Entrega no encontrada" });

      const now = new Date();
      await db.execute(sql`
        UPDATE seller_partial_deliveries
        SET status='approved', approvedBy=${ctx.user.id}, approvedAt=${now}, adminNotes=${input.notes || null}
        WHERE id=${input.deliveryId}
      `);
      await db.execute(sql`
        UPDATE seller_cash_registers
        SET partialDeliveriesCash = partialDeliveriesCash + ${delivery.amount}
        WHERE id=${delivery.cashRegisterId}
      `);
      return { success: true, message: "Entrega parcial aprobada" };
    }),

  admin_rejectPartialDelivery: protectedProcedure
    .input(z.object({
      deliveryId: z.number(),
      notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const now = new Date();
      await db.execute(sql`
        UPDATE seller_partial_deliveries
        SET status='rejected', approvedBy=${ctx.user.id}, approvedAt=${now}, adminNotes=${input.notes}
        WHERE id=${input.deliveryId}
      `);
      return { success: true, message: "Entrega parcial rechazada" };
    }),

  admin_approveExpense: protectedProcedure
    .input(z.object({
      expenseId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const [expense] = await db.select().from(sellerCashExpenses).where(eq(sellerCashExpenses.id, input.expenseId)).limit(1);
      if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "Gasto no encontrado" });
      if (expense.status === "approved") {
        return { success: true, message: "El gasto ya se encuentra aprobado" };
      }

      const now = new Date();
      // Obtener branchId de la caja del vendedor
      const [cashReg] = await db
        .select({ branchId: sellerCashRegisters.branchId })
        .from(sellerCashRegisters)
        .where(eq(sellerCashRegisters.id, expense.cashRegisterId))
        .limit(1);
      const branchId = cashReg?.branchId || 1;

      await db.transaction(async (tx: any) => {
        await tx.execute(sql`
          UPDATE seller_cash_expenses
          SET status='approved', approvedBy=${ctx.user.id}, approvedAt=${now}, adminNotes=${input.notes || null}
          WHERE id=${input.expenseId}
        `);
        await tx.execute(sql`
          UPDATE seller_cash_registers
          SET totalExpenses = totalExpenses + ${expense.amount}
          WHERE id=${expense.cashRegisterId}
        `);

        // Registrar en Gastos Operacionales (para P&L y reportes)
        await tx.insert(operationalExpenses).values({
          branchId,
          description: `Gasto vendedor: ${expense.concept}`,
          category: "other",
          costType: "operational_expense",
          referenceType: "seller_cash_expense",
          referenceId: expense.id,
          isAutomatic: 1,
          amount: expense.amount,
          paymentMethod: "cash",
          status: "paid",
          userId: expense.sellerId,
          notes: input.notes || expense.notes || null,
          expenseDate: now,
        });

        // Registrar egreso en Transacciones Financieras (Libro Diario)
        await tx.insert(financialTransactions).values({
          branchId,
          type: "expense",
          category: "seller_expense",
          paymentMethod: "cash",
          amount: expense.amount,
          userId: expense.sellerId,
          referenceId: expense.id,
          notes: `Gasto aprobado caja vendedor #${expense.cashRegisterId}: ${expense.concept}`,
          createdAt: now,
        });
      });

      return { success: true, message: "Gasto aprobado y registrado en finanzas" };
    }),

  admin_rejectExpense: protectedProcedure
    .input(z.object({
      expenseId: z.number(),
      notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const [expense] = await db.select().from(sellerCashExpenses).where(eq(sellerCashExpenses.id, input.expenseId)).limit(1);
      if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "Gasto no encontrado" });

      const now = new Date();

      await db.transaction(async (tx: any) => {
        // Si estaba aprobado, revertir de caja, operationalExpenses y financialTransactions
        if (expense.status === "approved") {
          await tx.execute(sql`
            UPDATE seller_cash_registers
            SET totalExpenses = GREATEST(0, totalExpenses - ${expense.amount})
            WHERE id=${expense.cashRegisterId}
          `);

          await tx.delete(operationalExpenses).where(
            and(
              eq(operationalExpenses.referenceType, "seller_cash_expense"),
              eq(operationalExpenses.referenceId, expense.id)
            )
          );

          await tx.delete(financialTransactions).where(
            and(
              eq(financialTransactions.category, "seller_expense"),
              eq(financialTransactions.referenceId, expense.id)
            )
          );
        }

        await tx.execute(sql`
          UPDATE seller_cash_expenses
          SET status='rejected', approvedBy=${ctx.user.id}, approvedAt=${now}, adminNotes=${input.notes}
          WHERE id=${input.expenseId}
        `);
      });

      return { success: true, message: "Gasto rechazado" };
    }),

  admin_forceClose: protectedProcedure
    .input(z.object({
      cashRegisterId: z.number(),
      notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const now = new Date();
      
      await db
        .update(sellerCashRegisters)
        .set({
          closingStatus: "forced_closed",
          closingApprovedBy: ctx.user.id,
          closingApprovedAt: now,
          closedAt: now,
          closingNotes: `CIERRE FORZOSO: ${input.notes}`,
        })
        .where(eq(sellerCashRegisters.id, input.cashRegisterId));
      
      return { success: true, message: "Caja cerrada forzosamente" };
    }),

  /**
   * Editar montos de caja (admin)
   */
  admin_editAmounts: protectedProcedure
    .input(z.object({
      cashRegisterId: z.number(),
      initialCash: z.number().optional(),
      reportedCash: z.number().optional(),
      reportedQr: z.number().optional(),
      reportedTransfer: z.number().optional(),
      notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      
      const updateData: any = {
        closingNotes: `EDITADO POR ADMIN: ${input.notes}`,
      };
      
      if (input.initialCash !== undefined) updateData.initialCash = Math.round(input.initialCash * 100);
      if (input.reportedCash !== undefined) updateData.reportedCash = Math.round(input.reportedCash * 100);
      if (input.reportedQr !== undefined) updateData.reportedQr = Math.round(input.reportedQr * 100);
      if (input.reportedTransfer !== undefined) updateData.reportedTransfer = Math.round(input.reportedTransfer * 100);
      
      await db
        .update(sellerCashRegisters)
        .set(updateData)
        .where(eq(sellerCashRegisters.id, input.cashRegisterId));
      
      return { success: true, message: "Montos actualizados correctamente" };
    }),

  /**
   * Apertura directa de caja por admin (sin solicitud previa del vendedor)
   */
  admin_openBoxForSeller: protectedProcedure
    .input(z.object({
      sellerId: z.number(),
      initialCash: z.number().min(0).default(0),
      notes: z.string().optional(),
      date: z.string().optional(), // YYYY-MM-DD, default hoy
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo administradores pueden abrir cajas directamente" });
      }

      const today = input.date || getLocalDateKey();

      // Verificar que el vendedor existe
      const [seller] = await db
        .select({ id: users.id, name: users.name, role: users.role, branchId: users.id })
        .from(users)
        .where(eq(users.id, input.sellerId))
        .limit(1);

      if (!seller) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Vendedor no encontrado" });
      }

      // Verificar que no tenga una caja activa para ese día
      const existingBoxes = await db
        .select()
        .from(sellerCashRegisters)
        .where(
          and(
            eq(sellerCashRegisters.sellerId, input.sellerId),
            eq(sellerCashRegisters.date, today)
          )
        )
        .orderBy(desc(sellerCashRegisters.turnNumber));

      const activeBox = existingBoxes.find(
        box => box.closingStatus !== "approved" && box.closingStatus !== "forced_closed"
      );

      if (activeBox) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `El vendedor ya tiene una caja activa (Turno #${activeBox.turnNumber}) para el ${today}. Debe cerrarla primero.`
        });
      }

      // Calcular el siguiente número de turno
      const maxTurnNumber = existingBoxes.length > 0 
        ? Math.max(...existingBoxes.map(b => b.turnNumber || 1))
        : 0;
      const nextTurnNumber = maxTurnNumber + 1;

      // Obtener branchId del vendedor (o usar la del contexto del admin)
      const [sellerBranch] = await db
        .select({ branchId: users.id }) // placeholder — usamos ctx.branchId
        .from(users)
        .where(eq(users.id, input.sellerId))
        .limit(1);

      const branchId = ctx.branchId || 1;

      // Crear caja directamente aprobada
      await db.insert(sellerCashRegisters).values({
        sellerId: input.sellerId,
        branchId,
        date: today,
        turnNumber: nextTurnNumber,
        openingStatus: "approved",          // ya aprobada — el admin la abre directamente
        openingApprovedBy: ctx.user.id,
        openingApprovedAt: new Date(),
        initialCash: Math.round(input.initialCash * 100),
        openedAt: new Date(),
        openingNotes: input.notes
          ? `Apertura directa por admin: ${input.notes}`
          : `Apertura directa realizada por administrador`,
        closingStatus: "open",
      });

      return { success: true, message: `Caja abierta correctamente para el vendedor` };
    }),

  /**
   * Obtener lista de vendedores (para el selector del admin)
   */
  admin_listSellers: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Solo administradores pueden listar vendedores" });
    }

    try {
      const allUsers = (await getAllUsers()) as any[];
      
      // Filtrar usuarios activos (o sin status explícito)
      const activeUsers = (allUsers || []).filter((u: any) => u.status !== "inactive");

      // Buscar vendedores, cajeros y repartidores
      let sellers = activeUsers.filter((u: any) => 
        u.role === "seller" || u.role === "cashier" || u.role === "user"
      );

      // Si no hay usuarios con esos roles específicos, incluir a todos los que no sean admin
      if (sellers.length === 0) {
        sellers = activeUsers.filter((u: any) => u.role !== "admin");
      }

      // Si aún no hay nadie (p.ej. solo existe el admin en pruebas), incluir a todos
      if (sellers.length === 0) {
        sellers = activeUsers;
      }

      return toPlainObject(
        sellers.map((s: any) => ({
          id: s.id,
          name: s.name || s.username,
          username: s.username,
          role: s.role,
        }))
      );
    } catch (err: any) {
      console.error("[admin_listSellers] Error:", err);
      return [];
    }
  }),

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT DE PRUEBA (TEMPORAL - REMOVER EN PRODUCCIÓN)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Eliminar caja incorrecta por ID (admin) — para limpiar registros con montos erróneos
   */
  admin_deleteBox: protectedProcedure
    .input(z.object({ cashRegisterId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      await db.delete(sellerCashRegisters).where(eq(sellerCashRegisters.id, input.cashRegisterId));
      return { success: true, message: "Registro eliminado" };
    }),

  /**
   * Resetear montos de ventas de una caja a 0 (para corregir datos mal sincronizados)
   */
  admin_resetBoxSales: protectedProcedure
    .input(z.object({ cashRegisterId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      await db
        .update(sellerCashRegisters)
        .set({
          salesCash: 0,
          salesQr: 0,
          salesTransfer: 0,
        })
        .where(eq(sellerCashRegisters.id, input.cashRegisterId));

      return { success: true, message: "Montos reseteados a 0. Ahora ejecuta Sincronizar Ventas." };
    }),

  // ═══════════════════════════════════════════════════════════════
  // CRÍTICO #2: AUDITORÍA Y LIMPIEZA DE DATOS HISTÓRICOS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Auditar inconsistencias en cajas históricas
   * Identifica cajas con ventas que no coinciden con las ventas reales en DB
   */
  admin_auditHistoricalData: protectedProcedure
    .input(z.object({ 
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      sellerId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      try {
        // Obtener todas las cajas aprobadas en el rango
        let query = db
          .select()
          .from(sellerCashRegisters)
          .where(eq(sellerCashRegisters.openingStatus, "approved"));

        if (input.sellerId) {
          query = query.where(eq(sellerCashRegisters.sellerId, input.sellerId)) as any;
        }

        const boxes = await query;

        const inconsistencies: any[] = [];
        let totalBoxes = 0;
        let inconsistentBoxes = 0;

        for (const box of boxes) {
          // Filtrar por fecha si se especificó
          if (input.startDate && box.date < input.startDate) continue;
          if (input.endDate && box.date > input.endDate) continue;

          totalBoxes++;

          // Calcular ventas reales desde openedAt
          const openedAtStr = box.openedAt ? box.openedAt.toISOString().slice(0, 19).replace('T', ' ') : null;
          
          const [salesData] = await db.execute(sql`
            SELECT 
              COALESCE(SUM(CASE WHEN paymentMethod = 'cash' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalCash,
              COALESCE(SUM(CASE WHEN paymentMethod = 'qr' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalQr,
              COALESCE(SUM(CASE WHEN paymentMethod = 'transfer' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalTransfer,
              COUNT(*) as ventasCount
            FROM sales
            WHERE soldBy = ${box.sellerId}
              AND DATE(createdAt) = ${box.date}
              ${openedAtStr ? sql`AND createdAt >= ${openedAtStr}` : sql``}
          `) as any;

          if (salesData && Array.isArray(salesData) && salesData[0]) {
            const row = salesData[0];
            const realCash = Number(row.totalCash || 0);
            const realQr = Number(row.totalQr || 0);
            const realTransfer = Number(row.totalTransfer || 0);

            const diffCash = Math.abs(box.salesCash - realCash);
            const diffQr = Math.abs(box.salesQr - realQr);
            const diffTransfer = Math.abs(box.salesTransfer - realTransfer);

            // Inconsistencia si hay diferencia mayor a Bs. 1
            if (diffCash > 100 || diffQr > 100 || diffTransfer > 100) {
              inconsistentBoxes++;
              inconsistencies.push({
                boxId: box.id,
                sellerId: box.sellerId,
                date: box.date,
                turnNumber: box.turnNumber,
                openedAt: box.openedAt,
                registered: {
                  cash: box.salesCash / 100,
                  qr: box.salesQr / 100,
                  transfer: box.salesTransfer / 100,
                  total: (box.salesCash + box.salesQr + box.salesTransfer) / 100,
                },
                real: {
                  cash: realCash / 100,
                  qr: realQr / 100,
                  transfer: realTransfer / 100,
                  total: (realCash + realQr + realTransfer) / 100,
                },
                differences: {
                  cash: diffCash / 100,
                  qr: diffQr / 100,
                  transfer: diffTransfer / 100,
                  total: (diffCash + diffQr + diffTransfer) / 100,
                },
                salesCount: Number(row.ventasCount || 0),
              });
            }
          }
        }

        return {
          success: true,
          summary: {
            totalBoxes,
            inconsistentBoxes,
            consistentBoxes: totalBoxes - inconsistentBoxes,
            percentageInconsistent: totalBoxes > 0 ? (inconsistentBoxes / totalBoxes * 100).toFixed(2) : 0,
          },
          inconsistencies: inconsistencies.sort((a, b) => b.differences.total - a.differences.total),
        };
      } catch (error: any) {
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: `Error auditando datos: ${error.message}` 
        });
      }
    }),

  /**
   * Corregir automáticamente inconsistencias en datos históricos
   * Recalcula y actualiza los montos de ventas basándose en las ventas reales
   */
  admin_fixHistoricalData: protectedProcedure
    .input(z.object({
      boxIds: z.array(z.number()).optional(), // Si no se especifica, corrige todas las inconsistencias
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      dryRun: z.boolean().optional().default(false), // Si true, solo muestra qué se haría sin ejecutar
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      try {
        let query = db
          .select()
          .from(sellerCashRegisters)
          .where(eq(sellerCashRegisters.openingStatus, "approved"));

        const boxes = await query;
        const corrections: any[] = [];
        let correctedCount = 0;

        for (const box of boxes) {
          // Filtrar por IDs específicos si se proporcionaron
          if (input.boxIds && input.boxIds.length > 0 && !input.boxIds.includes(box.id)) {
            continue;
          }

          // Filtrar por rango de fechas
          if (input.startDate && box.date < input.startDate) continue;
          if (input.endDate && box.date > input.endDate) continue;

          // Calcular ventas reales
          const openedAtStr = box.openedAt ? box.openedAt.toISOString().slice(0, 19).replace('T', ' ') : null;
          
          const [salesData] = await db.execute(sql`
            SELECT 
              COALESCE(SUM(CASE WHEN paymentMethod = 'cash' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalCash,
              COALESCE(SUM(CASE WHEN paymentMethod = 'qr' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalQr,
              COALESCE(SUM(CASE WHEN paymentMethod = 'transfer' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalTransfer
            FROM sales
            WHERE soldBy = ${box.sellerId}
              AND DATE(createdAt) = ${box.date}
              ${openedAtStr ? sql`AND createdAt >= ${openedAtStr}` : sql``}
          `) as any;

          if (salesData && Array.isArray(salesData) && salesData[0]) {
            const row = salesData[0];
            const realCash = Number(row.totalCash || 0);
            const realQr = Number(row.totalQr || 0);
            const realTransfer = Number(row.totalTransfer || 0);

            // Solo corregir si hay diferencias
            if (box.salesCash !== realCash || box.salesQr !== realQr || box.salesTransfer !== realTransfer) {
              corrections.push({
                boxId: box.id,
                date: box.date,
                before: {
                  cash: box.salesCash / 100,
                  qr: box.salesQr / 100,
                  transfer: box.salesTransfer / 100,
                },
                after: {
                  cash: realCash / 100,
                  qr: realQr / 100,
                  transfer: realTransfer / 100,
                },
              });

              // Aplicar corrección si no es dry-run
              if (!input.dryRun) {
                await db
                  .update(sellerCashRegisters)
                  .set({
                    salesCash: realCash,
                    salesQr: realQr,
                    salesTransfer: realTransfer,
                  })
                  .where(eq(sellerCashRegisters.id, box.id));

                correctedCount++;
              }
            }
          }
        }

        return {
          success: true,
          dryRun: input.dryRun,
          correctedCount: input.dryRun ? 0 : correctedCount,
          potentialCorrections: corrections.length,
          corrections,
          message: input.dryRun 
            ? `Simulación: Se corregirían ${corrections.length} cajas`
            : `${correctedCount} cajas corregidas exitosamente`,
        };
      } catch (error: any) {
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: `Error corrigiendo datos: ${error.message}` 
        });
      }
    }),

  test_checkTables: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { error: "Database not available" };
    
    try {
      // SHOW TABLES devuelve [rows, fields] — extraer solo las filas
      const tablesRaw = await db.execute(sql`SHOW TABLES LIKE 'seller_%'`);
      const tableRows = Array.isArray((tablesRaw as any)[0])
        ? (tablesRaw as any)[0]
        : (Array.isArray(tablesRaw) ? tablesRaw : []);

      // COUNT(*) devuelve BigInt en mysql2 — convertir explícitamente con Number()
      const [crRaw] = await db.execute(sql`SELECT COUNT(*) as count FROM seller_cash_registers`) as any;
      const [delRaw] = await db.execute(sql`SELECT COUNT(*) as count FROM seller_partial_deliveries`) as any;
      const [expRaw] = await db.execute(sql`SELECT COUNT(*) as count FROM seller_cash_expenses`) as any;

      const parseCount = (raw: any) => {
        const rows = Array.isArray(raw[0]) ? raw[0] : raw;
        return Number(rows?.[0]?.count ?? 0);
      };

      return {
        success: true,
        tablesFound: tableRows.length,
        counts: {
          cashRegisters: parseCount([crRaw]),
          deliveries: parseCount([delRaw]),
          expenses: parseCount([expRaw]),
        },
        user: {
          id: ctx.user?.id,
          role: ctx.user?.role,
          username: ctx.user?.username,
        },
      };
    } catch (error: any) {
      return {
        error: error.message,
        errorCode: error.code,
      };
    }
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // NUEVO: Endpoint para listar TODOS los gastos (con filtros)
  // ═══════════════════════════════════════════════════════════════════════════
  admin_listAllExpenses: protectedProcedure
    .input(z.object({
      date: z.string().optional(),
      status: z.enum(["all", "pending", "approved", "rejected"]).optional(),
      sellerId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const conditions = [];
      
      if (input.date) {
        conditions.push(sql`DATE(${sellerCashExpenses.requestDate}) = ${input.date}`);
      }
      
      if (input.status && input.status !== "all") {
        conditions.push(eq(sellerCashExpenses.status, input.status));
      }
      
      if (input.sellerId) {
        // Buscar via cashRegisterId → sellerId
        const sellerBoxIds = await db
          .select({ id: sellerCashRegisters.id })
          .from(sellerCashRegisters)
          .where(eq(sellerCashRegisters.sellerId, input.sellerId));
        const ids = sellerBoxIds.map(b => b.id);
        if (ids.length > 0) {
          conditions.push(sql`${sellerCashExpenses.cashRegisterId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
        } else {
          // Sin boxes → sin gastos
          return { expenses: [], totals: { pending: 0, approved: 0, rejected: 0, totalAmount: 0 } };
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const expenses = await db
        .select({
          expense: sellerCashExpenses,
          cashRegister: sellerCashRegisters,
        })
        .from(sellerCashExpenses)
        .leftJoin(sellerCashRegisters, eq(sellerCashExpenses.cashRegisterId, sellerCashRegisters.id))
        .where(whereClause)
        .orderBy(desc(sellerCashExpenses.requestDate));

      // Obtener sellers
      const sellerIds = [...new Set(expenses.map(e => e.cashRegister?.sellerId).filter(Boolean))];
      const sellers = sellerIds.length > 0
        ? await db.select().from(users).where(sql`${users.id} IN (${sql.join(sellerIds.map(id => sql`${id}`), sql`, `)})`)
        : [];

      const result = expenses.map(({ expense, cashRegister }) => ({
        expense,
        seller: sellers.find(s => s.id === cashRegister?.sellerId) || null,
        cashRegister,
      }));

      // Calcular totales
      const totals = {
        pending: expenses.filter(e => e.expense.status === "pending").length,
        approved: expenses.filter(e => e.expense.status === "approved").length,
        rejected: expenses.filter(e => e.expense.status === "rejected").length,
        totalAmount: expenses
          .filter(e => e.expense.status === "approved")
          .reduce((sum, e) => sum + (e.expense.amount || 0), 0),
      };

      return { expenses: result, totals };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG: Diagnóstico de ventas y caja
  // ═══════════════════════════════════════════════════════════════════════════
  admin_debugSellerSales: protectedProcedure
    .input(z.object({ cashRegisterId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      // Obtener info de la caja
      const [box] = await db
        .select()
        .from(sellerCashRegisters)
        .where(eq(sellerCashRegisters.id, input.cashRegisterId))
        .limit(1);

      if (!box) {
        return { error: "Caja no encontrada" };
      }

      // Buscar ventas del vendedor ese día
      const [salesRaw] = await db.execute(sql`
        SELECT 
          id, saleNumber, soldBy, paymentMethod, total, status, DATE(createdAt) as saleDate, createdAt
        FROM sales
        WHERE soldBy = ${box.sellerId}
          AND DATE(createdAt) = ${box.date}
        ORDER BY createdAt DESC
      `) as any;

      const salesList = Array.isArray(salesRaw) ? salesRaw : [];

      // Calcular totales
      const [totalsRaw] = await db.execute(sql`
        SELECT 
          COALESCE(SUM(CASE WHEN paymentMethod = 'cash' THEN total ELSE 0 END), 0) as totalCash,
          COALESCE(SUM(CASE WHEN paymentMethod = 'qr' THEN total ELSE 0 END), 0) as totalQr,
          COALESCE(SUM(CASE WHEN paymentMethod = 'transfer' THEN total ELSE 0 END), 0) as totalTransfer,
          COUNT(*) as count
        FROM sales
        WHERE soldBy = ${box.sellerId}
          AND DATE(createdAt) = ${box.date}
          AND status != 'cancelled'
      `) as any;

      const totals = Array.isArray(totalsRaw) ? totalsRaw[0] : {};

      return {
        box: {
          id: box.id,
          sellerId: box.sellerId,
          date: box.date,
          turnNumber: box.turnNumber,
          salesCash: box.salesCash,
          salesQr: box.salesQr,
          salesTransfer: box.salesTransfer,
        },
        sales: salesList,
        totals: {
          totalCash: Number(totals.totalCash || 0),
          totalQr: Number(totals.totalQr || 0),
          totalTransfer: Number(totals.totalTransfer || 0),
          count: Number(totals.count || 0),
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPORAL: Sincronizar ventas antiguas con seller_cash_registers
  // ═══════════════════════════════════════════════════════════════════════════
  admin_syncSalesWithBoxes: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      try {
        // Obtener todas las cajas aprobadas
        const boxes = await db
          .select()
          .from(sellerCashRegisters)
          .where(eq(sellerCashRegisters.openingStatus, "approved"));

        let updated = 0;
        const errors: string[] = [];

        for (const box of boxes) {
          try {
            // Calcular ventas SOLO desde la apertura de la caja (openedAt)
            // IMPORTANTE: total en sales ya está en centavos
            const openedAtStr = box.openedAt ? box.openedAt.toISOString().slice(0, 19).replace('T', ' ') : null;
            
            const [salesData] = await db.execute(sql`
              SELECT 
                COALESCE(SUM(CASE WHEN paymentMethod = 'cash' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalCash,
                COALESCE(SUM(CASE WHEN paymentMethod = 'qr' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalQr,
                COALESCE(SUM(CASE WHEN paymentMethod = 'transfer' AND status != 'cancelled' THEN total ELSE 0 END), 0) as totalTransfer,
                COUNT(*) as ventasCount
              FROM sales
              WHERE soldBy = ${box.sellerId}
                AND DATE(createdAt) = ${box.date}
                ${openedAtStr ? sql`AND createdAt >= ${openedAtStr}` : sql``}
            `) as any;

            if (salesData && Array.isArray(salesData) && salesData[0]) {
              const row = salesData[0];
              // Los totales YA están en centavos, solo convertir a número
              const totalCash = Number(row.totalCash || 0);
              const totalQr = Number(row.totalQr || 0);
              const totalTransfer = Number(row.totalTransfer || 0);
              const ventasCount = Number(row.ventasCount || 0);
              
              // Actualizar siempre (incluso si es 0 para limpiar datos incorrectos)
              await db
                .update(sellerCashRegisters)
                .set({
                  salesCash: totalCash,
                  salesQr: totalQr,
                  salesTransfer: totalTransfer,
                })
                .where(eq(sellerCashRegisters.id, box.id));

              updated++;
              console.log(`[Sync] Caja #${box.id} Vendedor=${box.sellerId} Fecha=${box.date} AbiertaEn=${openedAtStr} - ${ventasCount} ventas: Efectivo=${totalCash/100}, QR=${totalQr/100}, Transfer=${totalTransfer/100}`);
            }
          } catch (boxError: any) {
            errors.push(`Caja #${box.id}: ${boxError.message}`);
            console.error(`[Sync Error] Caja #${box.id}:`, boxError);
          }
        }

        return { 
          success: true, 
          message: errors.length > 0 
            ? `${updated} cajas sincronizadas. ${errors.length} errores.`
            : `${updated} cajas sincronizadas con ventas existentes`,
          boxesUpdated: updated,
          errors: errors.length > 0 ? errors : undefined
        };
      } catch (error: any) {
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: `Error sincronizando: ${error.message}` 
        });
      }
    }),
});
