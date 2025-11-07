import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import sql from "mssql";
import { getConnection } from "../lib/db";

const router = Router();

// Storage local: ./storage/<CEDULA>_<NOMBRE>.pdf (o como prefieras)
const storageDir = path.resolve(process.cwd(), "storage");
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const upload = multer({ dest: storageDir });

// Helper para hash (opcional, pero prolijo)
function sha256File(fullPath: string) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(fullPath);
  hash.update(data);
  return hash.digest("hex").toUpperCase();
}

// POST /api/upload  (form-data: cedula, periodYear, periodMonth, fortnight?, file=@...)
router.post(
  "/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      const { cedula, periodYear, periodMonth, fortnight } = req.body as {
        cedula?: string;
        periodYear?: string;
        periodMonth?: string;
        fortnight?: string;
      };

      // 1) Validaciones base
      if (!cedula || !/^\d{5,12}$/.test(cedula)) {
        return res.status(400).json({ error: "cedula inválida o ausente" });
      }
      if (!periodYear || isNaN(+periodYear)) {
        return res.status(400).json({ error: "periodYear inválido" });
      }
      if (!periodMonth || isNaN(+periodMonth) || +periodMonth < 1 || +periodMonth > 12) {
        return res.status(400).json({ error: "periodMonth inválido" });
      }

      // 2) Archivo
      if (!req.file) {
        return res.status(400).json({ error: "file ausente" });
      }
      const tmpPath = req.file.path;           // archivo que dejó multer
      const fileSize = req.file.size;
      const orig = req.file.originalname;

      // Nombre final de archivo
      const finalName = orig.replace(/\s+/g, "_");
      const finalPath = path.join(storageDir, finalName);

      // Mover/renombrar al nombre final
      fs.renameSync(tmpPath, finalPath);

      // 3) Hash opcional (puede ser null si no lo querés)
      const fileHashHex = sha256File(finalPath); // o dejá null si no querés

      // 4) DB
      const pool = await getConnection();

      // Buscar UserId por cédula
      const rsUser = await pool
        .request()
        .input("Cedula", sql.NVarChar(16), cedula)
        .query("SELECT TOP 1 Id FROM hr.Users WHERE Cedula = @Cedula AND IsActive = 1 ORDER BY Id");

      if (rsUser.recordset.length === 0) {
        // Si el usuario no existe, revertimos el archivo para no dejar basura
        try { fs.unlinkSync(finalPath); } catch {}
        return res.status(404).json({ error: `No existe usuario activo con cédula ${cedula}` });
      }

      const userId = rsUser.recordset[0].Id as number;

      // Ejecutar SP
      const request = pool.request()
        .input("UserId", sql.Int, userId)
        .input("PeriodYear", sql.Int, +periodYear)
        .input("PeriodMonth", sql.Int, +periodMonth)
        .input("Fortnight", fortnight ? sql.Int : sql.Int, fortnight ? +fortnight : null)
        .input("FileName", sql.NVarChar(260), finalName)
        .input("StoragePath", sql.NVarChar(400), finalPath)
        .input("FileHashHex", sql.NVarChar(64), fileHashHex) // tu tabla lo permite NULL también
        .input("FileSizeBytes", sql.BigInt, fileSize)
        .input("Note", sql.NVarChar(200), "Carga por API")
        .input("ActorUserId", sql.Int, userId) // cuando tengas sesión real, ponelo
        .output("NewId", sql.Int)
        .output("NewVersion", sql.Int);

      const result = await request.execute("hr.sp_PaySlips_Add");

      return res.json({
        success: true,
        filename: finalName,
        path: finalPath,
        db: {
          id: result.output.NewId,
          version: result.output.NewVersion
        }
      });
    } catch (err: any) {
      // LOGGING decente para no volvernos locos
      console.error("UPLOAD ERROR:", err);
      const msg =
        err?.originalError?.info?.message ||
        err?.message ||
        "Unexpected error";
      return res.status(500).json({ error: msg });
    }
  }
);

export default router;
// ====== Batch upload (varios PDFs de una) ======
const memUpload = multer({ storage: multer.memoryStorage() });

// Helpers
function ensureDirSync(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function parseCedulaFromFilename(filename: string): string | null {
  const base = path.basename(filename, path.extname(filename));
  const m = base.match(/^(\d{5,12})_/i);
  return m ? m[1] : null;
}
function norm(p: string) { return p.replace(/\\/g, "\\\\"); }

router.post(
  "/upload/batch",
  memUpload.array("files", 125),
  async (req, res) => {
    try {
      const { periodYear, periodMonth, fortnight } = req.body as {
        periodYear?: string; periodMonth?: string; fortnight?: string;
      };

      // Validación mínima de período
      if (!periodYear || isNaN(+periodYear)) {
        return res.status(400).json({ error: "periodYear inválido" });
      }
      if (!periodMonth || isNaN(+periodMonth) || +periodMonth < 1 || +periodMonth > 12) {
        return res.status(400).json({ error: "periodMonth inválido" });
      }
      const perYear = +periodYear;
      const perMonth = +periodMonth;
      const fortn = fortnight ? +fortnight : null;

      const files = (req.files as Express.Multer.File[]) || [];
      if (!files.length) return res.status(400).json({ error: "Sin archivos" });

      const pool = await getConnection();
      const results: Array<{ filename: string; ok: boolean; msg?: string; dbId?: number; version?: number; path?: string }> = [];

      for (const f of files) {
        const orig = f.originalname;
        // Si no mandan 'cedula' por body, la saco del nombre: CEDULA_APELLIDO_NOMBRE.pdf
        const cedula = (req.body.cedula && /^\d{5,12}$/.test(req.body.cedula))
          ? req.body.cedula
          : parseCedulaFromFilename(orig);

        if (!cedula) {
          results.push({ filename: orig, ok: false, msg: "Nombre inválido. Formato: CEDULA_APELLIDO_NOMBRE.pdf" });
          continue;
        }

        // Busco UserId por cédula (activo)
        const rsUser = await pool.request()
          .input("Cedula", sql.NVarChar(16), cedula)
          .query("SELECT TOP 1 Id FROM hr.Users WHERE Cedula = @Cedula AND IsActive = 1 ORDER BY Id");

        if (rsUser.recordset.length === 0) {
          results.push({ filename: orig, ok: false, msg: `No existe usuario activo con cédula ${cedula}` });
          continue;
        }
        const userId = rsUser.recordset[0].Id as number;

        // Carpeta destino: storage/<CEDULA>/<YYYY>/<MM>/
        const destDir = path.join(storageDir, cedula, String(perYear), String(perMonth).padStart(2, "0"));
        ensureDirSync(destDir);

        const finalName = path.basename(orig).replace(/\s+/g, "_");
        const finalPath = path.join(destDir, finalName);

        try {
          // Escribo el buffer al destino final
          fs.writeFileSync(finalPath, f.buffer);

          // Hash opcional (re-uso tu helper)
          const fileHashHex = sha256File(finalPath);
          const fileSizeBytes = f.size;

          // Ejecutar SP
          const exec = await pool.request()
            .input("UserId", sql.Int, userId)
            .input("PeriodYear", sql.Int, perYear)
            .input("PeriodMonth", sql.Int, perMonth)
            .input("Fortnight", fortn !== null ? sql.Int : sql.Int, fortn) // puede ser null
            .input("FileName", sql.NVarChar(260), finalName)
            .input("StoragePath", sql.NVarChar(400), finalPath)
            .input("FileHashHex", sql.NVarChar(64), fileHashHex)
            .input("FileSizeBytes", sql.BigInt, fileSizeBytes)
            .input("Note", sql.NVarChar(200), "Carga masiva RRHH")
            .input("ActorUserId", sql.Int, userId)     // cuando tengas sesión real, cámbialo
            .output("NewId", sql.Int)
            .output("NewVersion", sql.Int)
            .execute("hr.sp_PaySlips_Add");

          results.push({
            filename: orig,
            ok: true,
            dbId: exec.output.NewId as number | undefined,
            version: exec.output.NewVersion as number | undefined,
            path: norm(finalPath),
          });
        } catch (e: any) {
          // si falló DB, borro el archivo para no dejar basura
          try { fs.unlinkSync(finalPath); } catch {}
          results.push({ filename: orig, ok: false, msg: e?.message || "Error guardando" });
        }
      }

      const ok = results.filter(r => r.ok).length;
      return res.json({ success: results.every(r => r.ok), totals: { ok, failed: results.length - ok }, items: results });
    } catch (err: any) {
      console.error("BATCH ERROR:", err);
      const msg = err?.originalError?.info?.message || err?.message || "Unexpected error";
      return res.status(500).json({ error: msg });
    }
  }
);
