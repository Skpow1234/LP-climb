import * as fs from "node:fs";
import * as path from "node:path";

import { fetchGithubContributionCells } from "@lp-climb/github-contrib";
import { isGithubContribError } from "@lp-climb/github-contrib";
import { computeStats } from "@lp-climb/core";
import { renderRankedClimbPng, renderRankedClimbSvg } from "@lp-climb/svg-creator";

import * as githubAction from "./github-action.js";
import { parseOutputsOption } from "./outputsOptions.js";

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
    const baseCells = await fetchGithubContributionCells({ user: userName, githubToken });
    const baseStats = computeStats(baseCells);

    for (const [i, out] of outputs.entries()) {
      console.log(`🖌 rendering svg (outputs[${i}]): ${out.filename}`);

      const vsUser = out.vs;
      const vsData = vsUser
        ? await (async () => {
            const cells = await fetchGithubContributionCells({ user: vsUser, githubToken });
            return { user: vsUser, cells, stats: computeStats(cells) };
          })()
        : undefined;

      const svg = renderRankedClimbSvg({
        user: userName,
        cells: baseCells,
        stats: baseStats,
        theme: out.theme,
        ...(out.width !== undefined ? { width: out.width } : {}),
        ...(out.height !== undefined ? { height: out.height } : {}),
        ...(vsData ? { vs: vsData } : {})
      });

      fs.mkdirSync(path.dirname(out.filename), { recursive: true });
      if (out.filename.endsWith(".png")) {
        const png = renderRankedClimbPng({
          user: userName,
          cells: baseCells,
          stats: baseStats,
          theme: out.theme,
          ...(out.width !== undefined ? { width: out.width } : {}),
          ...(out.height !== undefined ? { height: out.height } : {}),
          ...(vsData ? { vs: vsData } : {})
        });
        fs.writeFileSync(out.filename, png);
      } else {
        fs.writeFileSync(out.filename, svg);
      }
    }
  } catch (e: any) {
    if (isGithubContribError(e)) {
      githubAction.setFailed(`Action failed (${e.code}): ${e.message}`);
      return;
    }
    githubAction.setFailed(`Action failed: ${e?.message ?? String(e)}`);
  }
})();

