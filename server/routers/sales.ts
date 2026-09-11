import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  cancelSaleRecord,
  createSaleWithItems,
  getAllSales,
  getNextSaleNumber,
  getSaleById,
  getSaleItemsBySaleId,
  markSalePaymentCompleted,
  getDb,
  getDbInitError,
  MOCK_UNITS,
} from "../db";
import { units, sellerCashRegisters } from "../../drizzle/schema";
import { eq, inArray, and, sql, desc } from "drizzle-orm";
import { ensureCustomerRecord } from "./customer_utils";
import { getLocalDateKey } from "../_core/date_utils";

const discountTypeSchema = z.enum(["none", "percentage", "fixed"]);
const paymentMethodSchema = z.enum(["cash", "qr", "transfer", "credit"]);
const paymentStatusSchema = z.enum(["pending", "completed"]);

function getLinePricing(basePrice: number, quantity: number, discountType: "none" | "percentage" | "fixed", discountValue: number) {
  const safeBasePrice = Math.max(0, Math.round(basePrice));
  const safeQuantity = Math.max(1, Math.round(quantity)); // Usar el quantity recibido
  const safeDiscountValue = Math.max(0, Math.round(discountValue));

  let finalUnitPrice = safeBasePrice;

  if (discountType === "percentage") {
    const percentage = Math.min(100, safeDiscountValue);
    finalUnitPrice = Math.max(0, Math.round(safeBasePrice * (1 - percentage / 100)));
  }

  if (discountType === "fixed") {
    finalUnitPrice = Math.max(0, safeBasePrice - safeDiscountValue);
  }

  const subtotal = finalUnitPrice * safeQuantity;
  const discountAmount = Math.max(0, safeBasePrice * safeQuantity - subtotal);

  return {
    basePrice: safeBasePrice,
    quantity: safeQuantity,
    discountValue: safeDiscountValue,
    discountAmount,
    finalUnitPrice,
    subtotal,
  };
}

function getGlobalDiscountAmount(subtotal: number, discountType: "none" | "percentage" | "fixed", discountValue: number) {
  const safeSubtotal = Math.max(0, Math.round(subtotal));
  const safeDiscountValue = Math.max(0, Math.round(discountValue));

  if (discountType === "percentage") {
    return Math.min(safeSubtotal, Math.round(safeSubtotal * (Math.min(100, safeDiscountValue) / 100)));
  }

  if (discountType === "fixed") {
    return Math.min(safeSubtotal, safeDiscountValue);
  }

  return 0;
}

export const salesRouter = router({
  getNextSaleNumber: protectedProcedure.query(async () => {
    return { saleNumber: await getNextSaleNumber() };
  }),

  list: protectedProcedure
    .input(z.object({ branchId: z.number().optional(), soldBy: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const branchId = input?.branchId;
      // Si el usuario es vendedor (seller), forzar que solo vea sus propias ventas
      const soldBy = ctx.user?.role === "seller" ? ctx.user.id : input?.soldBy;
      const allSales = await getAllSales(branchId, soldBy);
      return allSales;
    }),

  getDetails: protectedProcedure
    .input(z.object({ saleId: z.number() }))
    .query(async ({ ctx, input }) => {
      const sale = await getSaleById(input.saleId);
      if (!sale) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });
      }

      if (ctx.user?.role !== "admin" && sale.soldBy !== ctx.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const items = await getSaleItemsBySaleId(input.saleId);
      return { sale, items };
    }),

  create: protectedProcedure
    .input(
      z.object({
        branchId: z.number().optional(),
        customerId: z.number().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        customerTaxId: z.string().optional(),
        creditDays: z.number().default(30),
        warrantyDays: z.number().default(30),
        saleChannel: z.enum(["local", "delivery"]).default("local"),
        orderId: z.number().optional(),
        paymentMethod: paymentMethodSchema,
        paymentStatus: paymentStatusSchema.default("completed"),
        discountType: discountTypeSchema.default("none"),
        discountValue: z.number().default(0),
        notes: z.string().optional(),
        adminOverrideUserId: z.number().optional(),
        adminOverrideReason: z.string().optional(),
        items: z.array(
          z.object({
            unitId: z.number().int().positive("El ID de unidad debe ser un número positivo"),
            pricingType: z.enum(["unit", "wholesale", "discount"]).default("unit"),
            quantity: z.number().default(1),
            basePrice: z.number(),
            discountType: discountTypeSchema.default("none"),
            discountValue: z.number().default(0),
          })
        ).min(1, "Debes agregar al menos una unidad"),
        customerType: z.enum(["retail", "wholesale"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ─── VALIDACIÓN SERVIDOR: expandir items con quantity > 1 a múltiples unidades (solo para no-fungibles) ───
      const db = await getDb();
      
      // Expandir items: si quantity > 1, buscar múltiples unidades del mismo modelo
      const expandedItems = [];
      
      for (const item of input.items) {
        // Primero obtener la unidad para verificar su tipo
        let baseUnit: any = null;
        if (db) {
          const [u] = await db.select().from(units).where(eq(units.id, item.unitId)).limit(1);
          baseUnit = u;
        } else {
          baseUnit = (MOCK_UNITS as any[]).find((u: any) => u.id === item.unitId);
        }

        if (!baseUnit) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `La unidad ID ${item.unitId} no existe en el catálogo.` });
        }
        
        // Determinar si es fungible
        const unitType = (baseUnit.type || "").toLowerCase();
        const isFungible = ['charger', 'accessory', 'battery', 'cable', 'case', 'other'].includes(unitType);
        
        if (item.quantity === 1) {
          // Cantidad 1: verificar que está disponible
          if (baseUnit.status !== "available") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `La unidad ID ${item.unitId} no está disponible (estado: ${baseUnit.status}).` });
          }
          expandedItems.push(item);
        } else if (isFungible) {
          // ✅ Productos fungibles: NO expandir, mantener como un solo item con quantity > 1
          // Verificar que hay suficiente stock
          let stockCount = 0;
          if (db) {
            const availableCount = await db.select({ count: sql`count(*)` })
              .from(units)
              .where(
                and(
                  eq(units.brand, baseUnit.brand),
                  eq(units.model, baseUnit.model),
                  eq(units.status, "available")
                )
              );
            stockCount = Number(availableCount[0]?.count || 0);
          } else {
            stockCount = (MOCK_UNITS as any[]).filter(
              (u: any) => u.brand === baseUnit.brand && u.model === baseUnit.model && u.status === "available"
            ).length;
          }
          
          if (stockCount < item.quantity) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: `Solo hay ${stockCount} unidades disponibles de ${baseUnit.brand} ${baseUnit.model}. Solicitaste ${item.quantity}.` 
            });
          }
          
          // Mantener como un solo item con quantity (se procesará después)
          expandedItems.push({
            ...item,
            isFungible: true,
            brand: baseUnit.brand,
            model: baseUnit.model,
          });
        } else {
          // ❌ Productos únicos (laptops): expandir a múltiples unit IDs
          // Buscar unidades disponibles del mismo modelo
          let availableUnits: any[] = [];
          if (db) {
            availableUnits = await db.select({ id: units.id })
              .from(units)
              .where(
                and(
                  eq(units.brand, baseUnit.brand),
                  eq(units.model, baseUnit.model),
                  eq(units.status, "available")
                )
              )
              .limit(item.quantity);
          } else {
            availableUnits = (MOCK_UNITS as any[])
              .filter((u: any) => u.brand === baseUnit.brand && u.model === baseUnit.model && u.status === "available")
              .slice(0, item.quantity);
          }
          
          if (availableUnits.length < item.quantity) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: `Solo hay ${availableUnits.length} unidades disponibles de ${baseUnit.brand} ${baseUnit.model}. Solicitaste ${item.quantity}.` 
            });
          }
          
          // Crear un item por cada unidad encontrada
          for (const unit of availableUnits) {
            expandedItems.push({
              unitId: unit.id,
              pricingType: item.pricingType,
              quantity: 1,
              basePrice: item.basePrice,
              discountType: item.discountType,
              discountValue: item.discountValue,
            });
          }
        }
      }
      
      // Continuar con los items expandidos
      const normalizedItems = expandedItems.map((item: any) => {
        const itemQuantity = item.isFungible ? item.quantity : 1;
        const pricing = getLinePricing(item.basePrice, itemQuantity, item.discountType, item.discountValue);

        return {
          unitId: item.unitId,
          pricingType: item.pricingType,
          quantity: itemQuantity,
          basePrice: pricing.basePrice,
          discountType: item.discountType,
          discountValue: pricing.discountValue,
          discountAmount: pricing.discountAmount,
          finalUnitPrice: pricing.finalUnitPrice,
          subtotal: pricing.subtotal,
          isFungible: item.isFungible || false,
          brand: item.brand,
          model: item.model,
        };
      });

      const subtotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
      const discountAmount = getGlobalDiscountAmount(subtotal, input.discountType, input.discountValue);
      const total = Math.max(0, subtotal - discountAmount);
      const saleNumber = await getNextSaleNumber();

      let customerId = input.customerId;

      if (!customerId && input.customerName && input.customerPhone) {
        const customer = await ensureCustomerRecord({
          clientNumber: input.customerPhone,
          clientName: input.customerName,
          phone: input.customerPhone,
          taxId: input.customerTaxId,
          zone: "Venta Directa",
          sourceChannel: "other",
          customerType: input.customerType
        });
        if (customer) {
          customerId = customer.id;
        }
      }

      try {
        const result = await createSaleWithItems({
          saleNumber,
          branchId: input.branchId || ctx.branchId,
          customerId,
          customerName: customerId ? undefined : input.customerName,
          saleChannel: input.saleChannel,
          orderId: input.orderId,
          soldBy: ctx.user!.id,
          subtotal,
          discountType: input.discountType,
          discountValue: Math.round(input.discountValue),
          discountAmount,
          total,
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentMethod === "credit" ? "pending" : input.paymentStatus,
          creditDays: input.creditDays,
          warrantyDays: input.warrantyDays,
          adminOverrideUserId: input.adminOverrideUserId,
          adminOverrideReason: input.adminOverrideReason,
          notes: input.notes,
          items: normalizedItems as any,
        });

        const saleId = (result as any).insertId;

        // ═══════════════════════════════════════════════════════════════
        // REGISTRAR VENTA EN CAJA DEL VENDEDOR (SI TIENE CAJA ABIERTA)
        // ═══════════════════════════════════════════════════════════════
        // Registrar SIEMPRE si la venta tiene soldBy y no es crédito
        if (db && input.paymentMethod !== "credit") {
          try {
            const today = getLocalDateKey(); // Usar fecha de Bolivia
            const sellerId = ctx.user!.id; // El vendedor es quien está logueado (ya sea seller o admin vendiendo)
            
            // Buscar la ÚLTIMA caja abierta del vendedor (puede tener múltiples turnos)
            const cashRegisters = await db
              .select()
              .from(sellerCashRegisters)
              .where(
                and(
                  eq(sellerCashRegisters.sellerId, sellerId),
                  eq(sellerCashRegisters.date, today)
                )
              )
              .orderBy(desc(sellerCashRegisters.turnNumber));
            
            // Buscar la primera caja que esté activa (aprobada y abierta)
            const cashRegister = cashRegisters.find(
              cr => cr.openingStatus === "approved" && cr.closingStatus === "open"
            );
            
            if (cashRegister) {
              // Actualizar ventas según método de pago
              const updateData: any = {};
              
              if (input.paymentMethod === "cash") {
                updateData.salesCash = sql`${sellerCashRegisters.salesCash} + ${total}`;
              } else if (input.paymentMethod === "qr") {
                updateData.salesQr = sql`${sellerCashRegisters.salesQr} + ${total}`;
              } else if (input.paymentMethod === "transfer") {
                updateData.salesTransfer = sql`${sellerCashRegisters.salesTransfer} + ${total}`;
              }
              
              if (Object.keys(updateData).length > 0) {
                await db
                  .update(sellerCashRegisters)
                  .set(updateData)
                  .where(eq(sellerCashRegisters.id, cashRegister.id));
                
                console.log(`[Sale->Box] Registrada venta ${saleNumber} en caja #${cashRegister.id} - ${input.paymentMethod}: Bs.${(total/100).toFixed(2)}`);
              }
            } else {
              console.log(`[Sale->Box] Vendedor ${sellerId} no tiene caja abierta hoy ${today}`);
            }
          } catch (boxError) {
            console.error("[Sale->Box] Error registrando venta en caja:", boxError);
            // No fallar la venta si hay error en caja
          }
        }

        return { success: true, saleId, saleNumber };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "No se pudo registrar la venta",
        });
      }
    }),

  markPaymentCompleted: protectedProcedure
    .input(z.object({ saleId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      try {
        return await markSalePaymentCompleted(input.saleId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "No se pudo actualizar el pago",
        });
      }
    }),

  cancel: protectedProcedure
    .input(z.object({
      saleId: z.number(),
      reason: z.string().min(3, "Debes indicar el motivo"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      try {
        return await cancelSaleRecord(input.saleId, ctx.user!.id, input.reason);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "No se pudo anular la venta",
        });
      }
    }),
});
