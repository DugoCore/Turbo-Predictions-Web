import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const DATABASE_URL = process.env.DATABASE_URL;
const isVercel = process.env.VERCEL === "1";

let sqlite = null;
let sqlPg = null;
let initPromise = null;

function ensureDataDir() {
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "payments.db");
}

async function initPostgres() {
  if (!sqlPg) {
    sqlPg = postgres(DATABASE_URL, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      /** Evita "cached plan must not change result type" (Neon/PgBouncer) tras migraciones. */
      prepare: false,
    });
  }
  await sqlPg`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL,
      telefono TEXT NOT NULL,
      metodo TEXT NOT NULL CHECK (metodo IN ('yape', 'plin', 'mercadopago')),
      monto DOUBLE PRECISION NOT NULL CHECK (monto > 0),
      referencia TEXT,
      notas TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS mp_preference_id TEXT`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS mp_payment_id TEXT`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS mp_status TEXT`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS comprobante_path TEXT`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS registro_token TEXT`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS creditos INTEGER`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS verificado BOOLEAN NOT NULL DEFAULT FALSE`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS voucher_code TEXT`;
  await sqlPg`ALTER TABLE payments ADD COLUMN IF NOT EXISTS verificacion_rechazada BOOLEAN NOT NULL DEFAULT FALSE`;
  await sqlPg`
    CREATE UNIQUE INDEX IF NOT EXISTS payments_registro_token_key ON payments (registro_token)
  `;
  await sqlPg`
    CREATE UNIQUE INDEX IF NOT EXISTS payments_voucher_code_key ON payments (voucher_code) WHERE voucher_code IS NOT NULL
  `;
}

function applySqliteMigrations() {
  if (!sqlite || DATABASE_URL) return;
  const cols = sqlite.prepare("PRAGMA table_info(payments)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("mp_preference_id")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN mp_preference_id TEXT");
  }
  if (!names.has("mp_payment_id")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN mp_payment_id TEXT");
  }
  if (!names.has("mp_status")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN mp_status TEXT");
  }
  if (!names.has("comprobante_path")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN comprobante_path TEXT");
  }
  if (!names.has("registro_token")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN registro_token TEXT");
  }
  if (!names.has("creditos")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN creditos INTEGER");
  }
  if (!names.has("verificado")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN verificado INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.has("voucher_code")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN voucher_code TEXT");
  }
  if (!names.has("verificacion_rechazada")) {
    sqlite.exec("ALTER TABLE payments ADD COLUMN verificacion_rechazada INTEGER NOT NULL DEFAULT 0");
  }
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_registro_token ON payments(registro_token)"
  );
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_voucher_code ON payments(voucher_code) WHERE voucher_code IS NOT NULL"
  );
}

async function initSqlite() {
  if (!sqlite) {
    const { default: Database } = await import("better-sqlite3");
    sqlite = new Database(ensureDataDir());
    sqlite.pragma("journal_mode = WAL");
    sqlite.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL,
      telefono TEXT NOT NULL,
      metodo TEXT NOT NULL CHECK (metodo IN ('yape', 'plin', 'mercadopago')),
      monto REAL NOT NULL CHECK (monto > 0),
      referencia TEXT,
      notas TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  }
  applySqliteMigrations();
}

export async function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (DATABASE_URL) {
      await initPostgres();
      return;
    }
    if (isVercel) {
      throw new Error(
        "Configura DATABASE_URL en Vercel con la cadena de conexión de Neon (PostgreSQL)."
      );
    }
    await initSqlite();
  })();
  return initPromise;
}

function rowFromPg(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.created_at instanceof Date) {
    out.created_at = out.created_at.toISOString();
  }
  if (out.monto != null) out.monto = Number(out.monto);
  if (out.id != null) out.id = Number(out.id);
  if (out.verificado != null) out.verificado = Boolean(out.verificado);
  if (out.verificacion_rechazada != null) out.verificacion_rechazada = Boolean(out.verificacion_rechazada);
  return out;
}

export async function insertPayment({
  nombre,
  email,
  telefono,
  metodo,
  monto,
  referencia,
  notas,
  mp_preference_id = null,
  mp_payment_id = null,
  mp_status = null,
  comprobante_path = null,
  registro_token: registroTokenIn = null,
  creditos = null,
  verificado = false,
}) {
  const registro_token = registroTokenIn || crypto.randomUUID();
  await initDb();
  applySqliteMigrations();
  const verificadoSqlite = verificado ? 1 : 0;
  if (DATABASE_URL) {
    const [row] = await sqlPg`
      INSERT INTO payments (nombre, email, telefono, metodo, monto, referencia, notas, mp_preference_id, mp_payment_id, mp_status, comprobante_path, registro_token, creditos, verificado)
      VALUES (${nombre}, ${email}, ${telefono}, ${metodo}, ${monto}, ${referencia}, ${notas}, ${mp_preference_id}, ${mp_payment_id}, ${mp_status}, ${comprobante_path}, ${registro_token}, ${creditos}, ${verificado})
      RETURNING id, nombre, email, telefono, metodo, monto, referencia, notas, mp_preference_id, mp_payment_id, mp_status, comprobante_path, registro_token, creditos, verificado, created_at
    `;
    return rowFromPg(row);
  }
  const stmt = sqlite.prepare(`
    INSERT INTO payments (nombre, email, telefono, metodo, monto, referencia, notas, mp_preference_id, mp_payment_id, mp_status, comprobante_path, registro_token, creditos, verificado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    nombre,
    email,
    telefono,
    metodo,
    monto,
    referencia,
    notas,
    mp_preference_id,
    mp_payment_id,
    mp_status,
    comprobante_path,
    registro_token,
    creditos,
    verificadoSqlite
  );
  return sqlite.prepare("SELECT * FROM payments WHERE id = ?").get(info.lastInsertRowid);
}

export async function getPaymentById(id) {
  await initDb();
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  if (DATABASE_URL) {
    const [row] = await sqlPg`SELECT * FROM payments WHERE id = ${n}`;
    return rowFromPg(row);
  }
  return sqlite.prepare("SELECT * FROM payments WHERE id = ?").get(n);
}

export async function getPaymentByRegistroToken(token) {
  await initDb();
  applySqliteMigrations();
  const t = String(token || "").trim();
  if (!t) return null;
  if (DATABASE_URL) {
    const [row] = await sqlPg`SELECT * FROM payments WHERE registro_token = ${t}`;
    return rowFromPg(row);
  }
  return sqlite.prepare("SELECT * FROM payments WHERE registro_token = ?").get(t);
}

export async function setPaymentVerificado(id, verificado, voucherCode = null, opts = {}) {
  await initDb();
  applySqliteMigrations();
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  const v = Boolean(verificado);
  const vc = v && voucherCode != null ? String(voucherCode).trim() || null : null;
  const rechazada = v ? false : Boolean(opts.rechazada);
  if (DATABASE_URL) {
    const [row] = await sqlPg`
      UPDATE payments SET verificado = ${v}, voucher_code = ${vc}, verificacion_rechazada = ${rechazada}
      WHERE id = ${n}
      RETURNING id, registro_token, verificado, voucher_code, verificacion_rechazada
    `;
    return rowFromPg(row);
  }
  sqlite
    .prepare("UPDATE payments SET verificado = ?, voucher_code = ?, verificacion_rechazada = ? WHERE id = ?")
    .run(v ? 1 : 0, vc, rechazada ? 1 : 0, n);
  return sqlite
    .prepare(
      "SELECT id, registro_token, verificado, voucher_code, verificacion_rechazada FROM payments WHERE id = ?"
    )
    .get(n);
}

export async function updatePaymentMp(id, patch) {
  await initDb();
  const cur = await getPaymentById(id);
  if (!cur) return null;
  const mp_preference_id =
    patch.mp_preference_id !== undefined ? patch.mp_preference_id : cur.mp_preference_id;
  const mp_payment_id =
    patch.mp_payment_id !== undefined ? patch.mp_payment_id : cur.mp_payment_id;
  const mp_status = patch.mp_status !== undefined ? patch.mp_status : cur.mp_status;
  const referencia = patch.referencia !== undefined ? patch.referencia : cur.referencia;
  if (DATABASE_URL) {
    const [row] = await sqlPg`
      UPDATE payments SET
        mp_preference_id = ${mp_preference_id},
        mp_payment_id = ${mp_payment_id},
        mp_status = ${mp_status},
        referencia = ${referencia}
      WHERE id = ${id}
      RETURNING id, nombre, email, telefono, metodo, monto, referencia, notas, mp_preference_id, mp_payment_id, mp_status, created_at
    `;
    return rowFromPg(row);
  }
  sqlite
    .prepare(
      `UPDATE payments SET
        mp_preference_id = ?,
        mp_payment_id = ?,
        mp_status = ?,
        referencia = ?
      WHERE id = ?`
    )
    .run(mp_preference_id, mp_payment_id, mp_status, referencia, id);
  return sqlite.prepare("SELECT * FROM payments WHERE id = ?").get(id);
}

export async function deletePaymentById(id) {
  await initDb();
  const n = Number(id);
  if (!Number.isFinite(n)) return false;
  if (DATABASE_URL) {
    const rows = await sqlPg`DELETE FROM payments WHERE id = ${n} RETURNING id`;
    return rows.length > 0;
  }
  const r = sqlite.prepare("DELETE FROM payments WHERE id = ?").run(n);
  return r.changes > 0;
}

export async function listPayments() {
  await initDb();
  applySqliteMigrations();
  if (DATABASE_URL) {
    const rows = await sqlPg`
      SELECT id, registro_token, voucher_code, nombre, email, telefono, metodo, monto, creditos, verificado, verificacion_rechazada, referencia, notas, mp_preference_id, mp_payment_id, mp_status, comprobante_path, created_at
      FROM payments
      ORDER BY created_at DESC
    `;
    return rows.map(rowFromPg);
  }
  return sqlite
    .prepare("SELECT * FROM payments ORDER BY datetime(created_at) DESC")
    .all();
}
