import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { parse } from "csv-parse/sync";
import sql from "mssql";
import { getConnection } from "../lib/db";

const router = Router();

// tmp para CSV
const tmpDir = path.resolve(process.cwd(), "storage", "_tmp");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir });

type Row = {
  Cedula: string;
  FirstName?: string;
  LastName?: string;
  Email?: string;
  IsActive?: string;
};

function toBool(v?: string): boolean | null {
  if (v == null) return null;
  const s = v.toString().trim().toLowerCase();
  if (["si", "sí", "true", "1", "activo", "activa"].includes(s)) return true;
  if (["no", "false", "0", "inactivo", "inactiva"].includes(s)) return false;
  return null;
}

function validateCedula(c: string | undefined) {
  return !!c && /^\d{5,12}$/.test(c);
}

async function analyzeRows(rows: Row[]) {
  const pool = await getConnection();
  const result: {
    total: number;
    willInsert: number;
    willUpdate: number;
    willDeactivate: number;
    invalid: Array<{ row: number; reason: string }>;
    preview: Array<{
      row: number;
      cedula: string;
      action: "INSERT" | "UPDATE" | "DEACTIVATE" | "NONE" | "INVALID";
      why?: string;
    }>;
  } = { total: rows.length, willInsert: 0, willUpdate: 0, willDeactivate: 0, invalid: [], preview: [] };

  // cache de usuarios existentes por cédula
  const cedulas = rows.map(r => r.Cedula).filter(Boolean);
  const existing = new Map<string, any>();
  if (cedulas.length) {
    const rs = await pool.request()
      .input("Cedulas", sql.VarChar(sql.MAX), cedulas.join(","))
      .query(`
        SELECT Id, Cedula, FirstName, LastName, Email, IsActive
        FROM hr.Users
        WHERE Cedula IN (SELECT value FROM STRING_SPLIT(@Cedulas, ','))
      `);
    for (const u of rs.recordset) existing.set(u.Cedula, u);
  }

  rows.forEach((r, idx) => {
    const rowNum = idx + 1;

    if (!validateCedula(r.Cedula)) {
      result.invalid.push({ row: rowNum, reason: "Cédula inválida" });
      result.preview.push({ row: rowNum, cedula: r.Cedula || "", action: "INVALID", why: "Cédula inválida" });
      return;
    }

    const active = toBool(r.IsActive);
    const prev = existing.get(r.Cedula);

    if (!prev && active === false) {
      // no existe y lo marcan inactivo: no tiene sentido hacer nada
      result.preview.push({ row: rowNum, cedula: r.Cedula, action: "NONE", why: "No existe y viene inactivo" });
      return;
    }

    if (!prev && (active === true || active === null)) {
      result.willInsert++;
      result.preview.push({ row: rowNum, cedula: r.Cedula, action: "INSERT" });
      return;
    }

    // existe
    if (active === false && prev.IsActive) {
      result.willDeactivate++;
      result.preview.push({ row: rowNum, cedula: r.Cedula, action: "DEACTIVATE" });
      return;
    }

    // comparar datos básicos para ver si hay update
    const needUpdate =
      (r.FirstName && r.FirstName !== prev.FirstName) ||
      (r.LastName && r.LastName !== prev.LastName) ||
      (r.Email && r.Email !== prev.Email) ||
      (active === true && !prev.IsActive);

    if (needUpdate) {
      result.willUpdate++;
      result.preview.push({ row: rowNum, cedula: r.Cedula, action: "UPDATE" });
    } else {
      result.preview.push({ row: rowNum, cedula: r.Cedula, action: "NONE" });
    }
  });

  return result;
}

async function commitRows(rows: Row[]) {
  const pool = await getConnection();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    for (const r of rows) {
      if (!validateCedula(r.Cedula)) continue;
      const active = toBool(r.IsActive);

      // existe?
      const q = await new sql.Request(tx)
        .input("Cedula", sql.NVarChar(16), r.Cedula)
        .query(`SELECT TOP 1 Id, IsActive FROM hr.Users WHERE Cedula = @Cedula`);

      if (q.recordset.length === 0) {
        // insert si activo != false
        if (active !== false) {
          await new sql.Request(tx)
            .input("Cedula", sql.NVarChar(16), r.Cedula)
            .input("FirstName", sql.NVarChar(80), r.FirstName ?? null)
            .input("LastName", sql.NVarChar(80), r.LastName ?? null)
            .input("Email", sql.NVarChar(120), r.Email ?? null)
            .input("IsActive", sql.Bit, active === false ? 0 : 1)
            .query(`
              INSERT INTO hr.Users(Cedula, FirstName, LastName, Email, IsActive, CreatedAt)
              VALUES(@Cedula, @FirstName, @LastName, @Email, @IsActive, SYSDATETIME())
            `);
        }
        continue;
      }

      const userId = q.recordset[0].Id;

      if (active === false) {
        await new sql.Request(tx)
          .input("Id", sql.Int, userId)
          .query(`UPDATE hr.Users SET IsActive = 0 WHERE Id = @Id`);
        continue;
      }

      await new sql.Request(tx)
        .input("Id", sql.Int, userId)
        .input("FirstName", sql.NVarChar(80), r.FirstName ?? null)
        .input("LastName", sql.NVarChar(80), r.LastName ?? null)
        .input("Email", sql.NVarChar(120), r.Email ?? null)
        .query(`
          UPDATE hr.Users
          SET FirstName = COALESCE(@FirstName, FirstName),
              LastName  = COALESCE(@LastName,  LastName),
              Email     = COALESCE(@Email,     Email),
              IsActive  = 1
          WHERE Id = @Id
        `);
    }

    await tx.commit();
    return { ok: true };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// DRY-RUN
router.post("/import/dry-run", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Archivo CSV ausente (field: file)" });

    const buff = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);

    const rows = parse(buff, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Row[];

    const analysis = await analyzeRows(rows);
    return res.json({ ok: true, mode: "dry-run", ...analysis });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// COMMIT
router.post("/import/commit", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Archivo CSV ausente (field: file)" });

    const buff = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);

    const rows = parse(buff, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Row[];

    const preview = await analyzeRows(rows);
    await commitRows(rows);
    return res.json({ ok: true, applied: preview });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
router.get("/ping", (_req, res) => res.json({ok:true, where:"/api/users"}));
export default router;
