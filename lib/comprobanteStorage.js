import crypto from "crypto";
import fs from "fs";
import path from "path";
import { extFromMime } from "./paymentQr.js";

function extComprobante(mimetype, originalname) {
  if (mimetype === "application/pdf") return ".pdf";
  if (mimetype === "image/heic" || mimetype === "image/heif") return ".heic";
  const e = extFromMime(mimetype);
  if (e !== ".img") return e;
  const fromName = (path.extname(originalname || "") || "").toLowerCase();
  if (/^\.(jpe?g|png|gif|webp|pdf)$/.test(fromName)) {
    return fromName;
  }
  if (String(mimetype || "").startsWith("image/")) {
    return ".jpg";
  }
  return ".jpg";
}

/**
 * En Vercel el FS del despliegue es solo lectura: los comprobantes se suben a Vercel Blob.
 * En local se guardan bajo public/uploads/comprobantes.
 *
 * @param {{ buffer: Buffer, mimetype: string, originalname: string }} file — multer file
 * @param {{ rootDir: string, isVercel: boolean }} ctx
 * @returns {Promise<string>} ruta relativa (/uploads/...) o URL absoluta (Blob)
 */
export async function saveComprobanteFile(file, { rootDir, isVercel }) {
  const name = `${crypto.randomUUID()}${extComprobante(file.mimetype, file.originalname)}`;
  if (isVercel) {
    const token = (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
    if (!token) {
      const err = new Error(
        "En Vercel hace falta BLOB_READ_WRITE_TOKEN (Vercel Blob) para guardar el comprobante, o registra el pago sin adjuntar archivo."
      );
      err.code = "BLOB_TOKEN_REQUIRED";
      throw err;
    }
    const { put } = await import("@vercel/blob");
    const blob = await put(`comprobantes/${name}`, file.buffer, {
      access: "public",
      token,
    });
    return blob.url;
  }
  const dir = path.join(rootDir, "public", "uploads", "comprobantes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return `/uploads/comprobantes/${name}`;
}

/**
 * @param {string | null | undefined} comprobantePath — ruta local o URL de Blob
 * @param {{ rootDir: string }} ctx
 */
export async function removeComprobanteFile(comprobantePath, { rootDir }) {
  const p = String(comprobantePath || "");
  if (!p) return;
  if (/^https?:\/\//i.test(p)) {
    const token = (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
    if (!token) return;
    try {
      const { del } = await import("@vercel/blob");
      await del(p, { token });
    } catch (err) {
      console.error("Al borrar comprobante en Blob:", err);
    }
    return;
  }
  try {
    const rel = p.replace(/^\//, "");
    const abs = path.join(rootDir, "public", rel);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  } catch (err) {
    console.error("Al borrar archivo de comprobante:", err);
  }
}
