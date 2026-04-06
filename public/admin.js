const loginSection = document.getElementById("login-section");
const panelSection = document.getElementById("panel-section");
const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-msg");
const tableContainer = document.getElementById("table-container");
const logoutBtn = document.getElementById("logout-btn");
const viewPagos = document.getElementById("admin-view-pagos");
const viewQr = document.getElementById("admin-view-qr");
const navItems = document.querySelectorAll(".admin-nav-item");
const sidebarToggle = document.getElementById("admin-sidebar-toggle");
const sidebarToggleText = panelSection?.querySelector(".admin-sidebar-toggle-text");

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
  const isPagos = name === "pagos";
  if (viewPagos) viewPagos.classList.toggle("is-active", isPagos);
  if (viewQr) viewQr.classList.toggle("is-active", !isPagos);
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
    if (v === "pagos" || v === "qr") setAdminView(v);
  });
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
    <th>ID</th><th>Voucher</th><th>Fecha</th><th>Nombre</th><th>Email</th><th>Teléfono</th>
    <th>Créditos</th><th>Monto (S/)</th>
    <th>Método</th><th>Referencia</th><th>Comprobante</th><th>Verificado</th><th>Acciones</th>
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
      <td class="verify-td">
        <button
          type="button"
          class="btn btn-verify${r.verificado ? " btn-verify--done" : ""}"
          data-id="${escapeHtml(String(r.id))}"
          data-verified="${r.verificado ? "1" : "0"}"
        >
          ${
            r.verificado
              ? `<span class="btn-verify-inner"><svg class="btn-verify-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Verificado</span>`
              : "Verificar"
          }
        </button>
      </td>
      <td class="acciones-td">
        <button type="button" class="btn btn-delete-payment" data-id="${escapeHtml(String(r.id))}">Eliminar</button>
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
  const verifyBtn = e.target.closest(".btn-verify");
  if (verifyBtn) {
    const id = verifyBtn.getAttribute("data-id");
    if (!id) return;
    const wasVerified = verifyBtn.getAttribute("data-verified") === "1";
    const next = !wasVerified;
    verifyBtn.disabled = true;
    (async () => {
      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(id)}/verificado`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ verificado: next }),
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
        verifyBtn.disabled = false;
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

document.getElementById("comprobante-modal-close")?.addEventListener("click", closeComprobanteModal);
document.getElementById("comprobante-modal-backdrop")?.addEventListener("click", closeComprobanteModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("comprobante-modal");
    if (modal?.classList.contains("is-open")) closeComprobanteModal();
  }
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
