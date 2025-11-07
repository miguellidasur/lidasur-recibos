// src/lib/files.ts
import fs from "fs";
import path from "path";

export function ensureDirSync(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function sanitizeWinPath(p: string) {
  // elimina caracteres que Windows odia en nombres de archivo
  return p.replace(/[<>:"|?*]/g, "_");
}

export function onlyDigits(s: string) {
  return (s || "").replace(/\D+/g, "");
}

export function buildStorageDir(root: string, cedula: string, year: number, month: number, fortnight?: number | null) {
  const y = String(year);
  const m = String(month).padStart(2, "0");
  const q = fortnight ? `Q${fortnight}` : "M";
  return path.join(root, cedula, y, m, q);
}
