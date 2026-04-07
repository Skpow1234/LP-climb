function qs(id) {
  return document.getElementById(id);
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

  img.onload = () => {
    setStatus(`Loaded.\n${svgUrl}`);
  };
  img.onerror = () => {
    setStatus(
      `Failed to load SVG.\n\nTry "Open SVG" to see the error response.\n\n${svgUrl}`,
    );
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

