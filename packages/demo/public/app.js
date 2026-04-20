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

  function setPreviewState(kind) {
    var frame = qs("previewFrame");
    if (frame) frame.dataset.state = kind;
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
        // Card mode is primary-only; drop any previously-entered opponent so
        // the embed URL + status stay in sync with the visible form state.
        if (state.style !== "ladder") vs.value = "";
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

    var sp = buildQuery();
    var user = sp.get("user");
    var vs = sp.get("vs");

    var svg = new URL("/v1/render.svg", apiBase);
    svg.search = sp.toString();
    var meta = new URL("/v1/meta.json", apiBase);
    var metaParams = new URLSearchParams({ user: user || "" });
    if (vs) metaParams.set("vs", vs);
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
    img.alt =
      "LP climb " + state.style + " for " + (user || "—") + (vs ? " vs " + vs : "");

    qs("openSvg").href = svgUrl;
    qs("openMeta").href = metaUrl;
    qs("embed").textContent = svgUrl;

    // Client-side validation first. Short-circuits the network round-trip
    // for the common case of a typo in the user / vs field.
    var v = validateInputs(user, vs);
    if (!v.ok) {
      setStatus("", false);
      showErrorPanel({
        code: "bad_request",
        title: "Check your inputs",
        message: v.message,
        url: svgUrl,
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
    setStatus("GET " + svgUrl, false);

    toast(
      "info",
      "Rendering",
      (user || "—") + (vs ? " vs " + vs : "") + " · " + state.theme + " · " + state.style,
      { ms: 1400 }
    );

    // Timeout guard — AbortController also drives the timeout reason so we
    // can distinguish timeout from user-initiated abort.
    var timedOut = false;
    var timeoutId = setTimeout(function () {
      timedOut = true;
      if (inflight) inflight.abort();
    }, FETCH_TIMEOUT_MS);

    var res;
    try {
      res = await fetch(svgUrl, {
        signal: inflight.signal,
        headers: { Accept: "image/svg+xml" }
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // Intentional abort from a newer call — just drop silently.
      if (err && err.name === "AbortError" && !timedOut) return;
      if (timedOut) {
        showErrorPanel({
          code: "TIMEOUT",
          message: "No response within " + FETCH_TIMEOUT_MS / 1000 + " seconds.",
          url: svgUrl,
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
      showErrorPanel({
        code: "NETWORK_ERROR",
        message: String((err && err.message) || err || "Network request failed."),
        url: svgUrl,
        status: 0
      });
      toast("error", "Network error", "Couldn't reach the API. See the preview panel for details.", {
        ms: 9000
      });
      return;
    }
    clearTimeout(timeoutId);

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
        url: svgUrl,
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

    // Success: materialize the SVG text as a blob URL so <img> displays it
    // without a second network round-trip, then swap in.
    var svgText;
    try {
      svgText = await res.text();
    } catch (err) {
      showErrorPanel({
        code: "NETWORK_ERROR",
        message: "Response body read failed: " + String((err && err.message) || err),
        url: svgUrl,
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
        url: svgUrl,
        status: res.status,
        rawBody: svgText.slice(0, 2000)
      });
      return;
    }

    var blob = new Blob([svgText], { type: "image/svg+xml" });
    var objectUrl = URL.createObjectURL(blob);

    img.onload = function () {
      // Revoke the *previous* object URL now that the new one has painted.
      // Doing it in onload (not before img.src=…) avoids a flash of broken
      // image on slow devices.
      if (lastObjectUrl && lastObjectUrl !== objectUrl) {
        try {
          URL.revokeObjectURL(lastObjectUrl);
        } catch (_) {}
      }
      lastObjectUrl = objectUrl;
      setPreviewState("ok");
      setStateBadge("ok", "Ready");
      setStatus("Loaded · " + (svgText.length / 1024).toFixed(1) + " KB · " + svgUrl, false);
    };
    img.onerror = function () {
      // We fetched the bytes successfully and content-sniffed them — if the
      // <img> still refuses to render, the SVG itself is malformed.
      showErrorPanel({
        code: "UPSTREAM_BAD_RESPONSE",
        message: "The browser rejected the SVG. The payload may be malformed.",
        url: svgUrl,
        status: res.status,
        rawBody: svgText.slice(0, 2000)
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
    renderThemeChips();
    wireStylePills();
    wireCopy();
    wireErrorPanel();

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
