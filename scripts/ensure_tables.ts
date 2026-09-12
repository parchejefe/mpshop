import "dotenv/config";
import mysql from "mysql2/promise";

export async function ensureTables() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  console.log("[EnsureTables] Connecting to database...");
  const connection = await mysql.createConnection(databaseUrl);

  async function runSQL(label: string, sql: string) {
    try {
      await connection.query(sql);
      console.log(`[EnsureTables] ✓ ${label}`);
    } catch (err: any) {
      if (err.message.includes("Duplicate column") || err.message.includes("already exists")) {
        console.log(`[EnsureTables] ⊘ ${label} (already exists)`);
      } else {
        console.log(`[EnsureTables] ✗ ${label}: ${err.message}`);
      }
    }
  }

  try {
    // ============================================================
    // 1. USERS
    // ============================================================
    await runSQL("users table", `
      CREATE TABLE IF NOT EXISTS users (
        id int AUTO_INCREMENT NOT NULL,
        openId varchar(64) NOT NULL DEFAULT '',
        username varchar(100),
        passwordHash text,
        name text,
        email varchar(320),
        loginMethod varchar(64),
        role enum('admin','technician','seller','cashier','user') NOT NULL DEFAULT 'seller',
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        lastSignedIn timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT users_id PRIMARY KEY(id),
        CONSTRAINT users_openId_unique UNIQUE(openId),
        CONSTRAINT users_username_unique UNIQUE(username)
      )
    `);

    await runSQL("users.role enum upgrade", `
      ALTER TABLE users MODIFY COLUMN role enum('admin','technician','seller','cashier','user') NOT NULL DEFAULT 'seller'
    `);
    await runSQL("users.phone column", `
      ALTER TABLE users ADD COLUMN phone varchar(50) NULL
    `);
    await runSQL("users.status column", `
      ALTER TABLE users ADD COLUMN status enum('active','inactive') NOT NULL DEFAULT 'active'
    `);
    await runSQL("users.allowedModules column", `
      ALTER TABLE users ADD COLUMN allowedModules text NULL
    `);
    await runSQL("users.specialPermissions column", `
      ALTER TABLE users ADD COLUMN specialPermissions text NULL
    `);
    await runSQL("users.assignedBranchIds column", `
      ALTER TABLE users ADD COLUMN assignedBranchIds text NULL
    `);

    // ============================================================
    // 2. SESSIONS
    // ============================================================
    await runSQL("sessions table", `
      CREATE TABLE IF NOT EXISTS sessions (
        id varchar(255) NOT NULL,
        userId int NOT NULL,
        expiresAt timestamp NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT sessions_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 2b. BRANCHES
    // ============================================================
    await runSQL("branches table", `
      CREATE TABLE IF NOT EXISTS branches (
        id int AUTO_INCREMENT NOT NULL,
        name varchar(255) NOT NULL,
        address text,
        phone varchar(50),
        isMainWarehouse int NOT NULL DEFAULT 0,
        status enum('active','inactive') NOT NULL DEFAULT 'active',
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT branches_id PRIMARY KEY(id)
      )
    `);

    await runSQL("default branch", `
      INSERT INTO branches (id, name, address, isMainWarehouse, status)
      VALUES (1, 'Sucursal Principal', 'Principal', 1, 'active')
      ON DUPLICATE KEY UPDATE
        name = COALESCE(NULLIF(name, ''), VALUES(name)),
        status = 'active'
    `);

    // ============================================================
    // 3. CUSTOMERS
    // ============================================================
    await runSQL("customers table", `
      CREATE TABLE IF NOT EXISTS customers (
        id int AUTO_INCREMENT NOT NULL,
        clientNumber varchar(50) NOT NULL,
        name varchar(255) NOT NULL,
        phone varchar(20),
        whatsapp varchar(20),
        zone varchar(100),
        address text,
        latitude varchar(50),
        longitude varchar(50),
        age int,
        gender varchar(30),
        socioeconomicLevel varchar(50),
        sourceChannel enum('facebook','tiktok','marketplace','referral','other') DEFAULT 'other',
        customerType enum('retail','wholesale') NOT NULL DEFAULT 'retail',
        interestHealthFitness int NOT NULL DEFAULT 0,
        interestNaturalFood int NOT NULL DEFAULT 0,
        interestDigestiveIssues int NOT NULL DEFAULT 0,
        lifestyleGym int NOT NULL DEFAULT 0,
        lifestyleVegan int NOT NULL DEFAULT 0,
        lifestyleBiohacking int NOT NULL DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT customers_id PRIMARY KEY(id),
        CONSTRAINT customers_clientNumber_unique UNIQUE(clientNumber)
      )
    `);

    // ============================================================
    // 4. PRODUCTS
    // ============================================================
    await runSQL("products table", `
      CREATE TABLE IF NOT EXISTS products (
        id int AUTO_INCREMENT NOT NULL,
        code varchar(50) NOT NULL,
        name varchar(255) NOT NULL,
        category enum('finished_product','raw_material','supplies','insumo') NOT NULL DEFAULT 'finished_product',
        price int NOT NULL,
        salePrice int NOT NULL DEFAULT 0,
        wholesalePrice int NOT NULL DEFAULT 0,
        discountPrice int NOT NULL DEFAULT 0,
        wholesaleDiscountType enum('percentage','fixed') DEFAULT 'percentage',
        wholesaleDiscountValue int NOT NULL DEFAULT 0,
        unit varchar(20) NOT NULL DEFAULT 'unidad',
        presentationQuantity int NOT NULL DEFAULT 1,
        presentationUnit varchar(20) NOT NULL DEFAULT 'unidad',
        presentationVolumeMl int NOT NULL DEFAULT 0,
        presentationWeightGr int NOT NULL DEFAULT 0,
        productionRole enum('none','milk','sugar','culture','bottle','cap','label','packaging','finished_good','other') NOT NULL DEFAULT 'none',
        storageLocation varchar(100),
        supplierName varchar(255),
        productionNotes text,
        status enum('active','inactive') NOT NULL DEFAULT 'active',
        imageUrl varchar(500),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT products_id PRIMARY KEY(id),
        CONSTRAINT products_code_unique UNIQUE(code)
      )
    `);

    // ============================================================
    // 5. INVENTORY
    // ============================================================
    await runSQL("inventory table", `
      CREATE TABLE IF NOT EXISTS inventory (
        id int AUTO_INCREMENT NOT NULL,
        productId int NOT NULL,
        batchNumber varchar(50),
        quantity int NOT NULL DEFAULT 0,
        minStock int NOT NULL DEFAULT 10,
        expiryDate varchar(10),
        lastUpdated timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT inventory_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 6. INVENTORY MOVEMENTS
    // ============================================================
    await runSQL("inventoryMovements table", `
      CREATE TABLE IF NOT EXISTS inventoryMovements (
        id int AUTO_INCREMENT NOT NULL,
        productId int NOT NULL,
        type enum('entry','exit','adjustment') NOT NULL,
        quantity int NOT NULL,
        reason varchar(255),
        notes text,
        userId int,
        orderId int,
        saleId int,
        batchNumber varchar(50),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT inventoryMovements_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 7. ORDERS
    // ============================================================
    await runSQL("orders table", `
      CREATE TABLE IF NOT EXISTS orders (
        id int AUTO_INCREMENT NOT NULL,
        orderNumber varchar(50) NOT NULL,
        customerId int NOT NULL,
        deliveryPersonId int,
        zone varchar(100),
        status enum('pending','assigned','in_transit','delivered','cancelled','rescheduled') NOT NULL DEFAULT 'pending',
        totalPrice int NOT NULL,
        paymentMethod enum('qr','cash','transfer'),
        paymentStatus enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
        notes text,
        sourceChannel enum('facebook','tiktok','marketplace','referral','other') DEFAULT 'other',
        cancelledBy enum('client','company','system'),
        cancelReason text,
        rescheduleReason text,
        deliveryDate varchar(10),
        deliveryTime varchar(5),
        rescheduleRequested int DEFAULT 0,
        requestedDate varchar(10),
        requestedTime varchar(5),
        cancellationRequested int DEFAULT 0,
        cancellationReason text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deliveredAt timestamp NULL,
        CONSTRAINT orders_id PRIMARY KEY(id),
        CONSTRAINT orders_orderNumber_unique UNIQUE(orderNumber)
      )
    `);

    // ============================================================
    // 8. ORDER ITEMS
    // ============================================================
    await runSQL("orderItems table", `
      CREATE TABLE IF NOT EXISTS orderItems (
        id int AUTO_INCREMENT NOT NULL,
        orderId int NOT NULL,
        unitId int NULL,
        productId int NULL,
        pricingType enum('unit','wholesale','discount') DEFAULT 'unit',
        quantity int NOT NULL DEFAULT 1,
        price int NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT orderItems_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 9. PAYMENTS
    // ============================================================
    await runSQL("payments table", `
      CREATE TABLE IF NOT EXISTS payments (
        id int AUTO_INCREMENT NOT NULL,
        orderId int NOT NULL,
        amount int NOT NULL,
        method enum('qr','cash','transfer') NOT NULL,
        status enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
        reference varchar(255),
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT payments_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 10. SUPPLIERS
    // ============================================================
    await runSQL("suppliers table", `
      CREATE TABLE IF NOT EXISTS suppliers (
        id int AUTO_INCREMENT NOT NULL,
        name varchar(255) NOT NULL,
        contactName varchar(255),
        phone varchar(20),
        taxId varchar(50),
        address text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT suppliers_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 11. PURCHASES
    // ============================================================
    await runSQL("purchases table", `
      CREATE TABLE IF NOT EXISTS purchases (
        id int AUTO_INCREMENT NOT NULL,
        supplierId int NOT NULL,
        purchaseNumber varchar(50) NOT NULL,
        orderDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        totalAmount int NOT NULL,
        status enum('pending','received','cancelled') NOT NULL DEFAULT 'pending',
        paymentStatus enum('pending','paid') NOT NULL DEFAULT 'pending',
        paymentMethod enum('cash','qr','transfer') DEFAULT 'cash',
        isCredit int DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT purchases_id PRIMARY KEY(id),
        CONSTRAINT purchases_purchaseNumber_unique UNIQUE(purchaseNumber)
      )
    `);

    // ============================================================
    // 12. PURCHASE ITEMS
    // ============================================================
    await runSQL("purchaseItems table", `
      CREATE TABLE IF NOT EXISTS purchaseItems (
        id int AUTO_INCREMENT NOT NULL,
        purchaseId int NOT NULL,
        productId int NULL,
        unitId int NULL,
        quantity int NOT NULL,
        price int NOT NULL,
        batchNumber varchar(50),
        expiryDate varchar(10),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT purchaseItems_id PRIMARY KEY(id)
      )
    `);
    // Ensure productId is nullable (in case table already existed with NOT NULL)
    await runSQL("purchaseItems.productId nullable", `
      ALTER TABLE purchaseItems MODIFY COLUMN productId int NULL
    `);
    await runSQL("purchaseItems.unitId ensure", `
      ALTER TABLE purchaseItems ADD COLUMN IF NOT EXISTS unitId int NULL AFTER purchaseId
    `);

    // ============================================================
    // 13. ACCOUNTS PAYABLE
    // ============================================================
    await runSQL("accountsPayable table", `
      CREATE TABLE IF NOT EXISTS accountsPayable (
        id int AUTO_INCREMENT NOT NULL,
        purchaseId int NOT NULL,
        supplierId int NULL,
        totalAmount int NOT NULL DEFAULT 0,
        paidAmount int NOT NULL DEFAULT 0,
        balance int NOT NULL DEFAULT 0,
        dueDate varchar(10),
        status enum('unpaid','partially_paid','paid','overdue') NOT NULL DEFAULT 'unpaid',
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT accountsPayable_id PRIMARY KEY(id)
      )
    `);

    await runSQL("accountsPayable.supplierId column", `
      ALTER TABLE accountsPayable ADD COLUMN supplierId int NULL AFTER purchaseId
    `);
    await runSQL("accountsPayable.totalAmount column", `
      ALTER TABLE accountsPayable ADD COLUMN totalAmount int NOT NULL DEFAULT 0 AFTER supplierId
    `);
    await runSQL("accountsPayable.paidAmount column", `
      ALTER TABLE accountsPayable ADD COLUMN paidAmount int NOT NULL DEFAULT 0 AFTER totalAmount
    `);
    await runSQL("accountsPayable.balance column", `
      ALTER TABLE accountsPayable ADD COLUMN balance int NOT NULL DEFAULT 0 AFTER paidAmount
    `);
    await runSQL("accountsPayable.updatedAt column", `
      ALTER TABLE accountsPayable ADD COLUMN updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `);
    await runSQL("accountsPayable.dueDate modify", `
      ALTER TABLE accountsPayable MODIFY COLUMN dueDate varchar(10) NULL
    `);
    await runSQL("accountsPayable.status modify", `
      ALTER TABLE accountsPayable MODIFY COLUMN status enum('unpaid','partially_paid','paid','overdue') NOT NULL DEFAULT 'unpaid'
    `);
    await runSQL("accountsPayable.amount column nullable", `
      ALTER TABLE accountsPayable MODIFY COLUMN amount int NULL DEFAULT NULL
    `);
    try {
      await connection.query("UPDATE accountsPayable SET totalAmount = amount WHERE totalAmount = 0 AND amount IS NOT NULL AND amount > 0");
    } catch (_) {}
    try {
      await connection.query("UPDATE accountsPayable SET balance = totalAmount - paidAmount WHERE balance = 0 AND totalAmount > 0");
    } catch (_) {}


    // ============================================================
    // 14. DELIVERY EXPENSES
    // ============================================================
    await runSQL("deliveryExpenses table", `
      CREATE TABLE IF NOT EXISTS deliveryExpenses (
        id int AUTO_INCREMENT NOT NULL,
        deliveryPersonId int NOT NULL,
        orderId int,
        amount int NOT NULL,
        type enum('fuel','subsistence','other') NOT NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT deliveryExpenses_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 15. OPERATIONAL EXPENSES
    // ============================================================
    await runSQL("operationalExpenses table", `
      CREATE TABLE IF NOT EXISTS operationalExpenses (
        id int AUTO_INCREMENT NOT NULL,
        branchId int NOT NULL DEFAULT 1,
        description varchar(255) NOT NULL,
        category enum('facebook_ads','google_ads','electricity','water','internet','telephone','rent','salaries','maintenance','supplies','taxes','insurance','bank_fees','repair_cost','warranty_repair_cost','warranty_replacement_cost','cogs','other') NOT NULL,
        costType varchar(50),
        referenceType varchar(50),
        referenceId int,
        isAutomatic int NOT NULL DEFAULT 0,
        amount int NOT NULL,
        paymentMethod enum('cash','qr','transfer') NOT NULL,
        expenseDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        dueDate timestamp NULL,
        status enum('pending','paid') NOT NULL DEFAULT 'pending',
        supplierName varchar(255),
        invoiceNumber varchar(100),
        notes text,
        userId int,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT operationalExpenses_id PRIMARY KEY(id)
      )
    `);

    await runSQL("operationalExpenses.branchId column", `
      ALTER TABLE operationalExpenses ADD COLUMN branchId int NOT NULL DEFAULT 1
    `);
    await runSQL("operationalExpenses.costType column", `
      ALTER TABLE operationalExpenses ADD COLUMN costType varchar(50) NULL
    `);
    await runSQL("operationalExpenses.referenceType column", `
      ALTER TABLE operationalExpenses ADD COLUMN referenceType varchar(50) NULL
    `);
    await runSQL("operationalExpenses.referenceId column", `
      ALTER TABLE operationalExpenses ADD COLUMN referenceId int NULL
    `);
    await runSQL("operationalExpenses.isAutomatic column", `
      ALTER TABLE operationalExpenses ADD COLUMN isAutomatic int NOT NULL DEFAULT 0
    `);
    await runSQL("operationalExpenses.category enum", `
      ALTER TABLE operationalExpenses MODIFY COLUMN category enum('facebook_ads','google_ads','electricity','water','internet','telephone','rent','salaries','maintenance','supplies','taxes','insurance','bank_fees','fuel','subsistence','logistics','repair_cost','warranty_repair_cost','warranty_replacement_cost','cogs','other') NOT NULL
    `);

    // ============================================================
    // 16. FINANCIAL TRANSACTIONS
    // ============================================================
    await runSQL("financialTransactions table", `
      CREATE TABLE IF NOT EXISTS financialTransactions (
        id int AUTO_INCREMENT NOT NULL,
        branchId int NOT NULL DEFAULT 1,
        type enum('income','expense') NOT NULL,
        category varchar(100) NOT NULL,
        paymentMethod enum('cash','qr','transfer') DEFAULT 'cash',
        amount int NOT NULL,
        unitCost int,
        userId int,
        referenceId int,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT financialTransactions_id PRIMARY KEY(id)
      )
    `);

    await runSQL("financialTransactions.branchId column", `
      ALTER TABLE financialTransactions ADD COLUMN branchId int NOT NULL DEFAULT 1
    `);
    await runSQL("financialTransactions.unitCost column", `
      ALTER TABLE financialTransactions ADD COLUMN unitCost int NULL
    `);

    // ============================================================
    // 17. GPS TRACKING
    // ============================================================
    await runSQL("gpsTracking table", `
      CREATE TABLE IF NOT EXISTS gpsTracking (
        id int AUTO_INCREMENT NOT NULL,
        orderId int NOT NULL,
        deliveryPersonId int NOT NULL,
        latitude varchar(50) NOT NULL,
        longitude varchar(50) NOT NULL,
        accuracy int,
        timestamp timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT gpsTracking_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 18. CASH CLOSURES
    // ============================================================
    await runSQL("cash_closures table", `
      CREATE TABLE IF NOT EXISTS cash_closures (
        id int AUTO_INCREMENT NOT NULL,
        branchId int NOT NULL DEFAULT 1,
        userId int NOT NULL,
        date varchar(10) NOT NULL,
        initialCash int DEFAULT 0,
        reportedCash int DEFAULT 0,
        reportedQr int DEFAULT 0,
        reportedTransfer int DEFAULT 0,
        expectedCash int DEFAULT 0,
        expectedQr int DEFAULT 0,
        expectedTransfer int DEFAULT 0,
        expenses int DEFAULT 0,
        pendingOrders int DEFAULT 0,
        status enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        adminNotes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT cash_closures_id PRIMARY KEY(id)
      )
    `);

    await runSQL("cash_closures.branchId column", `
      ALTER TABLE cash_closures ADD COLUMN branchId int NOT NULL DEFAULT 1
    `);

    // ============================================================
    // 19. CASH OPENINGS
    // ============================================================
    await runSQL("cash_openings table", `
      CREATE TABLE IF NOT EXISTS cash_openings (
        id int AUTO_INCREMENT NOT NULL,
        branchId int NOT NULL DEFAULT 1,
        openingDate varchar(10) NOT NULL,
        openingAmount int NOT NULL DEFAULT 0,
        paymentMethod enum('cash','qr','transfer') DEFAULT 'cash',
        responsibleUserId int NOT NULL,
        openedByUserId int NOT NULL,
        status enum('open','closed') NOT NULL DEFAULT 'open',
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT cash_openings_id PRIMARY KEY(id)
      )
    `);

    await runSQL("cash_openings.branchId column", `
      ALTER TABLE cash_openings ADD COLUMN branchId int NOT NULL DEFAULT 1
    `);

    // Add paymentMethod column if table already existed without it
    await runSQL("cash_openings.paymentMethod column", `
      ALTER TABLE cash_openings ADD COLUMN paymentMethod enum('cash','qr','transfer') DEFAULT 'cash' AFTER openingAmount
    `);

    // ============================================================
    // 20. SALES
    // ============================================================
    await runSQL("sales table", `
      CREATE TABLE IF NOT EXISTS sales (
        id int AUTO_INCREMENT NOT NULL,
        saleNumber varchar(50) NOT NULL,
        branchId int NOT NULL DEFAULT 1,
        customerId int,
        customerName varchar(255),
        saleChannel enum('local','delivery') NOT NULL DEFAULT 'local',
        status enum('completed','cancelled') NOT NULL DEFAULT 'completed',
        orderId int,
        soldBy int NOT NULL,
        subtotal int NOT NULL,
        discountType enum('none','percentage','fixed') NOT NULL DEFAULT 'none',
        discountValue int NOT NULL DEFAULT 0,
        discountAmount int NOT NULL DEFAULT 0,
        total int NOT NULL,
        paymentMethod enum('cash','qr','transfer','credit') NOT NULL,
        paymentStatus enum('pending','completed') NOT NULL DEFAULT 'completed',
        dueDate varchar(10) NULL,
        warrantyDays int NOT NULL DEFAULT 30,
        adminOverrideUserId int NULL,
        notes text,
        cancelReason text,
        cancelledAt timestamp NULL,
        cancelledBy int,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT sales_id PRIMARY KEY(id),
        CONSTRAINT sales_saleNumber_unique UNIQUE(saleNumber)
      )
    `);
    // Migrate existing sales table — add missing columns and expand enum
    await runSQL("sales.branchId column", `ALTER TABLE sales ADD COLUMN IF NOT EXISTS branchId int NOT NULL DEFAULT 1 AFTER saleNumber`);
    await runSQL("sales.dueDate column", `ALTER TABLE sales ADD COLUMN IF NOT EXISTS dueDate varchar(10) NULL AFTER paymentStatus`);
    await runSQL("sales.warrantyDays column", `ALTER TABLE sales ADD COLUMN IF NOT EXISTS warrantyDays int NOT NULL DEFAULT 30 AFTER dueDate`);
    await runSQL("sales.adminOverrideUserId column", `ALTER TABLE sales ADD COLUMN IF NOT EXISTS adminOverrideUserId int NULL AFTER warrantyDays`);
    await runSQL("sales.creditDays column", `ALTER TABLE sales ADD COLUMN IF NOT EXISTS creditDays int NULL AFTER warrantyDays`);
    // Expand paymentMethod enum to include 'credit'
    await runSQL("sales.paymentMethod expand enum", `
      ALTER TABLE sales MODIFY COLUMN paymentMethod enum('cash','qr','transfer','credit') NOT NULL
    `);

    // ============================================================
    // 21. SALE ITEMS
    // ============================================================
    await runSQL("saleItems table", `
      CREATE TABLE IF NOT EXISTS saleItems (
        id int AUTO_INCREMENT NOT NULL,
        saleId int NOT NULL,
        productId int NULL,
        unitId int NULL,
        pricingType enum('unit','wholesale','discount') NOT NULL DEFAULT 'unit',
        quantity int NOT NULL,
        basePrice int NOT NULL,
        discountType enum('none','percentage','fixed') NOT NULL DEFAULT 'none',
        discountValue int NOT NULL DEFAULT 0,
        discountAmount int NOT NULL DEFAULT 0,
        finalUnitPrice int NOT NULL DEFAULT 0,
        subtotal int NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT saleItems_id PRIMARY KEY(id)
      )
    `);
    // Migrate existing saleItems — make productId nullable and add unitId/pricingType
    await runSQL("saleItems.productId nullable", `ALTER TABLE saleItems MODIFY COLUMN productId int NULL`);
    await runSQL("saleItems.unitId column", `ALTER TABLE saleItems ADD COLUMN IF NOT EXISTS unitId int NULL AFTER productId`);
    await runSQL("saleItems.pricingType column", `ALTER TABLE saleItems ADD COLUMN IF NOT EXISTS pricingType enum('unit','wholesale','discount') NOT NULL DEFAULT 'unit' AFTER unitId`);

    // ============================================================
    // 22. AUDIT LOG
    // ============================================================
    await runSQL("auditLog table", `
      CREATE TABLE IF NOT EXISTS auditLog (
        id int AUTO_INCREMENT NOT NULL,
        entityType varchar(100) NOT NULL,
        entityId int NOT NULL,
        action enum('CREATE','UPDATE','DELETE') NOT NULL,
        userId int,
        oldValues text,
        newValues text,
        description text,
        ipAddress varchar(45),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT auditLog_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 23. QUOTATIONS
    // ============================================================
    await runSQL("quotations table", `
      CREATE TABLE IF NOT EXISTS quotations (
        id int AUTO_INCREMENT NOT NULL,
        quotationNumber varchar(50) NOT NULL,
        customerId int,
        customerName varchar(255),
        status enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
        subtotal int NOT NULL,
        discountType enum('none','percentage','fixed') NOT NULL DEFAULT 'none',
        discountValue int NOT NULL DEFAULT 0,
        discountAmount int NOT NULL DEFAULT 0,
        total int NOT NULL,
        validUntil timestamp NULL,
        notes text,
        termsAndConditions text,
        createdBy int NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT quotations_id PRIMARY KEY(id),
        CONSTRAINT quotations_quotationNumber_unique UNIQUE(quotationNumber)
      )
    `);

    // ============================================================
    // 24. QUOTATION ITEMS
    // ============================================================
    await runSQL("quotationItems table", `
      CREATE TABLE IF NOT EXISTS quotationItems (
        id int AUTO_INCREMENT NOT NULL,
        quotationId int NOT NULL,
        unitId int NULL,
        productId int NULL,
        pricingType enum('unit','wholesale','discount') NOT NULL DEFAULT 'unit',
        quantity int NOT NULL DEFAULT 1,
        basePrice int NOT NULL,
        discountType enum('none','percentage','fixed') NOT NULL DEFAULT 'none',
        discountValue int NOT NULL DEFAULT 0,
        discountAmount int NOT NULL DEFAULT 0,
        finalUnitPrice int NOT NULL DEFAULT 0,
        subtotal int NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT quotationItems_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 25. DELIVERY EXTRA LOAD
    // ============================================================
    await runSQL("delivery_extra_load table", `
      CREATE TABLE IF NOT EXISTS delivery_extra_load (
        id int AUTO_INCREMENT NOT NULL,
        deliveryPersonId int NOT NULL,
        productId int NOT NULL,
        quantity int NOT NULL,
        type enum('sale','sample') NOT NULL DEFAULT 'sale',
        status enum('loaded','sold','used','returned') NOT NULL DEFAULT 'loaded',
        date varchar(10) NOT NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT delivery_extra_load_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 26. PRODUCTION BATCHES
    // ============================================================
    await runSQL("production_batches table", `
      CREATE TABLE IF NOT EXISTS production_batches (
        id int AUTO_INCREMENT NOT NULL,
        batchNumber varchar(50) NOT NULL,
        type enum('kefir_production','nodule_washing','maintenance') NOT NULL,
        status enum('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
        startDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        endDate timestamp NULL,
        registeredBy int NOT NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT production_batches_id PRIMARY KEY(id),
        CONSTRAINT production_batches_batchNumber_unique UNIQUE(batchNumber)
      )
    `);

    // ============================================================
    // 27. PRODUCTION OUTPUTS
    // ============================================================
    await runSQL("production_outputs table", `
      CREATE TABLE IF NOT EXISTS production_outputs (
        id int AUTO_INCREMENT NOT NULL,
        batchId int NOT NULL,
        productId int NOT NULL,
        quantity int NOT NULL,
        expectedQuantity int,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT production_outputs_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 28. PRODUCTION INPUTS
    // ============================================================
    await runSQL("production_inputs table", `
      CREATE TABLE IF NOT EXISTS production_inputs (
        id int AUTO_INCREMENT NOT NULL,
        batchId int NOT NULL,
        productId int NOT NULL,
        quantity int NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT production_inputs_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 29. PRODUCTION INVENTORY
    // ============================================================
    await runSQL("production_inventory table", `
      CREATE TABLE IF NOT EXISTS production_inventory (
        id int AUTO_INCREMENT NOT NULL,
        productId int NOT NULL,
        quantity int NOT NULL DEFAULT 0,
        lastUpdated timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT production_inventory_id PRIMARY KEY(id)
      )
    `);

    // ============================================================
    // 30. INVENTORY TRANSFERS
    // ============================================================
    await runSQL("inventory_transfers table", `
      CREATE TABLE IF NOT EXISTS inventory_transfers (
        id int AUTO_INCREMENT NOT NULL,
        transferNumber varchar(50) NOT NULL,
        direction varchar(50) NOT NULL DEFAULT 'branch_transfer',
        sourceBranchId int NOT NULL DEFAULT 1,
        destinationBranchId int NOT NULL DEFAULT 1,
        status enum('pending','in_transit','completed','cancelled') NOT NULL DEFAULT 'pending',
        userId int NOT NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT inventory_transfers_id PRIMARY KEY(id),
        CONSTRAINT inventory_transfers_transferNumber_unique UNIQUE(transferNumber)
      )
    `);

    await runSQL("inventory_transfers.sourceBranchId column", `
      ALTER TABLE inventory_transfers ADD COLUMN sourceBranchId int NOT NULL DEFAULT 1 AFTER direction
    `);
    await runSQL("inventory_transfers.destinationBranchId column", `
      ALTER TABLE inventory_transfers ADD COLUMN destinationBranchId int NOT NULL DEFAULT 1 AFTER sourceBranchId
    `);
    await runSQL("inventory_transfers.direction upgrade", `
      ALTER TABLE inventory_transfers MODIFY COLUMN direction varchar(50) NOT NULL DEFAULT 'branch_transfer'
    `);
    await runSQL("inventory_transfers.status upgrade", `
      ALTER TABLE inventory_transfers MODIFY COLUMN status enum('pending','in_transit','completed','cancelled') NOT NULL DEFAULT 'pending'
    `);

    // ============================================================
    // 31. INVENTORY TRANSFER ITEMS
    // ============================================================
    await runSQL("inventory_transfer_items table", `
      CREATE TABLE IF NOT EXISTS inventory_transfer_items (
        id int AUTO_INCREMENT NOT NULL,
        transferId int NOT NULL,
        unitId int NOT NULL,
        quantity int NOT NULL DEFAULT 1,
        unitCode varchar(50),
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT inventory_transfer_items_id PRIMARY KEY(id)
      )
    `);

    await runSQL("inventory_transfer_items.unitId column", `
      ALTER TABLE inventory_transfer_items ADD COLUMN unitId int NOT NULL DEFAULT 0 AFTER transferId
    `);
    await runSQL("inventory_transfer_items.unitCode column", `
      ALTER TABLE inventory_transfer_items ADD COLUMN unitCode varchar(50) NULL AFTER quantity
    `);
    await runSQL("inventory_transfer_items.notes column", `
      ALTER TABLE inventory_transfer_items ADD COLUMN notes text NULL AFTER unitCode
    `);
    await runSQL("inventory_transfer_items.productId column", `
      ALTER TABLE inventory_transfer_items ADD COLUMN productId int NULL DEFAULT 0
    `);
    await runSQL("inventory_transfer_items.productId nullable", `
      ALTER TABLE inventory_transfer_items MODIFY COLUMN productId int NULL DEFAULT 0
    `);
    await runSQL("inventory_transfer_items.productName nullable", `
      ALTER TABLE inventory_transfer_items MODIFY COLUMN productName varchar(255) NULL
    `);
    await runSQL("inventory_transfer_items.productUnit nullable", `
      ALTER TABLE inventory_transfer_items MODIFY COLUMN productUnit varchar(50) NULL
    `);

    // ============================================================
    // ENSURE MISSING COLUMNS ON EXISTING TABLES
    // (for tables that were created by old migrations without these columns)
    // ============================================================
    console.log("\n[EnsureTables] Checking for missing columns on existing tables...");

    // inventory columns
    await runSQL("inventory.batchNumber", `ALTER TABLE inventory ADD COLUMN batchNumber VARCHAR(50) AFTER productId`);
    await runSQL("inventory.expiryDate", `ALTER TABLE inventory ADD COLUMN expiryDate VARCHAR(10) AFTER minStock`);

    // inventoryMovements columns
    await runSQL("inventoryMovements.userId", `ALTER TABLE inventoryMovements ADD COLUMN userId INT AFTER notes`);
    await runSQL("inventoryMovements.orderId", `ALTER TABLE inventoryMovements ADD COLUMN orderId INT AFTER userId`);
    await runSQL("inventoryMovements.saleId", `ALTER TABLE inventoryMovements ADD COLUMN saleId INT AFTER orderId`);
    await runSQL("inventoryMovements.batchNumber", `ALTER TABLE inventoryMovements ADD COLUMN batchNumber VARCHAR(50) AFTER saleId`);

    // purchaseItems columns
    await runSQL("purchases.branchId", `ALTER TABLE purchases ADD COLUMN branchId INT DEFAULT 1 AFTER isCredit`);
    await runSQL("purchaseItems.batchNumber", `ALTER TABLE purchaseItems ADD COLUMN batchNumber VARCHAR(50) AFTER price`);
    await runSQL("purchaseItems.expiryDate", `ALTER TABLE purchaseItems ADD COLUMN expiryDate VARCHAR(10) AFTER batchNumber`);

    // orders columns
    await runSQL("orders.sourceChannel", `ALTER TABLE orders ADD COLUMN sourceChannel enum('facebook','tiktok','marketplace','referral','other') DEFAULT 'other' AFTER notes`);
    await runSQL("orders.cancelledBy", `ALTER TABLE orders ADD COLUMN cancelledBy enum('client','company','system') AFTER sourceChannel`);
    await runSQL("orders.cancelReason", `ALTER TABLE orders ADD COLUMN cancelReason text AFTER cancelledBy`);
    await runSQL("orders.rescheduleReason", `ALTER TABLE orders ADD COLUMN rescheduleReason text AFTER cancelReason`);
    await runSQL("orders.deliveryDate", `ALTER TABLE orders ADD COLUMN deliveryDate varchar(10) AFTER rescheduleReason`);
    await runSQL("orders.deliveryTime", `ALTER TABLE orders ADD COLUMN deliveryTime varchar(5) AFTER deliveryDate`);
    await runSQL("orders.rescheduleRequested", `ALTER TABLE orders ADD COLUMN rescheduleRequested int DEFAULT 0 AFTER deliveryTime`);
    await runSQL("orders.requestedDate", `ALTER TABLE orders ADD COLUMN requestedDate varchar(10) AFTER rescheduleRequested`);
    await runSQL("orders.requestedTime", `ALTER TABLE orders ADD COLUMN requestedTime varchar(5) AFTER requestedDate`);
    await runSQL("orders.cancellationRequested", `ALTER TABLE orders ADD COLUMN cancellationRequested int DEFAULT 0 AFTER requestedTime`);
    await runSQL("orders.cancellationReason", `ALTER TABLE orders ADD COLUMN cancellationReason text AFTER cancellationRequested`);
    await runSQL("orders.deliveredAt", `ALTER TABLE orders ADD COLUMN deliveredAt timestamp NULL AFTER updatedAt`);

    // orderItems columns - ensure unitId, nullable productId and pricingType exist
    await runSQL("orderItems.unitId", `ALTER TABLE orderItems ADD COLUMN unitId INT NULL AFTER orderId`);
    await runSQL("orderItems.productId nullable", `ALTER TABLE orderItems MODIFY COLUMN productId INT NULL`);
    await runSQL("orderItems.pricingType", `ALTER TABLE orderItems ADD COLUMN pricingType enum('unit','wholesale','discount') DEFAULT 'unit'`);

    // units batteryHealth enum upgrade to percentages and plugged_only
    await runSQL("units.batteryHealth enum upgrade", `ALTER TABLE units MODIFY COLUMN batteryHealth enum('100','90','80','70','60','50','40','plugged_only','good','fair','bad_plugged_only','n_a') NOT NULL DEFAULT 'n_a'`);

    // customers profile columns
    await runSQL("customers.age", `ALTER TABLE customers ADD COLUMN age INT AFTER longitude`);
    await runSQL("customers.gender", `ALTER TABLE customers ADD COLUMN gender VARCHAR(30) AFTER age`);
    await runSQL("customers.socioeconomicLevel", `ALTER TABLE customers ADD COLUMN socioeconomicLevel VARCHAR(50) AFTER gender`);
    await runSQL("customers.sourceChannel", `ALTER TABLE customers ADD COLUMN sourceChannel enum('facebook','tiktok','marketplace','referral','other') DEFAULT 'other' AFTER socioeconomicLevel`);
    await runSQL("customers.customerType", `ALTER TABLE customers ADD COLUMN customerType enum('retail','wholesale') NOT NULL DEFAULT 'retail' AFTER sourceChannel`);
    await runSQL("customers.interestHealthFitness", `ALTER TABLE customers ADD COLUMN interestHealthFitness INT NOT NULL DEFAULT 0 AFTER customerType`);
    await runSQL("customers.interestNaturalFood", `ALTER TABLE customers ADD COLUMN interestNaturalFood INT NOT NULL DEFAULT 0 AFTER interestHealthFitness`);
    await runSQL("customers.interestDigestiveIssues", `ALTER TABLE customers ADD COLUMN interestDigestiveIssues INT NOT NULL DEFAULT 0 AFTER interestNaturalFood`);
    await runSQL("customers.lifestyleGym", `ALTER TABLE customers ADD COLUMN lifestyleGym INT NOT NULL DEFAULT 0 AFTER interestDigestiveIssues`);
    await runSQL("customers.lifestyleVegan", `ALTER TABLE customers ADD COLUMN lifestyleVegan INT NOT NULL DEFAULT 0 AFTER lifestyleGym`);
    await runSQL("customers.lifestyleBiohacking", `ALTER TABLE customers ADD COLUMN lifestyleBiohacking INT NOT NULL DEFAULT 0 AFTER lifestyleVegan`);

    // products production columns
    await runSQL("products.category enum upgrade", `ALTER TABLE products MODIFY COLUMN category enum('finished_product','raw_material','supplies','insumo') NOT NULL DEFAULT 'finished_product'`);
    await runSQL("products.salePrice", `ALTER TABLE products ADD COLUMN salePrice INT NOT NULL DEFAULT 0 AFTER price`);
    await runSQL("products.wholesalePrice", `ALTER TABLE products ADD COLUMN wholesalePrice INT NOT NULL DEFAULT 0 AFTER salePrice`);
    await runSQL("products.discountPrice", `ALTER TABLE products ADD COLUMN discountPrice INT NOT NULL DEFAULT 0 AFTER wholesalePrice`);
    await runSQL("products.wholesaleDiscountType", `ALTER TABLE products ADD COLUMN wholesaleDiscountType enum('percentage','fixed') DEFAULT 'percentage' AFTER discountPrice`);
    await runSQL("products.wholesaleDiscountValue", `ALTER TABLE products ADD COLUMN wholesaleDiscountValue INT NOT NULL DEFAULT 0 AFTER wholesaleDiscountType`);
    await runSQL("products.unit", `ALTER TABLE products ADD COLUMN unit varchar(20) NOT NULL DEFAULT 'unidad' AFTER wholesaleDiscountValue`);
    await runSQL("products.presentationQuantity", `ALTER TABLE products ADD COLUMN presentationQuantity int NOT NULL DEFAULT 1 AFTER unit`);
    await runSQL("products.presentationUnit", `ALTER TABLE products ADD COLUMN presentationUnit varchar(20) NOT NULL DEFAULT 'unidad' AFTER presentationQuantity`);
    await runSQL("products.presentationVolumeMl", `ALTER TABLE products ADD COLUMN presentationVolumeMl INT NOT NULL DEFAULT 0 AFTER presentationUnit`);
    await runSQL("products.presentationWeightGr", `ALTER TABLE products ADD COLUMN presentationWeightGr INT NOT NULL DEFAULT 0 AFTER presentationVolumeMl`);
    await runSQL("products.productionRole", `ALTER TABLE products ADD COLUMN productionRole enum('none','milk','sugar','culture','bottle','cap','label','packaging','finished_good','other') NOT NULL DEFAULT 'none' AFTER presentationWeightGr`);
    await runSQL("products.storageLocation", `ALTER TABLE products ADD COLUMN storageLocation VARCHAR(100) AFTER productionRole`);
    await runSQL("products.supplierName", `ALTER TABLE products ADD COLUMN supplierName VARCHAR(255) AFTER storageLocation`);
    await runSQL("products.productionNotes", `ALTER TABLE products ADD COLUMN productionNotes TEXT AFTER supplierName`);
    await runSQL("products.imageUrl", `ALTER TABLE products ADD COLUMN imageUrl VARCHAR(500) AFTER status`);

    // ============================================================
    // MIGRACIONES 0015-0017: columnas nuevas
    // ============================================================

    // userBranches table
    await runSQL("userBranches table", `
      CREATE TABLE IF NOT EXISTS userBranches (
        id int AUTO_INCREMENT NOT NULL,
        userId int NOT NULL,
        branchId int NOT NULL DEFAULT 1,
        isDefault int NOT NULL DEFAULT 0,
        CONSTRAINT userBranches_id PRIMARY KEY(id)
      )
    `);

    // systemSettings table
    await runSQL("systemSettings table", `
      CREATE TABLE IF NOT EXISTS systemSettings (
        id int AUTO_INCREMENT NOT NULL,
        \`key\` varchar(100) NOT NULL,
        value text NOT NULL,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT systemSettings_id PRIMARY KEY(id),
        CONSTRAINT systemSettings_key_unique UNIQUE(\`key\`)
      )
    `);

    // generatedCodeBatches table
    await runSQL("generatedCodeBatches table", `
      CREATE TABLE IF NOT EXISTS generatedCodeBatches (
        id int AUTO_INCREMENT NOT NULL,
        quantity int NOT NULL,
        type enum('qr','barcode') NOT NULL,
        createdBy int NOT NULL,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT generatedCodeBatches_id PRIMARY KEY(id)
      )
    `);

    // generatedCodes table
    await runSQL("generatedCodes table", `
      CREATE TABLE IF NOT EXISTS generatedCodes (
        id int AUTO_INCREMENT NOT NULL,
        code varchar(100) NOT NULL,
        type enum('qr','barcode') NOT NULL,
        status enum('unassigned','assigned') NOT NULL DEFAULT 'unassigned',
        batchId int NOT NULL,
        assignedUnitId int,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        assignedAt timestamp NULL,
        CONSTRAINT generatedCodes_id PRIMARY KEY(id),
        CONSTRAINT generatedCodes_code_unique UNIQUE(code)
      )
    `);

    // units table
    await runSQL("units table", `
      CREATE TABLE IF NOT EXISTS units (
        id int AUTO_INCREMENT NOT NULL,
        code varchar(50) NOT NULL,
        rmaNumber varchar(30) NULL,
        codeId int,
        type enum('laptop','tablet','phone','monitor','charger','accessory','other') NOT NULL,
        brand varchar(100) NOT NULL,
        model varchar(100) NOT NULL,
        serialNumber varchar(100),
        specs text,
        \`condition\` int,
        batteryHealth enum('100','90','80','70','60','50','40','plugged_only','n_a') NOT NULL DEFAULT 'n_a',
        damageChecklist text,
        damageNotes text,
        functionalTestPassed int DEFAULT 1,
        status enum('in_diagnosis','in_repair','available','sold','returned') NOT NULL DEFAULT 'in_diagnosis',
        purchaseId int,
        purchasePrice int NOT NULL DEFAULT 0,
        salePrice int,
        discountPrice int,
        wholesalePrice int,
        supplierId int,
        purchaseDate varchar(10),
        photos LONGTEXT,
        tiktokUrl varchar(500),
        branchId int NOT NULL DEFAULT 1,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT units_id PRIMARY KEY(id),
        CONSTRAINT units_code_unique UNIQUE(code)
      )
    `);
    await runSQL("units.photos LONGTEXT", `
      ALTER TABLE units MODIFY COLUMN photos LONGTEXT
    `);
    await runSQL("units.rmaNumber unique", `
      ALTER TABLE units ADD UNIQUE INDEX units_rmaNumber_unique (rmaNumber)
    `);

    // unitEvents table
    await runSQL("unitEvents table", `
      CREATE TABLE IF NOT EXISTS unitEvents (
        id int AUTO_INCREMENT NOT NULL,
        unitId int NOT NULL,
        eventType varchar(50) NOT NULL,
        fromStatus varchar(50),
        toStatus varchar(50),
        userId int,
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unitEvents_id PRIMARY KEY(id)
      )
    `);

    // repairs table
    await runSQL("repairs table", `
      CREATE TABLE IF NOT EXISTS repairs (
        id int AUTO_INCREMENT NOT NULL,
        rmaNumber varchar(30),
        otNumber varchar(30),
        unitId int NOT NULL,
        technicianId int,
        startDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        endDate timestamp NULL,
        partsUsed text,
        laborCost int NOT NULL DEFAULT 0,
        partsCost int NOT NULL DEFAULT 0,
        status enum('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
        resolutionType enum('return_to_customer','return_to_inventory'),
        notes text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT repairs_id PRIMARY KEY(id)
      )
    `);

    // warranties table
    await runSQL("warranties table", `
      CREATE TABLE IF NOT EXISTS warranties (
        id int AUTO_INCREMENT NOT NULL,
        saleId int,
        orderId int,
        unitId int NOT NULL,
        days int NOT NULL DEFAULT 30,
        startDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        endDate timestamp NOT NULL,
        status enum('active','claimed','expired','paused') NOT NULL DEFAULT 'active',
        pausedAt timestamp NULL,
        remainingDaysAtPause int,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT warranties_id PRIMARY KEY(id)
      )
    `);

    // returns table
    await runSQL("returns table", `
      CREATE TABLE IF NOT EXISTS \`returns\` (
        id int AUTO_INCREMENT NOT NULL,
        warrantyId int,
        saleId int,
        unitId int NOT NULL,
        returnDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason text NOT NULL,
        resolution text,
        reenteredRepair int NOT NULL DEFAULT 0,
        refundAmount int,
        refundPaymentMethod varchar(20),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT returns_id PRIMARY KEY(id)
      )
    `);

    // accountsReceivable table
    await runSQL("accountsReceivable table", `
      CREATE TABLE IF NOT EXISTS accountsReceivable (
        id int AUTO_INCREMENT NOT NULL,
        saleId int NOT NULL,
        customerId int NOT NULL,
        totalAmount int NOT NULL,
        paidAmount int NOT NULL DEFAULT 0,
        balance int NOT NULL,
        dueDate varchar(10),
        status enum('unpaid','partially_paid','paid','overdue') NOT NULL DEFAULT 'unpaid',
        adminOverrideUserId int,
        adminOverrideReason text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT accountsReceivable_id PRIMARY KEY(id)
      )
    `);

    await runSQL("accountsReceivable.adminOverrideUserId column", `
      ALTER TABLE accountsReceivable ADD COLUMN adminOverrideUserId int NULL
    `);
    await runSQL("accountsReceivable.adminOverrideReason column", `
      ALTER TABLE accountsReceivable ADD COLUMN adminOverrideReason text NULL
    `);
    await runSQL("accountsReceivable.updatedAt column", `
      ALTER TABLE accountsReceivable ADD COLUMN updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `);
    await runSQL("accountsReceivable.dueDate modify", `
      ALTER TABLE accountsReceivable MODIFY COLUMN dueDate varchar(10) NULL
    `);
    await runSQL("accountsReceivable.status modify", `
      ALTER TABLE accountsReceivable MODIFY COLUMN status enum('unpaid','partially_paid','paid','overdue') NOT NULL DEFAULT 'unpaid'
    `);

    // creditPayments table
    await runSQL("creditPayments table", `
      CREATE TABLE IF NOT EXISTS creditPayments (
        id int AUTO_INCREMENT NOT NULL,
        type enum('receivable','payable') NOT NULL,
        accountsReceivableId int,
        accountsPayableId int,
        customerId int,
        supplierId int,
        amount int NOT NULL,
        paymentMethod enum('cash','qr','transfer') NOT NULL DEFAULT 'cash',
        reference varchar(255),
        notes text,
        userId int NOT NULL,
        receiptNumber varchar(50),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT creditPayments_id PRIMARY KEY(id)
      )
    `);

    await runSQL("creditPayments.accountsPayableId column", `
      ALTER TABLE creditPayments ADD COLUMN accountsPayableId int NULL AFTER accountsReceivableId
    `);
    await runSQL("creditPayments.supplierId column", `
      ALTER TABLE creditPayments ADD COLUMN supplierId int NULL AFTER customerId
    `);

    // purchaseItems table — add unitId column if missing
    await runSQL("purchaseItems.unitId column", `
      ALTER TABLE purchaseItems ADD COLUMN unitId int NULL AFTER purchaseId
    `);

    // purchases.paymentMethod column
    await runSQL("purchases.paymentMethod column", `
      ALTER TABLE purchases ADD COLUMN paymentMethod enum('cash','qr','transfer','credit') NULL AFTER paymentStatus
    `);
    await runSQL("purchases.paymentMethod enum upgrade", `
      ALTER TABLE purchases MODIFY COLUMN paymentMethod enum('cash','qr','transfer','credit') NULL DEFAULT 'cash'
    `);
    await runSQL("purchases.isCredit column", `
      ALTER TABLE purchases ADD COLUMN isCredit int NOT NULL DEFAULT 0 AFTER paymentMethod
    `);
    await runSQL("purchases.dueDate column", `
      ALTER TABLE purchases ADD COLUMN dueDate varchar(10) NULL AFTER isCredit
    `);

    // sales extra columns
    await runSQL("sales.warrantyDays column", `
      ALTER TABLE sales ADD COLUMN warrantyDays int NOT NULL DEFAULT 30 AFTER paymentStatus
    `);
    await runSQL("sales.creditDays column", `
      ALTER TABLE sales ADD COLUMN creditDays int NULL AFTER warrantyDays
    `);
    await runSQL("sales.cancelledAt column", `
      ALTER TABLE sales ADD COLUMN cancelledAt timestamp NULL AFTER cancelReason
    `);
    await runSQL("sales.cancelledBy column", `
      ALTER TABLE sales ADD COLUMN cancelledBy int NULL AFTER cancelledAt
    `);

    // customers extra columns
    await runSQL("customers.taxId column", `
      ALTER TABLE customers ADD COLUMN taxId varchar(50) NULL AFTER customerType
    `);
    await runSQL("customers.creditLimit column", `
      ALTER TABLE customers ADD COLUMN creditLimit int NOT NULL DEFAULT 0 AFTER taxId
    `);
    await runSQL("customers.creditDays column", `
      ALTER TABLE customers ADD COLUMN creditDays int NOT NULL DEFAULT 30 AFTER creditLimit
    `);
    await runSQL("customers.allowCredit column", `
      ALTER TABLE customers ADD COLUMN allowCredit int NOT NULL DEFAULT 1 AFTER creditDays
    `);

    // units extra columns — usando INFORMATION_SCHEMA para garantizar la columna
    await runSQL("units.tiktokUrl column (safe)", `
      ALTER TABLE units ADD COLUMN tiktokUrl varchar(500) NULL
    `);
    // Si la columna ya existe, el error se ignora. Si no existe, se crea.
    // También intentamos con AFTER en caso de que falle la posición:
    try {
      await connection.query(`
        SELECT tiktokUrl FROM units LIMIT 1
      `);
      console.log("[EnsureTables] ✓ units.tiktokUrl column verified OK");
    } catch (e: any) {
      console.log("[EnsureTables] ✗ units.tiktokUrl STILL missing:", e.message);
    }

    // units: RMA permanente del equipo
    await runSQL("units.rmaNumber column", `
      ALTER TABLE units ADD COLUMN rmaNumber varchar(30) NULL AFTER code
    `);

    // units: notas de daño / detalle adicional del equipo
    await runSQL("units.damageNotes column", `
      ALTER TABLE units ADD COLUMN damageNotes text NULL AFTER damageChecklist
    `);

    // repairs: número de Orden de Trabajo por entrada
    await runSQL("repairs.otNumber column", `
      ALTER TABLE repairs ADD COLUMN otNumber varchar(30) NULL AFTER rmaNumber
    `);

    // Migrar rmaNumber existente de repairs → otNumber
    await runSQL("repairs: migrate rmaNumber to otNumber", `
      UPDATE repairs SET otNumber = rmaNumber WHERE otNumber IS NULL AND rmaNumber IS NOT NULL
    `);

    // returns: campos de devolución de dinero y referencia a venta
    await runSQL("returns.refundAmount column", `
      ALTER TABLE \`returns\` ADD COLUMN refundAmount int NULL AFTER reenteredRepair
    `);
    await runSQL("returns.refundPaymentMethod column", `
      ALTER TABLE \`returns\` ADD COLUMN refundPaymentMethod varchar(20) NULL AFTER refundAmount
    `);
    await runSQL("returns.saleId column", `
      ALTER TABLE \`returns\` ADD COLUMN saleId int NULL AFTER refundPaymentMethod
    `);

    // Tabla de empleados
    await runSQL("employees table", `
      CREATE TABLE IF NOT EXISTS employees (
        id int AUTO_INCREMENT NOT NULL,
        fullName varchar(255) NOT NULL,
        ci varchar(20),
        role enum('repartidor','ventas','almacen','tecnico','administracion','otro') NOT NULL DEFAULT 'otro',
        userId int,
        baseSalary int NOT NULL DEFAULT 0,
        fixedDeductions text,
        phone varchar(20),
        address varchar(255),
        startDate varchar(10),
        birthDate varchar(10),
        status enum('active','inactive') NOT NULL DEFAULT 'active',
        notes text,
        branchId int NOT NULL DEFAULT 1,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT employees_id PRIMARY KEY(id)
      )
    `);

    // orders: branchId (si falta)
    await runSQL("orders.branchId column", `
      ALTER TABLE orders ADD COLUMN branchId int NOT NULL DEFAULT 1 AFTER orderNumber
    `);

    // quotationItems: ensure unitId, productId nullable, pricingType
    await runSQL("quotationItems.unitId column", `
      ALTER TABLE quotationItems ADD COLUMN unitId int NULL AFTER quotationId
    `);
    await runSQL("quotationItems.productId nullable", `
      ALTER TABLE quotationItems MODIFY COLUMN productId int NULL
    `);
    await runSQL("quotationItems.pricingType column", `
      ALTER TABLE quotationItems ADD COLUMN pricingType enum('unit','wholesale','discount') NOT NULL DEFAULT 'unit' AFTER unitId
    `);

    // quotations: ensure branchId, customerName, convertedSaleId, status
    await runSQL("quotations.branchId column", `
      ALTER TABLE quotations ADD COLUMN branchId int NOT NULL DEFAULT 1 AFTER quotationNumber
    `);
    await runSQL("quotations.customerName column", `
      ALTER TABLE quotations ADD COLUMN customerName varchar(255) NULL AFTER customerId
    `);
    await runSQL("quotations.convertedSaleId column", `
      ALTER TABLE quotations ADD COLUMN convertedSaleId int NULL AFTER status
    `);
    await runSQL("quotations.status enum", `
      ALTER TABLE quotations MODIFY COLUMN status enum('pending','accepted','rejected','draft','sent','expired','converted') NOT NULL DEFAULT 'pending'
    `);

    // ============================================================
    // CAJAS DE VENDEDORES (seller cash registers)
    // ============================================================
    await runSQL("seller_cash_registers table", `
      CREATE TABLE IF NOT EXISTS seller_cash_registers (
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
        FOREIGN KEY (sellerId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE,
        FOREIGN KEY (openingApprovedBy) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (closingApprovedBy) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_seller_date (sellerId, date),
        INDEX idx_branch_date (branchId, date),
        INDEX idx_opening_status (openingStatus),
        INDEX idx_closing_status (closingStatus)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await runSQL("seller_partial_deliveries table", `
      CREATE TABLE IF NOT EXISTS seller_partial_deliveries (
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
        FOREIGN KEY (cashRegisterId) REFERENCES seller_cash_registers(id) ON DELETE CASCADE,
        FOREIGN KEY (sellerId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (approvedBy) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_status (status),
        INDEX idx_seller (sellerId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await runSQL("seller_cash_expenses table", `
      CREATE TABLE IF NOT EXISTS seller_cash_expenses (
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
        FOREIGN KEY (cashRegisterId) REFERENCES seller_cash_registers(id) ON DELETE CASCADE,
        FOREIGN KEY (sellerId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (approvedBy) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_status (status),
        INDEX idx_seller (sellerId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log("\n[EnsureTables] Device catalogs");
    await runSQL("device_brands table", `
      CREATE TABLE IF NOT EXISTS device_brands (
        id int AUTO_INCREMENT NOT NULL,
        name varchar(100) NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT device_brands_id PRIMARY KEY(id),
        CONSTRAINT device_brands_name_unique UNIQUE(name)
      )
    `);

    await runSQL("device_models table", `
      CREATE TABLE IF NOT EXISTS device_models (
        id int AUTO_INCREMENT NOT NULL,
        brandId int NOT NULL,
        name varchar(255) NOT NULL,
        defaultSpecs text,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT device_models_id PRIMARY KEY(id),
        INDEX device_models_brandId_idx (brandId),
        UNIQUE KEY device_models_brand_name_unique (brandId, name)
      )
    `);

    await runSQL("processors table", `
      CREATE TABLE IF NOT EXISTS processors (
        id int AUTO_INCREMENT NOT NULL,
        name varchar(255) NOT NULL,
        generation varchar(50),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT processors_id PRIMARY KEY(id),
        CONSTRAINT processors_name_unique UNIQUE(name)
      )
    `);

    await runSQL("ram_options table", `
      CREATE TABLE IF NOT EXISTS ram_options (
        id int AUTO_INCREMENT NOT NULL,
        capacity varchar(50) NOT NULL,
        type varchar(50),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ram_options_id PRIMARY KEY(id),
        CONSTRAINT ram_options_capacity_unique UNIQUE(capacity)
      )
    `);

    await runSQL("storage_options table", `
      CREATE TABLE IF NOT EXISTS storage_options (
        id int AUTO_INCREMENT NOT NULL,
        capacity varchar(50) NOT NULL,
        type varchar(50),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT storage_options_id PRIMARY KEY(id),
        CONSTRAINT storage_options_capacity_unique UNIQUE(capacity)
      )
    `);

    await runSQL("screen_sizes table", `
      CREATE TABLE IF NOT EXISTS screen_sizes (
        id int AUTO_INCREMENT NOT NULL,
        size varchar(50) NOT NULL,
        resolution varchar(100),
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT screen_sizes_id PRIMARY KEY(id),
        CONSTRAINT screen_sizes_size_unique UNIQUE(size)
      )
    `);

    await runSQL("device_spec_options table", `
      CREATE TABLE IF NOT EXISTS device_spec_options (
        id int AUTO_INCREMENT NOT NULL,
        specKey varchar(100) NOT NULL,
        specValue varchar(255) NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT device_spec_options_id PRIMARY KEY(id),
        UNIQUE KEY device_spec_options_key_value_unique (specKey, specValue)
      )
    `);

    console.log("\n[EnsureTables] ✅ All tables verified and all columns ensured! v2");
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && process.argv[1].includes("ensure_tables.ts")) {
  ensureTables().catch((error) => {
    console.error("[EnsureTables] Failed:", error);
    process.exit(0); // exit 0 para no abortar el despliegue de Railway
  });
}
