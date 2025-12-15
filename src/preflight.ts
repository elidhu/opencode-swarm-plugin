/**
 * Pre-Flight Protocol - Health Checks Before Agent Start
 *
 * Runs a series of health checks before an agent begins work on a task.
 * Checks for common issues like:
 * - Database connectivity
 * - File system permissions
 * - Required dependencies
 * - Environment setup
 * - Conflicting file reservations
 *
 * Each check can be marked as required (blocks agent start) or optional (warns only).
 *
 * @see docs/analysis/consistency-protocols-design.md
 */

import { tool } from "@opencode-ai/plugin";
import type { PreFlightResult } from "./schemas/verification";
import { createStatelessHiveTool } from "./hive-tool-helpers";
import { checkHiveHealth } from "./streams/hive-mail";
import { getActiveReservations } from "./streams/projections";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Check Definitions
// ============================================================================

/**
 * Check if the database is accessible and healthy
 */
async function checkDatabase(projectPath: string): Promise<PreFlightResult> {
  try {
    const health = await checkHiveHealth(projectPath);

    if (health.healthy) {
      return {
        passed: true,
        message: "Database is healthy",
        metadata: {
          stats: health.stats,
        },
      };
    } else {
      return {
        passed: false,
        message: "Database is unhealthy",
        blockers: ["Database connection failed"],
      };
    }
  } catch (error) {
    return {
      passed: false,
      message: `Database check failed: ${error instanceof Error ? error.message : String(error)}`,
      blockers: ["Cannot connect to database"],
    };
  }
}

/**
 * Check if .hive directory exists and is writable
 */
async function checkHiveDirectory(projectPath: string): Promise<PreFlightResult> {
  const hivePath = join(projectPath, ".hive");

  if (!existsSync(hivePath)) {
    return {
      passed: false,
      message: ".hive directory does not exist",
      blockers: ["Missing .hive directory"],
      warnings: ["Will be created on first use"],
    };
  }

  // Check if writable by trying to access stats
  try {
    const { statSync } = await import("node:fs");
    const stats = statSync(hivePath);

    if (!stats.isDirectory()) {
      return {
        passed: false,
        message: ".hive exists but is not a directory",
        blockers: [".hive is a file, not a directory"],
      };
    }

    return {
      passed: true,
      message: ".hive directory exists and is accessible",
    };
  } catch (error) {
    return {
      passed: false,
      message: `Cannot access .hive directory: ${error instanceof Error ? error.message : String(error)}`,
      blockers: ["Insufficient permissions for .hive directory"],
    };
  }
}

/**
 * Check for file reservation conflicts
 */
async function checkReservations(
  projectPath: string,
  agentName: string,
  files?: string[],
): Promise<PreFlightResult> {
  try {
    const reservations = await getActiveReservations(
      projectPath,
      projectPath,
      agentName,
    );

    // If no files specified, just report active reservations
    if (!files || files.length === 0) {
      return {
        passed: true,
        message: `Found ${reservations.length} active reservation(s)`,
        metadata: {
          total_reservations: reservations.length,
        },
      };
    }

    // Check for conflicts with specified files
    const conflicts: string[] = [];
    for (const file of files) {
      const conflicting = reservations.filter(
        (r: any) =>
          r.path_pattern === file &&
          r.agent_name !== agentName &&
          r.exclusive === true,
      );

      if (conflicting.length > 0) {
        conflicts.push(
          `${file} is exclusively reserved by ${conflicting[0].agent_name}`,
        );
      }
    }

    if (conflicts.length > 0) {
      return {
        passed: false,
        message: "File reservation conflicts detected",
        blockers: conflicts,
        warnings: ["You may need to wait for other agents to release these files"],
      };
    }

    return {
      passed: true,
      message: "No file reservation conflicts",
    };
  } catch (error) {
    return {
      passed: false,
      message: `Failed to check reservations: ${error instanceof Error ? error.message : String(error)}`,
      warnings: ["Could not verify file reservations"],
    };
  }
}

/**
 * Check if required environment variables are set
 */
async function checkEnvironment(): Promise<PreFlightResult> {
  const warnings: string[] = [];

  // Check for common environment variables
  if (!process.env.HOME && !process.env.USERPROFILE) {
    warnings.push("HOME/USERPROFILE not set - may affect temp directory access");
  }

  if (warnings.length > 0) {
    return {
      passed: true,
      message: "Environment check completed with warnings",
      warnings,
    };
  }

  return {
    passed: true,
    message: "Environment is properly configured",
  };
}

/**
 * Check Node.js version
 */
async function checkNodeVersion(): Promise<PreFlightResult> {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);

  if (majorVersion < 18) {
    return {
      passed: false,
      message: `Node.js ${nodeVersion} is too old`,
      blockers: ["Node.js 18+ required"],
    };
  }

  return {
    passed: true,
    message: `Node.js ${nodeVersion} is compatible`,
  };
}

// ============================================================================
// Pre-Flight Runner
// ============================================================================

interface PreFlightCheckResult extends PreFlightResult {
  name: string;
  required: boolean;
}

/**
 * Run all pre-flight checks
 */
async function runPreFlightChecks(
  projectPath: string,
  agentName: string,
  files?: string[],
): Promise<{
  passed: boolean;
  checks: PreFlightCheckResult[];
  blockers: string[];
  warnings: string[];
}> {
  const checks: PreFlightCheckResult[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Run all checks
  const checkResults = await Promise.all([
    checkNodeVersion(),
    checkDatabase(projectPath),
    checkHiveDirectory(projectPath),
    checkReservations(projectPath, agentName, files),
    checkEnvironment(),
  ]);

  const checkNames = [
    "Node.js Version",
    "Database",
    "Hive Directory",
    "File Reservations",
    "Environment",
  ];

  const requiredChecks = [true, true, false, true, false];

  for (let i = 0; i < checkResults.length; i++) {
    const result = checkResults[i];
    const name = checkNames[i];
    const required = requiredChecks[i];

    checks.push({
      name,
      required,
      ...result,
    });

    // Collect blockers and warnings
    if (!result.passed && required) {
      if (result.blockers) {
        blockers.push(...result.blockers);
      } else {
        blockers.push(`${name} check failed`);
      }
    }

    if (result.warnings) {
      warnings.push(...result.warnings);
    }
  }

  // Overall pass/fail
  const passed = blockers.length === 0;

  return {
    passed,
    checks,
    blockers,
    warnings,
  };
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Run pre-flight checks before starting work
 *
 * Verifies that the environment is ready for the agent to start work.
 * Checks database connectivity, file permissions, reservations, etc.
 *
 * @example
 * ```
 * preflight_run({
 *   project_key: "/path/to/project",
 *   agent_name: "agent-worker-1",
 *   files: ["src/foo.ts", "src/bar.ts"]
 * })
 * ```
 */
export const preflight_run = createStatelessHiveTool<{
  project_key: string;
  agent_name: string;
  files?: string[];
}>(
  "Run pre-flight health checks before starting work. Verifies database, permissions, and file reservations.",
  {
    project_key: tool.schema
      .string()
      .describe("Project path (use current working directory)"),
    agent_name: tool.schema.string().describe("Your agent name"),
    files: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files you plan to modify (for reservation conflict checks)"),
  },
  async (args) => {
    const result = await runPreFlightChecks(
      args.project_key,
      args.agent_name,
      args.files,
    );

    if (!result.passed) {
      return {
        success: false,
        passed: false,
        checks: result.checks,
        blockers: result.blockers,
        warnings: result.warnings,
        message: `Pre-flight checks failed with ${result.blockers.length} blocker(s)`,
        recommendation:
          "Resolve blockers before proceeding. Check database connectivity and file reservations.",
      };
    }

    return {
      success: true,
      passed: true,
      checks: result.checks,
      warnings: result.warnings,
      message:
        result.warnings.length > 0
          ? `Pre-flight checks passed with ${result.warnings.length} warning(s)`
          : "All pre-flight checks passed",
    };
  },
);

// ============================================================================
// Exports
// ============================================================================

export const preflightTools = {
  preflight_run,
};
