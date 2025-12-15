/**
 * CLI Branding & Visual Elements
 * 
 * ASCII art, colors, seasonal messages, and package branding.
 */

// ============================================================================
// Color Helpers
// ============================================================================

export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;

// ============================================================================
// ASCII Art
// ============================================================================

export const HONEYCOMB = `
  / \\__/ \\__/ \\__/ \\__/ \\
  \\__/ \\__/ \\__/ \\__/ \\__/
  / \\__/ \\__/ \\__/ \\__/ \\
  \\__/ \\__/ \\__/ \\__/ \\__/
`;

export const BANNER = `
 ██╗  ██╗██╗██╗   ██╗███████╗
 ██║  ██║██║██║   ██║██╔════╝
 ███████║██║██║   ██║█████╗  
 ██╔══██║██║╚██╗ ██╔╝██╔══╝  
 ██║  ██║██║ ╚████╔╝ ███████╗
 ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝
`;

// ============================================================================
// Branding
// ============================================================================

export const TAGLINE = "The hive mind for your codebase";
export const PACKAGE_NAME = "opencode-hive-plugin";

// ============================================================================
// Seasonal Messages
// ============================================================================

export type Season = "spooky" | "holiday" | "new-year" | "summer" | "default";

export function getSeason(): Season {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (month === 1 && day <= 7) return "new-year";
  if (month === 10 && day > 7) return "spooky";
  if (month === 12 && day > 7 && day < 26) return "holiday";
  if (month >= 6 && month <= 8) return "summer";
  return "default";
}

export interface SeasonalBee {
  messages: string[];
  decorations?: string[];
}

export function getSeasonalBee(): SeasonalBee {
  const season = getSeason();
  const year = new Date().getFullYear();

  switch (season) {
    case "new-year":
      return {
        messages: [
          `New year, new hive! Let's build something amazing in ${year}!`,
          `${year} is the year of the hive mind! bzzzz...`,
          `Kicking off ${year} with coordinated chaos!`,
        ],
        decorations: ["🎉", "🎊", "✨"],
      };
    case "spooky":
      return {
        messages: [
          `Boo! Just kidding. Let's spawn some agents!`,
          `The hive is buzzing with spooky energy...`,
          `Something wicked this way computes...`,
        ],
        decorations: ["🎃", "👻", "🕷️", "🦇"],
      };
    case "holiday":
      return {
        messages: [
          `'Tis the season to parallelize!`,
          `The hive is warm and cozy. Let's build!`,
          `The best gift? A well-coordinated hive.`,
        ],
        decorations: ["🎄", "🎁", "❄️", "⭐"],
      };
    case "summer":
      return {
        messages: [
          `Summer vibes and parallel pipelines!`,
          `The hive is buzzing in the sunshine!`,
          `Hot code, cool agents. Let's go!`,
        ],
        decorations: ["☀️", "🌻", "🌴"],
      };
    default:
      return {
        messages: [
          `The hive awaits your command.`,
          `Ready to coordinate the hive!`,
          `Let's build something awesome together.`,
          `Parallel agents, standing by.`,
          `The bees are ready to work.`,
          `Many agents, one mission.`,
        ],
      };
  }
}

export function getRandomMessage(): string {
  const { messages } = getSeasonalBee();
  return messages[Math.floor(Math.random() * messages.length)];
}
