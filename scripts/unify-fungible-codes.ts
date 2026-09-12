/**
 * Script de migración: Unificar códigos de productos fungibles
 * 
 * Este script actualiza todas las unidades fungibles (charger, accessory, battery, etc.)
 * que tienen el mismo brand+model para que compartan el MISMO código QR.
 * 
 * Ejemplo:
 * ANTES: 101010-01, 101010-02, 101010-03, 101010-04, 101010-05
 * DESPUÉS: 101010, 101010, 101010, 101010, 101010
 * 
 * IDEMPOTENTE: Se puede ejecutar múltiples veces sin problemas.
 */

import { getDb } from "../server/db";
import { units } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

const FUNGIBLE_TYPES = ['charger', 'accessory', 'battery', 'cable', 'case', 'other'];

async function unifyFungibleCodes() {
  const db = await getDb();
  
  if (!db) {
    console.log("⚠️  No hay conexión a base de datos (modo demo) - Saltando migración de códigos");
    process.exit(0);
  }

  console.log("🔍 [Migración Códigos] Buscando unidades fungibles con códigos individuales...\n");

  // Obtener todas las unidades fungibles
  const fungibleUnits = await db
    .select()
    .from(units)
    .where(sql`${units.type} IN (${sql.join(FUNGIBLE_TYPES.map(t => sql`${t}`), sql`, `)})`);

  if (fungibleUnits.length === 0) {
    console.log("✅ [Migración Códigos] No hay unidades fungibles en la base de datos\n");
    process.exit(0);
  }

  console.log(`📦 [Migración Códigos] Total de unidades fungibles: ${fungibleUnits.length}\n`);

  // Agrupar por brand + model
  const groupedByModel = new Map<string, typeof fungibleUnits>();
  
  for (const unit of fungibleUnits) {
    const key = `${unit.brand}|${unit.model}|${unit.type}`;
    if (!groupedByModel.has(key)) {
      groupedByModel.set(key, []);
    }
    groupedByModel.get(key)!.push(unit);
  }

  console.log(`🔢 [Migración Códigos] Modelos únicos: ${groupedByModel.size}\n`);

  let totalUpdated = 0;
  let groupsProcessed = 0;
  let groupsSkipped = 0;

  // Procesar cada grupo
  for (const [key, unitsInGroup] of groupedByModel.entries()) {
    const [brand, model, type] = key.split("|");
    
    // Si solo hay 1 unidad, no necesita unificación
    if (unitsInGroup.length <= 1) {
      groupsSkipped++;
      continue;
    }

    // Obtener el código base (sin sufijo -01, -02, etc.)
    const firstCode = unitsInGroup[0].code || "";
    const baseCode = firstCode.split("-")[0];

    // Verificar si realmente tienen sufijos numéricos
    const hasSuffixes = unitsInGroup.some(u => {
      const code = u.code || "";
      const parts = code.split("-");
      // Tiene sufijo si: tiene guión Y la última parte es solo números
      return parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]);
    });

    if (!hasSuffixes) {
      // Ya están unificados o no tienen sufijos numéricos
      groupsSkipped++;
      continue;
    }

    groupsProcessed++;
    console.log(`\n📌 [Migración] ${brand} ${model} (${type})`);
    console.log(`   Unidades: ${unitsInGroup.length}`);
    console.log(`   Código actual: ${unitsInGroup.map(u => u.code).join(", ")}`);
    console.log(`   → Unificando a: ${baseCode}`);

    // Actualizar todas las unidades del grupo al código base
    for (const unit of unitsInGroup) {
      if (unit.code !== baseCode) {
        await db
          .update(units)
          .set({ code: baseCode, updatedAt: new Date() })
          .where(eq(units.id, unit.id));
        
        totalUpdated++;
      }
    }

    console.log(`   ✅ Actualizado`);
  }

  console.log("\n" + "=".repeat(70));
  console.log(`✨ [Migración Códigos] Completada`);
  console.log(`   • Grupos procesados: ${groupsProcessed}`);
  console.log(`   • Grupos sin cambios: ${groupsSkipped}`);
  console.log(`   • Unidades actualizadas: ${totalUpdated}`);
  console.log("=".repeat(70) + "\n");

  process.exit(0);
}

// Ejecutar
unifyFungibleCodes().catch((error) => {
  console.error("❌ [Migración Códigos] Error:", error);
  process.exit(0);
});
