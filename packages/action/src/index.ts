import * as fs from "node:fs";
import * as path from "node:path";

import { fetchGithubContributionCells, isGithubContribError } from "@lp-climb/github-contrib";
import { computeStats } from "@lp-climb/core";
import {
  renderRankedClimbAvif,
  renderRankedClimbGif,
  renderRankedClimbPng,
  renderRankedClimbSvg,
  renderRankedClimbWebp
} from "@lp-climb/svg-creator";

import * as githubAction from "./github-action.js";
import type { OutputEntry } from "./outputsOptions.js";
import { parseOutputsOption } from "./outputsOptions.js";

// Small in-memory cache so two outputs referencing the same `vs`/`team`
// login don't refetch the GraphQL contribution grid. Keyed by lowercased
// login since GitHub treats it case-insensitively.
const contribCache = new Map<string, { cells: unknown[]; stats: ReturnType<typeof computeStats> }>();

const loadClimber = async (user: string, githubToken: string) => {
  const key = user.toLowerCase();
  const cached = contribCache.get(key);
  if (cached) return cached;
  const cells = await fetchGithubContributionCells({ user, githubToken });
  const stats = computeStats(cells);
  const entry = { cells: cells as unknown[], stats };
  contribCache.set(key, entry);
  return entry;
};

const renderOne = async (
  out: OutputEntry,
  baseUser: string,
  baseCells: unknown[],
  baseStats: ReturnType<typeof computeStats>,
  githubToken: string
): Promise<Buffer | string> => {
  const style = out.style ?? "card";
  const forwardVs = style === "ladder" && out.vs;
  const forwardTeam = style === "ladder" && out.team && out.team.length > 0;

  const vsData = forwardVs
    ? await (async () => {
        const c = await loadClimber(out.vs!, githubToken);
        return { user: out.vs!, cells: c.cells as any, stats: c.stats };
      })()
    : undefined;

  const teamData = forwardTeam
    ? await Promise.all(
        out
          .team!.filter((t) => t.toLowerCase() !== baseUser.toLowerCase())
          .map(async (t) => {
            const c = await loadClimber(t, githubToken);
            return { user: t, cells: c.cells as any, stats: c.stats };
          })
      )
    : undefined;

  const params = {
    user: baseUser,
    cells: baseCells as any,
    stats: baseStats,
    theme: out.theme,
    style,
    ...(out.width !== undefined ? { width: out.width } : {}),
    ...(out.height !== undefined ? { height: out.height } : {}),
    ...(vsData ? { vs: vsData } : {}),
    ...(teamData && teamData.length > 0 ? { team: teamData } : {})
  };

  switch (out.format) {
    case "svg":
      return renderRankedClimbSvg(params);
    case "png":
      return renderRankedClimbPng(params);
    case "webp":
      return renderRankedClimbWebp(
        params,
        out.quality !== undefined ? { quality: out.quality } : {}
      );
    case "avif":
      return renderRankedClimbAvif(
        params,
        out.quality !== undefined ? { quality: out.quality } : {}
      );
    case "gif":
      return renderRankedClimbGif(params, {
        ...(out.frames !== undefined ? { frames: out.frames } : {}),
        ...(out.fps !== undefined ? { fps: out.fps } : {})
      });
  }
};

(async () => {
  try {
    const userName = githubAction.getInput("github_user_name").trim();
    if (!userName) throw new Error("Missing input: github_user_name");

    const outputsRaw = githubAction
      .getInput("outputs")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const outputs =
      outputsRaw.length > 0
        ? parseOutputsOption(outputsRaw)
        : parseOutputsOption([`dist/lp.svg?theme=rift`]);

    const githubToken = process.env.GITHUB_TOKEN || githubAction.getInput("github_token");
    if (!githubToken) throw new Error("Missing GitHub token (set input github_token).");

    console.log("🎣 fetching github contributions");
    const base = await loadClimber(userName, githubToken);

    for (const [i, out] of outputs.entries()) {
      console.log(`🖌 rendering ${out.format} (outputs[${i}]): ${out.filename}`);

      const body = await renderOne(out, userName, base.cells, base.stats, githubToken);

      fs.mkdirSync(path.dirname(out.filename), { recursive: true });
      fs.writeFileSync(out.filename, body);
    }
  } catch (e: any) {
    if (isGithubContribError(e)) {
      githubAction.setFailed(`Action failed (${e.code}): ${e.message}`);
      return;
    }
    githubAction.setFailed(`Action failed: ${e?.message ?? String(e)}`);
  }
})();
