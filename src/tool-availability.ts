/**
 * Tool Availability Module
 *
 * Checks for external tool availability and provides graceful degradation.
 * Tools are checked once and cached for the session.
 *
 * Supported tools:
 * - semantic-memory: Learning persistence with semantic search
 * - beads (bd): Git-backed issue tracking
 * - hive-mail: Embedded multi-agent coordination (PGLite-based)
 */

import { checkHiveHealth } from "./streams/hive-mail";

const BUNX_TIMEOUT_MS = 10000;

export type ToolName = "semantic-memory" | "beads" | "hive-mail";

export interface ToolStatus {
  available: boolean;
  checkedAt: string;
  error?: string;
  version?: string;
}

export interface ToolAvailability {
  tool: ToolName;
  status: ToolStatus;
  fallbackBehavior: string;
}

const toolCache = new Map<ToolName, ToolStatus>();
const warningsLogged = new Set<ToolName>();

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await Bun.$`which ${cmd}`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const toolCheckers: Record<ToolName, () => Promise<ToolStatus>> = {
  "semantic-memory": async () => {
    const nativeExists = await commandExists("semantic-memory");
    if (nativeExists) {
      try {
        const result = await Bun.$`semantic-memory stats`.quiet().nothrow();
        return {
          available: result.exitCode === 0,
          checkedAt: new Date().toISOString(),
          version: "native",
        };
      } catch (e) {
        return {
          available: false,
          checkedAt: new Date().toISOString(),
          error: String(e),
        };
      }
    }

    try {
      const proc = Bun.spawn(["bunx", "semantic-memory", "stats"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeout = setTimeout(() => proc.kill(), BUNX_TIMEOUT_MS);
      const exitCode = await proc.exited;
      clearTimeout(timeout);

      return {
        available: exitCode === 0,
        checkedAt: new Date().toISOString(),
        version: "bunx",
      };
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },

  beads: async () => {
    const exists = await commandExists("bd");
    if (!exists) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: "bd command not found",
      };
    }

    try {
      const result = await Bun.$`bd --version`.quiet().nothrow();
      return {
        available: result.exitCode === 0,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },

  "hive-mail": async () => {
    try {
      const healthResult = await checkHiveHealth();
      return {
        available: healthResult.healthy,
        checkedAt: new Date().toISOString(),
        error: healthResult.healthy
          ? undefined
          : "Hive Mail database not healthy",
        version: "embedded",
      };
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },
};

const fallbackBehaviors: Record<ToolName, string> = {
  "semantic-memory":
    "Learning data stored in-memory only (lost on session end)",
  beads: "Hive cannot track issues - task coordination will be less reliable",
  "hive-mail":
    "Multi-agent coordination disabled - file conflicts possible if multiple agents active",
};

export async function checkTool(tool: ToolName): Promise<ToolStatus> {
  const cached = toolCache.get(tool);
  if (cached) {
    return cached;
  }

  const checker = toolCheckers[tool];
  const status = await checker();
  toolCache.set(tool, status);

  return status;
}

export async function isToolAvailable(tool: ToolName): Promise<boolean> {
  const status = await checkTool(tool);
  return status.available;
}

export async function getToolAvailability(
  tool: ToolName,
): Promise<ToolAvailability> {
  const status = await checkTool(tool);
  return {
    tool,
    status,
    fallbackBehavior: fallbackBehaviors[tool],
  };
}

export async function checkAllTools(): Promise<
  Map<ToolName, ToolAvailability>
> {
  const tools: ToolName[] = ["semantic-memory", "beads", "hive-mail"];

  const results = new Map<ToolName, ToolAvailability>();

  const checks = await Promise.all(
    tools.map(async (tool) => ({
      tool,
      availability: await getToolAvailability(tool),
    })),
  );

  for (const { tool, availability } of checks) {
    results.set(tool, availability);
  }

  return results;
}

export function warnMissingTool(tool: ToolName): void {
  if (warningsLogged.has(tool)) {
    return;
  }

  warningsLogged.add(tool);
  const fallback = fallbackBehaviors[tool];
  console.warn(`[hive] ${tool} not available: ${fallback}`);
}

export async function requireTool(tool: ToolName): Promise<void> {
  const status = await checkTool(tool);
  if (!status.available) {
    throw new Error(
      `Required tool '${tool}' is not available: ${status.error || "unknown error"}`,
    );
  }
}

export async function withToolFallback<T>(
  tool: ToolName,
  action: () => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const available = await isToolAvailable(tool);

  if (available) {
    return action();
  }

  warnMissingTool(tool);
  return fallback();
}

export async function ifToolAvailable<T>(
  tool: ToolName,
  action: () => Promise<T>,
): Promise<T | undefined> {
  const available = await isToolAvailable(tool);

  if (available) {
    return action();
  }

  warnMissingTool(tool);
  return undefined;
}

export function resetToolCache(): void {
  toolCache.clear();
  warningsLogged.clear();
}

export function formatToolAvailability(
  availability: Map<ToolName, ToolAvailability>,
): string {
  const lines: string[] = ["Tool Availability:"];

  for (const [tool, info] of availability) {
    const status = info.status.available ? "✓" : "✗";
    const version = info.status.version ? ` (${info.status.version})` : "";
    const fallback = info.status.available ? "" : ` → ${info.fallbackBehavior}`;
    lines.push(`  ${status} ${tool}${version}${fallback}`);
  }

  return lines.join("\n");
}
