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
  tier: {
    iron: string;
    bronze: string;
    silver: string;
    gold: string;
    plat: string;
    emerald: string;
    diamond: string;
    master: string;
    grandmaster: string;
    challenger: string;
  };
};

export const THEMES: Record<ThemeId, Theme> = {
  assassin: {
    id: "assassin",
    name: "Assassin",
    bg: "#070A12",
    frame: "#1C2242",
    text: "#D7DCF5",
    accent: "#8E3BFF",
    glow: "rgba(142, 59, 255, 0.55)",
    tier: {
      iron: "#4A4A56",
      bronze: "#7A4A2A",
      silver: "#A7B3C4",
      gold: "#F2C14E",
      plat: "#41E2C6",
      emerald: "#1FE38C",
      diamond: "#59A6FF",
      master: "#B05CFF",
      grandmaster: "#FF4E68",
      challenger: "#FFD36B"
    }
  },
  mage: {
    id: "mage",
    name: "Mage",
    bg: "#060B0F",
    frame: "#1B2B2F",
    text: "#D8F7FF",
    accent: "#2FE6FF",
    glow: "rgba(47, 230, 255, 0.45)",
    tier: {
      iron: "#49535A",
      bronze: "#7A5A3A",
      silver: "#B8C7D9",
      gold: "#F2D06B",
      plat: "#45F1E3",
      emerald: "#2BE58E",
      diamond: "#6CB5FF",
      master: "#C070FF",
      grandmaster: "#FF5A7C",
      challenger: "#FFE08A"
    }
  },
  tank: {
    id: "tank",
    name: "Tank",
    bg: "#070B08",
    frame: "#1F2A1C",
    text: "#E6F3E3",
    accent: "#51D26B",
    glow: "rgba(81, 210, 107, 0.40)",
    tier: {
      iron: "#4D524F",
      bronze: "#7A512E",
      silver: "#B7C0BF",
      gold: "#F2C75D",
      plat: "#49E0C4",
      emerald: "#2AE98C",
      diamond: "#63AFFF",
      master: "#B16AFF",
      grandmaster: "#FF5970",
      challenger: "#FFE08A"
    }
  },
  support: {
    id: "support",
    name: "Support",
    bg: "#070A0C",
    frame: "#1A2530",
    text: "#E9F7FF",
    accent: "#6CE1FF",
    glow: "rgba(108, 225, 255, 0.35)",
    tier: {
      iron: "#4B5159",
      bronze: "#7A583C",
      silver: "#B9C6D4",
      gold: "#F2D27A",
      plat: "#55E8D5",
      emerald: "#2AE98C",
      diamond: "#6AAFFF",
      master: "#BD77FF",
      grandmaster: "#FF6078",
      challenger: "#FFE08A"
    }
  },
  marksman: {
    id: "marksman",
    name: "Marksman",
    bg: "#0A0906",
    frame: "#2E2414",
    text: "#FFF4D6",
    accent: "#FFB74A",
    glow: "rgba(255, 183, 74, 0.40)",
    tier: {
      iron: "#55524A",
      bronze: "#8A5B2E",
      silver: "#C5CBD3",
      gold: "#FFD36B",
      plat: "#44E6D4",
      emerald: "#26E88C",
      diamond: "#67B1FF",
      master: "#C06FFF",
      grandmaster: "#FF5770",
      challenger: "#FFE49A"
    }
  },
  rift: {
    id: "rift",
    name: "Rift",
    bg: "#060B0A",
    frame: "#19312B",
    text: "#DFF7EC",
    accent: "#2AE98C",
    glow: "rgba(42, 233, 140, 0.35)",
    tier: {
      iron: "#4D5653",
      bronze: "#7A5836",
      silver: "#B7C3C8",
      gold: "#F2D06B",
      plat: "#45F1E3",
      emerald: "#2AE98C",
      diamond: "#59A6FF",
      master: "#B16AFF",
      grandmaster: "#FF5970",
      challenger: "#FFD36B"
    }
  },
  mono: {
    id: "mono",
    name: "Mono",
    bg: "#0B0B0D",
    frame: "#2B2B33",
    text: "#F0F0F4",
    accent: "#FFFFFF",
    glow: "rgba(255, 255, 255, 0.18)",
    tier: {
      iron: "#666672",
      bronze: "#7A7A88",
      silver: "#9A9AAF",
      gold: "#B8B8D0",
      plat: "#CFCFE0",
      emerald: "#D8D8EA",
      diamond: "#E0E0F4",
      master: "#E8E8FF",
      grandmaster: "#F0F0FF",
      challenger: "#FFFFFF"
    }
  }
};

export function getTheme(theme?: string | null): Theme {
  const id = (theme ?? "rift").toLowerCase() as ThemeId;
  return THEMES[id] ?? THEMES.rift;
}

