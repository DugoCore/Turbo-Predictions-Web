const form = document.getElementById("payment-form");
const msg = document.getElementById("form-message");
const submitBtn = document.getElementById("submit-btn");
const submitBtnStep2 = document.getElementById("submit-btn-step2");
const submitBtnStep3 = document.getElementById("submit-btn-step3");
const qrModal = document.getElementById("qr-modal");
const qrModalBackdrop = document.getElementById("qr-modal-backdrop");
const qrModalClose = document.getElementById("qr-modal-close");
const postQrReferencia = document.getElementById("post-qr-referencia");
const postQrComprobante = document.getElementById("post-qr-comprobante");
const step1Panel = document.getElementById("step-1-panel");
const step2Panel = document.getElementById("step-2-panel");
const step3Panel = document.getElementById("step-3-panel");
const stepperItem1 = document.getElementById("stepper-item-1");
const stepperItem2 = document.getElementById("stepper-item-2");
const stepperItem3 = document.getElementById("stepper-item-3");
const stepperTrigger1 = document.getElementById("stepper-trigger-1");
const stepperTrigger2 = document.getElementById("stepper-trigger-2");
const stepperTrigger3 = document.getElementById("stepper-trigger-3");
const paymentFlowCard = document.getElementById("payment-flow-card");
const paymentStatusPendingCard = document.getElementById("payment-status-pending-card");
const paymentStatusSuccessCard = document.getElementById("payment-status-success-card");
const paymentStatusSuccessLead = document.getElementById("payment-status-success-lead");
const paymentStatusTokenDisplay = document.getElementById("payment-status-token-display");
const paymentStatusSuccessHint = document.getElementById("payment-status-success-hint");
const paymentStatusNewBtn = document.getElementById("payment-status-new-btn");
const paymentStatusRejectedCard = document.getElementById("payment-status-rejected-card");
const paymentStatusRejectedMsg = document.getElementById("payment-status-rejected-msg");
const paymentStatusRejectedNewBtn = document.getElementById("payment-status-rejected-new-btn");
const creditosOptionsEl = document.getElementById("creditos-options");
const metodoOptionsEl = document.getElementById("metodo-options");

const REJECTED_PAYMENT_MSG =
  "Su pago fue rechazado, nos pondremos en contacto para más detalles.";

const QR_ACK_KEY = "tp_qr_ack";
const LS_PAYMENT_TOKEN = "tp_payment_token";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VOUCHER_CODE_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;

function isPaymentRegistroCode(value) {
  const t = String(value || "").trim();
  if (!t || t.length < 8) return false;
  if (UUID_RE.test(t)) return true;
  return VOUCHER_CODE_RE.test(t);
}

let statusPollTimer = null;

const DEFAULT_PACKAGE_OPTIONS = Object.freeze([
  { credits: 50, price: 30 },
  { credits: 80, price: 50 },
  { credits: 100, price: 60 },
]);
let packageOptions = DEFAULT_PACKAGE_OPTIONS.map((p) => ({ ...p }));
let visiblePaymentMethods = {
  yape: true,
  plin: true,
  mercadopago: true,
};

let currentStep = 1;

function setPanelInputsEnabled(panel, enabled) {
  if (!panel) return;
  panel.querySelectorAll("input, select, textarea").forEach((el) => {
    el.disabled = !enabled;
  });
}

function setStep(step) {
  if (step === 1) {
    postQrReferencia.value = "";
    postQrComprobante.value = "";
    postQrReferencia.required = false;
    sessionStorage.removeItem(QR_ACK_KEY);
  }
  currentStep = step;
  form.dataset.currentStep = String(step);

  setPanelInputsEnabled(step1Panel, step === 1);
  setPanelInputsEnabled(step2Panel, step === 2);
  setPanelInputsEnabled(step3Panel, step === 3);

  if (step1Panel) step1Panel.hidden = step !== 1;
  if (step2Panel) step2Panel.hidden = step !== 2;
  if (step3Panel) step3Panel.hidden = step !== 3;

  const items = [stepperItem1, stepperItem2, stepperItem3];
  items.forEach((item, i) => {
    const n = i + 1;
    if (!item) return;
    item.classList.toggle("is-active", n === step);
    item.classList.toggle("is-done", n < step);
  });

  stepperTrigger1?.removeAttribute("aria-current");
  stepperTrigger2?.removeAttribute("aria-current");
  stepperTrigger3?.removeAttribute("aria-current");
  if (step === 1) stepperTrigger1?.setAttribute("aria-current", "step");
  else if (step === 2) stepperTrigger2?.setAttribute("aria-current", "step");
  else stepperTrigger3?.setAttribute("aria-current", "step");

  if (step === 3) {
    step3Panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  syncSubmitButtons();
}

let isSubmitting = false;

function syncSubmitButtons() {
  submitBtn.disabled = currentStep !== 1 || isSubmitting;
  submitBtnStep2.disabled = currentStep !== 2 || isSubmitting;
  submitBtnStep3.disabled = currentStep !== 3 || isSubmitting;
}

function setLoading(loading) {
  isSubmitting = loading;
  syncSubmitButtons();
}

function showMessage(text, ok) {
  msg.hidden = false;
  msg.textContent = text;
  msg.className = "message " + (ok ? "success" : "error");
}

function stopStatusPoll() {
  if (statusPollTimer != null) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

function persistPaymentToken(token) {
  try {
    localStorage.setItem(LS_PAYMENT_TOKEN, token);
  } catch {
    /* ignore */
  }
}

async function pollPaymentStatusOnce(token) {
  const res = await fetch(
    `/api/payment-status?token=${encodeURIComponent(token)}`,
    { credentials: "same-origin" }
  );
  if (!res.ok) return;
  const data = await res.json();
  if (data.rechazado) {
    showRejectedStatusUI();
    return;
  }
  if (data.verificado) {
    const display =
      (data.voucher_code && String(data.voucher_code).trim()) ||
      (data.registro_token && String(data.registro_token).trim()) ||
      token;
    showVerifiedSuccessUI(display);
  }
}

function showPendingStatusUI(token) {
  stopStatusPoll();
  msg.hidden = true;
  if (paymentFlowCard) paymentFlowCard.hidden = true;
  if (paymentStatusPendingCard) paymentStatusPendingCard.hidden = false;
  if (paymentStatusSuccessCard) paymentStatusSuccessCard.hidden = true;
  if (paymentStatusRejectedCard) paymentStatusRejectedCard.hidden = true;
  void pollPaymentStatusOnce(token);
  statusPollTimer = window.setInterval(() => {
    void pollPaymentStatusOnce(token);
  }, 4000);
}

function showRejectedStatusUI() {
  stopStatusPoll();
  msg.hidden = true;
  if (paymentFlowCard) paymentFlowCard.hidden = true;
  if (paymentStatusPendingCard) paymentStatusPendingCard.hidden = true;
  if (paymentStatusSuccessCard) paymentStatusSuccessCard.hidden = true;
  if (paymentStatusRejectedCard) paymentStatusRejectedCard.hidden = false;
  if (paymentStatusRejectedMsg) {
    paymentStatusRejectedMsg.textContent = REJECTED_PAYMENT_MSG;
  }
  paymentStatusRejectedCard?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showVerifiedSuccessUI(displayCode) {
  stopStatusPoll();
  msg.hidden = true;
  if (paymentFlowCard) paymentFlowCard.hidden = true;
  if (paymentStatusPendingCard) paymentStatusPendingCard.hidden = true;
  if (paymentStatusRejectedCard) paymentStatusRejectedCard.hidden = true;
  if (paymentStatusSuccessCard) paymentStatusSuccessCard.hidden = false;
  if (paymentStatusSuccessLead) {
    paymentStatusSuccessLead.textContent = "Su compra fue exitosa. Su código token es:";
  }
  if (paymentStatusTokenDisplay) {
    paymentStatusTokenDisplay.value = displayCode;
  }
  if (paymentStatusSuccessHint) {
    paymentStatusSuccessHint.textContent =
      "Ya puedes canjearlo en el canal Turbo Prediction.";
  }
  paymentStatusSuccessCard?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearPaymentStatusUI() {
  stopStatusPoll();
  try {
    localStorage.removeItem(LS_PAYMENT_TOKEN);
  } catch {
    /* ignore */
  }
  if (paymentStatusPendingCard) paymentStatusPendingCard.hidden = true;
  if (paymentStatusSuccessCard) paymentStatusSuccessCard.hidden = true;
  if (paymentStatusRejectedCard) paymentStatusRejectedCard.hidden = true;
  if (paymentFlowCard) paymentFlowCard.hidden = false;
}

function handleNewPaymentAfterStatus() {
  clearPaymentStatusUI();
  form.reset();
  setStep(1);
}

paymentStatusNewBtn?.addEventListener("click", handleNewPaymentAfterStatus);
paymentStatusRejectedNewBtn?.addEventListener("click", handleNewPaymentAfterStatus);

document.getElementById("payment-status-copy-btn")?.addEventListener("click", async () => {
  const input = paymentStatusTokenDisplay;
  const btn = document.getElementById("payment-status-copy-btn");
  const text = input && "value" in input ? String(input.value || "") : "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try {
      input.focus();
      input.select();
      document.execCommand("copy");
    } catch {
      /* ignore */
    }
  }
  if (btn) {
    const labelEl = document.getElementById("payment-status-copy-label");
    const prevAria = btn.getAttribute("aria-label") || "Copiar código";
    btn.setAttribute("aria-label", "Copiado al portapapeles");
    btn.classList.add("btn-token-copy--done");
    if (labelEl) labelEl.textContent = "Copiado";
    window.setTimeout(() => {
      btn.setAttribute("aria-label", prevAria);
      btn.classList.remove("btn-token-copy--done");
      if (labelEl) labelEl.textContent = "Copiar";
    }, 2500);
  }
});

async function initPaymentStatusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let token = params.get("token");
  if (token) {
    history.replaceState({}, "", window.location.pathname);
    persistPaymentToken(token);
  } else {
    try {
      token = localStorage.getItem(LS_PAYMENT_TOKEN);
    } catch {
      token = null;
    }
  }
  if (!token || !isPaymentRegistroCode(token)) return;

  try {
    const res = await fetch(
      `/api/payment-status?token=${encodeURIComponent(token)}`,
      { credentials: "same-origin" }
    );
    if (res.status === 404) {
      try {
        localStorage.removeItem(LS_PAYMENT_TOKEN);
      } catch {
        /* ignore */
      }
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (data.rechazado) {
      showRejectedStatusUI();
    } else if (data.verificado) {
      const display =
        (data.voucher_code && String(data.voucher_code).trim()) ||
        (data.registro_token && String(data.registro_token).trim()) ||
        token;
      showVerifiedSuccessUI(display);
    } else {
      showPendingStatusUI(token);
    }
  } catch {
    /* ignore */
  }
}

function solesDesdeCreditosElegidos() {
  const v = Number(form.querySelector('input[name="creditos"]:checked')?.value);
  const found = packageOptions.find((pkg) => pkg.credits === v);
  return found ? found.price : null;
}

function formatSoles(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function renderCreditosPrices() {
  if (!creditosOptionsEl) return;
  const safePackages = Array.isArray(packageOptions) && packageOptions.length ? packageOptions : [];
  creditosOptionsEl.innerHTML = safePackages
    .map(
      (pkg, idx) => `<label class="radio">
        <input type="radio" name="creditos" value="${Number(pkg.credits)}" ${idx === 0 ? "required" : ""} />
        <span>${Number(pkg.credits)} créditos — S/ ${formatSoles(Number(pkg.price))}</span>
      </label>`
    )
    .join("");
}

const PAYMENT_METHOD_LABELS = {
  yape: "Yape",
  plin: "Plin",
  mercadopago: "Mercado Pago",
};

function renderPaymentMethods() {
  if (!metodoOptionsEl) return;
  const order = ["yape", "plin", "mercadopago"];
  const visible = order.filter((key) => visiblePaymentMethods[key] !== false);
  metodoOptionsEl.innerHTML = visible
    .map(
      (key, idx) => `<label class="radio">
        <input type="radio" name="metodo" value="${key}" ${idx === 0 ? "required" : ""} />
        <span>${PAYMENT_METHOD_LABELS[key]}</span>
      </label>`
    )
    .join("");
}

async function loadPackagePrices() {
  try {
    const res = await fetch("/api/payment-qr", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const src = Array.isArray(data?.packageOptions) ? data.packageOptions : null;
    if (!src) return;
    const next = [];
    for (const pkg of src) {
      const credits = Number(pkg?.credits);
      const price = Number(pkg?.price);
      if (!Number.isFinite(credits) || credits <= 0 || !Number.isFinite(price) || price <= 0) {
        return;
      }
      next.push({ credits: Math.round(credits), price });
    }
    if (!next.length) return;
    packageOptions = next;
    if (data?.paymentMethods && typeof data.paymentMethods === "object") {
      visiblePaymentMethods = {
        yape: data.paymentMethods.yape !== false,
        plin: data.paymentMethods.plin !== false,
        mercadopago: data.paymentMethods.mercadopago !== false,
      };
    }
    renderCreditosPrices();
    renderPaymentMethods();
  } catch {
    /* ignore */
  }
}

function openQrModal(metodo, imageUrl, soles) {
  const title = document.getElementById("qr-modal-title");
  const amountEl = document.getElementById("qr-modal-amount");
  const imgWrap = document.getElementById("qr-modal-img-wrap");
  const img = document.getElementById("qr-modal-img");
  const missing = document.getElementById("qr-modal-missing");

  title.textContent = metodo === "yape" ? "Pagar con Yape" : "Pagar con Plin";
  amountEl.textContent =
    soles != null ? `Paga S/ ${soles} — escanea el código QR` : "Escanea el código QR";

  if (imageUrl) {
    img.src = imageUrl;
    img.alt = metodo === "yape" ? "Código QR Yape" : "Código QR Plin";
    imgWrap.hidden = false;
    missing.hidden = true;
  } else {
    imgWrap.hidden = true;
    missing.hidden = false;
  }

  qrModal.classList.add("is-open");
  qrModal.setAttribute("aria-hidden", "false");
}

function closeQrModal(metodo) {
  qrModal.classList.remove("is-open");
  qrModal.setAttribute("aria-hidden", "true");
  if (metodo === "yape" || metodo === "plin") {
    sessionStorage.setItem(QR_ACK_KEY, metodo);
    setStep(3);
  }
}

form.addEventListener("change", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name === "metodo" || target.name === "creditos") {
    sessionStorage.removeItem(QR_ACK_KEY);
  }
});

function ackMetodoFromForm() {
  const checked = form.querySelector('input[name="metodo"]:checked')?.value;
  return checked === "yape" || checked === "plin" ? checked : null;
}

qrModalClose.addEventListener("click", () => {
  closeQrModal(ackMetodoFromForm());
});

qrModalBackdrop.addEventListener("click", () => {
  closeQrModal(ackMetodoFromForm());
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && qrModal.classList.contains("is-open")) {
    closeQrModal(ackMetodoFromForm());
  }
});

function metodoFromForm() {
  return form.querySelector('input[name="metodo"]:checked')?.value ?? "";
}

function creditosFromForm() {
  return form.querySelector('input[name="creditos"]:checked')?.value ?? "";
}

/** Paso 1: nombre, email, teléfono. */
function isStep1Valid() {
  const nombre = form.querySelector('[name="nombre"]')?.value?.trim();
  const email = form.querySelector('[name="email"]');
  const telefono = form.querySelector('[name="telefono"]')?.value?.trim();
  if (!nombre || !telefono) return false;
  return Boolean(email?.validity?.valid);
}

/** Paso 2: créditos y método. */
function isStep2Valid() {
  const c = creditosFromForm();
  const m = metodoFromForm();
  return Boolean(c && m);
}

stepperTrigger1?.addEventListener("click", () => {
  if (currentStep === 1) return;
  goToStep1FromUi();
});

stepperTrigger2?.addEventListener("click", () => {
  if (currentStep === 2) return;
  if (currentStep === 3) {
    setStep(2);
    return;
  }
  goToStep2FromUi();
});

stepperTrigger3?.addEventListener("click", () => {
  if (currentStep === 3) return;
  goToStep3FromUi();
});

async function loadQrModalForYapePlin(metodo) {
  setLoading(true);
  const soles = solesDesdeCreditosElegidos();
  try {
    const res = await fetch("/api/payment-qr");
    const urls = await res.json().catch(() => ({}));
    const imageUrl = metodo === "yape" ? urls.yape : urls.plin;
    openQrModal(metodo, imageUrl || null, soles);
  } catch {
    showMessage("No se pudo cargar la información del pago.", false);
  } finally {
    setLoading(false);
  }
}

/** Desde paso 1 o stepper: validar datos y abrir paso 2. */
async function goToStep2FromUi() {
  msg.hidden = true;
  if (!isStep1Valid()) {
    setStep(1);
    setPanelInputsEnabled(step1Panel, true);
    form.reportValidity();
    return;
  }
  setStep(2);
}

/** Ir al paso 3 desde el stepper: validación + QR Yape/Plin si aplica. */
async function goToStep3FromUi() {
  msg.hidden = true;
  if (!isStep1Valid()) {
    setStep(1);
    setPanelInputsEnabled(step1Panel, true);
    form.reportValidity();
    return;
  }
  if (!isStep2Valid()) {
    setStep(2);
    form.reportValidity();
    return;
  }
  const metodo = metodoFromForm();
  if (metodo === "mercadopago") {
    showMessage(
      "Con Mercado Pago el pago se completa al pulsar Continuar en el paso 2; no necesitas el paso 3.",
      false
    );
    return;
  }
  if (metodo === "yape" || metodo === "plin") {
    if (sessionStorage.getItem(QR_ACK_KEY) === metodo) {
      setStep(3);
      return;
    }
    await loadQrModalForYapePlin(metodo);
  }
}

function goToStep1FromUi() {
  setStep(1);
}

/** Paso 3 (Yape/Plin): comprobante obligatorio; número de operación opcional. */
function isStep3CompleteForPayment(metodo) {
  if (metodo === "yape" || metodo === "plin") {
    const fileInput =
      form.querySelector('input[name="comprobante"]') || postQrComprobante;
    if (!fileInput?.files?.[0]) return false;
  }
  return true;
}

function buildPaymentFormDataForSubmit() {
  const fd = new FormData();
  const nombre = form.querySelector('[name="nombre"]');
  const email = form.querySelector('[name="email"]');
  const telefono = form.querySelector('[name="telefono"]');
  const metodo = form.querySelector('input[name="metodo"]:checked');
  const creditos = form.querySelector('input[name="creditos"]:checked');
  const fileInput =
    form.querySelector('input[name="comprobante"]') || postQrComprobante;
  fd.append("nombre", nombre?.value ?? "");
  fd.append("email", email?.value ?? "");
  fd.append("telefono", telefono?.value ?? "");
  fd.append("metodo", metodo?.value ?? "");
  fd.append("creditos", creditos?.value ?? "");
  fd.append("referencia", postQrReferencia?.value ?? "");
  const file = fileInput?.files?.[0];
  if (file) {
    fd.append("comprobante", file, file.name);
  }
  return fd;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.hidden = true;

  const metodo =
    form.querySelector('input[name="metodo"]:checked')?.value ??
    new FormData(form).get("metodo") ??
    "";
  const creditosVal = creditosFromForm();
  const bodyJson = {
    nombre: form.querySelector('[name="nombre"]')?.value ?? "",
    email: form.querySelector('[name="email"]')?.value ?? "",
    telefono: form.querySelector('[name="telefono"]')?.value ?? "",
    metodo,
    creditos: creditosVal,
  };

  if (currentStep === 3) {
    if (!isStep3CompleteForPayment(metodo)) {
      showMessage("Adjunta el comprobante (imagen o PDF) para registrar el pago.", false);
      postQrComprobante?.focus();
      return;
    }
    if ((metodo === "yape" || metodo === "plin") && !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        body: buildPaymentFormDataForSubmit(),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.error || "No se pudo guardar el registro", false);
        return;
      }
      sessionStorage.removeItem(QR_ACK_KEY);
      form.reset();
      setStep(1);
      const regToken = data.registro_token ? String(data.registro_token) : "";
      if (regToken) {
        persistPaymentToken(regToken);
        showPendingStatusUI(regToken);
      }
      syncSubmitButtons();
    } catch {
      showMessage("Error de conexión. Intenta de nuevo.", false);
    } finally {
      setLoading(false);
    }
    return;
  }

  if (currentStep === 1) {
    if (!isStep1Valid()) {
      form.reportValidity();
      return;
    }
    setStep(2);
    return;
  }

  // Paso 2
  if (!isStep2Valid()) {
    form.reportValidity();
    return;
  }

  if (
    (metodo === "yape" || metodo === "plin") &&
    sessionStorage.getItem(QR_ACK_KEY) === metodo
  ) {
    setStep(3);
    return;
  }

  if (metodo === "yape" || metodo === "plin") {
    await loadQrModalForYapePlin(metodo);
    return;
  }

  if (metodo === "mercadopago") {
    setLoading(true);
    try {
      const res = await fetch("/api/payments/mercadopago/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: bodyJson.nombre,
          email: bodyJson.email,
          telefono: bodyJson.telefono,
          creditos: Number(bodyJson.creditos),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.error || "No se pudo iniciar Mercado Pago", false);
        return;
      }
      if (data.init_point) {
        if (data.registro_token) {
          persistPaymentToken(String(data.registro_token));
        }
        window.location.href = data.init_point;
        return;
      }
      showMessage("Respuesta inválida del servidor.", false);
    } catch {
      showMessage("Error de conexión. Intenta de nuevo.", false);
    } finally {
      setLoading(false);
    }
  }
});

Promise.allSettled([initPaymentStatusFromUrl(), loadPackagePrices()]).finally(() => {
  renderCreditosPrices();
  renderPaymentMethods();
  if (paymentFlowCard && !paymentFlowCard.hidden) {
    setStep(1);
  }
});
