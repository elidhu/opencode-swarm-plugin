/**
 * Hive Errors Module - Error accumulation and 3-strike detection
 *
 * Handles error tracking and architectural problem detection:
 * - Error accumulation during subtask execution
 * - Error context for retry prompts
 * - 3-strike detection for architectural problems
 * - Anti-pattern storage in semantic memory
 *
 * Key responsibilities:
 * - hive_accumulate_error - Record errors during execution
 * - hive_get_error_context - Get formatted error context for retries
 * - hive_resolve_error - Mark errors as resolved
 * - hive_check_strikes - Track consecutive failures, detect architectural issues
 *
 * Implements patterns from:
 * - "Patterns for Building AI Agents" p.40: "Good agents examine and correct errors"
 * - 3-Strike Rule: After 3 failed fixes, question the architecture, not the implementation
 *
 * Note: Core ErrorAccumulator class and types are in learning.ts
 * This module provides the tool wrappers and global instances.
 */

import { tool } from "@opencode-ai/plugin";

// Import error types and classes from learning.ts
import {
  addStrike,
  clearStrikes,
  ErrorAccumulator,
  type ErrorType,
  getArchitecturePrompt,
  getStrikes,
  isStrikedOut,
  LearningStrikeStorageAdapter,
  type StrikeStorage,
} from "./learning";

import { getStorage } from "./storage";
import { sendSwarmMessage } from "./streams/hive-mail";

// Re-export types for convenience
export {
  ErrorAccumulator,
  type ErrorEntry,
  type ErrorStorage,
  type ErrorType,
  ErrorTypeSchema,
  LearningErrorStorageAdapter,
  type StrikeRecord,
  type StrikeStorage,
  StrikeRecordSchema,
  LearningStrikeStorageAdapter,
} from "./learning";

// ============================================================================
// Global Storage Instances
// ============================================================================

/**
 * Global error accumulator for tracking errors across subtasks
 *
 * This is a session-level singleton that accumulates errors during
 * hive execution for feeding into retry prompts.
 */
export const globalErrorAccumulator = new ErrorAccumulator();

/**
 * Global strike storage for tracking consecutive fix failures
 */
export const globalStrikeStorage: StrikeStorage = new LearningStrikeStorageAdapter(getStorage());

// ============================================================================
// Error Accumulation Tools
// ============================================================================

/**
 * Record an error during subtask execution
 *
 * Implements pattern from "Patterns for Building AI Agents" p.40:
 * "Good agents examine and correct errors when something goes wrong"
 *
 * Errors are accumulated and can be fed into retry prompts to help
 * agents learn from past failures.
 */
export const hive_accumulate_error = tool({
  description:
    "Record an error during subtask execution. Errors feed into retry prompts.",
  args: {
    bead_id: tool.schema.string().describe("Bead ID where error occurred"),
    error_type: tool.schema
      .enum(["validation", "timeout", "conflict", "tool_failure", "unknown"])
      .describe("Category of error"),
    message: tool.schema.string().describe("Human-readable error message"),
    stack_trace: tool.schema
      .string()
      .optional()
      .describe("Stack trace for debugging"),
    tool_name: tool.schema.string().optional().describe("Tool that failed"),
    context: tool.schema
      .string()
      .optional()
      .describe("What was happening when error occurred"),
  },
  async execute(args) {
    const entry = await globalErrorAccumulator.recordError(
      args.bead_id,
      args.error_type as ErrorType,
      args.message,
      {
        stack_trace: args.stack_trace,
        tool_name: args.tool_name,
        context: args.context,
      },
    );

    return JSON.stringify(
      {
        success: true,
        error_id: entry.id,
        bead_id: entry.bead_id,
        error_type: entry.error_type,
        message: entry.message,
        timestamp: entry.timestamp,
        note: "Error recorded for retry context. Use hive_get_error_context to retrieve accumulated errors.",
      },
      null,
      2,
    );
  },
});

/**
 * Get accumulated errors for a bead to feed into retry prompts
 *
 * Returns formatted error context that can be injected into retry prompts
 * to help agents learn from past failures.
 */
export const hive_get_error_context = tool({
  description:
    "Get accumulated errors for a bead. Returns formatted context for retry prompts.",
  args: {
    bead_id: tool.schema.string().describe("Bead ID to get errors for"),
    include_resolved: tool.schema
      .boolean()
      .optional()
      .describe("Include resolved errors (default: false)"),
  },
  async execute(args) {
    const errorContext = await globalErrorAccumulator.getErrorContext(
      args.bead_id,
      args.include_resolved ?? false,
    );

    const stats = await globalErrorAccumulator.getErrorStats(args.bead_id);

    return JSON.stringify(
      {
        bead_id: args.bead_id,
        error_context: errorContext,
        stats: {
          total_errors: stats.total,
          unresolved: stats.unresolved,
          by_type: stats.by_type,
        },
        has_errors: errorContext.length > 0,
        usage:
          "Inject error_context into retry prompt using {error_context} placeholder",
      },
      null,
      2,
    );
  },
});

/**
 * Mark an error as resolved
 *
 * Call this after an agent successfully addresses an error to update
 * the accumulator state.
 */
export const hive_resolve_error = tool({
  description:
    "Mark an error as resolved after fixing it. Updates error accumulator state.",
  args: {
    error_id: tool.schema.string().describe("Error ID to mark as resolved"),
  },
  async execute(args) {
    await globalErrorAccumulator.resolveError(args.error_id);

    return JSON.stringify(
      {
        success: true,
        error_id: args.error_id,
        resolved: true,
      },
      null,
      2,
    );
  },
});

// ============================================================================
// 3-Strike Detection Tool
// ============================================================================

/**
 * Check if a bead has struck out (3 consecutive failures)
 *
 * The 3-Strike Rule:
 * IF 3+ fixes have failed:
 *   STOP -> Question the architecture
 *   DON'T attempt Fix #4
 *   Discuss with human partner
 *
 * This is NOT a failed hypothesis.
 * This is a WRONG ARCHITECTURE.
 *
 * Use this tool to:
 * - Check strike count before attempting a fix
 * - Get architecture review prompt if struck out
 * - Record a strike when a fix fails
 * - Clear strikes when a fix succeeds
 */
export const hive_check_strikes = tool({
  description:
    "Check 3-strike status for a bead. Records failures, detects architectural problems, generates architecture review prompts.",
  args: {
    bead_id: tool.schema.string().describe("Bead ID to check"),
    action: tool.schema
      .enum(["check", "add_strike", "clear", "get_prompt"])
      .describe(
        "Action: check count, add strike, clear strikes, or get prompt",
      ),
    attempt: tool.schema
      .string()
      .optional()
      .describe("Description of fix attempt (required for add_strike)"),
    reason: tool.schema
      .string()
      .optional()
      .describe("Why the fix failed (required for add_strike)"),
  },
  async execute(args) {
    switch (args.action) {
      case "check": {
        const count = await getStrikes(args.bead_id, globalStrikeStorage);
        const strikedOut = await isStrikedOut(
          args.bead_id,
          globalStrikeStorage,
        );

        return JSON.stringify(
          {
            bead_id: args.bead_id,
            strike_count: count,
            is_striked_out: strikedOut,
            message: strikedOut
              ? "STRUCK OUT: 3 strikes reached. Use get_prompt action for architecture review."
              : count === 0
                ? "No strikes. Clear to proceed."
                : `${count} strike${count > 1 ? "s" : ""}. ${3 - count} remaining before architecture review required.`,
            next_action: strikedOut
              ? "Call with action=get_prompt to get architecture review questions"
              : "Continue with fix attempt",
          },
          null,
          2,
        );
      }

      case "add_strike": {
        if (!args.attempt || !args.reason) {
          return JSON.stringify(
            {
              error: "add_strike requires 'attempt' and 'reason' parameters",
            },
            null,
            2,
          );
        }

        const record = await addStrike(
          args.bead_id,
          args.attempt,
          args.reason,
          globalStrikeStorage,
        );

        const strikedOut = record.strike_count >= 3;

        // Store anti-pattern on 3-strike
        let memoryStored = false;
        let broadcastSent = false;
        if (strikedOut) {
          try {
            const storage = getStorage();
            const failuresList = record.failures
              .map((f, i) => `${i + 1}. ${f.attempt} - Failed: ${f.reason}`)
              .join("\n");
            await storage.storePattern({
              id: `anti-pattern-${args.bead_id}-${Date.now()}`,
              content: `Architecture problem detected in ${args.bead_id}: Task failed after 3 attempts.\nAttempts:\n${failuresList}`,
              kind: "anti_pattern",
              is_negative: true,
              success_count: 0,
              failure_count: 3,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              tags: ["3-strike", "architecture-problem"],
              example_beads: [args.bead_id],
              reason: "3 consecutive failures indicate structural issue requiring human decision",
            });
            memoryStored = true;
            console.log(`[hive] Stored anti-pattern for ${args.bead_id}`);
          } catch (error) {
            console.warn(
              `[hive] Failed to store anti-pattern: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          // Broadcast failure pattern to all agents in the epic
          try {
            // Extract epic ID from bead ID
            const epicId = args.bead_id.includes(".")
              ? args.bead_id.split(".")[0]
              : args.bead_id;

            const failuresList = record.failures
              .map((f, i) => `${i + 1}. **${f.attempt}**\n   - Failed: ${f.reason}`)
              .join("\n\n");

            const broadcastBody = `## Architecture Problem Detected

**Bead**: ${args.bead_id}
**Status**: 3-STRIKE LIMIT REACHED

This task has failed 3 consecutive times, indicating a likely architectural or design problem rather than an implementation issue.

### Failed Attempts

${failuresList}

### What This Means

- DO NOT attempt Fix #4
- The problem is likely structural, not tactical
- Human decision/input required
- Consider: Is the task decomposition correct? Are there missing dependencies? Is the approach fundamentally flawed?

### Anti-Pattern Stored

This failure pattern has been stored in semantic memory to warn future agents about similar architectural issues.

### Recommended Actions

1. STOP current approach
2. Call \`hive_check_strikes(action="get_prompt")\` for architecture review questions
3. Escalate to human for architectural decision
4. Consider re-decomposing the epic with a different strategy

**This is a learning opportunity** - the hive has discovered an edge case in task decomposition.`;

            await sendSwarmMessage({
              projectPath: process.cwd(), // Current project
              fromAgent: "hive-errors", // System agent
              toAgents: [], // Broadcast to thread
              subject: `3-STRIKE ALERT: ${args.bead_id} - Architecture Review Required`,
              body: broadcastBody,
              threadId: epicId,
              importance: "urgent",
              ackRequired: true,
            });

            broadcastSent = true;
            console.log(
              `[hive] Broadcast 3-strike alert for ${args.bead_id} to epic ${epicId}`,
            );
          } catch (error) {
            console.warn(
              `[hive] Failed to broadcast 3-strike alert: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        // Build response with anti-pattern highlighting
        const response: Record<string, unknown> = {
          bead_id: args.bead_id,
          strike_count: record.strike_count,
          is_striked_out: strikedOut,
          failures: record.failures,
          anti_pattern: strikedOut
            ? {
                stored: memoryStored,
                broadcast_sent: broadcastSent,
                highlights: [
                  "ARCHITECTURAL PROBLEM DETECTED",
                  "Pattern stored in semantic memory",
                  "All agents in epic notified",
                  "This anti-pattern will warn future hives",
                ],
                learning_signal:
                  "High-confidence negative example for decomposition strategy",
              }
            : undefined,
          message: strikedOut
            ? "STRUCK OUT: 3 strikes reached. STOP and question the architecture."
            : `Strike ${record.strike_count} recorded. ${3 - record.strike_count} remaining.`,
          warning: strikedOut
            ? "DO NOT attempt Fix #4. Call with action=get_prompt for architecture review."
            : undefined,
        };

        return JSON.stringify(response, null, 2);
      }

      case "clear": {
        await clearStrikes(args.bead_id, globalStrikeStorage);

        return JSON.stringify(
          {
            bead_id: args.bead_id,
            strike_count: 0,
            is_striked_out: false,
            message: "Strikes cleared. Fresh start.",
          },
          null,
          2,
        );
      }

      case "get_prompt": {
        const prompt = await getArchitecturePrompt(
          args.bead_id,
          globalStrikeStorage,
        );

        if (!prompt) {
          return JSON.stringify(
            {
              bead_id: args.bead_id,
              has_prompt: false,
              message: "No architecture prompt (not struck out yet)",
            },
            null,
            2,
          );
        }

        return JSON.stringify(
          {
            bead_id: args.bead_id,
            has_prompt: true,
            architecture_review_prompt: prompt,
            message:
              "Architecture review required. Present this prompt to the human partner.",
          },
          null,
          2,
        );
      }

      default:
        return JSON.stringify(
          {
            error: `Unknown action: ${args.action}`,
          },
          null,
          2,
        );
    }
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get error statistics for a bead
 * 
 * Convenience function to get error stats without using the tool directly.
 * 
 * @param beadId - Bead ID to get stats for
 * @returns Error statistics including total, unresolved, and by-type counts
 */
export async function getErrorStats(beadId: string): Promise<{
  total: number;
  unresolved: number;
  by_type: Record<string, number>;
}> {
  return globalErrorAccumulator.getErrorStats(beadId);
}

/**
 * Get formatted error context for retry prompts
 * 
 * Convenience function to get error context without using the tool directly.
 * 
 * @param beadId - Bead ID to get context for
 * @param includeResolved - Whether to include resolved errors
 * @returns Formatted error context string
 */
export async function getErrorContext(
  beadId: string,
  includeResolved = false,
): Promise<string> {
  return globalErrorAccumulator.getErrorContext(beadId, includeResolved);
}

// ============================================================================
// Export Tools
// ============================================================================

export const errorTools = {
  hive_accumulate_error,
  hive_get_error_context,
  hive_resolve_error,
  hive_check_strikes,
};
