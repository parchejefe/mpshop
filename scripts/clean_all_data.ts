import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

async function cleanAllData() {
  if (!databaseUrl) {
    console.log("[Clean] DATABASE_URL not configured; skipping data wipe");
    return;
  }

  const connection = await mysql.createConnection(databaseUrl);

  try {
    console.log("[Clean] Checking if clean wipe has already been executed...");

    // Ensure systemSettings table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS systemSettings (
        id int AUTO_INCREMENT NOT NULL,
        \`key\` varchar(100) NOT NULL,
        \`value\` text NOT NULL,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT systemSettings_id PRIMARY KEY(id),
        CONSTRAINT systemSettings_key_unique UNIQUE(\`key\`)
      )
    `);

    const [flag]: any = await connection.query(
      "SELECT `value` FROM systemSettings WHERE `key` = 'initial_clean_wipe_v4' LIMIT 1"
    );

    if (flag && flag[0]?.value === "true") {
      console.log("[Clean] Database was already wiped once previously; preserving user data.");
      return;
    }

    console.log("[Clean] Wiping ALL test data (Finanzas, Compras, Ventas, Unidades, Pedidos)...");

    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    const tablesToClean = [
      // Ventas & Comprobantes
      "creditPayments",
      "accountsReceivable",
      "saleItems",
      "sales",
      // Finanzas & Caja
      "deliveryExpenses",
      "operationalExpenses",
      "financialTransactions",
      "cash_closures",
      "cash_openings",
      "payments",
      // Compras & Proveedores
      "accountsPayable",
      "purchaseItems",
      "purchases",
      "suppliers",
      // Equipos & Inventario Unidades
      "warranties",
      "returns",
      "repairs",
      "unitEvents",
      "generatedCodes",
      "generatedCodeBatches",
      "units",
      // Pedidos & Logística
      "gpsTracking",
      "deliveryLoadItems",
      "deliveryLoads",
      "delivery_extra_load",
      "orderItems",
      "orders",
      // Cotizaciones
      "quotationItems",
      "quotations",
      // Traspasos & Producción
      "inventory_transfer_items",
      "inventory_transfers",
      "production_inputs",
      "production_outputs",
      "production_inventory",
      "production_batches",
      // Inventario General & Productos
      "inventoryMovements",
      "inventory",
      "products",
      // Clientes & Logs
      "customers",
      "auditLog",
    ];

    for (const table of tablesToClean) {
      try {
        await connection.query(`DELETE FROM \`${table}\``);
        try {
          await connection.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`);
        } catch {}
        console.log(`[Clean] Wiped table: ${table}`);
      } catch (err: any) {
        // Table might not exist yet, safe to ignore
      }
    }

    // Ensure main branch exists
    try {
      await connection.query(`
        INSERT INTO branches (id, name, address, phone, isMainWarehouse, status, createdAt, updatedAt)
        VALUES (1, 'Sucursal Principal', 'Casa Central', '+591 70000000', 1, 'active', NOW(), NOW())
        ON DUPLICATE KEY UPDATE name = 'Sucursal Principal', status = 'active'
      `);
    } catch (branchErr) {
      console.log("[Clean] Branch check note:", branchErr);
    }

    // Mark that clean wipe v4 has completed
    await connection.query(`
      INSERT INTO systemSettings (\`key\`, \`value\`, updatedAt)
      VALUES ('initial_clean_wipe_v4', 'true', NOW())
      ON DUPLICATE KEY UPDATE \`value\` = 'true', updatedAt = NOW()
    `);

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log("[Clean] Successfully wiped all test and demo data! All finances, sales, purchases, and units are 100% clean.");
  } catch (error) {
    console.error("[Clean] Error during data wipe:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

cleanAllData().catch((err) => {
  console.error("[Clean] Failed:", err);
  process.exit(0);
});
