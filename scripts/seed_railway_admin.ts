import bcrypt from "bcrypt";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME || "Administrador";
const email = process.env.ADMIN_EMAIL || "admin@mpshop.com";

async function seedRailwayAdmin() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed the admin user");
  }
  if (!username || !password) {
    console.log("[Seed] ADMIN_USERNAME or ADMIN_PASSWORD not configured; skipping admin seed");
    return;
  }

  const connection = await mysql.createConnection(databaseUrl);

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const openId = `local_${username}`;

    await connection.query(
      `INSERT INTO users
        (openId, username, passwordHash, name, email, loginMethod, role, createdAt, updatedAt, lastSignedIn)
       VALUES (?, ?, ?, ?, ?, 'traditional', 'admin', NOW(), NOW(), NOW())
       ON DUPLICATE KEY UPDATE
        passwordHash = VALUES(passwordHash),
        name = VALUES(name),
        email = VALUES(email),
        loginMethod = VALUES(loginMethod),
        role = VALUES(role),
        updatedAt = NOW()`,
      [openId, username, passwordHash, name, email],
    );

    console.log(`[Seed] Admin user ready: ${username}`);
  } finally {
    await connection.end();
  }
}

seedRailwayAdmin().catch((error) => {
  console.error("[Seed] Failed to create admin user:", error);
  process.exit(0);
});
