/**
 * Script: Eliminar restricción UNIQUE del campo code en tabla units
 * 
 * Permite que productos fungibles compartan el mismo código QR
 */

import { getDb } from "../server/db";
import mysql from "mysql2/promise";

async function removeCodeUniqueConstraint() {
  const db = await getDb();
  
  if (!db) {
    console.log("⚠️  [Remove UNIQUE] No hay conexión a base de datos - Saltando");
    process.exit(0);
  }

  console.log("🔧 [Remove UNIQUE] Verificando restricción UNIQUE en campo 'code'...\n");

  try {
    // Obtener información de la tabla
    const [indexes]: any = await (db as any).execute(`
      SHOW INDEXES FROM units WHERE Column_name = 'code'
    `);

    if (!indexes || indexes.length === 0) {
      console.log("✅ [Remove UNIQUE] El campo 'code' no tiene restricción UNIQUE\n");
      process.exit(0);
    }

    // Buscar si hay un índice UNIQUE en 'code'
    const uniqueIndex = indexes.find((idx: any) => 
      idx.Non_unique === 0 && idx.Column_name === 'code'
    );

    if (!uniqueIndex) {
      console.log("✅ [Remove UNIQUE] El campo 'code' no tiene restricción UNIQUE\n");
      process.exit(0);
    }

    const indexName = uniqueIndex.Key_name;
    console.log(`📌 [Remove UNIQUE] Encontrado índice UNIQUE: '${indexName}'`);
    console.log(`   Eliminando restricción...\n`);

    // Eliminar el índice UNIQUE
    await (db as any).execute(`
      ALTER TABLE units DROP INDEX \`${indexName}\`
    `);

    console.log(`✅ [Remove UNIQUE] Restricción eliminada exitosamente`);
    console.log(`   Ahora múltiples unidades pueden compartir el mismo código\n`);

    // Crear un índice normal (no único) para mantener rendimiento en búsquedas
    console.log(`📌 [Remove UNIQUE] Creando índice normal para optimizar búsquedas...`);
    
    try {
      await (db as any).execute(`
        CREATE INDEX idx_units_code ON units(code)
      `);
      console.log(`✅ [Remove UNIQUE] Índice normal creado\n`);
    } catch (err: any) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log(`   (Índice ya existe)\n`);
      } else {
        console.log(`⚠️  [Remove UNIQUE] No se pudo crear índice normal (no crítico):`, err.message, "\n");
      }
    }

    console.log("=".repeat(70));
    console.log("✨ [Remove UNIQUE] Completado - Tabla units lista para códigos compartidos");
    console.log("=".repeat(70) + "\n");

  } catch (error: any) {
    console.error("❌ [Remove UNIQUE] Error:", error.message || error);
    throw error;
  }

  process.exit(0);
}

// Ejecutar
removeCodeUniqueConstraint().catch((error) => {
  console.error("❌ [Remove UNIQUE] Falló:", error);
  process.exit(0);
});
