import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getAllAccountsReceivable,
  getAllAccountsPayable,
  createCreditPayment,
  getAllCreditPayments,
  getCustomerCreditStatus,
  getDb,
  MOCK_FINANCIAL_TRANSACTIONS,
  syncMocksToDisk,
} from "../db";
import { accountsPayable, financialTransactions, purchases, purchaseItems, suppliers, units } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { getLocalDateKey } from "../_core/date_utils";

import { toPlainObject } from "../_core/serialize";

export const creditRouter = router({
  // ------ CUENTAS POR COBRAR (CXC) ------
  listReceivable: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      return [];
    }
    return toPlainObject(await getAllAccountsReceivable());
  }),

  // ------ CUENTAS POR PAGAR (CXP) ------
  listPayable: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      return [];
    }
    return toPlainObject(await getAllAccountsPayable());
  }),

  // ------ HISTORIAL DE ABONOS ------
  listPayments: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      return [];
    }
    return toPlainObject(await getAllCreditPayments());
  }),

  // ------ ESTADO DE CRÉDITO DE UN CLIENTE ------
  getCustomerCreditStatus: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input }) => {
      return await getCustomerCreditStatus(input.customerId);
    }),

  // ------ REGISTRAR ABONO (CXC o CXP) ------
  registerPayment: protectedProcedure
    .input(z.object({
      type: z.enum(["receivable", "payable"]),
      accountsReceivableId: z.number().optional(),
      accountsPayableId: z.number().optional(),
      amount: z.number().min(1, "El monto debe ser mayor a 0"),
      paymentMethod: z.enum(["cash", "qr", "transfer"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo administradores pueden registrar abonos." });
      }

      if (input.type === "receivable" && !input.accountsReceivableId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Debe especificar la cuenta por cobrar a abonar." });
      }
      if (input.type === "payable" && !input.accountsPayableId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Debe especificar la cuenta por pagar a abonar." });
      }

      try {
        const result = await createCreditPayment({
          type: input.type,
          accountsReceivableId: input.accountsReceivableId,
          accountsPayableId: input.accountsPayableId,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          userId: ctx.user!.id,
        });
        return { success: true, payment: result };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "No se pudo registrar el abono.",
        });
      }
    }),

  // ------ CONCILIACIÓN AUTOMÁTICA DE COMPRAS Y DEUDAS (CXP) ------
  reconcilePurchases: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const db = await getDb();
    if (!db) {
      return { success: true, reconciledCount: 0, message: "Modo demo sin cambios necesarios" };
    }

    let reconciledCount = 0;
    const details: string[] = [];

    // 1. Buscar compras en tabla `purchases` que sean crédito o no tengan transacción en `financialTransactions`
    const allPurchases = await db.select().from(purchases);
    const allTransactions = await db.select().from(financialTransactions).where(eq(financialTransactions.category, "purchase"));
    const allAPs = await db.select().from(accountsPayable);

    for (const p of allPurchases) {
      const hasTx = allTransactions.some((t: any) => t.referenceId === p.id);
      const hasAP = allAPs.some((ap: any) => ap.purchaseId === p.id);

      // Si es a crédito o no tiene egreso de caja y tampoco tiene cuenta por pagar
      if ((p.isCredit === 1 || !hasTx) && !hasAP && p.totalAmount > 0) {
        const dueDate = new Date(p.orderDate || new Date());
        dueDate.setDate(dueDate.getDate() + 30);
        const dueDateStr = getLocalDateKey(dueDate) || dueDate.toISOString().split("T")[0];

        await db.insert(accountsPayable).values({
          purchaseId: p.id,
          supplierId: p.supplierId || 1,
          totalAmount: p.totalAmount,
          paidAmount: 0,
          balance: p.totalAmount,
          dueDate: dueDateStr,
          status: "unpaid",
        });

        if (p.isCredit !== 1 || p.paymentStatus !== "pending") {
          await db.update(purchases).set({
            isCredit: 1,
            paymentStatus: "pending",
            paymentMethod: p.paymentMethod || "credit",
          }).where(eq(purchases.id, p.id));
        }

        reconciledCount++;
        details.push(`Compra #${p.purchaseNumber} (Bs. ${(p.totalAmount / 100).toFixed(2)}) registrada en Cuentas por Pagar.`);
      }
    }

    // 2. Buscar unidades individuales con precio de compra > 0 que no tengan compra asociada o cuya compra no esté en AP
    const allUnits = await db.select().from(units).where(sql`${units.purchasePrice} > 0`);
    for (const u of allUnits) {
      if (!u.purchaseId) {
        // Crear la compra maestra para esta unidad
        let supplierId = u.supplierId;
        if (!supplierId) {
          const [genericSup] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, "Proveedor Genérico (Compra Directa)")).limit(1);
          if (genericSup) {
            supplierId = genericSup.id;
          } else {
            const created = await db.insert(suppliers).values({ name: "Proveedor Genérico (Compra Directa)" });
            supplierId = (created as any)[0]?.insertId || (created as any)?.insertId || 1;
          }
        }

        const pNumber = `COMP-UNIT-${Date.now()}`;
        const pDate = u.purchaseDate ? new Date(u.purchaseDate + "T00:00:00") : new Date();
        const dueDate = new Date(pDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const dueDateStr = getLocalDateKey(dueDate) || dueDate.toISOString().split("T")[0];

        const purchaseRes: any = await db.insert(purchases).values({
          supplierId: supplierId!,
          purchaseNumber: pNumber,
          orderDate: pDate,
          totalAmount: u.purchasePrice,
          status: "received",
          paymentStatus: "pending",
          paymentMethod: "credit",
          isCredit: 1,
          branchId: u.branchId || 1,
        });

        const newPurchaseId = purchaseRes?.insertId || purchaseRes?.[0]?.insertId;
        if (newPurchaseId) {
          await db.update(units).set({ purchaseId: newPurchaseId }).where(eq(units.id, u.id));
          await db.insert(purchaseItems).values({
            purchaseId: newPurchaseId,
            unitId: u.id,
            quantity: 1,
            price: u.purchasePrice,
          });

          await db.insert(accountsPayable).values({
            purchaseId: newPurchaseId,
            supplierId: supplierId!,
            totalAmount: u.purchasePrice,
            paidAmount: 0,
            balance: u.purchasePrice,
            dueDate: dueDateStr,
            status: "unpaid",
          });

          reconciledCount++;
          details.push(`Unidad ${u.brand} ${u.model} (${u.code}) por Bs. ${(u.purchasePrice / 100).toFixed(2)} vinculada a Deuda CXP.`);
        }
      }
    }

    return {
      success: true,
      reconciledCount,
      details,
      message: reconciledCount > 0
        ? `Se conciliaron ${reconciledCount} compras/deudas exitosamente.`
        : "Todas las compras y cuentas por pagar ya se encuentran perfectamente conciliadas.",
    };
  }),

  // ------ INYECCIÓN O AJUSTE DE EFECTIVO A CAJA ------
  injectCashAdjustment: protectedProcedure
    .input(z.object({
      amount: z.number().min(1, "El monto debe ser mayor a 0"),
      paymentMethod: z.enum(["cash", "qr", "transfer"]).default("cash"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = await getDb();
      if (!db) {
        MOCK_FINANCIAL_TRANSACTIONS.push({
          id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
          branchId: 1,
          type: "income",
          category: "capital_injection",
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          userId: ctx.user!.id,
          notes: input.notes || "Ajuste / Inyección de Capital a Caja",
          createdAt: new Date(),
        });
        syncMocksToDisk();
        return { success: true };
      }

      await db.insert(financialTransactions).values({
        branchId: 1,
        type: "income",
        category: "capital_injection",
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        userId: ctx.user!.id,
        notes: input.notes || "Ajuste / Inyección de Capital a Caja",
      });

      return { success: true };
    }),

  // ------ TRANSFERIR GASTO DE REPARACIÓN A CUENTA POR PAGAR (CXP) ------
  reconcileRepairToPayable: protectedProcedure
    .input(z.object({
      transactionId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = await getDb();
      if (!db) {
        return { success: true, message: "Modo demo" };
      }

      const [txRow] = await db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, input.transactionId))
        .limit(1);

      if (!txRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transacción no encontrada" });
      }

      // Eliminar el egreso en efectivo de la caja
      await db.delete(financialTransactions).where(eq(financialTransactions.id, input.transactionId));

      // Crear una compra tipo servicio/taller con cuenta por pagar
      const [genericSup] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, "Servicio Técnico / Taller Especializado")).limit(1);
      let supplierId = genericSup?.id;
      if (!supplierId) {
        const created = await db.insert(suppliers).values({ name: "Servicio Técnico / Taller Especializado" });
        supplierId = (created as any)[0]?.insertId || (created as any)?.insertId || 1;
      }

      const pNumber = `REP-CXP-${Date.now()}`;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 15);
      const dueDateStr = getLocalDateKey(dueDate) || dueDate.toISOString().split("T")[0];

      const purchaseRes: any = await db.insert(purchases).values({
        supplierId: supplierId!,
        purchaseNumber: pNumber,
        orderDate: txRow.createdAt || new Date(),
        totalAmount: txRow.amount,
        status: "received",
        paymentStatus: "pending",
        paymentMethod: "credit",
        isCredit: 1,
        branchId: txRow.branchId || 1,
      });
      const purchaseId = purchaseRes?.insertId || purchaseRes?.[0]?.insertId;

      await db.insert(accountsPayable).values({
        purchaseId: purchaseId!,
        supplierId: supplierId!,
        totalAmount: txRow.amount,
        paidAmount: 0,
        balance: txRow.amount,
        dueDate: dueDateStr,
        status: "unpaid",
      });

      return {
        success: true,
        message: `Egreso de Bs. ${(txRow.amount / 100).toFixed(2)} revertido de la caja de efectivo y transferido a Cuentas por Pagar (CXP).`,
      };
    }),
});
