/**
 * Hive Strikes Module - 3-Strike detection and architecture review
 *
 * Implements the 3-Strike Rule from agent best practices:
 * IF 3+ fixes have failed:
 *   STOP -> Question the architecture
 *   DON'T attempt Fix #4
 *   Discuss with human partner
 *
 * This is NOT a failed hypothesis.
 * This is a WRONG ARCHITECTURE.
 *
 * Key responsibilities:
 * - Track consecutive fix failures per bead
 * - Detect when 3-strike threshold is reached
 * - Generate architecture review prompts
 * - Store anti-patterns in semantic memory
 * - Broadcast 3-strike alerts to other agents
 *
 * @see learning.ts for core strike storage types and functions
 */

import { tool } from "@opencode-ai/plugin";

// Re-export strike types and functions from learning.ts for module consumers
export {
  StrikeRecordSchema,
  type StrikeRecord,
  type StrikeStorage,
  addStrike,
  getStrikes,
  isStrikedOut,
  getArchitecturePrompt,
  clearStrikes,
  LearningStrikeStorageAdapter,
} from "./learning";

// Import what we need internally
import {
  addStrike,
  clearStrikes,
  getArchitecturePrompt,
  getStrikes,
  isStrikedOut,
  LearningStrikeStorageAdapter,
  type StrikeStorage,
} from "./learning";
import { getStorage } from "./storage";
import { sendSwarmMessage } from "./streams/hive-mail";

// ============================================================================
// Global Strike Storage
// ============================================================================

/**
 * Global strike storage instance for tracking consecutive fix failures.
 * Uses LanceDB via LearningStorage for persistence.
 */
export const globalStrikeStorage: StrikeStorage = new LearningStrikeStorageAdapter(getStorage());

// ============================================================================
// Strike Helper Functions
// ============================================================================

/**
 * Format a 3-strike broadcast message for all agents
 *
 * Creates a detailed message explaining the architectural problem
 * and what agents should do about it.
 *
 * @param beadId - The bead that struck out
 * @param failures - Array of failed attempts
 * @returns Formatted broadcast message body
 */
export function formatStrikeBroadcastMessage(
  beadId: string,
  failures: Array<{ attempt: string; reason: string; timestamp: string }>,
): string {
  const failuresList = failures
    .map((f, i) => `${i + 1}. **${f.attempt}**\n   - Failed: ${f.reason}`)
    .join("\n\n");

  return `## Architecture Problem Detected

**Bead**: ${beadId}
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
}

/**
 * Store a 3-strike anti-pattern in semantic memory
 *
 * Records the failure pattern so future agents can be warned
 * about similar architectural issues.
 *
 * @param beadId - The bead that struck out
 * @param failures - Array of failed attempts
 * @returns Whether storage succeeded
 */
export async function storeStrikeAntiPattern(
  beadId: string,
  failures: Array<{ attempt: string; reason: string }>,
): Promise<boolean> {
  try {
    const storage = getStorage();
    const failuresList = failures
      .map((f, i) => `${i + 1}. ${f.attempt} - Failed: ${f.reason}`)
      .join("\n");

    await storage.storePattern({
      id: `anti-pattern-${beadId}-${Date.now()}`,
      content: `Architecture problem detected in ${beadId}: Task failed after 3 attempts.\nAttempts:\n${failuresList}`,
      kind: "anti_pattern",
      is_negative: true,
      success_count: 0,
      failure_count: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ["3-strike", "architecture-problem"],
      example_beads: [beadId],
      reason: "3 consecutive failures indicate structural issue requiring human decision",
    });

    console.log(`[hive-strikes] Stored anti-pattern for ${beadId}`);
    return true;
  } catch (error) {
    console.warn(
      `[hive-strikes] Failed to store anti-pattern: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Broadcast a 3-strike alert to all agents in the epic
 *
 * Sends an urgent message to the epic thread so all agents
 * are aware of the architectural problem.
 *
 * @param beadId - The bead that struck out
 * @param epicId - The epic ID for the thread
 * @param failures - Array of failed attempts
 * @param projectPath - Project path for hivemail
 * @returns Whether broadcast succeeded
 */
export async function broadcastStrikeAlert(
  beadId: string,
  epicId: string,
  failures: Array<{ attempt: string; reason: string; timestamp: string }>,
  projectPath: string = process.cwd(),
): Promise<boolean> {
  try {
    const body = formatStrikeBroadcastMessage(beadId, failures);

    await sendSwarmMessage({
      projectPath,
      fromAgent: "hive-strikes", // System agent
      toAgents: [], // Broadcast to thread
      subject: `3-STRIKE ALERT: ${beadId} - Architecture Review Required`,
      body,
      threadId: epicId,
      importance: "urgent",
      ackRequired: true,
    });

    console.log(
      `[hive-strikes] Broadcast 3-strike alert for ${beadId} to epic ${epicId}`,
    );
    return true;
  } catch (error) {
    console.warn(
      `[hive-strikes] Failed to broadcast 3-strike alert: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Extract epic ID from a bead ID
 *
 * Bead IDs can be in formats like:
 * - "bd-abc123" (epic itself)
 * - "bd-abc123.1" (subtask)
 * - "bd-abc123.1.2" (nested subtask)
 *
 * @param beadId - The bead ID to extract from
 * @returns The epic ID (first segment)
 */
export function extractEpicId(beadId: string): string {
  return beadId.includes(".") ? beadId.split(".")[0] : beadId;
}

// ============================================================================
// Tool Definition
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
        const strikedOut = await isStrikedOut(args.bead_id, globalStrikeStorage);

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

        // Store anti-pattern and broadcast on 3-strike
        let memoryStored = false;
        let broadcastSent = false;

        if (strikedOut) {
          // Store anti-pattern in semantic memory
          memoryStored = await storeStrikeAntiPattern(
            args.bead_id,
            record.failures.map((f) => ({ attempt: f.attempt, reason: f.reason })),
          );

          // Broadcast to all agents in the epic
          const epicId = extractEpicId(args.bead_id);
          broadcastSent = await broadcastStrikeAlert(
            args.bead_id,
            epicId,
            record.failures,
          );
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
// Export tools
// ============================================================================

export const strikeTools = {
  hive_check_strikes,
};
