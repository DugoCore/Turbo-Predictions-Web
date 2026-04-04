import fs from "fs";
import path from "path";

const MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function extFromMime(mime) {
  return MIME_EXT[mime] || ".img";
}

export function getQrDir(rootDir) {
  return path.join(rootDir, "public", "uploads", "qr");
}

export function listPaymentQrUrls(rootDir) {
  const dir = getQrDir(rootDir);
  const out = { yape: null, plin: null };
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const low = name.toLowerCase();
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const st = fs.statSync(full);
    const v = Math.floor(st.mtimeMs);
    if (low.startsWith("yape.")) {
      out.yape = `/uploads/qr/${encodeURIComponent(name)}?v=${v}`;
    }
    if (low.startsWith("plin.")) {
      out.plin = `/uploads/qr/${encodeURIComponent(name)}?v=${v}`;
    }
  }
  return out;
}

export function removeExistingQrForMethod(rootDir, metodo) {
  const dir = getQrDir(rootDir);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.toLowerCase().startsWith(`${metodo}.`)) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}
