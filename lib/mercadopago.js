import { MercadoPagoConfig, Payment, Preference } from "mercadopago";

function publicBaseUrl() {
  const u = process.env.PUBLIC_URL || "http://localhost:3000";
  return String(u).replace(/\/$/, "");
}

function getAccessToken() {
  return process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() || null;
}

export function isMercadoPagoConfigured() {
  return Boolean(getAccessToken());
}

function getConfig() {
  const accessToken = getAccessToken();
  if (!accessToken) return null;
  return new MercadoPagoConfig({ accessToken });
}

export async function createCheckoutPreference({
  paymentId,
  nombre,
  email,
  monto,
  notas,
  registro_token,
}) {
  const config = getConfig();
  if (!config) {
    const err = new Error("MERCADOPAGO_NOT_CONFIGURED");
    err.code = "MERCADOPAGO_NOT_CONFIGURED";
    throw err;
  }
  const preference = new Preference(config);
  const base = publicBaseUrl();
  const token = getAccessToken();
  const isTest = token.startsWith("TEST-");
  const rt = registro_token ? encodeURIComponent(String(registro_token)) : "";

  const body = {
    items: [
      {
        title: "Pago Turbo Predictions",
        quantity: 1,
        unit_price: Number(Number(monto).toFixed(2)),
        currency_id: "PEN",
      },
    ],
    payer: {
      name: String(nombre).slice(0, 256),
      email: String(email).trim(),
    },
    external_reference: String(paymentId),
    back_urls: {
      success: `${base}/pago/resultado.html?estado=aprobado${rt ? `&token=${rt}` : ""}`,
      failure: `${base}/pago/resultado.html?estado=rechazado${rt ? `&token=${rt}` : ""}`,
      pending: `${base}/pago/resultado.html?estado=pendiente${rt ? `&token=${rt}` : ""}`,
    },
    auto_return: "approved",
    notification_url: `${base}/api/webhooks/mercadopago`,
    metadata: {
      payment_db_id: String(paymentId),
      notas: notas ? String(notas).slice(0, 500) : "",
    },
  };

  const result = await preference.create({ body });
  const initPoint = isTest ? result.sandbox_init_point || result.init_point : result.init_point;
  return {
    preference_id: result.id,
    init_point: initPoint,
  };
}

export async function fetchPayment(mpPaymentId) {
  const config = getConfig();
  if (!config) {
    const err = new Error("MERCADOPAGO_NOT_CONFIGURED");
    err.code = "MERCADOPAGO_NOT_CONFIGURED";
    throw err;
  }
  const payment = new Payment(config);
  return payment.get({ id: mpPaymentId });
}

export function mapMercadoPagoPaymentStatus(status) {
  if (status === "approved") return "approved";
  if (
    status === "pending" ||
    status === "in_process" ||
    status === "in_mediation" ||
    status === "authorized"
  ) {
    return "pending";
  }
  return "rejected";
}
