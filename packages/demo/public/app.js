function qs(id) {
  return document.getElementById(id);
}

function getApiBase() {
  const cfg = (window.LP_CLIMB_DEMO && window.LP_CLIMB_DEMO.apiBase) || "";
  return String(cfg || "http://localhost:3000").replace(/\/+$/, "");
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

  const svgUrl = svg.toString();
  const metaUrl = meta.toString();

  qs("frame").src = svgUrl;
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

