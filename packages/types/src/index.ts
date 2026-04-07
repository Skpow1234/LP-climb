export type ContributionDay = {
  date: string;
  weekday: number;
  contributionCount: number;
  contributionLevel:
    | "FOURTH_QUARTILE"
    | "THIRD_QUARTILE"
    | "SECOND_QUARTILE"
    | "FIRST_QUARTILE"
    | "NONE";
};

export type ContributionCell = {
  x: number;
  y: number;
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type ContributionStats = {
  total: number;
  maxDay: { date: string; count: number } | null;
  currentStreakDays: number;
  bestStreakDays: number;
  busiestWeekday: { weekday: number; total: number } | null;
  last30DaysTotal: number;
};

export type ThemeId =
  | "assassin"
  | "mage"
  | "tank"
  | "support"
  | "marksman"
  | "rift"
  | "mono";

export type Theme = {
  id: ThemeId;
  name: string;
  bg: string;
  frame: string;
  text: string;
  accent: string;
  glow: string;
  tier: Record<
    | "iron"
    | "bronze"
    | "silver"
    | "gold"
    | "plat"
    | "emerald"
    | "diamond"
    | "master"
    | "grandmaster"
    | "challenger",
    string
  >;
};

