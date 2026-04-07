function qs(id) {
  return document.getElementById(id);
}

function toast(type, title, body, opts) {
  const wrap = qs("toasts");
  if (!wrap) return;

  const o = opts || {};
  const ms = typeof o.ms === "number" ? o.ms : type === "error" ? 8000 : 3200;

  const el = document.createElement("div");
  el.className = `toast ${type || "info"}`;
  el.innerHTML = `
    <div class="toastRow">
      <div class="toastTitle"></div>
      <button class="toastClose" aria-label="Dismiss">×</button>
    </div>
    <div class="toastBody"></div>
  `;
  el.querySelector(".toastTitle").textContent = String(title || "");
  el.querySelector(".toastBody").textContent = String(body || "");

  const close = () => {
    el.remove();
  };
  el.querySelector(".toastClose").addEventListener("click", close);

  wrap.appendChild(el);
  if (ms > 0) setTimeout(close, ms);
}

function getApiBase() {
  const cfg = (window.LP_CLIMB_DEMO && window.LP_CLIMB_DEMO.apiBase) || "";
  return String(cfg || "http://localhost:3000").replace(/\/+$/, "");
}

function setStatus(s) {
  const el = qs("status");
  if (!el) return;
  el.textContent = String(s ?? "");
}

function buildQuery() {
  const user = qs("user").value.trim();
  const vs = qs("vs").value.trim();
  const theme = qs("theme").value.trim();
  const width = qs("width").value.trim();
  const height = qs("height").value.trim();

  const sp = new URLSearchParams();
  sp.set("user", user);
  if (vs) sp.set("vs", vs);
  if (theme) sp.set("theme", theme);
  if (width) sp.set("width", width);
  if (height) sp.set("height", height);

  return sp;
}

function update() {
  const apiBase = getApiBase();
  qs("apiBaseLabel").textContent = apiBase;

  const sp = buildQuery();
  const svg = new URL("/v1/render.svg", apiBase);
  svg.search = sp.toString();

  const meta = new URL("/v1/meta.json", apiBase);
  const metaParams = new URLSearchParams({ user: sp.get("user") });
  if (sp.get("vs")) metaParams.set("vs", sp.get("vs"));
  meta.search = metaParams.toString();

  // Bust caches so the preview doesn't get stuck on a previous failed response.
  const cacheBust = String(Date.now());
  svg.searchParams.set("_t", cacheBust);
  meta.searchParams.set("_t", cacheBust);

  const svgUrl = svg.toString();
  const metaUrl = meta.toString();

  const img = qs("preview");
  img.alt = `LP climb ladder for ${sp.get("user")}${sp.get("vs") ? ` vs ${sp.get("vs")}` : ""}`;
  setStatus(`Loading SVG…\n${svgUrl}`);
  toast("info", "Rendering", `${sp.get("user")}${sp.get("vs") ? ` vs ${sp.get("vs")}` : ""} • ${sp.get("theme") || "rift"}`, {
    ms: 1400
  });

  img.onload = () => {
    setStatus(`Loaded.\n${svgUrl}`);
    toast("success", "Rendered", "SVG loaded successfully.");
  };
  img.onerror = () => {
    setStatus(
      `Failed to load SVG.\n\nTry "Open SVG" to see the error response.\n\n${svgUrl}`,
    );
    toast("error", "Render failed", 'Click "Open SVG" to see the API error response.', { ms: 9000 });
  };

  img.src = svgUrl;
  qs("openSvg").href = svgUrl;
  qs("openMeta").href = metaUrl;
  qs("embed").textContent = svgUrl;
}

qs("renderBtn").addEventListener("click", update);

["user", "vs", "theme", "width", "height"].forEach((id) => {
  qs(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") update();
  });
  qs(id).addEventListener("change", update);
});

update();

