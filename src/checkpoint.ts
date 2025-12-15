/**
 * Checkpoint and Recovery System
 *
 * Enables agents to save progress and resume after crashes by implementing:
 * - Dual-write pattern: Event stream (audit) + Table (fast queries)
 * - Auto-checkpointing at 25/50/75% milestones
 * - Point-in-time recovery
 *
 * ## Architecture
 *
 * ### Event Stream (Audit Trail)
 * All checkpoints are written as `checkpoint_created` events providing:
 * - Complete audit history
 * - Point-in-time recovery capability
 * - Learning data for recovery patterns
 *
 * ### Table (Fast Queries)
 * The `swarm_contexts` table provides:
 * - O(1) lookup of latest checkpoint
 * - Fast epic-wide queries
 * - Upsert pattern (one row per epic+bead+agent)
 *
 * ### Recovery Flow
 * 1. Agent crashes during task execution
 * 2. Coordinator queries latest checkpoint via `loadCheckpoint()`
 * 3. Agent resumes with recovered context
 * 4. `checkpoint_recovered` event records recovery
 *
 * @module checkpoint
 */

import { PGliteDatabaseAdapter } from "./adapter";
import { getDatabase } from "./streams";
import { appendEvent } from "./streams/store";
import { createEvent } from "./streams/events";
import {
  type SwarmBeadContext,
  SwarmBeadContextSchema,
  type CheckpointCreateArgs,
  CheckpointCreateArgsSchema,
  type CheckpointRecoverArgs,
  CheckpointRecoverArgsSchema,
  type CheckpointRecoveryResult,
  type ProgressMilestone,
} from "./schemas/checkpoint";
import type { DatabaseAdapter } from "./types/database";

// ============================================================================
// Checkpoint Storage
// ============================================================================

/**
 * Save a checkpoint with dual-write pattern
 *
 * Atomically:
 * 1. Appends `checkpoint_created` event for audit trail
 * 2. Upserts `swarm_contexts` table for fast queries
 *
 * The event provides complete history, while the table provides fast access
 * to the latest checkpoint.
 *
 * @param args - Checkpoint creation arguments
 * @param projectPath - Project path for database lookup
 * @returns The saved SwarmBeadContext with timestamp
 *
 * @example
 * ```typescript
 * await saveCheckpoint({
 *   epic_id: "bd-abc123",
 *   bead_id: "bd-abc123.1",
 *   agent_name: "worker-1",
 *   task_description: "Implement feature X",
 *   files: ["src/foo.ts"],
 *   strategy: "file-based",
 *   progress_percent: 50,
 *   last_milestone: "half",
 * });
 * ```
 */
export async function saveCheckpoint(
  args: CheckpointCreateArgs,
  projectPath?: string,
  db?: DatabaseAdapter,
): Promise<SwarmBeadContext> {
  // Validate input
  const validated = CheckpointCreateArgsSchema.parse(args);

  // Use provided adapter or create new PGliteDatabaseAdapter
  const adapter = db ?? new PGliteDatabaseAdapter(await getDatabase(projectPath));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Build the full context
  const context: SwarmBeadContext = {
    epic_id: validated.epic_id,
    bead_id: validated.bead_id,
    agent_name: validated.agent_name,
    task_description: validated.task_description,
    files: validated.files,
    strategy: validated.strategy,
    shared_context: validated.shared_context,
    directives: validated.directives || [],
    progress_percent: validated.progress_percent || 0,
    last_milestone: validated.last_milestone,
    files_touched: validated.files_touched || [],
    recovery_state: "pending",
    checkpointed_at: nowIso,
  };

  // Validate the full context
  SwarmBeadContextSchema.parse(context);

  await adapter.exec("BEGIN");
  try {
    // 1. Append checkpoint_created event for audit trail
    const event = createEvent("checkpoint_created", {
      project_key: projectPath || process.cwd(),
      agent_name: context.agent_name,
      epic_id: context.epic_id,
      bead_id: context.bead_id,
      context: context as unknown as Record<string, unknown>,
      progress_percent: context.progress_percent,
      milestone: context.last_milestone,
    });

    await appendEvent(event, projectPath);

    // 2. Upsert swarm_contexts table for fast queries
    await adapter.query(
      `
      INSERT INTO swarm_contexts (
        epic_id, bead_id, agent_name, context, 
        progress_percent, milestone, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (epic_id, bead_id, agent_name) 
      DO UPDATE SET
        context = $4,
        progress_percent = $5,
        milestone = $6,
        updated_at = $8
    `,
      [
        context.epic_id,
        context.bead_id,
        context.agent_name,
        JSON.stringify(context),
        context.progress_percent,
        context.last_milestone || null,
        now,
        now,
      ],
    );

    await adapter.exec("COMMIT");

    console.log(
      `[checkpoint] Saved checkpoint for ${context.bead_id} at ${context.progress_percent}%`,
    );

    return context;
  } catch (error) {
    await adapter.exec("ROLLBACK");
    console.error(`[checkpoint] Failed to save checkpoint:`, error);
    throw new Error(
      `Failed to save checkpoint: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ============================================================================
// Checkpoint Recovery
// ============================================================================

/**
 * Load the latest checkpoint for a bead
 *
 * Queries the `swarm_contexts` table for fast O(1) lookup of the most recent
 * checkpoint. Returns null if no checkpoint exists (fresh start).
 *
 * @param args - Recovery arguments (epic_id, bead_id, optional agent_name)
 * @param projectPath - Project path for database lookup
 * @returns Recovery result with context or null
 *
 * @example
 * ```typescript
 * const result = await loadCheckpoint({
 *   epic_id: "bd-abc123",
 *   bead_id: "bd-abc123.1",
 * });
 *
 * if (result.success && result.context) {
 *   console.log(`Recovered from ${result.context.progress_percent}%`);
 * }
 * ```
 */
export async function loadCheckpoint(
  args: CheckpointRecoverArgs,
  projectPath?: string,
  db?: DatabaseAdapter,
): Promise<CheckpointRecoveryResult> {
  // Validate input
  const validated = CheckpointRecoverArgsSchema.parse(args);

  // Use provided adapter or create new PGliteDatabaseAdapter
  const adapter = db ?? new PGliteDatabaseAdapter(await getDatabase(projectPath));

  try {
    // Query latest checkpoint from table
    let query = `
      SELECT context, updated_at
      FROM swarm_contexts
      WHERE epic_id = $1 AND bead_id = $2
    `;
    const params: unknown[] = [validated.epic_id, validated.bead_id];

    // Optionally filter by agent name
    if (validated.agent_name) {
      query += ` AND agent_name = $3`;
      params.push(validated.agent_name);
    }

    query += ` ORDER BY updated_at DESC LIMIT 1`;

    const result = await adapter.query<{
      context: unknown;
      updated_at: string;
    }>(query, params);

    if (result.rows.length === 0) {
      // No checkpoint found - fresh start
      return {
        success: true,
        fresh_start: true,
        context: undefined,
      };
    }

    // Parse and validate the context
    // JSONB columns are returned as objects by PGLite, not strings
    const row = result.rows[0];
    const contextData =
      typeof row.context === "string"
        ? JSON.parse(row.context)
        : row.context;
    const context = SwarmBeadContextSchema.parse(contextData);

    // Update recovery state
    context.recovery_state = "recovered";

    // Append checkpoint_recovered event
    const event = createEvent("checkpoint_recovered", {
      project_key: projectPath || process.cwd(),
      agent_name: context.agent_name,
      epic_id: context.epic_id,
      bead_id: context.bead_id,
      checkpoint_timestamp: new Date(context.checkpointed_at).getTime(),
      success: true,
    });

    await appendEvent(event, projectPath);

    console.log(
      `[checkpoint] Recovered checkpoint for ${context.bead_id} from ${context.progress_percent}%`,
    );

    return {
      success: true,
      context,
      fresh_start: false,
    };
  } catch (error) {
    console.error(`[checkpoint] Failed to load checkpoint:`, error);

    // Record failed recovery
    const event = createEvent("checkpoint_recovered", {
      project_key: projectPath || process.cwd(),
      agent_name: validated.agent_name || "unknown",
      epic_id: validated.epic_id,
      bead_id: validated.bead_id,
      checkpoint_timestamp: Date.now(),
      success: false,
      notes: error instanceof Error ? error.message : String(error),
    });

    try {
      await appendEvent(event, projectPath);
    } catch (eventError) {
      console.error(
        `[checkpoint] Failed to record recovery failure:`,
        eventError,
      );
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      fresh_start: false,
    };
  }
}

/**
 * List all checkpoints for an epic
 *
 * Returns all checkpoints across all beads and agents in an epic,
 * ordered by most recent first. Useful for coordinator to see overall
 * progress and recovery state.
 *
 * @param epicId - Epic ID to query
 * @param projectPath - Project path for database lookup
 * @returns Array of SwarmBeadContext objects
 *
 * @example
 * ```typescript
 * const checkpoints = await listCheckpoints("bd-abc123");
 * console.log(`Epic has ${checkpoints.length} checkpoints`);
 * ```
 */
export async function listCheckpoints(
  epicId: string,
  projectPath?: string,
  db?: DatabaseAdapter,
): Promise<SwarmBeadContext[]> {
  // Use provided adapter or create new PGliteDatabaseAdapter
  const adapter = db ?? new PGliteDatabaseAdapter(await getDatabase(projectPath));

  try {
    const result = await adapter.query<{
      context: unknown;
      updated_at: string;
    }>(
      `
      SELECT context, updated_at
      FROM swarm_contexts
      WHERE epic_id = $1
      ORDER BY updated_at DESC
    `,
      [epicId],
    );

    // Parse and validate each context
    const contexts: SwarmBeadContext[] = [];
    for (const row of result.rows) {
      try {
        // JSONB columns are returned as objects by PGLite, not strings
        const contextData =
          typeof row.context === "string"
            ? JSON.parse(row.context)
            : row.context;
        const context = SwarmBeadContextSchema.parse(contextData);
        contexts.push(context);
      } catch (error) {
        console.warn(
          `[checkpoint] Failed to parse checkpoint context:`,
          error,
        );
        // Skip invalid checkpoints
      }
    }

    console.log(`[checkpoint] Found ${contexts.length} checkpoints for ${epicId}`);

    return contexts;
  } catch (error) {
    console.error(`[checkpoint] Failed to list checkpoints:`, error);
    throw new Error(
      `Failed to list checkpoints: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ============================================================================
// Milestone Detection
// ============================================================================

/**
 * Determine milestone from progress percentage
 *
 * Maps progress percentage to milestone enum:
 * - 0%: "started"
 * - 25%: "quarter"
 * - 50%: "half"
 * - 75%: "three-quarters"
 * - 100%: "complete"
 *
 * @param progressPercent - Progress percentage (0-100)
 * @returns ProgressMilestone enum value
 */
export function getMilestone(progressPercent: number): ProgressMilestone {
  if (progressPercent >= 100) return "complete";
  if (progressPercent >= 75) return "three-quarters";
  if (progressPercent >= 50) return "half";
  if (progressPercent >= 25) return "quarter";
  return "started";
}

/**
 * Check if auto-checkpoint should trigger
 *
 * Returns true if the progress crosses a milestone boundary (25%, 50%, 75%).
 * Used by hive_progress to determine when to auto-save.
 *
 * @param currentPercent - Current progress percentage
 * @param previousPercent - Previous progress percentage
 * @returns true if a milestone was crossed
 */
export function shouldAutoCheckpoint(
  currentPercent: number,
  previousPercent: number,
): boolean {
  // Don't checkpoint if going backwards
  if (currentPercent < previousPercent) {
    return false;
  }

  const currentMilestone = getMilestone(currentPercent);
  const previousMilestone = getMilestone(previousPercent);

  // Auto-checkpoint on quarter, half, three-quarters
  const autoMilestones: ProgressMilestone[] = [
    "quarter",
    "half",
    "three-quarters",
  ];

  return (
    currentMilestone !== previousMilestone &&
    autoMilestones.includes(currentMilestone)
  );
}
