import * as schema from "../drizzle/schema";
import { getTableColumns, isTable, getTableName } from "drizzle-orm";

interface ColDef {
  name: string;
  sqlType: string;
  isPrimary?: boolean;
}

interface TableDef {
  tableName: string;
  columns: ColDef[];
}

export function getAllSchemaDefinitions(): TableDef[] {
  const result: TableDef[] = [];

  for (const [key, val] of Object.entries(schema)) {
    if (isTable(val)) {
      const tableName = getTableName(val);
      const colsObj = getTableColumns(val);
      const colList: ColDef[] = [];

      for (const [colName, colVal] of Object.entries(colsObj) as [string, any][]) {
        let sqlType = "TEXT NULL";
        const ct = colVal.columnType;
        const isPrimary = colVal.primary;

        if (ct === "MySqlInt") {
          if (isPrimary) {
            sqlType = "INT AUTO_INCREMENT PRIMARY KEY";
          } else if (colVal.hasDefault) {
            sqlType = `INT NOT NULL DEFAULT ${colVal.default ?? 0}`;
          } else if (colVal.notNull) {
            sqlType = "INT NOT NULL DEFAULT 0";
          } else {
            sqlType = "INT NULL";
          }
        } else if (ct === "MySqlVarChar") {
          const len = colVal.length || 255;
          if (colVal.hasDefault) {
            sqlType = `VARCHAR(${len}) NOT NULL DEFAULT '${colVal.default}'`;
          } else if (colVal.notNull) {
            sqlType = `VARCHAR(${len}) NOT NULL DEFAULT ''`;
          } else {
            sqlType = `VARCHAR(${len}) NULL`;
          }
        } else if (ct === "MySqlText") {
          sqlType = colVal.notNull ? "TEXT NOT NULL" : "TEXT NULL";
        } else if (ct === "MySqlTimestamp") {
          sqlType = "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP";
        } else if (ct === "MySqlEnumColumn") {
          const enumValues = colVal.enumValues ? colVal.enumValues.map((v: string) => `'${v}'`).join(",") : "'default'";
          const def = colVal.default ? `DEFAULT '${colVal.default}'` : "";
          sqlType = `ENUM(${enumValues}) ${colVal.notNull ? "NOT NULL" : "NULL"} ${def}`.trim();
        } else if (ct === "MySqlDouble" || ct === "MySqlFloat" || ct === "MySqlDecimal") {
          sqlType = "DOUBLE NULL DEFAULT 0";
        } else if (ct === "MySqlBoolean") {
          sqlType = "TINYINT(1) NOT NULL DEFAULT 0";
        } else if (ct === "MySqlJson") {
          sqlType = "JSON NULL";
        }

        colList.push({ name: colVal.name, sqlType, isPrimary });
      }
      result.push({ tableName, columns: colList });
    }
  }

  return result;
}

export async function syncDatabaseSchema(poolOrConn: any): Promise<{
  tablesCreated: string[];
  columnsAdded: string[];
  errors: string[];
}> {
  const tablesCreated: string[] = [];
  const columnsAdded: string[] = [];
  const errors: string[] = [];

  console.log("[SchemaSync] Starting comprehensive schema synchronization...");

  try {
    // 1. Obtener todas las tablas existentes
    const [tableRows]: any = await poolOrConn.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    );
    const existingTables = new Set<string>(tableRows.map((r: any) => r.TABLE_NAME));

    // 2. Obtener todas las columnas existentes
    const [colRows]: any = await poolOrConn.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
    );
    const existingColumns = new Set<string>(
      colRows.map((r: any) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`.toLowerCase())
    );

    const definitions = getAllSchemaDefinitions();

    for (const tDef of definitions) {
      const tbl = tDef.tableName;

      // Si la tabla no existe, crearla
      if (!existingTables.has(tbl)) {
        try {
          const colDefsSql = tDef.columns.map(c => `\`${c.name}\` ${c.sqlType}`).join(",\n  ");
          const createSql = `CREATE TABLE IF NOT EXISTS \`${tbl}\` (\n  ${colDefsSql}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
          await poolOrConn.query(createSql);
          tablesCreated.push(tbl);
          console.log(`[SchemaSync] ✓ Created table: ${tbl}`);
          // Añadir columnas al set
          for (const c of tDef.columns) {
            existingColumns.add(`${tbl}.${c.name}`.toLowerCase());
          }
          existingTables.add(tbl);
          continue;
        } catch (err: any) {
          console.error(`[SchemaSync] ✗ Failed to create table ${tbl}:`, err.message);
          errors.push(`Create table ${tbl}: ${err.message}`);
        }
      }

      // Si la tabla existe, revisar cada columna
      for (const col of tDef.columns) {
        const key = `${tbl}.${col.name}`.toLowerCase();
        if (!existingColumns.has(key)) {
          try {
            // Evitar 'AUTO_INCREMENT PRIMARY KEY' en ALTER TABLE ADD COLUMN
            let alterType = col.sqlType;
            if (alterType.includes("AUTO_INCREMENT PRIMARY KEY")) {
              alterType = "INT NOT NULL";
            }
            await poolOrConn.query(`ALTER TABLE \`${tbl}\` ADD COLUMN \`${col.name}\` ${alterType}`);
            columnsAdded.push(`${tbl}.${col.name}`);
            existingColumns.add(key);
            console.log(`[SchemaSync] ✓ Added column: ${tbl}.${col.name} (${alterType})`);
          } catch (err: any) {
            // Ignorar si ya existe
            if (!err.message?.includes("Duplicate column name")) {
              console.error(`[SchemaSync] ✗ Failed to add column ${tbl}.${col.name}:`, err.message);
              errors.push(`Add column ${tbl}.${col.name}: ${err.message}`);
            }
          }
        }
      }
    }

    // Asegurar registros base esenciales
    try {
      // 1. Sucursal Principal
      await poolOrConn.query(`
        INSERT INTO branches (id, name, address, phone, isMainWarehouse, status, createdAt, updatedAt)
        SELECT 1, 'Sucursal Principal', 'Casa Central', '+591 70000000', 1, 'active', NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM branches WHERE id = 1)
      `);

      // 2. Proveedor Genérico (Compra Directa)
      await poolOrConn.query(`
        INSERT INTO suppliers (name, contactName, phone, taxId, address, creditDays, creditLimit, createdAt, updatedAt)
        SELECT 'Proveedor Genérico (Compra Directa)', 'Genérico', '', '', '', 30, 0, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'Proveedor Genérico (Compra Directa)')
      `);

      // 3. Sincronizar fondos de apertura de cajas de vendedores abiertas sin egreso registrado
      await poolOrConn.query(`
        INSERT INTO financialTransactions (branchId, type, category, amount, paymentMethod, userId, referenceId, notes, createdAt)
        SELECT 
          scr.branchId,
          'expense',
          'caja_vendedor_fondo',
          scr.initialCash,
          'cash',
          COALESCE(scr.openingApprovedBy, scr.sellerId),
          scr.id,
          CONCAT('Salida Caja Principal: Entrega de fondo de cambio para vendedor #', scr.sellerId, ' (Turno #', scr.turnNumber, ')'),
          COALESCE(scr.openedAt, scr.createdAt)
        FROM seller_cash_registers scr
        WHERE scr.openingStatus = 'approved' 
          AND scr.closingStatus = 'open'
          AND scr.initialCash > 0
          AND NOT EXISTS (
            SELECT 1 FROM financialTransactions ft 
            WHERE ft.category = 'caja_vendedor_fondo' 
              AND ft.referenceId = scr.id
          )
      `);

      console.log("[SchemaSync] ✓ Base seeds ensured (Branch 1, Proveedor Genérico, Fondos de Caja Vendedor)");
    } catch (seedErr: any) {
      console.warn("[SchemaSync] Note on base seeds:", seedErr.message);
    }

    console.log(`[SchemaSync] ✅ Finished. Created ${tablesCreated.length} tables, added ${columnsAdded.length} columns.`);
  } catch (syncErr: any) {
    console.error("[SchemaSync] Fatal error in syncDatabaseSchema:", syncErr);
    errors.push(`Sync fatal: ${syncErr.message}`);
  }

  return { tablesCreated, columnsAdded, errors };
}
