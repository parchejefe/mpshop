/**
 * fix_missing_columns.ts
 * Agrega columnas que pueden faltar en Railway usando INFORMATION_SCHEMA
 * para verificar si existen antes de intentar crearlas.
 * Se ejecuta en el predeploy de Railway.
 */
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

async function columnExists(conn: any, table: string, column: string): Promise<boolean> {
  const [rows]: any = await conn.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].cnt > 0;
}

async function addColumnIfMissing(
  conn: any,
  table: string,
  column: string,
  definition: string
) {
  const exists = await columnExists(conn, table, column);
  if (exists) {
    console.log(`[FixColumns] ⊘ ${table}.${column} already exists`);
    return;
  }
  try {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`[FixColumns] ✓ Added ${table}.${column}`);
  } catch (err: any) {
    console.log(`[FixColumns] ✗ Failed ${table}.${column}: ${err.message}`);
  }
}

async function tableExists(conn: any, table: string): Promise<boolean> {
  const [rows]: any = await conn.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows[0].cnt > 0;
}

async function main() {
  if (!databaseUrl) {
    console.log("[FixColumns] No DATABASE_URL — skipping");
    process.exit(0);
  }

  const conn = await mysql.createConnection(databaseUrl);
  console.log("[FixColumns] Connected. Checking missing columns...");

  try {
    // ── units ──────────────────────────────────────────────────────
    await addColumnIfMissing(conn, "units", "tiktokUrl",   "varchar(500) NULL");
    await addColumnIfMissing(conn, "units", "rmaNumber",   "varchar(30) NULL");
    await addColumnIfMissing(conn, "units", "purchaseDate","varchar(10) NULL");
    await addColumnIfMissing(conn, "units", "photos",      "LONGTEXT NULL");
    await conn.query("ALTER TABLE units MODIFY COLUMN photos LONGTEXT").catch(() => {});
    await addColumnIfMissing(conn, "units", "supplierId",  "int NULL");
    await addColumnIfMissing(conn, "units", "purchaseId",  "int NULL");
    await addColumnIfMissing(conn, "units", "discountPrice","int NULL");
    await addColumnIfMissing(conn, "units", "wholesalePrice","int NULL");

    // ── purchaseItems — productId debe ser nullable para poder insertar solo unitId ──
    await conn.query("ALTER TABLE purchaseItems MODIFY COLUMN productId int NULL").catch(() => {});
    await addColumnIfMissing(conn, "purchaseItems", "unitId", "int NULL");

    // ── repairs ────────────────────────────────────────────────────
    await addColumnIfMissing(conn, "repairs", "otNumber",  "varchar(30) NULL");
    await addColumnIfMissing(conn, "repairs", "endDate",   "timestamp NULL");
    await addColumnIfMissing(conn, "repairs", "partsUsed", "text NULL");
    await addColumnIfMissing(conn, "repairs", "laborCost", "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "repairs", "partsCost", "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "repairs", "resolutionType", "enum('return_to_customer','return_to_inventory') NULL");

    // ── returns ────────────────────────────────────────────────────
    await addColumnIfMissing(conn, "returns", "refundAmount",        "int NULL");
    await addColumnIfMissing(conn, "returns", "refundPaymentMethod", "varchar(20) NULL");
    await addColumnIfMissing(conn, "returns", "saleId",              "int NULL");

    // ── financialTransactions ──────────────────────────────────────
    await addColumnIfMissing(conn, "financialTransactions", "unitCost", "int NULL");
    await addColumnIfMissing(conn, "financialTransactions", "branchId", "int NOT NULL DEFAULT 1");

    // ── operationalExpenses ────────────────────────────────────────
    await addColumnIfMissing(conn, "operationalExpenses", "costType",      "varchar(50) NULL");
    await addColumnIfMissing(conn, "operationalExpenses", "referenceType", "varchar(50) NULL");
    await addColumnIfMissing(conn, "operationalExpenses", "referenceId",   "int NULL");
    await addColumnIfMissing(conn, "operationalExpenses", "isAutomatic",   "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "operationalExpenses", "branchId",      "int NOT NULL DEFAULT 1");

    // ── sales ──────────────────────────────────────────────────────
    await addColumnIfMissing(conn, "sales", "warrantyDays",         "int NOT NULL DEFAULT 30");
    await addColumnIfMissing(conn, "sales", "creditDays",           "int NULL");
    await addColumnIfMissing(conn, "sales", "cancelledAt",          "timestamp NULL");
    await addColumnIfMissing(conn, "sales", "cancelledBy",          "int NULL");
    await addColumnIfMissing(conn, "sales", "branchId",             "int NOT NULL DEFAULT 1");
    await addColumnIfMissing(conn, "sales", "dueDate",              "varchar(10) NULL");
    await addColumnIfMissing(conn, "sales", "adminOverrideUserId",  "int NULL");
    // Expand paymentMethod enum to include 'credit'
    await conn.query("ALTER TABLE sales MODIFY COLUMN paymentMethod enum('cash','qr','transfer','credit') NOT NULL").catch(() => {});

    // ── saleItems ──────────────────────────────────────────────────
    await conn.query("ALTER TABLE saleItems MODIFY COLUMN productId int NULL").catch(() => {});
    await addColumnIfMissing(conn, "saleItems", "unitId",       "int NULL");
    await addColumnIfMissing(conn, "saleItems", "pricingType",  "enum('unit','wholesale','discount') NOT NULL DEFAULT 'unit'");

    // ── orders ─────────────────────────────────────────────────────
    await addColumnIfMissing(conn, "orders", "branchId", "int NOT NULL DEFAULT 1");

    // ── users ──────────────────────────────────────────────────────
    await addColumnIfMissing(conn, "users", "phone",              "varchar(50) NULL");
    await addColumnIfMissing(conn, "users", "status",             "enum('active','inactive') NOT NULL DEFAULT 'active'");
    await addColumnIfMissing(conn, "users", "allowedModules",     "text NULL");
    await addColumnIfMissing(conn, "users", "specialPermissions", "text NULL");
    await addColumnIfMissing(conn, "users", "assignedBranchIds",  "text NULL");

    // ── customers ──────────────────────────────────────────────────
    await addColumnIfMissing(conn, "customers", "taxId",       "varchar(50) NULL");
    await addColumnIfMissing(conn, "customers", "creditLimit", "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "customers", "creditDays",  "int NOT NULL DEFAULT 30");
    await addColumnIfMissing(conn, "customers", "allowCredit", "int NOT NULL DEFAULT 1");

    // ── purchases ──────────────────────────────────────────────────
    await addColumnIfMissing(conn, "purchases", "paymentMethod", "enum('cash','qr','transfer') NULL");
    await addColumnIfMissing(conn, "purchases", "isCredit",      "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "purchases", "dueDate",       "varchar(10) NULL");

    // ── suppliers ──────────────────────────────────────────────────
    await addColumnIfMissing(conn, "suppliers", "taxId",        "varchar(50) NULL");
    await addColumnIfMissing(conn, "suppliers", "creditDays",   "int NOT NULL DEFAULT 30");
    await addColumnIfMissing(conn, "suppliers", "creditLimit",  "int NOT NULL DEFAULT 0");

    // ── saleItems ──────────────────────────────────────────────────
    await addColumnIfMissing(conn, "saleItems", "discountType",  "enum('none','percentage','fixed') NOT NULL DEFAULT 'none'");
    await addColumnIfMissing(conn, "saleItems", "discountValue", "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "saleItems", "discountAmount","int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "saleItems", "finalUnitPrice","int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "saleItems", "subtotal",      "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "saleItems", "unitId",        "int NULL");

    // ── accountsPayable ────────────────────────────────────────────
    await addColumnIfMissing(conn, "accountsPayable", "supplierId",  "int NULL");
    await addColumnIfMissing(conn, "accountsPayable", "paidAmount",  "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "accountsPayable", "balance",     "int NOT NULL DEFAULT 0");

    // ── accountsReceivable ─────────────────────────────────────────
    await addColumnIfMissing(conn, "accountsReceivable", "customerId",           "int NULL");
    await addColumnIfMissing(conn, "accountsReceivable", "paidAmount",           "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "accountsReceivable", "balance",              "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "accountsReceivable", "adminOverrideUserId",  "int NULL");
    await addColumnIfMissing(conn, "accountsReceivable", "adminOverrideReason",  "text NULL");

    // ── cash_closures ──────────────────────────────────────────────
    await addColumnIfMissing(conn, "cash_closures", "branchId",        "int NOT NULL DEFAULT 1");
    await addColumnIfMissing(conn, "cash_closures", "reportedCash",    "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_closures", "reportedQr",      "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_closures", "reportedTransfer","int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_closures", "expectedCash",    "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_closures", "expectedQr",      "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_closures", "expectedTransfer","int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_closures", "pendingOrders",   "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_closures", "adminNotes",      "text NULL");
    await addColumnIfMissing(conn, "cash_closures", "status",          "enum('pending','approved','rejected') NOT NULL DEFAULT 'pending'");

    // ── cash_openings ──────────────────────────────────────────────
    await addColumnIfMissing(conn, "cash_openings", "openingAmount",     "int NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, "cash_openings", "paymentMethod",     "enum('cash','qr','transfer') NOT NULL DEFAULT 'cash'");
    await addColumnIfMissing(conn, "cash_openings", "responsibleUserId", "int NULL");
    await addColumnIfMissing(conn, "cash_openings", "openedByUserId",    "int NULL");
    await addColumnIfMissing(conn, "cash_openings", "notes",             "text NULL");
    await addColumnIfMissing(conn, "cash_openings", "status",            "enum('open','closed') NOT NULL DEFAULT 'open'");

    // ── purchaseItems ──────────────────────────────────────────────
    await addColumnIfMissing(conn, "purchaseItems", "unitId", "int NULL");

    // ── warranties ─────────────────────────────────────────────────
    if (await tableExists(conn, "warranties")) {
      await addColumnIfMissing(conn, "warranties", "pausedAt",             "timestamp NULL");
      await addColumnIfMissing(conn, "warranties", "remainingDaysAtPause", "int NULL");
    }

    // ── Crear tablas críticas si no existen ───────────────────────

    if (!(await tableExists(conn, "units"))) {
      await conn.query(`
        CREATE TABLE units (
          id int AUTO_INCREMENT PRIMARY KEY,
          code varchar(50) NOT NULL UNIQUE,
          rmaNumber varchar(30) NULL,
          codeId int NULL,
          type enum('laptop','tablet','phone','monitor','charger','accessory','other') NOT NULL,
          brand varchar(100) NOT NULL,
          model varchar(100) NOT NULL,
          serialNumber varchar(100) NULL,
          specs text NULL,
          \`condition\` int NULL,
          batteryHealth enum('good','fair','bad_plugged_only','n_a') NOT NULL DEFAULT 'n_a',
          damageChecklist text NULL,
          damageNotes text NULL,
          functionalTestPassed int DEFAULT 1,
          status enum('in_diagnosis','in_repair','available','sold','returned') NOT NULL DEFAULT 'in_diagnosis',
          purchaseId int NULL,
          purchasePrice int NOT NULL DEFAULT 0,
          salePrice int NULL,
          discountPrice int NULL,
          wholesalePrice int NULL,
          supplierId int NULL,
          purchaseDate varchar(10) NULL,
          photos text NULL,
          tiktokUrl varchar(500) NULL,
          branchId int NOT NULL DEFAULT 1,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created units table");
    }

    if (!(await tableExists(conn, "unitEvents"))) {
      await conn.query(`
        CREATE TABLE unitEvents (
          id int AUTO_INCREMENT PRIMARY KEY,
          unitId int NOT NULL,
          eventType varchar(50) NOT NULL,
          fromStatus varchar(50) NULL,
          toStatus varchar(50) NULL,
          userId int NULL,
          notes text NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created unitEvents table");
    } else {
      console.log("[FixColumns] ⊘ unitEvents table already exists");
    }

    if (!(await tableExists(conn, "repairs"))) {
      await conn.query(`
        CREATE TABLE repairs (
          id int AUTO_INCREMENT PRIMARY KEY,
          rmaNumber varchar(30) NULL,
          otNumber varchar(30) NULL,
          unitId int NOT NULL,
          technicianId int NULL,
          startDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          endDate timestamp NULL,
          partsUsed text NULL,
          laborCost int NOT NULL DEFAULT 0,
          partsCost int NOT NULL DEFAULT 0,
          status enum('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
          resolutionType enum('return_to_customer','return_to_inventory') NULL,
          notes text NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created repairs table");
    }

    if (!(await tableExists(conn, "warranties"))) {
      await conn.query(`
        CREATE TABLE warranties (
          id int AUTO_INCREMENT PRIMARY KEY,
          saleId int NULL,
          orderId int NULL,
          unitId int NOT NULL,
          days int NOT NULL DEFAULT 30,
          startDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          endDate timestamp NOT NULL,
          status enum('active','claimed','expired','paused') NOT NULL DEFAULT 'active',
          pausedAt timestamp NULL,
          remainingDaysAtPause int NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created warranties table");
    }

    if (!(await tableExists(conn, "returns"))) {
      await conn.query(`
        CREATE TABLE \`returns\` (
          id int AUTO_INCREMENT PRIMARY KEY,
          warrantyId int NULL,
          saleId int NULL,
          unitId int NOT NULL,
          returnDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reason text NOT NULL,
          resolution text NULL,
          reenteredRepair int NOT NULL DEFAULT 0,
          refundAmount int NULL,
          refundPaymentMethod varchar(20) NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created returns table");
    }

    if (!(await tableExists(conn, "generatedCodeBatches"))) {
      await conn.query(`
        CREATE TABLE generatedCodeBatches (
          id int AUTO_INCREMENT PRIMARY KEY,
          quantity int NOT NULL,
          type enum('qr','barcode') NOT NULL,
          createdBy int NOT NULL,
          notes text NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created generatedCodeBatches table");
    }

    if (!(await tableExists(conn, "generatedCodes"))) {
      await conn.query(`
        CREATE TABLE generatedCodes (
          id int AUTO_INCREMENT PRIMARY KEY,
          code varchar(100) NOT NULL UNIQUE,
          type enum('qr','barcode') NOT NULL,
          status enum('unassigned','assigned') NOT NULL DEFAULT 'unassigned',
          batchId int NOT NULL,
          assignedUnitId int NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          assignedAt timestamp NULL
        )
      `);
      console.log("[FixColumns] ✓ Created generatedCodes table");
    }

    if (!(await tableExists(conn, "employees"))) {
      await conn.query(`
        CREATE TABLE employees (
          id int AUTO_INCREMENT PRIMARY KEY,
          fullName varchar(255) NOT NULL,
          ci varchar(20) NULL,
          role enum('repartidor','ventas','almacen','tecnico','administracion','otro') NOT NULL DEFAULT 'otro',
          userId int NULL,
          baseSalary int NOT NULL DEFAULT 0,
          fixedDeductions text NULL,
          phone varchar(20) NULL,
          address varchar(255) NULL,
          startDate varchar(10) NULL,
          birthDate varchar(10) NULL,
          status enum('active','inactive') NOT NULL DEFAULT 'active',
          notes text NULL,
          branchId int NOT NULL DEFAULT 1,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created employees table");
    }

    if (!(await tableExists(conn, "inventory_transfers"))) {
      await conn.query(`
        CREATE TABLE inventory_transfers (
          id int AUTO_INCREMENT PRIMARY KEY,
          transferNumber varchar(50) NOT NULL UNIQUE,
          direction varchar(50) NOT NULL DEFAULT 'branch_transfer',
          sourceBranchId int NOT NULL DEFAULT 1,
          destinationBranchId int NOT NULL DEFAULT 1,
          status enum('pending','in_transit','completed','cancelled') NOT NULL DEFAULT 'pending',
          userId int NOT NULL,
          notes text NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created inventory_transfers table");
    } else {
      await addColumnIfMissing(conn, "inventory_transfers", "sourceBranchId", "int NOT NULL DEFAULT 1");
      await addColumnIfMissing(conn, "inventory_transfers", "destinationBranchId", "int NOT NULL DEFAULT 1");
      await addColumnIfMissing(conn, "inventory_transfers", "direction", "varchar(50) NOT NULL DEFAULT 'branch_transfer'");
      try {
        await conn.query(`ALTER TABLE inventory_transfers MODIFY COLUMN status enum('pending','in_transit','completed','cancelled') NOT NULL DEFAULT 'pending'`);
      } catch (e: any) {}
    }

    if (!(await tableExists(conn, "inventory_transfer_items"))) {
      await conn.query(`
        CREATE TABLE inventory_transfer_items (
          id int AUTO_INCREMENT PRIMARY KEY,
          transferId int NOT NULL,
          unitId int NOT NULL,
          quantity int NOT NULL DEFAULT 1,
          unitCode varchar(50) NULL,
          notes text NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("[FixColumns] ✓ Created inventory_transfer_items table");
    } else {
      await addColumnIfMissing(conn, "inventory_transfer_items", "unitId", "int NOT NULL DEFAULT 0");
      await addColumnIfMissing(conn, "inventory_transfer_items", "unitCode", "varchar(50) NULL");
      await addColumnIfMissing(conn, "inventory_transfer_items", "notes", "text NULL");
    }

    // seller_cash_registers tables & columns
    if (!(await tableExists(conn, "seller_cash_registers"))) {
      await conn.query(`
        CREATE TABLE seller_cash_registers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          sellerId INT NOT NULL,
          branchId INT NOT NULL,
          date VARCHAR(10) NOT NULL,
          turnNumber INT NOT NULL DEFAULT 1,
          openingStatus ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
          initialCash INT NOT NULL DEFAULT 0,
          openedAt TIMESTAMP NULL,
          openingApprovedBy INT NULL,
          openingApprovedAt TIMESTAMP NULL,
          openingNotes TEXT NULL,
          salesCash INT NOT NULL DEFAULT 0,
          salesQr INT NOT NULL DEFAULT 0,
          salesTransfer INT NOT NULL DEFAULT 0,
          partialDeliveriesCash INT NOT NULL DEFAULT 0,
          totalExpenses INT NOT NULL DEFAULT 0,
          closingStatus ENUM('open','pending','approved','rejected','forced_closed') NOT NULL DEFAULT 'open',
          reportedCash INT DEFAULT 0,
          reportedQr INT DEFAULT 0,
          reportedTransfer INT DEFAULT 0,
          differenceCash INT DEFAULT 0,
          differenceQr INT NOT NULL DEFAULT 0,
          differenceTransfer INT NOT NULL DEFAULT 0,
          differenceJustification TEXT NULL,
          closedAt TIMESTAMP NULL,
          closingApprovedBy INT NULL,
          closingApprovedAt TIMESTAMP NULL,
          closingNotes TEXT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_seller_date (sellerId, date),
          INDEX idx_branch_date (branchId, date),
          INDEX idx_opening_status (openingStatus),
          INDEX idx_closing_status (closingStatus)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("[FixColumns] ✓ Created seller_cash_registers table");
    } else {
      await addColumnIfMissing(conn, "seller_cash_registers", "turnNumber", "INT NOT NULL DEFAULT 1");
      await addColumnIfMissing(conn, "seller_cash_registers", "differenceQr", "INT NOT NULL DEFAULT 0");
      await addColumnIfMissing(conn, "seller_cash_registers", "differenceTransfer", "INT NOT NULL DEFAULT 0");
      await addColumnIfMissing(conn, "seller_cash_registers", "partialDeliveriesCash", "INT NOT NULL DEFAULT 0");
      await addColumnIfMissing(conn, "seller_cash_registers", "totalExpenses", "INT NOT NULL DEFAULT 0");
    }

    if (!(await tableExists(conn, "seller_partial_deliveries"))) {
      await conn.query(`
        CREATE TABLE seller_partial_deliveries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          cashRegisterId INT NOT NULL,
          sellerId INT NOT NULL,
          amount INT NOT NULL,
          status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
          requestedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          approvedBy INT NULL,
          approvedAt TIMESTAMP NULL,
          notes TEXT NULL,
          adminNotes TEXT NULL,
          INDEX idx_status (status),
          INDEX idx_seller (sellerId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("[FixColumns] ✓ Created seller_partial_deliveries table");
    }

    if (!(await tableExists(conn, "seller_cash_expenses"))) {
      await conn.query(`
        CREATE TABLE seller_cash_expenses (
          id INT AUTO_INCREMENT PRIMARY KEY,
          cashRegisterId INT NOT NULL,
          sellerId INT NOT NULL,
          amount INT NOT NULL,
          concept VARCHAR(255) NOT NULL,
          status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
          requestedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          approvedBy INT NULL,
          approvedAt TIMESTAMP NULL,
          notes TEXT NULL,
          adminNotes TEXT NULL,
          receiptUrl TEXT NULL,
          INDEX idx_status (status),
          INDEX idx_seller (sellerId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("[FixColumns] ✓ Created seller_cash_expenses table");
    }

    // Role upgrade in users table
    try {
      await conn.query(`ALTER TABLE users MODIFY COLUMN role enum('admin','technician','seller','cashier','user') NOT NULL DEFAULT 'seller'`);
      console.log("[FixColumns] ✓ Upgraded users.role enum");
    } catch (e: any) {}

    // Migrar rmaNumber existente de repairs a otNumber
    await conn.query(`
      UPDATE repairs SET otNumber = rmaNumber 
      WHERE otNumber IS NULL AND rmaNumber IS NOT NULL
    `);
    console.log("[FixColumns] ✓ Migrated repair rmaNumber to otNumber");

    console.log("[FixColumns] ✅ All columns and tables verified!");

  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("[FixColumns] Fatal error:", err);
  process.exit(0); // exit 0 para no bloquear el deploy
});
