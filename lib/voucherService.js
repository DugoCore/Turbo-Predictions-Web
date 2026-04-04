/**
 * Cliente del servicio de vouchers (otro proyecto, p. ej. FastAPI en :8000).
 *
 * Flujo: al pulsar «Verificar» en admin, Express llama aquí desde el servidor.
 * Es una petición servidor → servidor; no pasa por el navegador (no necesitas CORS en el :8000
 * para esta integración).
 *
 * POST — body: { "credits": number }
 * Respuesta: { "status": "success", "voucher_code": "...", "credits": number }
 */

const DEFAULT_GENERATE_URL = "http://localhost:8000/admin/vouchers/generate";
const GENERATE_PATH = "/admin/vouchers/generate";

/**
 * URL del POST. Prioridad:
 * 1. `VOUCHER_GENERATE_URL` — URL completa del otro proyecto (recomendado si vive en otro host/puerto).
 * 2. `VOUCHER_SERVICE_URL` — solo origen (`http://localhost:8000`) o URL ya terminada en `.../generate`.
 * 3. Por defecto — `http://localhost:8000/admin/vouchers/generate`.
 */
export function resolveVoucherGenerateUrl() {
  const full = (process.env.VOUCHER_GENERATE_URL || "").trim();
  if (full) {
    return full.replace(/\/+$/, "");
  }
  const raw = (process.env.VOUCHER_SERVICE_URL || "").trim();
  if (!raw) {
    return DEFAULT_GENERATE_URL;
  }
  const base = raw.replace(/\/+$/, "");
  if (/\/admin\/vouchers\/generate$/i.test(base)) {
    return base;
  }
  return `${base}${GENERATE_PATH}`;
}

/**
 * @param {number} expectedCredits — paquete del pago (50, 80 o 100)
 * @returns {Promise<string>} voucher_code
 */
export async function fetchVoucherForCreditPackage(expectedCredits) {
  const credits = Number(expectedCredits);
  if (!Number.isFinite(credits) || credits <= 0) {
    const err = new Error("VOUCHER_INVALID_EXPECTED_CREDITS");
    err.code = "VOUCHER_INVALID_EXPECTED_CREDITS";
    throw err;
  }

  const adminToken = (process.env.VOUCHER_ADMIN_TOKEN || "").trim();
  if (!adminToken) {
    const err = new Error("VOUCHER_ADMIN_TOKEN_REQUIRED");
    err.code = "VOUCHER_ADMIN_TOKEN_REQUIRED";
    throw err;
  }

  const url = resolveVoucherGenerateUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        /** Futbol Bot API / Swagger: mismo valor que en «Authorize» o curl `X-Admin-Token`. */
        "X-Admin-Token": adminToken,
      },
      body: JSON.stringify({ credits }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = new Error(`VOUCHER_HTTP_${res.status}`);
    err.code = "VOUCHER_HTTP";
    err.status = res.status;
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error("VOUCHER_INVALID_JSON");
    err.code = "VOUCHER_INVALID_JSON";
    throw err;
  }

  if (data == null || typeof data !== "object") {
    const err = new Error("VOUCHER_INVALID_BODY");
    err.code = "VOUCHER_INVALID_BODY";
    throw err;
  }

  if (String(data.status || "").toLowerCase() !== "success") {
    const err = new Error("VOUCHER_NOT_SUCCESS");
    err.code = "VOUCHER_NOT_SUCCESS";
    throw err;
  }

  const code = String(data.voucher_code || "").trim();
  if (!code) {
    const err = new Error("VOUCHER_MISSING_CODE");
    err.code = "VOUCHER_MISSING_CODE";
    throw err;
  }

  const returned = Number(data.credits);
  if (Number.isFinite(returned) && returned !== credits) {
    const err = new Error("VOUCHER_CREDITS_MISMATCH");
    err.code = "VOUCHER_CREDITS_MISMATCH";
    throw err;
  }

  return code;
}
