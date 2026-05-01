import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const demoRoot = path.resolve(__dirname, "..");

async function setupDom(opts?: {
  apiBase?: string;
  fetchSvgText?: string;
  fetchOk?: boolean;
  fetchStatus?: number;
  xCache?: string;
  reqId?: string;
}) {
  let indexHtml = await readFile(path.join(demoRoot, "public", "index.html"), "utf8");
  const appJs = await readFile(path.join(demoRoot, "public", "app.js"), "utf8");

  // Strip external script tags so jsdom doesn't attempt network loads.
  indexHtml = indexHtml
    .replace(/<script\s+src="\.\/config\.js"><\/script>/i, "")
    .replace(/<script\s+src="\.\/app\.js"><\/script>/i, "");

  const dom = new JSDOM(indexHtml, {
    url: "http://localhost:5173/",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true
  });

  const { window } = dom;
  (window as any).LP_CLIMB_DEMO = { apiBase: opts?.apiBase ?? "http://example.test" };

  const clipboardWrites: string[] = [];
  (window.navigator as any).clipboard = {
    writeText: (txt: string) => {
      clipboardWrites.push(String(txt));
      return Promise.resolve();
    }
  };

  const svgText = opts?.fetchSvgText ?? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
  const ok = opts?.fetchOk ?? true;
  const status = opts?.fetchStatus ?? (ok ? 200 : 400);
  const headers: Record<string, string> = {
    "content-type": "image/svg+xml",
    "x-cache": opts?.xCache ?? "hit",
    "x-request-id": opts?.reqId ?? "req_test_123"
  };

  (window as any).fetch = vi.fn(async () => {
    return new window.Response(ok ? svgText : JSON.stringify({ error: "bad_request", message: "nope" }), {
      status,
      headers
    });
  });

  // Execute app.js in the page context.
  const scriptEl = window.document.createElement("script");
  scriptEl.textContent = appJs;
  window.document.body.appendChild(scriptEl);

  // Let initial tasks run.
  await new Promise((r) => setTimeout(r, 0));

  return { dom, window, clipboardWrites };
}

async function waitFor(cond: () => boolean, ms = 500) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timeout");
}

describe("demo UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds preview (cache-busted) vs export URLs distinctly", async () => {
    const { window } = await setupDom();

    await waitFor(() => String(window.document.getElementById("exportUrlPre")?.textContent || "").includes("/v1/render."));
    const previewUrl = String(window.document.getElementById("previewUrlPre")?.textContent || "");
    const exportUrl = String(window.document.getElementById("exportUrlPre")?.textContent || "");
    expect(previewUrl).toContain("/v1/render.");
    expect(previewUrl).toContain("_t=");
    expect(exportUrl).toContain("/v1/render.");
    expect(exportUrl).not.toContain("_t=");
  });

  it("hides ladder-only inputs in card mode, shows in ladder mode", async () => {
    const { window } = await setupDom();

    const ladderBlock = window.document.getElementById("ladderOnlyBlock")!;
    // Default is card.
    expect(ladderBlock.hasAttribute("hidden")).toBe(true);

    const ladderPill = window.document.querySelector<HTMLButtonElement>('.pill[data-style="ladder"]')!;
    ladderPill.click();
    await waitFor(() => ladderBlock.hasAttribute("hidden") === false);

    expect(ladderBlock.hasAttribute("hidden")).toBe(false);
  });

  it("short-circuits validation without sending a request when user is empty", async () => {
    const { window } = await setupDom();

    const user = window.document.getElementById("user") as HTMLInputElement;
    user.value = "";

    const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    const renderBtn = window.document.getElementById("renderBtn") as HTMLButtonElement;
    renderBtn.click();
    await waitFor(() => String(window.document.getElementById("previewMeta")?.textContent || "").includes("No request sent"));

    expect(fetchMock).toHaveBeenCalledTimes(0);

    const meta = String(window.document.getElementById("previewMeta")?.textContent || "");
    expect(meta).toContain("No request sent");
  });

  it("generates Markdown and picture snippets from the export URL and copies them", async () => {
    const { window, clipboardWrites } = await setupDom();

    await waitFor(() => String(window.document.getElementById("embed")?.textContent || "").includes("/v1/render."));
    // Ensure export format is webp so picture snippet includes <picture>.
    const exportSel = window.document.getElementById("exportFormat") as HTMLSelectElement;
    exportSel.value = "webp";
    exportSel.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitFor(() => String(window.document.getElementById("embed")?.textContent || "").includes("/v1/render.webp"));

    const mdBtn = window.document.getElementById("copyAsMarkdown") as HTMLButtonElement;
    mdBtn.click();
    await waitFor(() => clipboardWrites.length > 0);
    expect(clipboardWrites.at(-1) || "").toMatch(/^!\[.*\]\(.*\/v1\/render\./);

    const picBtn = window.document.getElementById("copyAsPicture") as HTMLButtonElement;
    picBtn.click();
    await waitFor(() => (clipboardWrites.at(-1) || "").includes("<picture>"));
    const last = clipboardWrites.at(-1) || "";
    expect(last).toContain("<picture>");
    expect(last).toContain('type="image/avif"');
    expect(last).toContain('type="image/webp"');
  });
});

