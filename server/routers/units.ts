import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { toPlainObject } from "../_core/serialize";
import {
  getDb,
  getAllUnits,
  getUnitById,
  getUnitByCode,
  createUnit,
  updateUnit,
  MOCK_UNIT_EVENTS,
  MOCK_UNITS,
  MOCK_PURCHASES,
  MOCK_PURCHASE_ITEMS,
  MOCK_FINANCIAL_TRANSACTIONS,
  MOCK_OPERATIONAL_EXPENSES,
  MOCK_REPAIRS,
  MOCK_WARRANTIES,
  MOCK_RETURNS,
  MOCK_SALES,
  MOCK_SALE_ITEMS,
  MOCK_ACCOUNTS_PAYABLE,
  syncMocksToDisk,
  createAutomaticOperationalExpense,
  checkCashRegisterOpening,
} from "../db";
import { getLocalDateKey } from "../_core/date_utils";
import { generatedCodes, units, unitEvents, purchases, purchaseItems, suppliers, financialTransactions, operationalExpenses, users, repairs, warranties, returns, saleItems, sales, systemSettings, branches, accountsPayable } from "../../drizzle/schema";
import * as schema from "../../drizzle/schema";
import { eq, ne, like, or, and, desc, sql, asc, inArray } from "drizzle-orm";
import { DEFAULT_COMPANY_CONFIG, readCompanyConfig } from "./settings";

// Tipos de unidad que no requieren diagnóstico (van directo a 'available')
const SIMPLE_TYPES = new Set(["charger", "accessory", "other"]);
function defaultStatusForType(type: string): "in_diagnosis" | "available" {
  return SIMPLE_TYPES.has(type) ? "available" : "in_diagnosis";
}

// Helper: lee configuración de empresa dinámica (compatible con BD y local)
async function getCompanyInfo(_db?: any) {
  return readCompanyConfig();
}

// 🔴 CRÍTICO #3: Calcular COGS promedio para productos fungibles (accesorios, cargadores)
// Utiliza el método de promedio ponderado: suma de (purchasePrice * cantidad) / cantidad total
async function calculateAverageCOGS(db: any, brand: string, model: string, type: string): Promise<number> {
  if (!db) {
    // Mock mode: calcular desde MOCK_UNITS
    const matchingUnits = MOCK_UNITS.filter((u: any) => 
      u.brand === brand && 
      u.model === model && 
      u.type === type &&
      u.purchasePrice > 0
    );
    
    if (matchingUnits.length === 0) return 0;
    
    const totalCost = matchingUnits.reduce((sum: number, u: any) => sum + u.purchasePrice, 0);
    return totalCost / matchingUnits.length;
  }

  // DB mode: calcular desde units table
  const result = await db
    .select({
      avgCost: sql<number>`AVG(${units.purchasePrice})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(units)
    .where(
      and(
        eq(units.brand, brand),
        eq(units.model, model),
        eq(units.type, type),
        sql`${units.purchasePrice} > 0`
      )
    );

  if (!result || result.length === 0 || !result[0].count) return 0;
  
  return Math.round((result[0].avgCost || 0) * 100) / 100; // Redondear a 2 decimales
}

export const unitsRouter = router({
  // Obtener catálogo/listado de unidades con filtros
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        type: z.enum(["laptop", "tablet", "phone", "monitor", "charger", "accessory", "other"]).optional(),
        status: z.enum(["in_diagnosis", "in_repair", "available", "sold", "returned"]).optional(),
        branchId: z.number().optional(),
        limit: z.number().default(100),
        offset: z.number().default(0),
      }).nullish()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const allUnits = await getAllUnits();
        let filtered = allUnits as any[];
        if (input?.type) filtered = filtered.filter((u: any) => u.type === input.type);
        if (input?.status) filtered = filtered.filter((u: any) => u.status === input.status);
        if (input?.branchId) filtered = filtered.filter((u: any) => u.branchId === input.branchId);
        if (input?.search) {
          const s = input.search.toLowerCase();
          filtered = filtered.filter((u: any) =>
            u.code?.toLowerCase().includes(s) ||
            u.brand?.toLowerCase().includes(s) ||
            u.model?.toLowerCase().includes(s) ||
            u.serialNumber?.toLowerCase().includes(s) ||
            u.rmaNumber?.toLowerCase().includes(s)
          );
        }
        const total = filtered.length;
        // Aplicar paginación en mock mode
        const limit = input?.limit ?? 100;
        const offset = input?.offset ?? 0;
        const paginated = filtered.slice(offset, offset + limit);

        const sanitized = paginated.map((unit: any) => {
          const specsParsed = typeof unit.specs === "string" ? JSON.parse(unit.specs) : (unit.specs || {});
          const damageChecklistParsed = typeof unit.damageChecklist === "string" ? JSON.parse(unit.damageChecklist) : (unit.damageChecklist || {});
          const mockP = unit.purchaseId ? MOCK_PURCHASES.find((p: any) => p.id === unit.purchaseId) : null;
          return {
            ...unit,
            purchasePaymentMethod: mockP?.paymentMethod || "cash",
            specs: specsParsed,
            damageChecklist: damageChecklistParsed,
          };
        });
        return { items: sanitized, total };
      }

      const conditions = [];

      if (input?.type) {
        conditions.push(eq(units.type, input.type));
      }

      if (input?.status) {
        conditions.push(eq(units.status, input.status));
      }

      if (input?.branchId) {
        conditions.push(eq(units.branchId, input.branchId));
      }

      if (input?.search) {
        const searchTerm = `%${input.search.trim()}%`;
        conditions.push(
          or(
            like(units.code, searchTerm),
            like(units.brand, searchTerm),
            like(units.model, searchTerm),
            like(units.serialNumber, searchTerm),
            like(units.rmaNumber, searchTerm),
            like(units.specs, searchTerm)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const items = await db
        .select({
          id: units.id,
          code: units.code,
          rmaNumber: units.rmaNumber,
          codeId: units.codeId,
          type: units.type,
          brand: units.brand,
          model: units.model,
          serialNumber: units.serialNumber,
          specs: units.specs,
          condition: units.condition,
          batteryHealth: units.batteryHealth,
          damageChecklist: units.damageChecklist,
          damageNotes: units.damageNotes,
          functionalTestPassed: units.functionalTestPassed,
          status: units.status,
          warrantyStatus: units.warrantyStatus,
          purchaseId: units.purchaseId,
          purchasePrice: units.purchasePrice,
          salePrice: units.salePrice,
          discountPrice: units.discountPrice,
          wholesalePrice: units.wholesalePrice,
          supplierId: units.supplierId,
          purchaseDate: units.purchaseDate,
          photos: units.photos,
          tiktokUrl: units.tiktokUrl,
          branchId: units.branchId,
          createdAt: units.createdAt,
          updatedAt: units.updatedAt,
          supplierName: suppliers.name,
          branchName: branches.name,
          branchAddress: branches.address,
          purchasePaymentMethod: purchases.paymentMethod,
        })
        .from(units)
        .leftJoin(suppliers, eq(units.supplierId, suppliers.id))
        .leftJoin(branches, eq(units.branchId, branches.id))
        .leftJoin(purchases, eq(units.purchaseId, purchases.id))
        .where(whereClause)
        .orderBy(desc(units.id))
        .limit(input?.limit || 2000)
        .offset(input?.offset || 0);

      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(units)
        .where(whereClause);

      const role = ctx.user.role;

      const sanitizedItems = items.map((unit: any) => {
        const specsParsed = unit.specs ? JSON.parse(unit.specs) : {};
        const damageChecklistParsed = unit.damageChecklist ? JSON.parse(unit.damageChecklist) : {};

        return {
          ...unit,
          specs: specsParsed,
          damageChecklist: damageChecklistParsed,
          purchasePrice: role === "technician" ? null : unit.purchasePrice,
          salePrice: role === "technician" ? null : unit.salePrice,
          discountPrice: role === "technician" ? null : unit.discountPrice,
          wholesalePrice: role === "technician" ? null : unit.wholesalePrice,
          ...(role === "seller" ? { purchasePrice: null } : {}),
        };
      });

      return toPlainObject({
        items: sanitizedItems,
        total: Number(countResult[0]?.count || 0),
      });
    }),

  // Buscar unidad por código (QR, Barcode o código interno)
  // Devuelve el Kardex completo cuando se encuentra la unidad
  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const role = ctx.user.role;

      // ─── MOCK MODE ─────────────────────────────────────────────────────────
      if (!db) {
        const codeStr = input.code.trim();
        const unitByCode = await getUnitByCode(codeStr);
        if (unitByCode) {
          const specs = typeof unitByCode.specs === "string" ? JSON.parse(unitByCode.specs) : (unitByCode.specs || {});
          const damageChecklist = typeof unitByCode.damageChecklist === "string" ? JSON.parse(unitByCode.damageChecklist) : (unitByCode.damageChecklist || {});

          const repairsList = (MOCK_REPAIRS as any[])
            .filter((r: any) => r.unitId === unitByCode.id)
            .sort((a: any, b: any) => a.id - b.id)
            .map((r: any) => ({
              id: r.id, otNumber: r.otNumber || null, rmaNumber: r.rmaNumber || null,
              startDate: r.startDate, endDate: r.endDate, status: r.status,
              resolutionType: r.resolutionType,
              laborCost: role === "seller" ? null : r.laborCost,
              partsCost: role === "seller" ? null : r.partsCost,
              partsUsed: r.partsUsed ? (typeof r.partsUsed === "string" ? JSON.parse(r.partsUsed) : r.partsUsed) : [],
              notes: r.notes, technicianName: "Demo Técnico",
            }));

          const warrantiesList = (MOCK_WARRANTIES as any[])
            .filter((w: any) => w.unitId === unitByCode.id)
            .sort((a: any, b: any) => a.id - b.id);

          const returnsList = (MOCK_RETURNS as any[])
            .filter((r: any) => r.unitId === unitByCode.id)
            .sort((a: any, b: any) => a.id - b.id);

          const saleItemsList = (MOCK_SALE_ITEMS as any[])
            .filter((si: any) => si.unitId === unitByCode.id)
            .map((si: any) => {
              const sale = (MOCK_SALES as any[]).find((s: any) => s.id === si.saleId);
              return { id: si.id, saleId: si.saleId, saleNumber: sale?.saleNumber || null, saleDate: sale?.createdAt || null, finalUnitPrice: si.finalUnitPrice, paymentMethod: sale?.paymentMethod || null, customerName: sale?.customerName || null };
            });

          return {
            found: true,
            unit: {
              ...unitByCode, specs, damageChecklist,
              repairHistory: repairsList,
              warrantyHistory: warrantiesList,
              returnHistory: returnsList,
              saleHistory: saleItemsList,
            },
          };
        }
        return {
          found: false,
          isUnassignedCode: true,
          message: "Código generado válido y disponible para vincular a una nueva unidad.",
        };
      }

      // ─── DB MODE ────────────────────────────────────────────────────────────
      const codeStr = input.code.trim();

      // Helper: enriquece una unidad encontrada con su Kardex completo
      const enrichUnit = async (foundUnit: any) => {
        const specs = foundUnit.specs ? JSON.parse(foundUnit.specs) : {};
        const damageChecklist = foundUnit.damageChecklist ? JSON.parse(foundUnit.damageChecklist) : {};

        const [repairsList, warrantiesList, returnsList, saleItemsList] = await Promise.all([
          db.select({
            id: repairs.id, otNumber: repairs.otNumber, rmaNumber: repairs.rmaNumber,
            startDate: repairs.startDate, endDate: repairs.endDate, status: repairs.status,
            resolutionType: repairs.resolutionType, laborCost: repairs.laborCost,
            partsCost: repairs.partsCost, partsUsed: repairs.partsUsed,
            notes: repairs.notes, technicianName: users.name,
          }).from(repairs).leftJoin(users, eq(repairs.technicianId, users.id))
            .where(eq(repairs.unitId, foundUnit.id)).orderBy(asc(repairs.id)),

          db.select({
            id: warranties.id, days: warranties.days, startDate: warranties.startDate,
            endDate: warranties.endDate, status: warranties.status, saleId: warranties.saleId,
          }).from(warranties).where(eq(warranties.unitId, foundUnit.id)).orderBy(asc(warranties.id)),

          db.select({
            id: returns.id, returnDate: returns.returnDate, reason: returns.reason,
            resolution: returns.resolution, reenteredRepair: returns.reenteredRepair,
          }).from(returns).where(eq(returns.unitId, foundUnit.id)).orderBy(asc(returns.id)),

          db.select({
            id: saleItems.id, saleId: saleItems.saleId, finalUnitPrice: saleItems.finalUnitPrice,
            saleNumber: sales.saleNumber, saleDate: sales.createdAt,
            paymentMethod: sales.paymentMethod, customerName: sales.customerName,
          }).from(saleItems).leftJoin(sales, eq(saleItems.saleId, sales.id))
            .where(eq(saleItems.unitId, foundUnit.id)).orderBy(desc(saleItems.id)),
        ]);

        return {
          ...foundUnit, specs, damageChecklist,
          purchasePrice: role === "technician" || role === "seller" ? null : foundUnit.purchasePrice,
          salePrice: role === "technician" ? null : foundUnit.salePrice,
          repairHistory: repairsList.map((r: any) => ({
            ...r,
            partsUsed: r.partsUsed ? JSON.parse(r.partsUsed) : [],
            laborCost: role === "seller" ? null : r.laborCost,
            partsCost: role === "seller" ? null : r.partsCost,
          })),
          warrantyHistory: warrantiesList,
          returnHistory: returnsList,
          saleHistory: saleItemsList,
        };
      };

      // Buscar por código interno de unidad
      const [unitByCode] = await db.select().from(units).where(eq(units.code, codeStr)).limit(1);
      if (unitByCode) {
        return { found: true, unit: await enrichUnit(unitByCode) };
      }

      // Buscar por código generado (QR/barcode físico)
      const [genCode] = await db.select().from(generatedCodes).where(eq(generatedCodes.code, codeStr)).limit(1);
      if (!genCode) {
        return { found: false, message: "El código escaneado no existe ni fue generado en el sistema." };
      }

      if (genCode.status === "assigned" && genCode.assignedUnitId) {
        const [assignedUnit] = await db.select().from(units).where(eq(units.id, genCode.assignedUnitId)).limit(1);
        if (assignedUnit) {
          return { found: true, isAssignedCode: true, unit: await enrichUnit(assignedUnit) };
        }
      }

      return {
        found: false,
        isUnassignedCode: true,
        generatedCode: genCode,
        message: "Código generado válido y disponible para vincular a una nueva unidad.",
      };
    }),

  // Detalle de una unidad por ID — devuelve Kardex completo
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const role = ctx.user.role;

      // ─── MOCK MODE ──────────────────────────────────────────────────────────
      if (!db) {
        const unit = await getUnitById(input.id);
        if (!unit) throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });
        const specs = typeof unit.specs === "string" ? JSON.parse(unit.specs) : (unit.specs || {});
        const damageChecklist = typeof unit.damageChecklist === "string" ? JSON.parse(unit.damageChecklist) : (unit.damageChecklist || {});

        const events = (MOCK_UNIT_EVENTS as any[])
          .filter((e: any) => e.unitId === input.id)
          .sort((a: any, b: any) => a.id - b.id)
          .map((e: any) => ({ id: e.id, eventType: e.eventType, fromStatus: e.fromStatus, toStatus: e.toStatus, notes: e.notes, createdAt: e.createdAt, userName: "Demo Técnico" }));

        const repairsList = (MOCK_REPAIRS as any[])
          .filter((r: any) => r.unitId === input.id)
          .sort((a: any, b: any) => a.id - b.id)
          .map((r: any) => ({
            id: r.id,
            otNumber: r.otNumber || null,
            rmaNumber: r.rmaNumber || null,
            startDate: r.startDate,
            endDate: r.endDate,
            status: r.status,
            resolutionType: r.resolutionType,
            laborCost: role === "seller" ? null : r.laborCost,
            partsCost: role === "seller" ? null : r.partsCost,
            partsUsed: r.partsUsed ? (typeof r.partsUsed === "string" ? JSON.parse(r.partsUsed) : r.partsUsed) : [],
            notes: r.notes,
            technicianName: "Demo Técnico",
          }));

        const warrantiesList = (MOCK_WARRANTIES as any[])
          .filter((w: any) => w.unitId === input.id)
          .sort((a: any, b: any) => a.id - b.id)
          .map((w: any) => ({ id: w.id, days: w.days, startDate: w.startDate, endDate: w.endDate, status: w.status, saleId: w.saleId }));

        const returnsList = (MOCK_RETURNS as any[])
          .filter((r: any) => r.unitId === input.id)
          .sort((a: any, b: any) => a.id - b.id)
          .map((r: any) => ({ id: r.id, returnDate: r.returnDate, reason: r.reason, resolution: r.resolution, reenteredRepair: r.reenteredRepair }));

        const saleItemsList = (MOCK_SALE_ITEMS as any[])
          .filter((si: any) => si.unitId === input.id)
          .map((si: any) => {
            const sale = (MOCK_SALES as any[]).find((s: any) => s.id === si.saleId);
            return { id: si.id, saleId: si.saleId, saleNumber: sale?.saleNumber || null, saleDate: sale?.createdAt || null, finalUnitPrice: si.finalUnitPrice, paymentMethod: sale?.paymentMethod || null, customerName: sale?.customerName || null };
          });

        const purchase = unit.purchaseId
          ? (MOCK_PURCHASES as any[]).find((p: any) => p.id === unit.purchaseId) || null
          : null;

        return {
          ...unit, specs, damageChecklist,
          purchasePrice: role === "technician" || role === "seller" ? null : unit.purchasePrice,
          salePrice: role === "technician" ? null : unit.salePrice,
          discountPrice: role === "technician" ? null : unit.discountPrice,
          wholesalePrice: role === "technician" ? null : unit.wholesalePrice,
          events,
          repairHistory: repairsList,
          warrantyHistory: warrantiesList,
          returnHistory: returnsList,
          saleHistory: saleItemsList,
          purchaseRecord: role === "seller" ? null : purchase,
        };
      }

      // ─── DB MODE ─────────────────────────────────────────────────────────────
      const [unit] = await db.select().from(units).where(eq(units.id, input.id)).limit(1);
      if (!unit) throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });

      // Run all queries in parallel for performance
      const [events, repairsList, warrantiesList, returnsList, saleItemsList, purchaseRecord] = await Promise.all([
        // 1. Timeline de eventos
        db.select({
          id: unitEvents.id, eventType: unitEvents.eventType,
          fromStatus: unitEvents.fromStatus, toStatus: unitEvents.toStatus,
          notes: unitEvents.notes, createdAt: unitEvents.createdAt, userName: users.name,
        }).from(unitEvents).leftJoin(users, eq(unitEvents.userId, users.id))
          .where(eq(unitEvents.unitId, unit.id)).orderBy(asc(unitEvents.id)),

        // 2. Historial de Órdenes de Trabajo
        db.select({
          id: repairs.id, otNumber: repairs.otNumber, rmaNumber: repairs.rmaNumber,
          startDate: repairs.startDate, endDate: repairs.endDate, status: repairs.status,
          resolutionType: repairs.resolutionType, laborCost: repairs.laborCost,
          partsCost: repairs.partsCost, partsUsed: repairs.partsUsed,
          notes: repairs.notes, technicianName: users.name,
        }).from(repairs).leftJoin(users, eq(repairs.technicianId, users.id))
          .where(eq(repairs.unitId, unit.id)).orderBy(asc(repairs.id)),

        // 3. Garantías
        db.select({
          id: warranties.id, days: warranties.days, startDate: warranties.startDate,
          endDate: warranties.endDate, status: warranties.status, saleId: warranties.saleId,
          pausedAt: warranties.pausedAt, remainingDaysAtPause: warranties.remainingDaysAtPause,
        }).from(warranties).where(eq(warranties.unitId, unit.id)).orderBy(asc(warranties.id)),

        // 4. Devoluciones
        db.select({
          id: returns.id, returnDate: returns.returnDate, reason: returns.reason,
          resolution: returns.resolution, reenteredRepair: returns.reenteredRepair, createdAt: returns.createdAt,
        }).from(returns).where(eq(returns.unitId, unit.id)).orderBy(asc(returns.id)),

        // 5. Ventas
        db.select({
          id: saleItems.id, saleId: saleItems.saleId, finalUnitPrice: saleItems.finalUnitPrice,
          saleNumber: sales.saleNumber, saleDate: sales.createdAt,
          paymentMethod: sales.paymentMethod, customerName: sales.customerName,
          saleStatus: sales.status,
        }).from(saleItems).leftJoin(sales, eq(saleItems.saleId, sales.id))
          .where(eq(saleItems.unitId, unit.id)).orderBy(desc(saleItems.id)),

        // 6. Compra original
        unit.purchaseId
          ? db.select({ id: purchases.id, purchaseNumber: purchases.purchaseNumber, orderDate: purchases.orderDate, totalAmount: purchases.totalAmount, paymentMethod: purchases.paymentMethod, status: purchases.status })
              .from(purchases).where(eq(purchases.id, unit.purchaseId)).limit(1)
              .then((r: any[]) => r[0] || null)
          : Promise.resolve(null),
      ]);

      const specsParsed = unit.specs ? JSON.parse(unit.specs) : {};
      const damageChecklistParsed = unit.damageChecklist ? JSON.parse(unit.damageChecklist) : {};

      return {
        ...unit,
        specs: specsParsed,
        damageChecklist: damageChecklistParsed,
        purchasePrice: role === "technician" || role === "seller" ? null : unit.purchasePrice,
        salePrice: role === "technician" ? null : unit.salePrice,
        discountPrice: role === "technician" ? null : unit.discountPrice,
        wholesalePrice: role === "technician" ? null : unit.wholesalePrice,
        events,
        repairHistory: repairsList.map((r: any) => ({
          ...r,
          partsUsed: r.partsUsed ? JSON.parse(r.partsUsed) : [],
          laborCost: role === "seller" ? null : r.laborCost,
          partsCost: role === "seller" ? null : r.partsCost,
        })),
        warrantyHistory: warrantiesList,
        returnHistory: returnsList,
        saleHistory: saleItemsList,
        purchaseRecord: role === "seller" ? null : purchaseRecord,
      };
    }),

  // Crear/Registrar nueva unidad
  create: protectedProcedure
    .input(
      z.object({
        code: z.string().min(1, "Código requerido"),
        codeId: z.number().optional(),
        type: z.enum(["laptop", "tablet", "phone", "monitor", "charger", "accessory", "other"]),
        brand: z.string().min(1, "Marca requerida"),
        model: z.string().min(1, "Modelo requerido"),
        serialNumber: z.string().max(100).optional(),
        specs: z.record(z.string(), z.any()).optional(),
        condition: z.number().min(1).max(10).optional(),
        batteryHealth: z.enum(["100", "90", "80", "70", "60", "50", "40", "plugged_only", "good", "fair", "bad_plugged_only", "n_a"]).default("n_a"),
        damageChecklist: z.record(z.string(), z.any()).optional(),
        damageNotes: z.string().optional(),
        functionalTestPassed: z.boolean().optional(),
        status: z.enum(["in_diagnosis", "in_repair", "available", "sold", "returned"]).default("in_diagnosis"),
        purchaseId: z.number().optional(),
        purchasePrice: z.number().min(0, "Precio de compra requerido"),
        salePrice: z.number().min(0).optional(),
        discountPrice: z.number().min(0).optional(),
        wholesalePrice: z.number().min(0).optional(),
        supplierId: z.number().optional(),
        purchaseDate: z.string().optional(),
        quantity: z.number().int().min(1).max(500).default(1),
        // Método de pago con que se compró el equipo (afecta la caja o genera cuenta por pagar)
        paymentMethod: z.enum(["cash", "qr", "transfer", "credit"]).default("cash"),
        branchId: z.number().default(1),
        photos: z.string().optional(), // JSON array of base64 strings
        tiktokUrl: z.string().optional(), // Enlace a video de TikTok
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const qty = input.quantity || 1;
      const baseCodeClean = input.code.trim();

      // ─── HELPER: genera número de compra único ───────────────────────────
      const genPurchaseNumber = (id: number | string) =>
        `COMP-UNIT-${String(id).padStart(6, "0")}`;

      // Determinar si es fungible
      const isFungible = ['charger', 'accessory', 'battery', 'cable', 'case', 'other'].includes(input.type);

      // 🔴 CRÍTICO #3: Validar purchasePrice obligatorio para productos únicos (no fungibles)
      if (!isFungible && (!input.purchasePrice || input.purchasePrice <= 0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `El precio de compra es obligatorio para productos únicos (${input.type}). Ingresa el costo real de adquisición para calcular COGS y rentabilidad correctamente.`,
        });
      }

      const getUnitCode = (index: number) => {
        // Para fungibles con qty > 1: MISMO código para todos
        if (isFungible && qty > 1) return baseCodeClean;
        
        // Para únicos o qty=1: código individual
        if (qty <= 1) return baseCodeClean;
        const padLen = qty > 99 ? 3 : 2;
        return `${baseCodeClean}-${String(index + 1).padStart(padLen, "0")}`;
      };

      if (!db) {
        // ─── MOCK MODE ─────────────────────────────────────────────────────
        const createdUnitIds: number[] = [];
        const createdCodes: string[] = [];

        // 1. Crear registro de compra maestro y egreso consolidado o deuda si hay precio
        let purchaseId: number | null = null;
        const totalPurchaseAmount = (input.purchasePrice || 0) * qty;
        const isCredit = input.paymentMethod === "credit" ? 1 : 0;

        if (totalPurchaseAmount > 0) {
          purchaseId = MOCK_PURCHASES.length + 1;
          const purchaseNumber = genPurchaseNumber(purchaseId);

          MOCK_PURCHASES.push({
            id: purchaseId,
            supplierId: input.supplierId || null,
            purchaseNumber,
            orderDate: input.purchaseDate ? new Date(input.purchaseDate) : new Date(),
            totalAmount: totalPurchaseAmount,
            status: "received",
            paymentStatus: isCredit ? "pending" : "paid",
            paymentMethod: input.paymentMethod,
            isCredit,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          if (isCredit) {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);
            MOCK_ACCOUNTS_PAYABLE.push({
              id: MOCK_ACCOUNTS_PAYABLE.length + 1,
              purchaseId,
              supplierId: input.supplierId || null,
              totalAmount: totalPurchaseAmount,
              paidAmount: 0,
              balance: totalPurchaseAmount,
              dueDate: dueDate.toISOString().split("T")[0],
              status: "unpaid",
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } else {
            // Egreso de caja consolidado
            MOCK_FINANCIAL_TRANSACTIONS.push({
              id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
              branchId: input.branchId || 1,
              type: "expense",
              category: "purchase",
              amount: totalPurchaseAmount,
              paymentMethod: input.paymentMethod,
              referenceId: purchaseId,
              userId: ctx.user.id,
              notes: `Compra (${qty} uds.) ${input.brand} ${input.model} (${baseCodeClean}) · ${purchaseNumber}`,
              createdAt: new Date(),
            });
          }
        }

        // 2. Crear las N unidades
        for (let i = 0; i < qty; i++) {
          const unitCode = getUnitCode(i);
          const newUnitId = MOCK_UNITS.length + 1;
          const finalStatus = input.status || defaultStatusForType(input.type);

          MOCK_UNITS.push({
            id: newUnitId,
            code: unitCode,
            codeId: i === 0 ? (input.codeId || null) : null,
            type: input.type,
            brand: input.brand,
            model: input.model,
            serialNumber: input.serialNumber ? (qty > 1 ? `${input.serialNumber}-${i + 1}` : input.serialNumber) : null,
            specs: JSON.stringify({ ...(input.specs || {}), barcode: baseCodeClean }),
            condition: input.condition || 10,
            batteryHealth: input.batteryHealth || "n_a",
            damageChecklist: JSON.stringify(input.damageChecklist || {}),
            damageNotes: input.damageNotes || null,
            functionalTestPassed: SIMPLE_TYPES.has(input.type) ? (input.functionalTestPassed ? 1 : 0) : 1,
            status: finalStatus,
            purchaseId: purchaseId,
            purchasePrice: input.purchasePrice || 0,
            salePrice: input.salePrice || 0,
            discountPrice: input.discountPrice || null,
            wholesalePrice: input.wholesalePrice || null,
            supplierId: input.supplierId || null,
            branchId: input.branchId || 1,
            photos: input.photos || null,
            tiktokUrl: input.tiktokUrl || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);

          if (purchaseId && input.purchasePrice > 0) {
            MOCK_PURCHASE_ITEMS.push({
              id: MOCK_PURCHASE_ITEMS.length + 1,
              purchaseId,
              unitId: newUnitId,
              quantity: 1,
              price: input.purchasePrice,
              createdAt: new Date(),
            });
          }

          MOCK_UNIT_EVENTS.push({
            id: Date.now() + i + 1,
            unitId: newUnitId,
            eventType: "created",
            fromStatus: null,
            toStatus: finalStatus,
            userId: ctx.user.id,
            notes: `Registro inicial ${qty > 1 ? `(Lote ${i + 1}/${qty}) ` : ""}— ${input.type.toUpperCase()} ${input.brand} ${input.model} · Estado: ${finalStatus}`,
            createdAt: new Date().toISOString(),
          });

          createdUnitIds.push(newUnitId);
          createdCodes.push(unitCode);
        }

        syncMocksToDisk();
        return {
          success: true,
          unitId: createdUnitIds[0],
          unitIds: createdUnitIds,
          code: createdCodes[0],
          codes: createdCodes,
          count: qty,
          purchaseId,
        };
      }

      // ─── DB MODE (MYSQL) ─────────────────────────────────────────────────
      // Verificar que los códigos a generar no colisionen
      const codesToCheck = Array.from({ length: qty }, (_, i) => getUnitCode(i));
      const existingUnits = await db
        .select({ code: units.code })
        .from(units)
        .where(inArray(units.code, codesToCheck));

      if (existingUnits.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El código ${existingUnits[0].code} ya está registrado para otra unidad.`,
        });
      }

      let resolvedCodeId = input.codeId;
      if (!resolvedCodeId && qty === 1) {
        const [genCode] = await db
          .select()
          .from(generatedCodes)
          .where(eq(generatedCodes.code, baseCodeClean))
          .limit(1);
        if (genCode) {
          resolvedCodeId = genCode.id;
        }
      }

      const specsWithBarcode = {
        ...(input.specs || {}),
        barcode: baseCodeClean,
      };
      const specsJson = JSON.stringify(specsWithBarcode);
      const damageChecklistJson = input.damageChecklist ? JSON.stringify(input.damageChecklist) : JSON.stringify({});

      // Resolver o crear proveedor genérico si no se especificó
      let finalSupplierId = input.supplierId || null;
      if (!finalSupplierId) {
        const genericName = "Proveedor Genérico (Compra Directa)";
        const [existingSupplier] = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(eq(suppliers.name, genericName))
          .limit(1);
        if (existingSupplier) {
          finalSupplierId = existingSupplier.id;
        } else {
          const created = await db.insert(suppliers).values({ name: genericName });
          finalSupplierId = (created as any)[0]?.insertId || (created as any)?.insertId || null;
        }
      }

      const totalPurchaseAmount = (input.purchasePrice || 0) * qty;

      // Toda la operación en una transacción atómica
      return await db.transaction(async (tx: any) => {
        let newPurchaseId: number | null = null;
        const purchaseNumber = genPurchaseNumber(Date.now());

        // 1. Si tiene precio de compra → crear registro maestro en purchases + egreso consolidado en caja o deuda CXP
        const isCredit = input.paymentMethod === "credit" ? 1 : 0;

        if (totalPurchaseAmount > 0) {
          const purchaseResult: any = await tx.insert(purchases).values({
            supplierId: finalSupplierId!,
            purchaseNumber,
            orderDate: input.purchaseDate ? new Date(input.purchaseDate + "T00:00:00") : new Date(),
            totalAmount: totalPurchaseAmount,
            status: "received",
            paymentStatus: isCredit ? "pending" : "paid",
            paymentMethod: input.paymentMethod,
            isCredit,
          });

          newPurchaseId = purchaseResult?.insertId || purchaseResult?.[0]?.insertId;

          if (!newPurchaseId) {
            throw new Error("No se pudo obtener el ID de la compra recién creada. insertId vacío.");
          }

          if (isCredit) {
            let dueDateStr: string;
            if (input.purchaseDate) {
              const d = new Date(input.purchaseDate + "T00:00:00");
              d.setDate(d.getDate() + 30);
              dueDateStr = getLocalDateKey(d) || d.toISOString().split("T")[0];
            } else {
              const d = new Date();
              d.setDate(d.getDate() + 30);
              dueDateStr = getLocalDateKey(d) || d.toISOString().split("T")[0];
            }

            await tx.insert(accountsPayable).values({
              purchaseId: newPurchaseId,
              supplierId: finalSupplierId!,
              totalAmount: totalPurchaseAmount,
              paidAmount: 0,
              balance: totalPurchaseAmount,
              dueDate: dueDateStr,
              status: "unpaid",
            });
          } else {
            // Validar apertura de caja si hay salida de dinero real
            if (totalPurchaseAmount > 0 && input.paymentMethod && input.paymentMethod !== "credit") {
              const today = getLocalDateKey(new Date()) || new Date().toISOString().split("T")[0];
              await checkCashRegisterOpening(tx, ctx.user.id, input.paymentMethod, today);
            }

            // Egreso de caja consolidado (transacción financiera real del lote)
            await tx.insert(financialTransactions).values({
              branchId: input.branchId || 1,
              type: "expense",
              category: "purchase",
              amount: totalPurchaseAmount,
              paymentMethod: input.paymentMethod,
              referenceId: newPurchaseId,
              userId: ctx.user.id,
              notes: `Compra (${qty} uds.) ${input.brand} ${input.model} (${baseCodeClean}) · ${purchaseNumber}`,
            });
          }
        }

        const createdUnitIds: number[] = [];
        const createdCodes: string[] = [];
        const finalStatus = input.status || defaultStatusForType(input.type);

        // 2. Insertar las N unidades individuales
        for (let i = 0; i < qty; i++) {
          const unitCode = getUnitCode(i);
          const unitSerialNumber = input.serialNumber ? (qty > 1 ? `${input.serialNumber}-${i + 1}` : input.serialNumber) : null;

          const unitInsertResult: any = await tx.insert(units).values({
            code: unitCode,
            codeId: i === 0 ? resolvedCodeId : null,
            type: input.type,
            brand: input.brand,
            model: input.model,
            serialNumber: unitSerialNumber,
            specs: specsJson,
            condition: input.condition,
            batteryHealth: input.batteryHealth,
            damageChecklist: damageChecklistJson,
            damageNotes: input.damageNotes || null,
            functionalTestPassed: SIMPLE_TYPES.has(input.type) ? (input.functionalTestPassed ? 1 : 0) : 1,
            status: finalStatus,
            purchasePrice: input.purchasePrice,
            salePrice: input.salePrice || 0,
            discountPrice: input.discountPrice ?? null,
            wholesalePrice: input.wholesalePrice ?? null,
            supplierId: finalSupplierId,
            purchaseId: newPurchaseId,
            branchId: input.branchId,
            photos: input.photos || null,
            tiktokUrl: input.tiktokUrl || null,
          });

          const unitId = unitInsertResult?.insertId || unitInsertResult?.[0]?.insertId;

          if (!unitId) {
            throw new Error(`No se pudo obtener el ID de la unidad #${i + 1}. insertId vacío.`);
          }

          createdUnitIds.push(unitId);
          createdCodes.push(unitCode);

          // Si es la primera unidad y tenía codeId, marcar el generatedCode como asignado
          if (i === 0 && resolvedCodeId) {
            await tx
              .update(generatedCodes)
              .set({ status: "assigned", assignedUnitId: unitId, assignedAt: new Date() })
              .where(eq(generatedCodes.id, resolvedCodeId));
          }

          // Insertar item de compra para cada unidad individual
          if (newPurchaseId && input.purchasePrice > 0) {
            await tx.insert(purchaseItems).values({
              purchaseId: newPurchaseId,
              unitId: unitId,
              quantity: 1,
              price: input.purchasePrice,
            });
          }

          // Evento de creación en el historial del equipo
          await tx.insert(unitEvents).values({
            unitId: unitId,
            eventType: "created",
            fromStatus: null,
            toStatus: finalStatus,
            userId: ctx.user.id,
            notes: `Registro inicial ${qty > 1 ? `(Lote ${i + 1}/${qty}) ` : ""}de unidad ${input.type.toUpperCase()} ${input.brand} ${input.model}`,
          });
        }

        return {
          success: true,
          unitId: createdUnitIds[0],
          unitIds: createdUnitIds,
          code: createdCodes[0],
          codes: createdCodes,
          count: qty,
          purchaseId: newPurchaseId,
        };
      });
    }),

  // Editar datos de una unidad
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        brand: z.string().optional(),
        model: z.string().optional(),
        specs: z.record(z.string(), z.any()).optional(),
        condition: z.number().optional(),
        batteryHealth: z.enum(["100", "90", "80", "70", "60", "50", "40", "plugged_only", "good", "fair", "bad_plugged_only", "n_a"]).optional(),
        damageChecklist: z.record(z.string(), z.any()).optional(),
        damageNotes: z.string().optional(),
        functionalTestPassed: z.boolean().optional(),
        salePrice: z.number().optional(),
        discountPrice: z.number().optional(),
        wholesalePrice: z.number().optional(),
        purchasePrice: z.number().optional(),
        supplierId: z.number().optional(),
        purchaseDate: z.string().optional(),
        branchId: z.number().optional(),
        status: z.enum(["in_diagnosis", "in_repair", "available", "sold", "returned"]).optional(),
        notes: z.string().optional(),
        photos: z.string().optional(),
        tiktokUrl: z.string().optional(),
        addQuantity: z.number().int().min(0).max(500).optional(),
        addPaymentMethod: z.enum(["cash", "qr", "transfer", "credit"]).default("cash"),
        updateAllMatching: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const addQty = input.addQuantity || 0;
      const genPurchaseNumber = (id: number | string) => `COMP-UNIT-${String(id).padStart(6, "0")}`;

      if (!db) {
        const targetUnit = MOCK_UNITS.find((u: any) => u.id === input.id);
        if (!targetUnit) throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });

        const updateData: Record<string, any> = {};
        if (input.brand !== undefined) updateData.brand = input.brand;
        if (input.model !== undefined) updateData.model = input.model;
        if (input.specs !== undefined) updateData.specs = typeof input.specs === "string" ? input.specs : JSON.stringify(input.specs);
        if (input.condition !== undefined) updateData.condition = input.condition;
        if (input.batteryHealth !== undefined) updateData.batteryHealth = input.batteryHealth;
        if (input.damageChecklist !== undefined) updateData.damageChecklist = typeof input.damageChecklist === "string" ? input.damageChecklist : JSON.stringify(input.damageChecklist);
        if (input.damageNotes !== undefined) updateData.damageNotes = input.damageNotes;
        if (input.functionalTestPassed !== undefined) updateData.functionalTestPassed = input.functionalTestPassed ? 1 : 0;
        if (input.salePrice !== undefined) updateData.salePrice = input.salePrice;
        if (input.discountPrice !== undefined) updateData.discountPrice = input.discountPrice;
        if (input.wholesalePrice !== undefined) updateData.wholesalePrice = input.wholesalePrice;
        if (input.purchasePrice !== undefined && ctx.user.role === "admin") updateData.purchasePrice = input.purchasePrice;
        if (input.supplierId !== undefined) updateData.supplierId = input.supplierId;
        if (input.purchaseDate !== undefined) updateData.purchaseDate = input.purchaseDate;
        if (input.branchId !== undefined) updateData.branchId = input.branchId;
        if (input.photos !== undefined) updateData.photos = input.photos;
        if (input.tiktokUrl !== undefined) updateData.tiktokUrl = input.tiktokUrl;
        if (input.status !== undefined) updateData.status = input.status;

        await updateUnit(input.id, updateData as any);

        // Si se seleccionó sincronizar precios con todas las unidades del mismo modelo
        if (input.updateAllMatching) {
          const matching = MOCK_UNITS.filter(
            (u: any) => u.id !== input.id && u.status !== "sold" &&
              u.brand?.toLowerCase() === (input.brand || targetUnit.brand)?.toLowerCase() &&
              u.model?.toLowerCase() === (input.model || targetUnit.model)?.toLowerCase()
          );
          for (const m of matching) {
            if (input.salePrice !== undefined) m.salePrice = input.salePrice;
            if (input.discountPrice !== undefined) m.discountPrice = input.discountPrice;
            if (input.wholesalePrice !== undefined) m.wholesalePrice = input.wholesalePrice;
            if (input.purchasePrice !== undefined && ctx.user.role === "admin") m.purchasePrice = input.purchasePrice;
          }
        }

        // Si la unidad tiene o se le asigna un precio de compra > 0 -> sincronizar compra y caja
        const effectivePriceMock = input.purchasePrice !== undefined ? input.purchasePrice : (targetUnit.purchasePrice || 0);
        const effectivePaymentMethodMock = input.addPaymentMethod || "cash";

        if (effectivePriceMock > 0) {
          let pId = targetUnit.purchaseId;
          const existingMockP = pId ? MOCK_PURCHASES.find((p: any) => p.id === pId) : null;

          if (existingMockP) {
            existingMockP.totalAmount = effectivePriceMock;
            existingMockP.paymentMethod = effectivePaymentMethodMock;
            if (input.supplierId) existingMockP.supplierId = input.supplierId;
            if (input.purchaseDate) existingMockP.orderDate = new Date(input.purchaseDate);
          } else {
            pId = MOCK_PURCHASES.length + 1;
            const pNumber = genPurchaseNumber(pId);
            updateData.purchaseId = pId;
            targetUnit.purchaseId = pId;
            MOCK_PURCHASES.push({
              id: pId,
              supplierId: input.supplierId || targetUnit.supplierId || null,
              purchaseNumber: pNumber,
              orderDate: input.purchaseDate ? new Date(input.purchaseDate) : new Date(),
              totalAmount: effectivePriceMock,
              status: "received",
              paymentStatus: "paid",
              paymentMethod: effectivePaymentMethodMock,
              isCredit: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          const existingMockTx = MOCK_FINANCIAL_TRANSACTIONS.find(
            (t: any) => t.category === "purchase" && t.referenceId === pId
          );
          if (existingMockTx) {
            existingMockTx.amount = effectivePriceMock;
            existingMockTx.paymentMethod = effectivePaymentMethodMock;
            existingMockTx.branchId = input.branchId || targetUnit.branchId || existingMockTx.branchId || 1;
          } else {
            MOCK_FINANCIAL_TRANSACTIONS.push({
              id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
              branchId: input.branchId || targetUnit.branchId || 1,
              type: "expense",
              category: "purchase",
              amount: effectivePriceMock,
              paymentMethod: effectivePaymentMethodMock,
              referenceId: pId,
              userId: ctx.user.id,
              notes: `Compra de unidad ${input.brand || targetUnit.brand} ${input.model || targetUnit.model} (${targetUnit.code})`,
              createdAt: new Date(),
            });
          }
        }

        // Si se agregó stock adicional (+N unidades) -> Crear unidades y transacción financiera de Egreso
        if (addQty > 0) {
          const effectivePurchasePrice = input.purchasePrice !== undefined ? input.purchasePrice : (targetUnit.purchasePrice || 0);
          const totalPurchaseAmount = effectivePurchasePrice * addQty;
          let purchaseId: number | null = null;

          if (totalPurchaseAmount > 0) {
            purchaseId = MOCK_PURCHASES.length + 1;
            const pNumber = genPurchaseNumber(purchaseId);
            MOCK_PURCHASES.push({
              id: purchaseId,
              supplierId: input.supplierId || targetUnit.supplierId || null,
              purchaseNumber: pNumber,
              orderDate: new Date(),
              totalAmount: totalPurchaseAmount,
              status: "received",
              paymentStatus: "paid",
              paymentMethod: input.addPaymentMethod || "cash",
              isCredit: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            MOCK_FINANCIAL_TRANSACTIONS.push({
              id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
              branchId: input.branchId || targetUnit.branchId || 1,
              type: "expense",
              category: "purchase",
              amount: totalPurchaseAmount,
              paymentMethod: input.addPaymentMethod || "cash",
              referenceId: purchaseId,
              userId: ctx.user.id,
              notes: `Compra adicional (+${addQty} uds.) ${input.brand || targetUnit.brand} ${input.model || targetUnit.model} · ${pNumber}`,
              createdAt: new Date(),
            });
          }

          const baseCode = (targetUnit.code || "ART").split("-")[0];
          
          // Determinar si es fungible
          const unitType = (targetUnit.type || "").toLowerCase();
          const isFungible = ['charger', 'accessory', 'battery', 'cable', 'case', 'other'].includes(unitType);
          
          // Para fungibles: UN código compartido; para únicos: códigos individuales
          const sharedCode = isFungible 
            ? `${baseCode}-${String(Date.now() % 100000).padStart(5, "0")}`
            : null;
          
          for (let i = 0; i < addQty; i++) {
            const newUnitId = MOCK_UNITS.length + 1;
            const unitCode = sharedCode || `${baseCode}-${String(Date.now() % 100000 + i).padStart(5, "0")}`;
            MOCK_UNITS.push({
              id: newUnitId,
              code: unitCode,
              type: targetUnit.type || "accessory",
              brand: input.brand || targetUnit.brand,
              model: input.model || targetUnit.model,
              specs: updateData.specs || targetUnit.specs,
              condition: input.condition || targetUnit.condition || 10,
              batteryHealth: input.batteryHealth || targetUnit.batteryHealth || "n_a",
              damageChecklist: updateData.damageChecklist || targetUnit.damageChecklist,
              damageNotes: input.damageNotes || targetUnit.damageNotes,
              functionalTestPassed: 1,
              status: "available",
              purchaseId,
              purchasePrice: effectivePurchasePrice,
              salePrice: input.salePrice !== undefined ? input.salePrice : targetUnit.salePrice,
              discountPrice: input.discountPrice !== undefined ? input.discountPrice : targetUnit.discountPrice,
              wholesalePrice: input.wholesalePrice !== undefined ? input.wholesalePrice : targetUnit.wholesalePrice,
              supplierId: input.supplierId || targetUnit.supplierId,
              branchId: input.branchId || targetUnit.branchId || 1,
              photos: input.photos || targetUnit.photos,
              tiktokUrl: input.tiktokUrl || targetUnit.tiktokUrl,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          syncMocksToDisk();
        }

        return { success: true };
      }

      const [unit] = await db
        .select()
        .from(units)
        .where(eq(units.id, input.id))
        .limit(1);

      if (!unit) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });
      }

      const updateData: Record<string, any> = {};

      if (input.brand !== undefined) updateData.brand = input.brand;
      if (input.model !== undefined) updateData.model = input.model;
      if (input.specs !== undefined) updateData.specs = JSON.stringify(input.specs);
      if (input.condition !== undefined) updateData.condition = input.condition;
      if (input.batteryHealth !== undefined) updateData.batteryHealth = input.batteryHealth;
      if (input.damageChecklist !== undefined) updateData.damageChecklist = JSON.stringify(input.damageChecklist);
      if (input.damageNotes !== undefined) updateData.damageNotes = input.damageNotes;
      if (input.functionalTestPassed !== undefined) updateData.functionalTestPassed = input.functionalTestPassed ? 1 : 0;
      if (input.salePrice !== undefined) updateData.salePrice = input.salePrice;
      if (input.discountPrice !== undefined) updateData.discountPrice = input.discountPrice;
      if (input.wholesalePrice !== undefined) updateData.wholesalePrice = input.wholesalePrice;
      if (input.purchasePrice !== undefined && ctx.user.role === "admin") updateData.purchasePrice = input.purchasePrice;
      if (input.supplierId !== undefined) updateData.supplierId = input.supplierId;
      if (input.purchaseDate !== undefined) updateData.purchaseDate = input.purchaseDate;
      if (input.branchId !== undefined) updateData.branchId = input.branchId;
      if (input.photos !== undefined) updateData.photos = input.photos;
      if (input.tiktokUrl !== undefined) updateData.tiktokUrl = input.tiktokUrl;

      let statusChanged = false;
      const oldStatus = unit.status;

      if (input.status !== undefined && input.status !== oldStatus) {
        updateData.status = input.status;
        statusChanged = true;
      }

      // Si la unidad tiene o se le asigna un precio de compra > 0 -> sincronizar compra y caja
      const effectivePrice = input.purchasePrice !== undefined ? input.purchasePrice : (unit.purchasePrice || 0);
      const effectivePaymentMethod = input.addPaymentMethod || "cash";

      if (effectivePrice > 0) {
        let purchaseId = unit.purchaseId;

        if (purchaseId) {
          // 1. Verificar si la compra existe en purchases
          const [existingPurchase] = await db
            .select()
            .from(purchases)
            .where(eq(purchases.id, purchaseId))
            .limit(1);

          const isCredit = effectivePaymentMethod === "credit" ? 1 : 0;
          if (existingPurchase) {
            // Actualizar la compra existente con el nuevo precio y nuevo método de pago
            const purchaseUpdate: Record<string, any> = {
              totalAmount: effectivePrice,
              paymentMethod: effectivePaymentMethod,
              isCredit,
              paymentStatus: isCredit ? "pending" : "paid",
            };
            if (input.supplierId) purchaseUpdate.supplierId = input.supplierId;
            if (input.purchaseDate) purchaseUpdate.orderDate = new Date(input.purchaseDate + "T00:00:00");
            await db.update(purchases).set(purchaseUpdate).where(eq(purchases.id, purchaseId));
          } else {
            purchaseId = null; // No existía en tabla compras
          }
        }

        if (!purchaseId) {
          // Crear la compra si no existía
          let supplierId = input.supplierId || unit.supplierId;
          if (!supplierId) {
            const [genericSup] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, "Proveedor Genérico (Compra Directa)")).limit(1);
            if (genericSup) {
              supplierId = genericSup.id;
            } else {
              const created = await db.insert(suppliers).values({ name: "Proveedor Genérico (Compra Directa)" });
              supplierId = (created as any)[0]?.insertId || (created as any)?.insertId || 1;
            }
          }

          const purchaseNumber = genPurchaseNumber(Date.now());
          const purchaseDate = input.purchaseDate ? new Date(input.purchaseDate + "T00:00:00") : new Date();
          const isCredit = effectivePaymentMethod === "credit" ? 1 : 0;

          const purchaseRes: any = await db.insert(purchases).values({
            supplierId: supplierId!,
            purchaseNumber,
            orderDate: purchaseDate,
            totalAmount: effectivePrice,
            status: "received",
            paymentStatus: isCredit ? "pending" : "paid",
            paymentMethod: effectivePaymentMethod,
            isCredit,
            branchId: input.branchId || unit.branchId || 1,
          });

          purchaseId = purchaseRes?.insertId || purchaseRes?.[0]?.insertId;
          if (purchaseId) {
            updateData.purchaseId = purchaseId;

            // Registrar item de compra
            await db.insert(purchaseItems).values({
              purchaseId,
              unitId: unit.id,
              quantity: 1,
              price: effectivePrice,
            });
          }
        }

        // Sincronizar Caja / Finanzas o Cuentas por Pagar (CXP)
        if (purchaseId) {
          const isCredit = effectivePaymentMethod === "credit";

          if (isCredit) {
            // 1. Si era crédito, eliminar cualquier egreso de caja previo de esta compra
            await db
              .delete(financialTransactions)
              .where(
                and(
                  eq(financialTransactions.category, "purchase"),
                  eq(financialTransactions.referenceId, purchaseId)
                )
              );

            // 2. Sincronizar o insertar en accountsPayable
            const [existingAP] = await db
              .select()
              .from(accountsPayable)
              .where(eq(accountsPayable.purchaseId, purchaseId))
              .limit(1);

            let dueDateStr: string;
            if (input.purchaseDate) {
              const d = new Date(input.purchaseDate + "T00:00:00");
              d.setDate(d.getDate() + 30);
              dueDateStr = getLocalDateKey(d) || d.toISOString().split("T")[0];
            } else {
              const d = new Date();
              d.setDate(d.getDate() + 30);
              dueDateStr = getLocalDateKey(d) || d.toISOString().split("T")[0];
            }

            if (existingAP) {
              const paidAmount = existingAP.paidAmount || 0;
              const newBalance = Math.max(0, effectivePrice - paidAmount);
              await db
                .update(accountsPayable)
                .set({
                  totalAmount: effectivePrice,
                  balance: newBalance,
                  status: newBalance <= 0 ? "paid" : (paidAmount > 0 ? "partially_paid" : "unpaid"),
                  supplierId: input.supplierId || unit.supplierId || existingAP.supplierId,
                  updatedAt: new Date(),
                })
                .where(eq(accountsPayable.id, existingAP.id));
            } else {
              await db.insert(accountsPayable).values({
                purchaseId,
                supplierId: input.supplierId || unit.supplierId || 1,
                totalAmount: effectivePrice,
                paidAmount: 0,
                balance: effectivePrice,
                dueDate: dueDateStr,
                status: "unpaid",
              });
            }
          } else {
            // No es a crédito (Efectivo / QR / Transferencia)
            // 1. Si existía cuenta por pagar sin abonos, eliminarla
            const [existingAP] = await db
              .select()
              .from(accountsPayable)
              .where(eq(accountsPayable.purchaseId, purchaseId))
              .limit(1);

            if (existingAP && (existingAP.paidAmount || 0) === 0) {
              await db.delete(accountsPayable).where(eq(accountsPayable.id, existingAP.id));
            }

            // 2. Sincronizar o insertar en financialTransactions
            const [existingTx] = await db
              .select()
              .from(financialTransactions)
              .where(
                and(
                  eq(financialTransactions.category, "purchase"),
                  eq(financialTransactions.referenceId, purchaseId)
                )
              )
              .limit(1);

            if (existingTx) {
              await db
                .update(financialTransactions)
                .set({
                  amount: effectivePrice,
                  paymentMethod: effectivePaymentMethod,
                  branchId: input.branchId || unit.branchId || existingTx.branchId || 1,
                  notes: `Compra de unidad ${input.brand || unit.brand} ${input.model || unit.model} (${unit.code})`,
                })
                .where(eq(financialTransactions.id, existingTx.id));
            } else {
              await db.insert(financialTransactions).values({
                branchId: input.branchId || unit.branchId || 1,
                type: "expense",
                category: "purchase",
                amount: effectivePrice,
                paymentMethod: effectivePaymentMethod,
                referenceId: purchaseId,
                userId: ctx.user.id,
                notes: `Compra de unidad ${input.brand || unit.brand} ${input.model || unit.model} (${unit.code})`,
              });
            }
          }
        }
      }

      await db
        .update(units)
        .set(updateData)
        .where(eq(units.id, input.id));

      if (statusChanged) {
        await db.insert(unitEvents).values({
          unitId: input.id,
          eventType: "status_change",
          fromStatus: oldStatus,
          toStatus: input.status,
          userId: ctx.user.id,
          notes: input.notes || `Cambio de estado manual a ${input.status}`,
        });
      }

      // Sincronizar precios con todas las unidades no vendidas del mismo modelo si se solicita
      if (input.updateAllMatching) {
        const syncData: Record<string, any> = {};
        if (input.salePrice !== undefined) syncData.salePrice = input.salePrice;
        if (input.discountPrice !== undefined) syncData.discountPrice = input.discountPrice;
        if (input.wholesalePrice !== undefined) syncData.wholesalePrice = input.wholesalePrice;
        if (input.purchasePrice !== undefined && ctx.user.role === "admin") syncData.purchasePrice = input.purchasePrice;
        if (input.specs !== undefined) syncData.specs = JSON.stringify(input.specs);
        if (input.supplierId !== undefined) syncData.supplierId = input.supplierId;

        if (Object.keys(syncData).length > 0) {
          await db
            .update(units)
            .set(syncData)
            .where(
              and(
                eq(units.brand, input.brand || unit.brand),
                eq(units.model, input.model || unit.model),
                ne(units.status, "sold"),
                ne(units.id, input.id)
              )
            );
        }
      }

      // Si se especificó addQuantity > 0, insertar nuevas unidades y registrar egreso en Caja / Finanzas
      if (addQty > 0) {
        const effectivePurchasePrice = input.purchasePrice !== undefined ? input.purchasePrice : (unit.purchasePrice || 0);
        const totalPurchaseAmount = effectivePurchasePrice * addQty;
        const baseCodeClean = (unit.code || "ART").split("-")[0];

        await db.transaction(async (tx: any) => {
          let purchaseId: number | null = null;
          const purchaseNumber = genPurchaseNumber(Date.now());

          if (totalPurchaseAmount > 0) {
            let supplierId = input.supplierId || unit.supplierId;
            if (!supplierId) {
              const [genericSup] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, "Proveedor Genérico (Compra Directa)")).limit(1);
              if (genericSup) {
                supplierId = genericSup.id;
              } else {
                const created = await tx.insert(suppliers).values({ name: "Proveedor Genérico (Compra Directa)" });
                supplierId = (created as any)[0]?.insertId || (created as any)?.insertId || 1;
              }
            }

            const purchaseRes: any = await tx.insert(purchases).values({
              supplierId: supplierId!,
              purchaseNumber,
              orderDate: new Date(),
              totalAmount: totalPurchaseAmount,
              status: "received",
              paymentStatus: "paid",
              paymentMethod: input.addPaymentMethod || "cash",
              isCredit: 0,
              branchId: input.branchId || unit.branchId || 1,
            });

            purchaseId = purchaseRes?.insertId || purchaseRes?.[0]?.insertId;

            // Egreso financiero en Finanzas / Caja
            await tx.insert(financialTransactions).values({
              branchId: input.branchId || unit.branchId || 1,
              type: "expense",
              category: "purchase",
              amount: totalPurchaseAmount,
              paymentMethod: input.addPaymentMethod || "cash",
              referenceId: purchaseId,
              userId: ctx.user.id,
              notes: `Compra adicional (+${addQty} uds.) ${input.brand || unit.brand} ${input.model || unit.model} (${baseCodeClean}) · ${purchaseNumber}`,
            });
          }

          // Determinar si el producto es fungible
          const unitType = (unit.type || "").toLowerCase();
          const isFungible = ['charger', 'accessory', 'battery', 'cable', 'case', 'other'].includes(unitType);
          
          // Para productos fungibles: UN SOLO código compartido
          // Para productos únicos: códigos individuales
          const sharedCode = isFungible 
            ? `${baseCodeClean}-${String(Date.now() % 100000).padStart(5, "0")}`
            : null;

          for (let i = 0; i < addQty; i++) {
            const newCode = sharedCode || `${baseCodeClean}-${String(Date.now() % 100000 + i + Math.floor(Math.random() * 900)).padStart(5, "0")}`;
            await tx.insert(units).values({
              code: newCode,
              type: unit.type,
              brand: input.brand || unit.brand,
              model: input.model || unit.model,
              specs: updateData.specs || unit.specs,
              condition: input.condition || unit.condition || 10,
              batteryHealth: input.batteryHealth || unit.batteryHealth || "n_a",
              damageChecklist: updateData.damageChecklist || unit.damageChecklist || JSON.stringify({}),
              damageNotes: input.damageNotes || unit.damageNotes,
              functionalTestPassed: 1,
              status: "available",
              purchaseId,
              purchasePrice: effectivePurchasePrice,
              salePrice: input.salePrice !== undefined ? input.salePrice : unit.salePrice,
              discountPrice: input.discountPrice !== undefined ? input.discountPrice : unit.discountPrice,
              wholesalePrice: input.wholesalePrice !== undefined ? input.wholesalePrice : unit.wholesalePrice,
              supplierId: input.supplierId || unit.supplierId,
              branchId: input.branchId || unit.branchId || 1,
              photos: input.photos || unit.photos,
              tiktokUrl: input.tiktokUrl || unit.tiktokUrl,
            });
          }
        });
      }

      return { success: true };
    }),

  // Cambiar estado de unidad
  changeStatus: protectedProcedure
    .input(
      z.object({
        unitId: z.number(),
        toStatus: z.enum(["in_diagnosis", "in_repair", "available", "sold", "returned"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const unit = MOCK_UNITS.find((u: any) => u.id === input.unitId);
        if (!unit) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });
        }
        if (input.toStatus === "available") {
          const hasActiveRepair = (MOCK_REPAIRS as any[]).some(
            (r: any) => r.unitId === input.unitId && (r.status === "in_progress" || r.status === "pending")
          );
          if (hasActiveRepair) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Esta unidad tiene una orden activa en taller técnico. Debe completar o cancelar la reparación en el módulo de Taller antes de marcarla como disponible para la venta.",
            });
          }
        }
        const fromStatus = unit?.status || null;
        await updateUnit(input.unitId, { status: input.toStatus } as any);
        // ── Evento de cambio de estado ──────────────────────────────────────
        MOCK_UNIT_EVENTS.push({
          id: Date.now() + 1,
          unitId: input.unitId,
          eventType: "status_change",
          fromStatus,
          toStatus: input.toStatus,
          userId: ctx.user.id,
          notes: input.notes || `Estado actualizado: ${fromStatus} → ${input.toStatus}`,
          createdAt: new Date().toISOString(),
        });
        syncMocksToDisk();
        return { success: true };
      }

      const [unit] = await db
        .select()
        .from(units)
        .where(eq(units.id, input.unitId))
        .limit(1);

      if (!unit) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });
      }

      if (input.toStatus === "available") {
        const activeRepairs = await db
          .select()
          .from(repairs)
          .where(and(eq(repairs.unitId, input.unitId), eq(repairs.status, "in_progress")))
          .limit(1);
        if (activeRepairs.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Esta unidad tiene una orden activa en taller técnico. Debe completar o cancelar la reparación en el módulo de Taller antes de marcarla como disponible para la venta.",
          });
        }
      }

      const fromStatus = unit.status;

      await db
        .update(units)
        .set({ status: input.toStatus })
        .where(eq(units.id, input.unitId));

      await db.insert(unitEvents).values({
        unitId: input.unitId,
        eventType: "status_change",
        fromStatus,
        toStatus: input.toStatus,
        userId: ctx.user.id,
        notes: input.notes || `Estado actualizado a ${input.toStatus}`,
      });

      return { success: true };
    }),

  // ─── FASE 2: CATÁLOGO COMERCIAL SEGURO (SOLO PRODUCTOS DISPONIBLES) ──────
  getCommercialCatalog: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        type: z.enum(["laptop", "tablet", "phone", "monitor", "charger", "accessory", "other"]).optional(),
        branchId: z.number().optional(),
        brand: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();

      const DEFAULT_COMPANY_INFO = await getCompanyInfo(db);

      // ─── MOCK MODE ───
      if (!db) {
        const allUnits = await getAllUnits();
        // REGLA FUNDAMENTAL: Solo productos con status === 'available'
        let available = (allUnits as any[]).filter((u: any) => u.status === "available");

        if (input?.type) available = available.filter((u: any) => u.type === input.type);
        if (input?.branchId) available = available.filter((u: any) => u.branchId === input.branchId);
        if (input?.brand) {
          const b = input.brand.toLowerCase();
          available = available.filter((u: any) => u.brand?.toLowerCase().includes(b));
        }
        if (input?.search) {
          const s = input.search.toLowerCase();
          available = available.filter((u: any) =>
            u.code?.toLowerCase().includes(s) ||
            u.brand?.toLowerCase().includes(s) ||
            u.model?.toLowerCase().includes(s) ||
            (typeof u.specs === "string" && u.specs.toLowerCase().includes(s))
          );
        }

        const items = available.map((u: any, idx: number) => {
          const specsParsed = typeof u.specs === "string" ? JSON.parse(u.specs) : (u.specs || {});
          const photosParsed = u.photos
            ? (typeof u.photos === "string" ? JSON.parse(u.photos) : u.photos)
            : [];

          return {
            catalogIndex: idx + 1, // Posición 01, 02, 03... en el catálogo
            id: u.id,
            code: u.code,
            type: u.type,
            brand: u.brand,
            model: u.model,
            serialNumber: u.serialNumber,
            specs: specsParsed,
            condition: u.condition,
            batteryHealth: u.batteryHealth,
            damageNotes: u.damageNotes || null,
            salePrice: u.salePrice || 0,
            discountPrice: u.discountPrice || 0,
            wholesalePrice: u.wholesalePrice || 0,
            photos: Array.isArray(photosParsed) ? photosParsed.slice(0, 6) : [],
            mainPhoto: Array.isArray(photosParsed) && photosParsed.length > 0 ? photosParsed[0] : null,
            tiktokUrl: u.tiktokUrl || null,
            status: u.status,
          };
        });

        return {
          items,
          total: items.length,
          company: DEFAULT_COMPANY_INFO,
          generatedAt: new Date().toISOString(),
        };
      }

      // ─── DB MODE ───
      const conditions: any[] = [eq(units.status, "available")];

      if (input?.type) conditions.push(eq(units.type, input.type));
      if (input?.branchId) conditions.push(eq(units.branchId, input.branchId));
      if (input?.brand) conditions.push(like(units.brand, `%${input.brand.trim()}%`));
      if (input?.search) {
        const s = `%${input.search.trim()}%`;
        conditions.push(or(like(units.code, s), like(units.brand, s), like(units.model, s), like(units.specs, s)));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: units.id,
          code: units.code,
          type: units.type,
          brand: units.brand,
          model: units.model,
          serialNumber: units.serialNumber,
          specs: units.specs,
          condition: units.condition,
          batteryHealth: units.batteryHealth,
          damageNotes: units.damageNotes,
          salePrice: units.salePrice,
          discountPrice: units.discountPrice,
          wholesalePrice: units.wholesalePrice,
          photos: units.photos,
          tiktokUrl: units.tiktokUrl,
          status: units.status,
          warrantyStatus: units.warrantyStatus,
        })
        .from(units)
        .where(whereClause as any)
        .orderBy(asc(units.id));

      const items = rows.map((u: any, idx: number) => {
        const specsParsed = u.specs ? JSON.parse(u.specs) : {};
        const photosParsed = u.photos ? (typeof u.photos === "string" ? JSON.parse(u.photos) : u.photos) : [];
        return {
          catalogIndex: idx + 1,
          id: u.id,
          code: u.code,
          type: u.type,
          brand: u.brand,
          model: u.model,
          serialNumber: u.serialNumber,
          specs: specsParsed,
          condition: u.condition,
          batteryHealth: u.batteryHealth,
          damageNotes: u.damageNotes || null,
          salePrice: u.salePrice || 0,
          discountPrice: u.discountPrice || 0,
          wholesalePrice: u.wholesalePrice || 0,
          photos: Array.isArray(photosParsed) ? photosParsed.slice(0, 6) : [],
          mainPhoto: Array.isArray(photosParsed) && photosParsed.length > 0 ? photosParsed[0] : null,
          tiktokUrl: u.tiktokUrl || null,
          status: u.status,
        };
      });

      return {
        items,
        total: items.length,
        company: DEFAULT_COMPANY_INFO,
        generatedAt: new Date().toISOString(),
      };
    }),

  // ─── FASE 2: FICHA COMERCIAL INDIVIDUAL SEGURA (1 PRODUCTO) ──────────────
  getCommercialSheet: protectedProcedure
    .input(
      z.object({
        unitId: z.number().optional(),
        code: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();

      const DEFAULT_COMPANY_INFO = await getCompanyInfo(db);

      // ─── MOCK MODE ───
      if (!db) {
        let foundUnit: any = null;
        if (input.unitId) {
          foundUnit = await getUnitById(input.unitId);
        } else if (input.code) {
          foundUnit = await getUnitByCode(input.code);
        }

        if (!foundUnit) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado para ficha comercial" });
        }

        const specsParsed = typeof foundUnit.specs === "string" ? JSON.parse(foundUnit.specs) : (foundUnit.specs || {});
        const photosParsed = foundUnit.photos
          ? (typeof foundUnit.photos === "string" ? JSON.parse(foundUnit.photos) : foundUnit.photos)
          : [];

        return {
          unit: {
            id: foundUnit.id,
            code: foundUnit.code,
            rmaNumber: foundUnit.rmaNumber || null,
            type: foundUnit.type,
            brand: foundUnit.brand,
            model: foundUnit.model,
            serialNumber: foundUnit.serialNumber || null,
            specs: specsParsed,
            condition: foundUnit.condition,
            batteryHealth: foundUnit.batteryHealth,
            damageNotes: foundUnit.damageNotes || null,
            salePrice: foundUnit.salePrice || 0,
            discountPrice: foundUnit.discountPrice || 0,
            wholesalePrice: foundUnit.wholesalePrice || 0,
            photos: Array.isArray(photosParsed) ? photosParsed.slice(0, 6) : [],
            mainPhoto: Array.isArray(photosParsed) && photosParsed.length > 0 ? photosParsed[0] : null,
            tiktokUrl: foundUnit.tiktokUrl || null,
            status: foundUnit.status,
            warrantyDaysDefault: 30,
            functionalTestPassed: foundUnit.functionalTestPassed === 1,
          },
          company: DEFAULT_COMPANY_INFO,
          generatedAt: new Date().toISOString(),
        };
      }

      // ─── DB MODE ───
      let queryCondition = undefined;
      if (input.unitId) {
        queryCondition = eq(units.id, input.unitId);
      } else if (input.code) {
        queryCondition = eq(units.code, input.code.trim());
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Debe proporcionar unitId o code" });
      }

      const [foundUnit] = await db
        .select({
          id: units.id,
          code: units.code,
          rmaNumber: units.rmaNumber,
          type: units.type,
          brand: units.brand,
          model: units.model,
          serialNumber: units.serialNumber,
          specs: units.specs,
          condition: units.condition,
          batteryHealth: units.batteryHealth,
          damageNotes: units.damageNotes,
          salePrice: units.salePrice,
          discountPrice: units.discountPrice,
          wholesalePrice: units.wholesalePrice,
          photos: units.photos,
          tiktokUrl: units.tiktokUrl,
          status: units.status,
          warrantyStatus: units.warrantyStatus,
          functionalTestPassed: units.functionalTestPassed,
        })
        .from(units)
        .where(queryCondition)
        .limit(1);

      if (!foundUnit) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado para ficha comercial" });
      }

      const specsParsed = foundUnit.specs ? JSON.parse(foundUnit.specs) : {};
      const photosParsed = foundUnit.photos ? (typeof foundUnit.photos === "string" ? JSON.parse(foundUnit.photos) : foundUnit.photos) : [];

      return {
        unit: {
          id: foundUnit.id,
          code: foundUnit.code,
          rmaNumber: foundUnit.rmaNumber || null,
          type: foundUnit.type,
          brand: foundUnit.brand,
          model: foundUnit.model,
          serialNumber: foundUnit.serialNumber || null,
          specs: specsParsed,
          condition: foundUnit.condition,
          batteryHealth: foundUnit.batteryHealth,
          damageNotes: foundUnit.damageNotes || null,
          salePrice: foundUnit.salePrice || 0,
          discountPrice: foundUnit.discountPrice || 0,
          wholesalePrice: foundUnit.wholesalePrice || 0,
          photos: Array.isArray(photosParsed) ? photosParsed.slice(0, 6) : [],
          mainPhoto: Array.isArray(photosParsed) && photosParsed.length > 0 ? photosParsed[0] : null,
          tiktokUrl: foundUnit.tiktokUrl || null,
          status: foundUnit.status,
          warrantyDaysDefault: 30,
          functionalTestPassed: foundUnit.functionalTestPassed === 1,
        },
        company: DEFAULT_COMPANY_INFO,
        generatedAt: new Date().toISOString(),
      };
    }),

  // Eliminar una unidad (solo admin)
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo los administradores pueden eliminar unidades." });
      }

      const db = await getDb();

      if (!db) {
        // MOCK mode
        const idx = (MOCK_UNITS as any[]).findIndex((u: any) => u.id === input.id);
        if (idx === -1) throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });
        (MOCK_UNITS as any[]).splice(idx, 1);
        syncMocksToDisk();
        return { success: true };
      }

      const results = await db.select().from(units).where(eq(units.id, input.id)).limit(1);
      const unit = toPlainObject(results[0]);
      if (!unit) throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });

      // Registrar evento antes de eliminar
      try {
        await db.insert(unitEvents).values({
          unitId: input.id,
          eventType: "status_change",
          userId: ctx.user.id,
          notes: `Unidad eliminada por ${ctx.user.name || ctx.user.email || "admin"}`,
        });
      } catch (_) {}

      await db.delete(units).where(eq(units.id, input.id));

      return { success: true };
    }),

  // Eliminar múltiples unidades en lote (solo admin)
  deleteBatch: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo los administradores pueden eliminar unidades." });
      }

      const db = await getDb();

      if (!db) {
        // MOCK mode
        const idSet = new Set(input.ids);
        for (let i = MOCK_UNITS.length - 1; i >= 0; i--) {
          if (idSet.has((MOCK_UNITS as any[])[i].id)) {
            (MOCK_UNITS as any[]).splice(i, 1);
          }
        }
        syncMocksToDisk();
        return { success: true, count: input.ids.length };
      }

      try {
        for (const id of input.ids) {
          await db.insert(unitEvents).values({
            unitId: id,
            eventType: "status_change",
            userId: ctx.user.id,
            notes: `Unidad eliminada en lote por ${ctx.user.name || ctx.user.email || "admin"}`,
          });
        }
      } catch (_) {}

      await db.delete(units).where(inArray(units.id, input.ids));

      return { success: true, count: input.ids.length };
    }),
});
