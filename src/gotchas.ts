/**
 * Gotchas Protocol - Cross-Agent Issue Broadcasting
 *
 * Enables agents to discover and share common issues during task execution.
 * When an agent encounters a bug, edge case, or API quirk, they report it
 * as a "gotcha" which other agents can query to avoid the same problem.
 *
 * Storage:
 * - Uses LanceDB per-epic (epic-scoped storage)
 * - Stored in .hive/vectors/{epic_id}/gotchas table
 * - Indexed by category, severity, and files affected
 *
 * @see docs/analysis/consistency-protocols-design.md
 */

import { tool } from "@opencode-ai/plugin";
import type {
  Gotcha,
  ReportGotchaArgs,
  QueryGotchasArgs,
} from "./schemas/verification";
import { createStatelessHiveTool } from "./hive-tool-helpers";
import * as lancedb from "@lancedb/lancedb";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_VECTORS_DIR = ".hive/vectors";

// ============================================================================
// Storage
// ============================================================================

/** Per-epic LanceDB connection instances */
const epicDbInstances = new Map<string, lancedb.Connection>();

/** Track which tables have been initialized per epic */
const initializedTables = new Map<string, Set<string>>();

/**
 * Get the vectors directory path for a project
 */
function getVectorsDir(projectPath: string): string {
  return join(projectPath, DEFAULT_VECTORS_DIR);
}

/**
 * Get the epic-specific database path
 */
function getEpicDbPath(projectPath: string, epicId: string): string {
  const safeEpicId = epicId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getVectorsDir(projectPath), safeEpicId);
}

/**
 * Get or create LanceDB connection for an epic
 */
async function getEpicDb(
  projectPath: string,
  epicId: string,
): Promise<lancedb.Connection> {
  const dbPath = getEpicDbPath(projectPath, epicId);
  const cacheKey = dbPath;

  // Return cached instance if available
  const cachedInstance = epicDbInstances.get(cacheKey);
  if (cachedInstance) {
    return cachedInstance;
  }

  // Ensure directory exists
  if (!existsSync(dbPath)) {
    mkdirSync(dbPath, { recursive: true });
  }

  console.log(`[gotchas] Connecting to LanceDB at ${dbPath}`);
  const db = await lancedb.connect(dbPath);
  epicDbInstances.set(cacheKey, db);

  return db;
}

/**
 * Get or create gotchas table for an epic
 */
async function ensureGotchasTable(
  projectPath: string,
  epicId: string,
): Promise<lancedb.Table> {
  const db = await getEpicDb(projectPath, epicId);
  const dbPath = getEpicDbPath(projectPath, epicId);
  const tableName = "gotchas";

  // Initialize tracking for this epic if needed
  if (!initializedTables.has(dbPath)) {
    initializedTables.set(dbPath, new Set<string>());
  }
  const epicTables = initializedTables.get(dbPath)!;

  // Return if already initialized
  if (epicTables.has(tableName)) {
    return await db.openTable(tableName);
  }

  // Try to open existing table
  try {
    const table = await db.openTable(tableName);
    epicTables.add(tableName);
    return table;
  } catch {
    // Table doesn't exist - will be created on first insert
    epicTables.add(tableName);
    throw new Error(
      "Gotchas table does not exist yet. Will be created on first report.",
    );
  }
}

/**
 * Insert a gotcha into the table
 */
async function insertGotcha(
  projectPath: string,
  epicId: string,
  gotcha: Gotcha,
): Promise<void> {
  const db = await getEpicDb(projectPath, epicId);
  const dbPath = getEpicDbPath(projectPath, epicId);
  const tableName = "gotchas";

  // Initialize tracking for this epic if needed
  if (!initializedTables.has(dbPath)) {
    initializedTables.set(dbPath, new Set<string>());
  }
  const epicTables = initializedTables.get(dbPath)!;

  const row = {
    id: gotcha.id,
    epic_id: gotcha.epic_id,
    discovered_by: gotcha.discovered_by,
    category: gotcha.category,
    title: gotcha.title,
    details: gotcha.details,
    mitigation: gotcha.mitigation,
    files_affected: gotcha.files_affected?.join(",") || "",
    discovered_at: gotcha.discovered_at,
    severity: gotcha.severity,
    resolved_at: gotcha.resolved_at || "",
    resolved_by: gotcha.resolved_by || "",
  };

  try {
    // Try to open and add to existing table
    const table = await db.openTable(tableName);
    await table.add([row]);
    epicTables.add(tableName);
  } catch {
    // Create new table with the row
    console.log(`[gotchas] Creating table: ${tableName} for epic ${epicId}`);
    await db.createTable(tableName, [row]);
    epicTables.add(tableName);
  }
}

/**
 * Query gotchas from the table
 */
async function queryGotchas(
  projectPath: string,
  epicId: string,
  filters: QueryGotchasArgs,
): Promise<Gotcha[]> {
  try {
    const table = await ensureGotchasTable(projectPath, epicId);

    // Build query
    let query = table.query();

    // Apply filters
    const conditions: string[] = [];

    if (filters.severity) {
      conditions.push(`severity = '${filters.severity}'`);
    }

    if (filters.category) {
      conditions.push(`category = '${filters.category}'`);
    }

    // Only return unresolved gotchas by default
    conditions.push("resolved_at = ''");

    if (conditions.length > 0) {
      query = query.where(conditions.join(" AND "));
    }

    const results = await query.toArray();

    // Filter by files in-memory (LanceDB doesn't support array matching well)
    let filteredResults = results;
    if (filters.files && filters.files.length > 0) {
      filteredResults = results.filter((r: any) => {
        const filesAffected = r.files_affected
          ? r.files_affected.split(",")
          : [];
        return filters.files!.some((f) => filesAffected.includes(f));
      });
    }

    return filteredResults.map((r: any) => ({
      id: r.id,
      epic_id: r.epic_id,
      discovered_by: r.discovered_by,
      category: r.category,
      title: r.title,
      details: r.details,
      mitigation: r.mitigation,
      files_affected: r.files_affected
        ? r.files_affected.split(",").filter((f: string) => f)
        : undefined,
      discovered_at: r.discovered_at,
      severity: r.severity,
      resolved_at: r.resolved_at || undefined,
      resolved_by: r.resolved_by || undefined,
    }));
  } catch (error) {
    // Table doesn't exist or other error - return empty
    if (
      error instanceof Error &&
      error.message.includes("does not exist yet")
    ) {
      return [];
    }
    console.error(`[gotchas] Query failed: ${error}`);
    return [];
  }
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Report a discovered issue (gotcha)
 *
 * When an agent encounters a bug, edge case, or API quirk, they should
 * report it so other agents can avoid the same problem.
 *
 * @example
 * ```
 * gotcha_report({
 *   project_key: "/path/to/project",
 *   agent_name: "agent-worker-1",
 *   epic_id: "epic-123",
 *   category: "null-handling",
 *   title: "processInput doesn't handle null",
 *   details: "The processInput() function throws TypeError when passed null",
 *   mitigation: "Validate input before calling or use a default value",
 *   files_affected: ["src/processor.ts"],
 *   severity: "warning"
 * })
 * ```
 */
export const gotcha_report = createStatelessHiveTool<ReportGotchaArgs>(
  "Report a discovered issue (gotcha) to share with other agents in the epic. Use this when you encounter bugs, edge cases, or API quirks that others should know about.",
  {
    project_key: tool.schema
      .string()
      .describe("Project path (use current working directory)"),
    agent_name: tool.schema.string().describe("Your agent name"),
    epic_id: tool.schema.string().describe("Epic ID this gotcha belongs to"),
    category: tool.schema
      .enum([
        "type-error",
        "null-handling",
        "edge-case",
        "api-quirk",
        "test-requirement",
        "pattern-violation",
        "dependency-issue",
      ])
      .describe("Category of the issue"),
    title: tool.schema.string().max(100).describe("Brief title (max 100 chars)"),
    details: tool.schema.string().describe("Detailed description of the issue"),
    mitigation: tool.schema.string().describe("How to avoid or fix this issue"),
    files_affected: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("List of files affected by this issue"),
    severity: tool.schema
      .enum(["info", "warning", "critical"])
      .default("warning")
      .describe("Severity level"),
  },
  async (args) => {
    const projectPath = args.project_key;
    const timestamp = new Date().toISOString();
    const gotchaId = `gotcha-${args.epic_id}-${Date.now()}`;

    const gotcha: Gotcha = {
      id: gotchaId,
      epic_id: args.epic_id,
      discovered_by: args.agent_name,
      category: args.category,
      title: args.title,
      details: args.details,
      mitigation: args.mitigation,
      files_affected: args.files_affected,
      discovered_at: timestamp,
      severity: args.severity,
    };

    await insertGotcha(projectPath, args.epic_id, gotcha);

    return {
      success: true,
      gotcha_id: gotchaId,
      message: `Gotcha reported: ${args.title}`,
      stored_in: `${args.epic_id}/gotchas`,
    };
  },
);

/**
 * Query gotchas for the current epic
 *
 * Search for known issues that other agents have reported. Use this to
 * avoid common pitfalls and learn from other agents' experiences.
 *
 * @example
 * ```
 * // Get all critical gotchas
 * gotcha_query({ epic_id: "epic-123", severity: "critical" })
 *
 * // Get gotchas affecting specific files
 * gotcha_query({ epic_id: "epic-123", files: ["src/processor.ts"] })
 *
 * // Get null-handling gotchas
 * gotcha_query({ epic_id: "epic-123", category: "null-handling" })
 * ```
 */
export const gotcha_query = createStatelessHiveTool<
  QueryGotchasArgs & { project_key: string; epic_id: string }
>(
  "Query known issues (gotchas) reported by other agents in the epic. Use this to avoid common pitfalls before starting work.",
  {
    project_key: tool.schema
      .string()
      .describe("Project path (use current working directory)"),
    epic_id: tool.schema.string().describe("Epic ID to query gotchas for"),
    files: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Filter by files affected"),
    severity: tool.schema
      .enum(["info", "warning", "critical"])
      .optional()
      .describe("Filter by severity level"),
    category: tool.schema
      .enum([
        "type-error",
        "null-handling",
        "edge-case",
        "api-quirk",
        "test-requirement",
        "pattern-violation",
        "dependency-issue",
      ])
      .optional()
      .describe("Filter by category"),
  },
  async (args) => {
    const projectPath = args.project_key;
    const { project_key, epic_id, ...filters } = args;

    const gotchas = await queryGotchas(projectPath, epic_id, filters);

    if (gotchas.length === 0) {
      return {
        gotchas: [],
        count: 0,
        message: "No gotchas found matching the filters",
      };
    }

    return {
      gotchas: gotchas.map((g) => ({
        id: g.id,
        discovered_by: g.discovered_by,
        category: g.category,
        title: g.title,
        details: g.details,
        mitigation: g.mitigation,
        files_affected: g.files_affected,
        discovered_at: g.discovered_at,
        severity: g.severity,
      })),
      count: gotchas.length,
      message: `Found ${gotchas.length} gotcha(s)`,
    };
  },
);

// ============================================================================
// Exports
// ============================================================================

export const gotchaTools = {
  gotcha_report,
  gotcha_query,
};
