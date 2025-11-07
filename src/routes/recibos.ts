import { Router } from "express";
import sql from "mssql";
import path from "path";
import fs from "fs";
import { getConnection } from "../lib/db";

const router = Router();

/* ======================================================
   ✅ GET /api/recibos?cedula=12345678
   Lista todos los recibos de un usuario por cédula
====================================================== */
router.get("/recibos", async (req, res) => {
  try {
    const cedula = req.query.cedula as string;

    if (!cedula) {
      return res.status(400).json({ error: "Debe enviar ?cedula=" });
    }

    const pool = await getConnection();

    const rs = await pool.request()
      .input("Cedula", sql.NVarChar(16), cedula)
      .query(`
        SELECT 
          p.Id,
          p.UserId,
          p.PeriodYear,
          p.PeriodMonth,
          p.Fortnight,
          p.FileName,
          p.StoragePath,
          p.RelativePath,
          p.FileSizeBytes,
          p.Version,
          p.Note,
          p.UploadedAt
        FROM hr.PaySlips p
        JOIN hr.Users u ON u.Id = p.UserId
        WHERE u.Cedula = @Cedula
        ORDER BY p.PeriodYear DESC, p.PeriodMonth DESC, p.Version DESC
      `);

    return res.json({ items: rs.recordset });
  } catch (err: any) {
    console.error("RECIBOS ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});


/* ======================================================
   ✅ GET /api/recibos/:id/pdf
   Descarga un PDF directamente
====================================================== */
router.get("/recibos/:id/pdf", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const pool = await getConnection();

    const rs = await pool.request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT TOP 1 
          FileName,
          StoragePath
        FROM hr.PaySlips
        WHERE Id = @Id
      `);

    if (rs.recordset.length === 0) {
      return res.status(404).json({ error: "No existe recibo con ese ID" });
    }

    const info = rs.recordset[0];
    const fullPath = info.StoragePath;

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: "El archivo no existe en disco",
        path: fullPath
      });
    }

    // descarga:
    return res.download(fullPath, info.FileName);
  } catch (err: any) {
    console.error("DOWNLOAD ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/recibos/by-cedula?cedula=12345678
router.get("/recibos/by-cedula", async (req, res) => {
  try {
    const cedula = String(req.query.cedula || "").trim();
    if (!/^\d{5,12}$/.test(cedula)) {
      return res.status(400).json({ ok: false, error: "Cédula inválida" });
    }

    const pool = await getConnection();
    const rs = await pool.request()
      .input("Cedula", sql.NVarChar(16), cedula)
      .query(`
        SELECT 
          p.Id,
          u.Cedula,
          p.PeriodYear,
          p.PeriodMonth,
          p.Fortnight,
          p.FileName,
          p.FileSizeBytes,
          p.Version,
          p.UploadedAt
        FROM hr.Users u
        JOIN hr.PaySlips p ON p.UserId = u.Id
        WHERE u.Cedula = @Cedula
        ORDER BY 
          p.PeriodYear DESC,
          p.PeriodMonth DESC,
          ISNULL(p.Fortnight, 0) DESC,
          p.Version DESC,
          p.Id DESC
      `);

    const items = rs.recordset.map((r: any) => ({
      id: r.Id,
      cedula: r.Cedula,
      period: `${r.PeriodYear}-${String(r.PeriodMonth).padStart(2,"0")}${r.Fortnight ? ` Q${r.Fortnight}` : ""}`,
      year: r.PeriodYear,
      month: r.PeriodMonth,
      fortnight: r.Fortnight,
      fileName: r.FileName,
      sizeBytes: Number(r.FileSizeBytes),
      version: r.Version,
      uploadedAt: r.UploadedAt,
      downloadUrl: `/api/recibos/${r.Id}/pdf`
    }));

    return res.json({ ok: true, cedula, count: items.length, items });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});


export default router;
