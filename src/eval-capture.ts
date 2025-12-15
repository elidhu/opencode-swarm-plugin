/**
 * Eval Capture Module - Recording decomposition outcomes for data-driven improvement
 *
 * Records every hive decomposition with complete lifecycle tracking:
 * - Decompose: Input task, strategy, generated beadtree
 * - Execute: Subtask outcomes (duration, files, success)
 * - Finalize: Computed metrics (scope accuracy, time balance, file overlap)
 *
 * Data stored in append-only JSONL at .opencode/eval-data.jsonl
 * Used by evalite scorers to measure decomposition quality over time.
 *
 * Key metrics:
 * - Scope Accuracy: actual_files / planned_files (goal: 0.8-1.2)
 * - Time Balance: max_duration / min_duration (goal: < 3.0)
 * - File Overlap: Count of files in multiple subtasks (goal: 0)
 */

import { z } from "zod";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BeadTree, SubtaskSpec } from "./schemas/bead";
import type { DecompositionStrategy } from "./hive-strategies";

// ============================================================================
// Schemas
// ============================================================================

/**
 * Subtask outcome - recorded after subtask completion
 */
export const SubtaskOutcomeSchema = z.object({
  /** Subtask bead ID */
  bead_id: z.string(),
  /** Subtask title */
  title: z.string(),
  /** Agent name that executed the subtask */
  agent_name: z.string().optional(),
  /** Duration in milliseconds */
  duration_ms: z.number().int().min(0),
  /** Files actually touched during execution */
  files_touched: z.array(z.string()).default([]),
  /** Whether subtask succeeded */
  success: z.boolean(),
  /** Number of errors encountered */
  error_count: z.number().int().min(0).default(0),
  /** Number of retry attempts */
  retry_count: z.number().int().min(0).default(0),
  /** When outcome was recorded */
  timestamp: z.string(),
});
export type SubtaskOutcome = z.infer<typeof SubtaskOutcomeSchema>;

/**
 * Complete eval record - captures full decomposition lifecycle
 *
 * 31-field schema tracking decomposition quality:
 * - Input: task, strategy, context
 * - Plan: bead tree, subtask specs
 * - Execution: outcomes per subtask
 * - Metrics: computed quality scores
 */
export const EvalRecordSchema = z.object({
  /** Unique ID for this eval record */
  id: z.string(),

  // === Input Phase ===
  /** Original task description */
  task: z.string(),
  /** Decomposition strategy used */
  strategy: z.enum(["file-based", "feature-based", "risk-based", "research-based", "auto"]),
  /** Additional context provided */
  context: z.string().optional(),
  /** Max subtasks parameter */
  max_subtasks: z.number().int().min(2).max(10),

  // === Planning Phase ===
  /** Epic bead ID */
  epic_id: z.string(),
  /** Epic title */
  epic_title: z.string(),
  /** Epic description */
  epic_description: z.string().optional(),
  /** Number of subtasks in plan */
  subtask_count: z.number().int().min(1),
  /** Planned files (all files across subtasks) */
  planned_files: z.array(z.string()),
  /** Total planned complexity (sum of subtask complexities) */
  total_complexity: z.number().int().min(0),
  /** Raw subtask specifications */
  subtasks: z.array(
    z.object({
      title: z.string(),
      files: z.array(z.string()),
      dependencies: z.array(z.number()),
      estimated_complexity: z.number().int().min(1).max(5),
    }),
  ),

  // === Execution Phase ===
  /** Subtask outcomes (populated as subtasks complete) */
  outcomes: z.array(SubtaskOutcomeSchema).default([]),
  /** When decomposition was initiated */
  decompose_timestamp: z.string(),
  /** When epic was marked complete (if finalized) */
  finalize_timestamp: z.string().optional(),

  // === Computed Metrics ===
  /** Scope accuracy: actual_files / planned_files (goal: 0.8-1.2) */
  scope_accuracy: z.number().min(0).optional(),
  /** Time balance: max_duration / min_duration (goal: < 3.0) */
  time_balance: z.number().min(1).optional(),
  /** File overlap count: files in multiple subtasks (goal: 0) */
  file_overlap_count: z.number().int().min(0).optional(),
  /** Total actual files touched across all subtasks */
  actual_files: z.array(z.string()).optional(),
  /** Success rate: successful_subtasks / total_subtasks */
  success_rate: z.number().min(0).max(1).optional(),
  /** Total duration across all subtasks (milliseconds) */
  total_duration_ms: z.number().int().min(0).optional(),

  // === Quality Flags ===
  /** Whether decomposition is finalized (all subtasks complete) */
  finalized: z.boolean().default(false),
  /** Whether decomposition met quality thresholds */
  quality_passed: z.boolean().optional(),
  /** Quality issues detected */
  quality_issues: z.array(z.string()).optional(),
});
export type EvalRecord = z.infer<typeof EvalRecordSchema>;

// ============================================================================
// Storage Functions
// ============================================================================

/**
 * Get the eval data file path
 *
 * Data stored at .opencode/eval-data.jsonl
 */
function getEvalDataPath(): string {
  return join(process.cwd(), ".opencode", "eval-data.jsonl");
}

/**
 * Ensure .opencode directory exists
 */
async function ensureEvalDirectory(): Promise<void> {
  const dir = join(process.cwd(), ".opencode");
  await mkdir(dir, { recursive: true });
}

/**
 * Append an eval record to JSONL storage
 *
 * @param record - Eval record to append
 */
export async function appendEvalRecord(record: EvalRecord): Promise<void> {
  await ensureEvalDirectory();
  const path = getEvalDataPath();
  const line = JSON.stringify(record) + "\n";
  await appendFile(path, line, "utf-8");
}

/**
 * Load all eval records from JSONL storage
 *
 * @returns Array of eval records, or empty array if file doesn't exist
 */
export async function loadEvalRecords(): Promise<EvalRecord[]> {
  try {
    const path = getEvalDataPath();
    const content = await readFile(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    const records: EvalRecord[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const validated = EvalRecordSchema.parse(parsed);
        records.push(validated);
      } catch (error) {
        console.warn(`[eval-capture] Failed to parse eval record:`, error);
        // Skip invalid records
      }
    }

    return records;
  } catch (error) {
    // File doesn't exist yet or is empty
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Update an existing eval record in JSONL storage
 *
 * Reads all records, replaces the matching one, and rewrites the file.
 * This is acceptable for eval data which grows slowly (~1 record per epic).
 *
 * @param recordId - ID of record to update
 * @param updates - Partial updates to apply
 */
export async function updateEvalRecord(
  recordId: string,
  updates: Partial<EvalRecord>,
): Promise<void> {
  const records = await loadEvalRecords();
  const index = records.findIndex((r) => r.id === recordId);

  if (index === -1) {
    throw new Error(`Eval record not found: ${recordId}`);
  }

  // Apply updates
  const updated = { ...records[index], ...updates };
  records[index] = EvalRecordSchema.parse(updated);

  // Rewrite entire file
  await ensureEvalDirectory();
  const path = getEvalDataPath();
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await Bun.write(path, lines);
}

// ============================================================================
// Capture Functions
// ============================================================================

/**
 * Capture decomposition - called after generating bead tree
 *
 * Creates initial eval record with input and planning data.
 * Returns record ID for tracking updates.
 *
 * @param task - Original task description
 * @param strategy - Decomposition strategy used
 * @param beadTree - Generated bead tree
 * @param context - Optional additional context
 * @param maxSubtasks - Max subtasks parameter
 * @returns Eval record ID
 */
export async function captureDecomposition(args: {
  task: string;
  strategy: DecompositionStrategy;
  beadTree: BeadTree;
  epicId: string;
  context?: string;
  maxSubtasks?: number;
}): Promise<string> {
  const recordId = `eval-${args.epicId}-${Date.now()}`;

  // Extract all unique files from subtasks
  const allFiles = new Set<string>();
  for (const subtask of args.beadTree.subtasks) {
    for (const file of subtask.files) {
      allFiles.add(file);
    }
  }

  // Calculate total complexity
  const totalComplexity = args.beadTree.subtasks.reduce(
    (sum, st) => sum + st.estimated_complexity,
    0,
  );

  const record: EvalRecord = {
    id: recordId,
    task: args.task,
    strategy: args.strategy === "auto" ? "auto" : args.strategy,
    context: args.context,
    max_subtasks: args.maxSubtasks ?? 5,
    epic_id: args.epicId,
    epic_title: args.beadTree.epic.title,
    epic_description: args.beadTree.epic.description,
    subtask_count: args.beadTree.subtasks.length,
    planned_files: Array.from(allFiles),
    total_complexity: totalComplexity,
    subtasks: args.beadTree.subtasks.map((st) => ({
      title: st.title,
      files: st.files,
      dependencies: st.dependencies,
      estimated_complexity: st.estimated_complexity,
    })),
    outcomes: [],
    decompose_timestamp: new Date().toISOString(),
    finalized: false,
  };

  await appendEvalRecord(record);
  return recordId;
}

/**
 * Capture subtask outcome - called after each subtask completes
 *
 * Appends outcome to eval record and triggers metric recalculation.
 *
 * @param epicId - Epic bead ID
 * @param outcome - Subtask outcome data
 */
export async function captureSubtaskOutcome(
  epicId: string,
  outcome: SubtaskOutcome,
): Promise<void> {
  const records = await loadEvalRecords();
  const record = records.find((r) => r.epic_id === epicId && !r.finalized);

  if (!record) {
    console.warn(
      `[eval-capture] No active eval record found for epic ${epicId}`,
    );
    return;
  }

  // Add outcome
  record.outcomes.push(outcome);

  // Recalculate metrics
  calculateMetrics(record);

  // Update record
  await updateEvalRecord(record.id, record);
}

/**
 * Finalize eval record - called when epic is complete
 *
 * Marks record as finalized, computes final metrics, and checks quality.
 *
 * @param epicId - Epic bead ID
 */
export async function finalizeEvalRecord(epicId: string): Promise<void> {
  const records = await loadEvalRecords();
  const record = records.find((r) => r.epic_id === epicId && !r.finalized);

  if (!record) {
    console.warn(
      `[eval-capture] No active eval record found for epic ${epicId}`,
    );
    return;
  }

  // Mark finalized
  record.finalized = true;
  record.finalize_timestamp = new Date().toISOString();

  // Final metric calculation
  calculateMetrics(record);

  // Check quality thresholds
  checkQualityThresholds(record);

  // Update record
  await updateEvalRecord(record.id, record);
}

// ============================================================================
// Metric Calculation
// ============================================================================

/**
 * Calculate computed metrics from outcomes
 *
 * Mutates record in-place with computed values.
 */
function calculateMetrics(record: EvalRecord): void {
  if (record.outcomes.length === 0) {
    return;
  }

  // Collect actual files touched
  const actualFilesSet = new Set<string>();
  for (const outcome of record.outcomes) {
    for (const file of outcome.files_touched) {
      actualFilesSet.add(file);
    }
  }
  record.actual_files = Array.from(actualFilesSet);

  // Scope accuracy: actual / planned
  const plannedCount = record.planned_files.length;
  const actualCount = record.actual_files.length;
  record.scope_accuracy = plannedCount > 0 ? actualCount / plannedCount : 0;

  // Time balance: max / min duration
  const durations = record.outcomes.map((o) => o.duration_ms).filter((d) => d > 0);
  if (durations.length > 1) {
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);
    record.time_balance = minDuration > 0 ? maxDuration / minDuration : 1;
  } else {
    record.time_balance = 1; // Only one subtask or all zero duration
  }

  // File overlap: count files in multiple planned subtasks
  const fileSubtaskCount = new Map<string, number>();
  for (const subtask of record.subtasks) {
    for (const file of subtask.files) {
      fileSubtaskCount.set(file, (fileSubtaskCount.get(file) || 0) + 1);
    }
  }
  record.file_overlap_count = Array.from(fileSubtaskCount.values()).filter(
    (count) => count > 1,
  ).length;

  // Success rate
  const successCount = record.outcomes.filter((o) => o.success).length;
  record.success_rate = record.outcomes.length > 0 
    ? successCount / record.outcomes.length 
    : 0;

  // Total duration
  record.total_duration_ms = record.outcomes.reduce(
    (sum, o) => sum + o.duration_ms,
    0,
  );
}

/**
 * Check quality thresholds and set quality flags
 *
 * Mutates record in-place with quality assessment.
 */
function checkQualityThresholds(record: EvalRecord): void {
  const issues: string[] = [];

  // Scope accuracy: should be 0.8-1.2
  if (record.scope_accuracy !== undefined) {
    if (record.scope_accuracy < 0.8) {
      issues.push(
        `Scope underestimate: ${(record.scope_accuracy * 100).toFixed(0)}% of planned files`,
      );
    } else if (record.scope_accuracy > 1.2) {
      issues.push(
        `Scope overestimate: ${(record.scope_accuracy * 100).toFixed(0)}% of planned files`,
      );
    }
  }

  // Time balance: should be < 3.0
  if (record.time_balance !== undefined && record.time_balance > 3.0) {
    issues.push(
      `Poor time balance: ${record.time_balance.toFixed(1)}x (longest/shortest)`,
    );
  }

  // File overlap: should be 0
  if (record.file_overlap_count !== undefined && record.file_overlap_count > 0) {
    issues.push(`File conflicts: ${record.file_overlap_count} files in multiple subtasks`);
  }

  // Success rate: should be 100%
  if (record.success_rate !== undefined && record.success_rate < 1.0) {
    issues.push(
      `Incomplete success: ${(record.success_rate * 100).toFixed(0)}% subtasks succeeded`,
    );
  }

  record.quality_issues = issues.length > 0 ? issues : undefined;
  record.quality_passed = issues.length === 0;
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Find eval record by epic ID
 *
 * @param epicId - Epic bead ID
 * @returns Eval record or undefined if not found
 */
export async function findEvalRecord(epicId: string): Promise<EvalRecord | undefined> {
  const records = await loadEvalRecords();
  return records.find((r) => r.epic_id === epicId);
}

/**
 * Get all eval records with optional filters
 *
 * @param filters - Optional filters to apply
 * @returns Filtered eval records
 */
export async function queryEvalRecords(filters?: {
  strategy?: DecompositionStrategy;
  finalized?: boolean;
  qualityPassed?: boolean;
}): Promise<EvalRecord[]> {
  const records = await loadEvalRecords();

  if (!filters) {
    return records;
  }

  return records.filter((r) => {
    if (filters.strategy && r.strategy !== filters.strategy) {
      return false;
    }
    if (filters.finalized !== undefined && r.finalized !== filters.finalized) {
      return false;
    }
    if (filters.qualityPassed !== undefined && r.quality_passed !== filters.qualityPassed) {
      return false;
    }
    return true;
  });
}

/**
 * Get summary statistics across all eval records
 *
 * @returns Summary stats for reporting
 */
export async function getEvalSummary(): Promise<{
  total_decompositions: number;
  finalized_count: number;
  quality_passed_count: number;
  avg_scope_accuracy: number;
  avg_time_balance: number;
  avg_success_rate: number;
  by_strategy: Record<string, number>;
}> {
  const records = await loadEvalRecords();
  const finalized = records.filter((r) => r.finalized);

  const scopeAccuracies = finalized
    .map((r) => r.scope_accuracy)
    .filter((v): v is number => v !== undefined);
  const timeBalances = finalized
    .map((r) => r.time_balance)
    .filter((v): v is number => v !== undefined);
  const successRates = finalized
    .map((r) => r.success_rate)
    .filter((v): v is number => v !== undefined);

  const byStrategy: Record<string, number> = {};
  for (const record of records) {
    byStrategy[record.strategy] = (byStrategy[record.strategy] || 0) + 1;
  }

  return {
    total_decompositions: records.length,
    finalized_count: finalized.length,
    quality_passed_count: finalized.filter((r) => r.quality_passed).length,
    avg_scope_accuracy:
      scopeAccuracies.length > 0
        ? scopeAccuracies.reduce((sum, v) => sum + v, 0) / scopeAccuracies.length
        : 0,
    avg_time_balance:
      timeBalances.length > 0
        ? timeBalances.reduce((sum, v) => sum + v, 0) / timeBalances.length
        : 0,
    avg_success_rate:
      successRates.length > 0
        ? successRates.reduce((sum, v) => sum + v, 0) / successRates.length
        : 0,
    by_strategy: byStrategy,
  };
}
