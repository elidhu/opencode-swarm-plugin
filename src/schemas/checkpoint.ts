/**
 * Checkpoint/Recovery Schemas
 *
 * These schemas define the structure for checkpoint and recovery operations,
 * enabling agents to save progress and resume after crashes.
 *
 * ## SwarmBeadContext
 * Captures complete agent state:
 * - Files being modified
 * - Decomposition strategy used
 * - Progress directives and milestones
 * - Recovery metadata
 *
 * ## Checkpoint Events
 * Event-sourced checkpoints enable:
 * - Point-in-time recovery
 * - Audit trail of progress
 * - Learning from recovery patterns
 *
 * @module schemas/checkpoint
 */
import { z } from "zod";
import { RequiredTimestampSchema } from "./common";

/**
 * Recovery state for checkpoint
 */
export const RecoveryStateSchema = z.enum([
  "none", // No recovery needed
  "pending", // Checkpoint saved, not yet recovered
  "recovered", // Successfully recovered from checkpoint
  "failed", // Recovery failed
]);
export type RecoveryState = z.infer<typeof RecoveryStateSchema>;

/**
 * Decomposition strategy used for the task
 */
export const DecompositionStrategySchema = z.enum([
  "file-based", // Decompose by file boundaries
  "feature-based", // Decompose by feature/capability
  "risk-based", // Decompose by risk level
  "auto", // Automatically selected strategy
]);
export type DecompositionStrategy = z.infer<typeof DecompositionStrategySchema>;

/**
 * Progress milestone for auto-checkpointing
 */
export const ProgressMilestoneSchema = z.enum([
  "started", // 0% - Task started
  "quarter", // 25% - First quarter complete
  "half", // 50% - Half complete
  "three-quarters", // 75% - Three quarters complete
  "complete", // 100% - Task complete
]);
export type ProgressMilestone = z.infer<typeof ProgressMilestoneSchema>;

/**
 * SwarmBeadContext - Complete agent checkpoint state
 *
 * Captures everything needed to recover an agent's work after a crash:
 * - Epic and bead identification
 * - Files being modified
 * - Strategy and approach
 * - Progress directives
 * - Recovery metadata
 */
export const SwarmBeadContextSchema = z.object({
  /** Epic ID this bead belongs to */
  epic_id: z.string(),
  /** Bead ID for this specific subtask */
  bead_id: z.string(),
  /** Agent name assigned by Hive Mail */
  agent_name: z.string(),
  /** Original task description */
  task_description: z.string(),
  /** Files this agent is modifying (reserved paths) */
  files: z.array(z.string()),
  /** Decomposition strategy used */
  strategy: DecompositionStrategySchema,
  /** Shared context from decomposition */
  shared_context: z.string().optional(),
  /**
   * Directives are short-term, task-specific hints from coordinator to workers.
   *
   * Use for:
   * - Recovery hints ("Resume from line 342")
   * - Discovered gotchas ("API rate limit is 100/min")
   * - Task-specific context ("Use v2 endpoint, not v1")
   *
   * Directives are ephemeral - cleared on task completion.
   * For long-term knowledge, use mandates instead.
   */
  directives: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Short-term hints from coordinator. Cleared on completion."),
  /**
   * References to mandates that informed these directives.
   * Used for validation: if directive helps, upvote the source mandate.
   */
  mandate_refs: z
    .array(z.string())
    .optional()
    .describe("IDs of mandates that informed directives"),
  /** Current progress percentage (0-100) */
  progress_percent: z.number().min(0).max(100).default(0),
  /** Last milestone reached */
  last_milestone: ProgressMilestoneSchema.optional(),
  /** Files touched so far */
  files_touched: z.array(z.string()).optional().default([]),
  /** Recovery state */
  recovery_state: RecoveryStateSchema.default("none"),
  /** Timestamp of last checkpoint */
  checkpointed_at: RequiredTimestampSchema,
  /** Optional recovery notes */
  recovery_notes: z.string().optional(),
});
export type SwarmBeadContext = z.infer<typeof SwarmBeadContextSchema>;

/**
 * Arguments for creating a checkpoint
 */
export const CheckpointCreateArgsSchema = z.object({
  epic_id: z.string(),
  bead_id: z.string(),
  agent_name: z.string(),
  task_description: z.string(),
  files: z.array(z.string()),
  strategy: DecompositionStrategySchema,
  shared_context: z.string().optional(),
  directives: z.array(z.string()).optional(),
  mandate_refs: z.array(z.string()).optional(),
  progress_percent: z.number().min(0).max(100).default(0),
  last_milestone: ProgressMilestoneSchema.optional(),
  files_touched: z.array(z.string()).optional(),
});
export type CheckpointCreateArgs = z.infer<typeof CheckpointCreateArgsSchema>;

/**
 * Arguments for recovering from a checkpoint
 */
export const CheckpointRecoverArgsSchema = z.object({
  epic_id: z.string(),
  bead_id: z.string(),
  /** Optional agent name to filter by specific agent */
  agent_name: z.string().optional(),
});
export type CheckpointRecoverArgs = z.infer<typeof CheckpointRecoverArgsSchema>;

/**
 * Result of checkpoint recovery
 */
export const CheckpointRecoveryResultSchema = z.object({
  success: z.boolean(),
  context: SwarmBeadContextSchema.optional(),
  /** Error message if recovery failed */
  error: z.string().optional(),
  /** Whether this is a fresh start (no checkpoint found) */
  fresh_start: z.boolean().default(false),
});
export type CheckpointRecoveryResult = z.infer<
  typeof CheckpointRecoveryResultSchema
>;

// ============================================================================
// Auto-Promotion Bridge
// ============================================================================

/**
 * Promotes successful directives to mandate candidates.
 *
 * This is the bridge between ephemeral directives and long-term mandates:
 * - Zero-config: called automatically on successful task completion
 * - Converts helpful directives into votable mandate candidates
 * - Links back to source bead for traceability
 *
 * @param context - The completed bead context with directives
 * @param success - Whether the task succeeded
 * @returns Promise<void>
 *
 * @example
 * // Automatically called on task completion:
 * await promoteDirectivesToMandates(context, true);
 *
 * // Directives like "Use v2 API endpoint" become mandate candidates
 * // Other agents can then vote on whether this is universally useful
 */
export async function promoteDirectivesToMandates(
  context: SwarmBeadContext,
  success: boolean,
): Promise<void> {
  // Only promote on success, and only if there are directives
  if (!success || !context.directives?.length) {
    return;
  }

  // Dynamic import to avoid circular dependency
  const { getMandateStorage } = await import("../mandate-storage");
  const storage = getMandateStorage();

  // Promote each directive as a candidate tip
  for (const directive of context.directives) {
    const mandateEntry = {
      id: `mandate-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
      content: directive,
      content_type: "tip" as const,
      author_agent: context.agent_name,
      created_at: new Date().toISOString(),
      status: "candidate" as const,
      tags: ["auto-promoted", "directive", `bead:${context.bead_id}`],
      source: "directive" as const,
      source_ref: context.bead_id,
      metadata: {
        epic_id: context.epic_id,
        promoted_at: new Date().toISOString(),
      },
    };

    try {
      await storage.store(mandateEntry);
    } catch (error) {
      // Log but don't fail the task if promotion fails
      console.warn(
        `Failed to promote directive to mandate: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
