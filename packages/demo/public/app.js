(function () {
  "use strict";

  // Accent swatches mirror packages/themes/src/index.ts so the chips read as
  // a live preview of each theme's accent color. Kept inline so the demo has
  // zero build-time dependency on the themes package.
  var THEMES = [
    { id: "rift", label: "Rift", accent: "#2AE98C" },
    { id: "assassin", label: "Assassin", accent: "#8E3BFF" },
    { id: "mage", label: "Mage", accent: "#2FE6FF" },
    { id: "tank", label: "Tank", accent: "#51D26B" },
    { id: "support", label: "Support", accent: "#6CE1FF" },
    { id: "marksman", label: "Marksman", accent: "#FFB74A" },
    { id: "mono", label: "Mono", accent: "#FFFFFF" }
  ];

  function qs(id) {
    return document.getElementById(id);
  }

  function toast(type, title, body, opts) {
    var wrap = qs("toasts");
    if (!wrap) return;

    var o = opts || {};
    var ms = typeof o.ms === "number" ? o.ms : type === "error" ? 8000 : 3200;

    var el = document.createElement("div");
    el.className = "toast " + (type || "info");
    el.innerHTML =
      '<div class="toastRow">' +
      '  <div class="toastTitle"></div>' +
      '  <button class="toastClose" aria-label="Dismiss">×</button>' +
      "</div>" +
      '<div class="toastBody"></div>';
    el.querySelector(".toastTitle").textContent = String(title || "");
    el.querySelector(".toastBody").textContent = String(body || "");

    var close = function () {
      el.remove();
    };
    el.querySelector(".toastClose").addEventListener("click", close);

    wrap.appendChild(el);
    if (ms > 0) setTimeout(close, ms);
  }

  function getApiBase() {
    var cfg = (window.LP_CLIMB_DEMO && window.LP_CLIMB_DEMO.apiBase) || "";
    return String(cfg || "http://localhost:3000").replace(/\/+$/, "");
  }

  // UI state — kept in a plain object so the render function is a pure
  // function of `(inputs, state) -> URLs`. This keeps the "which style is
  // selected" decision in exactly one place.
  var state = {
    style: "card",
    theme: "rift"
  };

  function setStatus(text, isError) {
    var el = qs("status");
    if (!el) return;
    el.textContent = String(text || "");
    el.classList.toggle("err", !!isError);
  }

  function setStateBadge(kind, text) {
    var el = qs("stateBadge");
    if (!el) return;
    el.className = "badge " + (kind || "");
    el.textContent = text;
  }

  function renderThemeChips() {
    var host = qs("themeChips");
    if (!host) return;
    host.innerHTML = "";
    THEMES.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.dataset.theme = t.id;
      btn.setAttribute("aria-pressed", String(t.id === state.theme));
      btn.innerHTML =
        '<span class="swatch" style="background:' +
        t.accent +
        ";color:" +
        t.accent +
        '"></span><span>' +
        t.label +
        "</span>";
      btn.addEventListener("click", function () {
        state.theme = t.id;
        syncThemeChips();
        update();
      });
      host.appendChild(btn);
    });
  }

  function syncThemeChips() {
    var host = qs("themeChips");
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll(".chip"), function (el) {
      el.setAttribute("aria-pressed", String(el.dataset.theme === state.theme));
    });
  }

  function wireStylePills() {
    var pills = document.querySelectorAll(".pill[data-style]");
    Array.prototype.forEach.call(pills, function (btn) {
      btn.addEventListener("click", function () {
        state.style = btn.dataset.style;
        Array.prototype.forEach.call(pills, function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        var vs = qs("vs");
        vs.disabled = state.style !== "ladder";
        vs.placeholder = state.style === "ladder" ? "torvalds" : "switch to Ladder to use vs";
        qs("renderBtn").textContent = state.style === "ladder" ? "Render ladder" : "Render card";
        update();
      });
    });
  }

  function buildQuery() {
    var sp = new URLSearchParams();
    var user = qs("user").value.trim();
    var width = qs("width").value.trim();
    var height = qs("height").value.trim();

    sp.set("user", user);
    sp.set("style", state.style);
    sp.set("theme", state.theme);
    if (width) sp.set("width", width);
    if (height) sp.set("height", height);

    // `vs` only applies to the ladder — silently ignored server-side when in
    // card mode, but we also skip it here so the embed URL stays clean.
    if (state.style === "ladder") {
      var vs = qs("vs").value.trim();
      if (vs) sp.set("vs", vs);
    }

    return sp;
  }

  function update() {
    var apiBase = getApiBase();
    qs("apiBaseLabel").textContent = apiBase;
    qs("healthLink").href = apiBase + "/v1/healthz";

    var sp = buildQuery();
    var svg = new URL("/v1/render.svg", apiBase);
    svg.search = sp.toString();

    var meta = new URL("/v1/meta.json", apiBase);
    var metaParams = new URLSearchParams({ user: sp.get("user") });
    if (sp.get("vs")) metaParams.set("vs", sp.get("vs"));
    meta.search = metaParams.toString();

    // Cache-bust both requests so the preview never gets stuck on a prior
    // error response (e.g. a 404 while the user fixes a typo'd username).
    var cacheBust = String(Date.now());
    svg.searchParams.set("_t", cacheBust);
    meta.searchParams.set("_t", cacheBust);

    var svgUrl = svg.toString();
    var metaUrl = meta.toString();

    qs("styleBadge").textContent = state.style.toUpperCase();
    qs("themeBadge").textContent = state.theme;

    var img = qs("preview");
    var user = sp.get("user");
    var vs = sp.get("vs");
    img.alt =
      "LP climb " +
      state.style +
      " for " +
      user +
      (vs ? " vs " + vs : "");

    setStateBadge("loading", "Loading…");
    setStatus("Loading SVG…\n" + svgUrl, false);

    toast(
      "info",
      "Rendering",
      user + (vs ? " vs " + vs : "") + " · " + state.theme + " · " + state.style,
      { ms: 1400 }
    );

    img.onload = function () {
      setStateBadge("ok", "Ready");
      setStatus("Loaded.\n" + svgUrl, false);
    };
    img.onerror = function () {
      setStateBadge("err", "Failed");
      setStatus(
        'Failed to load SVG.\n\nTry "Open SVG" to see the API error response.\n\n' + svgUrl,
        true
      );
      toast("error", "Render failed", 'Click "Open SVG" to see the API error response.', {
        ms: 9000
      });
    };

    img.src = svgUrl;
    qs("openSvg").href = svgUrl;
    qs("openMeta").href = metaUrl;
    qs("embed").textContent = svgUrl;
  }

  function wireCopy() {
    var btn = qs("copyBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var url = qs("embed").textContent || "";
      if (!url) return;
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () {
          btn.textContent = prev;
        }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(function () {
          toast("error", "Copy failed", "Clipboard access denied.");
        });
      } else {
        // Fallback for older browsers / non-secure contexts where the async
        // Clipboard API isn't available.
        var ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          done();
        } catch (_) {
          toast("error", "Copy failed", "Select the URL manually and copy.");
        }
        document.body.removeChild(ta);
      }
    });
  }

  function init() {
    renderThemeChips();
    wireStylePills();
    wireCopy();

    ["user", "vs", "width", "height"].forEach(function (id) {
      var el = qs(id);
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") update();
      });
      el.addEventListener("change", update);
    });

    qs("renderBtn").addEventListener("click", update);
    qs("vs").disabled = state.style !== "ladder";
    qs("vs").placeholder = "switch to Ladder to use vs";

    update();
  }

  init();
})();
