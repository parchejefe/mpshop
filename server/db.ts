import { and, desc, eq, ne, sql, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import * as schema from "../drizzle/schema";
import { toPlainObject } from "./_core/serialize";
import {
  DEFAULT_DEVICE_BRANDS,
  DEFAULT_DEVICE_MODELS,
  DEFAULT_PROCESSORS,
  DEFAULT_RAM_OPTIONS,
  DEFAULT_SCREEN_SIZES,
  DEFAULT_STORAGE_OPTIONS,
} from "../shared/deviceCatalogDefaults";

function getInsertId(result: any): number {
  if (Array.isArray(result) && result.length > 0) {
    return Number(result[0].insertId) || 0;
  }
  return Number(result?.insertId) || 0;
}

function toOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric);
}

function toPositiveInteger(value: unknown): number | undefined {
  const numeric = toOptionalInteger(value);
  return numeric && numeric > 0 ? numeric : undefined;
}

function normalizePaymentMethod(value: unknown): "cash" | "qr" | "transfer" {
  return value === "qr" || value === "transfer" || value === "cash" ? value : "cash";
}

function buildFinancialTransactionRecord(data: any) {
  const type = data?.type;
  if (type !== "income" && type !== "expense") {
    throw new Error("Tipo de transacción financiera inválido");
  }

  const category = typeof data?.category === "string" ? data.category.trim() : "";
  if (!category) {
    throw new Error("Categoría de transacción financiera requerida");
  }

  const amount = toOptionalInteger(data?.amount);
  if (amount === undefined || amount <= 0) {
    throw new Error("Monto de transacción financiera inválido");
  }

  const record: any = {
    type,
    category,
    amount,
    paymentMethod: normalizePaymentMethod(data?.paymentMethod),
    branchId: toPositiveInteger(data?.branchId) || 1,
  };

  const userId = toPositiveInteger(data?.userId);
  if (userId !== undefined) record.userId = userId;

  const referenceId = toPositiveInteger(data?.referenceId);
  if (referenceId !== undefined) record.referenceId = referenceId;

  const unitCost = toOptionalInteger(data?.unitCost);
  if (unitCost !== undefined) record.unitCost = unitCost;

  if (data?.notes !== undefined && data.notes !== null) {
    const notes = String(data.notes).trim();
    if (notes) record.notes = notes;
  }

  if (data?.createdAt instanceof Date && !Number.isNaN(data.createdAt.getTime())) {
    record.createdAt = data.createdAt;
  }

  return record;
}

import {
  InsertUser,
  users,
  customers,
  branches,
  orders,
  orderItems,
  suppliers,
  purchases,
  purchaseItems,
  accountsPayable,
  accountsReceivable,
  creditPayments,
  deliveryExpenses,
  operationalExpenses,
  InsertOperationalExpense,
  financialTransactions,
  gpsTracking,
  sessions,
  cashClosures,
  cashOpenings,
  InsertCustomer,
  InsertOrder,
  InsertOrderItem,
  InsertGPSTracking,
  InsertCashClosure,
  InsertCashOpening,
  sales,
  saleItems,
  InsertSale,
  InsertSaleItem,
  auditLog,
  InsertAuditLog,
  quotations,
  quotationItems,
  InsertQuotation,
  InsertQuotationItem,
  units,
  unitEvents,
  InsertUnit,
  InsertUnitEvent,
  sellerCashRegisters,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { getSession } from "./auth";
import { getLocalDateKey, pad2, toValidDate } from "./_core/date_utils";

let _db: any = null;
let _pool: any = null;

const MOCK_DATA_FILE = path.join(process.cwd(), "server", "demo_data.json");

// Memoria para modo demo (persistente mientras el servidor corra)
export const MOCK_USERS: any[] = [
  { 
    id: 999, 
    username: "admin", 
    passwordHash: "", 
    name: "Administrador (Modo Demo)", 
    role: "admin", 
    status: "active",
    phone: "+591 70000000",
    openId: "demo_admin", 
    allowedModules: JSON.stringify(["sales","catalog","units","repairs","warranties","returns","orders","generate-codes","customers","suppliers","purchases","dashboard-kpis","reports","dashboard","analytics","analysis","finance","accounts-receivable","accounts-payable","expenses","branches","users","delivery-persons"]),
    specialPermissions: JSON.stringify({ canViewPurchaseCost: true, canApplyDiscounts: true, canViewFinancialReports: true, canManageInventory: true, canDeleteRecords: true }),
    assignedBranchIds: JSON.stringify(["all"]),
    createdAt: new Date(), 
    updatedAt: new Date(), 
    lastSignedIn: new Date(), 
    email: "admin@demo.com", 
    loginMethod: "traditional" 
  },
  { 
    id: 1000, 
    username: "admin_root", 
    passwordHash: "$2b$10$9Sg2Com1gCSFtFhWjxkBbuLzPA9ar0ucdiPLycgbOogdudS60Uwlu", 
    name: "Administrador Principal", 
    role: "admin", 
    status: "active",
    phone: "+591 71111111",
    openId: "admin_root", 
    allowedModules: JSON.stringify(["sales","catalog","units","repairs","warranties","returns","orders","generate-codes","customers","suppliers","purchases","dashboard-kpis","reports","dashboard","analytics","analysis","finance","accounts-receivable","accounts-payable","expenses","branches","users","delivery-persons"]),
    specialPermissions: JSON.stringify({ canViewPurchaseCost: true, canApplyDiscounts: true, canViewFinancialReports: true, canManageInventory: true, canDeleteRecords: true }),
    assignedBranchIds: JSON.stringify(["all"]),
    createdAt: new Date(), 
    updatedAt: new Date(), 
    lastSignedIn: new Date(), 
    email: "root@mpshop.com", 
    loginMethod: "traditional" 
  }
];
export const MOCK_CUSTOMERS: any[] = [];
export const MOCK_PRODUCTS: any[] = [];
export const MOCK_INVENTORY: any[] = [];
export const MOCK_ORDERS: any[] = [];
export const MOCK_ORDER_ITEMS: any[] = [];
export const MOCK_MOVEMENTS: any[] = [];
export const MOCK_PAYMENTS: any[] = [];
export const MOCK_SUPPLIERS: any[] = [];
export const MOCK_PURCHASES: any[] = [];
export const MOCK_PURCHASE_ITEMS: any[] = [];
export const MOCK_ACCOUNTS_PAYABLE: any[] = [];
export const MOCK_DELIVERY_EXPENSES: any[] = [];
export const MOCK_OPERATIONAL_EXPENSES: any[] = [
  { id: 1, category: "rent", amount: 50000, expenseDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), createdAt: new Date() },
  { id: 2, category: "labor", amount: 30000, expenseDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), createdAt: new Date() },
  { id: 3, category: "transport", amount: 15000, expenseDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), createdAt: new Date() },
  { id: 4, category: "repairs", amount: 8000, expenseDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), createdAt: new Date() },
  { id: 5, category: "marketing", amount: 12000, expenseDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), createdAt: new Date() },
  { id: 6, category: "services", amount: 5000, expenseDate: new Date(Date.now()), createdAt: new Date() },
];
export const MOCK_FINANCIAL_TRANSACTIONS: any[] = [];
export const MOCK_CASH_CLOSURES: any[] = [];
export const MOCK_CASH_OPENINGS: any[] = [];
export const MOCK_SALES: any[] = [
  { id: 1, saleNumber: "V-001", total: 150000, status: "completed", createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
  { id: 2, saleNumber: "V-002", total: 200000, status: "completed", createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
  { id: 3, saleNumber: "V-003", total: 180000, status: "completed", createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
  { id: 4, saleNumber: "V-004", total: 220000, status: "completed", createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
  { id: 5, saleNumber: "V-005", total: 170000, status: "completed", createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
  { id: 6, saleNumber: "V-006", total: 190000, status: "completed", createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
];
export const MOCK_SALE_ITEMS: any[] = [
  { id: 1, saleId: 1, unitId: 1, quantity: 1, finalUnitPrice: 150000, discountAmount: 0 },
  { id: 2, saleId: 2, unitId: 2, quantity: 1, finalUnitPrice: 200000, discountAmount: 0 },
  { id: 3, saleId: 3, unitId: 3, quantity: 1, finalUnitPrice: 180000, discountAmount: 0 },
  { id: 4, saleId: 4, unitId: 4, quantity: 1, finalUnitPrice: 220000, discountAmount: 0 },
  { id: 5, saleId: 5, unitId: 5, quantity: 1, finalUnitPrice: 170000, discountAmount: 0 },
  { id: 6, saleId: 6, unitId: 6, quantity: 1, finalUnitPrice: 190000, discountAmount: 0 },
];
export const MOCK_QUOTATIONS: any[] = [];
export const MOCK_QUOTATION_ITEMS: any[] = [];
export const MOCK_DELIVERY_EXTRA_LOAD: any[] = [];
export const MOCK_PRODUCTION_BATCHES: any[] = [];
export const MOCK_PRODUCTION_OUTPUTS: any[] = [];
export const MOCK_PRODUCTION_INPUTS: any[] = [];
export const MOCK_PRODUCTION_INVENTORY: any[] = [];
export const MOCK_INVENTORY_TRANSFERS: any[] = [];
export const MOCK_INVENTORY_TRANSFER_ITEMS: any[] = [];
export const MOCK_ACCOUNTS_RECEIVABLE: any[] = [];
export const MOCK_CREDIT_PAYMENTS: any[] = [];
export const MOCK_BRANCHES: any[] = [];
export const MOCK_UNITS: any[] = [
  { id: 1, code: "UNI-00001", type: "laptop", brand: "Dell", model: "Inspiron 15", condition: 7, status: "sold", purchasePrice: 120000, salePrice: 150000, createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
  { id: 2, code: "UNI-00002", type: "laptop", brand: "HP", model: "Pavilion 14", condition: 8, status: "sold", purchasePrice: 150000, salePrice: 200000, createdAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
  { id: 3, code: "UNI-00003", type: "celular", brand: "Samsung", model: "A12", condition: 6, status: "sold", purchasePrice: 130000, salePrice: 180000, createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
  { id: 4, code: "UNI-00004", type: "tablet", brand: "iPad", model: "Air", condition: 10, status: "sold", purchasePrice: 180000, salePrice: 220000, createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
  { id: 5, code: "UNI-00005", type: "laptop", brand: "Lenovo", model: "ThinkPad", condition: 7, status: "sold", purchasePrice: 140000, salePrice: 170000, createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
  { id: 6, code: "UNI-00006", type: "charger", brand: "Generic", model: "USB-C", condition: 10, status: "sold", purchasePrice: 40000, salePrice: 190000, createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
  { id: 7, code: "UNI-00007", type: "laptop", brand: "ASUS", model: "VivoBook", condition: 5, status: "available", purchasePrice: 100000, salePrice: 0, createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
  { id: 8, code: "UNI-00008", type: "celular", brand: "Xiaomi", model: "Redmi Note", condition: 6, status: "in_repair", purchasePrice: 80000, salePrice: 0, createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
];
export const MOCK_UNIT_EVENTS: any[] = [];
export const MOCK_REPAIRS: any[] = [
  { id: 1, unitId: 2, startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), endDate: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000), status: "completed", laborCost: 20000, partsCost: 30000 },
  { id: 2, unitId: 3, startDate: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), endDate: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000), status: "completed", laborCost: 15000, partsCost: 35000 },
  { id: 3, unitId: 8, startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), endDate: null, status: "in_progress", laborCost: 0, partsCost: 25000 },
];
export const MOCK_WARRANTIES: any[] = [];
export const MOCK_RETURNS: any[] = [];
export const MOCK_GENERATED_CODES: any[] = [];

// MOCK DATA para catálogos de dispositivos
export const MOCK_DEVICE_BRANDS: any[] = DEFAULT_DEVICE_BRANDS.map((name, index) => ({
  id: index + 1,
  name,
  createdAt: new Date(),
}));

const DEFAULT_DEVICE_BRAND_ID_BY_NAME = Object.fromEntries(
  MOCK_DEVICE_BRANDS.map((brand) => [String(brand.name).toLowerCase(), brand.id])
);

export const MOCK_DEVICE_MODELS: any[] = DEFAULT_DEVICE_MODELS.map((model, index) => ({
  id: index + 1,
  brandId: DEFAULT_DEVICE_BRAND_ID_BY_NAME[model.brand.toLowerCase()] || 1,
  name: model.name,
  defaultSpecs: JSON.stringify(model.defaultSpecs),
  createdAt: new Date(),
}));

export const MOCK_PROCESSORS: any[] = DEFAULT_PROCESSORS.map((processor, index) => ({
  id: index + 1,
  ...processor,
  createdAt: new Date(),
}));

export const MOCK_RAM_OPTIONS: any[] = DEFAULT_RAM_OPTIONS.map((option, index) => ({
  id: index + 1,
  ...option,
  createdAt: new Date(),
}));

export const MOCK_STORAGE_OPTIONS: any[] = DEFAULT_STORAGE_OPTIONS.map((option, index) => ({
  id: index + 1,
  ...option,
  createdAt: new Date(),
}));

export const MOCK_SCREEN_SIZES: any[] = DEFAULT_SCREEN_SIZES.map((option, index) => ({
  id: index + 1,
  ...option,
  createdAt: new Date(),
}));

export const MOCK_DEVICE_SPEC_OPTIONS: any[] = [];

function nextMockId(items: any[]) {
  const ids = items.map((item) => Number(item.id)).filter(Number.isFinite);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

function sameCatalogText(left: unknown, right: unknown) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function ensureDefaultDeviceCatalogMocks() {
  let changed = false;

  for (const name of DEFAULT_DEVICE_BRANDS) {
    if (!MOCK_DEVICE_BRANDS.some((brand) => sameCatalogText(brand.name, name))) {
      MOCK_DEVICE_BRANDS.push({ id: nextMockId(MOCK_DEVICE_BRANDS), name, createdAt: new Date() });
      changed = true;
    }
  }

  for (const model of DEFAULT_DEVICE_MODELS) {
    const brand = MOCK_DEVICE_BRANDS.find((entry) => sameCatalogText(entry.name, model.brand));
    if (!brand) continue;
    const exists = MOCK_DEVICE_MODELS.some(
      (entry) => Number(entry.brandId) === Number(brand.id) && sameCatalogText(entry.name, model.name)
    );
    if (!exists) {
      MOCK_DEVICE_MODELS.push({
        id: nextMockId(MOCK_DEVICE_MODELS),
        brandId: brand.id,
        name: model.name,
        defaultSpecs: JSON.stringify(model.defaultSpecs),
        createdAt: new Date(),
      });
      changed = true;
    }
  }

  for (const processor of DEFAULT_PROCESSORS) {
    if (!MOCK_PROCESSORS.some((entry) => sameCatalogText(entry.name, processor.name))) {
      MOCK_PROCESSORS.push({ id: nextMockId(MOCK_PROCESSORS), ...processor, createdAt: new Date() });
      changed = true;
    }
  }

  for (const option of DEFAULT_RAM_OPTIONS) {
    if (!MOCK_RAM_OPTIONS.some((entry) => sameCatalogText(entry.capacity, option.capacity))) {
      MOCK_RAM_OPTIONS.push({ id: nextMockId(MOCK_RAM_OPTIONS), ...option, createdAt: new Date() });
      changed = true;
    }
  }

  for (const option of DEFAULT_STORAGE_OPTIONS) {
    if (!MOCK_STORAGE_OPTIONS.some((entry) => sameCatalogText(entry.capacity, option.capacity))) {
      MOCK_STORAGE_OPTIONS.push({ id: nextMockId(MOCK_STORAGE_OPTIONS), ...option, createdAt: new Date() });
      changed = true;
    }
  }

  for (const option of DEFAULT_SCREEN_SIZES) {
    if (!MOCK_SCREEN_SIZES.some((entry) => sameCatalogText(entry.size, option.size))) {
      MOCK_SCREEN_SIZES.push({ id: nextMockId(MOCK_SCREEN_SIZES), ...option, createdAt: new Date() });
      changed = true;
    }
  }

  return changed;
}

// 🔴 CRÍTICO #3: Calcular COGS promedio para productos fungibles (accesorios, cargadores)
// Utiliza el método de promedio ponderado: suma de (purchasePrice * cantidad) / cantidad total
export async function calculateAverageCOGS(db: any, brand: string, model: string, type: string): Promise<number> {
  if (!db || !process.env.DATABASE_URL) {
    // Mock mode: calcular desde MOCK_UNITS
    const matchingUnits = MOCK_UNITS.filter((u: any) => 
      u.brand === brand && 
      u.model === model && 
      u.type === type &&
      u.purchasePrice > 0
    );
    
    if (matchingUnits.length === 0) return 0;
    
    const totalCost = matchingUnits.reduce((sum: number, u: any) => sum + u.purchasePrice, 0);
    return Math.round((totalCost / matchingUnits.length) * 100) / 100;
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

export function syncMocksToDisk() {
  if (process.env.DATABASE_URL) return;
  const data = {
    MOCK_CUSTOMERS,
    MOCK_USERS,
    MOCK_PRODUCTS,
    MOCK_INVENTORY,
    MOCK_ORDERS,
    MOCK_ORDER_ITEMS,
    MOCK_PAYMENTS,
    MOCK_MOVEMENTS,
    MOCK_SUPPLIERS,
    MOCK_PURCHASES,
    MOCK_PURCHASE_ITEMS,
    MOCK_ACCOUNTS_PAYABLE,
    MOCK_DELIVERY_EXPENSES,
    MOCK_OPERATIONAL_EXPENSES,
    MOCK_FINANCIAL_TRANSACTIONS,
    MOCK_CASH_CLOSURES,
    MOCK_CASH_OPENINGS,
    MOCK_SALES,
    MOCK_SALE_ITEMS,
    MOCK_QUOTATIONS,
    MOCK_QUOTATION_ITEMS,
    MOCK_DELIVERY_EXTRA_LOAD,
    MOCK_PRODUCTION_BATCHES,
    MOCK_PRODUCTION_OUTPUTS,
    MOCK_PRODUCTION_INPUTS,
    MOCK_PRODUCTION_INVENTORY,
    MOCK_INVENTORY_TRANSFERS,
    MOCK_INVENTORY_TRANSFER_ITEMS,
    MOCK_ACCOUNTS_RECEIVABLE,
    MOCK_CREDIT_PAYMENTS,
    MOCK_BRANCHES,
    MOCK_UNITS,
    MOCK_UNIT_EVENTS,
    MOCK_REPAIRS,
    MOCK_WARRANTIES,
    MOCK_RETURNS,
    MOCK_GENERATED_CODES,
    MOCK_DEVICE_BRANDS,
    MOCK_DEVICE_MODELS,
    MOCK_PROCESSORS,
    MOCK_RAM_OPTIONS,
    MOCK_STORAGE_OPTIONS,
    MOCK_SCREEN_SIZES,
    MOCK_DEVICE_SPEC_OPTIONS,
  };
  try {
    fs.writeFileSync(MOCK_DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to sync mocks to disk:", err);
  }
}

function loadMocks() {
  if (process.env.DATABASE_URL || !fs.existsSync(MOCK_DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(MOCK_DATA_FILE, "utf-8"));
    const arrays: Record<string, any[]> = {
      MOCK_CUSTOMERS, MOCK_USERS, MOCK_PRODUCTS, MOCK_INVENTORY,
      MOCK_ORDERS, MOCK_ORDER_ITEMS, MOCK_PAYMENTS, MOCK_MOVEMENTS,
      MOCK_SUPPLIERS, MOCK_PURCHASES, MOCK_PURCHASE_ITEMS,
      MOCK_ACCOUNTS_PAYABLE, MOCK_DELIVERY_EXPENSES,
      MOCK_OPERATIONAL_EXPENSES,
      MOCK_FINANCIAL_TRANSACTIONS, MOCK_CASH_CLOSURES,
      MOCK_CASH_OPENINGS, MOCK_SALES, MOCK_SALE_ITEMS,
      MOCK_QUOTATIONS, MOCK_QUOTATION_ITEMS,
      MOCK_DELIVERY_EXTRA_LOAD,
      MOCK_PRODUCTION_BATCHES, MOCK_PRODUCTION_OUTPUTS,
      MOCK_PRODUCTION_INPUTS, MOCK_PRODUCTION_INVENTORY,
      MOCK_INVENTORY_TRANSFERS, MOCK_INVENTORY_TRANSFER_ITEMS,
      MOCK_ACCOUNTS_RECEIVABLE, MOCK_CREDIT_PAYMENTS, MOCK_BRANCHES,
      MOCK_UNITS, MOCK_UNIT_EVENTS, MOCK_REPAIRS,
      MOCK_WARRANTIES, MOCK_RETURNS, MOCK_GENERATED_CODES,
      MOCK_DEVICE_BRANDS, MOCK_DEVICE_MODELS, MOCK_PROCESSORS,
      MOCK_RAM_OPTIONS, MOCK_STORAGE_OPTIONS, MOCK_SCREEN_SIZES,
      MOCK_DEVICE_SPEC_OPTIONS
    };
    for (const [key, arr] of Object.entries(arrays)) {
      if (data[key] && Array.isArray(data[key])) {
        arr.length = 0;
        arr.push(...data[key]);
      }
    }

    if (ensureDefaultDeviceCatalogMocks()) {
      syncMocksToDisk();
    }

    // Normalizar fechas de cierres antiguos (cuando venían guardados con fecha UTC por error)
    for (const closure of MOCK_CASH_CLOSURES as any[]) {
      const localDate = getLocalDateKey(closure.createdAt);
      if (localDate && closure.date && closure.date !== localDate) {
        closure.date = localDate;
      }
    }

    // Normalizar canal de origen en clientes/pedidos (cuando el campo aún no existía)
    for (const customer of MOCK_CUSTOMERS as any[]) {
      if (!customer.sourceChannel) customer.sourceChannel = "other";
    }
    for (const order of MOCK_ORDERS as any[]) {
      if (!order.sourceChannel) order.sourceChannel = "other";
    }

    // Normalizar items de cotización antiguos: usaban "productId" en lugar de "unitId"
    for (const qItem of MOCK_QUOTATION_ITEMS as any[]) {
      if (qItem.productId !== undefined && qItem.unitId === undefined) {
        qItem.unitId = qItem.productId;
        delete qItem.productId;
      }
    }

    // Normalizar items de venta antiguos: idem, "productId" -> "unitId"
    for (const sItem of MOCK_SALE_ITEMS as any[]) {
      if (sItem.productId !== undefined && sItem.unitId === undefined) {
        sItem.unitId = sItem.productId;
        delete sItem.productId;
      }
    }
    // Auto-heal: Asegurar que unidades con reparación activa 'in_progress' o 'pending' tengan status 'in_repair'
    const activeRepairs = (MOCK_REPAIRS as any[]).filter((r: any) => r.status === "in_progress" || r.status === "pending");
    for (const repair of activeRepairs) {
      if (repair.unitId) {
        const u = (MOCK_UNITS as any[]).find((unit: any) => unit.id === repair.unitId);
        if (u && u.status !== "in_repair") {
          console.log(`[Auto-Heal] Sincronizando unidad #${u.code || u.id} a status 'in_repair' por reparación activa #${repair.otNumber || repair.rmaNumber || repair.id}`);
          u.status = "in_repair";
        }
      }
    }

    console.log("[DB] Demo Mode: Data loaded from disk");
  } catch (err) {
    console.error("Failed to load mocks from disk:", err);
  }
}
loadMocks();

// Lazily create the drizzle instance so local tooling can run without a DB.
let _dbInitError: string | null = null;

export function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const fallback =
    process.env.MYSQL_URL?.trim() ||
    process.env.MYSQL_PRIVATE_URL?.trim() ||
    (process.env.MYSQLHOST && process.env.MYSQLUSER
      ? `mysql://${encodeURIComponent(process.env.MYSQLUSER)}:${encodeURIComponent(process.env.MYSQLPASSWORD || "")}@${process.env.MYSQLHOST}:${process.env.MYSQLPORT || 3306}/${process.env.MYSQLDATABASE || "railway"}`
      : undefined);

  if (fallback) {
    process.env.DATABASE_URL = fallback;
    console.log("[Database] DATABASE_URL resuelto automáticamente desde variables de Railway");
  }
  return process.env.DATABASE_URL;
}

export async function getDb() {
  const dbUrl = resolveDatabaseUrl();
  if (!_db && dbUrl) {
    try {
      if (!_pool) {
        _pool = mysql.createPool({
          uri: dbUrl,
          // Convert BigInt (LONGLONG) and Decimal to plain JS numbers
          // This prevents "Unable to transform response from server" errors in tRPC/superjson
          typeCast(field: any, next: () => any) {
            if (
              field.type === 'LONGLONG' ||
              field.type === 'LONG' ||
              field.type === 'INT24' ||
              field.type === 'SHORT' ||
              field.type === 'TINY'
            ) {
              const val = field.string();
              return val === null ? null : Number(val);
            }
            if (field.type === 'NEWDECIMAL') {
              const val = field.string();
              return val === null ? null : parseFloat(val);
            }
            return next();
          },
        });
        console.log("[Database] Pool created successfully");
      }
      _db = drizzle(_pool, { schema, mode: "default" });
      console.log("[Database] Drizzle instance initialized");
      
      // Asegurar que existan las nuevas tablas para los traspasos (PlanetScale)
      if (!(typeof (_pool as any).tablesEnsured !== 'undefined')) {
        (_pool as any).tablesEnsured = true;
        _pool.execute(`
          CREATE TABLE IF NOT EXISTS inventory_transfers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            transferNumber VARCHAR(50) NOT NULL UNIQUE,
            direction ENUM('to_production', 'to_general') NOT NULL,
            status ENUM('completed', 'cancelled') NOT NULL DEFAULT 'completed',
            userId INT NOT NULL,
            notes TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `).catch(console.error);
        
        _pool.execute(`
          CREATE TABLE IF NOT EXISTS inventory_transfer_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            transferId INT NOT NULL,
            productId INT NOT NULL,
            quantity INT NOT NULL,
            productName VARCHAR(255),
            productUnit VARCHAR(50),
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `).catch(console.error);
        
        // Agregar columna createdAt por si la tabla se creó con la versión anterior del código
        _pool.execute(`
          ALTER TABLE inventory_transfer_items ADD COLUMN createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        `).catch(() => {});
        
        // Migración: Agregar columna turnNumber a seller_cash_registers
        _pool.execute(`
          ALTER TABLE seller_cash_registers 
          ADD COLUMN turnNumber INT NOT NULL DEFAULT 1 AFTER date
        `).catch((err) => {
          // Ignorar si la columna ya existe
          if (!err.message.includes('Duplicate column name')) {
            console.error('[Migration] Error adding turnNumber:', err.message);
          }
        });
        
        // Migración: Agregar columnas differenceQr y differenceTransfer (CRÍTICO #1)
        _pool.execute(`
          ALTER TABLE seller_cash_registers 
          ADD COLUMN differenceQr INT NOT NULL DEFAULT 0 AFTER differenceCash
        `).catch((err) => {
          if (!err.message.includes('Duplicate column name')) {
            console.error('[Migration] Error adding differenceQr:', err.message);
          }
        });
        
        _pool.execute(`
          ALTER TABLE seller_cash_registers 
          ADD COLUMN differenceTransfer INT NOT NULL DEFAULT 0 AFTER differenceQr
        `).catch((err) => {
          if (!err.message.includes('Duplicate column name')) {
            console.error('[Migration] Error adding differenceTransfer:', err.message);
          }
        });
        
        // Actualizar diferencias históricas
        _pool.execute(`
          UPDATE seller_cash_registers 
          SET 
            differenceQr = reportedQr - salesQr,
            differenceTransfer = reportedTransfer - salesTransfer
          WHERE closingStatus IN ('pending', 'approved', 'rejected')
            AND (differenceQr = 0 OR differenceTransfer = 0)
        `).catch((err) => {
          console.log('[Migration] Historical differences updated (or skipped if already done)');
        });
        
        // 🟡 MEDIO #2: Agregar categorías nuevas al enum de operationalExpenses
        _pool.execute(`
          ALTER TABLE operationalExpenses 
          MODIFY COLUMN category ENUM(
            'facebook_ads','google_ads','electricity','water','internet','telephone',
            'rent','salaries','maintenance','supplies','taxes','insurance','bank_fees',
            'fuel','subsistence','logistics',
            'tiktok_ads','print_advertising','packaging','cleaning',
            'equipment_depreciation','loan_interest','commissions',
            'repair_cost','warranty_repair_cost','warranty_replacement_cost',
            'cogs','other'
          ) NOT NULL
        `).catch((err) => {
          if (!err.message.includes('Duplicate') && !err.message.includes('already exists')) {
            console.log('[Migration] operationalExpenses category enum updated (or already up to date)');
          }
        });

        // 🔴 CRÍTICO #4: Crear tabla kpi_snapshots para métricas agregadas
        _pool.execute(`
          CREATE TABLE IF NOT EXISTS kpi_snapshots (
            id INT AUTO_INCREMENT NOT NULL,
            date VARCHAR(10) NOT NULL COMMENT 'Fecha YYYY-MM-DD (UTC-4 Bolivia)',
            branchId INT NOT NULL DEFAULT 1,
            metricName VARCHAR(100) NOT NULL COMMENT 'Nombre de métrica (daily_revenue, etc.)',
            metricValue INT NOT NULL DEFAULT 0 COMMENT 'Valor en centavos o cantidad',
            metricMetadata TEXT COMMENT 'JSON opcional con desglose',
            createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_date_branch (date, branchId),
            KEY idx_metric_name (metricName),
            KEY idx_kpi_date_range (branchId, date, metricName),
            CONSTRAINT kpi_snapshots_branchId_fk FOREIGN KEY (branchId) REFERENCES branches(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
          COMMENT='Snapshots diarios de KPIs para dashboards rápidos'
        `).catch((err) => {
          if (!err.message.includes('already exists')) {
            console.error('[Migration] Error creating kpi_snapshots table:', err.message);
          }
        });
        
        _pool.execute(`
          CREATE TABLE IF NOT EXISTS kefir_storage (
            storage_key VARCHAR(100) PRIMARY KEY,
            storage_value LONGTEXT NOT NULL,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `).catch(console.error);
        
        _pool.execute(`
          CREATE TABLE IF NOT EXISTS kefir_movements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            productId VARCHAR(100) NOT NULL,
            productName VARCHAR(255) NOT NULL,
            category VARCHAR(50),
            previousQuantity FLOAT NOT NULL,
            newQuantity FLOAT NOT NULL,
            changeAmount FLOAT NOT NULL,
            reason VARCHAR(255),
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `).catch(console.error);

        _pool.execute(`
          CREATE TABLE IF NOT EXISTS production_inputs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            batchId INT NOT NULL,
            productId INT NOT NULL,
            quantity INT NOT NULL,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `).catch(console.error);

        _pool.execute(`
          CREATE TABLE IF NOT EXISTS production_inventory (
            id INT AUTO_INCREMENT PRIMARY KEY,
            productId INT NOT NULL,
            quantity INT NOT NULL DEFAULT 0,
            lastUpdated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
          )
        `).catch(console.error);
      }
    } catch (error) {
      _dbInitError = error instanceof Error ? error.message : String(error);
      console.error("[Database] Error in getDb:", _dbInitError);
      _db = null;
    }
  }
  return _db;
}

export function getDbInitError() {
  return _dbInitError;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  // openId es requerido solo para usuarios OAuth
  if (!user.openId && !user.username) {
    throw new Error("Either openId or username is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    // Si es un usuario tradicional (tiene username), actualizar por username
    if (user.username) {
      const result = await db.select().from(users).where(eq(users.username, user.username)).limit(1);

      if (result.length > 0) {
        // Usuario existe, actualizar
        const updateData: any = {};
        if (user.lastSignedIn !== undefined) updateData.lastSignedIn = user.lastSignedIn;
        if (user.name !== undefined) updateData.name = user.name;
        if (user.email !== undefined) updateData.email = user.email;
        if (user.role !== undefined) updateData.role = user.role;

        if (Object.keys(updateData).length > 0) {
          await db.update(users).set(updateData).where(eq(users.username, user.username));
        }
        return;
      }
    }

    // Para usuarios OAuth o nuevos usuarios tradicionales
    if (!user.openId) {
      user.openId = "";
    }

    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "username", "passwordHash"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) {
    return MOCK_USERS.find(u => u.username === username);
  }

  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createUser(data: any) {
  const db = await getDb();
  if (!db) {
    const newId = Math.floor(Math.random() * 1000) + 100;
    const newUser = { 
      status: "active",
      allowedModules: JSON.stringify(["sales","catalog","units","warranties","returns","orders","customers"]),
      specialPermissions: JSON.stringify({ canViewPurchaseCost: false, canApplyDiscounts: true, canViewFinancialReports: false, canManageInventory: false, canDeleteRecords: false }),
      assignedBranchIds: JSON.stringify(["all"]),
      ...data, 
      id: newId, 
      createdAt: new Date(), 
      updatedAt: new Date() 
    };
    MOCK_USERS.push(newUser);
    syncMocksToDisk();
    console.log("[DB] Demo Mode: User registered in memory", data.username);
    return { insertId: newId };
  }
  
  if (!data.openId) {
    data.openId = `local_${crypto.randomUUID()}`;
  }

  const result = await db.insert(users).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) {
    return MOCK_USERS;
  }
  const result = await db.select().from(users);
  return toPlainObject(result);
}

export async function updateUser(id: number, data: any) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_USERS.findIndex(u => u.id === id);
    if (index !== -1) {
      MOCK_USERS[index] = { ...MOCK_USERS[index], ...data, updatedAt: new Date() };
      syncMocksToDisk();
      console.log("[DB] Demo Mode: User updated in memory", id);
    }
    return;
  }
  
  await db.update(users).set(data).where(eq(users.id, id));
}

export async function deleteUser(id: number) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_USERS.findIndex(u => u.id === id);
    if (index !== -1) {
      MOCK_USERS.splice(index, 1);
      syncMocksToDisk();
      console.log("[DB] Demo Mode: User deleted from memory", id);
    }
    return;
  }
  
  await db.delete(users).where(eq(users.id, id));
}

export async function getUserById(id: number) {
  // Fallback para administrador predeterminado
  if (id === 999) {
    return {
      id: 999,
      username: "admin",
      name: "Administrador (Modo Demo)",
      role: "admin" as const,
      openId: "demo_admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      email: "admin@demo.com",
      loginMethod: "traditional"
    };
  }

  const db = await getDb();
  if (!db) {
    const user = MOCK_USERS.find(u => u.id === id);
    if (user) return user;
    console.warn("[Database] User not found in memory (Demo Mode):", id);
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function updateLastSignedInById(userId: number) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_USERS.findIndex(u => u.id === userId);
    if (index !== -1) {
      MOCK_USERS[index].lastSignedIn = new Date();
    }
    return;
  }

  try {
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
  } catch (error) {
    console.warn("[Database] Failed to update lastSignedIn:", error);
  }
}

// Clientes

export async function getCustomerByNumber(clientNumber: string) {
  const db = await getDb();
  if (!db) {
    return MOCK_CUSTOMERS.find(c => c.clientNumber === clientNumber) || null;
  }
  const result = await db.select().from(customers).where(eq(customers.clientNumber, clientNumber)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getCustomerById(customerId: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_CUSTOMERS.find((customer) => customer.id === customerId) || null;
  }
  const result = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllCustomers() {
  const db = await getDb();
  if (!db) return MOCK_CUSTOMERS;
  return await db.select().from(customers);
}

export async function searchCustomers(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const allCustomers = await getAllCustomers();
  return allCustomers
    .filter((customer: any) =>
      customer.clientNumber?.toLowerCase().includes(normalizedQuery) ||
      customer.name?.toLowerCase().includes(normalizedQuery) ||
      customer.phone?.toLowerCase().includes(normalizedQuery) ||
      customer.whatsapp?.toLowerCase().includes(normalizedQuery) ||
      customer.zone?.toLowerCase().includes(normalizedQuery)
    )
    .slice(0, 8);
}



export async function createCustomer(data: InsertCustomer) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_CUSTOMERS.length + 1;
    const newCustomer = { ...data, id: newId, createdAt: new Date() };
    MOCK_CUSTOMERS.push(newCustomer);
    return { insertId: newId };
  }
  
  const result = await db.insert(customers).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function updateCustomer(customerId: number, data: Partial<InsertCustomer>) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_CUSTOMERS.findIndex((customer) => customer.id === customerId);
    if (index !== -1) {
      MOCK_CUSTOMERS[index] = { ...MOCK_CUSTOMERS[index], ...data, updatedAt: new Date() };
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }

  await db.update(customers).set(data).where(eq(customers.id, customerId));
  return { success: true };
}

// =============================================
// UNIDADES (Units) - Reemplaza productos e inventario fungible
// =============================================
export async function getAllUnits(branchId?: number) {
  const db = await getDb();
  if (!db) {
    if (branchId) return (MOCK_UNITS as any[]).filter(u => u.branchId === branchId);
    return MOCK_UNITS;
  }
  if (branchId) {
    return await db.select().from(units).where(eq(units.branchId, branchId));
  }
  return await db.select().from(units);
}

export async function getUnitById(id: number) {
  const db = await getDb();
  if (!db) return MOCK_UNITS.find((u: any) => u.id === id);
  const result = await db.select().from(units).where(eq(units.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUnitByCode(code: string) {
  const db = await getDb();
  if (!db) return MOCK_UNITS.find((u: any) => u.code === code);
  const result = await db.select().from(units).where(eq(units.code, code)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createUnit(data: InsertUnit) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_UNITS.length + 1;
    const newUnit = { ...data, id: newId, createdAt: new Date(), updatedAt: new Date() };
    MOCK_UNITS.push(newUnit);
    syncMocksToDisk();
    return { insertId: newId };
  }
  const result = await db.insert(units).values(data);
  return { insertId: getInsertId(result) };
}

export async function updateUnit(id: number, data: Partial<InsertUnit>) {
  const db = await getDb();
  if (!db) {
    const idx = MOCK_UNITS.findIndex((u: any) => u.id === id);
    if (idx !== -1) {
      MOCK_UNITS[idx] = { ...MOCK_UNITS[idx], ...data, updatedAt: new Date() };
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }
  await db.update(units).set({ ...data, updatedAt: new Date() }).where(eq(units.id, id));
  return { success: true };
}

export async function deleteUnit(id: number) {
  const db = await getDb();
  if (!db) {
    const idx = MOCK_UNITS.findIndex((u: any) => u.id === id);
    if (idx !== -1) {
      MOCK_UNITS.splice(idx, 1);
      syncMocksToDisk();
    }
    return { success: true };
  }
  await db.delete(units).where(eq(units.id, id));
  return { success: true };
}

// Adaptadores de compatibilidad para Unidades (Reemplaza productos e inventario fungible)
export async function updateProductPrice(unitId: number, price: number) {
  const db = await getDb();
  if (!db) return { success: false };
  
  await db.update(units).set({ salePrice: price }).where(eq(units.id, unitId));
  return { success: true };
}

export async function updateProduct(unitId: number, data: any) {
  return updateUnit(unitId, data);
}

export async function getProductById(unitId: number) {
  const u = await getUnitById(unitId);
  if (!u) return undefined;
  return {
    ...u,
    name: `${u.brand} ${u.model}`,
    price: u.salePrice || u.purchasePrice || 0,
  };
}

export async function getAllProducts() {
  const allUnits = await getAllUnits();
  return allUnits.map((u: any) => ({
    ...u,
    name: `${u.brand} ${u.model}`,
    price: u.salePrice || u.purchasePrice || 0,
  }));
}

export async function createProduct(data: any) {
  const amountToCents = (value: any) => {
    const numeric = Number(value || 0);
    return numeric > 0 && numeric < 1000 ? Math.round(numeric * 100) : Math.round(numeric);
  };

  return createUnit({
    code: data.code,
    type: data.type || "accessory",
    brand: data.brand || data.supplierName || "General",
    model: data.model || data.name || data.code,
    specs: data.specs || JSON.stringify({
      legacyName: data.name,
      legacyCategory: data.category,
      unit: data.unit,
      presentationQuantity: data.presentationQuantity,
      presentationUnit: data.presentationUnit,
      productionRole: data.productionRole,
      storageLocation: data.storageLocation,
      productionNotes: data.productionNotes,
      imageUrl: data.imageUrl,
    }),
    condition: data.condition ?? 10,
    batteryHealth: data.batteryHealth || "n_a",
    damageChecklist: data.damageChecklist || JSON.stringify({}),
    damageNotes: data.damageNotes || null,
    functionalTestPassed: data.functionalTestPassed ?? 1,
    status: data.status === "inactive" ? "in_diagnosis" : (data.unitStatus || "available"),
    purchasePrice: amountToCents(data.purchasePrice ?? data.price),
    salePrice: amountToCents(data.salePrice ?? data.price),
    discountPrice: data.discountPrice ? amountToCents(data.discountPrice) : null,
    wholesalePrice: data.wholesalePrice ? amountToCents(data.wholesalePrice) : null,
    supplierId: data.supplierId || null,
    purchaseId: data.purchaseId || null,
    purchaseDate: data.purchaseDate || null,
    photos: data.photos || (data.imageUrl ? JSON.stringify([data.imageUrl]) : null),
    branchId: data.branchId || 1,
  } as any);
}

export async function getInventoryByProductId(unitId: number, branchId?: number) {
  const u = await getUnitById(unitId);
  if (!u) return undefined;
  return {
    id: u.id,
    productId: u.id,
    unitId: u.id,
    quantity: u.status === "available" ? 1 : 0,
    minStock: 1,
    product: {
      ...u,
      name: `${u.brand} ${u.model}`,
      price: u.salePrice || u.purchasePrice || 0,
    }
  };
}

export async function getAllInventory(branchId?: number) {
  const allUnits = await getAllUnits();
  return allUnits.map((u: any) => ({
    id: u.id,
    productId: u.id,
    unitId: u.id,
    quantity: u.status === "available" ? 1 : 0,
    minStock: 1,
    product: {
      ...u,
      name: `${u.brand} ${u.model}`,
      price: u.salePrice || u.purchasePrice || 0,
    }
  }));
}

export async function updateInventory(
  productId: number, 
  quantity: number, 
  expiryDate?: string | null, 
  batchNumber?: string | null,
  branchId?: number
) {
  return { success: true };
}

// Pedidos

export async function getOrderByNumber(orderNumber: string) {
  const db = await getDb();
  if (!db) return MOCK_ORDERS.find(o => o.orderNumber === orderNumber);
  const result = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllOrders(branchId?: number) {
  const db = await getDb();
  if (!db) {
    let list = MOCK_ORDERS;
    if (branchId) {
      list = list.filter((o: any) => (o.branchId || 1) === branchId);
    }
    return list.map(order => {
      const deliveryPerson = MOCK_USERS.find(u => u.id === order.deliveryPersonId);
      const customer = MOCK_CUSTOMERS.find(c => c.id === order.customerId);
      const adminName = order.deliveryPersonId === 999 ? "Administrador (Demo)" : null;
      return {
        ...order,
        deliveryPersonName: deliveryPerson?.name || adminName || null,
        customerPhone: customer?.phone || null,
        customerWhatsapp: customer?.whatsapp || null,
      };
    });
  }
  let query = db.select({
    ...orders,
    deliveryPersonName: users.name,
    customerPhone: customers.phone,
    customerWhatsapp: customers.whatsapp,
    customerNumber: customers.clientNumber,
  }).from(orders)
    .leftJoin(users, eq(orders.deliveryPersonId, users.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .$dynamic();
  if (branchId) {
    query = query.where(eq(orders.branchId, branchId));
  }
  return await query;
}

export async function getRepurchaseSuggestions() {
  const db = await getDb();
  let ordersData: any[];

  if (!db) {
    ordersData = [...MOCK_ORDERS].filter(o => o.status === "delivered");
    // Attach customer info for mock
    ordersData = ordersData.map(o => {
      const customer = MOCK_CUSTOMERS.find(c => c.id === o.customerId);
      return { ...o, customerPhone: customer?.phone, customerWhatsapp: customer?.whatsapp };
    });
  } else {
    ordersData = await db.select({
      id: orders.id,
      customerId: orders.customerId,
      createdAt: orders.createdAt,
      status: orders.status,
      customerPhone: customers.phone,
      customerWhatsapp: customers.whatsapp,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(orders.status, "delivered"));
  }

  // Sort by date desc
  ordersData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const customerMap: Map<number, any[]> = new Map();
  ordersData.forEach(o => {
    if (!customerMap.has(o.customerId)) customerMap.set(o.customerId, []);
    customerMap.get(o.customerId)!.push(o);
  });

  const suggestions: any[] = [];
  const now = new Date();

  for (const [customerId, customerOrders] of customerMap.entries()) {
    if (customerOrders.length < 2) continue;

    let totalDiff = 0;
    let count = 0;
    for (let i = 0; i < customerOrders.length - 1; i++) {
      const d1 = new Date(customerOrders[i].createdAt);
      const d2 = new Date(customerOrders[i+1].createdAt);
      const diff = (d1.getTime() - d2.getTime()) / (1000 * 3600 * 24);
      if (diff > 0.5) { // Evitar pedidos el mismo día
        totalDiff += diff;
        count++;
      }
    }
    
    if (count === 0) continue;
    const avgDays = totalDiff / count;
    
    const lastOrder = customerOrders[0];
    const lastOrderDate = new Date(lastOrder.createdAt);
    const daysSinceLast = (now.getTime() - lastOrderDate.getTime()) / (1000 * 3600 * 24);

    // Sugerir si estamos en la ventana de recompra (promedio +/- 2 días)
    if (daysSinceLast >= Math.max(3, avgDays - 2) && daysSinceLast <= avgDays + 4) {
      suggestions.push({
        customerId,
        customerName: lastOrder.customerName,
        customerPhone: lastOrder.customerPhone,
        customerWhatsapp: lastOrder.customerWhatsapp,
        avgDays: Math.round(avgDays),
        lastOrderDate: lastOrder.createdAt,
        daysSinceLast: Math.floor(daysSinceLast),
      });
    }
  }

  return suggestions.sort((a, b) => b.daysSinceLast - a.daysSinceLast);
}

export async function getOrdersByDeliveryPerson(userId: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_ORDERS.filter(o => o.deliveryPersonId === userId).map(order => {
      const deliveryPerson = MOCK_USERS.find(u => u.id === order.deliveryPersonId);
      const customer = MOCK_CUSTOMERS.find(c => c.id === order.customerId);
      return {
        ...order,
        deliveryPersonName: deliveryPerson?.name || null,
        customerPhone: customer?.phone || null,
        customerWhatsapp: customer?.whatsapp || null,
      };
    });
  }
  return await db.select({
    ...orders,
    deliveryPersonName: users.name,
    customerPhone: customers.phone,
    customerWhatsapp: customers.whatsapp,
    customerNumber: customers.clientNumber,
  }).from(orders)
    .leftJoin(users, eq(orders.deliveryPersonId, users.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(orders.deliveryPersonId, userId));
}


export async function deductInventoryForOrder(orderId: number, orderNumber: string, items: any[]) {
  const db = await getDb();
  if (!db) return;

  for (const item of items) {
    const uId = item.unitId || item.productId;
    if (!uId) continue;
    try {
      await db.update(units).set({ status: "sold" }).where(eq(units.id, uId));
      await db.insert(unitEvents).values({
        unitId: uId,
        eventType: "sold_order",
        fromStatus: "available",
        toStatus: "sold",
        notes: `Vendido via Pedido ${orderNumber}`,
      });
    } catch (_e) { /* ignorar si no existe */ }
  }
}

export async function restoreInventoryForOrder(orderId: number, orderNumber: string, items: any[]) {
  const db = await getDb();
  if (!db) return;

  for (const item of items) {
    const uId = item.unitId || item.productId;
    if (!uId) continue;
    try {
      await db.update(units).set({ status: "available" }).where(eq(units.id, uId));
      await db.insert(unitEvents).values({
        unitId: uId,
        eventType: "order_cancelled",
        fromStatus: "sold",
        toStatus: "available",
        notes: `Restablecido por cancelación de Pedido ${orderNumber}`,
      });
    } catch (_e) { /* ignorar si no existe */ }
  }
}

export async function createOrder(data: InsertOrder) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_ORDERS.length + 1;
    const newOrder = { ...data, id: newId, createdAt: new Date(), updatedAt: new Date(), deliveryPersonName: null };
    MOCK_ORDERS.push(newOrder);
    syncMocksToDisk();
    return { insertId: newId };
  }
  
  const result = await db.insert(orders).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function updateOrder(orderId: number, data: Partial<InsertOrder>) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_ORDERS.findIndex(o => o.id === orderId);
    if (index !== -1) {
      const oldStatus = MOCK_ORDERS[index].status;
      MOCK_ORDERS[index] = { ...MOCK_ORDERS[index], ...data, updatedAt: new Date() };

      // Si el estado cambia a delivered, registrar ingreso automático
      if (data.status === "delivered" && oldStatus !== "delivered") {
        MOCK_FINANCIAL_TRANSACTIONS.push({
          id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
          type: "income",
          category: "order_delivery",
          amount: MOCK_ORDERS[index].totalPrice,
          referenceId: orderId,
          notes: "Venta Pedido " + MOCK_ORDERS[index].orderNumber,
          paymentMethod: MOCK_ORDERS[index].paymentMethod || "cash",
          createdAt: new Date()
        });
      }
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }
  
  await db.update(orders).set(data).where(eq(orders.id, orderId));
  return { success: true };
}

// Repartidores
export async function getAllDeliveryPersons() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(users).where(eq(users.role, "user"));
}

export async function createDeliveryPerson(data: InsertUser) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_USERS.length + 1;
    const newUser = { ...data, id: newId, createdAt: new Date() };
    MOCK_USERS.push(newUser as any);
    return { insertId: newId };
  }
  
  const result = await db.insert(users).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function updateDeliveryPerson(userId: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) {
    const idx = MOCK_USERS.findIndex((u: any) => u.id === userId);
    if (idx !== -1) {
      MOCK_USERS[idx] = { ...MOCK_USERS[idx], ...data };
    }
    return { success: true };
  }
  
  await db.update(users).set(data).where(eq(users.id, userId));
  return { success: true };
}

export async function deleteDeliveryPerson(userId: number) {
  const db = await getDb();
  if (!db) {
    const idx = MOCK_USERS.findIndex((u: any) => u.id === userId);
    if (idx !== -1) {
      MOCK_USERS.splice(idx, 1);
    }
    return { success: true };
  }
  
  await db.delete(users).where(eq(users.id, userId));
  return { success: true };
}

export async function getOrderById(orderId: number) {
  const db = await getDb();
  if (!db) return MOCK_ORDERS.find(o => o.id === orderId);
  const result = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}


export async function completeOrderDelivery(orderId: number, method: "cash" | "qr" | "transfer") {
  const db = await getDb();
  if (!db) {
    // Modo demo: actualizar estado y movimiento de entrega en mock
    const order = MOCK_ORDERS.find(o => o.id === orderId);
    if (order && order.status !== "delivered") {
      order.status = "delivered";
      order.paymentStatus = "completed";
      order.paymentMethod = method;
      order.deliveredAt = new Date();
      order.updatedAt = new Date();

      // Registrar movimiento de entrega (stock ya descontado al crear pedido)
      const items = MOCK_ORDER_ITEMS.filter(item => item.orderId === orderId);
      for (const item of items) {
        MOCK_MOVEMENTS.push({
          id: MOCK_MOVEMENTS.length + 1,
          productId: item.productId,
          type: "exit",
          quantity: item.quantity,
          reason: `Entrega Pedido ${order.orderNumber}`,
          orderId: orderId,
          createdAt: new Date()
        });
      }

      // Registrar transacción financiera inmediata
      MOCK_FINANCIAL_TRANSACTIONS.push({
        id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
        type: "income",
        category: "order_delivery",
        amount: order.totalPrice,
        referenceId: orderId,
        userId: order.deliveryPersonId,
        notes: `Entrega Pedido ${order.orderNumber}`,
        paymentMethod: method,
        createdAt: new Date()
      });
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }

  // Real DB Transaction
  return await db.transaction(async (tx: any) => {
    const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = orderRows[0];
    if (!order || order.status === "delivered") return { success: false };

    // Validar que la caja esté abierta para el método de pago seleccionado ANTES de cualquier cambio
    const today = getLocalDateKey(new Date());
    if (today && order.deliveryPersonId) {
      await checkCashRegisterOpening(tx, order.deliveryPersonId, method, today);
    }

    await tx.update(orders).set({
      status: "delivered",
      paymentStatus: "completed",
      paymentMethod: method,
      deliveredAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId));

    // Actualizar estado de las unidades del pedido a vendidas
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      await tx.update(units).set({ status: "sold", updatedAt: new Date() }).where(eq(units.id, item.unitId));
    }

    await tx.insert(financialTransactions).values({
      type: "income",
      category: "order_delivery",
      amount: order.totalPrice,
      referenceId: orderId,
      userId: order.deliveryPersonId,
      notes: `Entrega Pedido ${order.orderNumber}`,
      paymentMethod: method,
      createdAt: new Date()
    });
    return { success: true };
  });
}


// Items de Pedidos

export async function createOrderItem(data: InsertOrderItem) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_ORDER_ITEMS.length + 1;
    MOCK_ORDER_ITEMS.push({ ...data, id: newId });
    syncMocksToDisk();
    return { insertId: newId };
  }

  const payload: any = { ...data };
  if (!payload.productId && payload.unitId) {
    payload.productId = payload.unitId;
  }
  if (!payload.unitId && payload.productId) {
    payload.unitId = payload.productId;
  }

  try {
    const result = await db.insert(orderItems).values(payload);
    return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
  } catch (err: any) {
    // If unitId or productId column differences occur, try targeted insertion
    if (err?.message?.includes("Unknown column 'unitId'") || err?.sqlMessage?.includes("Unknown column 'unitId'")) {
      const fallback = {
        orderId: payload.orderId,
        productId: payload.productId || payload.unitId,
        pricingType: payload.pricingType || "unit",
        quantity: payload.quantity || 1,
        price: payload.price,
      };
      const result = await db.insert(orderItems).values(fallback as any);
      return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
    }
    if (err?.message?.includes("productId") || err?.sqlMessage?.includes("productId")) {
      const fallback = {
        orderId: payload.orderId,
        unitId: payload.unitId || payload.productId,
        pricingType: payload.pricingType || "unit",
        quantity: payload.quantity || 1,
        price: payload.price,
      };
      const result = await db.insert(orderItems).values(fallback as any);
      return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
    }
    throw err;
  }
}

export async function deleteOrderItems(orderId: number) {
  const db = await getDb();
  if (!db) {
    const originalLength = MOCK_ORDER_ITEMS.length;
    // Filtrar items que NO pertenezcan a este pedido
    const filtered = MOCK_ORDER_ITEMS.filter(item => item.orderId !== orderId);
    MOCK_ORDER_ITEMS.length = 0;
    MOCK_ORDER_ITEMS.push(...filtered);
    syncMocksToDisk();
    return { success: true };
  }
  
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  return { success: true };
}
// Pagos (OBSOLETO - tabla eliminada)
export async function createPayment(data: any) {
  return { id: 1, ...data };
}

export async function updatePayment(paymentId: number, data: any) {
  return;
}

// Rastreo GPS
export async function createGPSTracking(data: InsertGPSTracking) {
  const db = await getDb();
  if (!db) return { insertId: Date.now() };
  
  const result = await db.insert(gpsTracking).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function getLatestGPSTracking(orderId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(gpsTracking).where(eq(gpsTracking.orderId, orderId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getGPSTrackingHistory(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(gpsTracking).where(eq(gpsTracking.orderId, orderId));
}

// Eventos/Movimientos de Unidades
export async function createInventoryMovement(data: any) {
  return;
}

export async function getInventoryMovements(unitId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select({
    id: unitEvents.id,
    unitId: unitEvents.unitId,
    eventType: unitEvents.eventType,
    fromStatus: unitEvents.fromStatus,
    toStatus: unitEvents.toStatus,
    notes: unitEvents.notes,
    createdAt: unitEvents.createdAt,
    userName: users.name,
  })
    .from(unitEvents)
    .leftJoin(users, eq(unitEvents.userId, users.id))
    .where(eq(unitEvents.unitId, unitId));
}

export async function getOrderItems(orderId: number) {
  const db = await getDb();

  if (!db) {
    const items = MOCK_ORDER_ITEMS.filter(item => item.orderId === orderId);
    return items.map(item => {
      const unit = MOCK_UNITS.find(u => u.id === item.unitId);
      return {
        ...item,
        productName: unit ? `${unit.brand} ${unit.model}` : "Unidad #" + item.unitId,
        productCode: unit ? unit.code : ""
      };
    });
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const itemsWithProductNames = await Promise.all(
    items.map(async (item: any) => {
      const unitResult = await db
        .select({ brand: units.brand, model: units.model, code: units.code })
        .from(units)
        .where(eq(units.id, item.unitId))
        .limit(1);
      return {
        ...item,
        productName: unitResult.length > 0 ? `${unitResult[0].brand} ${unitResult[0].model}` : "Unidad #" + item.unitId,
        productCode: unitResult.length > 0 ? unitResult[0].code : "",
      };
    })
  );

  return itemsWithProductNames;
}

export async function getPaymentByOrderId(orderId: number) {
  return undefined;
}

// --- MÓDULO FINANCIERO Y COMPRAS (DEMO MODE) ---

// Proveedores y Compras

// Proveedores
export async function getAllSuppliers() {
  const db = await getDb();
  if (!db) return MOCK_SUPPLIERS;
  return await db.select().from(suppliers);
}

export async function createSupplier(data: any) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_SUPPLIERS.length + 1;
    const newSupplier = { ...data, id: newId, createdAt: new Date(), updatedAt: new Date() };
    MOCK_SUPPLIERS.push(newSupplier);
    syncMocksToDisk();
    return { insertId: newId };
  }
  
  const result = await db.insert(suppliers).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function getPurchaseById(id: number) {
  const db = await getDb();
  if (!db) {
    const purchase = MOCK_PURCHASES.find(p => p.id === id);
    if (purchase) {
      const supplier = MOCK_SUPPLIERS.find(s => s.id === purchase.supplierId);
      return { ...purchase, supplierName: supplier?.name || "Proveedor Desconocido" };
    }
    return null;
  }
  const result = await db.select({
    ...purchases,
    supplierName: suppliers.name,
  }).from(purchases).leftJoin(suppliers, eq(purchases.supplierId, suppliers.id)).where(eq(purchases.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// Compras
export async function getAllPurchases(branchId?: number) {
  const db = await getDb();
  if (!db) {
    let list = MOCK_PURCHASES;
    if (branchId) {
      list = list.filter((p: any) => (p.branchId || 1) === branchId);
    }
    return list.map(p => {
      const supplier = MOCK_SUPPLIERS.find(s => s.id === p.supplierId);
      return { ...p, supplierName: supplier?.name || "Proveedor Desconocido" };
    });
  }
  let query = db.select({
    ...purchases,
    supplierName: suppliers.name,
  }).from(purchases).leftJoin(suppliers, eq(purchases.supplierId, suppliers.id)).$dynamic();

  if (branchId) {
    query = query.where(eq(purchases.branchId, branchId));
  }
  return await query;
}

export async function getPurchaseItems(purchaseId: number) {
  const db = await getDb();
  if (!db) {
    const items = MOCK_PURCHASE_ITEMS.filter((i: any) => i.purchaseId === purchaseId);
    return items.map((item: any) => {
      const uId = item.unitId || item.productId;
      const unit = MOCK_PRODUCTS.find(p => p.id === uId); // usando mock products como fallback
      return {
        ...item,
        unitId: uId,
        productName: unit ? `${unit.brand || ""} ${unit.model || ""}`.trim() : "Unidad #" + uId,
        productCode: unit?.code || ""
      };
    });
  }

  const result = await db.select({
    id: purchaseItems.id,
    purchaseId: purchaseItems.purchaseId,
    unitId: purchaseItems.unitId,
    quantity: purchaseItems.quantity,
    price: purchaseItems.price,
    createdAt: purchaseItems.createdAt,
    productName: sql<string>`concat(${units.brand}, ' ', ${units.model})`,
    productCode: units.code,
  })
    .from(purchaseItems)
    .leftJoin(units, eq(purchaseItems.unitId, units.id))
    .where(eq(purchaseItems.purchaseId, purchaseId));

  return result;
}

export async function getPurchasesByProductId(unitId: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_PURCHASE_ITEMS
      .filter((item: any) => (item.unitId || item.productId) === unitId)
      .map((item: any) => {
        const purchase = MOCK_PURCHASES.find((entry: any) => entry.id === item.purchaseId);
        const supplier = MOCK_SUPPLIERS.find((entry: any) => entry.id === purchase?.supplierId);

        return {
          ...item,
          purchaseNumber: purchase?.purchaseNumber || `COMPRA-${item.purchaseId}`,
          purchaseStatus: purchase?.status || "pending",
          supplierName: supplier?.name || "Proveedor desconocido",
          orderDate: purchase?.orderDate || purchase?.createdAt || item.createdAt,
          purchaseCreatedAt: purchase?.createdAt || item.createdAt,
        };
      });
  }

  return await db
    .select({
      id: purchaseItems.id,
      purchaseId: purchaseItems.purchaseId,
      unitId: purchaseItems.unitId,
      quantity: purchaseItems.quantity,
      price: purchaseItems.price,
      createdAt: purchaseItems.createdAt,
      purchaseNumber: purchases.purchaseNumber,
      purchaseStatus: purchases.status,
      orderDate: purchases.orderDate,
      purchaseCreatedAt: purchases.createdAt,
      supplierName: suppliers.name,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(eq(purchaseItems.unitId, unitId));
}

export async function createPurchase(purchaseData: any, items: any[], userId?: number) {
  const db = await getDb();
  if (!db) {
    const purchaseId = MOCK_PURCHASES.length + 1;
    const newPurchase = {
      ...purchaseData,
      id: purchaseId,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: purchaseData.status || "pending"
    };
    MOCK_PURCHASES.push(newPurchase);

    // Agregar items
    for (const item of items) {
      MOCK_PURCHASE_ITEMS.push({
        ...item,
        id: MOCK_PURCHASE_ITEMS.length + 1,
        purchaseId,
        createdAt: new Date()
      });
    }

    // Si es a crédito, crear cuenta por pagar automáticamente
    if (newPurchase.isCredit === 1) {
      let dueDateObj: Date;
      if (purchaseData.dueDate) {
        dueDateObj = new Date(purchaseData.dueDate + "T00:00:00");
      } else {
        dueDateObj = new Date();
        dueDateObj.setDate(dueDateObj.getDate() + 30);
      }
      const supplier = MOCK_SUPPLIERS.find((s: any) => s.id === newPurchase.supplierId);
      MOCK_ACCOUNTS_PAYABLE.push({
        id: MOCK_ACCOUNTS_PAYABLE.length + 1,
        purchaseId,
        supplierId: newPurchase.supplierId || null,
        supplierName: supplier?.name || "Sin Proveedor",
        purchaseNumber: newPurchase.purchaseNumber,
        totalAmount: newPurchase.totalAmount,
        paidAmount: 0,
        balance: newPurchase.totalAmount,
        dueDate: dueDateObj.toISOString(),
        status: "unpaid",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Si se recibe inmediatamente, procesar stock
    if (newPurchase.status === "received") {
      await processPurchaseImpact(purchaseId, items, newPurchase);
    }
    syncMocksToDisk();
    return { insertId: purchaseId };
  }


  // Real DB logic
  return await db.transaction(async (tx: any) => {
    // 0. Validar que la caja esté abierta para el método de pago seleccionado cuando no es a crédito
    if (purchaseData.isCredit !== 1 && purchaseData.paymentMethod && purchaseData.paymentMethod !== "credit") {
      const today = getLocalDateKey(new Date());
      if (today && userId) {
        await checkCashRegisterOpening(tx, userId, purchaseData.paymentMethod, today);
      }
    }

    // 1. Asegurar que haya un supplierId (campo obligatorio)
    let finalSupplierId = purchaseData.supplierId;
    if (!finalSupplierId) {
      const supplierName = "Compra Rapida (Sistema)";
      console.log(`[DB] No supplierId provided, looking for/creating: ${supplierName}`);
      const supplierRows = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.name, supplierName))
        .limit(1);
      
      finalSupplierId = supplierRows[0]?.id;
      
      if (!finalSupplierId) {
        console.log(`[DB] Creating default supplier: ${supplierName}`);
        const created = await tx.insert(suppliers).values({ name: supplierName });
        finalSupplierId = getInsertId(created);
      }
    }
    console.log(`[DB] Using supplierId: ${finalSupplierId}`);

    // 2. Insertar la compra
    const purchaseToInsert = {
      ...purchaseData,
      supplierId: finalSupplierId,
      orderDate: purchaseData.orderDate ? new Date(purchaseData.orderDate) : new Date(),
    };

    console.log(`[DB] Inserting purchase ${purchaseToInsert.purchaseNumber}...`);
    const result = await tx.insert(purchases).values(purchaseToInsert);
    const id = getInsertId(result);
    console.log(`[DB] Purchase inserted with ID: ${id}`);

    // 3. Insertar items de compra
    // En el modelo de electrónica, cada unidad (laptop/accesorio) se crea directamente
    // en la tabla `units` con su purchaseId. El purchaseItems sólo referencia unitId.
    for (const item of items) {
      const { productName, ...cleanItem } = item;
      await tx.insert(purchaseItems).values({ ...cleanItem, purchaseId: id });
    }

    // 4. Si es a crédito, registrar automáticamente en Cuentas por Pagar (accountsPayable)
    if (purchaseData.isCredit === 1) {
      let dueDateStr: string;
      if (purchaseData.dueDate) {
        dueDateStr = typeof purchaseData.dueDate === "string" ? purchaseData.dueDate.split("T")[0] : (getLocalDateKey(new Date(purchaseData.dueDate)) || new Date(purchaseData.dueDate).toISOString().split("T")[0]);
      } else {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        dueDateStr = getLocalDateKey(d) || d.toISOString().split("T")[0];
      }

      await tx.insert(accountsPayable).values({
        purchaseId: id,
        supplierId: finalSupplierId,
        totalAmount: purchaseData.totalAmount,
        paidAmount: 0,
        balance: purchaseData.totalAmount,
        dueDate: dueDateStr,
        status: "unpaid",
      });
    } else if (purchaseData.paymentMethod) {
      // Registrar transacción financiera en Caja (Gasto) sólo cuando NO es a crédito
      await tx.insert(financialTransactions).values({
        type: "expense",
        category: "purchase",
        amount: purchaseData.totalAmount,
        paymentMethod: purchaseData.paymentMethod || "cash",
        referenceId: id,
        userId: userId,
        branchId: purchaseData.branchId || null,
        notes: `Compra ${purchaseData.purchaseNumber}`,
      });
    }

    return result;
  });
}

export async function updatePurchase(purchaseId: number, purchaseData: any, items: any[], userId?: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Update not supported in mock mode");
  }

  return await db.transaction(async (tx: any) => {
    // 0. Fetch existing purchase and items
    const existingPurchases = await tx.select().from(purchases).where(eq(purchases.id, purchaseId));
    if (existingPurchases.length === 0) throw new Error("Purchase not found");
    const existingPurchase = existingPurchases[0];

    const oldItems = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, purchaseId));

    // 1. (No stock revert needed - units are tracked individually)

    // 2. Revert Financial Transaction
    await tx.delete(financialTransactions).where(
      and(
        eq(financialTransactions.referenceId, purchaseId),
        eq(financialTransactions.category, "purchase")
      )
    );

    // 3. Delete old items
    await tx.delete(purchaseItems).where(eq(purchaseItems.purchaseId, purchaseId));

    // 4. Validate or Create Supplier
    let finalSupplierId = purchaseData.supplierId;
    if (!finalSupplierId) {
      const supplierName = "Compra Rapida (Sistema)";
      const supplierRows = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, supplierName)).limit(1);
      finalSupplierId = supplierRows[0]?.id;
      if (!finalSupplierId) {
        const created = await tx.insert(suppliers).values({ name: supplierName });
        finalSupplierId = getInsertId(created);
      }
    }

    // 5. Update the purchase
    await tx.update(purchases).set({
      ...purchaseData,
      supplierId: finalSupplierId,
      orderDate: purchaseData.orderDate ? new Date(purchaseData.orderDate) : new Date(),
    }).where(eq(purchases.id, purchaseId));

    // 6. Insert new items (units referenced from purchaseItems)
    for (const item of items) {
      const { productName, id: _id, purchaseId: pid, createdAt, ...cleanItem } = item;
      await tx.insert(purchaseItems).values({ ...cleanItem, purchaseId: purchaseId });
    }

    // 7. Apply new Financial Transaction
    const shouldRegisterTransaction = purchaseData.isCredit === 0 && purchaseData.paymentMethod;
    if (shouldRegisterTransaction) {
      await tx.insert(financialTransactions).values({
        type: "expense",
        category: "purchase",
        amount: purchaseData.totalAmount,
        paymentMethod: purchaseData.paymentMethod || "cash",
        referenceId: purchaseId,
        userId: userId,
        branchId: purchaseData.branchId || null,
        notes: `Compra ${purchaseData.purchaseNumber} (Editada)`,
        createdAt: new Date()
      });
    }

    return { success: true };
  });
}

// Función interna para procesar impacto de compra (Inventario + Finanzas)
async function processPurchaseImpact(purchaseId: number, items: any[], purchase: any) {
  // 1. Actualizar Stock
  for (const item of items) {
    const productId = Number(item.productId);
    const qtyToAdd = Number(item.quantity);
    const currentInv = MOCK_INVENTORY.find(i => Number(i.productId) === productId);
    if (currentInv) {
      currentInv.quantity += qtyToAdd;
      if (item.expiryDate) currentInv.expiryDate = item.expiryDate;
      currentInv.lastUpdated = new Date();
    } else {
      MOCK_INVENTORY.push({
        id: MOCK_INVENTORY.length + 1,
        productId: item.productId,
        quantity: qtyToAdd,
        minStock: 10,
        expiryDate: item.expiryDate || null,
        lastUpdated: new Date()
      });
    }
  }

  // 2. Transacción Financiera
  MOCK_FINANCIAL_TRANSACTIONS.push({
    id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
    type: "expense",
    category: "purchase",
    amount: purchase.totalAmount,
    referenceId: purchaseId,
    notes: "Compra " + (purchase.purchaseNumber || ""),
    paymentMethod: purchase.paymentMethod || "cash",
    createdAt: new Date()
  });

  // 3. Cuentas por Pagar (si es crédito)
  if (purchase.isCredit) {
    MOCK_ACCOUNTS_PAYABLE.push({
      id: MOCK_ACCOUNTS_PAYABLE.length + 1,
      purchaseId,
      supplierId: purchase.supplierId || null,
      purchaseNumber: purchase.purchaseNumber || `CMP-${purchaseId}`,
      totalAmount: purchase.totalAmount,
      paidAmount: 0,
      balance: purchase.totalAmount,
      status: "unpaid",
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }
  syncMocksToDisk();
}

// Función para registrar una entrada de inventario como una compra financiera
export async function recordInventoryEntryAsPurchase(
  productId: number,
  quantity: number,
  price: number,
  expiryDate?: string | null,
  batchNumber?: string | null,
  reason?: string,
  paymentMethod?: "cash" | "qr" | "transfer",
  userId?: number
) {
  const db = await getDb();
  const method = paymentMethod || "cash";
  if (!db) {
    // Proveedor genÃ©rico para compras rÃ¡pidas (mejor lectura en UI)
    const supplierName = "Compra rÃ¡pida (sistema)";
    let supplier = (MOCK_SUPPLIERS as any[]).find((s: any) => s?.name === supplierName);
    if (!supplier) {
      supplier = {
        id: (MOCK_SUPPLIERS as any[]).length + 1,
        name: supplierName,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (MOCK_SUPPLIERS as any[]).push(supplier);
    }

    const purchaseId = MOCK_PURCHASES.length + 1;
    const purchaseNumber = `COMPRA-INV-${purchaseId}`;
    const newPurchase = {
      id: purchaseId,
      purchaseNumber,
      supplierId: supplier.id,
      orderDate: new Date(),
      totalAmount: quantity * price,
      status: "received",
      paymentStatus: "paid",
      paymentMethod: method,
      isCredit: 0,
      notes: (reason || "Entrada manual de inventario") + " (Auto-registrado)",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    MOCK_PURCHASES.push(newPurchase);
    MOCK_PURCHASE_ITEMS.push({
      id: MOCK_PURCHASE_ITEMS.length + 1,
      purchaseId,
      productId,
      quantity,
      price,
      batchNumber: batchNumber || null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      createdAt: new Date()
    });

    MOCK_FINANCIAL_TRANSACTIONS.push({
      id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
      type: "expense",
      category: "purchase",
      amount: quantity * price,
      referenceId: purchaseId,
      notes: `Compra Inventario ${purchaseNumber}`,
      paymentMethod: method,
      userId,
      createdAt: new Date()
    });

    syncMocksToDisk();
    return { insertId: purchaseId };
  }

  // Real DB: crear registro de compra + item + transacciÃ³n financiera (sin reimpactar stock)
  return await db.transaction(async (tx: any) => {
    const supplierName = "Compra rÃ¡pida (sistema)";
    const supplierRows = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.name, supplierName))
      .limit(1);
    let supplierId = supplierRows[0]?.id as number | undefined;

    if (!supplierId) {
      const created = await tx.insert(suppliers).values({ name: supplierName });
      supplierId = getInsertId(created);
    }

    const purchaseNumber = `COMPRA-INV-${Date.now()}`;
    const totalAmount = quantity * price;

    const purchaseInsert = await tx.insert(purchases).values({
      supplierId,
      purchaseNumber,
      orderDate: new Date(),
      totalAmount,
      status: "received",
      paymentStatus: "paid",
      paymentMethod: method,
      isCredit: 0,
    });

    const purchaseId = getInsertId(purchaseInsert);

    await tx.insert(purchaseItems).values({
      purchaseId,
      productId,
      quantity,
      price,
      batchNumber: batchNumber || null,
      expiryDate: expiryDate || null,
    });

    await tx.insert(financialTransactions).values({
      type: "expense",
      category: "purchase",
      amount: totalAmount,
      paymentMethod: method,
      userId: userId ?? null,
      referenceId: purchaseId,
      notes: `Compra Inventario ${purchaseNumber}`,
      createdAt: new Date(),
    });

    return { insertId: purchaseId };
  });
}

// Finanzas y Gastos
export async function createFinancialTransaction(data: any) {
  const db = await getDb();
  const record = buildFinancialTransactionRecord(data);
  if (!db) {
    const newId = MOCK_FINANCIAL_TRANSACTIONS.length + 1;
    MOCK_FINANCIAL_TRANSACTIONS.push({ ...record, id: newId, createdAt: record.createdAt || new Date() });
    syncMocksToDisk();
    return { insertId: newId };
  }

  return await db.transaction(async (tx: any) => {
    // Validar que la caja esté abierta para el método de pago seleccionado
    if (record.userId && record.paymentMethod) {
      const today = getLocalDateKey(new Date());
      if (today) {
        await checkCashRegisterOpening(tx, record.userId, record.paymentMethod, today);
      }
    }

    const result = await tx.insert(financialTransactions).values(record);
    return result;
  });
}

/**
 * Registra una transacción de costo interno (COGS, costo de reparación, costo de garantía).
 * NO valida apertura de caja porque estos son costos contables/internos que afectan
 * el P&L pero no necesariamente salen de una caja en ese instante.
 * Para costos que sí salen de caja (ej: pago a técnico), usar createFinancialTransaction normal.
 */
export async function createCostTransaction(data: {
  category: "cogs" | "repair_cost" | "warranty_repair_cost" | "warranty_replacement_cost";
  amount: number;
  unitCost?: number;
  paymentMethod?: "cash" | "qr" | "transfer";
  userId?: number;
  branchId?: number;
  referenceId?: number;
  notes?: string;
}) {
  const db = await getDb();
  const record = {
    type: "expense" as const,
    category: data.category,
    amount: data.amount,
    unitCost: data.unitCost,
    paymentMethod: data.paymentMethod || "cash",
    userId: data.userId,
    branchId: data.branchId || 1,
    referenceId: data.referenceId,
    notes: data.notes,
  };

  if (!db) {
    const newId = MOCK_FINANCIAL_TRANSACTIONS.length + 1;
    MOCK_FINANCIAL_TRANSACTIONS.push({ ...record, id: newId, createdAt: new Date() });
    syncMocksToDisk();
    return { insertId: newId };
  }

  const result = await db.insert(financialTransactions).values(record);
  return result;
}

/**
 * Registra un gasto operativo automático (creado por el sistema, no por el usuario).
 * Usado cuando se completa una reparación o se procesa una garantía.
 * Si el pago es inmediato (paid) Y la categoría NO es "cogs", también crea la
 * transacción financiera correspondiente.
 *
 * IMPORTANTE: "cogs" NO genera transacción financiera adicional porque el egreso
 * de caja ya fue registrado como "purchase" al momento de la compra.
 * Registrarlo de nuevo duplicaría el descuento en el saldo de caja.
 */
export async function createAutomaticOperationalExpense(data: {
  branchId: number;
  description: string;
  category: "repair_cost" | "warranty_repair_cost" | "warranty_replacement_cost" | "cogs";
  costType: string;
  referenceType: string;
  referenceId: number;
  amount: number;
  paymentMethod: "cash" | "qr" | "transfer";
  userId?: number;
  notes?: string;
  status?: "pending" | "paid";
}) {
  const db = await getDb();
  const status = data.status || "paid";
  // COGS no genera egreso de caja adicional — la compra ya lo registró.
  const shouldCreateFinancialTx = status === "paid" && data.category !== "cogs";

  const record = {
    branchId: data.branchId,
    description: data.description,
    category: data.category,
    costType: data.costType,
    referenceType: data.referenceType,
    referenceId: data.referenceId,
    isAutomatic: 1,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
    expenseDate: new Date(),
    status,
    notes: data.notes,
    userId: data.userId,
  };

  if (!db) {
    const newId = MOCK_OPERATIONAL_EXPENSES.length + 1;
    MOCK_OPERATIONAL_EXPENSES.push({ ...record, id: newId, createdAt: new Date(), updatedAt: new Date() });
    if (shouldCreateFinancialTx) {
      await createCostTransaction({
        category: data.category as any,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        userId: data.userId,
        branchId: data.branchId,
        referenceId: data.referenceId,
        notes: data.description,
      });
    }
    syncMocksToDisk();
    return { insertId: newId };
  }

  const result = await db.insert(operationalExpenses).values(record);
  const insertId = getInsertId(result);

  if (shouldCreateFinancialTx) {
    await createCostTransaction({
      category: data.category as any,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      userId: data.userId,
      branchId: data.branchId,
      referenceId: insertId,
      notes: data.description,
    });
  }

  return { insertId };
}

export async function getFinancialTransactions(userId?: number, branchId?: number) {
  const db = await getDb();
  if (!db) {
    let list = MOCK_FINANCIAL_TRANSACTIONS;
    if (branchId) {
      list = list.filter((t: any) => (t.branchId || 1) === branchId);
    }
    if (userId) {
      return list.filter((t: any) => {
        if (t.userId === userId) return true;
        // Backfill para transacciones antiguas sin userId (ventas)
        if (!t.userId && (t.category === "sale" || t.category === "sale_cancellation") && t.referenceId) {
          const sale = MOCK_SALES.find((s: any) => s.id === t.referenceId);
          return sale?.soldBy === userId;
        }
        return false;
      });
    }
    return list;
  }
  let query = db.select().from(financialTransactions).$dynamic();
  if (branchId) {
    query = query.where(eq(financialTransactions.branchId, branchId));
  }
  if (userId) {
    query = query.where(eq(financialTransactions.userId, userId));
  }
  return toPlainObject(await query);
}

export async function createDeliveryExpense(data: any) {
  const db = await getDb();
  const category = data.type === "fuel" ? "fuel" : data.type === "subsistence" ? "subsistence" : "logistics";
  const desc = data.notes ? `Gasto Repartidor: ${data.notes}` : `Gasto Logístico (${category === "fuel" ? "Combustible" : category === "subsistence" ? "Viáticos" : "Logística"})`;

  if (!db) {
    const newId = MOCK_DELIVERY_EXPENSES.length + 1;
    const expense = { ...data, id: newId, createdAt: new Date() };
    MOCK_DELIVERY_EXPENSES.push(expense);

    // Registrar en Gastos Operativos (Módulo de Gastos)
    const opExpenseId = MOCK_OPERATIONAL_EXPENSES.length + 1;
    MOCK_OPERATIONAL_EXPENSES.push({
      id: opExpenseId,
      branchId: data.branchId || 1,
      description: desc,
      category,
      costType: "operational_expense",
      referenceType: "delivery_expense",
      referenceId: newId,
      isAutomatic: 1,
      amount: data.amount,
      paymentMethod: "cash",
      expenseDate: new Date(),
      status: "paid",
      userId: data.deliveryPersonId,
      notes: data.notes || null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Impacto financiero automático
    await createFinancialTransaction({
      type: "expense",
      category,
      amount: data.amount,
      notes: desc,
      paymentMethod: "cash",
      userId: data.deliveryPersonId,
      branchId: data.branchId || 1,
      referenceId: data.orderId || null
    });

    syncMocksToDisk();
    return { insertId: newId };
  }
  // Real DB
  return await db.transaction(async (tx: any) => {
    const result = await tx.insert(deliveryExpenses).values({
      deliveryPersonId: data.deliveryPersonId,
      orderId: data.orderId || null,
      amount: data.amount,
      type: data.type,
      notes: data.notes || null,
    });
    const insertId = getInsertId(result);

    // Registrar en Gastos Operativos (Módulo de Gastos)
    await tx.insert(operationalExpenses).values({
      branchId: data.branchId || 1,
      description: desc,
      category,
      costType: "operational_expense",
      referenceType: "delivery_expense",
      referenceId: insertId,
      isAutomatic: 1,
      amount: data.amount,
      paymentMethod: "cash",
      expenseDate: new Date(),
      status: "paid",
      userId: data.deliveryPersonId,
      notes: data.notes || null,
    });

    await tx.insert(financialTransactions).values(buildFinancialTransactionRecord({
      type: "expense",
      category,
      amount: data.amount,
      notes: desc,
      paymentMethod: "cash", // Los gastos de repartidor suelen ser en efectivo
      userId: data.deliveryPersonId,
      branchId: data.branchId || 1,
      referenceId: data.orderId || null,
      createdAt: new Date()
    }));

    return { insertId };
  });
}

// Gastos Operativos
export async function getOperationalExpenses(branchId?: number) {
  const db = await getDb();
  if (!db) {
    let list = MOCK_OPERATIONAL_EXPENSES;
    if (branchId) {
      list = list.filter((e: any) => (e.branchId || 1) === branchId);
    }
    return list.sort((a: any, b: any) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  let query = db.select().from(operationalExpenses).orderBy(desc(operationalExpenses.createdAt)).$dynamic();
  if (branchId) {
    query = query.where(eq(operationalExpenses.branchId, branchId));
  }
  return toPlainObject(await query);
}

export async function getOperationalExpenseById(id: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_OPERATIONAL_EXPENSES.find((e: any) => e.id === id);
  }
  const result = await db.select().from(operationalExpenses).where(eq(operationalExpenses.id, id)).limit(1);
  return result.length > 0 ? toPlainObject(result[0]) : undefined;
}

export async function createOperationalExpense(data: any) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_OPERATIONAL_EXPENSES.length + 1;
    const expense = { ...data, id: newId, createdAt: new Date(), updatedAt: new Date() };
    MOCK_OPERATIONAL_EXPENSES.push(expense);

    // Si está marcado como pagado, crear transacción financiera automáticamente
    if (data.status === "paid") {
      await createFinancialTransaction({
        type: "expense",
        category: data.category,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        notes: data.description,
        referenceId: newId
      });
    }

    syncMocksToDisk();
    return { insertId: newId };
  }
  // Real DB
  return await db.transaction(async (tx: any) => {
    const result = await tx.insert(operationalExpenses).values(data);
    const insertId = getInsertId(result);

    // Validar que la caja esté abierta para el método de pago seleccionado ANTES de registrar impacto
    if (data.paymentMethod) {
      const today = getLocalDateKey(new Date());
      if (today && data.userId) {
        await checkCashRegisterOpening(tx, data.userId, data.paymentMethod, today);
      }
    }

    if (data.status === "paid") {
      await tx.insert(financialTransactions).values(buildFinancialTransactionRecord({
        type: "expense",
        category: data.category,
        amount: data.amount,
        paymentMethod: data.paymentMethod || "cash",
        notes: data.description || "Gasto Operativo",
        userId: data.userId, // Asociar con el usuario que registra
        branchId: data.branchId,
        referenceId: insertId,
        createdAt: new Date()
      }));
    }
    return { insertId };
  });
}

export async function updateOperationalExpense(id: number, data: any) {
  const db = await getDb();
  const oldExpense = await getOperationalExpenseById(id);

  if (!db) {
    const index = MOCK_OPERATIONAL_EXPENSES.findIndex((e: any) => e.id === id);
    if (index !== -1) {
      MOCK_OPERATIONAL_EXPENSES[index] = {
        ...MOCK_OPERATIONAL_EXPENSES[index],
        ...data,
        updatedAt: new Date()
      };

      // Si cambia de pendiente a pagado, crear transacción financiera
      if (oldExpense?.status === "pending" && data.status === "paid") {
        await createFinancialTransaction({
          type: "expense",
          category: data.category || oldExpense.category,
          amount: data.amount || oldExpense.amount,
          paymentMethod: data.paymentMethod || oldExpense.paymentMethod,
          notes: data.description || oldExpense.description,
          referenceId: id
        });
      }

      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }

  const result = await db.update(operationalExpenses).set({ ...data, updatedAt: new Date() })
    .where(eq(operationalExpenses.id, id));

  // Si cambia de pendiente a pagado
  if (oldExpense?.status === "pending" && data.status === "paid") {
    await createFinancialTransaction({
      type: "expense",
      category: data.category || oldExpense.category,
      amount: data.amount || oldExpense.amount,
      paymentMethod: data.paymentMethod || oldExpense.paymentMethod,
      notes: data.description || oldExpense.description,
      referenceId: id
    });
  }

  return result;
}

export async function deleteOperationalExpense(id: number) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_OPERATIONAL_EXPENSES.findIndex((e: any) => e.id === id);
    if (index !== -1) {
      // Also delete associated financial transaction
      const expense = MOCK_OPERATIONAL_EXPENSES[index];
      if (expense?.status === "paid") {
        const txIndex = MOCK_FINANCIAL_TRANSACTIONS.findIndex((t: any) => t.referenceId === id && t.type === "expense");
        if (txIndex !== -1) {
          MOCK_FINANCIAL_TRANSACTIONS.splice(txIndex, 1);
        }
      }
      MOCK_OPERATIONAL_EXPENSES.splice(index, 1);
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }
  // Real DB - use transaction to delete both
  return await db.transaction(async (tx: any) => {
    // First get the expense to check if it was paid
    const [expense] = await tx.select().from(operationalExpenses).where(eq(operationalExpenses.id, id)).limit(1);

    // Delete the associated financial transaction if the expense was paid
    if (expense && expense.status === "paid") {
      await tx.delete(financialTransactions)
        .where(and(
          eq(financialTransactions.referenceId, id),
          eq(financialTransactions.type, "expense")
        ));
    }

    // Delete the expense
    return await tx.delete(operationalExpenses).where(eq(operationalExpenses.id, id));
  });
}

// Aperturas de Caja
/**
 * Asegura que una caja esté "abierta" para un método de pago y usuario específico en la fecha actual.
 * Si es QR o Transferencia y no está abierta, la abre automáticamente con fondo 0.
 */
export async function checkCashRegisterOpening(dbOrTx: any, userId: number, paymentMethod: string, dateKey: string) {
  // Las operaciones a crédito no afectan flujo de caja inmediato
  if (paymentMethod === "credit") return;

  const existing = await dbOrTx
    .select()
    .from(cashOpenings)
    .where(
      and(
        eq(cashOpenings.responsibleUserId, userId),
        sql`(${cashOpenings.paymentMethod} = ${paymentMethod} OR (${cashOpenings.paymentMethod} IS NULL AND ${paymentMethod} = 'cash'))`,
        eq(cashOpenings.status, "open")
      )
    )
    .limit(1);

  let hasOpen = existing.length > 0;
  if (!hasOpen && paymentMethod !== "cash") {
    // Si la caja de QR o Transferencia no está abierta de forma individual,
    // verificar si la caja principal de Efectivo está abierta
    const cashOpening = await dbOrTx
      .select()
      .from(cashOpenings)
      .where(
        and(
          eq(cashOpenings.responsibleUserId, userId),
          sql`(${cashOpenings.paymentMethod} = 'cash' OR ${cashOpenings.paymentMethod} IS NULL)`,
          eq(cashOpenings.status, "open")
        )
      )
      .limit(1);
    hasOpen = cashOpening.length > 0;
  }

  if (!hasOpen) {
    // Fallback: verificar si el usuario tiene una caja de vendedor aprobada
    try {
      const today = getLocalDateKey(new Date());
      const sellerBox = await dbOrTx
        .select({ id: sellerCashRegisters.id })
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
      if (sellerBox.length > 0) return; // Tiene caja de vendedor activa — permitir
    } catch {
      // Si falla el check de seller (ej: tabla no existe aún), no bloquear
    }

    const methodName = paymentMethod === 'cash' ? 'Efectivo' : paymentMethod === 'qr' ? 'QR' : paymentMethod === 'transfer' ? 'Transferencia' : paymentMethod.toUpperCase();
    throw new Error(`Abre la caja: La caja de ${methodName} se encuentra cerrada. Por favor, realice la apertura de caja en Finanzas primero.`);
  }
}

export async function autoOpenCashRegisterIfNeeded(dbOrTx: any, userId: number, paymentMethod: string, dateKey: string) {
  // Función mantenida por compatibilidad pero ahora requiere apertura manual
  return checkCashRegisterOpening(dbOrTx, userId, paymentMethod, dateKey);
}

export async function getCashOpeningByUserIdAndDateMethod(userId: number, openingDate: string, paymentMethod: string) {
  const db = await getDb();
  if (!db) {
    // Buscar si existe alguna apertura 'open' para este usuario y método
    return MOCK_CASH_OPENINGS.find((opening) => 
      opening.responsibleUserId === userId && 
      opening.openingDate === openingDate &&
      (opening.paymentMethod === paymentMethod || (!opening.paymentMethod && paymentMethod === "cash")) &&
      opening.status === "open"
    );
  }

  const result = await db
    .select()
    .from(cashOpenings)
    .where(sql`${cashOpenings.responsibleUserId} = ${userId} AND ${cashOpenings.openingDate} = ${openingDate} AND (${cashOpenings.paymentMethod} = ${paymentMethod} OR (${cashOpenings.paymentMethod} IS NULL AND ${paymentMethod} = 'cash')) AND ${cashOpenings.status} = 'open'`)
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getActiveCashOpeningByUserIdAndMethod(userId: number, paymentMethod: string) {
  const db = await getDb();
  if (!db) {
    return MOCK_CASH_OPENINGS.find((opening) => 
      opening.responsibleUserId === userId && 
      (opening.paymentMethod === paymentMethod || (!opening.paymentMethod && paymentMethod === "cash")) &&
      opening.status === "open"
    );
  }

  const result = await db
    .select()
    .from(cashOpenings)
    .where(sql`${cashOpenings.responsibleUserId} = ${userId} AND (${cashOpenings.paymentMethod} = ${paymentMethod} OR (${cashOpenings.paymentMethod} IS NULL AND ${paymentMethod} = 'cash')) AND ${cashOpenings.status} = 'open'`)
    .limit(1);

  return result.length > 0 ? toPlainObject(result[0]) : undefined;
}

export async function createCashOpening(data: InsertCashOpening) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_CASH_OPENINGS.length + 1;
    const opening = { ...data, id: newId, createdAt: new Date() };
    MOCK_CASH_OPENINGS.push(opening);
    syncMocksToDisk();
    return { insertId: newId };
  }

  const result = await db.insert(cashOpenings).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function updateCashOpeningStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) {
    const idx = MOCK_CASH_OPENINGS.findIndex(o => o.id === id);
    if (idx !== -1) {
      MOCK_CASH_OPENINGS[idx].status = status;
      syncMocksToDisk();
    }
    return { success: true };
  }
  
  await db.update(cashOpenings).set({ status }).where(eq(cashOpenings.id, id));
  return { success: true };
}

export async function closeAllActiveOpeningsForUser(userId: number, date: string) {
  const db = await getDb();
  if (!db) {
    let changed = false;
    MOCK_CASH_OPENINGS.forEach(o => {
      if (o.responsibleUserId === userId && o.status === "open") {
        o.status = "closed";
        changed = true;
      }
    });
    if (changed) syncMocksToDisk();
    return;
  }
  
  await db.update(cashOpenings)
    .set({ status: 'closed' })
    .where(and(
      eq(cashOpenings.responsibleUserId, userId),
      eq(cashOpenings.status, 'open')
    ));
}

export async function getAllCashOpenings() {
  const db = await getDb();
  if (!db) {
    return MOCK_CASH_OPENINGS
      .map((opening) => {
        const responsibleUser = MOCK_USERS.find((user) => user.id === opening.responsibleUserId);
        const openedByUser = MOCK_USERS.find((user) => user.id === opening.openedByUserId);

        return {
          ...opening,
          responsibleUserName: responsibleUser?.name || `Usuario #${opening.responsibleUserId}`,
          openedByUserName: openedByUser?.name || `Usuario #${opening.openedByUserId}`,
        };
      })
      .sort((a, b) => `${b.openingDate} ${String(b.id).padStart(5, "0")}`.localeCompare(`${a.openingDate} ${String(a.id).padStart(5, "0")}`));
  }

  return toPlainObject(await db
    .select({
      id: cashOpenings.id,
      openingDate: cashOpenings.openingDate,
      openingAmount: cashOpenings.openingAmount,
      paymentMethod: cashOpenings.paymentMethod,
      responsibleUserId: cashOpenings.responsibleUserId,
      openedByUserId: cashOpenings.openedByUserId,
      status: cashOpenings.status,
      notes: cashOpenings.notes,
      createdAt: cashOpenings.createdAt,
      responsibleUserName: sql<string>`(select name from users where users.id = ${cashOpenings.responsibleUserId})`,
      openedByUserName: sql<string>`(select name from users where users.id = ${cashOpenings.openedByUserId})`,
    })
    .from(cashOpenings)
    .orderBy(sql`${cashOpenings.openingDate} desc, ${cashOpenings.id} desc`));
}

// Cierres de Caja
export async function getCashClosureByUserIdAndDate(userId: number, date: string, branchId?: number) {
  const db = await getDb();
  if (!db) {
    // Para validación de "ya existe un cierre", buscamos el que esté 'pending'
    // Para visualización de "mi estado hoy", buscamos el último creado hoy
    const matches = MOCK_CASH_CLOSURES.filter((c: any) => 
      c.userId === userId && 
      c.date === date && 
      (!branchId || c.branchId === branchId)
    );
    if (matches.length === 0) return undefined;
    return matches
      .slice()
      .sort((a: any, b: any) => {
        const aMs = toValidDate(a.createdAt)?.getTime() ?? 0;
        const bMs = toValidDate(b.createdAt)?.getTime() ?? 0;
        return bMs - aMs;
      })[0];
  }
  
  // Buscar cierres del usuario para hoy, ordenados por el más reciente
  let query = db.select().from(cashClosures).where(
    sql`${cashClosures.userId} = ${userId} AND (${cashClosures.date} = ${date} OR DATE(DATE_SUB(${cashClosures.createdAt}, INTERVAL 4 HOUR)) = ${date})`
  ).$dynamic();

  if (branchId) {
    query = query.where(eq(cashClosures.branchId, branchId));
  }

  const result = await query.orderBy(desc(cashClosures.createdAt)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createCashClosure(data: InsertCashClosure) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_CASH_CLOSURES.length + 1;
    const closure = { ...data, branchId: data.branchId || 1, id: newId, createdAt: new Date() };
    MOCK_CASH_CLOSURES.push(closure);
    syncMocksToDisk();
    return { insertId: newId };
  }
  
  const result = await db.insert(cashClosures).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function getAllCashClosures(branchId?: number) {
  const db = await getDb();
  if (!db) {
    let list = MOCK_CASH_CLOSURES;
    if (branchId) {
      list = list.filter(c => c.branchId === branchId);
    }
    return list.map(c => {
      const user = MOCK_USERS.find(u => u.id === c.userId);
      const branch = MOCK_BRANCHES.find(b => b.id === (c.branchId || 1));
      return { ...c, userName: user?.name || "Usuario #" + c.userId, branchName: branch?.name };
    });
  }

  let query = db.select({
    ...cashClosures,
    userName: users.name,
  }).from(cashClosures).leftJoin(users, eq(cashClosures.userId, users.id)).$dynamic();

  if (branchId) {
    query = query.where(eq(cashClosures.branchId, branchId));
  }

  return toPlainObject(await query);
}

export async function getCashClosuresByUserId(userId: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_CASH_CLOSURES
      .filter(c => c.userId === userId)
      .slice()
      .sort((a, b) => `${b.date} ${String(b.id).padStart(5, "0")}`.localeCompare(`${a.date} ${String(a.id).padStart(5, "0")}`));
  }

  return toPlainObject(await db.select().from(cashClosures).where(eq(cashClosures.userId, userId)).orderBy(desc(cashClosures.createdAt)));
}

export async function getCashClosureById(id: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_CASH_CLOSURES.find(c => c.id === id);
  }
  const result = await db.select().from(cashClosures).where(eq(cashClosures.id, id)).limit(1);
  return result.length > 0 ? toPlainObject(result[0]) : undefined;
}

export async function updateCashClosure(id: number, data: any) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_CASH_CLOSURES.findIndex(c => c.id === id);
    if (index !== -1) {
      MOCK_CASH_CLOSURES[index] = { ...MOCK_CASH_CLOSURES[index], ...data };
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }
  
  await db.update(cashClosures).set(data).where(eq(cashClosures.id, id));
  return { success: true };
}

// Total de órdenes pendientes (no entregadas, no canceladas) por repartidor
export async function getPendingOrdersTotal(userId: number) {
  const db = await getDb();
  if (!db) {
    const pendingOrders = MOCK_ORDERS.filter(o =>
      o.deliveryPersonId === userId &&
      !["delivered", "cancelled"].includes(o.status)
    );
    const total = pendingOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    return { total, count: pendingOrders.length };
  }

  const rows = await db.select({
    total: sql<number>`cast(coalesce(sum(${orders.totalPrice}), 0) as signed)`,
    count: sql<number>`cast(count(${orders.id}) as signed)`,
  })
    .from(orders)
    .where(and(
      eq(orders.deliveryPersonId, userId),
      ne(orders.status, "delivered"),
      ne(orders.status, "cancelled")
    ));

  return { total: Number(rows[0]?.total ?? 0), count: Number(rows[0]?.count ?? 0) };
}

export async function createFinancialTransactionsForDeliveries(closureId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) {
    // Modo demo: crear transacciones financieras para órdenes entregadas por este repartidor
    const deliveredOrders = MOCK_ORDERS.filter(o =>
      o.deliveryPersonId === userId &&
      o.status === "delivered" &&
      getLocalDateKey(o.deliveredAt) === date &&
      !MOCK_FINANCIAL_TRANSACTIONS.some(t => t.referenceId === o.id && t.category === "order_delivery")
    );

    for (const order of deliveredOrders) {
      MOCK_FINANCIAL_TRANSACTIONS.push({
        id: MOCK_FINANCIAL_TRANSACTIONS.length + 1,
        type: "income",
        category: "order_delivery",
        amount: order.totalPrice,
        referenceId: order.id,
        userId: order.deliveryPersonId,
        notes: `Cobro Pedido ${order.orderNumber} (Cierre #${closureId})`,
        paymentMethod: order.paymentMethod || "cash",
        createdAt: new Date()
      });
    }
    syncMocksToDisk();
    return { success: true };
  }

  // Real DB: insertar transacciones para órdenes entregadas ese día sin transacción financiera
  const existingRefs = await db.select({ referenceId: financialTransactions.referenceId })
    .from(financialTransactions)
    .where(and(
      eq(financialTransactions.category, "order_delivery"),
      eq(financialTransactions.userId, userId),
      sql`DATE(DATE_SUB(${financialTransactions.createdAt}, INTERVAL 4 HOUR)) = ${date}`
    ));
  const existingIds = new Set(existingRefs.map((r: any) => r.referenceId).filter(Boolean));

  const deliveredOrders = await db.select()
    .from(orders)
    .where(and(
      eq(orders.deliveryPersonId, userId),
      eq(orders.status, "delivered"),
      sql`DATE(DATE_SUB(${orders.deliveredAt}, INTERVAL 4 HOUR)) = ${date}`
    ));

  for (const order of deliveredOrders) {
    if (order.id && !existingIds.has(order.id)) {
      await db.insert(financialTransactions).values({
        type: "income",
        category: "order_delivery",
        amount: order.totalPrice,
        referenceId: order.id,
        userId: order.deliveryPersonId,
        notes: `Cobro Pedido ${order.orderNumber} (Cierre #${closureId})`,
        paymentMethod: order.paymentMethod || "cash",
        createdAt: new Date()
      });
    }
  }

  return { success: true };
}

export async function processFinancialLiquidation(closureId: number, force = false) {
  const db = await getDb();
  if (!db) return;

  const closure = await getCashClosureById(closureId);
  if (!closure) return;

  if (!force) {
    // PROTECCIÓN ANTI-DUPLICADOS: verificar si ya existe un registro de cierre para este ID
    const existingClosureReport = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.category, "closure_report" as any),
          eq(financialTransactions.userId, closure.userId),
          sql`${financialTransactions.notes} LIKE ${'%Cierre #' + closureId + '%'}`
        )
      )
      .limit(1);

    // Si ya existe, no procesar de nuevo
    if (existingClosureReport.length > 0) return;
  }

  // 1. Registrar ingresos de ventas (órdenes entregadas)
  await createFinancialTransactionsForDeliveries(closureId, closure.userId, closure.date);
  
  // Nota: Ya no se registra el monto "reportado" como un ingreso nuevo (closure_report)
  // porque el dinero ya fue sumado correctamente en cada entrega y traspaso.
  // Hacerlo causaría que el saldo se duplique erróneamente.
}

export async function cleanupDuplicateClosureReports() {
  const db = await getDb();
  if (!db) return { deleted: 0 };

  // Obtener todas las transacciones de closure_report ordenadas por fecha ASC
  const allReports = await db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.category, "closure_report" as any))
    .orderBy(financialTransactions.createdAt);

  const seenNotes = new Map<string, number>();
  const toDelete: number[] = [];

  for (const tx of allReports) {
    const key = (tx.notes || "") + "|" + tx.paymentMethod;
    if (seenNotes.has(key)) {
      // Es un duplicado - eliminarlo
      toDelete.push(tx.id!);
    } else {
      seenNotes.set(key, tx.id!);
    }
  }

  for (const id of toDelete) {
    await db.delete(financialTransactions).where(eq(financialTransactions.id, id));
  }

  return { deleted: toDelete.length };
}

export async function getExpectedDailyTotals(userId: number, date: string) {
  const db = await getDb();
  const totals = { cash: 0, qr: 0, transfer: 0 };

  if (!db) {
    // Ordenes ENTREGADAS en la fecha
    const userOrders = MOCK_ORDERS.filter(o =>
      o.deliveryPersonId === userId &&
      o.status === "delivered" &&
      getLocalDateKey(o.deliveredAt) === date
    );

    let cash = 0, qr = 0, transfer = 0;
    userOrders.forEach(o => {
      if (o.paymentMethod === "cash") cash += o.totalPrice;
      else if (o.paymentMethod === "qr") qr += o.totalPrice;
      else if (o.paymentMethod === "transfer") transfer += o.totalPrice;
    });

    // Ventas del repartidor
    const userSales = MOCK_SALES.filter((sale: any) =>
      sale.soldBy === userId &&
      sale.status !== "cancelled" &&
      sale.paymentStatus === "completed" &&
      getLocalDateKey(sale.createdAt) === date
    );

    userSales.forEach((sale: any) => {
      if (sale.paymentMethod === "cash") cash += sale.total;
      else if (sale.paymentMethod === "qr") qr += sale.total;
      else if (sale.paymentMethod === "transfer") transfer += sale.total;
    });

    totals.cash = cash;
    totals.qr = qr;
    totals.transfer = transfer;

    // Si ya hubo cierres aprobados en la misma fecha, mostrar solo el saldo pendiente
    const approvedClosures = MOCK_CASH_CLOSURES.filter((c: any) => c.userId === userId && c.date === date && c.status === "approved");
    if (approvedClosures.length > 0) {
      const alreadyExpectedCash = approvedClosures.reduce((sum: number, c: any) => sum + (c.expectedCash || 0), 0);
      const alreadyExpectedQr = approvedClosures.reduce((sum: number, c: any) => sum + (c.expectedQr || 0), 0);
      const alreadyExpectedTransfer = approvedClosures.reduce((sum: number, c: any) => sum + (c.expectedTransfer || 0), 0);

      totals.cash = Math.max(0, totals.cash - alreadyExpectedCash);
      totals.qr = Math.max(0, totals.qr - alreadyExpectedQr);
      totals.transfer = Math.max(0, totals.transfer - alreadyExpectedTransfer);
    }

    return totals;
  }

  // Ordenes entregadas
  const orderResults = await db.select({
    total: sql<number>`cast(ifnull(sum(${orders.totalPrice}), 0) as signed)`,
    method: orders.paymentMethod,
  })
    .from(orders)
    .where(and(
      eq(orders.deliveryPersonId, userId),
      eq(orders.status, "delivered"),
      sql`DATE(DATE_SUB(${orders.deliveredAt}, INTERVAL 4 HOUR)) = ${date}`
    ))
    .groupBy(orders.paymentMethod);

  orderResults.forEach((r: any) => {
    if (r.method === "cash") totals.cash += r.total || 0;
    else if (r.method === "qr") totals.qr += r.total || 0;
    else if (r.method === "transfer") totals.transfer += r.total || 0;
  });

  // Ventas
  const saleResults = await db.select({
    total: sql<number>`cast(ifnull(sum(${sales.total}), 0) as signed)`,
    method: sales.paymentMethod,
  })
    .from(sales)
    .where(and(
      eq(sales.soldBy, userId),
      ne(sales.status, "cancelled"),
      eq(sales.paymentStatus, "completed"),
      sql`DATE(DATE_SUB(${sales.createdAt}, INTERVAL 4 HOUR)) = ${date}`
    ))
    .groupBy(sales.paymentMethod);

  saleResults.forEach((r: any) => {
    if (r.method === "cash") totals.cash += r.total || 0;
    else if (r.method === "qr") totals.qr += r.total || 0;
    else if (r.method === "transfer") totals.transfer += r.total || 0;
  });

  // Restar montos ya cerrados/aprobados en la fecha (para permitir "cierres parciales")
  const approvedClosures = await db
    .select({
      expectedCash: cashClosures.expectedCash,
      expectedQr: cashClosures.expectedQr,
      expectedTransfer: cashClosures.expectedTransfer,
    })
    .from(cashClosures)
    .where(and(
      eq(cashClosures.userId, userId),
      eq(cashClosures.status, "approved" as any),
      // Fallback por si la columna `date` quedÃ³ guardada con desfase UTC en registros antiguos
      sql`(${cashClosures.date} = ${date} OR DATE(DATE_SUB(${cashClosures.createdAt}, INTERVAL 4 HOUR)) = ${date})`,
    ));

  if (approvedClosures.length > 0) {
    const alreadyExpectedCash = approvedClosures.reduce((sum: number, c: any) => sum + (c.expectedCash || 0), 0);
    const alreadyExpectedQr = approvedClosures.reduce((sum: number, c: any) => sum + (c.expectedQr || 0), 0);
    const alreadyExpectedTransfer = approvedClosures.reduce((sum: number, c: any) => sum + (c.expectedTransfer || 0), 0);

    totals.cash = Math.max(0, totals.cash - alreadyExpectedCash);
    totals.qr = Math.max(0, totals.qr - alreadyExpectedQr);
    totals.transfer = Math.max(0, totals.transfer - alreadyExpectedTransfer);
  }

  return totals;
}


// =============================================
// Ventas (Sales)
// =============================================

type SaleDiscountType = "none" | "percentage" | "fixed";
type SalePaymentStatus = "pending" | "completed";
type SaleStatus = "completed" | "cancelled";

type SaleItemCreateInput = {
  unitId: number;
  pricingType: "unit" | "wholesale";
  quantity: number;
  basePrice: number;
  discountType: SaleDiscountType;
  discountValue: number;
  discountAmount: number;
  finalUnitPrice: number;
  subtotal: number;
};

type SaleCreatePayload = {
  saleNumber: string;
  customerId?: number;
  customerName?: string;
  saleChannel: "local" | "delivery";
  orderId?: number;
  soldBy: number;
  subtotal: number;
  discountType: SaleDiscountType;
  discountValue: number;
  discountAmount: number;
  total: number;
  paymentMethod: "cash" | "qr" | "transfer" | "credit";
  paymentStatus: SalePaymentStatus;
  creditDays?: number;
  warrantyDays?: number;
  dueDate?: string;
  notes?: string;
  items: SaleItemCreateInput[];
  branchId?: number;
  adminOverrideUserId?: number;
  adminOverrideReason?: string;
};

function getSaleFinanceNote(saleNumber: string) {
  return `Venta ${saleNumber}`;
}

function mapSaleWithRelations(sale: any, usersList: any[], customersList: any[], branchesList?: any[]) {
  const seller = usersList.find((user: any) => user.id === sale.soldBy);
  const customer = customersList.find((item: any) => item.id === sale.customerId);
  const branch = branchesList?.find((b: any) => b.id === sale.branchId);

  return {
    ...sale,
    sellerName: seller?.name || "Desconocido",
    customerDisplayName: customer?.name || sale.customerName || "Anónimo",
    customerCode: customer?.clientNumber || null,
    customerTaxId: customer?.taxId || (sale as any).customerTaxId || null,
    customerPhone: customer?.phone || customer?.whatsapp || (sale as any).customerPhone || null,
    customerAddress: customer?.address || null,
    branchName: branch?.name || "GENERAL",
  };
}

export async function getNextSaleNumber() {
  const db = await getDb();
  const allData = db ? await db.select({ saleNumber: sales.saleNumber }).from(sales) : MOCK_SALES;
  const numbers = (allData || [])
    .map((s: any) => {
      if (!s || !s.saleNumber) return 0;
      const digitsOnly = String(s.saleNumber).replace(/[^0-9]/g, "");
      return parseInt(digitsOnly, 10) || 0;
    })
    .filter((n: number) => Number.isFinite(n));
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  return `VTA-${String(max + 1).padStart(3, '0')}`;
}

export async function createSale(data: InsertSale) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_SALES.length + 1;
    MOCK_SALES.push({
      status: "completed",
      discountType: "none",
      discountValue: 0,
      cancelReason: null,
      cancelledAt: null,
      cancelledBy: null,
      ...data,
      id: newId,
      createdAt: new Date(),
    });
    return { insertId: newId };
  }
  
  const result = await db.insert(sales).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function createSaleItem(data: InsertSaleItem) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_SALE_ITEMS.length + 1;
    MOCK_SALE_ITEMS.push({
      discountType: "none",
      discountValue: 0,
      discountAmount: 0,
      finalUnitPrice: data.basePrice,
      ...data,
      id: newId,
      createdAt: new Date(),
    });
    return { insertId: newId };
  }
  
  const result = await db.insert(saleItems).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function getProductsWithStock() {
  const [allProducts, allInventory] = await Promise.all([getAllProducts(), getAllInventory()]);

  return allProducts.map((product: any) => {
    const productBatches = allInventory.filter((item: any) => item.productId === product.id);
    const stock = productBatches.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
    // Tomamos el stock mínimo del primer lote que tenga uno definido, o por defecto 5
    const minStock = productBatches.find((b: any) => b.minStock != null)?.minStock || 5;

    return {
      ...product,
      stock,
      minStock,
      isLowStock: stock <= minStock,
    };
  });
}

export async function createSaleWithItems(payload: SaleCreatePayload) {
  const db = await getDb();

  if (!db) {
    // 1. Validation loop
    for (const item of payload.items as any[]) {
      const targetId = item.unitId || item.productId;

      // Check if it's a unit in MOCK_UNITS
      const unit = MOCK_UNITS.find((u: any) => u.id === targetId);
      if (unit) {
        if (unit.status !== "available") {
          throw new Error(`Unidad ${unit.code || targetId} no está disponible para la venta (Estado actual: ${unit.status})`);
        }
        continue;
      }

      // Check regular catalog product in MOCK_PRODUCTS
      const product = MOCK_PRODUCTS.find((entry: any) => entry.id === targetId);
      if (!product || product.status !== "active") {
        throw new Error(`Producto ${targetId} no disponible para la venta`);
      }

      const productBatches = MOCK_INVENTORY.filter((entry: any) => entry.productId === targetId);
      const totalStock = productBatches.reduce((sum: number, b: any) => sum + b.quantity, 0);
      if (totalStock < item.quantity) {
        throw new Error(`Stock insuficiente para ${product.name}. Disponible: ${totalStock}`);
      }
    }

    const newSaleId = MOCK_SALES.length + 1;
    MOCK_SALES.push({
      id: newSaleId,
      branchId: payload.branchId || 1,
      saleNumber: payload.saleNumber,
      customerId: payload.customerId || null,
      customerName: payload.customerId ? null : payload.customerName || "Anónimo",
      saleChannel: payload.saleChannel,
      status: "completed" as SaleStatus,
      orderId: payload.orderId || null,
      soldBy: payload.soldBy,
      subtotal: payload.subtotal,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      discountAmount: payload.discountAmount,
      total: payload.total,
      paymentMethod: payload.paymentMethod,
      paymentStatus: payload.paymentStatus,
      notes: payload.notes || null,
      cancelReason: null,
      cancelledAt: null,
      cancelledBy: null,
      createdAt: new Date(),
    });

    // 2. Process sale items and update stock/unit status
    for (const item of payload.items as any[]) {
      const targetId = item.unitId || item.productId;
      MOCK_SALE_ITEMS.push({
        id: MOCK_SALE_ITEMS.length + 1,
        saleId: newSaleId,
        unitId: targetId,
        pricingType: item.pricingType,
        quantity: item.quantity,
        basePrice: item.basePrice,
        discountType: item.discountType,
        discountValue: item.discountValue,
        discountAmount: item.discountAmount,
        finalUnitPrice: item.finalUnitPrice,
        subtotal: item.subtotal,
        createdAt: new Date(),
      });

      // Update unit status to "sold" if it's a unit
      const unitIdx = MOCK_UNITS.findIndex((u: any) => u.id === targetId);
      if (unitIdx !== -1) {
        const oldStatus = MOCK_UNITS[unitIdx].status;
        MOCK_UNITS[unitIdx] = {
          ...MOCK_UNITS[unitIdx],
          status: "sold",
          updatedAt: new Date(),
        };

        MOCK_UNIT_EVENTS.push({
          id: MOCK_UNIT_EVENTS.length + 1,
          unitId: targetId,
          eventType: "sold",
          fromStatus: oldStatus,
          toStatus: "sold",
          userId: payload.soldBy,
          notes: `Venta #${payload.saleNumber}`,
          createdAt: new Date(),
        });

        // Crear registro de garantía si aplica
        const warrantyDays = payload.warrantyDays !== undefined ? payload.warrantyDays : 30;
        if (warrantyDays > 0) {
          const startDate = new Date();
          const endDate = new Date(startDate.getTime() + warrantyDays * 24 * 60 * 60 * 1000);
          MOCK_WARRANTIES.push({
            id: MOCK_WARRANTIES.length + 1,
            saleId: newSaleId,
            orderId: payload.orderId || null,
            unitId: targetId,
            days: warrantyDays,
            startDate,
            endDate,
            status: "active",
            createdAt: new Date(),
          });
        }

        // 🔴 CRÍTICO #3: COGS - registrar costo de adquisición de la unidad vendida
        const soldUnit = MOCK_UNITS[unitIdx];
        if (soldUnit) {
          let cogsAmount = soldUnit.purchasePrice || 0;
          
          // Para productos fungibles sin purchasePrice, calcular COGS promedio
          const isFungible = ['charger', 'accessory', 'battery', 'cable', 'case', 'other'].includes(soldUnit.type);
          if (isFungible && cogsAmount === 0) {
            const matchingUnits = MOCK_UNITS.filter((u: any) => 
              u.brand === soldUnit.brand && 
              u.model === soldUnit.model && 
              u.type === soldUnit.type &&
              u.purchasePrice > 0
            );
            if (matchingUnits.length > 0) {
              const totalCost = matchingUnits.reduce((sum: number, u: any) => sum + u.purchasePrice, 0);
              cogsAmount = Math.round((totalCost / matchingUnits.length) * 100) / 100;
            }
          }
          
          // ⚠️ Advertencia: COGS = 0 afecta rentabilidad real
          if (cogsAmount === 0) {
            console.warn(`⚠️ VENTA ${payload.saleNumber}: Unidad ${soldUnit.code || targetId} vendida SIN costo de adquisición (purchasePrice=0). Rentabilidad inflada.`);
          }
          
          if (cogsAmount > 0) {
            await createAutomaticOperationalExpense({
              branchId: payload.branchId || 1,
              description: `COGS - ${soldUnit.brand || ""} ${soldUnit.model || ""} (${soldUnit.code || targetId}) · Venta ${payload.saleNumber}`,
              category: "cogs",
              costType: "direct_cost",
              referenceType: "sale",
              referenceId: newSaleId,
              amount: cogsAmount,
              paymentMethod: "cash", // contable, no sale de caja
              userId: payload.soldBy,
              notes: isFungible && soldUnit.purchasePrice === 0 
                ? `COGS promedio calculado (${cogsAmount.toFixed(2)}) para venta ${payload.saleNumber}`
                : `Costo de adquisición registrado al momento de venta ${payload.saleNumber}`,
              status: "paid",
            });
          }
        }
        continue;
      }

      // Deduct inventory for regular products
      if (!payload.orderId) {
        const productBatches = MOCK_INVENTORY
          .filter((entry: any) => entry.productId === targetId)
          .sort((a: any, b: any) => {
            if (!a.expiryDate) return 1;
            if (!b.expiryDate) return -1;
            return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
          });

        let remaining = item.quantity;
        for (const batch of productBatches) {
          if (remaining <= 0) break;
          const deduct = Math.min(batch.quantity, remaining);
          batch.quantity -= deduct;
          remaining -= deduct;
          batch.lastUpdated = new Date();
        }
      }

      await createInventoryMovement({
        productId: targetId,
        type: "exit",
        quantity: item.quantity,
        reason: payload.orderId ? `Venta Pedido ${payload.orderId}` : `Venta ${payload.saleNumber}`,
        notes: payload.orderId ? `Salida por venta vinculada a pedido` : `Salida por venta ${payload.saleNumber}`,
        saleId: newSaleId,
        orderId: payload.orderId || undefined,
        userId: payload.soldBy,
      });
    }

    if (payload.orderId) {
      const order = MOCK_ORDERS.find(o => o.id === payload.orderId);
      if (order) {
        order.status = "delivered";
        order.paymentStatus = "completed";
        order.updatedAt = new Date();
      }
    }

    // Si es venta a crédito, crear cuenta por cobrar automáticamente
    if (payload.paymentMethod === "credit") {
      const creditDays = payload.creditDays || 30;
      const dueDateObj = new Date();
      dueDateObj.setDate(dueDateObj.getDate() + creditDays);
      const dueDateStr = dueDateObj.toISOString().split("T")[0];
      const customer = payload.customerId ? MOCK_CUSTOMERS.find((c: any) => c.id === payload.customerId) : null;
      MOCK_ACCOUNTS_RECEIVABLE.push({
        id: MOCK_ACCOUNTS_RECEIVABLE.length + 1,
        saleId: newSaleId,
        customerId: payload.customerId || null,
        customerName: customer?.name || payload.customerName || "Anónimo",
        saleNumber: payload.saleNumber,
        totalAmount: payload.total,
        paidAmount: 0,
        balance: payload.total,
        dueDate: dueDateStr,
        status: "unpaid",
        notes: payload.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else if (payload.paymentStatus === "completed") {
      // Venta normal (no a crédito): registrar en caja
      await createFinancialTransaction({
        type: "income",
        category: payload.saleChannel === "delivery" ? "sale_delivery" : "sale_local",
        amount: payload.total,
        referenceId: newSaleId,
        notes: getSaleFinanceNote(payload.saleNumber),
        paymentMethod: payload.paymentMethod,
        userId: payload.soldBy,
      });
    }
    syncMocksToDisk();
    return { insertId: newSaleId };
  }

  return await db.transaction(async (tx: any) => {
    // 0. Validar que la caja esté abierta para el método de pago seleccionado
    const today = getLocalDateKey(new Date());
    if (today && payload.soldBy && payload.paymentMethod) {
      await checkCashRegisterOpening(tx, payload.soldBy, payload.paymentMethod, today);
    }

    const saleResult = await tx.insert(sales).values({
      saleNumber: payload.saleNumber,
      customerId: payload.customerId,
      customerName: payload.customerId ? null : payload.customerName || "Anónimo",
      saleChannel: payload.saleChannel,
      status: "completed",
      orderId: payload.orderId,
      soldBy: payload.soldBy,
      subtotal: payload.subtotal,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      discountAmount: payload.discountAmount,
      total: payload.total,
      paymentMethod: payload.paymentMethod,
      paymentStatus: payload.paymentStatus,
      notes: payload.notes,
    });

    const saleId = getInsertId(saleResult);

    for (const item of payload.items) {
      const itemAny = item as any;
      const isFungible = itemAny.isFungible || false;
      const quantity = itemAny.quantity || 1;
      
      if (isFungible && quantity > 1) {
        // ✅ Producto fungible con cantidad > 1: buscar N unidades del mismo brand+model
        const unitsToSell = await tx.select()
          .from(units)
          .where(
            and(
              eq(units.brand, itemAny.brand),
              eq(units.model, itemAny.model),
              eq(units.status, "available")
            )
          )
          .limit(quantity);
        
        if (unitsToSell.length < quantity) {
          throw new Error(`No hay suficientes unidades disponibles de ${itemAny.brand} ${itemAny.model}`);
        }
        
        // Insertar UN SOLO sale_item con quantity
        await tx.insert(saleItems).values({
          saleId,
          unitId: unitsToSell[0].id, // Usar el ID de la primera unidad como referencia
          pricingType: item.pricingType,
          quantity: quantity,
          basePrice: item.basePrice,
          discountType: item.discountType,
          discountValue: item.discountValue,
          discountAmount: item.discountAmount,
          finalUnitPrice: item.finalUnitPrice,
          subtotal: item.subtotal,
        });
        
        // Marcar TODAS las unidades como vendidas
        for (const unit of unitsToSell) {
          await tx.update(units).set({
            status: "sold",
            updatedAt: new Date(),
          }).where(eq(units.id, unit.id));
          
          await tx.insert(unitEvents).values({
            unitId: unit.id,
            eventType: "sold",
            fromStatus: "available",
            toStatus: "sold",
            userId: payload.soldBy,
            notes: `Vendido en venta #${payload.saleNumber} (fungible: ${itemAny.brand} ${itemAny.model})`,
          });
          
          // 🔴 CRÍTICO #3: COGS para cada unidad (con cálculo de promedio si es necesario)
          if (unit.purchasePrice && unit.purchasePrice > 0) {
            await tx.insert(operationalExpenses).values({
              branchId: payload.branchId || 1,
              description: `COGS - ${unit.brand || ""} ${unit.model || ""} (${unit.code || unit.id}) · Venta ${payload.saleNumber}`,
              category: "cogs",
              costType: "direct_cost",
              referenceType: "sale",
              referenceId: saleId,
              isAutomatic: 1,
              amount: unit.purchasePrice,
              paymentMethod: "cash",
              expenseDate: new Date(),
              status: "paid",
              userId: payload.soldBy,
              notes: `Costo de adquisición registrado al momento de venta ${payload.saleNumber}`,
            });
          } else {
            // Si no tiene purchasePrice, calcular promedio para fungibles
            const avgCost = await calculateAverageCOGS(tx, unit.brand, unit.model, unit.type);
            if (avgCost > 0) {
              await tx.insert(operationalExpenses).values({
                branchId: payload.branchId || 1,
                description: `COGS - ${unit.brand || ""} ${unit.model || ""} (${unit.code || unit.id}) · Venta ${payload.saleNumber}`,
                category: "cogs",
                costType: "direct_cost",
                referenceType: "sale",
                referenceId: saleId,
                isAutomatic: 1,
                amount: avgCost,
                paymentMethod: "cash",
                expenseDate: new Date(),
                status: "paid",
                userId: payload.soldBy,
                notes: `COGS promedio calculado (${avgCost.toFixed(2)}) para venta ${payload.saleNumber}`,
              });
            } else {
              console.warn(`⚠️ VENTA ${payload.saleNumber}: Unidad ${unit.code || unit.id} vendida SIN costo de adquisición. Rentabilidad inflada.`);
            }
          }
        }
        
        // Crear garantía para productos fungibles (una sola para el grupo)
        const warrantyDays = payload.warrantyDays !== undefined ? payload.warrantyDays : 30;
        if (warrantyDays > 0) {
          const startDate = new Date();
          const endDate = new Date(startDate.getTime() + warrantyDays * 24 * 60 * 60 * 1000);
          await tx.insert(schema.warranties).values({
            unitId: unitsToSell[0].id,
            saleId,
            orderId: payload.orderId || null,
            days: warrantyDays,
            startDate,
            endDate,
            status: "active",
          });
        }
      } else {
        // ❌ Producto único o fungible con quantity=1: lógica original
        await tx.insert(saleItems).values({
          ...item,
          saleId,
        });

        // Obtener datos de la unidad para COGS y garantía
        const [unitRow] = await tx.select().from(units).where(eq(units.id, item.unitId)).limit(1);

        // Actualizar estado de la unidad a vendida
        await tx.update(units).set({
          status: "sold",
          updatedAt: new Date(),
        }).where(eq(units.id, item.unitId));

        // Registrar evento
        await tx.insert(unitEvents).values({
          unitId: item.unitId,
          eventType: "sold",
          fromStatus: "available",
          toStatus: "sold",
          userId: payload.soldBy,
          notes: `Vendido en venta #${payload.saleNumber}`,
        });

        // Crear registro de garantía si aplica
        const warrantyDays = payload.warrantyDays !== undefined ? payload.warrantyDays : 30;
        if (warrantyDays > 0) {
          const startDate = new Date();
          const endDate = new Date(startDate.getTime() + warrantyDays * 24 * 60 * 60 * 1000);
          await tx.insert(schema.warranties).values({
            unitId: item.unitId,
            saleId,
            orderId: payload.orderId || null,
            days: warrantyDays,
            startDate,
            endDate,
            status: "active",
          });
        }

        // 🔴 CRÍTICO #3: COGS - registrar costo de adquisición de la unidad vendida
        // Solo va a operationalExpenses (P&L). NO se inserta en financialTransactions
        // porque el COGS es un costo contable, no un egreso real de caja.
        // El dinero de compra ya salió cuando se registró la unidad (category: "purchase").
        if (unitRow) {
          let cogsAmount = unitRow.purchasePrice || 0;
          
          // Para productos fungibles sin purchasePrice, calcular COGS promedio
          const isFungible = ['charger', 'accessory', 'battery', 'cable', 'case', 'other'].includes(unitRow.type);
          if (isFungible && cogsAmount === 0) {
            cogsAmount = await calculateAverageCOGS(tx, unitRow.brand, unitRow.model, unitRow.type);
          }
          
          // ⚠️ Advertencia: COGS = 0 afecta rentabilidad real
          if (cogsAmount === 0) {
            console.warn(`⚠️ VENTA ${payload.saleNumber}: Unidad ${unitRow.code || item.unitId} vendida SIN costo de adquisición (purchasePrice=0). Rentabilidad inflada.`);
          }
          
          if (cogsAmount > 0) {
            await tx.insert(operationalExpenses).values({
              branchId: payload.branchId || 1,
              description: `COGS - ${unitRow.brand || ""} ${unitRow.model || ""} (${unitRow.code || item.unitId}) · Venta ${payload.saleNumber}`,
              category: "cogs",
              costType: "direct_cost",
              referenceType: "sale",
              referenceId: saleId,
              isAutomatic: 1,
              amount: cogsAmount,
              paymentMethod: "cash",
              expenseDate: new Date(),
              status: "paid",
              userId: payload.soldBy,
              notes: isFungible && (unitRow.purchasePrice || 0) === 0
                ? `COGS promedio calculado (${cogsAmount.toFixed(2)}) para venta ${payload.saleNumber}`
                : `Costo de adquisición registrado al momento de venta ${payload.saleNumber}`,
            });
          }
          // ⚠️ No insertar en financialTransactions — COGS no afecta saldo de caja.
        }
      }
    }

    if (payload.orderId) {
      await tx.update(orders).set({
        status: "delivered",
        paymentStatus: "completed",
        updatedAt: new Date(),
      }).where(eq(orders.id, payload.orderId));
    }

    if (payload.paymentMethod === "credit") {
      const creditDays = payload.creditDays || 30;
      const dueDateObj = new Date();
      dueDateObj.setDate(dueDateObj.getDate() + creditDays);
      const dueDateStr = getLocalDateKey(dueDateObj) || dueDateObj.toISOString().split("T")[0];

      await tx.insert(accountsReceivable).values({
        saleId,
        customerId: payload.customerId || null,
        totalAmount: payload.total,
        paidAmount: 0,
        balance: payload.total,
        dueDate: dueDateStr,
        status: "unpaid",
        adminOverrideUserId: payload.adminOverrideUserId || null,
        adminOverrideReason: payload.adminOverrideReason || null,
      });
    } else if (payload.paymentStatus === "completed") {
      await tx.insert(financialTransactions).values({
        branchId: payload.branchId || 1,
        type: "income",
        category: payload.saleChannel === "delivery" ? "sale_delivery" : "sale_local",
        amount: payload.total,
        referenceId: saleId,
        notes: getSaleFinanceNote(payload.saleNumber),
        paymentMethod: payload.paymentMethod,
        userId: payload.soldBy,
      });
    }

    return { insertId: saleId };
  });
}

export async function updateSale(saleId: number, data: Partial<InsertSale>) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_SALES.findIndex((sale: any) => sale.id === saleId);
    if (index === -1) return { success: false };
    MOCK_SALES[index] = { ...MOCK_SALES[index], ...data };
    return { success: true };
  }
  
  await db.update(sales).set(data).where(eq(sales.id, saleId));
  return { success: true };
}

export async function markSalePaymentCompleted(saleId: number) {
  const sale = await getSaleById(saleId);
  if (!sale) {
    throw new Error("Venta no encontrada");
  }
  if (sale.status === "cancelled") {
    throw new Error("No se puede cobrar una venta anulada");
  }
  if (sale.paymentStatus === "completed") {
    return { success: true };
  }

  await updateSale(saleId, { paymentStatus: "completed" });
  await createFinancialTransaction({
    type: "income",
    category: sale.saleChannel === "delivery" ? "sale_delivery" : "sale_local",
    amount: sale.total,
    referenceId: saleId,
    notes: getSaleFinanceNote(sale.saleNumber),
    paymentMethod: sale.paymentMethod,
    userId: sale.soldBy,
  });

  return { success: true };
}

export async function cancelSaleRecord(saleId: number, cancelledByUserId: number, reason: string) {
  const sale = await getSaleById(saleId);
  if (!sale) {
    throw new Error("Venta no encontrada");
  }
  if (sale.status === "cancelled") {
    throw new Error("La venta ya fue anulada");
  }

  const items = await getSaleItemsBySaleId(saleId);
  const db = await getDb();

  if (!db) {
    const saleIndex = MOCK_SALES.findIndex((entry: any) => entry.id === saleId);
    if (saleIndex === -1) {
      throw new Error("Venta no encontrada");
    }

    MOCK_SALES[saleIndex] = {
      ...MOCK_SALES[saleIndex],
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: new Date(),
      cancelledBy: cancelledByUserId,
    };

    for (const item of items as any[]) {
      const inventoryItem = MOCK_INVENTORY.find((entry: any) => entry.productId === item.productId);
      if (inventoryItem) {
        inventoryItem.quantity += item.quantity;
        inventoryItem.lastUpdated = new Date();
      }

      await createInventoryMovement({
        productId: item.productId,
        type: "entry",
        quantity: item.quantity,
        reason: `Anulación ${sale.saleNumber}`,
        notes: `Reposición por anulación de venta ${sale.saleNumber}`,
      });
    }

    if (sale.paymentStatus === "completed") {
      await createFinancialTransaction({
        type: "expense",
        category: "sale_cancellation",
        amount: sale.total,
        referenceId: saleId,
        notes: `Anulación ${sale.saleNumber}`,
        paymentMethod: sale.paymentMethod,
        userId: sale.soldBy,
      });
    }

    // Limpiar garantías asociadas a esta venta en mock
    for (let i = MOCK_WARRANTIES.length - 1; i >= 0; i--) {
      if (MOCK_WARRANTIES[i].saleId === saleId) {
        MOCK_WARRANTIES.splice(i, 1);
      }
    }

    // Revertir COGS en mock
    for (let i = MOCK_OPERATIONAL_EXPENSES.length - 1; i >= 0; i--) {
      if (MOCK_OPERATIONAL_EXPENSES[i].referenceType === "sale" && MOCK_OPERATIONAL_EXPENSES[i].referenceId === saleId) {
        MOCK_OPERATIONAL_EXPENSES.splice(i, 1);
      }
    }

    return { success: true };
  }

  await db.transaction(async (tx: any) => {
    await tx.update(sales).set({
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: new Date(),
      cancelledBy: cancelledByUserId,
    }).where(eq(sales.id, saleId));

    for (const item of items as any[]) {
      // Restaurar estado de la unidad a disponible
      await tx.update(units).set({ status: "available", updatedAt: new Date() }).where(eq(units.id, item.unitId));
      await tx.insert(unitEvents).values({
        unitId: item.unitId,
        eventType: "status_change",
        fromStatus: "sold",
        toStatus: "available",
        notes: `Anulación de venta ${sale.saleNumber}`,
      });
    }

    // Eliminar registros de garantía generados por esta venta anulada
    await tx.delete(schema.warranties).where(eq(schema.warranties.saleId, saleId));

    // Revertir COGS registrado en operationalExpenses para esta venta
    await tx.delete(operationalExpenses).where(
      and(
        eq(operationalExpenses.referenceType, "sale"),
        eq(operationalExpenses.referenceId, saleId),
        eq(operationalExpenses.category, "cogs")
      )
    );

    // Cancelar cuenta por cobrar si existía
    await tx.update(schema.accountsReceivable).set({ status: "cancelled" }).where(eq(schema.accountsReceivable.saleId, saleId));

    if (sale.paymentStatus === "completed") {
      await tx.insert(financialTransactions).values({
        branchId: sale.branchId || 1,
        type: "expense",
        category: "sale_cancellation",
        amount: sale.total,
        referenceId: saleId,
        notes: `Anulación ${sale.saleNumber}`,
        paymentMethod: sale.paymentMethod,
        userId: sale.soldBy,
      });

      // ── Revertir venta en la caja del vendedor (si no fue a crédito) ──
      if (sale.paymentMethod !== "credit") {
        try {
          const saleDateKey = sale.createdAt ? getLocalDateKey(new Date(sale.createdAt)) : getLocalDateKey(new Date());
          const registers = await tx
            .select()
            .from(sellerCashRegisters)
            .where(
              and(
                eq(sellerCashRegisters.sellerId, sale.soldBy),
                eq(sellerCashRegisters.date, saleDateKey)
              )
            )
            .orderBy(desc(sellerCashRegisters.turnNumber));

          const targetBox = registers.find((cr: any) => cr.closingStatus === "open") || registers[0];
          if (targetBox) {
            const updateField: any = {};
            if (sale.paymentMethod === "cash") {
              updateField.salesCash = sql`GREATEST(0, ${sellerCashRegisters.salesCash} - ${sale.total})`;
            } else if (sale.paymentMethod === "qr") {
              updateField.salesQr = sql`GREATEST(0, ${sellerCashRegisters.salesQr} - ${sale.total})`;
            } else if (sale.paymentMethod === "transfer") {
              updateField.salesTransfer = sql`GREATEST(0, ${sellerCashRegisters.salesTransfer} - ${sale.total})`;
            }

            if (Object.keys(updateField).length > 0) {
              await tx
                .update(sellerCashRegisters)
                .set(updateField)
                .where(eq(sellerCashRegisters.id, targetBox.id));
            }
          }
        } catch (boxErr) {
          console.error("[cancelSaleRecord] Error revirtiendo venta en caja de vendedor:", boxErr);
        }
      }
    }
  });

  return { success: true };
}

export async function getAllSales(branchId?: number, soldBy?: number) {
  const db = await getDb();
  if (!db) {
    let list = MOCK_SALES as any[];
    if (branchId) {
      list = list.filter((s: any) => !s.branchId || s.branchId === branchId);
    }
    if (soldBy) {
      list = list.filter((s: any) => s.soldBy === soldBy);
    }
    return list.map((sale: any) => {
      return mapSaleWithRelations(sale, MOCK_USERS, MOCK_CUSTOMERS);
    }).sort((a: any, b: any) => new Date(b.createdAt || Date.now()).getTime() - new Date(a.createdAt || Date.now()).getTime());
  }

  // Construir condiciones WHERE
  const conditions: any[] = [];
  if (branchId) {
    conditions.push(or(eq(sales.branchId, branchId), isNull(sales.branchId)));
  }
  if (soldBy) {
    conditions.push(eq(sales.soldBy, soldBy));
  }

  let rawSalesQuery = db.select().from(sales).$dynamic();
  if (conditions.length === 1) {
    rawSalesQuery = rawSalesQuery.where(conditions[0]);
  } else if (conditions.length > 1) {
    rawSalesQuery = rawSalesQuery.where(and(...conditions));
  }

  const [rawSales, usersList, customersList, branchesList] = await Promise.all([
    rawSalesQuery,
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({ id: customers.id, name: customers.name, clientNumber: customers.clientNumber }).from(customers),
    db.select({ id: branches.id, name: branches.name }).from(branches),
  ]);

  return toPlainObject(rawSales
    .map((sale: any) => mapSaleWithRelations(sale, usersList, customersList, branchesList))
    .sort((a: any, b: any) => new Date(b.createdAt || Date.now()).getTime() - new Date(a.createdAt || Date.now()).getTime()));
}

export async function getSaleById(saleId: number) {
  const db = await getDb();
  if (!db) {
    const sale = MOCK_SALES.find((entry: any) => entry.id === saleId);
    return sale ? toPlainObject(mapSaleWithRelations(sale, MOCK_USERS, MOCK_CUSTOMERS, MOCK_BRANCHES)) : null;
  }

  const [result, usersList, customersList, branchesList] = await Promise.all([
    db.select().from(sales).where(eq(sales.id, saleId)).limit(1),
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({
      id: customers.id,
      name: customers.name,
      clientNumber: customers.clientNumber,
      phone: customers.phone,
      whatsapp: customers.whatsapp,
      taxId: customers.taxId,
      address: customers.address
    }).from(customers),
    db.select({ id: branches.id, name: branches.name }).from(branches),
  ]);

  return result[0] ? toPlainObject(mapSaleWithRelations(result[0], usersList, customersList, branchesList)) : null;
}

export async function getSaleItemsBySaleId(saleId: number) {
  const db = await getDb();
  if (!db) {
    const items = MOCK_SALE_ITEMS.filter((i: any) => i.saleId === saleId);
    return items.map((item: any) => {
      const productRef = item.unitId ?? item.productId;
      const unit = MOCK_UNITS.find((u: any) => u.id === productRef);
      if (unit) {
        const name = `${unit.brand ?? ""} ${unit.model ?? ""}`.trim() || unit.code || `Unidad #${productRef}`;
        return { ...item, productName: name, productCode: unit.code || "", unitType: "PZA" };
      }
      return { ...item, productName: `Producto #${productRef ?? "?"}`, productCode: "", unitType: "PZA" };
    });
  }
  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));
  const resolved = await Promise.all(items.map(async (item: any) => {
    let name = item.productName;
    let code = item.productCode || "";
    let specs = null;
    let condition = null;
    let damageNotes = null;
    let foundUnit = false;
    const uId = item.unitId ?? item.productId;
    if (uId) {
      const unit = await db.select({ 
        brand: units.brand, 
        model: units.model, 
        code: units.code,
        specs: units.specs,
        condition: units.condition,
        damageNotes: units.damageNotes
      }).from(units).where(eq(units.id, uId)).limit(1);
      const u = unit[0];
      if (u) {
        foundUnit = true;
        name = `${u.brand || ""} ${u.model || ""}`.trim() || u.code || `Unidad #${uId}`;
        code = u.code || "";
        specs = u.specs;
        condition = u.condition;
        damageNotes = u.damageNotes;
      }
    }
    // Si no se encontro la unidad en el catalogo, marcar como huerfano
    return {
      ...item,
      productName: name || `Articulo #${item.id}`,
      productCode: code,
      specs,
      condition,
      damageNotes,
      unitType: "PZA",
      _orphan: !foundUnit && !!(uId),
    };
  }));
  // Se devuelven todos los items (incluyendo huerfanos) para preservar el historial completo de ventas.
  return toPlainObject(resolved);
}

export async function getOnOrderQuantities() {
  const db = await getDb();
  if (!db) {
    const result: Record<number, number> = {};
    MOCK_ORDER_ITEMS.forEach(item => {
      const order = MOCK_ORDERS.find(o => o.id === item.orderId);
      if (order && !['delivered', 'cancelled'].includes(order.status)) {
        const uId = item.unitId || item.productId;
        result[uId] = (result[uId] || 0) + item.quantity;
      }
    });
    return result;
  }

  const rows = await db
    .select({
      unitId: orderItems.unitId,
      totalQuantity: sql<number>`cast(sum(${orderItems.quantity}) as signed)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      ne(orders.status, 'delivered'),
      ne(orders.status, 'cancelled')
    ))
    .groupBy(orderItems.unitId);

  const result: Record<number, number> = {};
  rows.forEach((row: any) => {
    result[row.unitId] = Number(row.totalQuantity);
  });
  return result;
}

// Cargar datos persistentes al iniciar el servidor en modo demo
loadMocks();

// Limpiar todos los datos (excepto administrador) al iniciar
export function clearAllData() {
  console.log("[DB] Clearing all data, keeping only admin user...");

  // Limpiar arrays de datos
  MOCK_CUSTOMERS.length = 0;
  MOCK_PRODUCTS.length = 0;
  MOCK_INVENTORY.length = 0;
  MOCK_ORDERS.length = 0;
  MOCK_ORDER_ITEMS.length = 0;
  MOCK_PAYMENTS.length = 0;
  MOCK_MOVEMENTS.length = 0;
  MOCK_SUPPLIERS.length = 0;
  MOCK_PURCHASES.length = 0;
  MOCK_PURCHASE_ITEMS.length = 0;
  MOCK_ACCOUNTS_PAYABLE.length = 0;
  MOCK_DELIVERY_EXPENSES.length = 0;
  MOCK_OPERATIONAL_EXPENSES.length = 0;
  MOCK_FINANCIAL_TRANSACTIONS.length = 0;
  MOCK_CASH_CLOSURES.length = 0;
  MOCK_CASH_OPENINGS.length = 0;
  MOCK_SALES.length = 0;
  MOCK_SALE_ITEMS.length = 0;
  MOCK_QUOTATIONS.length = 0;
  MOCK_QUOTATION_ITEMS.length = 0;

  console.log("[DB] All data cleared successfully. Only admin user remains.");
}

// ------------------------------------------------------------------
// COTIZACIONES (Quotations)
// ------------------------------------------------------------------

export async function getNextQuotationNumber() {
  const db = await getDb();
  const today = new Date();
  const dateStr = `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}`;

  if (!db) {
    const todayQuotes = MOCK_QUOTATIONS.filter(q => q.quotationNumber?.includes(dateStr));
    return `COT-${dateStr}-${pad2(todayQuotes.length + 1)}`;
  }

  const result = await db.select({ quotationNumber: quotations.quotationNumber })
    .from(quotations)
    .where(sql`${quotations.quotationNumber} LIKE ${`COT-${dateStr}-%`}`)
    .orderBy(desc(quotations.quotationNumber))
    .limit(1);

  let nextSequence = 1;
  if (result.length > 0 && result[0].quotationNumber) {
    const parts = result[0].quotationNumber.split('-');
    if (parts.length === 3) {
      nextSequence = parseInt(parts[2], 10) + 1;
    }
  }

  return `COT-${dateStr}-${pad2(nextSequence)}`;
}

export async function createQuotationWithItems(data: InsertQuotation & { items: InsertQuotationItem[] }) {
  const db = await getDb();
  if (!db) {
    const existingIds = MOCK_QUOTATIONS.map((q: any) => q.id).filter((n: any) => typeof n === "number");
    const newId = (existingIds.length ? Math.max(...existingIds) : 0) + 1;
    const { items, ...quotationData } = data;
    const newQuotation = {
      ...quotationData,
      id: newId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    MOCK_QUOTATIONS.push(newQuotation);

    const itemExistingIds = MOCK_QUOTATION_ITEMS.map((it: any) => it.id).filter((n: any) => typeof n === "number");
    let nextItemId = (itemExistingIds.length ? Math.max(...itemExistingIds) : 0) + 1;
    items.forEach((item, index) => {
      MOCK_QUOTATION_ITEMS.push({
        ...item,
        id: nextItemId++,
        quotationId: newId,
        createdAt: new Date()
      });
    });

    syncMocksToDisk();
    return { insertId: newId, quotationNumber: newQuotation.quotationNumber };
  }

  let quotationId: number = 0;

  await db.transaction(async (tx: any) => {
    const { items, ...quotationData } = data;
    const result = await tx.insert(quotations).values(quotationData);
    quotationId = getInsertId(result);

    if (items && items.length > 0) {
      const itemsToInsert = items.map((item) => ({
        ...item,
        quotationId,
      }));
      await tx.insert(quotationItems).values(itemsToInsert);
    }
  });

  return { insertId: quotationId, quotationNumber: data.quotationNumber };
}

export async function getAllQuotations() {
  const db = await getDb();
  if (!db) {
    const toMs = (v: any): number => {
      if (v instanceof Date) return v.getTime();
      if (typeof v === "string" || typeof v === "number") return new Date(v).getTime();
      return 0;
    };
    return MOCK_QUOTATIONS.map(q => {
      const customer = MOCK_CUSTOMERS.find(c => c.id === q.customerId);
      const creator = MOCK_USERS.find(u => u.id === q.createdBy);
      const createdAt = q.createdAt instanceof Date ? q.createdAt : new Date(q.createdAt);
      const updatedAt = q.updatedAt instanceof Date ? q.updatedAt : new Date(q.updatedAt);
      return {
        ...q,
        createdAt,
        updatedAt,
        customerDisplayName: customer ? customer.name : q.customerName,
        creatorName: creator ? creator.name : "Desconocido"
      };
    }).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }

  const result = await db.select({
    ...quotations,
    customerDisplayName: sql<string>`COALESCE(${customers.name}, ${quotations.customerName})`,
    creatorName: users.name,
  })
    .from(quotations)
    .leftJoin(customers, eq(quotations.customerId, customers.id))
    .leftJoin(users, eq(quotations.createdBy, users.id))
    .orderBy(desc(quotations.createdAt));

  return result;
}

export async function getQuotationById(quotationId: number) {
  const db = await getDb();
  if (!db) {
    const q = MOCK_QUOTATIONS.find(q => q.id === quotationId);
    if (!q) return undefined;
    const customer = MOCK_CUSTOMERS.find(c => c.id === q.customerId);
    const creator = MOCK_USERS.find(u => u.id === q.createdBy);
    return {
      ...q,
      customerDisplayName: customer ? customer.name : q.customerName,
      creatorName: creator ? creator.name : "Desconocido"
    };
  }

  const result = await db.select({
    ...quotations,
    customerDisplayName: sql<string>`COALESCE(${customers.name}, ${quotations.customerName})`,
    creatorName: users.name,
  })
    .from(quotations)
    .leftJoin(customers, eq(quotations.customerId, customers.id))
    .leftJoin(users, eq(quotations.createdBy, users.id))
    .where(eq(quotations.id, quotationId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getQuotationItemsByQuotationId(quotationId: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_QUOTATION_ITEMS
      .filter((item: any) => item.quotationId === quotationId)
      .map((item: any) => {
        const productRef = item.unitId ?? item.productId;
        const unit = MOCK_UNITS.find((u: any) => u.id === productRef);
        const createdAt = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
        return {
          ...item,
          createdAt,
          productName: unit ? `${unit.brand} ${unit.model}`.trim() : "Unidad desconocida",
          productCode: unit ? unit.code : "N/A",
          specs: unit ? unit.specs : null,
          type: unit ? unit.type : "other",
          condition: unit ? unit.condition : null,
          batteryHealth: unit ? unit.batteryHealth : null,
        };
      });
  }

  const items = await db.select().from(quotationItems).where(eq(quotationItems.quotationId, quotationId));
  return await Promise.all(items.map(async (item: any) => {
    const unit = item.unitId ? await db.select({ 
        brand: units.brand, 
        model: units.model, 
        code: units.code,
        specs: units.specs,
        type: units.type,
        condition: units.condition,
        batteryHealth: units.batteryHealth 
    }).from(units).where(eq(units.id, item.unitId)).limit(1) : [];
    const u = unit[0];
    return {
      ...item,
      productName: u ? `${u.brand} ${u.model}`.trim() : `Unidad #${item.unitId || item.productId || "?"}`,
      productCode: u?.code || "N/A",
      specs: u?.specs || null,
      type: u?.type || "other",
      condition: u?.condition || null,
      batteryHealth: u?.batteryHealth || null,
    };
  }));
}

export async function updateQuotationStatus(quotationId: number, status: "pending" | "accepted" | "rejected") {
  const db = await getDb();
  if (!db) {
    const index = MOCK_QUOTATIONS.findIndex(q => q.id === quotationId);
    if (index !== -1) {
      MOCK_QUOTATIONS[index].status = status;
      MOCK_QUOTATIONS[index].updatedAt = new Date();
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }

  await db.update(quotations).set({ status, updatedAt: new Date() }).where(eq(quotations.id, quotationId));
  return { success: true };
}

// =============================================
// Carga Extra de Repartidores (OBSOLETO - tabla eliminada en pivote a electrónica)
// =============================================
export async function assignDeliveryExtraLoad(data: any) {
  return { success: false, message: "Módulo de carga extra no aplica para electrónica." };
}

export async function getDeliveryExtraLoad(deliveryPersonId: number, date: string) {
  return [];
}

export async function updateDeliveryExtraLoadStatus(id: number, status: string, userId: number) {
  return { success: false, message: "Módulo de carga extra no aplica para electrónica." };
}

// =============================================
// Alertas Inteligentes (adaptado a unidades/electronics)
// =============================================
export async function getSmartInventoryAlerts() {
  const db = await getDb();
  if (!db) return [];

  // Unidades sin precio de venta
  const unpriced = await db
    .select({ id: units.id, brand: units.brand, model: units.model, status: units.status })
    .from(units)
    .where(sql`${units.salePrice} IS NULL AND ${units.status} = 'available'`);

  return unpriced.map((u: any) => ({
    unitId: u.id,
    productName: `${u.brand} ${u.model}`,
    status: "warning",
    message: "Unidad disponible sin precio de venta asignado",
  }));
}

// Branches
export async function getAllBranches() {
  const db = await getDb();
  if (!db) {
    return MOCK_BRANCHES;
  }
  // Auto-ensure Sucursal Principal (id=1) always exists
  try {
    const pool = _pool!;
    await pool.execute(
      "INSERT INTO branches (id, name, address, phone, isMainWarehouse, status, createdAt, updatedAt) " +
      "VALUES (1, 'Sucursal Principal', 'Casa Central', '', 1, 'active', NOW(), NOW()) " +
      "ON DUPLICATE KEY UPDATE status = COALESCE(status, 'active')"
    );
  } catch { /* already exists or table issue — ignore */ }

  const rows = await db.select().from(branches);
  return toPlainObject(rows);
}

export async function createBranch(data: any) {
  const db = await getDb();
  if (!db) {
    const newId = MOCK_BRANCHES.length + 1;
    const newBranch = { ...data, id: newId, createdAt: new Date(), updatedAt: new Date() };
    MOCK_BRANCHES.push(newBranch);
    syncMocksToDisk();
    return { insertId: newId };
  }
  
  const result = await db.insert(branches).values(data);
  return { insertId: Number(result[0]?.insertId ?? (result as any).insertId ?? 0) };
}

export async function updateBranch(id: number, data: any) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_BRANCHES.findIndex((b) => b.id === id);
    if (index !== -1) {
      MOCK_BRANCHES[index] = { ...MOCK_BRANCHES[index], ...data, updatedAt: new Date() };
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }
  
  await db.update(branches).set(data).where(eq(branches.id, id));
  return { success: true };
}

export async function getBranchById(id: number) {
  const db = await getDb();
  if (!db) {
    return MOCK_BRANCHES.find((b) => b.id === id);
  }
  const result = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
  return result.length > 0 ? toPlainObject(result[0]) : null;
}

export async function deleteBranch(id: number) {
  const db = await getDb();
  if (!db) {
    const index = MOCK_BRANCHES.findIndex((b) => b.id === id);
    if (index !== -1) {
      MOCK_BRANCHES.splice(index, 1);
      syncMocksToDisk();
      return { success: true };
    }
    return { success: false };
  }
  
  await db.delete(branches).where(eq(branches.id, id));
  return { success: true };
}

// ----------------------------------------------------
// CUENTAS POR COBRAR (CXC) & CUENTAS POR PAGAR (CXP)
// ----------------------------------------------------

export async function getCustomerCreditStatus(customerId: number) {
  const db = await getDb();
  if (!db) {
    const customer = MOCK_CUSTOMERS.find((c: any) => c.id === customerId);
    if (!customer) return null;

    const customerARs = MOCK_ACCOUNTS_RECEIVABLE.filter((ar: any) => ar.customerId === customerId && ar.status !== "paid");
    const currentDebt = customerARs.reduce((sum: number, ar: any) => sum + (ar.balance || 0), 0);
    
    const todayStr = getLocalDateKey(new Date()) || new Date().toISOString().split("T")[0];
    const overdueARs = customerARs.filter((ar: any) => ar.dueDate && ar.dueDate < todayStr);
    const overdueAmount = overdueARs.reduce((sum: number, ar: any) => sum + (ar.balance || 0), 0);

    const creditLimit = customer.creditLimit || 0;
    const availableCredit = Math.max(0, creditLimit - currentDebt);
    const hasOverdue = overdueAmount > 0;
    const allowCredit = customer.allowCredit !== 0;

    return {
      customer,
      creditLimit,
      creditDays: customer.creditDays || 30,
      currentDebt,
      availableCredit,
      overdueAmount,
      hasOverdue,
      allowCredit,
    };
  }

  // Modo DB
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return null;

  const customerARs = await db
    .select()
    .from(accountsReceivable)
    .where(and(eq(accountsReceivable.customerId, customerId), ne(accountsReceivable.status, "paid")));

  const currentDebt = customerARs.reduce((sum: number, ar: any) => sum + (ar.balance || 0), 0);
  const todayStr = getLocalDateKey(new Date()) || new Date().toISOString().split("T")[0];
  const overdueARs = customerARs.filter((ar: any) => ar.dueDate && ar.dueDate < todayStr);
  const overdueAmount = overdueARs.reduce((sum: number, ar: any) => sum + (ar.balance || 0), 0);

  const creditLimit = customer.creditLimit || 0;
  const availableCredit = Math.max(0, creditLimit - currentDebt);
  const hasOverdue = overdueAmount > 0;
  const allowCredit = customer.allowCredit !== 0;

  return {
    customer,
    creditLimit,
    creditDays: customer.creditDays || 30,
    currentDebt,
    availableCredit,
    overdueAmount,
    hasOverdue,
    allowCredit,
  };
}

export async function getAllAccountsReceivable() {
  const todayStr = getLocalDateKey(new Date()) || new Date().toISOString().split("T")[0];
  const db = await getDb();
  
  if (!db) {
    return MOCK_ACCOUNTS_RECEIVABLE.map((ar: any) => {
      const customer = MOCK_CUSTOMERS.find((c: any) => c.id === ar.customerId);
      const sale = MOCK_SALES.find((s: any) => s.id === ar.saleId);
      
      let status = ar.status;
      if (status !== "paid" && ar.dueDate && ar.dueDate < todayStr) {
        status = "overdue";
      }

      return {
        ...ar,
        status,
        customerName: customer?.name || sale?.customerName || "Anónimo",
        customerPhone: customer?.phone || null,
        customerTaxId: customer?.taxId || null,
        saleNumber: sale?.saleNumber || `VTA-${ar.saleId}`,
      };
    });
  }

  // Modo DB
  const rows = await db
    .select({
      id: accountsReceivable.id,
      saleId: accountsReceivable.saleId,
      customerId: accountsReceivable.customerId,
      totalAmount: accountsReceivable.totalAmount,
      paidAmount: accountsReceivable.paidAmount,
      balance: accountsReceivable.balance,
      dueDate: accountsReceivable.dueDate,
      status: accountsReceivable.status,
      adminOverrideUserId: accountsReceivable.adminOverrideUserId,
      adminOverrideReason: accountsReceivable.adminOverrideReason,
      createdAt: accountsReceivable.createdAt,
      updatedAt: accountsReceivable.updatedAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerTaxId: customers.taxId,
      saleNumber: sales.saleNumber,
    })
    .from(accountsReceivable)
    .leftJoin(customers, eq(accountsReceivable.customerId, customers.id))
    .leftJoin(sales, eq(accountsReceivable.saleId, sales.id))
    .orderBy(desc(accountsReceivable.id));

  return toPlainObject(rows.map((ar: any) => {
    let status = ar.status;
    if (status !== "paid" && ar.dueDate && ar.dueDate < todayStr) {
      status = "overdue";
    }

    return {
      ...ar,
      status,
      customerName: ar.customerName || "Anónimo",
      saleNumber: ar.saleNumber || `VTA-${ar.saleId}`,
    };
  }));
}

export async function getAllAccountsPayable() {
  const todayStr = getLocalDateKey(new Date()) || new Date().toISOString().split("T")[0];
  const db = await getDb();

  if (!db) {
    return MOCK_ACCOUNTS_PAYABLE.map((ap: any) => {
      const supplier = MOCK_SUPPLIERS.find((s: any) => s.id === ap.supplierId);
      const purchase = MOCK_PURCHASES.find((p: any) => p.id === ap.purchaseId);

      const totalAmount = ap.totalAmount !== undefined ? ap.totalAmount : (ap.amount || 0);
      const paidAmount = ap.paidAmount !== undefined ? ap.paidAmount : 0;
      const balance = ap.balance !== undefined ? ap.balance : (totalAmount - paidAmount);

      let status = ap.status;
      if (status !== "paid" && ap.dueDate && ap.dueDate < todayStr) {
        status = "overdue";
      }

      return {
        ...ap,
        totalAmount,
        paidAmount,
        balance,
        status,
        supplierName: supplier?.name || "Proveedor Sistema",
        supplierPhone: supplier?.phone || null,
        purchaseNumber: purchase?.purchaseNumber || ap.purchaseNumber || `CMP-${ap.purchaseId}`,
      };
    });
  }

  // Modo DB
  const rows = await db
    .select({
      id: accountsPayable.id,
      purchaseId: accountsPayable.purchaseId,
      supplierId: accountsPayable.supplierId,
      totalAmount: accountsPayable.totalAmount,
      paidAmount: accountsPayable.paidAmount,
      balance: accountsPayable.balance,
      dueDate: accountsPayable.dueDate,
      status: accountsPayable.status,
      createdAt: accountsPayable.createdAt,
      updatedAt: accountsPayable.updatedAt,
      supplierName: suppliers.name,
      supplierPhone: suppliers.phone,
      purchaseNumber: purchases.purchaseNumber,
    })
    .from(accountsPayable)
    .leftJoin(suppliers, eq(accountsPayable.supplierId, suppliers.id))
    .leftJoin(purchases, eq(accountsPayable.purchaseId, purchases.id))
    .orderBy(desc(accountsPayable.id));

  return toPlainObject(rows.map((ap: any) => {
    let status = ap.status;
    if (status !== "paid" && ap.dueDate && ap.dueDate < todayStr) {
      status = "overdue";
    }

    return {
      ...ap,
      status,
      supplierName: ap.supplierName || "Proveedor Sistema",
      purchaseNumber: ap.purchaseNumber || `CMP-${ap.purchaseId}`,
    };
  }));
}

export async function createCreditPayment(data: {
  type: "receivable" | "payable";
  accountsReceivableId?: number;
  accountsPayableId?: number;
  amount: number;
  paymentMethod: "cash" | "qr" | "transfer";
  notes?: string;
  userId: number;
}) {
  const db = await getDb();

  if (!db) {
    const receiptNumber = `REC-${String(MOCK_CREDIT_PAYMENTS.length + 1).padStart(4, "0")}`;
    
    if (data.type === "receivable") {
      const ar = MOCK_ACCOUNTS_RECEIVABLE.find((item: any) => item.id === data.accountsReceivableId);
      if (!ar) throw new Error("Cuenta por cobrar no encontrada");
      if (ar.balance <= 0) throw new Error("Esta cuenta por cobrar ya se encuentra totalmente saldada");

      const paymentAmount = Math.min(data.amount, ar.balance);
      ar.paidAmount += paymentAmount;
      ar.balance -= paymentAmount;
      ar.status = ar.balance <= 0 ? "paid" : "partially_paid";
      ar.updatedAt = new Date();

      const paymentId = MOCK_CREDIT_PAYMENTS.length + 1;
      const payment = {
        id: paymentId,
        type: "receivable",
        accountsReceivableId: ar.id,
        customerId: ar.customerId,
        amount: paymentAmount,
        paymentMethod: data.paymentMethod,
        notes: data.notes || null,
        userId: data.userId,
        receiptNumber,
        createdAt: new Date(),
      };
      MOCK_CREDIT_PAYMENTS.push(payment);

      await createFinancialTransaction({
        type: "income",
        category: "ar_payment",
        amount: paymentAmount,
        referenceId: ar.id,
        notes: `Cobro de CXC (${receiptNumber}) - Venta #${ar.saleId}`,
        paymentMethod: data.paymentMethod,
        userId: data.userId,
      });

      syncMocksToDisk();
      return payment;
    } else {
      const ap = MOCK_ACCOUNTS_PAYABLE.find((item: any) => item.id === data.accountsPayableId);
      if (!ap) throw new Error("Cuenta por pagar no encontrada");

      if (ap.totalAmount === undefined) ap.totalAmount = ap.amount || 0;
      if (ap.paidAmount === undefined) ap.paidAmount = 0;
      if (ap.balance === undefined) ap.balance = ap.totalAmount - ap.paidAmount;

      if (ap.balance <= 0) throw new Error("Esta cuenta por pagar ya se encuentra totalmente saldada");

      const paymentAmount = Math.min(data.amount, ap.balance);
      ap.paidAmount += paymentAmount;
      ap.balance -= paymentAmount;
      ap.status = ap.balance <= 0 ? "paid" : "partially_paid";
      ap.updatedAt = new Date();

      const paymentId = MOCK_CREDIT_PAYMENTS.length + 1;
      const payment = {
        id: paymentId,
        type: "payable",
        accountsPayableId: ap.id,
        supplierId: ap.supplierId,
        amount: paymentAmount,
        paymentMethod: data.paymentMethod,
        notes: data.notes || null,
        userId: data.userId,
        receiptNumber,
        createdAt: new Date(),
      };
      MOCK_CREDIT_PAYMENTS.push(payment);

      await createFinancialTransaction({
        type: "expense",
        category: "ap_payment",
        amount: paymentAmount,
        referenceId: ap.id,
        notes: `Pago de CXP (${receiptNumber}) - Compra #${ap.purchaseId}`,
        paymentMethod: data.paymentMethod,
        userId: data.userId,
      });

      syncMocksToDisk();
      return payment;
    }
  }

  // Modo DB real en MySQL con transacción atómica
  return await db.transaction(async (tx: any) => {
    const [countResult] = await tx.select({ count: sql<number>`count(*)` }).from(creditPayments);
    const totalCount = Number(countResult?.count || 0);
    const receiptNumber = `REC-${String(totalCount + 1).padStart(4, "0")}`;

    if (data.type === "receivable") {
      const [ar] = await tx
        .select()
        .from(accountsReceivable)
        .where(eq(accountsReceivable.id, data.accountsReceivableId!))
        .limit(1);

      if (!ar) throw new Error("Cuenta por cobrar no encontrada");
      if (ar.balance <= 0) throw new Error("Esta cuenta por cobrar ya se encuentra totalmente saldada");

      const paymentAmount = Math.min(data.amount, ar.balance);
      const newPaidAmount = (ar.paidAmount || 0) + paymentAmount;
      const newBalance = Math.max(0, ar.balance - paymentAmount);
      const newStatus = newBalance <= 0 ? "paid" : "partially_paid";

      await tx
        .update(accountsReceivable)
        .set({
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(accountsReceivable.id, ar.id));

      const paymentInsertResult = await tx.insert(creditPayments).values({
        type: "receivable",
        accountsReceivableId: ar.id,
        customerId: ar.customerId,
        amount: paymentAmount,
        paymentMethod: data.paymentMethod,
        notes: data.notes || null,
        userId: data.userId,
        receiptNumber,
      });
      const paymentId = getInsertId(paymentInsertResult);

      // Obtener branchId de la venta asociada
      let saleBranchId = 1;
      if (ar.saleId) {
        const [saleRow] = await tx.select({ branchId: sales.branchId }).from(sales).where(eq(sales.id, ar.saleId)).limit(1);
        if (saleRow) saleBranchId = saleRow.branchId || 1;
      }

      await tx.insert(financialTransactions).values({
        branchId: saleBranchId,
        type: "income",
        category: "ar_payment",
        amount: paymentAmount,
        referenceId: ar.id,
        notes: `Cobro de CXC (${receiptNumber}) - Venta #${ar.saleId}`,
        paymentMethod: data.paymentMethod,
        userId: data.userId,
      });

      return {
        id: paymentId,
        type: "receivable",
        accountsReceivableId: ar.id,
        customerId: ar.customerId,
        amount: paymentAmount,
        paymentMethod: data.paymentMethod,
        notes: data.notes || null,
        userId: data.userId,
        receiptNumber,
        createdAt: new Date(),
      };
    } else {
      const [ap] = await tx
        .select()
        .from(accountsPayable)
        .where(eq(accountsPayable.id, data.accountsPayableId!))
        .limit(1);

      if (!ap) throw new Error("Cuenta por pagar no encontrada");
      if (ap.balance <= 0) throw new Error("Esta cuenta por pagar ya se encuentra totalmente saldada");

      const paymentAmount = Math.min(data.amount, ap.balance);
      const newPaidAmount = (ap.paidAmount || 0) + paymentAmount;
      const newBalance = Math.max(0, ap.balance - paymentAmount);
      const newStatus = newBalance <= 0 ? "paid" : "partially_paid";

      await tx
        .update(accountsPayable)
        .set({
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(accountsPayable.id, ap.id));

      const paymentInsertResult = await tx.insert(creditPayments).values({
        type: "payable",
        accountsPayableId: ap.id,
        supplierId: ap.supplierId,
        amount: paymentAmount,
        paymentMethod: data.paymentMethod,
        notes: data.notes || null,
        userId: data.userId,
        receiptNumber,
      });
      const paymentId = getInsertId(paymentInsertResult);

      // Obtener branchId de la compra asociada
      let purchaseBranchId = 1;
      if (ap.purchaseId) {
        const [purchaseRow] = await tx.select({ branchId: purchases.branchId }).from(purchases).where(eq(purchases.id, ap.purchaseId)).limit(1);
        if (purchaseRow) purchaseBranchId = purchaseRow.branchId || 1;
      }

      await tx.insert(financialTransactions).values({
        branchId: purchaseBranchId,
        type: "expense",
        category: "ap_payment",
        amount: paymentAmount,
        referenceId: ap.id,
        notes: `Pago de CXP (${receiptNumber}) - Compra #${ap.purchaseId}`,
        paymentMethod: data.paymentMethod,
        userId: data.userId,
      });

      return {
        id: paymentId,
        type: "payable",
        accountsPayableId: ap.id,
        supplierId: ap.supplierId,
        amount: paymentAmount,
        paymentMethod: data.paymentMethod,
        notes: data.notes || null,
        userId: data.userId,
        receiptNumber,
        createdAt: new Date(),
      };
    }
  });
}

export async function getAllCreditPayments() {
  const db = await getDb();
  if (!db) {
    return MOCK_CREDIT_PAYMENTS.map((p: any) => {
      const user = MOCK_USERS.find((u: any) => u.id === p.userId);
      const customer = p.customerId ? MOCK_CUSTOMERS.find((c: any) => c.id === p.customerId) : null;
      const supplier = p.supplierId ? MOCK_SUPPLIERS.find((s: any) => s.id === p.supplierId) : null;
      return {
        ...p,
        userName: user?.name || "Desconocido",
        entityName: customer?.name || supplier?.name || "N/A",
      };
    });
  }

  // Modo DB
  const rows = await db
    .select({
      id: creditPayments.id,
      type: creditPayments.type,
      accountsReceivableId: creditPayments.accountsReceivableId,
      accountsPayableId: creditPayments.accountsPayableId,
      customerId: creditPayments.customerId,
      supplierId: creditPayments.supplierId,
      amount: creditPayments.amount,
      paymentMethod: creditPayments.paymentMethod,
      reference: creditPayments.reference,
      notes: creditPayments.notes,
      userId: creditPayments.userId,
      receiptNumber: creditPayments.receiptNumber,
      createdAt: creditPayments.createdAt,
      userName: users.name,
      customerName: customers.name,
      supplierName: suppliers.name,
    })
    .from(creditPayments)
    .leftJoin(users, eq(creditPayments.userId, users.id))
    .leftJoin(customers, eq(creditPayments.customerId, customers.id))
    .leftJoin(suppliers, eq(creditPayments.supplierId, suppliers.id))
    .orderBy(desc(creditPayments.id));

  return toPlainObject(rows.map((p: any) => ({
    ...p,
    userName: p.userName || "Desconocido",
    entityName: p.customerName || p.supplierName || "N/A",
  })));
}


