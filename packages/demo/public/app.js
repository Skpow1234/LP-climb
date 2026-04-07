function qs(id) {
  return document.getElementById(id);
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
  const sp = buildQuery();
  const svgUrl = `/api/render.svg?${sp.toString()}`;
  const metaUrl = `/api/meta.json?${new URLSearchParams({ user: sp.get("user"), ...(sp.get("vs") ? { vs: sp.get("vs") } : {}) }).toString()}`;

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

