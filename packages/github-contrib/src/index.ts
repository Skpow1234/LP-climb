import type { ContributionCell } from "@lp-climb/types";
export { GithubContribError, isGithubContribError } from "./errors.js";
import { GithubContribError } from "./errors.js";

type GraphQLRes = {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        weeks: {
          contributionDays: {
            contributionCount: number;
            contributionLevel:
              | "FOURTH_QUARTILE"
              | "THIRD_QUARTILE"
              | "SECOND_QUARTILE"
              | "FIRST_QUARTILE"
              | "NONE";
            date: string;
            weekday: number;
          }[];
        }[];
      };
    };
  };
};

function isValidGithubLogin(login: string) {
  // GitHub username constraints (approx):
  // - 1..39 chars
  // - alphanumeric or single hyphens between segments
  // - cannot start/end with hyphen, cannot contain consecutive hyphens
  // See: https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28#get-a-user (login format)
  return /^(?!-)(?!.*--)[a-zA-Z0-9-]{1,39}(?<!-)$/.test(login);
}

async function safeText(res: Response) {
  return await res.text().catch(() => res.statusText);
}

export async function fetchGithubContributionCells(params: {
  user: string;
  githubToken: string;
}): Promise<ContributionCell[]> {
  const user = params.user.trim();
  if (!isValidGithubLogin(user)) {
    throw new GithubContribError({
      code: "INVALID_USERNAME",
      statusCode: 400,
      message: `Invalid GitHub username: "${user}"`,
      details: { user }
    });
  }

  const query = /* GraphQL */ `
    query ($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                contributionLevel
                weekday
                date
              }
            }
          }
        }
      }
    }
  `;

  const controller = new AbortController();
  const timeoutMs = 12_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch("https://api.github.com/graphql", {
      headers: {
        Authorization: `bearer ${params.githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "lp-climb"
      },
      method: "POST",
      body: JSON.stringify({ query, variables: { login: user } }),
      signal: controller.signal
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new GithubContribError({
        code: "UPSTREAM_TIMEOUT",
        statusCode: 504,
        message: "GitHub request timed out.",
        details: { timeoutMs }
      });
    }
    throw new GithubContribError({
      code: "UPSTREAM_ERROR",
      statusCode: 502,
      message: "Failed to reach GitHub.",
      cause: e
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const txt = await safeText(res);

    if (res.status === 401) {
      throw new GithubContribError({
        code: "BAD_CREDENTIALS",
        statusCode: 401,
        message: "GitHub credentials rejected (check token permissions).",
        details: { status: res.status }
      });
    }

    if (res.status === 403) {
      // GitHub uses 403 for various permission/rate-limit scenarios.
      const lower = txt.toLowerCase();
      const rate =
        lower.includes("rate limit") ||
        lower.includes("secondary rate limit") ||
        res.headers.get("x-ratelimit-remaining") === "0";

      throw new GithubContribError({
        code: rate ? "RATE_LIMITED" : "FORBIDDEN",
        statusCode: 503,
        message: rate
          ? "GitHub rate limit hit. Try again later."
          : "GitHub forbidden. Token may be missing required access.",
        details: {
          status: res.status,
          rateLimited: rate,
          ratelimitRemaining: res.headers.get("x-ratelimit-remaining"),
          ratelimitReset: res.headers.get("x-ratelimit-reset")
        }
      });
    }

    if (res.status >= 500) {
      throw new GithubContribError({
        code: "UPSTREAM_ERROR",
        statusCode: 502,
        message: "GitHub upstream error.",
        details: { status: res.status }
      });
    }

    throw new GithubContribError({
      code: "UPSTREAM_BAD_RESPONSE",
      statusCode: 502,
      message: "Unexpected GitHub response.",
      details: { status: res.status, body: txt.slice(0, 500) }
    });
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: GraphQLRes; errors?: { message?: string; type?: string }[] }
    | null;
  if (!json) {
    throw new GithubContribError({
      code: "UPSTREAM_BAD_RESPONSE",
      statusCode: 502,
      message: "GitHub returned invalid JSON."
    });
  }

  const errMsg = json.errors?.[0]?.message;
  if (errMsg) {
    // Common case: "Could not resolve to a User with the login of 'X'."
    if (errMsg.toLowerCase().includes("could not resolve to a user")) {
      throw new GithubContribError({
        code: "USER_NOT_FOUND",
        statusCode: 404,
        message: `GitHub user not found: "${user}"`,
        details: { user }
      });
    }

    throw new GithubContribError({
      code: "UPSTREAM_BAD_RESPONSE",
      statusCode: 502,
      message: `GitHub GraphQL error: ${errMsg}`
    });
  }

  if (!json.data) {
    throw new GithubContribError({
      code: "UPSTREAM_BAD_RESPONSE",
      statusCode: 502,
      message: "GitHub GraphQL: missing data."
    });
  }

  return json.data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    ({ contributionDays }, x) =>
      contributionDays.map((d) => ({
        x,
        y: d.weekday,
        date: d.date,
        count: d.contributionCount,
        level:
          (d.contributionLevel === "FOURTH_QUARTILE" && 4) ||
          (d.contributionLevel === "THIRD_QUARTILE" && 3) ||
          (d.contributionLevel === "SECOND_QUARTILE" && 2) ||
          (d.contributionLevel === "FIRST_QUARTILE" && 1) ||
          0
      })) as ContributionCell[]
  );
}

