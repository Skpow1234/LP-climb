import type { ContributionCell } from "@lp-climb/types";

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

export async function fetchGithubContributionCells(params: {
  user: string;
  githubToken: string;
}): Promise<ContributionCell[]> {
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

  const res = await fetch("https://api.github.com/graphql", {
    headers: {
      Authorization: `bearer ${params.githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "lp-climb"
    },
    method: "POST",
    body: JSON.stringify({ query, variables: { login: params.user } })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`GitHub GraphQL error (${res.status}): ${txt}`);
  }

  const json = (await res.json()) as { data?: GraphQLRes; errors?: any[] };
  if (json.errors?.[0]) {
    throw new Error(`GitHub GraphQL error: ${json.errors[0].message ?? "unknown"}`);
  }
  if (!json.data) throw new Error("GitHub GraphQL: missing data");

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

