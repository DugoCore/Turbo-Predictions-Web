const loginSection = document.getElementById("login-section");
const panelSection = document.getElementById("panel-section");
const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-msg");
const tableContainer = document.getElementById("table-container");
const logoutBtn = document.getElementById("logout-btn");
const viewPagos = document.getElementById("admin-view-pagos");
const viewPrecios = document.getElementById("admin-view-precios");
const viewQr = document.getElementById("admin-view-qr");
const navItems = document.querySelectorAll(".admin-nav-item");
const sidebarToggle = document.getElementById("admin-sidebar-toggle");
const sidebarToggleText = panelSection?.querySelector(".admin-sidebar-toggle-text");
const pricesForm = document.getElementById("admin-prices-form");
const pricesMsg = document.getElementById("admin-prices-msg");
const packageRows = document.getElementById("admin-package-rows");
const addPackageBtn = document.getElementById("admin-add-package-btn");
const methodVisibleYape = document.getElementById("method-visible-yape");
const methodVisiblePlin = document.getElementById("method-visible-plin");
const methodVisibleMercadoPago = document.getElementById("method-visible-mercadopago");

const ADMIN_SIDEBAR_COLLAPSED_KEY = "tp_admin_sidebar_collapsed";

function applySidebarCollapsed(collapsed) {
  if (!panelSection) return;
  panelSection.classList.toggle("sidebar-collapsed", collapsed);
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.setAttribute(
      "aria-label",
      collapsed ? "Mostrar menú lateral (Pagos y QR)" : "Ocultar menú lateral"
    );
  }
  if (sidebarToggleText) {
    sidebarToggleText.textContent = collapsed ? "Mostrar menú" : "Ocultar menú";
  }
}

const methodLabels = {
  yape: "Yape",
  plin: "Plin",
  mercadopago: "Mercado Pago",
};

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const normalized = String(iso).includes("T") ? iso : String(iso).replace(" ", "T");
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("es-PE", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

function pathWithoutQuery(p) {
  return String(p || "").split("?")[0];
}

function comprobanteCellHtml(path) {
  if (!path) return "—";
  const safe = escapeHtml(path);
  const base = pathWithoutQuery(path).toLowerCase();
  if (/\.pdf$/i.test(base)) {
    return `<button type="button" class="comprobante-open comprobante-pdf-badge" data-url="${safe}" data-kind="pdf">PDF</button>`;
  }
  if (/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(base)) {
    return `<button type="button" class="comprobante-open" data-url="${safe}" data-kind="image" title="Ver tamaño completo"><img src="${safe}" alt="" class="comprobante-thumb" loading="lazy" width="72" height="54" /></button>`;
  }
  return `<a href="${safe}" target="_blank" rel="noopener noreferrer">Abrir</a>`;
}

function openComprobanteModal(url, kind) {
  const modal = document.getElementById("comprobante-modal");
  const body = document.getElementById("comprobante-modal-body");
  if (!modal || !body) return;
  body.replaceChildren();
  if (kind === "pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.className = "comprobante-iframe";
    iframe.title = "Comprobante PDF";
    body.appendChild(iframe);
  } else {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Comprobante";
    img.className = "comprobante-modal-img";
    body.appendChild(img);
  }
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeComprobanteModal() {
  const modal = document.getElementById("comprobante-modal");
  const body = document.getElementById("comprobante-modal-body");
  if (!modal || !body) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  body.replaceChildren();
}

async function checkSession() {
  const res = await fetch("/api/admin/me", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return data.admin === true;
}

function showLogin() {
  loginSection.hidden = false;
  panelSection.hidden = true;
}

function setAdminView(name) {
  if (viewPagos) viewPagos.classList.toggle("is-active", name === "pagos");
  if (viewPrecios) viewPrecios.classList.toggle("is-active", name === "precios");
  if (viewQr) viewQr.classList.toggle("is-active", name === "qr");
  navItems.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
}

function showPanel() {
  loginSection.hidden = true;
  panelSection.hidden = false;
  setAdminView("pagos");
  try {
    applySidebarCollapsed(localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_KEY) === "1");
  } catch {
    applySidebarCollapsed(false);
  }
}

sidebarToggle?.addEventListener("click", () => {
  const next = !panelSection.classList.contains("sidebar-collapsed");
  applySidebarCollapsed(next);
  try {
    localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
});

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    if (v === "pagos" || v === "precios" || v === "qr") setAdminView(v);
  });
});

function setPricesMessage(text, ok) {
  if (!pricesMsg) return;
  pricesMsg.hidden = false;
  pricesMsg.textContent = text;
  pricesMsg.className = `message ${ok ? "success" : "error"}`;
}

function packageRowHtml(index, credits = "", price = "") {
  const removable = index > 0;
  return `<div class="admin-package-row" data-row-index="${index}">
    <label class="field">
      <span>Créditos</span>
      <input type="number" data-role="credits" min="1" step="1" required value="${escapeHtml(
        String(credits)
      )}" />
    </label>
    <label class="field">
      <span>Precio (S/)</span>
      <input type="number" data-role="price" min="0.01" step="0.01" required value="${escapeHtml(
        String(price)
      )}" />
    </label>
    <button type="button" class="btn ghost admin-package-remove" data-role="remove-package" ${
      removable
        ? 'aria-label="Quitar paquete"'
        : "disabled title='Debe existir al menos un paquete' aria-label='No se puede quitar el único paquete'"
    }>
      <svg class="admin-package-remove-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  </div>`;
}

function renderPackageRows(options) {
  if (!packageRows) return;
  const rows = Array.isArray(options) && options.length ? options : [{ credits: 50, price: 30 }];
  packageRows.innerHTML = rows
    .map((row, i) => packageRowHtml(i, row?.credits ?? "", row?.price ?? ""))
    .join("");
}

function readPackageRows() {
  if (!packageRows) return [];
  const rows = Array.from(packageRows.querySelectorAll(".admin-package-row"));
  return rows.map((row) => ({
    credits: Number(row.querySelector('[data-role="credits"]')?.value),
    price: Number(row.querySelector('[data-role="price"]')?.value),
  }));
}

function readPaymentMethods() {
  return {
    yape: Boolean(methodVisibleYape?.checked),
    plin: Boolean(methodVisiblePlin?.checked),
    mercadopago: Boolean(methodVisibleMercadoPago?.checked),
  };
}

function applyPaymentMethods(methods) {
  const src = methods && typeof methods === "object" ? methods : {};
  if (methodVisibleYape) methodVisibleYape.checked = src.yape !== false;
  if (methodVisiblePlin) methodVisiblePlin.checked = src.plin !== false;
  if (methodVisibleMercadoPago) methodVisibleMercadoPago.checked = src.mercadopago !== false;
}

async function loadAdminPrices() {
  try {
    const res = await fetch("/api/admin/prices", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.status === 401) {
      showLogin();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPricesMessage(data.error || "No se pudieron cargar los precios.", false);
      return;
    }
    const options = data.packageOptions || data.packagePrices || [];
    renderPackageRows(options);
    applyPaymentMethods(data.paymentMethods);
  } catch {
    setPricesMessage("Error de conexión al cargar los precios.", false);
  }
}

pricesForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  pricesMsg.hidden = true;
  const payload = {
    packageOptions: readPackageRows(),
    paymentMethods: readPaymentMethods(),
  };
  if (!payload.paymentMethods.yape && !payload.paymentMethods.plin && !payload.paymentMethods.mercadopago) {
    setPricesMessage("Debes dejar al menos un método de pago visible.", false);
    return;
  }
  try {
    const res = await fetch("/api/admin/prices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPricesMessage(data.error || "No se pudieron guardar los precios.", false);
      return;
    }
    renderPackageRows(data.packageOptions || data.packagePrices || payload.packageOptions);
    applyPaymentMethods(data.paymentMethods || payload.paymentMethods);
    setPricesMessage("Precios guardados correctamente.", true);
  } catch {
    setPricesMessage("Error de conexión al guardar los precios.", false);
  }
});

addPackageBtn?.addEventListener("click", () => {
  const current = readPackageRows();
  current.push({ credits: "", price: "" });
  renderPackageRows(current);
});

packageRows?.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-role="remove-package"]');
  if (!btn) return;
  const current = readPackageRows();
  const row = btn.closest(".admin-package-row");
  const idx = Number(row?.getAttribute("data-row-index"));
  if (!Number.isFinite(idx)) return;
  const next = current.filter((_, i) => i !== idx);
  renderPackageRows(next.length ? next : [{ credits: 50, price: 30 }]);
});

async function loadPayments() {
  tableContainer.innerHTML = '<p class="empty">Cargando…</p>';
  try {
    const res = await fetch("/api/payments", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.status === 401) {
      showLogin();
      tableContainer.innerHTML = "";
      return;
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        payload && typeof payload === "object" && payload.error
          ? String(payload.error)
          : "No se pudieron cargar los pagos.";
      tableContainer.innerHTML = `<p class="empty message error">${escapeHtml(msg)}</p>`;
      return;
    }
    if (!Array.isArray(payload)) {
      tableContainer.innerHTML =
        '<p class="empty message error">Respuesta inválida del servidor.</p>';
      return;
    }
    const rows = payload;

    if (!rows.length) {
      tableContainer.innerHTML = '<p class="empty">No hay pagos registrados aún.</p>';
      return;
    }

  const thead = `<thead><tr>
    <th>ID</th><th>Token</th><th>Fecha</th><th>Nombre</th><th>Email</th><th>Teléfono</th>
    <th>Créditos</th><th>Monto (S/)</th>
    <th>Método</th><th>Referencia</th><th>Comprobante</th><th class="verify-th">Verificado</th><th>Acciones</th>
  </tr></thead>`;

  const tbody = rows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(String(r.id))}</td>
      <td><code class="token-cell">${escapeHtml(r.voucher_code || "—")}</code></td>
      <td>${escapeHtml(formatDate(r.created_at))}</td>
      <td>${escapeHtml(r.nombre)}</td>
      <td>${escapeHtml(r.email)}</td>
      <td>${escapeHtml(r.telefono)}</td>
      <td>${escapeHtml(r.creditos != null ? String(r.creditos) : "—")}</td>
      <td>${escapeHtml(r.monto != null ? String(r.monto) : "—")}</td>
      <td><span class="badge ${escapeHtml(r.metodo)}">${escapeHtml(methodLabels[r.metodo] || r.metodo)}</span></td>
      <td>${escapeHtml(r.referencia || "—")}</td>
      <td class="comprobante-td">${comprobanteCellHtml(r.comprobante_path)}</td>
      <td class="verify-td">${verifyCellHtml(r)}</td>
      <td class="acciones-td">
        <button type="button" class="btn btn-delete-payment" data-id="${escapeHtml(String(r.id))}" aria-label="Eliminar pago">
          <svg class="btn-delete-payment-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </td>
    </tr>`
    )
    .join("");

    tableContainer.innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
  } catch {
    tableContainer.innerHTML =
      '<p class="empty message error">Error de conexión al cargar los pagos.</p>';
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

const SVG_VERIFY_CHECK =
  '<svg class="verify-pick-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const SVG_VERIFY_X =
  '<svg class="verify-pick-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const SVG_CELL_CHECK =
  '<svg class="verify-cell-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const SVG_CELL_X =
  '<svg class="verify-cell-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

function verifyCellHtml(r) {
  const id = escapeHtml(String(r.id));
  const verified = Boolean(r.verificado);
  const rejected = Boolean(r.verificacion_rechazada) && !verified;

  if (verified) {
    return `<div class="verify-cell verify-cell--ok" role="status">
      <span class="verify-cell-inner">
        ${SVG_CELL_CHECK}
        <span>Verificado</span>
      </span>
    </div>`;
  }
  if (rejected) {
    return `<div class="verify-cell verify-cell--bad" role="status">
      <span class="verify-cell-inner">
        ${SVG_CELL_X}
        <span>No verificado</span>
      </span>
      <button type="button" class="btn-verify-reset" data-action="verify-reset" data-id="${id}">Cambiar</button>
    </div>`;
  }
  return `<div class="verify-cell verify-cell--pending" data-verify-id="${id}">
    <button type="button" class="btn btn-verify btn-verify--neutral" data-action="verify-open" data-id="${id}">Verificar</button>
    <span class="verify-choice" data-role="verify-choice">
      <button type="button" class="btn-verify-pick btn-verify-pick--yes" data-action="verify-yes" data-id="${id}" aria-label="Confirmar verificación">${SVG_VERIFY_CHECK}</button>
      <button type="button" class="btn-verify-pick btn-verify-pick--no" data-action="verify-no" data-id="${id}" aria-label="Rechazar verificación">${SVG_VERIFY_X}</button>
    </span>
  </div>`;
}

function closeAllVerifyChoices() {
  document.querySelectorAll(".verify-cell--choosing").forEach((el) => {
    el.classList.remove("verify-cell--choosing");
    const choice = el.querySelector('[data-role="verify-choice"]');
    if (choice) choice.hidden = true;
    const openBtn = el.querySelector('[data-action="verify-open"]');
    if (openBtn) openBtn.hidden = false;
  });
}

function setQrPreview(metodo, url) {
  const el = document.getElementById(`qr-preview-${metodo}`);
  if (!el) return;
  el.textContent = "";
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = `QR ${metodo}`;
    el.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.className = "empty";
    span.textContent = "Sin imagen";
    el.appendChild(span);
  }
}

async function loadQrPreviews() {
  try {
    const res = await fetch("/api/payment-qr", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return;
    const urls = await res.json();
    setQrPreview("yape", urls.yape || null);
    setQrPreview("plin", urls.plin || null);
  } catch {
    /* ignore */
  }
}

async function uploadQr(metodo) {
  const input = document.getElementById(`qr-file-${metodo}`);
  const msgEl = document.getElementById(`qr-msg-${metodo}`);
  const file = input?.files?.[0];
  msgEl.hidden = true;
  if (!file) {
    msgEl.textContent = "Selecciona un archivo de imagen.";
    msgEl.className = "message error";
    msgEl.hidden = false;
    return;
  }
  const fd = new FormData();
  fd.append("metodo", metodo);
  fd.append("file", file);
  const res = await fetch("/api/admin/upload-qr", {
    method: "POST",
    body: fd,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    msgEl.textContent = data.error || "No se pudo subir el archivo";
    msgEl.className = "message error";
    msgEl.hidden = false;
    return;
  }
  msgEl.textContent = "Imagen guardada correctamente.";
  msgEl.className = "message success";
  msgEl.hidden = false;
  input.value = "";
  if (data.url) setQrPreview(metodo, data.url);
}

document.getElementById("qr-upload-yape")?.addEventListener("click", () => uploadQr("yape"));
document.getElementById("qr-upload-plin")?.addEventListener("click", () => uploadQr("plin"));

tableContainer.addEventListener("click", (e) => {
  const verifyOpen = e.target.closest('[data-action="verify-open"]');
  if (verifyOpen) {
    e.stopPropagation();
    const cell = verifyOpen.closest(".verify-cell--pending");
    document.querySelectorAll(".verify-cell--choosing").forEach((c) => {
      if (c !== cell) c.classList.remove("verify-cell--choosing");
    });
    cell?.classList.add("verify-cell--choosing");
    return;
  }

  const verifyYes = e.target.closest('[data-action="verify-yes"]');
  if (verifyYes) {
    e.stopPropagation();
    const id = verifyYes.getAttribute("data-id");
    if (!id) return;
    verifyYes.disabled = true;
    (async () => {
      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(id)}/verificado`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ verificado: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || "No se pudo actualizar");
          return;
        }
        closeAllVerifyChoices();
        await loadPayments();
      } catch {
        alert("Error de conexión");
      } finally {
        verifyYes.disabled = false;
      }
    })();
    return;
  }

  const verifyNo = e.target.closest('[data-action="verify-no"]');
  if (verifyNo) {
    e.stopPropagation();
    const id = verifyNo.getAttribute("data-id");
    if (!id) return;
    verifyNo.disabled = true;
    (async () => {
      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(id)}/verificado`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ verificado: false, rechazado: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || "No se pudo actualizar");
          return;
        }
        closeAllVerifyChoices();
        await loadPayments();
      } catch {
        alert("Error de conexión");
      } finally {
        verifyNo.disabled = false;
      }
    })();
    return;
  }

  const verifyReset = e.target.closest('[data-action="verify-reset"]');
  if (verifyReset) {
    e.stopPropagation();
    const id = verifyReset.getAttribute("data-id");
    if (!id) return;
    verifyReset.disabled = true;
    (async () => {
      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(id)}/verificado`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ verificado: false, rechazado: false }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || "No se pudo actualizar");
          return;
        }
        await loadPayments();
      } catch {
        alert("Error de conexión");
      } finally {
        verifyReset.disabled = false;
      }
    })();
    return;
  }

  const delBtn = e.target.closest(".btn-delete-payment");
  if (delBtn) {
    const id = delBtn.getAttribute("data-id");
    if (!id) return;
    if (
      !confirm(
        "¿Eliminar este registro de pago? Esta acción no se puede deshacer."
      )
    ) {
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || "No se pudo eliminar");
          return;
        }
        await loadPayments();
      } catch {
        alert("Error de conexión");
      }
    })();
    return;
  }

  const btn = e.target.closest(".comprobante-open");
  if (!btn) return;
  e.preventDefault();
  const url = btn.getAttribute("data-url");
  const kind = btn.getAttribute("data-kind");
  if (url) openComprobanteModal(url, kind || "image");
});

document.addEventListener("click", (e) => {
  if (
    e.target.closest(
      '[data-action="verify-open"], [data-action="verify-yes"], [data-action="verify-no"], [data-action="verify-reset"]'
    )
  ) {
    return;
  }
  if (e.target.closest(".verify-cell--choosing")) return;
  closeAllVerifyChoices();
});

document.getElementById("comprobante-modal-close")?.addEventListener("click", closeComprobanteModal);
document.getElementById("comprobante-modal-backdrop")?.addEventListener("click", closeComprobanteModal);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeAllVerifyChoices();
  const modal = document.getElementById("comprobante-modal");
  if (modal?.classList.contains("is-open")) closeComprobanteModal();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.hidden = true;
  const fd = new FormData(loginForm);
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ password: fd.get("password") }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    loginMsg.textContent = data.error || "Error al iniciar sesión";
    loginMsg.hidden = false;
    return;
  }
  loginForm.reset();
  showPanel();
  await loadPayments();
  await loadAdminPrices();
  await loadQrPreviews();
});

logoutBtn?.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Error al cerrar sesión");
    }
    showLogin();
    tableContainer.innerHTML = "";
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "No se pudo cerrar sesión. Revisa la conexión.";
    alert(msg);
  }
});

(async function init() {
  try {
    const ok = await checkSession();
    if (ok) {
      showPanel();
      await loadPayments();
      await loadAdminPrices();
      await loadQrPreviews();
    } else {
      showLogin();
      tableContainer.innerHTML = "";
    }
  } catch {
    showLogin();
    tableContainer.innerHTML = "";
  }
})();
