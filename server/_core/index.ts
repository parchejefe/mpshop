import express from "express";
import bcrypt from "bcrypt";
import fs from "fs/promises";
import { createServer } from "http";
import net from "net";
import multer from "multer";
import mysql from "mysql2/promise";
import path from "path";
import cookieParser from "cookie-parser";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import * as schema from "../../drizzle/schema";
import { ensureTables } from "../../scripts/ensure_tables";
import { csrfMiddleware, validateCSRF, getCSRFTokenEndpoint } from "./csrf";

// Auto-detect DATABASE_URL from Railway or alternative environment variables
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
  const detected =
    process.env.MYSQL_URL?.trim() ||
    process.env.MYSQL_PRIVATE_URL?.trim() ||
    (process.env.MYSQLHOST && process.env.MYSQLUSER
      ? `mysql://${encodeURIComponent(process.env.MYSQLUSER)}:${encodeURIComponent(process.env.MYSQLPASSWORD || "")}@${process.env.MYSQLHOST}:${process.env.MYSQLPORT || 3306}/${process.env.MYSQLDATABASE || "railway"}`
      : undefined);
  if (detected) {
    process.env.DATABASE_URL = detected;
    console.log("[Environment] Auto-detected DATABASE_URL from Railway MySQL variables");
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function saveUploadedFileLocally(fileName: string, buffer: Buffer) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const fullPath = path.join(uploadsDir, fileName);
  await fs.writeFile(fullPath, buffer);
  return `/uploads/${fileName}`;
}

async function runDatabaseMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log("[Database] DATABASE_URL not configured; skipping migrations");
    return;
  }

  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  const pool = mysql.createPool(process.env.DATABASE_URL);
  const db = drizzle(pool, { schema, mode: "default" });

  try {
    console.log("[Database] Running migrations...");
    await migrate(db, { migrationsFolder });
    console.log("[Database] Migrations completed");
  } catch (err: any) {
    console.warn(
      "[Database] Drizzle migrate failed (often due to existing columns). ensureTables will run next to verify schema.",
      err.message
    );
  } finally {
    await pool.end();
  }
}

async function seedDefaultAdmin() {
  if (!process.env.DATABASE_URL) {
    return;
  }

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "MPShop2026Admin!";
  const name = process.env.ADMIN_NAME || "Administrador";
  const email = process.env.ADMIN_EMAIL || "admin@mpshop.local";
  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await connection.query(
      `INSERT INTO users
        (openId, username, passwordHash, name, email, loginMethod, role, status, createdAt, updatedAt, lastSignedIn)
       VALUES (?, ?, ?, ?, ?, 'traditional', 'admin', 'active', NOW(), NOW(), NOW())
       ON DUPLICATE KEY UPDATE
        passwordHash = VALUES(passwordHash),
        status = 'active',
        role = 'admin'`,
      [`local_${username}`, username, passwordHash, name, email]
    );
    console.log(`[Seed] Admin user verified/ready: ${username} (password synced)`);
  } catch (err: any) {
    console.error("[Seed] Error creating admin user:", err.message);
  } finally {
    await connection.end();
  }
}

async function startServer() {
  await runDatabaseMigrations();
  if (process.env.DATABASE_URL) {
    await ensureTables().catch(err =>
      console.error("[StartServer] ensureTables failed:", err)
    );
    
    // Ejecutar migraciones automáticas
    const { getDb } = await import("../db");
    const { runAutoMigrations } = await import("../migrations/auto-migrate");
    const db = await getDb();
    await runAutoMigrations(db).catch(err =>
      console.error("[StartServer] Auto-migrations failed:", err)
    );
  } else {
    console.log("[StartServer] Skipping ensureTables (no DATABASE_URL, running in demo mode)");
  }
  await seedDefaultAdmin();
  if (process.env.DATABASE_URL) {
    const { seedDeviceCatalogs } = await import("../routers/deviceCatalogs");
    await seedDeviceCatalogs().catch(err =>
      console.error("[StartServer] seedDeviceCatalogs failed:", err)
    );
  }


  const app = express();
  const server = createServer(app);
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser()); // Required for CSRF protection
  app.use("/uploads", express.static(uploadsDir));

  // CSRF Protection Middleware (generar tokens)
  app.use(csrfMiddleware);
  
  // Endpoint para obtener token CSRF
  app.get("/api/csrf-token", getCSRFTokenEndpoint);

  const kefirControlDir = path.resolve(
    process.cwd(),
    "client",
    "public",
    "kefir-control"
  );
  const kefirControlIndex = path.join(kefirControlDir, "index.html");
  const rootAppIndex =
    process.env.NODE_ENV === "development"
      ? path.resolve(process.cwd(), "client", "index.html")
      : path.resolve(process.cwd(), "dist", "public", "index.html");

  const setKefirControlCacheHeaders = (
    res: express.Response,
    filePath: string
  ) => {
    const normalizedFilePath = filePath.split(path.sep).join("/");

    if (normalizedFilePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }

    if (normalizedFilePath.endsWith("/index.html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  };

  const sendRootAppIndex = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (process.env.NODE_ENV === "development") {
      next();
      return;
    }

    res.sendFile(rootAppIndex);
  };

  const sendKefirControlIndex = async (
    _req: express.Request,
    res: express.Response
  ) => {
    res.setHeader("Cache-Control", "no-cache");
    try {
      let html = await fs.readFile(kefirControlIndex, 'utf-8');
      
      const { getDb } = await import("../db");
      const db = await getDb();
      let storageData: Record<string, string> = {};
      
      if (db) {
        const pool = (db as any).session?.client || (global as any)._pool;
        if (pool) {
          try {
            // 1. Sincronizar el Inventario de Producción REAL
            const [prodRows] = await pool.execute(`
              SELECT pi.productId as id, p.name, pi.quantity, p.unit, p.category, p.price as costPerUnit,
                     p.presentationQuantity, p.presentationUnit, p.presentationVolumeMl,
                     p.presentationWeightGr, p.productionRole
              FROM production_inventory pi
              INNER JOIN products p ON pi.productId = p.id
            `);

            let sanitizedProd = [];
            if (Array.isArray(prodRows) && prodRows.length > 0) {
              sanitizedProd = prodRows.map((row: any) => ({
                id: row.id,
                name: row.name,
                quantity: row.quantity,
                unit: row.unit || 'uds',
                minStock: 5,
                category: row.category,
                costPerUnit: row.costPerUnit,
                presentationQuantity: row.presentationQuantity || 1,
                presentationUnit: row.presentationUnit || row.unit || 'unidad',
                presentationVolumeMl: row.presentationVolumeMl || 0,
                presentationWeightGr: row.presentationWeightGr || 0,
                productionRole: row.productionRole || 'none',
              }));
            } else {
              // FALLBACK: Si no hay nada en la tabla de inventario, buscamos traspasos completados
              const [transferRows] = await pool.execute(`
                SELECT it.productId as id, p.name, it.quantity, p.unit, p.category, p.price as costPerUnit,
                       p.presentationQuantity, p.presentationUnit, p.presentationVolumeMl,
                       p.presentationWeightGr, p.productionRole
                FROM inventory_transfer_items it
                INNER JOIN inventory_transfers t ON it.transferId = t.id
                INNER JOIN products p ON it.productId = p.id
                WHERE t.direction = 'to_production' AND t.status = 'completed'
              `);

              if (Array.isArray(transferRows)) {
                const agg = new Map();
                for (const row of transferRows) {
                  const current = agg.get(row.id) || {
                    id: row.id, name: row.name, quantity: 0, unit: row.unit || 'uds',
                    minStock: 5, category: row.category, costPerUnit: row.costPerUnit,
                    presentationQuantity: row.presentationQuantity || 1,
                    presentationUnit: row.presentationUnit || row.unit || 'unidad',
                    presentationVolumeMl: row.presentationVolumeMl || 0,
                    presentationWeightGr: row.presentationWeightGr || 0,
                    productionRole: row.productionRole || 'none'
                  };
                  current.quantity += row.quantity;
                  agg.set(row.id, current);
                }
                sanitizedProd = Array.from(agg.values());
              }
            }
            storageData["kefir_inventory_v3"] = JSON.stringify(sanitizedProd);


            // 2. Recuperar el resto de configuraciones legacy de kefir_storage
            const [legacyRows] = await pool.execute('SELECT storage_key, storage_value FROM kefir_storage');
            if (Array.isArray(legacyRows)) {
              for (const row of legacyRows) {
                if (row.storage_key && row.storage_value && row.storage_key !== "kefir_inventory_v3") {
                  storageData[row.storage_key] = row.storage_value;
                }
              }
            }
          } catch (e) {
            console.error("Error reading kefir storage synthesis:", e);
          }
        }
      }
      
      const injection = `
      <script>
        try {
          window.__KEFIR_INITIAL_STATE__ = ${JSON.stringify(storageData)};
          
          // 1. Sincronizar DESDE la nube HACIA el navegador local
          for (const key in window.__KEFIR_INITIAL_STATE__) {
            if (window.__KEFIR_INITIAL_STATE__.hasOwnProperty(key)) {
              if (key.startsWith('kefir_')) {
                localStorage.setItem(key, window.__KEFIR_INITIAL_STATE__[key]);
              }
            }
          }
          
          // 2. Sincronizar DESDE el navegador HACIA la nube (para recuperar datos huérfanos del PC original)
          for (let i = 0; i < localStorage.length; i++) {
            const localKey = localStorage.key(i);
            if (localKey && localKey.startsWith('kefir_')) {
              // Si la nube no tiene esta llave, o es diferente, la subimos
              if (!window.__KEFIR_INITIAL_STATE__[localKey] || window.__KEFIR_INITIAL_STATE__[localKey] !== localStorage.getItem(localKey)) {
                try {
                  fetch("/api/trpc/production.setKefirStorage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 0: { key: localKey, value: localStorage.getItem(localKey) } }),
                  });
                } catch(e) {}
              }
            }
          }
        } catch(e) {
          console.error("Failed to inject and sync kefir storage state", e);
        }
      </script>
      `;
      
      html = html.replace('<head>', '<head>\\n' + injection);
      res.send(html);
    } catch (err) {
      console.error("Error serving kefir control index:", err);
      res.sendFile(kefirControlIndex);
    }
  };
  app.use(
    "/kefir-control",
    express.static(kefirControlDir, {
      index: false,
      setHeaders: setKefirControlCacheHeaders,
    })
  );
  app.get("/kefir-control", sendKefirControlIndex);
  app.get("/kefir-control/index.html", sendKefirControlIndex);
  app.get("/preview/kefir-control", sendRootAppIndex);
  app.get("/preview/kefir-control/index.html", sendRootAppIndex);
  app.get("/preview/kefir-control/inventory", sendRootAppIndex);
  app.get("/preview/kefir-control/kardex", sendRootAppIndex);
  app.get("/preview/kefir-control/lotes", sendRootAppIndex);
  app.get(/^\/preview\/kefir-control(?:\/.*)?$/, (req, res, next) => {
    const relativePath = req.path.replace(/^\/preview\/kefir-control\/?/, "");
    if (
      !relativePath ||
      relativePath === "index.html" ||
      !path.extname(relativePath)
    ) {
      if (process.env.NODE_ENV === "development") {
        next();
        return;
      }

      res.sendFile(rootAppIndex);
      return;
    }
    next();
  });
  app.get(/^\/kefir-control(?:\/.*)?$/, (req, res, next) => {
    const relativePath = req.path.replace(/^\/kefir-control\/?/, "");
    if (
      !relativePath ||
      relativePath === "index.html" ||
      !path.extname(relativePath)
    ) {
      sendKefirControlIndex(req, res);
      return;
    }
    next();
  });

  // Configurar multer para upload de imágenes
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith("image/")) {
        cb(null, true);
      } else {
        cb(new Error("Solo se permiten archivos de imagen"));
      }
    },
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Image upload endpoint
  app.post("/api/upload-image", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const extension = req.file.mimetype.split("/")[1] || "jpg";
      const fileName = `product-${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;

      let url: string;

      try {
        const { storagePut } = await import("../storage");
        const uploaded = await storagePut(
          fileName,
          req.file.buffer,
          req.file.mimetype
        );
        url = uploaded.url;
      } catch (error) {
        console.warn("Falling back to local upload storage:", error);
        url = await saveUploadedFileLocally(fileName, req.file.buffer);
      }

      res.json({ url, success: true });
    } catch (error) {
      console.error("Error uploading image:", error);
      res.status(500).json({ error: "Error al subir la imagen" });
    }
  });

  // Version endpoint for deployment verification
  const APP_VERSION = "1.5.0";
  app.get("/api/version", (_req, res) => {
    res.json({
      version: APP_VERSION,
      buildTime: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV,
    });
  });

  app.get("/api/debug-db-status", async (_req, res) => {
    const { getDb, getDbInitError } = await import("../db");
    const db = await getDb();
    let sellerCashTable = false;
    let sellerColumns: any = [];
    try {
      const mysql = await import("mysql2/promise");
      if (process.env.DATABASE_URL) {
        const conn = await mysql.default.createConnection(process.env.DATABASE_URL);
        const [rows]: any = await conn.query("SHOW TABLES LIKE 'seller_cash_registers'");
        sellerCashTable = rows.length > 0;
        if (sellerCashTable) {
          const [cols]: any = await conn.query("SHOW COLUMNS FROM seller_cash_registers");
          sellerColumns = cols.map((c: any) => c.Field);
        }
        await conn.end();
      }
    } catch (e: any) {
      sellerColumns = [e.message];
    }
    res.json({
      dbConnected: !!db,
      envHasDatabaseUrl: !!process.env.DATABASE_URL,
      databaseUrlStart: process.env.DATABASE_URL
        ? process.env.DATABASE_URL.substring(0, 15)
        : "missing",
      initError: getDbInitError(),
      sellerCashTable,
      sellerColumns,
      version: "v1.5.1-cash-fix"
    });
  });

  // Debug endpoint for order items table structure
  app.get("/api/debug-order-tables", async (_req, res) => {
    try {
      const mysql = await import("mysql2/promise");
      const connection = await mysql.default.createConnection(process.env.DATABASE_URL!);

      // Check orderItems table structure
      const [orderItemsColumns] = await connection.query("DESCRIBE orderItems");
      const [ordersColumns] = await connection.query("DESCRIBE orders");

      // Check if there are any orders
      const [orders] = await connection.query("SELECT id, orderNumber FROM orders ORDER BY id DESC LIMIT 10");

      // Check if there are any orderItems
      const [orderItems] = await connection.query("SELECT id, orderId, productId FROM orderItems ORDER BY id DESC LIMIT 10");

      await connection.end();

      res.json({
        orderItemsColumns,
        ordersColumns,
        recentOrders: orders,
        recentOrderItems: orderItems,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Debug endpoint to check specific order
  app.get("/api/debug-order/:orderId", async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const mysql = await import("mysql2/promise");
      const connection = await mysql.default.createConnection(process.env.DATABASE_URL!);

      // Get order
      const [orders] = await connection.query("SELECT * FROM orders WHERE id = ?", [orderId]);

      // Get order items
      const [items] = await connection.query("SELECT * FROM orderItems WHERE orderId = ?", [orderId]);

      await connection.end();

      res.json({
        order: orders,
        items: items,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Debug endpoint to check specific sale and its saleItems (diagnose ghost items)
  app.get("/api/debug-sale/:saleId", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      return res.status(400).json({ error: "Solo funciona con DATABASE_URL" });
    }
    try {
      const saleId = parseInt(req.params.saleId);
      const mysql = await import("mysql2/promise");
      const connection = await mysql.default.createConnection(process.env.DATABASE_URL!);

      const [sale] = await connection.query("SELECT * FROM sales WHERE id = ?", [saleId]);
      const [items] = await connection.query("SELECT si.*, u.brand, u.model, u.code, u.salePrice, u.status as unitStatus FROM saleItems si LEFT JOIN units u ON si.unitId = u.id WHERE si.saleId = ?", [saleId]);
      const [allSaleItems] = await connection.query("SELECT * FROM saleItems ORDER BY id DESC LIMIT 20");

      await connection.end();

      res.json({ sale, items, lastSaleItems: allSaleItems });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RESET DE BASE DE DATOS (solo en modo DATABASE_URL / producción)
  // Borra TODOS los datos operativos y conserva únicamente el usuario admin.
  // Uso: GET /api/admin/reset-db?secret=RESET_SECRET
  // La variable de entorno RESET_SECRET debe estar configurada en Railway.
  // ──────────────────────────────────────────────────────────────────────────
  app.get("/api/admin/reset-db", async (req, res) => {
    if (!process.env.DATABASE_URL) {
      return res.status(400).json({ error: "Este endpoint solo funciona con DATABASE_URL configurada." });
    }

    const secret = process.env.RESET_SECRET || "mpshop-reset-2024";
    if (req.query.secret !== secret) {
      return res.status(403).json({ error: "Clave incorrecta. Agrega ?secret=TU_CLAVE a la URL." });
    }

    let connection: any;
    try {
      const mysql = await import("mysql2/promise");
      connection = await mysql.default.createConnection(process.env.DATABASE_URL);

      // Lista exhaustiva de tablas operativas a vaciar (soporta camelCase y snake_case)
      const tablesToTruncate = [
        // Finanzas y cajas
        "financialTransactions",
        "financial_transactions",
        "operationalExpenses",
        "operational_expenses",
        "deliveryExpenses",
        "delivery_expenses",
        "accountsPayable",
        "accounts_payable",
        "accountsReceivable",
        "accounts_receivable",
        "creditPayments",
        "credit_payments",
        "cash_closures",
        "cashClosures",
        "cash_openings",
        "cashOpenings",
        "payments",

        // Ventas y cotizaciones
        "saleItems",
        "sale_items",
        "sales",
        "quotationItems",
        "quotation_items",
        "quotations",
        "orderItems",
        "order_items",
        "orders",

        // Compras y proveedores
        "purchaseItems",
        "purchase_items",
        "purchases",
        "suppliers",
        "customers",

        // Unidades, inventario y códigos
        "unitEvents",
        "unit_events",
        "repairs",
        "warranties",
        "returns",
        "units",
        "generatedCodes",
        "generated_codes",
        "generatedCodeBatches",
        "generated_code_batches",
        "inventory",
        "movements",
        "inventoryTransferItems",
        "inventory_transfer_items",
        "inventoryTransfers",
        "inventory_transfers",

        // Logs
        "auditLog",
        "audit_log",
        "gpsTracking",
        "gps_tracking",
      ];

      // Deshabilitar FK checks temporalmente para poder truncar sin orden estricto
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const table of tablesToTruncate) {
        try {
          await connection.query(`TRUNCATE TABLE \`${table}\``);
          console.log(`[Reset] Truncated: ${table}`);
        } catch (err: any) {
          // Si la tabla no existe la ignoramos
          if (!err.message?.includes("doesn't exist")) {
            console.warn(`[Reset] Could not truncate ${table}:`, err.message);
          }
        }
      }
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");

      // Repoblar catálogos de laptops y specs para pruebas limpias
      try {
        const { seedDeviceCatalogs } = await import("../routers/deviceCatalogs");
        await seedDeviceCatalogs();
      } catch (catErr: any) {
        console.warn("[Reset] Could not re-seed device catalogs:", catErr.message);
      }


      // Asegurarse que el admin siga existiendo con contraseña MPShop2026Admin!
      const bcrypt = await import("bcrypt");
      const adminPassword = process.env.ADMIN_PASSWORD || "MPShop2026Admin!";
      const passwordHash = await bcrypt.default.hash(adminPassword, 10);
      const adminUsername = process.env.ADMIN_USERNAME || "admin";
      const adminEmail = process.env.ADMIN_EMAIL || "admin@mpshop.local";

      await connection.query(
        `INSERT INTO users
          (openId, username, passwordHash, name, email, loginMethod, role, status,
           allowedModules, specialPermissions, assignedBranchIds, createdAt, updatedAt, lastSignedIn)
         VALUES (?, ?, ?, 'Administrador', ?, 'traditional', 'admin', 'active',
           ?, ?, ?, NOW(), NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           passwordHash = VALUES(passwordHash),
           role = 'admin',
           status = 'active',
           allowedModules = VALUES(allowedModules),
           specialPermissions = VALUES(specialPermissions)`,
        [
          `local_${adminUsername}`,
          adminUsername,
          passwordHash,
          adminEmail,
          JSON.stringify(["sales","catalog","units","repairs","warranties","returns","orders","generate-codes","customers","suppliers","purchases","dashboard-kpis","reports","dashboard","analytics","analysis","finance","accounts-receivable","accounts-payable","expenses","branches","users","delivery-persons"]),
          JSON.stringify({ canViewPurchaseCost: true, canApplyDiscounts: true, canViewFinancialReports: true, canManageInventory: true, canDeleteRecords: true }),
          JSON.stringify(["all"]),
        ]
      );

      await connection.end();

      return res.json({
        success: true,
        message: "✅ Base de datos reiniciada correctamente. Solo el usuario admin se conservó.",
        admin: { username: adminUsername, password: "usuario" },
      });
    } catch (error: any) {
      console.error("[Reset] Error:", error);
      try { await connection?.end(); } catch {}
      return res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BACKUP MANUAL DE BASE DE DATOS
  // Descarga todos los datos operativos organizados por módulo en JSON.
  // Uso: GET /api/admin/backup?secret=RESET_SECRET
  // ──────────────────────────────────────────────────────────────────────────
  app.get("/api/admin/backup", async (req, res) => {
    const secret = process.env.RESET_SECRET || "mpshop-reset-2024";
    if (req.query.secret !== secret) {
      return res.status(403).json({ error: "Clave incorrecta. Agrega ?secret=TU_CLAVE a la URL." });
    }

    let connection: any;
    try {
      // ── MODO DEMO (sin DATABASE_URL) ──
      if (!process.env.DATABASE_URL) {
        const {
          MOCK_UNITS, MOCK_SALES, MOCK_SALE_ITEMS, MOCK_PURCHASES, MOCK_PURCHASE_ITEMS,
          MOCK_CUSTOMERS, MOCK_SUPPLIERS, MOCK_REPAIRS, MOCK_WARRANTIES, MOCK_RETURNS,
          MOCK_FINANCIAL_TRANSACTIONS, MOCK_CASH_CLOSURES, MOCK_CASH_OPENINGS,
          MOCK_OPERATIONAL_EXPENSES, MOCK_ACCOUNTS_PAYABLE, MOCK_ACCOUNTS_RECEIVABLE,
          MOCK_CREDIT_PAYMENTS, MOCK_QUOTATIONS, MOCK_QUOTATION_ITEMS,
          MOCK_UNIT_EVENTS, MOCK_USERS, MOCK_BRANCHES,
        } = await import("../db");

        const backup = {
          meta: {
            version: APP_VERSION,
            generatedAt: new Date().toISOString(),
            mode: "demo",
            description: "Backup manual MP Shop — Modo Demo",
          },
          modulos: {
            inventario: {
              descripcion: "Equipos registrados en el sistema",
              total: (MOCK_UNITS as any[]).length,
              datos: MOCK_UNITS,
            },
            ventas: {
              descripcion: "Historial completo de ventas",
              total: (MOCK_SALES as any[]).length,
              datos: MOCK_SALES,
            },
            items_ventas: {
              descripcion: "Detalle de equipos por venta",
              total: (MOCK_SALE_ITEMS as any[]).length,
              datos: MOCK_SALE_ITEMS,
            },
            cotizaciones: {
              descripcion: "Cotizaciones generadas",
              total: (MOCK_QUOTATIONS as any[]).length,
              datos: MOCK_QUOTATIONS,
            },
            compras: {
              descripcion: "Historial de compras a proveedores",
              total: (MOCK_PURCHASES as any[]).length,
              datos: MOCK_PURCHASES,
            },
            items_compras: {
              descripcion: "Detalle de items por compra",
              total: (MOCK_PURCHASE_ITEMS as any[]).length,
              datos: MOCK_PURCHASE_ITEMS,
            },
            proveedores: {
              descripcion: "Proveedores registrados",
              total: (MOCK_SUPPLIERS as any[]).length,
              datos: MOCK_SUPPLIERS,
            },
            clientes: {
              descripcion: "Clientes registrados",
              total: (MOCK_CUSTOMERS as any[]).length,
              datos: MOCK_CUSTOMERS,
            },
            reparaciones: {
              descripcion: "Órdenes de reparación",
              total: (MOCK_REPAIRS as any[]).length,
              datos: MOCK_REPAIRS,
            },
            garantias: {
              descripcion: "Garantías registradas",
              total: (MOCK_WARRANTIES as any[]).length,
              datos: MOCK_WARRANTIES,
            },
            devoluciones: {
              descripcion: "Devoluciones procesadas",
              total: (MOCK_RETURNS as any[]).length,
              datos: MOCK_RETURNS,
            },
            caja_transacciones: {
              descripcion: "Transacciones financieras (ingresos y egresos)",
              total: (MOCK_FINANCIAL_TRANSACTIONS as any[]).length,
              datos: MOCK_FINANCIAL_TRANSACTIONS,
            },
            caja_cierres: {
              descripcion: "Cierres de caja",
              total: (MOCK_CASH_CLOSURES as any[]).length,
              datos: MOCK_CASH_CLOSURES,
            },
            caja_aperturas: {
              descripcion: "Aperturas de caja",
              total: (MOCK_CASH_OPENINGS as any[]).length,
              datos: MOCK_CASH_OPENINGS,
            },
            gastos_operativos: {
              descripcion: "Gastos operativos registrados",
              total: (MOCK_OPERATIONAL_EXPENSES as any[]).length,
              datos: MOCK_OPERATIONAL_EXPENSES,
            },
            cuentas_por_pagar: {
              descripcion: "Cuentas pendientes de pago a proveedores",
              total: (MOCK_ACCOUNTS_PAYABLE as any[]).length,
              datos: MOCK_ACCOUNTS_PAYABLE,
            },
            cuentas_por_cobrar: {
              descripcion: "Cuentas pendientes de cobro a clientes",
              total: (MOCK_ACCOUNTS_RECEIVABLE as any[]).length,
              datos: MOCK_ACCOUNTS_RECEIVABLE,
            },
            pagos_credito: {
              descripcion: "Pagos realizados de créditos",
              total: (MOCK_CREDIT_PAYMENTS as any[]).length,
              datos: MOCK_CREDIT_PAYMENTS,
            },
            eventos_equipos: {
              descripcion: "Historial de estados por equipo",
              total: (MOCK_UNIT_EVENTS as any[]).length,
              datos: MOCK_UNIT_EVENTS,
            },
            sucursales: {
              descripcion: "Sucursales configuradas",
              total: (MOCK_BRANCHES as any[]).length,
              datos: MOCK_BRANCHES,
            },
            usuarios: {
              descripcion: "Usuarios del sistema (sin contraseñas)",
              total: (MOCK_USERS as any[]).length,
              datos: (MOCK_USERS as any[]).map((u: any) => ({
                id: u.id, username: u.username, name: u.name,
                email: u.email, role: u.role, createdAt: u.createdAt,
              })),
            },
          },
        };

        const filename = `mpshop-backup-demo-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.json(backup);
      }

      // ── MODO PRODUCCIÓN (con DATABASE_URL) ──
      const mysql = await import("mysql2/promise");
      connection = await mysql.default.createConnection(process.env.DATABASE_URL);

      const queryTable = async (table: string) => {
        try {
          const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
          return rows as any[];
        } catch {
          return [];
        }
      };

      const [
        units, sales, saleItems, quotations, quotationItems,
        purchases, purchaseItems, suppliers, customers,
        repairs, warranties, returns_,
        transactions, closures, openings, opExpenses,
        accountsPayable, accountsReceivable, creditPayments,
        unitEvents, branches, users,
      ] = await Promise.all([
        queryTable("units"),
        queryTable("sales"),
        queryTable("saleItems"),
        queryTable("quotations"),
        queryTable("quotationItems"),
        queryTable("purchases"),
        queryTable("purchaseItems"),
        queryTable("suppliers"),
        queryTable("customers"),
        queryTable("repairs"),
        queryTable("warranties"),
        queryTable("returns"),
        queryTable("financialTransactions"),
        queryTable("cashClosures"),
        queryTable("cashOpenings"),
        queryTable("operationalExpenses"),
        queryTable("accountsPayable"),
        queryTable("accountsReceivable"),
        queryTable("creditPayments"),
        queryTable("unitEvents"),
        queryTable("branches"),
        queryTable("users"),
      ]);

      const backup = {
        meta: {
          version: APP_VERSION,
          generatedAt: new Date().toISOString(),
          mode: "production",
          description: "Backup manual MP Shop — Base de datos producción",
        },
        modulos: {
          inventario: {
            descripcion: "Equipos registrados en el sistema",
            total: units.length,
            datos: units,
          },
          ventas: {
            descripcion: "Historial completo de ventas",
            total: sales.length,
            datos: sales,
          },
          items_ventas: {
            descripcion: "Detalle de equipos por venta",
            total: saleItems.length,
            datos: saleItems,
          },
          cotizaciones: {
            descripcion: "Cotizaciones generadas",
            total: quotations.length,
            datos: quotations,
          },
          items_cotizaciones: {
            descripcion: "Detalle de items por cotización",
            total: quotationItems.length,
            datos: quotationItems,
          },
          compras: {
            descripcion: "Historial de compras a proveedores",
            total: purchases.length,
            datos: purchases,
          },
          items_compras: {
            descripcion: "Detalle de items por compra",
            total: purchaseItems.length,
            datos: purchaseItems,
          },
          proveedores: {
            descripcion: "Proveedores registrados",
            total: suppliers.length,
            datos: suppliers,
          },
          clientes: {
            descripcion: "Clientes registrados",
            total: customers.length,
            datos: customers,
          },
          reparaciones: {
            descripcion: "Órdenes de reparación",
            total: repairs.length,
            datos: repairs,
          },
          garantias: {
            descripcion: "Garantías registradas",
            total: warranties.length,
            datos: warranties,
          },
          devoluciones: {
            descripcion: "Devoluciones procesadas",
            total: returns_.length,
            datos: returns_,
          },
          caja_transacciones: {
            descripcion: "Transacciones financieras (ingresos y egresos)",
            total: transactions.length,
            datos: transactions,
          },
          caja_cierres: {
            descripcion: "Cierres de caja",
            total: closures.length,
            datos: closures,
          },
          caja_aperturas: {
            descripcion: "Aperturas de caja",
            total: openings.length,
            datos: openings,
          },
          gastos_operativos: {
            descripcion: "Gastos operativos registrados",
            total: opExpenses.length,
            datos: opExpenses,
          },
          cuentas_por_pagar: {
            descripcion: "Cuentas pendientes de pago a proveedores",
            total: accountsPayable.length,
            datos: accountsPayable,
          },
          cuentas_por_cobrar: {
            descripcion: "Cuentas pendientes de cobro a clientes",
            total: accountsReceivable.length,
            datos: accountsReceivable,
          },
          pagos_credito: {
            descripcion: "Pagos realizados de créditos",
            total: creditPayments.length,
            datos: creditPayments,
          },
          eventos_equipos: {
            descripcion: "Historial de estados por equipo",
            total: unitEvents.length,
            datos: unitEvents,
          },
          sucursales: {
            descripcion: "Sucursales configuradas",
            total: branches.length,
            datos: branches,
          },
          usuarios: {
            descripcion: "Usuarios del sistema (sin contraseñas)",
            total: users.length,
            datos: users.map((u: any) => ({
              id: u.id, username: u.username, name: u.name,
              email: u.email, role: u.role, createdAt: u.createdAt,
            })),
          },
        },
      };

      await connection.end();

      const filename = `mpshop-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.json(backup);

    } catch (error: any) {
      console.error("[Backup] Error:", error);
      try { await connection?.end(); } catch {}
      return res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RESTAURAR BACKUP — Importa un JSON generado por /api/admin/backup
  // Uso: POST /api/admin/restore?secret=RESET_SECRET
  // Body: el archivo JSON del backup (multipart/form-data campo "backup")
  //       O JSON crudo en el body con Content-Type: application/json
  // ──────────────────────────────────────────────────────────────────────────
  app.post("/api/admin/restore", async (req, res) => {
    const secret = process.env.RESET_SECRET || "mpshop-reset-2024";
    if (req.query.secret !== secret) {
      return res.status(403).json({ error: "Clave incorrecta. Agrega ?secret=TU_CLAVE a la URL." });
    }

    let connection: any;
    try {
      const backup = req.body;

      // Validar estructura del backup
      if (!backup || !backup.modulos) {
        return res.status(400).json({
          error: "Estructura de backup inválida. Debe tener la propiedad 'modulos'.",
          hint: "Usa el archivo generado por /api/admin/backup",
        });
      }

      const modulos = backup.modulos;
      const resultados: Record<string, any> = {};

      // ── MODO DEMO (sin DATABASE_URL) ──
      if (!process.env.DATABASE_URL) {
        const db = await import("../db");

        // Orden de restauración (respeta dependencias)
        const mapeo: Array<{ key: string; mock: any[] }> = [
          { key: "sucursales",          mock: db.MOCK_BRANCHES },
          { key: "proveedores",         mock: db.MOCK_SUPPLIERS },
          { key: "clientes",            mock: db.MOCK_CUSTOMERS },
          { key: "compras",             mock: db.MOCK_PURCHASES },
          { key: "items_compras",       mock: db.MOCK_PURCHASE_ITEMS },
          { key: "inventario",          mock: db.MOCK_UNITS },
          { key: "eventos_equipos",     mock: db.MOCK_UNIT_EVENTS },
          { key: "reparaciones",        mock: db.MOCK_REPAIRS },
          { key: "garantias",           mock: db.MOCK_WARRANTIES },
          { key: "cotizaciones",        mock: db.MOCK_QUOTATIONS },
          { key: "items_cotizaciones",  mock: db.MOCK_QUOTATION_ITEMS },
          { key: "ventas",              mock: db.MOCK_SALES },
          { key: "items_ventas",        mock: db.MOCK_SALE_ITEMS },
          { key: "devoluciones",        mock: db.MOCK_RETURNS },
          { key: "caja_aperturas",      mock: db.MOCK_CASH_OPENINGS },
          { key: "caja_cierres",        mock: db.MOCK_CASH_CLOSURES },
          { key: "caja_transacciones",  mock: db.MOCK_FINANCIAL_TRANSACTIONS },
          { key: "gastos_operativos",   mock: db.MOCK_OPERATIONAL_EXPENSES },
          { key: "cuentas_por_pagar",   mock: db.MOCK_ACCOUNTS_PAYABLE },
          { key: "cuentas_por_cobrar",  mock: db.MOCK_ACCOUNTS_RECEIVABLE },
          { key: "pagos_credito",       mock: db.MOCK_CREDIT_PAYMENTS },
        ];

        for (const { key, mock } of mapeo) {
          if (modulos[key]?.datos && Array.isArray(modulos[key].datos)) {
            mock.length = 0;
            mock.push(...modulos[key].datos);
            resultados[key] = { restaurados: mock.length };
          } else {
            resultados[key] = { restaurados: 0, omitido: true };
          }
        }

        db.syncMocksToDisk();

        return res.json({
          success: true,
          message: "✅ Backup restaurado correctamente en modo demo.",
          backupFecha: backup.meta?.generatedAt || "desconocida",
          backupVersion: backup.meta?.version || "desconocida",
          modulos: resultados,
        });
      }

      // ── MODO PRODUCCIÓN (con DATABASE_URL) ──
      const mysql = await import("mysql2/promise");
      connection = await mysql.default.createConnection(process.env.DATABASE_URL);

      // Deshabilitar FK checks para insertar en cualquier orden
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");

      // Función helper para restaurar una tabla
      const restaurarTabla = async (
        key: string,
        tabla: string,
        transformar?: (row: any) => any
      ) => {
        if (!modulos[key]?.datos || !Array.isArray(modulos[key].datos)) {
          resultados[key] = { restaurados: 0, omitido: true };
          return;
        }

        const filas: any[] = modulos[key].datos;
        if (filas.length === 0) {
          resultados[key] = { restaurados: 0 };
          return;
        }

        // Vaciar tabla antes de restaurar
        try {
          await connection.query(`TRUNCATE TABLE \`${tabla}\``);
        } catch { /* tabla puede no existir */ }

        let insertados = 0;
        for (const fila of filas) {
          try {
            const data = transformar ? transformar(fila) : fila;
            const cols = Object.keys(data).map(c => `\`${c}\``).join(", ");
            const vals = Object.values(data);
            const placeholders = vals.map(() => "?").join(", ");
            await connection.query(
              `INSERT IGNORE INTO \`${tabla}\` (${cols}) VALUES (${placeholders})`,
              vals
            );
            insertados++;
          } catch { /* ignorar filas con conflicto */ }
        }

        resultados[key] = { restaurados: insertados, total: filas.length };
      };

      // Restaurar en orden (tablas padre antes que hijas)
      await restaurarTabla("sucursales",         "branches");
      await restaurarTabla("proveedores",        "suppliers");
      await restaurarTabla("clientes",           "customers");
      await restaurarTabla("compras",            "purchases");
      await restaurarTabla("items_compras",      "purchaseItems");
      await restaurarTabla("inventario",         "units");
      await restaurarTabla("eventos_equipos",    "unitEvents");
      await restaurarTabla("reparaciones",       "repairs");
      await restaurarTabla("garantias",          "warranties");
      await restaurarTabla("cotizaciones",       "quotations");
      await restaurarTabla("items_cotizaciones", "quotationItems");
      await restaurarTabla("ventas",             "sales");
      await restaurarTabla("items_ventas",       "saleItems");
      await restaurarTabla("devoluciones",       "returns");
      await restaurarTabla("caja_aperturas",     "cashOpenings");
      await restaurarTabla("caja_cierres",       "cashClosures");
      await restaurarTabla("caja_transacciones", "financialTransactions");
      await restaurarTabla("gastos_operativos",  "operationalExpenses");
      await restaurarTabla("cuentas_por_pagar",  "accountsPayable");
      await restaurarTabla("cuentas_por_cobrar", "accountsReceivable");
      await restaurarTabla("pagos_credito",      "creditPayments");

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await connection.end();

      const totalRestaurados = Object.values(resultados)
        .reduce((s: number, r: any) => s + (r.restaurados || 0), 0);

      return res.json({
        success: true,
        message: `✅ Backup restaurado correctamente. ${totalRestaurados} registros importados.`,
        backupFecha: backup.meta?.generatedAt || "desconocida",
        backupVersion: backup.meta?.version || "desconocida",
        modulos: resultados,
      });

    } catch (error: any) {
      console.error("[Restore] Error:", error);
      try { await connection?.end(); } catch {}
      return res.status(500).json({ error: error.message });
    }
  });



  console.log(`[App] Version ${APP_VERSION} starting...`);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`[Server] [v1.5.0] Running on port ${port}`);
  });
}

startServer().catch(console.error);
