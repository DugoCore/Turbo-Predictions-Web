import express from "express";
import cookieSession from "cookie-session";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import {
  extFromMime,
  getQrDir,
  listPaymentQrUrls,
  removeExistingQrForMethod,
} from "./lib/paymentQr.js";
import {
  initDb,
  insertPayment,
  listPayments,
  updatePaymentMp,
  deletePaymentById,
  getPaymentById,
  getPaymentByRegistroToken,
  setPaymentVerificado,
} from "./lib/db.js";
import {
  createCheckoutPreference,
  fetchPayment,
  mapMercadoPagoPaymentStatus,
  isMercadoPagoConfigured,
} from "./lib/mercadopago.js";
import { fetchVoucherForCreditPackage } from "./lib/voucherService.js";
import { removeComprobanteFile, saveComprobanteFile } from "./lib/comprobanteStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "cambiar-en-produccion";
const isVercel = process.env.VERCEL === "1";
const isProd = isVercel || process.env.NODE_ENV === "production";

const rootDir = isVercel ? process.cwd() : __dirname;

/** Monto usado en registros y checkout cuando el formulario público no envía monto. */
function defaultPaymentMonto() {
  const n = Number(process.env.DEFAULT_PAYMENT_MONTO);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Paquetes: créditos → soles (PEN). */
const CREDITOS_A_MONTO = Object.freeze({
  50: 30,
  80: 50,
  100: 60,
});

function montoDesdeCreditos(creditosRaw) {
  const c = Number(creditosRaw);
  if (!Number.isFinite(c)) return null;
  const m = CREDITOS_A_MONTO[c];
  return m != null ? m : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(s) {
  return typeof s === "string" && UUID_RE.test(s.trim());
}

/** Código tipo V0D8-OL5Z-WL6W-P82A (segmentos alfanuméricos separados por guiones). */
function isVoucherCodeLike(s) {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length >= 8 && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(t);
}

function isRegistroTokenLike(s) {
  return isUuidLike(s) || isVoucherCodeLike(s);
}

function voucherErrorMessage(err) {
  const c = err?.code;
  if (c === "AbortError" || err?.name === "AbortError") {
    return "El servicio de vouchers no respondió a tiempo. Comprueba que esté en ejecución en el puerto 8000.";
  }
  const net = err?.cause?.code || c;
  if (net === "ECONNREFUSED" || net === "ENOTFOUND") {
    return "No hay conexión con el servicio de vouchers (http://localhost:8000/). Inícialo e inténtalo de nuevo.";
  }
  switch (c) {
    case "VOUCHER_ADMIN_TOKEN_REQUIRED":
      return "Falta VOUCHER_ADMIN_TOKEN en .env (cabecera X-Admin-Token del API Futbol Bot).";
    case "VOUCHER_HTTP":
      if (err.status === 401 || err.status === 403) {
        return "El API de vouchers rechazó la petición (401/403). Revisa que VOUCHER_ADMIN_TOKEN en .env coincida con X-Admin-Token del servicio en :8000.";
      }
      return "No se pudo obtener el voucher (error HTTP). Revisa el servicio en http://localhost:8000/";
    case "VOUCHER_INVALID_JSON":
    case "VOUCHER_INVALID_BODY":
      return "Respuesta inválida del servicio de vouchers.";
    case "VOUCHER_NOT_SUCCESS":
      return "El servicio de vouchers no devolvió status success.";
    case "VOUCHER_MISSING_CODE":
      return "El servicio de vouchers no incluyó voucher_code.";
    case "VOUCHER_CREDITS_MISMATCH":
      return "Los créditos del voucher no coinciden con el paquete elegido.";
    case "VOUCHER_INVALID_EXPECTED_CREDITS":
      return "Créditos del pago no válidos para generar el voucher.";
    default:
      return "No se pudo obtener el código de voucher. Comprueba que el servicio en http://localhost:8000/ esté disponible.";
  }
}

const app = express();
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: "tp_session",
    keys: [SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
  })
);

app.use((req, res, next) => {
  const p = req.path || "";
  const m = req.method;
  const paymentsAuth =
    (m === "GET" && p === "/api/payments") ||
    (m === "PATCH" && /^\/api\/payments\/[^/]+\/verificado$/.test(p)) ||
    (m === "DELETE" && /^\/api\/payments\/[^/]+$/.test(p));
  if (p.startsWith("/api/admin") || paymentsAuth) {
    res.set("Cache-Control", "private, no-store, must-revalidate");
    res.set("Vary", "Cookie");
  }
  next();
});

app.use(express.static(path.join(rootDir, "public")));

const uploadQr = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|pjpeg|png|gif|webp)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error("INVALID_IMAGE_TYPE"));
  },
});

const uploadComprobante = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^image\/(jpeg|pjpeg|png|gif|webp|heic|heif)$/.test(file.mimetype) ||
      file.mimetype === "application/pdf" ||
      /^image\//.test(file.mimetype);
    if (ok) return cb(null, true);
    cb(new Error("INVALID_COMPROBANTE_TYPE"));
  },
});

function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  return res.status(401).json({ error: "No autorizado" });
}

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    req.session = { admin: true };
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Contraseña incorrecta" });
});

app.post("/api/admin/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  res.json({ admin: Boolean(req.session?.admin) });
});

app.get("/api/payment-qr", (_req, res) => {
  try {
    res.json({
      ...listPaymentQrUrls(rootDir),
      defaultMonto: defaultPaymentMonto(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron leer los códigos QR" });
  }
});

app.post("/api/admin/upload-qr", requireAdmin, uploadQr.single("file"), (req, res, next) => {
  try {
    const metodo = String(req.body?.metodo || "").toLowerCase();
    if (metodo !== "yape" && metodo !== "plin") {
      return res.status(400).json({ error: "Método debe ser yape o plin" });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: "Selecciona un archivo de imagen" });
    }
    const dir = getQrDir(rootDir);
    fs.mkdirSync(dir, { recursive: true });
    removeExistingQrForMethod(rootDir, metodo);
    const ext = extFromMime(req.file.mimetype);
    const filename = `${metodo}${ext}`;
    fs.writeFileSync(path.join(dir, filename), req.file.buffer);
    const st = fs.statSync(path.join(dir, filename));
    res.json({
      ok: true,
      url: `/uploads/qr/${filename}?v=${Math.floor(st.mtimeMs)}`,
    });
  } catch (err) {
    next(err);
  }
});

function parseMercadoPagoPaymentNotificationId(req) {
  const q = req.query || {};
  if (q.topic === "payment" && q.id) return String(q.id);
  const b = req.body;
  if (b && typeof b === "object") {
    if (b.type === "payment" && b.data?.id != null) return String(b.data.id);
    if (b.topic === "payment" && b.id != null) return String(b.id);
    if (typeof b.action === "string" && b.action.includes("payment") && b.data?.id != null) {
      return String(b.data.id);
    }
  }
  return null;
}

async function handleMercadoPagoWebhook(req, res) {
  try {
    const paymentApiId = parseMercadoPagoPaymentNotificationId(req);
    if (!paymentApiId) {
      return res.status(400).send("Bad Request");
    }
    if (!isMercadoPagoConfigured()) {
      return res.status(200).send("OK");
    }
    const mp = await fetchPayment(paymentApiId);
    const extRef = mp.external_reference;
    if (extRef == null || extRef === "") {
      return res.status(200).send("OK");
    }
    const localId = parseInt(String(extRef), 10);
    if (!Number.isFinite(localId)) {
      return res.status(200).send("OK");
    }
    const row = await getPaymentById(localId);
    if (!row || row.metodo !== "mercadopago") {
      return res.status(200).send("OK");
    }
    const mpStatus = mapMercadoPagoPaymentStatus(mp.status);
    await updatePaymentMp(localId, {
      mp_payment_id: String(mp.id),
      mp_status: mpStatus,
      referencia: String(mp.id),
    });
    return res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Mercado Pago:", err);
    return res.status(500).send("Error");
  }
}

app.get("/api/webhooks/mercadopago", handleMercadoPagoWebhook);
app.post("/api/webhooks/mercadopago", handleMercadoPagoWebhook);

app.post("/api/payments/mercadopago/checkout", async (req, res, next) => {
  try {
    if (!isMercadoPagoConfigured()) {
      return res.status(503).json({
        error:
          "Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN y PUBLIC_URL en .env",
      });
    }
    await initDb();
    const { nombre, email, telefono, creditos } = req.body || {};
    const n = String(nombre || "").trim();
    const e = String(email || "").trim();
    const t = String(telefono || "").trim();
    const amount = montoDesdeCreditos(creditos);
    if (amount == null) {
      return res.status(400).json({
        error: "Elige un paquete de créditos válido (50, 80 o 100).",
      });
    }

    if (!n || !e || !t) {
      return res.status(400).json({ error: "Nombre, email y teléfono son obligatorios" });
    }

    const c = Number(creditos);
    const row = await insertPayment({
      nombre: n,
      email: e,
      telefono: t,
      metodo: "mercadopago",
      monto: amount,
      creditos: c,
      referencia: null,
      notas: null,
      mp_status: "pending",
    });

    try {
      const { preference_id, init_point } = await createCheckoutPreference({
        paymentId: row.id,
        nombre: n,
        email: e,
        monto: amount,
        notas: "",
        registro_token: row.registro_token,
      });
      await updatePaymentMp(row.id, { mp_preference_id: String(preference_id) });
      return res.json({
        init_point,
        preference_id,
        payment_id: row.id,
        registro_token: row.registro_token,
      });
    } catch (inner) {
      await deletePaymentById(row.id);
      throw inner;
    }
  } catch (err) {
    if (err.code === "MERCADOPAGO_NOT_CONFIGURED") {
      return res.status(503).json({
        error:
          "Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN y PUBLIC_URL en .env",
      });
    }
    console.error("Checkout Mercado Pago:", err);
    next(err);
  }
});

app.post("/api/payments", uploadComprobante.any(), async (req, res, next) => {
  try {
    await initDb();
    const file =
      (req.files && req.files.find((f) => f.fieldname === "comprobante")) || req.file;
    const { nombre, email, telefono, metodo, referencia, creditos } = req.body || {};
    const methods = ["yape", "plin", "mercadopago"];
    const n = String(nombre || "").trim();
    const e = String(email || "").trim();
    const t = String(telefono || "").trim();
    const m = String(metodo || "").toLowerCase();
    const ref = String(referencia || "").trim();
    const amount = montoDesdeCreditos(creditos);
    if (amount == null) {
      return res.status(400).json({
        error: "Elige un paquete de créditos válido (50, 80 o 100).",
      });
    }
    const c = Number(creditos);

    if (!n || !e || !t) {
      return res.status(400).json({ error: "Nombre, email y teléfono son obligatorios" });
    }
    if (!methods.includes(m)) {
      return res.status(400).json({ error: "Método de pago no válido" });
    }
    if (m === "mercadopago") {
      return res.status(400).json({
        error:
          "Para pagar con Mercado Pago elige esa opción y envía el formulario: se abrirá el checkout oficial.",
      });
    }

    if ((m === "yape" || m === "plin") && !ref) {
      return res.status(400).json({ error: "El número de operación es obligatorio." });
    }

    let comprobantePath = null;
    if (file?.buffer?.length) {
      comprobantePath = await saveComprobanteFile(file, { rootDir });
    }

    const row = await insertPayment({
      nombre: n,
      email: e,
      telefono: t,
      metodo: m,
      monto: amount,
      creditos: c,
      referencia: ref || null,
      notas: null,
      comprobante_path: comprobantePath,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

app.get("/api/payment-status", async (req, res, next) => {
  try {
    const token = String(req.query?.token || "").trim();
    if (!isRegistroTokenLike(token)) {
      return res.status(400).json({ error: "Código de registro inválido" });
    }
    await initDb();
    const row = await getPaymentByRegistroToken(token);
    if (!row) {
      return res.status(404).json({ error: "No encontrado" });
    }
    res.json({
      verificado: Boolean(row.verificado),
      registro_token: row.registro_token,
      voucher_code: row.voucher_code || null,
    });
  } catch (err) {
    next(err);
  }
});

app.patch("/api/payments/:id/verificado", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const v = req.body?.verificado;
    if (typeof v !== "boolean") {
      return res.status(400).json({ error: "Se requiere verificado: true o false" });
    }
    await initDb();
    const cur = await getPaymentById(id);
    if (!cur) {
      return res.status(404).json({ error: "Registro no encontrado" });
    }

    let voucherCode = null;
    if (v) {
      const credits = Number(cur.creditos);
      if (!Number.isFinite(credits) || credits <= 0) {
        return res.status(400).json({
          error: "Este pago no tiene un paquete de créditos; no se puede obtener un voucher.",
        });
      }
      try {
        voucherCode = await fetchVoucherForCreditPackage(credits);
      } catch (err) {
        console.error("Voucher (admin verificar):", err);
        return res.status(503).json({ error: voucherErrorMessage(err) });
      }
    }

    let row;
    try {
      row = await setPaymentVerificado(id, v, voucherCode);
    } catch (dbErr) {
      const pgDup = dbErr?.code === "23505";
      const sqliteDup = /UNIQUE|constraint/i.test(String(dbErr?.message || ""));
      if (pgDup || sqliteDup) {
        return res.status(409).json({
          error:
            "Ese código de voucher ya está asignado a otro registro. Intenta desmarcar verificación en el otro pago o genera de nuevo.",
        });
      }
      throw dbErr;
    }
    if (!row) {
      return res.status(500).json({ error: "No se pudo actualizar el registro." });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
});

app.get("/api/payments", requireAdmin, async (_req, res, next) => {
  try {
    await initDb();
    const rows = await listPayments();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/payments/:id", requireAdmin, async (req, res, next) => {
  try {
    await initDb();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const row = await getPaymentById(id);
    if (!row) {
      return res.status(404).json({ error: "Registro no encontrado" });
    }
    await removeComprobanteFile(row.comprobante_path, { rootDir });
    const ok = await deletePaymentById(id);
    if (!ok) {
      return res.status(404).json({ error: "No se pudo eliminar" });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(rootDir, "public", "admin.html"));
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "El archivo supera el tamaño máximo permitido." });
    }
    return res.status(400).json({ error: "Error al subir el archivo" });
  }
  if (err?.message === "INVALID_IMAGE_TYPE") {
    return res.status(400).json({
      error: "Formato no permitido. Usa JPEG, PNG, GIF o WebP.",
    });
  }
  if (err?.message === "INVALID_COMPROBANTE_TYPE") {
    return res.status(400).json({
      error: "Comprobante: usa imagen (JPEG, PNG, GIF, WebP) o PDF.",
    });
  }
  next(err);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const msg = typeof err?.message === "string" ? err.message : "";
  if (msg.includes("DATABASE_URL")) {
    return res.status(503).json({ error: msg });
  }
  if (err?.code === "BLOB_TOKEN_REQUIRED") {
    return res.status(503).json({ error: msg || "Configura Vercel Blob para adjuntos." });
  }
  if (err?.code === "BLOB_UPLOAD_FAILED") {
    return res.status(503).json({ error: msg || "No se pudo guardar el comprobante." });
  }
  res.status(500).json({ error: "Error del servidor" });
});

export default app;
