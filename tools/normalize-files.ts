// tools/normalize-files.ts
import path from "path";
import fs from "fs";
import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.resolve(process.cwd(), "storage");

function ensureDirSync(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function exists(p: string) {
  try { return fs.existsSync(p); } catch { return false; }
}

async function main() {
  console.log("Storage root:", STORAGE_ROOT);

  const pool = await sql.connect({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || "127.0.0.1",
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || "1433"),
    options: { encrypt: false, trustServerCertificate: true }
  });

  // Traigo la forma canónica y la actual
  const rs = await pool.request().query(`
    SELECT
      p.Id,
      u.Cedula,
      p.PeriodYear,
      RIGHT('00'+CAST(p.PeriodMonth AS varchar(2)),2) AS MM,
      p.FileName,
      p.RelativePath AS CurrentRel,
      (u.Cedula + '\\\\' + CAST(p.PeriodYear AS varchar(4)) + '\\\\' 
        + RIGHT('00'+CAST(p.PeriodMonth AS varchar(2)),2) + '\\\\' + p.FileName) AS TargetRel
    FROM hr.PaySlips p
    JOIN hr.Users u ON u.Id = p.UserId
    ORDER BY p.Id
  `);

  let moved = 0, already = 0, missing = 0;

  for (const r of rs.recordset) {
    const currentRel = String(r.CurrentRel || "").replace(/\//g, "\\");
    const targetRel  = String(r.TargetRel).replace(/\//g, "\\");
    const targetAbs  = path.join(STORAGE_ROOT, targetRel);

    // Si ya está en canónica, seguimos
    if (exists(targetAbs)) { already++; continue; }

    ensureDirSync(path.dirname(targetAbs));

    // 1) Intento: ruta actual
    if (currentRel && currentRel !== targetRel) {
      const currentAbs = path.join(STORAGE_ROOT, currentRel);
      if (exists(currentAbs)) {
        fs.renameSync(currentAbs, targetAbs);
        console.log(`[MOVE] ${currentRel} -> ${targetRel}`);
        moved++; continue;
      }
    }

    // 2) Intento: archivo suelto en storage raíz
    const looseAbs = path.join(STORAGE_ROOT, r.FileName);
    if (exists(looseAbs)) {
      fs.renameSync(looseAbs, targetAbs);
      console.log(`[MOVE] (loose) ${r.FileName} -> ${targetRel}`);
      moved++; continue;
    }

    // 3) Intento: viejo patrón con "\2\" metido
    const legacy = path.join(STORAGE_ROOT, r.Cedula, String(r.PeriodYear), String(r.MM), "2", r.FileName);
    if (exists(legacy)) {
      fs.renameSync(legacy, targetAbs);
      console.log(`[MOVE] (legacy /2/) -> ${targetRel}`);
      moved++; continue;
    }

    // Si no encontré nada, lo marco como faltante
    console.warn(`[MISS] Id=${r.Id} expected=${targetRel} current=${currentRel}`);
    missing++;
  }

  console.log(`\nResumen => moved=${moved}, already=${already}, missing=${missing}`);
  await pool.close();
}

main().catch(err => {
  console.error("ERROR:", err);
  process.exit(1);
});
