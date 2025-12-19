/**
 * Metrics Command - Learning system health and observability
 *
 * Shows summary of learning system health:
 * - Pattern count and types
 * - Mandate count (feedback events)
 * - Recent eval capture events
 * - Strike records
 * - Error accumulator stats
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { dim, yellow, cyan, green, red, orange } from "../branding.js";

// ============================================================================
// Types
// ============================================================================

interface MetricsSummary {
  vectorDir: {
    exists: boolean;
    path: string;
    tables: string[];
  };
  patterns: {
    total: number;
    antiPatterns: number;
  };
  feedback: {
    total: number;
    byType: Record<string, number>;
  };
  maturity: {
    total: number;
    byState: Record<string, number>;
  };
  strikes: {
    total: number;
    activeStrikes: number;
  };
  errors: {
    total: number;
    unresolved: number;
  };
  evalCapture: {
    exists: boolean;
    recordCount: number;
    recentRecords: Array<{
      id: string;
      task: string;
      strategy: string;
      finalized: boolean;
      timestamp: string;
    }>;
  };
}

// ============================================================================
// Data Collection
// ============================================================================

/**
 * Check if .hive/vectors directory exists and list tables
 */
function checkVectorDir(): MetricsSummary["vectorDir"] {
  const vectorPath = join(process.cwd(), ".hive", "vectors");

  if (!existsSync(vectorPath)) {
    return { exists: false, path: vectorPath, tables: [] };
  }

  try {
    const entries = readdirSync(vectorPath, { withFileTypes: true });
    const tables = entries
      .filter((e) => e.isDirectory() && e.name.endsWith(".lance"))
      .map((e) => e.name.replace(".lance", ""));

    return { exists: true, path: vectorPath, tables };
  } catch {
    return { exists: true, path: vectorPath, tables: [] };
  }
}

/**
 * Load and count patterns from storage
 */
async function countPatterns(): Promise<MetricsSummary["patterns"]> {
  try {
    const { createStorage } = await import("../../storage.js");
    const storage = createStorage();
    const patterns = await storage.getAllPatterns();
    await storage.close();

    const antiPatterns = patterns.filter((p) => p.is_negative).length;
    return { total: patterns.length, antiPatterns };
  } catch {
    return { total: 0, antiPatterns: 0 };
  }
}

/**
 * Load and count feedback events
 */
async function countFeedback(): Promise<MetricsSummary["feedback"]> {
  try {
    const { createStorage } = await import("../../storage.js");
    const storage = createStorage();
    const feedback = await storage.getAllFeedback();
    await storage.close();

    const byType: Record<string, number> = {};
    for (const f of feedback) {
      byType[f.type] = (byType[f.type] || 0) + 1;
    }

    return { total: feedback.length, byType };
  } catch {
    return { total: 0, byType: {} };
  }
}

/**
 * Load and count maturity records
 */
async function countMaturity(): Promise<MetricsSummary["maturity"]> {
  try {
    const { createStorage } = await import("../../storage.js");
    const storage = createStorage();
    const maturity = await storage.getAllMaturity();
    await storage.close();

    const byState: Record<string, number> = {};
    for (const m of maturity) {
      byState[m.state] = (byState[m.state] || 0) + 1;
    }

    return { total: maturity.length, byState };
  } catch {
    return { total: 0, byState: {} };
  }
}

/**
 * Load and count strike records
 */
async function countStrikes(): Promise<MetricsSummary["strikes"]> {
  try {
    const { createStorage } = await import("../../storage.js");
    const storage = createStorage();
    const strikes = await storage.getAllStrikes();
    await storage.close();

    const activeStrikes = strikes.filter((s) => s.strike_count > 0).length;
    return { total: strikes.length, activeStrikes };
  } catch {
    return { total: 0, activeStrikes: 0 };
  }
}

/**
 * Load and count error records
 */
async function countErrors(): Promise<MetricsSummary["errors"]> {
  try {
    const { createStorage } = await import("../../storage.js");
    const storage = createStorage();
    const errors = await storage.getAllErrors();
    await storage.close();

    const unresolved = errors.filter((e) => !e.resolved).length;
    return { total: errors.length, unresolved };
  } catch {
    return { total: 0, unresolved: 0 };
  }
}

/**
 * Load eval capture records
 */
async function loadEvalCapture(): Promise<MetricsSummary["evalCapture"]> {
  try {
    const { loadEvalRecords } = await import("../../eval-capture.js");
    const records = await loadEvalRecords();

    // Get 5 most recent records
    const sortedRecords = records
      .sort(
        (a, b) =>
          new Date(b.decompose_timestamp).getTime() -
          new Date(a.decompose_timestamp).getTime()
      )
      .slice(0, 5);

    return {
      exists: true,
      recordCount: records.length,
      recentRecords: sortedRecords.map((r) => ({
        id: r.id,
        task: r.task.slice(0, 50) + (r.task.length > 50 ? "..." : ""),
        strategy: r.strategy,
        finalized: r.finalized,
        timestamp: r.decompose_timestamp,
      })),
    };
  } catch {
    return { exists: false, recordCount: 0, recentRecords: [] };
  }
}

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Format a section header
 */
function sectionHeader(title: string): string {
  return cyan(`\n${title}`);
}

/**
 * Format a key-value pair
 */
function kvPair(key: string, value: string | number, color?: (s: string) => string): string {
  const colorFn = color || ((s: string) => s);
  return `  ${dim(key + ":")} ${colorFn(String(value))}`;
}

/**
 * Display metrics summary
 */
function displayMetrics(summary: MetricsSummary): void {
  console.log(yellow("\n  Learning System Metrics"));
  console.log(dim("  ═".repeat(30)));

  // Vector Storage
  console.log(sectionHeader("Vector Storage (.hive/vectors/)"));
  if (summary.vectorDir.exists) {
    console.log(kvPair("Status", "initialized", green));
    console.log(kvPair("Tables", summary.vectorDir.tables.length > 0 
      ? summary.vectorDir.tables.join(", ")
      : "none"));
  } else {
    console.log(kvPair("Status", "not initialized", dim));
    console.log(dim("  Run a learning operation to initialize storage"));
  }

  // Patterns
  console.log(sectionHeader("Decomposition Patterns"));
  if (summary.patterns.total > 0) {
    console.log(kvPair("Total patterns", summary.patterns.total, green));
    console.log(kvPair("Anti-patterns", summary.patterns.antiPatterns, 
      summary.patterns.antiPatterns > 0 ? orange : dim));
  } else {
    console.log(dim("  No patterns recorded yet"));
  }

  // Feedback (Mandates)
  console.log(sectionHeader("Feedback Events (Mandates)"));
  if (summary.feedback.total > 0) {
    console.log(kvPair("Total events", summary.feedback.total, green));
    for (const [type, count] of Object.entries(summary.feedback.byType)) {
      const color = type === "helpful" ? green : type === "harmful" ? red : dim;
      console.log(kvPair(`  ${type}`, count, color));
    }
  } else {
    console.log(dim("  No feedback recorded yet"));
  }

  // Maturity
  console.log(sectionHeader("Pattern Maturity"));
  if (summary.maturity.total > 0) {
    console.log(kvPair("Total tracked", summary.maturity.total));
    for (const [state, count] of Object.entries(summary.maturity.byState)) {
      const color = state === "proven" ? green : state === "deprecated" ? red : dim;
      console.log(kvPair(`  ${state}`, count, color));
    }
  } else {
    console.log(dim("  No maturity tracking yet"));
  }

  // Strikes
  console.log(sectionHeader("3-Strike Records"));
  if (summary.strikes.total > 0) {
    console.log(kvPair("Total beads tracked", summary.strikes.total));
    console.log(kvPair("Active strikes", summary.strikes.activeStrikes, 
      summary.strikes.activeStrikes > 0 ? red : green));
  } else {
    console.log(dim("  No strike records (good!)"));
  }

  // Errors
  console.log(sectionHeader("Error Accumulator"));
  if (summary.errors.total > 0) {
    console.log(kvPair("Total errors recorded", summary.errors.total));
    console.log(kvPair("Unresolved", summary.errors.unresolved, 
      summary.errors.unresolved > 0 ? red : green));
  } else {
    console.log(dim("  No errors recorded"));
  }

  // Eval Capture
  console.log(sectionHeader("Eval Capture (.opencode/eval-data.jsonl)"));
  if (summary.evalCapture.exists && summary.evalCapture.recordCount > 0) {
    console.log(kvPair("Total decompositions", summary.evalCapture.recordCount, green));
    
    if (summary.evalCapture.recentRecords.length > 0) {
      console.log(dim("\n  Recent decompositions:"));
      for (const record of summary.evalCapture.recentRecords) {
        const status = record.finalized ? green("done") : yellow("in progress");
        const date = new Date(record.timestamp).toLocaleDateString();
        console.log(dim(`    [${date}] `) + `${record.strategy} - ${status}`);
        console.log(dim(`      ${record.task}`));
      }
    }
  } else {
    console.log(dim("  No eval data captured yet"));
  }

  // Summary
  console.log(sectionHeader("Summary"));
  const healthScore = calculateHealthScore(summary);
  const healthColor = healthScore >= 80 ? green : healthScore >= 50 ? yellow : red;
  console.log(kvPair("Health score", `${healthScore}%`, healthColor));
  console.log();
}

/**
 * Calculate a simple health score (0-100)
 */
function calculateHealthScore(summary: MetricsSummary): number {
  let score = 0;
  let checks = 0;

  // Storage initialized (+20)
  checks++;
  if (summary.vectorDir.exists) score += 20;

  // Has patterns (+20)
  checks++;
  if (summary.patterns.total > 0) score += 20;

  // Has feedback (+20)
  checks++;
  if (summary.feedback.total > 0) score += 20;

  // No active strikes (+20)
  checks++;
  if (summary.strikes.activeStrikes === 0) score += 20;

  // No unresolved errors (+20)
  checks++;
  if (summary.errors.unresolved === 0) score += 20;

  return Math.round(score);
}

// ============================================================================
// Main Command
// ============================================================================

/**
 * Run the metrics command
 */
export async function metricsCommand(args: string[]): Promise<void> {
  // Check for --json flag
  const jsonOutput = args.includes("--json") || args.includes("-j");

  // Collect all metrics
  const [vectorDir, patterns, feedback, maturity, strikes, errors, evalCapture] =
    await Promise.all([
      checkVectorDir(),
      countPatterns(),
      countFeedback(),
      countMaturity(),
      countStrikes(),
      countErrors(),
      loadEvalCapture(),
    ]);

  const summary: MetricsSummary = {
    vectorDir,
    patterns,
    feedback,
    maturity,
    strikes,
    errors,
    evalCapture,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    displayMetrics(summary);
  }
}
