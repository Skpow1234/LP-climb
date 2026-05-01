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

  var PRESETS = {
    readme: { id: "readme", label: "README", width: 900, height: 260 },
    "readme-wide": { id: "readme-wide", label: "README (wide)", width: 1100, height: 280 },
    "readme-compact": { id: "readme-compact", label: "README (compact)", width: 720, height: 200 },
    profile: { id: "profile", label: "Profile card", width: 600, height: 240 },
    banner: { id: "banner", label: "Banner", width: 1200, height: 300 },
    badge: { id: "badge", label: "Badge", width: 500, height: 180 }
  };

  // Human-facing presentation for every error code the API (and the demo
  // itself) can surface. `title` is the panel headline, `hint` is an
  // actionable one-liner, and `retryable` drives whether a "Retry" primary
  // button actually makes sense — for validation errors it does not, for
  // transient upstream errors it always does.
  //
  // Any unknown code falls through to the generic entry at the bottom.
  var ERROR_PRESENTATIONS = {
    // From @lp-climb/github-contrib — forwarded as `{error: "USER_NOT_FOUND", …}`
    USER_NOT_FOUND: {
      title: "GitHub user not found",
      hint: "Check the spelling. Logins are case-insensitive but the account must exist.",
      retryable: false
    },
    INVALID_USERNAME: {
      title: "Invalid GitHub username",
      hint: "Usernames must be 1–39 characters: letters, numbers, or dashes. No leading/trailing/consecutive dashes.",
      retryable: false
    },
    BAD_CREDENTIALS: {
      title: "API auth configuration",
      hint: "The hosted API's GitHub token was rejected. This is a server-side issue — please report it.",
      retryable: false
    },
    FORBIDDEN: {
      title: "GitHub rejected the request",
      hint: "The API's token lacks the required permissions. Retrying won't help.",
      retryable: false
    },
    RATE_LIMITED: {
      title: "GitHub is rate-limiting us",
      hint: "Too many GitHub GraphQL calls in the last window. Try again in a few minutes.",
      retryable: true
    },
    UPSTREAM_TIMEOUT: {
      title: "GitHub timed out",
      hint: "The GitHub GraphQL call took too long. Usually transient — retry in a moment.",
      retryable: true
    },
    UPSTREAM_ERROR: {
      title: "GitHub returned an error",
      hint: "Upstream hiccup. Usually transient — retry in a moment.",
      retryable: true
    },
    UPSTREAM_BAD_RESPONSE: {
      title: "Unexpected response from GitHub",
      hint: "GitHub returned a shape we don't understand. Please retry; report if it persists.",
      retryable: true
    },

    // From Fastify / the server's own error handler
    bad_request: {
      title: "Invalid request",
      hint: "One of the query parameters (user / vs / width / height / theme) didn't validate. Correct and retry.",
      retryable: false
    },
    internal_error: {
      title: "Server error",
      hint: "Something broke on our side — not your fault. Retry; if it persists, open an issue on GitHub.",
      retryable: true
    },

    // Demo-local synthetic codes for transport-level failures
    NETWORK_ERROR: {
      title: "Couldn't reach the API",
      hint: "The browser couldn't connect. Check your connection, or the API's base URL in the top bar.",
      retryable: true
    },
    CORS_ERROR: {
      title: "Blocked by CORS",
      hint: "The API denied the browser request for this origin. Configure CORS_ALLOW_ORIGINS on the API.",
      retryable: false
    },
    TIMEOUT: {
      title: "Request timed out",
      hint: "The API didn't respond within 25 seconds. First-load against a cold Render service usually takes ~20s — retry once.",
      retryable: true
    }
  };

  // Generic fallback for any code we don't have a canned presentation for.
  function genericPresentation(httpStatus) {
    var statusBand = Math.floor((httpStatus || 0) / 100);
    if (statusBand === 4) {
      return {
        title: "Request rejected",
        hint: "The API refused this request. Double-check the query and retry.",
        retryable: false
      };
    }
    if (statusBand === 5) {
      return {
        title: "Upstream error",
        hint: "Something's off upstream. Usually transient — retry in a moment.",
        retryable: true
      };
    }
    return {
      title: "Render failed",
      hint: "Open the raw response to see what the API returned.",
      retryable: true
    };
  }

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

  function setActivePreviewTab(tab) {
    var tabs = document.querySelectorAll(".previewTab[data-tab]");
    Array.prototype.forEach.call(tabs, function (b) {
      var on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", String(on));
    });
    var panels = [
      { id: "panelPreview", tab: "preview" },
      { id: "panelUrl", tab: "url" },
      { id: "panelMeta", tab: "meta" }
    ];
    panels.forEach(function (p) {
      var el = qs(p.id);
      if (!el) return;
      if (p.tab === tab) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
  }

  function wirePreviewTabs() {
    var tabs = document.querySelectorAll(".previewTab[data-tab]");
    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener("click", function () {
        setActivePreviewTab(b.dataset.tab || "preview");
      });
    });
    setActivePreviewTab("preview");
  }

  function setUrlPanels(previewUrl, exportUrl, metaUrl) {
    var p = qs("previewUrlPre");
    var e = qs("exportUrlPre");
    var m = qs("metaUrlPre");
    if (p) p.textContent = String(previewUrl || "");
    if (e) e.textContent = String(exportUrl || "");
    if (m) m.textContent = String(metaUrl || "");
  }

  function wireUrlTabCopyButtons() {
    var cp = qs("copyPreviewUrlBtn");
    if (cp) {
      cp.addEventListener("click", function () {
        copyText(String((qs("previewUrlPre") && qs("previewUrlPre").textContent) || "").trim(), cp);
      });
    }
    var ce = qs("copyExportUrlBtn");
    if (ce) {
      ce.addEventListener("click", function () {
        copyText(String((qs("exportUrlPre") && qs("exportUrlPre").textContent) || "").trim(), ce);
      });
    }
  }

  function setStyle(style) {
    state.style = style === "ladder" ? "ladder" : "card";
    var pills = document.querySelectorAll(".pill[data-style]");
    Array.prototype.forEach.call(pills, function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.style === state.style));
    });
    qs("renderBtn").textContent = state.style === "ladder" ? "Render ladder" : "Render card";
  }

  function setTheme(themeId) {
    if (!themeId) return;
    var okTheme = THEMES.some(function (t) {
      return t.id === themeId;
    });
    if (!okTheme) return;
    state.theme = themeId;
    syncThemeChips();
  }

  function setPreset(presetId) {
    if (!presetId) return;
    var p = getPreset(presetId);
    if (!p) return;
    state.preset = presetId;
    var el = qs("preset");
    if (el) el.value = presetId;
    if (qs("width")) qs("width").value = String(p.width);
    if (qs("height")) qs("height").value = String(p.height);
  }

  function setFormats(previewFmt, exportFmt) {
    state.previewFormat = previewFmt || "svg";
    state.exportFormat = exportFmt || "svg";
    var p = qs("previewFormat");
    var e = qs("exportFormat");
    if (p) p.value = state.previewFormat;
    if (e) e.value = state.exportFormat;
  }

  function clearTeamVs() {
    if (qs("vs")) qs("vs").value = "";
    if (qs("team")) qs("team").value = "";
  }

  function setExample(kind) {
    // Always start from a clean slate for the ladder compare/team fields.
    clearTeamVs();
    // Clear encoding knobs unless example sets them.
    if (qs("quality")) qs("quality").value = "";
    if (qs("frames")) qs("frames").value = "";
    if (qs("fps")) qs("fps").value = "";

    // Reasonable defaults.
    if (qs("user") && !String(qs("user").value || "").trim()) qs("user").value = "Skpow1234";
    setTheme("rift");

    switch (kind) {
      case "profile":
        setStyle("card");
        setPreset("profile");
        setFormats("svg", "svg");
        break;
      case "ladder-1v1":
        setStyle("ladder");
        setPreset("readme");
        if (qs("vs")) qs("vs").value = "torvalds";
        setFormats("svg", "webp");
        if (qs("quality")) qs("quality").value = "82";
        break;
      case "team-banner":
        setStyle("ladder");
        setPreset("banner");
        if (qs("team")) qs("team").value = "torvalds,gaearon,sindresorhus";
        setFormats("svg", "png");
        break;
      case "gif":
        setStyle("ladder");
        setPreset("readme-wide");
        if (qs("vs")) qs("vs").value = "torvalds";
        setFormats("svg", "gif");
        if (qs("frames")) qs("frames").value = "24";
        if (qs("fps")) qs("fps").value = "12";
        break;
      default:
        return;
    }

    syncAdvancedControls();
    syncDemoPageUrl({ immediate: true });
    update();
  }

  function wireExamples() {
    var btns = document.querySelectorAll("button.exampleBtn[data-example]");
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        setExample(b.dataset.example);
      });
    });
  }

  function wireQuickUserSelect() {
    var sel = qs("userQuick");
    if (!sel) return;
    sel.addEventListener("change", function () {
      var v = String(sel.value || "").trim();
      if (!v) return;
      if (qs("user")) qs("user").value = v;
      sel.value = "";
      syncDemoPageUrl({ immediate: true });
      update();
    });
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
    theme: "rift",
    previewFormat: "svg",
    exportFormat: "svg",
    preset: "readme"
  };

  // Request lifecycle:
  //   - `inflight`: AbortController for the in-flight fetch. We abort before
  //     starting a new one so rapid input changes don't queue N concurrent
  //     renders (and the last one wins).
  //   - `lastObjectUrl`: blob URL used to populate <img src=…>. Revoked when
  //     we swap in a new one to avoid leaking memory on long sessions.
  //   - `lastFailedRequest`: captures the URL / error info used by the
  //     "Retry" / "Copy URL" buttons in the error panel.
  var inflight = null;
  var lastObjectUrl = null;
  var lastFailedRequest = null;

  // Fetch timeout. First cold request on a free-tier Render service can take
  // ~20 s (container cold start). 25 s gives that a bit of headroom before
  // we surface a retryable TIMEOUT.
  var FETCH_TIMEOUT_MS = 25000;

  function renderPathForFormat(format) {
    return "/v1/render." + String(format || "svg");
  }

  function acceptHeaderForFormat(format) {
    switch (format) {
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "avif":
        return "image/avif";
      case "gif":
        return "image/gif";
      default:
        return "image/svg+xml";
    }
  }

  function getPreset(id) {
    return PRESETS[id] || null;
  }

  function normalizeMaybeNumber(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseTeamList(raw) {
    var s = String(raw || "").trim();
    if (!s) return [];
    return s
      .split(",")
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
  }

  function syncAdvancedControls() {
    var isLadder = state.style === "ladder";
    var exportFormat = state.exportFormat || "svg";
    var previewFormat = state.previewFormat || "svg";

    var ladderBlock = qs("ladderOnlyBlock");
    if (ladderBlock) {
      if (isLadder) ladderBlock.removeAttribute("hidden");
      else ladderBlock.setAttribute("hidden", "");
    }

    var exportQualityRow = qs("exportQualityRow");
    var showQuality = exportFormat === "webp" || exportFormat === "avif";
    if (exportQualityRow) {
      if (showQuality) exportQualityRow.removeAttribute("hidden");
      else exportQualityRow.setAttribute("hidden", "");
    }

    var gifTimingRow = qs("gifTimingRow");
    var gifOn = previewFormat === "gif" || exportFormat === "gif";
    if (gifTimingRow) {
      if (gifOn) gifTimingRow.removeAttribute("hidden");
      else gifTimingRow.setAttribute("hidden", "");
    }

    var hintRasterDims = qs("hintRasterDims");
    var rasterPreview = previewFormat !== "svg";
    var rasterExport = exportFormat !== "svg";
    if (hintRasterDims) {
      if (rasterPreview || rasterExport) hintRasterDims.removeAttribute("hidden");
      else hintRasterDims.setAttribute("hidden", "");
    }

    var hintAvifEncode = qs("hintAvifEncode");
    if (hintAvifEncode) {
      if (exportFormat === "avif") hintAvifEncode.removeAttribute("hidden");
      else hintAvifEncode.setAttribute("hidden", "");
    }

    var hintWebpQuality = qs("hintWebpQuality");
    if (hintWebpQuality) {
      if (exportFormat === "webp") hintWebpQuality.removeAttribute("hidden");
      else hintWebpQuality.setAttribute("hidden", "");
    }

    var hintGifCost = qs("hintGifCost");
    if (hintGifCost) {
      if (gifOn) hintGifCost.removeAttribute("hidden");
      else hintGifCost.setAttribute("hidden", "");
    }

    var vs = qs("vs");
    var team = qs("team");
    if (vs) {
      vs.disabled = !isLadder;
      vs.placeholder = isLadder ? "torvalds" : "switch to Ladder to use vs";
    }
    if (team) {
      team.disabled = !isLadder;
      team.placeholder = isLadder ? "torvalds,gaearon,sindresorhus" : "switch to Ladder to use team";
    }

    var quality = qs("quality");
    if (quality) {
      quality.disabled = !showQuality;
      quality.placeholder = quality.disabled ? "(export WebP/AVIF)" : "1–100";
    }

    var frames = qs("frames");
    var fps = qs("fps");
    if (frames) frames.disabled = !gifOn;
    if (fps) fps.disabled = !gifOn;
  }

  function setStatus(text, isError) {
    var el = qs("status");
    if (!el) return;
    el.textContent = String(text || "");
    el.classList.toggle("err", !!isError);
  }

  function previewMetaSetPending(message) {
    var el = qs("previewMeta");
    if (!el) return;
    el.classList.add("previewMeta--pending");
    el.classList.remove("previewMeta--err");
    el.textContent = String(message || "Awaiting preview response…");
  }

  function previewMetaSetNote(message, isError) {
    var el = qs("previewMeta");
    if (!el) return;
    el.classList.add("previewMeta--pending");
    el.classList.toggle("previewMeta--err", !!isError);
    el.textContent = String(message || "");
  }

  function staleLabelFromXCache(xc) {
    var x = String(xc || "").toLowerCase();
    if (x === "stale") return "yes (stale-while-revalidate)";
    if (x === "hit") return "no (fresh cache hit)";
    if (x === "miss") return "no (miss / regenerated)";
    return "—";
  }

  function renderPreviewMetaFromResponse(res, durationMs) {
    var el = qs("previewMeta");
    if (!el || !res) return;
    el.classList.remove("previewMeta--pending");
    el.classList.toggle("previewMeta--err", !res.ok);

    var xCache = (res.headers.get("x-cache") || "").trim() || "—";
    var reqId = (res.headers.get("x-request-id") || "").trim() || "—";
    var stale = staleLabelFromXCache(xCache);

    var lines = [
      "HTTP " + res.status,
      "Duration (until response headers): " + durationMs + " ms",
      "X-Cache: " + xCache,
      "Served stale: " + stale,
      "X-Request-Id: " + reqId
    ];

    var rlRem = res.headers.get("ratelimit-remaining");
    var rlLim = res.headers.get("ratelimit-limit");
    if (rlRem != null || rlLim != null) {
      lines.push(
        "RateLimit: " +
          (rlLim != null && String(rlLim).trim() !== "" ? String(rlLim).trim() : "?") +
          " (remaining " +
          (rlRem != null && String(rlRem).trim() !== "" ? String(rlRem).trim() : "?") +
          ")"
      );
    }

    el.textContent = lines.join("\n");
  }

  function setStateBadge(kind, text) {
    var el = qs("stateBadge");
    if (!el) return;
    el.className = "badge " + (kind || "");
    el.textContent = text;
  }

  function setPreviewState(kind) {
    var frame = qs("previewFrame");
    if (!frame) return;
    frame.dataset.state = kind;
    if (kind === "loading") frame.setAttribute("aria-busy", "true");
    else frame.removeAttribute("aria-busy");
    if (kind === "ok" || kind === "error") setPreviewLoadingDetail("");
  }

  function setPreviewBackground(bg) {
    var frame = qs("previewFrame");
    if (!frame) return;
    frame.dataset.bg = String(bg || "grid");
  }

  var zoom = {
    scale: 1
  };

  function setZoomScale(scale) {
    var s = Number(scale);
    if (!Number.isFinite(s)) return;
    s = Math.max(0.25, Math.min(4, s));
    zoom.scale = s;

    var inner = qs("previewInner");
    if (inner) inner.style.transform = "scale(" + String(s) + ")";

    var readout = qs("zoomReadout");
    if (readout) readout.textContent = Math.round(s * 100) + "%";
  }

  function zoomBy(delta) {
    setZoomScale(zoom.scale + delta);
  }

  function fitPreviewToFrame() {
    var frame = qs("previewFrame");
    var img = qs("preview");
    if (!frame || !img) return;

    var pad = 18 * 2; // matches .previewFrame padding
    var availW = Math.max(1, frame.clientWidth - pad);
    var availH = Math.max(1, frame.clientHeight - pad);

    // Use natural size when available; fall back to rendered size.
    var iw = img.naturalWidth || img.width || img.getBoundingClientRect().width || 1;
    var ih = img.naturalHeight || img.height || img.getBoundingClientRect().height || 1;

    var s = Math.min(availW / iw, availH / ih);
    // Keep fit sane; allow upscaling a bit but not absurd.
    s = Math.max(0.25, Math.min(2, s));
    setZoomScale(s);
  }

  function wirePreviewZoom() {
    var zi = qs("zoomInBtn");
    var zo = qs("zoomOutBtn");
    var zr = qs("zoomResetBtn");
    var zf = qs("zoomFitBtn");
    if (zi) zi.addEventListener("click", function () { zoomBy(0.1); });
    if (zo) zo.addEventListener("click", function () { zoomBy(-0.1); });
    if (zr) zr.addEventListener("click", function () { setZoomScale(1); });
    if (zf) zf.addEventListener("click", function () { fitPreviewToFrame(); });

    // Default at 100%.
    setZoomScale(1);

    // When the image finishes loading, try to keep "fit" reasonably correct
    // if the user previously clicked fit (heuristic: scale != 1 and <= 2).
    var img = qs("preview");
    if (img) {
      img.addEventListener("load", function () {
        // If user hasn't touched zoom, keep 100%. Otherwise don't override.
        // (We only auto-fit when scale is very close to a previous fit.)
        if (Math.abs(zoom.scale - 1) < 0.001) return;
      });
    }
  }

  function wirePreviewBackground() {
    var sel = qs("previewBg");
    if (!sel) return;
    setPreviewBackground(sel.value || "grid");
    sel.addEventListener("change", function () {
      setPreviewBackground(sel.value || "grid");
    });
  }

  function setPreviewLoadingDetail(text) {
    var el = qs("previewLoadingDetail");
    if (el) el.textContent = String(text || "");
  }

  function clearErrorPanel() {
    var panel = qs("errorPanel");
    if (panel) panel.hidden = true;
    lastFailedRequest = null;
  }

  function showErrorPanel(info) {
    // info: { code, title?, message, hint?, url, status?, rawBody? }
    var panel = qs("errorPanel");
    if (!panel) return;

    var preset = ERROR_PRESENTATIONS[info.code] || genericPresentation(info.status);
    var title = info.title || preset.title;
    var hint = info.hint || preset.hint;

    qs("errorTitle").textContent = title;
    qs("errorMessage").textContent = info.message || "No additional message.";

    var httpChip = qs("errorHttpChip");
    if (typeof info.status === "number" && info.status > 0) {
      httpChip.textContent = "HTTP " + info.status;
      httpChip.hidden = false;
    } else {
      httpChip.hidden = true;
    }

    var codeChip = qs("errorCodeChip");
    if (info.code) {
      codeChip.textContent = info.code;
      codeChip.hidden = false;
    } else {
      codeChip.hidden = true;
    }

    var hintEl = qs("errorHint");
    if (hint) {
      hintEl.textContent = hint;
      hintEl.hidden = false;
    } else {
      hintEl.hidden = true;
    }

    qs("openRaw").href = info.url;
    qs("errorUrlPre").textContent =
      "GET " + info.url + (info.rawBody ? "\n\n" + info.rawBody : "");

    var retryBtn = qs("retryBtn");
    // Disable retry for definitely-non-transient errors (validation, not found,
    // auth). Keep it enabled for everything else — even for CORS, where the
    // user can fix the API base URL and retry.
    retryBtn.disabled = preset.retryable === false;
    retryBtn.title = preset.retryable === false ? "Not retryable — fix the input first" : "Rerun the request";

    panel.hidden = false;
    setPreviewState("error");
    setStateBadge("err", "Failed");

    lastFailedRequest = info;
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
        var team = qs("team");
        // Card mode is primary-only; drop any previously-entered opponent so
        // the embed URL + status stay in sync with the visible form state.
        if (state.style !== "ladder") {
          vs.value = "";
          if (team) team.value = "";
        }
        qs("renderBtn").textContent = state.style === "ladder" ? "Render ladder" : "Render card";
        syncAdvancedControls();
        update();
      });
    });
  }

  function wireFormatSelects() {
    var preview = qs("previewFormat");
    var exportEl = qs("exportFormat");
    if (preview) {
      preview.addEventListener("change", function () {
        state.previewFormat = preview.value || "svg";
        syncAdvancedControls();
        update();
      });
    }
    if (exportEl) {
      exportEl.addEventListener("change", function () {
        state.exportFormat = exportEl.value || "svg";
        syncAdvancedControls();
        update();
      });
    }
  }

  function wirePresetSelect() {
    var preset = qs("preset");
    if (!preset) return;
    preset.addEventListener("change", function () {
      state.preset = preset.value || "";
      var selected = getPreset(state.preset);
      if (selected) {
        qs("width").value = String(selected.width);
        qs("height").value = String(selected.height);
      }
      update();
    });
  }

  function buildCommonQuery() {
    var sp = new URLSearchParams();
    var user = qs("user").value.trim();
    var width = qs("width").value.trim();
    var height = qs("height").value.trim();
    var preset = state.preset || "";
    var selectedPreset = getPreset(preset);

    sp.set("user", user);
    sp.set("style", state.style);
    sp.set("theme", state.theme);
    if (preset) sp.set("preset", preset);
    if (width && (!selectedPreset || Number(width) !== selectedPreset.width)) sp.set("width", width);
    if (height && (!selectedPreset || Number(height) !== selectedPreset.height)) sp.set("height", height);

    // Compare/team only applies to the ladder. The API rejects `vs` + `team`
    // together, so we enforce mutual exclusion here and keep the embed URL clean.
    if (state.style === "ladder") {
      var vs = qs("vs").value.trim();
      var teamList = parseTeamList(qs("team").value);

      if (vs && teamList.length) {
        // Prefer team if the user typed multiple values.
        if (teamList.length > 1) {
          qs("vs").value = "";
          vs = "";
        } else {
          qs("team").value = "";
          teamList = [];
        }
      }

      if (vs) sp.set("vs", vs);
      if (teamList.length) sp.set("team", teamList.join(","));
    }

    // Theme overrides (optional). Keys mirror OpenAPI: bg/frame/text/accent/glow.
    ["bg", "frame", "text", "accent", "glow"].forEach(function (key) {
      var el = qs(key);
      if (!el) return;
      var v = String(el.value || "").trim();
      if (v) sp.set(key, v);
    });

    return sp;
  }

  function buildFormatQuery(common, format) {
    var sp = new URLSearchParams(common.toString());

    if (format === "webp" || format === "avif") {
      var q = normalizeMaybeNumber(qs("quality").value);
      if (q != null) sp.set("quality", String(Math.round(q)));
    }
    if (format === "gif") {
      var frames = normalizeMaybeNumber(qs("frames").value);
      var fps = normalizeMaybeNumber(qs("fps").value);
      if (frames != null) sp.set("frames", String(Math.round(frames)));
      if (fps != null) sp.set("fps", String(Math.round(fps)));
    }

    return sp;
  }

  // Demo page URL ↔ form sync (`?user=…&preview=webp&export=avif` …). Uses
  // `history.replaceState` so shares/debug links don't spam the back stack.
  var DEMO_PAGE_FORMAT_KEYS = ["svg", "png", "webp", "avif", "gif"];
  var urlSyncDebounceTimer = null;

  function normalizeDemoFormat(v, fallback) {
    var s = String(v || "").toLowerCase();
    return DEMO_PAGE_FORMAT_KEYS.indexOf(s) >= 0 ? s : fallback;
  }

  function buildDemoPageSearchParams() {
    var common = buildCommonQuery();
    var out = new URLSearchParams(common.toString());
    var previewFormat = state.previewFormat || "svg";
    var exportFormat = state.exportFormat || "svg";
    if (previewFormat !== "svg") out.set("preview", previewFormat);
    if (exportFormat !== "svg") out.set("export", exportFormat);

    var q = normalizeMaybeNumber(qs("quality").value);
    if (q != null) out.set("quality", String(Math.round(q)));
    var frames = normalizeMaybeNumber(qs("frames").value);
    var fps = normalizeMaybeNumber(qs("fps").value);
    if (frames != null) out.set("frames", String(Math.round(frames)));
    if (fps != null) out.set("fps", String(Math.round(fps)));

    if (state.style === "card") out.delete("style");
    if (state.theme === "rift") out.delete("theme");
    if (state.preset === "readme") out.delete("preset");
    if (previewFormat === "svg") out.delete("preview");
    if (exportFormat === "svg") out.delete("export");

    if (!String(out.get("user") || "").trim()) out.delete("user");

    return out;
  }

  function syncDemoPageUrl(opts) {
    var immediate = opts && opts.immediate;
    var run = function () {
      urlSyncDebounceTimer = null;
      var sp = buildDemoPageSearchParams();
      var next = sp.toString();
      var cur = String(window.location.search || "").replace(/^\?/, "");
      if (next === cur) return;
      var url = window.location.pathname + (next ? "?" + next : "") + window.location.hash;
      try {
        history.replaceState(null, "", url);
      } catch (_) {}
    };

    if (immediate) {
      if (urlSyncDebounceTimer) clearTimeout(urlSyncDebounceTimer);
      urlSyncDebounceTimer = null;
      run();
      return;
    }
    if (urlSyncDebounceTimer) clearTimeout(urlSyncDebounceTimer);
    urlSyncDebounceTimer = setTimeout(run, 380);
  }

  function applyDemoPageFromSearch(sp) {
    if (!sp || typeof sp.get !== "function") return;

    var u = sp.get("user");
    if (u != null && qs("user")) qs("user").value = u;

    var st = sp.get("style");
    if (st === "ladder" || st === "card") {
      state.style = st;
      var pills = document.querySelectorAll(".pill[data-style]");
      Array.prototype.forEach.call(pills, function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.style === state.style));
      });
    }

    var th = sp.get("theme");
    if (th) {
      var okTheme = THEMES.some(function (t) {
        return t.id === th;
      });
      if (okTheme) state.theme = th;
    }

    var pr = sp.get("preset");
    if (pr && getPreset(pr)) {
      state.preset = pr;
      var presetEl = qs("preset");
      if (presetEl) presetEl.value = pr;
      var selected = getPreset(pr);
      if (selected && qs("width") && qs("height")) {
        qs("width").value = String(selected.width);
        qs("height").value = String(selected.height);
      }
    }

    if (sp.get("width") && qs("width")) qs("width").value = sp.get("width");
    if (sp.get("height") && qs("height")) qs("height").value = sp.get("height");

    if (state.style === "ladder") {
      if (sp.get("vs") != null && qs("vs")) qs("vs").value = sp.get("vs");
      if (sp.get("team") != null && qs("team")) qs("team").value = sp.get("team");
    }

    ["quality", "frames", "fps", "bg", "frame", "text", "accent", "glow"].forEach(function (key) {
      var v = sp.get(key);
      var el = qs(key);
      if (el && v != null) el.value = v;
    });

    state.previewFormat = normalizeDemoFormat(sp.get("preview"), "svg");
    state.exportFormat = normalizeDemoFormat(sp.get("export"), "svg");

    var previewSel = qs("previewFormat");
    var exportSel = qs("exportFormat");
    if (previewSel) previewSel.value = state.previewFormat;
    if (exportSel) exportSel.value = state.exportFormat;

    syncThemeChips();
  }

  // Parse a response body into the same shape the API emits on errors.
  // Never throws — falls back to a synthetic shape if the body isn't JSON.
  function parseErrorBody(text) {
    if (!text) return { error: null, message: null };
    try {
      var obj = JSON.parse(text);
      return {
        error: typeof obj.error === "string" ? obj.error : null,
        message: typeof obj.message === "string" ? obj.message : null
      };
    } catch (_) {
      // Upstream returned something non-JSON (HTML 502 page from a proxy, etc.)
      return { error: null, message: text.slice(0, 300) };
    }
  }

  // Front-end validation so we short-circuit the API round-trip on obviously
  // bad inputs. The API would return the same error, but doing it here saves
  // the user the loading spinner + round-trip latency.
  function validateInputs(user, vs) {
    var ghLogin = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
    if (!user) {
      return { ok: false, field: "user", message: "Enter a GitHub username." };
    }
    if (!ghLogin.test(user)) {
      return {
        ok: false,
        field: "user",
        message:
          "'" +
          user +
          "' isn't a valid GitHub login. Usernames are 1–39 chars: letters/digits/dashes, no leading/trailing/consecutive dashes."
      };
    }
    if (vs && !ghLogin.test(vs)) {
      return {
        ok: false,
        field: "vs",
        message:
          "'" +
          vs +
          "' isn't a valid GitHub login. Usernames are 1–39 chars: letters/digits/dashes, no leading/trailing/consecutive dashes."
      };
    }
    if (vs && vs.toLowerCase() === user.toLowerCase()) {
      return {
        ok: false,
        field: "vs",
        message: "`vs` can't be the same login as the primary user."
      };
    }
    return { ok: true };
  }

  async function update() {
    var apiBase = getApiBase();
    var apiBaseLabel = qs("apiBaseLabel");
    if (apiBaseLabel) apiBaseLabel.textContent = apiBase;
    qs("healthLink").href = apiBase + "/v1/healthz";
    var docsLink = qs("docsLink");
    if (docsLink) docsLink.href = apiBase + "/docs";

    var common = buildCommonQuery();
    var user = common.get("user");
    var vs = common.get("vs");
    var previewFormat = state.previewFormat || "svg";
    var exportFormat = state.exportFormat || "svg";

    var previewSp = buildFormatQuery(common, previewFormat);
    var exportSp = buildFormatQuery(common, exportFormat);

    var previewUrlObj = new URL(renderPathForFormat(previewFormat), apiBase);
    previewUrlObj.search = previewSp.toString();
    var exportUrlObj = new URL(renderPathForFormat(exportFormat), apiBase);
    exportUrlObj.search = exportSp.toString();
    var meta = new URL("/v1/meta.json", apiBase);
    var metaParams = new URLSearchParams({ user: user || "" });
    if (vs) metaParams.set("vs", vs);
    var team = common.get("team");
    if (team) metaParams.set("team", team);
    meta.search = metaParams.toString();
    var embedUrl = exportUrlObj.toString();

    // Cache-bust both requests so the preview never gets stuck on a prior
    // error response (e.g. a 404 while the user fixes a typo'd username).
    var cacheBust = String(Date.now());
    previewUrlObj.searchParams.set("_t", cacheBust);
    meta.searchParams.set("_t", cacheBust);

    var renderUrl = previewUrlObj.toString();
    var metaUrl = meta.toString();
    var exportUrl = exportUrlObj.toString();

    qs("styleBadge").textContent = state.style.toUpperCase();
    qs("themeBadge").textContent = state.theme;
    qs("formatBadge").textContent = previewFormat.toUpperCase();

    var img = qs("preview");
    img.alt =
      "LP climb " +
      previewFormat +
      " " +
      state.style +
      " for " +
      (user || "—") +
      (vs ? " vs " + vs : "");

    qs("openSvg").href = exportUrl;
    var openPreview = qs("openPreview");
    if (openPreview) openPreview.href = renderUrl;
    qs("openMeta").href = metaUrl;
    qs("embed").textContent = embedUrl;
    if (!getSnippetPanelText()) setSnippetPanel("Image URL", embedUrl);
    setUrlPanels(renderUrl, exportUrl, metaUrl);

    syncDemoPageUrl({ immediate: true });

    // Client-side validation first. Short-circuits the network round-trip
    // for the common case of a typo in the user / vs field.
    var v = validateInputs(user, vs);
    if (!v.ok) {
      setStatus("", false);
      previewMetaSetNote("No request sent — fix the highlighted field first.", true);
      showErrorPanel({
        code: "bad_request",
        title: "Check your inputs",
        message: v.message,
        url: renderUrl,
        status: 0
      });
      // Hint which field to focus.
      try {
        qs(v.field).focus();
        qs(v.field).select();
      } catch (_) {}
      return;
    }

    // Cancel any previous in-flight render so rapid typing doesn't pile up.
    if (inflight) inflight.abort();
    inflight = new AbortController();

    // Enter loading state. The skeleton shows via .previewFrame[data-state=loading].
    clearErrorPanel();
    setPreviewState("loading");
    setStateBadge("loading", "Loading…");
    previewMetaSetPending("Waiting for response headers…");
    var dimW = qs("width") ? String(qs("width").value || "").trim() : "";
    var dimH = qs("height") ? String(qs("height").value || "").trim() : "";
    var loadingDetail =
      (user || "—") +
      " · " +
      state.theme +
      " · " +
      state.style +
      " · preview " +
      previewFormat.toUpperCase() +
      " · export " +
      exportFormat.toUpperCase() +
      (dimW && dimH ? "\n" + dimW + "×" + dimH + " px" : "");
    setPreviewLoadingDetail(loadingDetail);
    setStatus("GET " + renderUrl + "\n\nTip: first request after an API cold start can take ~15–25s.", false);

    toast(
      "info",
      "Rendering",
      (user || "—") +
        (vs ? " vs " + vs : "") +
        " · " +
        state.theme +
        " · " +
        state.style +
        " · " +
        previewFormat.toUpperCase(),
      { ms: 1400 }
    );

    // Timeout guard — AbortController also drives the timeout reason so we
    // can distinguish timeout from user-initiated abort.
    var timedOut = false;
    var timeoutId = setTimeout(function () {
      timedOut = true;
      if (inflight) inflight.abort();
    }, FETCH_TIMEOUT_MS);

    var previewHdrT0 = performance.now();
    var res;
    try {
      res = await fetch(renderUrl, {
        signal: inflight.signal,
        headers: { Accept: acceptHeaderForFormat(previewFormat) }
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // Intentional abort from a newer call — just drop silently.
      if (err && err.name === "AbortError" && !timedOut) return;
      if (timedOut) {
        previewMetaSetNote("No response within " + FETCH_TIMEOUT_MS / 1000 + "s — metadata unavailable.", true);
        showErrorPanel({
          code: "TIMEOUT",
          message: "No response within " + FETCH_TIMEOUT_MS / 1000 + " seconds.",
          url: renderUrl,
          status: 0
        });
        toast("error", "Request timed out", "The API didn't respond. Retry — cold starts can take ~20s.", {
          ms: 9000
        });
        return;
      }
      // fetch() rejects for network / CORS / DNS errors before any HTTP
      // response arrives. We can't tell CORS from net-error from the API
      // surface alone, so surface a generic NETWORK_ERROR and let the user
      // inspect devtools for the actual cause.
      previewMetaSetNote(
        "No HTTP response — X-Cache / X-Request-Id unavailable. If this is a browser demo on a different origin than the API, check CORS and Access-Control-Expose-Headers in DevTools.",
        true
      );
      showErrorPanel({
        code: "NETWORK_ERROR",
        message: String((err && err.message) || err || "Network request failed."),
        url: renderUrl,
        status: 0
      });
      toast("error", "Network error", "Couldn't reach the API. See the preview panel for details.", {
        ms: 9000
      });
      return;
    }
    clearTimeout(timeoutId);

    var previewHdrMs = Math.round(performance.now() - previewHdrT0);
    renderPreviewMetaFromResponse(res, previewHdrMs);

    if (!res.ok) {
      var rawBody = "";
      try {
        rawBody = await res.text();
      } catch (_) {}
      var parsed = parseErrorBody(rawBody);
      var code = parsed.error || "HTTP_" + res.status;
      var apiMessage =
        parsed.message ||
        (rawBody && rawBody.length < 300 ? rawBody : "") ||
        res.statusText ||
        "Request failed.";
      showErrorPanel({
        code: code,
        message: apiMessage,
        url: renderUrl,
        status: res.status,
        rawBody: rawBody && rawBody.length < 2000 ? rawBody : undefined
      });
      toast(
        "error",
        "Render failed (" + res.status + ")",
        (ERROR_PRESENTATIONS[code] && ERROR_PRESENTATIONS[code].title) || apiMessage,
        { ms: 9000 }
      );
      return;
    }

    var contentType = String(res.headers.get("content-type") || "");

    if (previewFormat === "svg") {
      var svgText;
      try {
        svgText = await res.text();
      } catch (err) {
        showErrorPanel({
          code: "NETWORK_ERROR",
          message: "Response body read failed: " + String((err && err.message) || err),
          url: renderUrl,
          status: res.status
        });
        return;
      }

      // Extremely defensive: the API always sets the right content-type, but
      // if a proxy ever turns a 200 SVG into an HTML error page we'd happily
      // <img> it and show a broken icon. Sniff the payload.
      if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(svgText)) {
        showErrorPanel({
          code: "UPSTREAM_BAD_RESPONSE",
          message:
            "The response was 200 OK but didn't start with <svg>. A proxy may have rewritten the body.",
          url: renderUrl,
          status: res.status,
          rawBody: svgText.slice(0, 2000)
        });
        return;
      }

      var svgBlob = new Blob([svgText], { type: "image/svg+xml" });
      var svgObjectUrl = URL.createObjectURL(svgBlob);

      img.onload = function () {
        if (lastObjectUrl && lastObjectUrl !== svgObjectUrl) {
          try {
            URL.revokeObjectURL(lastObjectUrl);
          } catch (_) {}
        }
        lastObjectUrl = svgObjectUrl;
        setPreviewState("ok");
        setStateBadge("ok", "Ready");
        setStatus(
          "Loaded · " +
            previewFormat.toUpperCase() +
            " · " +
            (svgText.length / 1024).toFixed(1) +
            " KB · " +
            renderUrl +
            "\nExport: " +
            exportFormat.toUpperCase() +
            " · " +
            exportUrl,
          false
        );
      };
      img.onerror = function () {
        showErrorPanel({
          code: "UPSTREAM_BAD_RESPONSE",
          message: "The browser rejected the SVG. The payload may be malformed.",
          url: renderUrl,
          status: res.status,
          rawBody: svgText.slice(0, 2000)
        });
      };
      img.src = svgObjectUrl;
      return;
    }

    if (!/^image\//i.test(contentType)) {
      var unexpectedBody = "";
      try {
        unexpectedBody = await res.text();
      } catch (_) {}
      showErrorPanel({
        code: "UPSTREAM_BAD_RESPONSE",
        message: "The API returned 200 OK but not an image payload for " + previewFormat.toUpperCase() + ".",
        url: renderUrl,
        status: res.status,
        rawBody: unexpectedBody.slice(0, 2000)
      });
      return;
    }

    var blob;
    try {
      blob = await res.blob();
    } catch (err) {
      showErrorPanel({
        code: "NETWORK_ERROR",
        message: "Response body read failed: " + String((err && err.message) || err),
        url: renderUrl,
        status: res.status
      });
      return;
    }

    var objectUrl = URL.createObjectURL(blob);

    img.onload = function () {
      if (lastObjectUrl && lastObjectUrl !== objectUrl) {
        try {
          URL.revokeObjectURL(lastObjectUrl);
        } catch (_) {}
      }
      lastObjectUrl = objectUrl;
      setPreviewState("ok");
      setStateBadge("ok", "Ready");
      setStatus(
        "Loaded · " +
          previewFormat.toUpperCase() +
          " · " +
          (blob.size / 1024).toFixed(1) +
          " KB · " +
          renderUrl +
          "\nExport: " +
          exportFormat.toUpperCase() +
          " · " +
          exportUrl,
        false
      );
    };
    img.onerror = function () {
      showErrorPanel({
        code: "UPSTREAM_BAD_RESPONSE",
        message: "The browser rejected the " + previewFormat.toUpperCase() + " image payload.",
        url: renderUrl,
        status: res.status
      });
    };
    img.src = objectUrl;
  }

  function wireCopy() {
    var btn = qs("copyBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      copyText(qs("embed").textContent || "", btn);
    });
  }

  function getEmbedImageUrl() {
    return String(qs("embed").textContent || "").trim();
  }

  function escapeHtmlAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/'/g, "&#39;");
  }

  function embedAltText() {
    var common = buildCommonQuery();
    var user = common.get("user") || "user";
    var parts = ["LP Climb", state.style, "for", user];
    if (common.get("vs")) parts.push("vs " + common.get("vs"));
    if (common.get("team")) parts.push("team " + common.get("team"));
    return parts.join(" ");
  }

  function buildMarkdownImgSnippet() {
    var url = getEmbedImageUrl();
    if (!url) return "";
    var alt = embedAltText().replace(/\]/g, "\\]");
    return "![" + alt + "](" + url + ")";
  }

  function swapRenderExtension(absoluteUrl, ext) {
    var u = new URL(absoluteUrl);
    u.pathname = u.pathname.replace(/(\/v1\/render)\.[a-z0-9]+$/i, "$1." + ext);
    return u.toString();
  }

  function buildPictureSnippet() {
    var url = getEmbedImageUrl();
    if (!url) return "";
    var u = new URL(url);
    var m = u.pathname.match(/\.([a-z0-9]+)$/i);
    var fmt = m ? m[1].toLowerCase() : "svg";
    var alt = escapeHtmlAttr(embedAltText());
    var w = String(qs("width").value || "").trim();
    var h = String(qs("height").value || "").trim();
    var wh = w && h ? ' width="' + escapeHtmlAttr(w) + '" height="' + escapeHtmlAttr(h) + '"' : "";

    if (fmt === "svg" || fmt === "gif") {
      return (
        '<img src="' +
        escapeHtmlAttr(url) +
        '" alt="' +
        alt +
        '"' +
        wh +
        ' decoding="async" />'
      );
    }

    var avif = swapRenderExtension(url, "avif");
    var webp = swapRenderExtension(url, "webp");
    var png = swapRenderExtension(url, "png");
    return (
      "<picture>\n" +
      '  <source srcset="' +
      escapeHtmlAttr(avif) +
      '" type="image/avif" />\n' +
      '  <source srcset="' +
      escapeHtmlAttr(webp) +
      '" type="image/webp" />\n' +
      '  <img src="' +
      escapeHtmlAttr(png) +
      '" alt="' +
      alt +
      '"' +
      wh +
      ' decoding="async" />\n' +
      "</picture>"
    );
  }

  function buildMetaJsonUrl() {
    var apiBase = getApiBase();
    var common = buildCommonQuery();
    var mp = new URLSearchParams({ user: common.get("user") || "" });
    if (common.get("vs")) mp.set("vs", common.get("vs"));
    if (common.get("team")) mp.set("team", common.get("team"));
    var u = new URL("/v1/meta.json", apiBase);
    u.search = mp.toString();
    return u.toString();
  }

  function setSnippetPanel(title, text) {
    var pre = qs("snippetPre");
    var t = qs("snippetTitle");
    if (t) t.textContent = title || "Generated snippet";
    if (pre) pre.textContent = String(text || "");
  }

  function getSnippetPanelText() {
    var pre = qs("snippetPre");
    return String((pre && pre.textContent) || "").trim();
  }

  function wireSnippetCopy() {
    var btn = qs("copySnippetBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var text = getSnippetPanelText();
      if (!text) {
        toast("error", "Nothing to copy", "Generate a snippet first (or render to populate the embed URL).");
        return;
      }
      copyText(text, btn);
    });
  }

  function wireCopyAs() {
    var bind = function (id, getText) {
      var b = qs(id);
      if (!b) return;
      b.addEventListener("click", function () {
        var text = getText();
        if (!text) {
          toast("error", "Nothing to copy", "Run a successful render first so the embed URL is filled in.");
          return;
        }
        var title = "Generated snippet";
        if (id === "copyAsImageUrl") title = "Image URL";
        if (id === "copyAsMarkdown") title = "Markdown <img>";
        if (id === "copyAsPicture") title = "<picture> snippet";
        if (id === "copyAsMetaJson") title = "Meta JSON URL";
        setSnippetPanel(title, text);
        copyText(text, b);
      });
    };
    bind("copyAsImageUrl", getEmbedImageUrl);
    bind("copyAsMarkdown", buildMarkdownImgSnippet);
    bind("copyAsPicture", buildPictureSnippet);
    bind("copyAsMetaJson", buildMetaJsonUrl);
  }

  function copyText(url, btn) {
    if (!url) return;
    var done = function () {
      if (!btn) return;
      var prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () {
        btn.textContent = prev;
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(done)
        .catch(function () {
          toast("error", "Copy failed", "Clipboard access denied.");
        });
      return;
    }
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

  function wireErrorPanel() {
    var retry = qs("retryBtn");
    if (retry) {
      retry.addEventListener("click", function () {
        update();
      });
    }
    var copy = qs("copyErrorUrl");
    if (copy) {
      copy.addEventListener("click", function () {
        var url = lastFailedRequest ? lastFailedRequest.url : qs("embed").textContent || "";
        copyText(url, copy);
      });
    }
  }

  function init() {
    setPreviewState("loading");
    renderThemeChips();
    try {
      applyDemoPageFromSearch(new URLSearchParams(window.location.search));
    } catch (_) {}

    wireStylePills();
    wirePreviewTabs();
    wirePreviewBackground();
    wirePreviewZoom();
    wireExamples();
    wireQuickUserSelect();
    wireFormatSelects();
    wirePresetSelect();
    wireCopy();
    wireCopyAs();
    wireSnippetCopy();
    wireUrlTabCopyButtons();
    wireErrorPanel();

    ["user", "vs", "team", "width", "height", "quality", "frames", "fps", "bg", "frame", "text", "accent", "glow"].forEach(
      function (id) {
      var el = qs(id);
      if (!el) return;
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") update();
      });
      el.addEventListener("input", function () {
        syncDemoPageUrl({ immediate: false });
      });
      el.addEventListener("change", update);
    });

    qs("renderBtn").addEventListener("click", update);
    syncAdvancedControls();

    window.addEventListener("popstate", function () {
      try {
        applyDemoPageFromSearch(new URLSearchParams(window.location.search));
      } catch (_) {}
      syncAdvancedControls();
      update();
    });

    update();
  }

  init();
})();
