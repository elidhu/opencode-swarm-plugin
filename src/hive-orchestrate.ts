/**
 * Hive Orchestrate Module - Status tracking and completion handling
 *
 * Handles hive execution lifecycle:
 * - Initialization and tool availability
 * - Status tracking and progress reporting
 * - Completion verification and gates
 * - Error accumulation and 3-strike detection
 * - Learning from outcomes
 *
 * Key responsibilities:
 * - hive_init - Check tools and discover skills
 * - hive_status - Query epic progress
 * - hive_progress - Report agent progress
 * - hive_complete - Verification gate and completion
 * - hive_record_outcome - Learning signals
 * - hive_broadcast - Mid-task context sharing
 * - Error accumulation tools
 * - 3-strike detection for architectural problems
 *
 * Note: Verification gate logic has been extracted to hive-verification.ts
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

// Import verification gate functions and types from hive-verification.ts
import {
  runVerificationGate,
  classifyFailure,
  type VerificationStep,
  type VerificationGateResult,
} from "./hive-verification";

// Re-export verification types and functions for backward compatibility
export {
  runVerificationGate,
  runTypecheckVerification,
  runTestVerification,
  classifyFailure,
  createVerificationPrompt,
  formatVerificationResult,
  type VerificationStep,
  type VerificationGateResult,
} from "./hive-verification";
import {
  type AgentProgress,
  AgentProgressSchema,
  type Bead,
  BeadSchema,
  type Evaluation,
  EvaluationSchema,
  type SpawnedAgent,
  type SwarmStatus,
  SwarmStatusSchema,
} from "./schemas";
import {
  getSwarmInbox,
  releaseSwarmFiles,
  sendSwarmMessage,
} from "./streams/hive-mail";
import {
  addStrike,
  clearStrikes,
  DEFAULT_LEARNING_CONFIG,
  type DecompositionStrategy as LearningDecompositionStrategy,
  ErrorAccumulator,
  type ErrorType,
  type FeedbackEvent,
  getArchitecturePrompt,
  getStrikes,
  isStrikedOut,
  LearningStrikeStorageAdapter,
  type OutcomeSignals,
  OutcomeSignalsSchema,
  outcomeToFeedback,
  type ScoredOutcome,
  scoreImplicitFeedback,
  type StrikeStorage,
} from "./learning";
import { getStorage } from "./storage";
import { getOutcomeAdapter, type UnifiedOutcome } from "./outcomes";
import {
  checkAllTools,
  formatToolAvailability,
  isToolAvailable,
  warnMissingTool,
} from "./tool-availability";
import { listSkills } from "./skills";
import {
  saveCheckpoint,
  loadCheckpoint,
  getMilestone,
  shouldAutoCheckpoint,
} from "./checkpoint";
import {
  type SwarmBeadContext,
  type CheckpointRecoverArgs,
  type DecompositionStrategy,
} from "./schemas/checkpoint";
import { spec_quick_write, loadSpec } from "./spec";

// ============================================================================
// Beads CLI Isolation for Testing
// ============================================================================

/**
 * Module-level beads working directory for test isolation.
 * When set, all bd CLI commands run in this directory instead of cwd.
 * This allows integration tests to use an ephemeral beads database.
 * 
 * Set via setBeadsTestDir() before running tests.
 * Clear with setBeadsTestDir(null) after tests.
 */
let beadsTestDir: string | null = null;

/**
 * Set the beads test directory for isolation.
 * When set, all bd CLI commands in this module run in this directory.
 * 
 * @param dir - Absolute path to temp directory with initialized beads, or null to use cwd
 */
export function setBeadsTestDir(dir: string | null): void {
  beadsTestDir = dir;
}

/**
 * Get the current beads test directory.
 */
export function getBeadsTestDir(): string | null {
  return beadsTestDir;
}

/**
 * Run a bd CLI command, respecting test isolation.
 * If beadsTestDir is set, runs command in that directory.
 * Otherwise runs in current working directory.
 */
async function runBdCommand(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cmd = Bun.$`bd ${args}`.quiet().nothrow();
  const result = beadsTestDir ? await cmd.cwd(beadsTestDir) : await cmd;
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

// ============================================================================
// Spec Generation Types (re-exported from hive-config.ts)
// ============================================================================

// Import shared config from hive-config.ts to avoid circular dependencies
// hive-prompts.ts also imports from hive-config.ts
export {
  type SpecGenerationConfig,
  DEFAULT_SPEC_CONFIG,
  type SpecGenerationDecision,
  type SubtaskForSpec,
} from "./hive-config";

// Local import for use in this module
import {
  DEFAULT_SPEC_CONFIG,
  type SpecGenerationConfig,
  type SpecGenerationDecision,
  type SubtaskForSpec,
} from "./hive-config";

// ============================================================================
// Spec Generation Helpers
// ============================================================================

/**
 * Determine if a spec should be generated for a subtask
 *
 * Decision criteria:
 * | Condition | Generate Spec? | Auto-Approve? |
 * |-----------|---------------|---------------|
 * | complexity >= 4 | Yes | No (needs review) |
 * | complexity == 3 | Yes | Yes |
 * | complexity <= 2 | No | N/A |
 * | type == "feature" | Yes | Depends on complexity |
 * | type == "bug" | No | N/A |
 * | has open questions | Yes | No |
 *
 * @param subtask - The subtask to analyze
 * @param taskType - Type of the parent task
 * @param hasOpenQuestions - Whether there are unresolved questions
 * @param config - Configuration overrides
 * @returns Decision about spec generation
 */
export function shouldGenerateSpec(
  subtask: SubtaskForSpec,
  taskType: "feature" | "epic" | "task" | "bug" | "chore" = "task",
  hasOpenQuestions: boolean = false,
  config: Partial<SpecGenerationConfig> = {},
): SpecGenerationDecision {
  const cfg = { ...DEFAULT_SPEC_CONFIG, ...config };

  // Skip types that shouldn't generate specs
  if (cfg.skip_types.includes(taskType as "bug" | "chore")) {
    return {
      should_generate: false,
      auto_approve: false,
      reasoning: `Task type '${taskType}' is configured to skip spec generation`,
      confidence: 0,
    };
  }

  const complexity = subtask.estimated_complexity;

  // Low complexity tasks don't need specs
  if (complexity < cfg.complexity_threshold) {
    return {
      should_generate: false,
      auto_approve: false,
      reasoning: `Complexity ${complexity} is below threshold ${cfg.complexity_threshold}`,
      confidence: 0,
    };
  }

  // Calculate confidence based on multiple factors
  let confidence = cfg.default_confidence;

  // Adjust confidence based on complexity clarity
  if (complexity === 3) {
    confidence = 0.85; // Medium complexity, clear scope
  } else if (complexity >= 4) {
    confidence = 0.65; // High complexity, may need review
  }

  // Open questions reduce confidence and prevent auto-approval
  if (hasOpenQuestions) {
    confidence = Math.min(confidence, 0.6); // Cap at 0.6 with open questions
    return {
      should_generate: true,
      auto_approve: false,
      reasoning: `Complexity ${complexity} triggers spec generation, but open questions prevent auto-approval`,
      confidence,
    };
  }

  // Feature/epic types always generate specs when threshold met
  if (cfg.spec_types.includes(taskType as "feature" | "epic" | "task")) {
    // Auto-approve only at medium complexity without open questions
    const autoApprove = complexity <= cfg.auto_approve_complexity;

    return {
      should_generate: true,
      auto_approve: autoApprove,
      reasoning: autoApprove
        ? `Complexity ${complexity} with type '${taskType}' qualifies for auto-approved spec`
        : `Complexity ${complexity} exceeds auto-approve threshold (${cfg.auto_approve_complexity}) - requires review`,
      confidence,
    };
  }

  // Default: generate spec but require review
  return {
    should_generate: true,
    auto_approve: false,
    reasoning: `Complexity ${complexity} triggers spec generation with human review`,
    confidence,
  };
}

/**
 * Generate a spec for a subtask using spec_quick_write
 *
 * Creates a lightweight spec from subtask information. Uses auto-approval
 * when the decision allows it.
 *
 * @param subtask - Subtask to generate spec for
 * @param epicTitle - Title of the parent epic
 * @param decision - Spec generation decision (from shouldGenerateSpec)
 * @param ctx - Tool execution context
 * @returns Spec creation result
 */
export async function generateSubtaskSpec(
  subtask: SubtaskForSpec,
  epicTitle: string,
  decision: SpecGenerationDecision,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): Promise<{
  success: boolean;
  spec_id?: string;
  auto_approved?: boolean;
  error?: string;
}> {
  if (!decision.should_generate) {
    return {
      success: false,
      error: "Spec generation not triggered",
    };
  }

  try {
    // Generate capability slug from title
    const capability = subtask.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 50);

    // Create minimal requirement from subtask description
    const requirements = [
      {
        name: subtask.title.slice(0, 50),
        type: "should" as const,
        description: subtask.description || `Implement ${subtask.title}`,
        scenarios: [
          {
            name: "Basic functionality",
            given: "The system is in its default state",
            when: `The ${subtask.title} operation is performed`,
            then: ["The operation completes successfully"],
          },
        ],
      },
    ];

    // Call spec_quick_write
    const result = await spec_quick_write.execute(
      {
        capability,
        title: `[AUTO] ${subtask.title}`,
        purpose: `Auto-generated spec for subtask in epic: ${epicTitle}. ${subtask.description || ""}`.slice(
          0,
          200,
        ),
        requirements,
        auto_approve: decision.auto_approve,
        confidence: decision.confidence,
        tags: ["auto-generated", "hive-orchestration"],
      },
      ctx,
    );

    const parsed = JSON.parse(result);

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error || "Unknown error creating spec",
      };
    }

    return {
      success: true,
      spec_id: parsed.spec_id,
      auto_approved: parsed.auto_approved,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to generate spec: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if spec generation should be triggered based on explicit flag or heuristics
 *
 * This function consolidates all spec generation triggers:
 * 1. Explicit --spec flag
 * 2. Task complexity threshold
 * 3. Task type matching
 * 4. Subtask count threshold
 *
 * @param options - Trigger evaluation options
 * @returns Whether specs should be generated
 */
export function isSpecGenerationTriggered(options: {
  explicit_flag?: boolean;
  task_complexity?: number;
  task_type?: string;
  subtask_count?: number;
  config?: Partial<SpecGenerationConfig>;
}): {
  triggered: boolean;
  reason: string;
} {
  const cfg = { ...DEFAULT_SPEC_CONFIG, ...(options.config || {}) };

  // Explicit flag takes precedence
  if (options.explicit_flag === true) {
    return {
      triggered: true,
      reason: "Explicit --spec flag provided",
    };
  }

  if (options.explicit_flag === false) {
    return {
      triggered: false,
      reason: "Spec generation explicitly disabled",
    };
  }

  // Check task type
  if (options.task_type) {
    if (cfg.skip_types.includes(options.task_type as "bug" | "chore")) {
      return {
        triggered: false,
        reason: `Task type '${options.task_type}' skips spec generation`,
      };
    }

    if (cfg.spec_types.includes(options.task_type as "feature" | "epic" | "task")) {
      // Feature/epic tasks generate specs if complexity is sufficient
      if (
        options.task_complexity !== undefined &&
        options.task_complexity >= cfg.complexity_threshold
      ) {
        return {
          triggered: true,
          reason: `Task type '${options.task_type}' with complexity ${options.task_complexity}`,
        };
      }
    }
  }

  // Check complexity threshold alone
  if (
    options.task_complexity !== undefined &&
    options.task_complexity >= cfg.complexity_threshold
  ) {
    return {
      triggered: true,
      reason: `Task complexity ${options.task_complexity} >= threshold ${cfg.complexity_threshold}`,
    };
  }

  // Check subtask count (many subtasks suggests complexity)
  if (options.subtask_count !== undefined && options.subtask_count > 5) {
    return {
      triggered: true,
      reason: `High subtask count (${options.subtask_count}) suggests complex task`,
    };
  }

  return {
    triggered: false,
    reason: "No spec generation triggers matched",
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Query beads for subtasks of an epic
 */
async function queryEpicSubtasks(epicId: string): Promise<Bead[]> {
  // Check if beads is available
  const beadsAvailable = await isToolAvailable("beads");
  if (!beadsAvailable) {
    warnMissingTool("beads");
    return []; // Return empty - hive can still function without status tracking
  }

  const result = await runBdCommand(["list", "--parent", epicId, "--json"]);

  if (result.exitCode !== 0) {
    // Don't throw - just return empty and log error prominently
    console.error(
      `[hive] ERROR: Failed to query subtasks for epic ${epicId}:`,
      result.stderr,
    );
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return z.array(BeadSchema).parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        `[hive] ERROR: Invalid bead data for epic ${epicId}:`,
        error.message,
      );
      return [];
    }
    console.error(
      `[hive] ERROR: Failed to parse beads for epic ${epicId}:`,
      error,
    );
    throw error;
  }
}

/**
 * Query Agent Mail for hive thread messages
 */
async function querySwarmMessages(
  projectKey: string,
  threadId: string,
): Promise<number> {
  // Check if hive-mail is available
  const hiveMailAvailable = await isToolAvailable("hive-mail");
  if (!hiveMailAvailable) {
    return 0;
  }

  try {
    // Use embedded hive-mail inbox to count messages in thread
    const inbox = await getSwarmInbox({
      projectPath: projectKey,
      agentName: "coordinator", // Dummy agent name for thread query
      limit: 5,
      includeBodies: false,
    });

    // Count messages that match the thread ID
    const threadMessages = inbox.messages.filter(
      (m) => m.thread_id === threadId,
    );
    return threadMessages.length;
  } catch (error) {
    // Thread might not exist yet, or query failed
    console.warn(
      `[hive] Failed to query hive messages for thread ${threadId}:`,
      error,
    );
    return 0;
  }
}

/**
 * Format a progress message for Agent Mail
 */
function formatProgressMessage(progress: AgentProgress): string {
  const lines = [
    `**Status**: ${progress.status}`,
    progress.progress_percent !== undefined
      ? `**Progress**: ${progress.progress_percent}%`
      : null,
    progress.message ? `**Message**: ${progress.message}` : null,
    progress.files_touched && progress.files_touched.length > 0
      ? `**Files touched**:\n${progress.files_touched.map((f) => `- \`${f}\``).join("\n")}`
      : null,
    progress.blockers && progress.blockers.length > 0
      ? `**Blockers**:\n${progress.blockers.map((b) => `- ${b}`).join("\n")}`
      : null,
  ];

  return lines.filter(Boolean).join("\n\n");
}

// ============================================================================
// Verification Gate (imported from hive-verification.ts)
// ============================================================================
// Note: Verification types and functions are now in hive-verification.ts
// They are imported at the top of this file and re-exported for backward compatibility

// ============================================================================
// Global Storage
// ============================================================================

/**
 * Global error accumulator for tracking errors across subtasks
 *
 * This is a session-level singleton that accumulates errors during
 * hive execution for feeding into retry prompts.
 */
const globalErrorAccumulator = new ErrorAccumulator();

/**
 * Global strike storage for tracking consecutive fix failures
 */
const globalStrikeStorage: StrikeStorage = new LearningStrikeStorageAdapter(getStorage());

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Initialize hive and check tool availability
 *
 * Call this at the start of a hive session to see what tools are available,
 * what skills exist in the project, and what features will be degraded.
 *
 * Skills are automatically discovered from:
 * - .opencode/skills/
 * - .claude/skills/
 * - skills/
 */
export const hive_init = tool({
  description:
    "Initialize hive session: discovers available skills, checks tool availability. ALWAYS call at hive start.",
  args: {
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project path (for Agent Mail init)"),
  },
  async execute(args) {
    // Check all tools
    const availability = await checkAllTools();

    // Build status report
    const report = formatToolAvailability(availability);

    // Check critical tools
    const beadsAvailable = availability.get("beads")?.status.available ?? false;
    const hiveMailAvailable =
      availability.get("hive-mail")?.status.available ?? false;

    // Build warnings
    const warnings: string[] = [];
    const degradedFeatures: string[] = [];

    if (!beadsAvailable) {
      warnings.push(
        "⚠️  beads (bd) not available - issue tracking disabled, hive coordination will be limited",
      );
      degradedFeatures.push("issue tracking", "progress persistence");
    }

    if (!hiveMailAvailable) {
      warnings.push(
        "⚠️  hive-mail not available - multi-agent communication disabled",
      );
      degradedFeatures.push("agent communication", "file reservations");
    }

    // Check semantic memory storage (embedded LanceDB)
    let storageHealthy = false;
    let storageLocation = "";
    try {
      const storage = getStorage();
      // Verify storage is working by trying to get all patterns
      await storage.getAllPatterns();
      storageHealthy = true;
      storageLocation = ".hive/vectors";
      console.log(`[hive] Storage healthy at ${storageLocation}`);
    } catch (error) {
      warnings.push(
        `⚠️  semantic-memory storage not healthy: ${error instanceof Error ? error.message : String(error)}`,
      );
      degradedFeatures.push("pattern learning", "semantic memory");
    }

    // Discover available skills
    const availableSkills = await listSkills();
    const skillsInfo = {
      count: availableSkills.length,
      available: availableSkills.length > 0,
      skills: availableSkills.map((s) => ({
        name: s.name,
        description: s.description,
        hasScripts: s.hasScripts,
      })),
    };

    // Add skills guidance if available
    let skillsGuidance: string | undefined;
    if (availableSkills.length > 0) {
      skillsGuidance = `Found ${availableSkills.length} skill(s). Use skills_list to see details, skills_use to activate.`;
    } else {
      skillsGuidance =
        "No skills found. Add skills to .opencode/skills/ or .claude/skills/ for specialized guidance.";
    }

    return JSON.stringify(
      {
        ready: true,
        tool_availability: Object.fromEntries(
          Array.from(availability.entries()).map(([k, v]) => [
            k,
            {
              available: v.status.available,
              fallback: v.status.available ? null : v.fallbackBehavior,
            },
          ]),
        ),
        storage: {
          healthy: storageHealthy,
          location: storageLocation || "unknown",
          backend: "lancedb",
        },
        skills: skillsInfo,
        warnings: warnings.length > 0 ? warnings : undefined,
        degraded_features:
          degradedFeatures.length > 0 ? degradedFeatures : undefined,
        recommendations: {
          skills: skillsGuidance,
          beads: beadsAvailable
            ? "✓ Use beads for all task tracking"
            : "Install beads: npm i -g @joelhooks/beads",
          hive_mail: hiveMailAvailable
            ? "✓ Hive Mail ready for coordination"
            : "Hive Mail will auto-initialize on first use",
          storage: storageHealthy
            ? `✓ Semantic memory ready at ${storageLocation}`
            : "⚠️  Semantic memory not available - pattern learning disabled",
        },
        report,
      },
      null,
      2,
    );
  },
});

/**
 * Get status of a hive by epic ID
 *
 * Requires project_key to query Agent Mail for message counts.
 */
export const hive_status = tool({
  description: "Get status of a hive by epic ID",
  args: {
    epic_id: tool.schema.string().describe("Epic bead ID (e.g., bd-abc123)"),
    project_key: tool.schema
      .string()
      .describe("Project path (for Agent Mail queries)"),
  },
  async execute(args) {
    // Query subtasks from beads
    const subtasks = await queryEpicSubtasks(args.epic_id);

    // Count statuses
    const statusCounts = {
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
    };

    const agents: SpawnedAgent[] = [];

    for (const bead of subtasks) {
      // Map bead status to agent status
      let agentStatus: SpawnedAgent["status"] = "pending";
      switch (bead.status) {
        case "in_progress":
          agentStatus = "running";
          statusCounts.running++;
          break;
        case "closed":
          agentStatus = "completed";
          statusCounts.completed++;
          break;
        case "blocked":
          agentStatus = "pending"; // Blocked treated as pending for hive
          statusCounts.blocked++;
          break;
        default:
          // open = pending
          break;
      }

      agents.push({
        bead_id: bead.id,
        agent_name: "", // We don't track this in beads
        status: agentStatus,
        files: [], // Would need to parse from description
      });
    }

    // Query Agent Mail for message activity
    const messageCount = await querySwarmMessages(
      args.project_key,
      args.epic_id,
    );

    const status: SwarmStatus = {
      epic_id: args.epic_id,
      total_agents: subtasks.length,
      running: statusCounts.running,
      completed: statusCounts.completed,
      failed: statusCounts.failed,
      blocked: statusCounts.blocked,
      agents,
      last_update: new Date().toISOString(),
    };

    // Validate and return
    const validated = SwarmStatusSchema.parse(status);

    return JSON.stringify(
      {
        ...validated,
        message_count: messageCount,
        progress_percent:
          subtasks.length > 0
            ? Math.round((statusCounts.completed / subtasks.length) * 100)
            : 0,
      },
      null,
      2,
    );
  },
});

/**
 * Report progress on a subtask
 *
 * Takes explicit agent identity since tools don't have persistent state.
 */
export const hive_progress = tool({
  description: "Report progress on a subtask to coordinator",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    agent_name: tool.schema.string().describe("Your Agent Mail name"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    status: tool.schema
      .enum(["in_progress", "blocked", "completed", "failed"])
      .describe("Current status"),
    message: tool.schema
      .string()
      .optional()
      .describe("Progress message or blockers"),
    progress_percent: tool.schema
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Completion percentage"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files modified so far"),
  },
  async execute(args) {
    // Build progress report
    const progress: AgentProgress = {
      bead_id: args.bead_id,
      agent_name: args.agent_name,
      status: args.status,
      progress_percent: args.progress_percent,
      message: args.message,
      files_touched: args.files_touched,
      timestamp: new Date().toISOString(),
    };

    // Validate
    const validated = AgentProgressSchema.parse(progress);

    // Update bead status if needed
    if (args.status === "blocked" || args.status === "in_progress") {
      const beadStatus = args.status === "blocked" ? "blocked" : "in_progress";
      await runBdCommand(["update", args.bead_id, "--status", beadStatus, "--json"]);
    }

    // Extract epic ID from bead ID (e.g., bd-abc123.1 -> bd-abc123)
    const epicId = args.bead_id.includes(".")
      ? args.bead_id.split(".")[0]
      : args.bead_id;

    // Send progress message to thread using embedded hive-mail
    await sendSwarmMessage({
      projectPath: args.project_key,
      fromAgent: args.agent_name,
      toAgents: [], // Coordinator will pick it up from thread
      subject: `Progress: ${args.bead_id} - ${args.status}`,
      body: formatProgressMessage(validated),
      threadId: epicId,
      importance: args.status === "blocked" ? "high" : "normal",
    });

    // Auto-checkpoint at 25/50/75% milestones
    if (args.progress_percent !== undefined) {
      // Query previous checkpoint to detect milestone crossing
      try {
        const previousCheckpoint = await loadCheckpoint(
          {
            epic_id: epicId,
            bead_id: args.bead_id,
            agent_name: args.agent_name,
          },
          args.project_key,
        );

        const previousPercent = previousCheckpoint.context?.progress_percent || 0;
        const currentPercent = args.progress_percent;

        if (shouldAutoCheckpoint(currentPercent, previousPercent)) {
          const milestone = getMilestone(currentPercent);
          console.log(
            `[hive_progress] Auto-checkpoint triggered at ${currentPercent}% (${milestone})`,
          );

          // Fire-and-forget checkpoint (non-blocking)
          saveCheckpoint(
            {
              epic_id: epicId,
              bead_id: args.bead_id,
              agent_name: args.agent_name,
              task_description: `Progress update at ${currentPercent}%`,
              files: [], // Not available in progress report
              strategy: "auto",
              progress_percent: currentPercent,
              last_milestone: milestone,
              files_touched: args.files_touched || [],
            },
            args.project_key,
          ).catch((error) => {
            console.warn(
              `[hive_progress] Auto-checkpoint failed:`,
              error instanceof Error ? error.message : String(error),
            );
          });
        }
      } catch (error) {
        // Non-fatal - checkpoint query failed
        console.warn(
          `[hive_progress] Failed to query previous checkpoint for auto-checkpoint:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return `Progress reported: ${args.status}${args.progress_percent !== undefined ? ` (${args.progress_percent}%)` : ""}`;
  },
});

/**
 * Broadcast context updates to all agents in the epic
 *
 * Enables mid-task coordination by sharing discoveries, warnings, or blockers
 * with all agents working on the same epic. Agents can broadcast without
 * waiting for task completion.
 *
 * Based on "Patterns for Building AI Agents" p.31: "Ensure subagents can share context along the way"
 */
export const hive_broadcast = tool({
  description:
    "Broadcast context update to all agents working on the same epic",
  args: {
    project_path: tool.schema
      .string()
      .describe("Absolute path to project root"),
    agent_name: tool.schema
      .string()
      .describe("Name of the agent broadcasting the message"),
    epic_id: tool.schema.string().describe("Epic ID (e.g., bd-abc123)"),
    message: tool.schema
      .string()
      .describe("Context update to share (what changed, what was learned)"),
    importance: tool.schema
      .enum(["info", "warning", "blocker"])
      .default("info")
      .describe("Priority level (default: info)"),
    files_affected: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files this context relates to"),
  },
  async execute(args) {
    // Extract bead_id from context if available (for traceability)
    const beadId = "unknown"; // Context not currently available in tool execution

    // Format the broadcast message
    const body = [
      `## Context Update`,
      "",
      `**From**: ${args.agent_name} (${beadId})`,
      `**Priority**: ${args.importance.toUpperCase()}`,
      "",
      args.message,
      "",
      args.files_affected && args.files_affected.length > 0
        ? `**Files affected**:\n${args.files_affected.map((f) => `- \`${f}\``).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Map importance to Agent Mail importance
    const mailImportance =
      args.importance === "blocker"
        ? "urgent"
        : args.importance === "warning"
          ? "high"
          : "normal";

    // Send as broadcast to thread using embedded hive-mail
    await sendSwarmMessage({
      projectPath: args.project_path,
      fromAgent: args.agent_name,
      toAgents: [], // Broadcast to thread
      subject: `[${args.importance.toUpperCase()}] Context update from ${args.agent_name}`,
      body,
      threadId: args.epic_id,
      importance: mailImportance,
      ackRequired: args.importance === "blocker",
    });

    return JSON.stringify(
      {
        broadcast: true,
        epic_id: args.epic_id,
        from: args.agent_name,
        bead_id: beadId,
        importance: args.importance,
        recipients: "all agents in epic",
        ack_required: args.importance === "blocker",
      },
      null,
      2,
    );
  },
});

/**
 * Mark a subtask as complete
 *
 * Implements the Verification Gate (from superpowers):
 * 1. IDENTIFY: What commands prove this claim?
 * 2. RUN: Execute verification (UBS, typecheck, tests)
 * 3. READ: Check exit codes and output
 * 4. VERIFY: All checks must pass
 * 5. ONLY THEN: Close the bead
 *
 * Closes bead, releases reservations, notifies coordinator.
 */
export const hive_complete = tool({
  description:
    "Mark subtask complete with Verification Gate. Runs typecheck and tests before allowing completion.",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    agent_name: tool.schema.string().describe("Your Agent Mail name"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    summary: tool.schema.string().describe("Brief summary of work done"),
    evaluation: tool.schema
      .string()
      .optional()
      .describe("Self-evaluation JSON (Evaluation schema)"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files modified - will be verified (typecheck, tests)"),
    skip_verification: tool.schema
      .boolean()
      .optional()
      .describe(
        "Skip ALL verification (typecheck, tests). Use sparingly! (default: false)",
      ),
  },
  async execute(args) {
    // Track timing for outcome recording
    const completedAt = Date.now();

    // Run Verification Gate unless explicitly skipped
    let verificationResult: VerificationGateResult | null = null;

    if (!args.skip_verification && args.files_touched?.length) {
      verificationResult = await runVerificationGate(args.files_touched);

      // Block completion if verification failed
      if (!verificationResult.passed) {
        return JSON.stringify(
          {
            success: false,
            error: "Verification Gate FAILED - fix issues before completing",
            verification: {
              passed: false,
              summary: verificationResult.summary,
              blockers: verificationResult.blockers,
              steps: verificationResult.steps.map((s) => ({
                name: s.name,
                passed: s.passed,
                skipped: s.skipped,
                skipReason: s.skipReason,
                error: s.error?.slice(0, 200),
              })),
            },
            hint:
              verificationResult.blockers.length > 0
                ? `Fix these issues: ${verificationResult.blockers.map((b, i) => `${i + 1}. ${b}`).join(", ")}. Use skip_verification=true only as last resort.`
                : "Fix the failing checks and try again. Use skip_verification=true only as last resort.",
            gate_function:
              "IDENTIFY → RUN → READ → VERIFY → CLAIM (you are at VERIFY, claim blocked)",
          },
          null,
          2,
        );
      }
    }

    // Parse and validate evaluation if provided
    let parsedEvaluation: Evaluation | undefined;
    if (args.evaluation) {
      try {
        parsedEvaluation = EvaluationSchema.parse(JSON.parse(args.evaluation));
      } catch (error) {
        return JSON.stringify(
          {
            success: false,
            error: "Invalid evaluation format",
            details: error instanceof z.ZodError ? error.issues : String(error),
          },
          null,
          2,
        );
      }

      // If evaluation failed, don't complete
      if (!parsedEvaluation.passed) {
        return JSON.stringify(
          {
            success: false,
            error: "Self-evaluation failed",
            retry_suggestion: parsedEvaluation.retry_suggestion,
            feedback: parsedEvaluation.overall_feedback,
          },
          null,
          2,
        );
      }
    }

    // Close the bead
    const closeResult = await runBdCommand([
      "close", args.bead_id, "--reason", args.summary, "--json"
    ]);

    if (closeResult.exitCode !== 0) {
      throw new Error(
        `Failed to close bead because bd close command failed: ${closeResult.stderr}. Try: Verify bead exists and is not already closed with 'bd show ${args.bead_id}', check if bead ID is correct with 'beads_query()', or use beads_close tool directly.`,
      );
    }

    // Release file reservations for this agent using embedded hive-mail
    try {
      await releaseSwarmFiles({
        projectPath: args.project_key,
        agentName: args.agent_name,
        // Release all reservations for this agent
      });
    } catch (error) {
      // Release might fail (e.g., no reservations existed)
      // This is non-fatal - log and continue
      console.warn(
        `[hive] Failed to release file reservations for ${args.agent_name}:`,
        error,
      );
    }

    // Extract epic ID
    const epicId = args.bead_id.includes(".")
      ? args.bead_id.split(".")[0]
      : args.bead_id;

    // Send completion message using embedded hive-mail
    const completionBody = [
      `## Subtask Complete: ${args.bead_id}`,
      "",
      `**Summary**: ${args.summary}`,
      "",
      parsedEvaluation
        ? `**Self-Evaluation**: ${parsedEvaluation.passed ? "PASSED" : "FAILED"}`
        : "",
      parsedEvaluation?.overall_feedback
        ? `**Feedback**: ${parsedEvaluation.overall_feedback}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sendSwarmMessage({
      projectPath: args.project_key,
      fromAgent: args.agent_name,
      toAgents: [], // Thread broadcast
      subject: `Complete: ${args.bead_id}`,
      body: completionBody,
      threadId: epicId,
      importance: "normal",
    });

    // Store successful pattern in semantic memory
    let memoryStored = false;
    try {
      const storage = getStorage();
      await storage.storePattern({
        id: `pattern-${args.bead_id}-${Date.now()}`,
        content: `Task "${args.bead_id}" completed: ${args.summary}`,
        kind: "pattern",
        is_negative: false,
        success_count: 1,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: args.files_touched || [],
        example_beads: [args.bead_id],
      });
      memoryStored = true;
      console.log(`[hive] Stored success pattern for ${args.bead_id}`);
    } catch (error) {
      console.warn(
        `[hive] Failed to store success pattern: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Record outcome to unified outcome adapter (writes to both learning and eval-capture)
    let outcomeRecorded = false;
    try {
      const outcome: UnifiedOutcome = {
        bead_id: args.bead_id,
        epic_id: epicId,
        duration_ms: 0, // Unknown - would need bead start time tracking
        error_count: 0, // Success case
        retry_count: 0, // Not tracked in current flow
        success: true,
        files_touched: args.files_touched || [],
        started_at: completedAt, // Unknown - using completed_at as fallback
        completed_at: completedAt,
        title: args.summary,
        agent_name: args.agent_name,
        // strategy and failure_mode not available in current flow
      };

      const adapter = getOutcomeAdapter();
      await adapter.recordOutcome(outcome);
      outcomeRecorded = true;
      console.log(`[hive] Recorded outcome for ${args.bead_id} to both systems`);
    } catch (error) {
      console.warn(
        `[hive] Failed to record outcome: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Build success response with memory storage status
    const response = {
      success: true,
      bead_id: args.bead_id,
      closed: true,
      reservations_released: true,
      message_sent: true,
      memory_stored: memoryStored,
      outcome_recorded: outcomeRecorded,
      verification_gate: verificationResult
        ? {
            passed: true,
            summary: verificationResult.summary,
            steps: verificationResult.steps.map((s) => ({
              name: s.name,
              passed: s.passed,
              skipped: s.skipped,
              skipReason: s.skipReason,
            })),
          }
        : args.skip_verification
          ? { skipped: true, reason: "skip_verification=true" }
          : { skipped: true, reason: "no files_touched provided" },
      learning_prompt: `## Reflection

Did you learn anything reusable during this subtask? Consider:

1. **Patterns**: Any code patterns or approaches that worked well?
2. **Gotchas**: Edge cases or pitfalls to warn future agents about?
3. **Best Practices**: Domain-specific guidelines worth documenting?
4. **Tool Usage**: Effective ways to use tools for this type of task?

If you discovered something valuable, use \`hive_learn\` or \`skills_create\` to preserve it as a skill for future hives.

Files touched: ${args.files_touched?.join(", ") || "none recorded"}`,
    };

    return JSON.stringify(response, null, 2);
  },
});

/**
 * Record outcome signals from a completed subtask
 *
 * Tracks implicit feedback (duration, errors, retries) to score
 * decomposition quality over time. This data feeds into criterion
 * weight calculations.
 *
 * Strategy tracking enables learning about which decomposition strategies
 * work best for different task types.
 *
 * @see src/learning.ts for scoring logic
 */
export const hive_record_outcome = tool({
  description:
    "Record subtask outcome for implicit feedback scoring. Tracks duration, errors, retries to learn decomposition quality.",
  args: {
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    duration_ms: tool.schema
      .number()
      .int()
      .min(0)
      .describe("Duration in milliseconds"),
    error_count: tool.schema
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of errors encountered"),
    retry_count: tool.schema
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of retry attempts"),
    success: tool.schema.boolean().describe("Whether the subtask succeeded"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files that were modified"),
    criteria: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Criteria to generate feedback for (default: all default criteria)",
      ),
    strategy: tool.schema
      .enum(["file-based", "feature-based", "risk-based", "research-based"])
      .optional()
      .describe("Decomposition strategy used for this task"),
    failure_mode: tool.schema
      .enum([
        "timeout",
        "conflict",
        "validation",
        "tool_failure",
        "context_overflow",
        "dependency_blocked",
        "user_cancelled",
        "unknown",
      ])
      .optional()
      .describe(
        "Failure classification (only when success=false). Auto-classified if not provided.",
      ),
    failure_details: tool.schema
      .string()
      .optional()
      .describe("Detailed failure context (error message, stack trace, etc.)"),
  },
  async execute(args) {
    // Build outcome signals
    const signals: OutcomeSignals = {
      bead_id: args.bead_id,
      duration_ms: args.duration_ms,
      error_count: args.error_count ?? 0,
      retry_count: args.retry_count ?? 0,
      success: args.success,
      files_touched: args.files_touched ?? [],
      timestamp: new Date().toISOString(),
      strategy: args.strategy as LearningDecompositionStrategy | undefined,
      failure_mode: args.failure_mode,
      failure_details: args.failure_details,
    };

    // If task failed but no failure_mode provided, try to classify from failure_details
    if (!args.success && !args.failure_mode && args.failure_details) {
      const classified = classifyFailure(args.failure_details);
      signals.failure_mode = classified as OutcomeSignals["failure_mode"];
    }

    // Validate signals
    const validated = OutcomeSignalsSchema.parse(signals);

    // Score the outcome
    const scored: ScoredOutcome = scoreImplicitFeedback(
      validated,
      DEFAULT_LEARNING_CONFIG,
    );

    // Get error patterns from accumulator
    const errorStats = await globalErrorAccumulator.getErrorStats(args.bead_id);

    // Generate feedback events for each criterion
    const criteriaToScore = args.criteria ?? [
      "type_safe",
      "no_bugs",
      "patterns",
      "readable",
    ];
    const feedbackEvents: FeedbackEvent[] = criteriaToScore.map((criterion) => {
      const event = outcomeToFeedback(scored, criterion);
      // Include strategy in feedback context for future analysis
      if (args.strategy) {
        event.context =
          `${event.context || ""} [strategy: ${args.strategy}]`.trim();
      }
      // Include error patterns in feedback context
      if (errorStats.total > 0) {
        const errorSummary = Object.entries(errorStats.by_type)
          .map(([type, count]) => `${type}:${count}`)
          .join(", ");
        event.context =
          `${event.context || ""} [errors: ${errorSummary}]`.trim();
      }
      return event;
    });

    return JSON.stringify(
      {
        success: true,
        outcome: {
          signals: validated,
          scored: {
            type: scored.type,
            decayed_value: scored.decayed_value,
            reasoning: scored.reasoning,
          },
        },
        feedback_events: feedbackEvents,
        error_patterns: errorStats,
        summary: {
          feedback_type: scored.type,
          duration_seconds: Math.round(args.duration_ms / 1000),
          error_count: args.error_count ?? 0,
          retry_count: args.retry_count ?? 0,
          success: args.success,
          strategy: args.strategy,
          failure_mode: validated.failure_mode,
          failure_details: validated.failure_details,
          accumulated_errors: errorStats.total,
          unresolved_errors: errorStats.unresolved,
        },
        note: "Feedback events should be stored for criterion weight calculation. Use learning.ts functions to apply weights.",
      },
      null,
      2,
    );
  },
});

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

/**
 * Check if a bead has struck out (3 consecutive failures)
 *
 * The 3-Strike Rule:
 * IF 3+ fixes have failed:
 *   STOP → Question the architecture
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
              ? "⚠️ STRUCK OUT: 3 strikes reached. Use get_prompt action for architecture review."
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

            const broadcastBody = `## 🚨 Architecture Problem Detected

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
              fromAgent: "hive-orchestrate", // System agent
              toAgents: [], // Broadcast to thread
              subject: `🚨 3-STRIKE ALERT: ${args.bead_id} - Architecture Review Required`,
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
                  "🚨 ARCHITECTURAL PROBLEM DETECTED",
                  "Pattern stored in semantic memory",
                  "All agents in epic notified",
                  "This anti-pattern will warn future hives",
                ],
                learning_signal:
                  "High-confidence negative example for decomposition strategy",
              }
            : undefined,
          message: strikedOut
            ? "⚠️ STRUCK OUT: 3 strikes reached. STOP and question the architecture."
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

/**
 * Save a checkpoint for crash recovery
 *
 * Stores the current agent state (files, progress, directives) to enable
 * recovery after crashes. Uses dual-write pattern:
 * 1. Event stream for audit trail
 * 2. Table for fast O(1) queries
 *
 * Auto-checkpointing happens at 25/50/75% via hive_progress.
 */
export const hive_checkpoint = tool({
  description:
    "Save checkpoint for crash recovery. Stores agent state (files, progress, directives) for resumption.",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    agent_name: tool.schema.string().describe("Your Agent Mail name"),
    epic_id: tool.schema.string().describe("Epic bead ID"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    task_description: tool.schema.string().describe("Task description"),
    files: tool.schema
      .array(tool.schema.string())
      .describe("Files this agent is modifying"),
    strategy: tool.schema
      .enum(["file-based", "feature-based", "risk-based", "auto"])
      .describe("Decomposition strategy used"),
    shared_context: tool.schema
      .string()
      .optional()
      .describe("Shared context from decomposition"),
    directives: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Progress directives and instructions"),
    progress_percent: tool.schema
      .number()
      .min(0)
      .max(100)
      .default(0)
      .describe("Current progress percentage (0-100)"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files modified so far"),
  },
  async execute(args) {
    try {
      const context = await saveCheckpoint(
        {
          epic_id: args.epic_id,
          bead_id: args.bead_id,
          agent_name: args.agent_name,
          task_description: args.task_description,
          files: args.files,
          strategy: args.strategy as DecompositionStrategy,
          shared_context: args.shared_context,
          directives: args.directives,
          progress_percent: args.progress_percent || 0,
          last_milestone: getMilestone(args.progress_percent || 0),
          files_touched: args.files_touched,
        },
        args.project_key,
      );

      return JSON.stringify(
        {
          success: true,
          checkpoint_id: `${args.bead_id}-${context.checkpointed_at}`,
          bead_id: args.bead_id,
          progress_percent: context.progress_percent,
          milestone: context.last_milestone,
          checkpointed_at: context.checkpointed_at,
          message: `Checkpoint saved at ${context.progress_percent}%`,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      );
    }
  },
});

/**
 * Recover from a checkpoint after crash
 *
 * Queries the latest checkpoint for a bead and returns the saved context.
 * If no checkpoint exists, returns fresh_start=true.
 *
 * Records a checkpoint_recovered event for audit trail.
 */
export const hive_recover = tool({
  description:
    "Recover from checkpoint after crash. Returns latest saved context or indicates fresh start.",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    epic_id: tool.schema.string().describe("Epic bead ID"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    agent_name: tool.schema
      .string()
      .optional()
      .describe("Optional agent name filter"),
  },
  async execute(args) {
    try {
      const result = await loadCheckpoint(
        {
          epic_id: args.epic_id,
          bead_id: args.bead_id,
          agent_name: args.agent_name,
        },
        args.project_key,
      );

      if (!result.success) {
        return JSON.stringify(
          {
            success: false,
            error: result.error,
            fresh_start: false,
          },
          null,
          2,
        );
      }

      if (result.fresh_start) {
        return JSON.stringify(
          {
            success: true,
            fresh_start: true,
            message: "No checkpoint found - starting fresh",
          },
          null,
          2,
        );
      }

      const context = result.context!;

      return JSON.stringify(
        {
          success: true,
          fresh_start: false,
          context: {
            bead_id: context.bead_id,
            epic_id: context.epic_id,
            agent_name: context.agent_name,
            task_description: context.task_description,
            files: context.files,
            strategy: context.strategy,
            shared_context: context.shared_context,
            directives: context.directives,
            progress_percent: context.progress_percent,
            last_milestone: context.last_milestone,
            files_touched: context.files_touched,
            checkpointed_at: context.checkpointed_at,
          },
          message: `Recovered from ${context.progress_percent}% (${context.last_milestone || "no milestone"})`,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      );
    }
  },
});

/**
 * Learn from completed work and optionally create a skill
 *
 * This tool helps agents reflect on patterns, best practices, or domain
 * knowledge discovered during task execution and codify them into reusable
 * skills for future hives.
 *
 * Implements the "learning hive" pattern where hives get smarter over time.
 */
export const hive_learn = tool({
  description: `Analyze completed work and optionally create a skill from learned patterns.

Use after completing a subtask when you've discovered:
- Reusable code patterns or approaches
- Domain-specific best practices
- Gotchas or edge cases to warn about
- Effective tool usage patterns

This tool helps you formalize learnings into a skill that future agents can discover and use.`,
  args: {
    summary: tool.schema
      .string()
      .describe("Brief summary of what was learned (1-2 sentences)"),
    pattern_type: tool.schema
      .enum([
        "code-pattern",
        "best-practice",
        "gotcha",
        "tool-usage",
        "domain-knowledge",
        "workflow",
      ])
      .describe("Category of the learning"),
    details: tool.schema
      .string()
      .describe("Detailed explanation of the pattern or practice"),
    example: tool.schema
      .string()
      .optional()
      .describe("Code example or concrete illustration"),
    when_to_use: tool.schema
      .string()
      .describe("When should an agent apply this knowledge?"),
    files_context: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files that exemplify this pattern"),
    create_skill: tool.schema
      .boolean()
      .optional()
      .describe(
        "Create a skill from this learning (default: false, just document)",
      ),
    skill_name: tool.schema
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(64)
      .optional()
      .describe("Skill name if creating (required if create_skill=true)"),
    skill_tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags for the skill if creating"),
  },
  async execute(args) {
    // Format the learning as structured documentation
    const learning = {
      summary: args.summary,
      type: args.pattern_type,
      details: args.details,
      example: args.example,
      when_to_use: args.when_to_use,
      files_context: args.files_context,
      recorded_at: new Date().toISOString(),
    };

    // If creating a skill, generate and create it
    if (args.create_skill) {
      if (!args.skill_name) {
        return JSON.stringify(
          {
            success: false,
            error: "skill_name is required when create_skill=true",
            learning: learning,
          },
          null,
          2,
        );
      }

      // Build skill body from learning
      const skillBody = `# ${args.summary}

## When to Use
${args.when_to_use}

## ${args.pattern_type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}

${args.details}

${args.example ? `## Example\n\n\`\`\`\n${args.example}\n\`\`\`\n` : ""}
${args.files_context && args.files_context.length > 0 ? `## Reference Files\n\n${args.files_context.map((f) => `- \`${f}\``).join("\n")}\n` : ""}

---
*Learned from hive execution on ${new Date().toISOString().split("T")[0]}*`;

      // Import skills_create functionality
      const { getSkill, invalidateSkillsCache } = await import("./skills");
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      // Check if skill exists
      const existing = await getSkill(args.skill_name);
      if (existing) {
        return JSON.stringify(
          {
            success: false,
            error: `Skill '${args.skill_name}' already exists`,
            existing_path: existing.path,
            learning: learning,
            suggestion:
              "Use skills_update to add to existing skill, or choose a different name",
          },
          null,
          2,
        );
      }

      // Create skill directory and file
      const skillDir = join(
        process.cwd(),
        ".opencode",
        "skills",
        args.skill_name,
      );
      const skillPath = join(skillDir, "SKILL.md");

      const frontmatter = [
        "---",
        `name: ${args.skill_name}`,
        `description: ${args.when_to_use.slice(0, 200)}${args.when_to_use.length > 200 ? "..." : ""}`,
        "tags:",
        `  - ${args.pattern_type}`,
        `  - learned`,
        ...(args.skill_tags || []).map((t) => `  - ${t}`),
        "---",
      ].join("\n");

      try {
        await mkdir(skillDir, { recursive: true });
        await writeFile(skillPath, `${frontmatter}\n\n${skillBody}`, "utf-8");
        invalidateSkillsCache();

        return JSON.stringify(
          {
            success: true,
            skill_created: true,
            skill: {
              name: args.skill_name,
              path: skillPath,
              type: args.pattern_type,
            },
            learning: learning,
            message: `Created skill '${args.skill_name}' from learned pattern. Future agents can discover it with skills_list.`,
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify(
          {
            success: false,
            error: `Failed to create skill: ${error instanceof Error ? error.message : String(error)}`,
            learning: learning,
          },
          null,
          2,
        );
      }
    }

    // Just document the learning without creating a skill
    return JSON.stringify(
      {
        success: true,
        skill_created: false,
        learning: learning,
        message:
          "Learning documented. Use create_skill=true to persist as a skill for future agents.",
        suggested_skill_name:
          args.skill_name ||
          args.summary
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 64),
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Single-Task Traceability Tools
// ============================================================================

/**
 * Create a tracking bead for single-agent work
 *
 * Philosophy: "Even simple tasks deserve observability"
 *
 * This tool enables single-agent tasks to participate in the same
 * observability infrastructure as full hive decompositions:
 * - Creates a task bead for tracking
 * - Enables checkpointing for crash recovery
 * - Integrates with hive_progress, hive_checkpoint, hive_complete
 * - Stores success patterns on completion
 *
 * Use this when:
 * - Working on a task that doesn't need multi-agent decomposition
 * - You want crash recovery and progress tracking
 * - The task might spawn child tasks as complexity emerges
 *
 * @example
 * ```typescript
 * // Start tracking a single task
 * const result = await hive_track_single({
 *   project_key: "/path/to/project",
 *   task_description: "Implement login feature",
 *   files: ["src/auth.ts", "src/login.tsx"],
 *   priority: 1,
 * });
 *
 * // Use the returned bead_id with other hive tools
 * await hive_progress({ bead_id: result.bead_id, ... });
 * await hive_complete({ bead_id: result.bead_id, ... });
 * ```
 */
export const hive_track_single = tool({
  description: `Create a tracking bead for single-agent work. 

Philosophy: "Even simple tasks deserve observability"

Use this to get crash recovery, progress tracking, and pattern learning for tasks that don't need full hive decomposition. Returns a bead_id that integrates with hive_progress, hive_checkpoint, and hive_complete.`,
  args: {
    project_key: tool.schema.string().describe("Project path (absolute path to project root)"),
    task_description: tool.schema.string().describe("Description of the task you're working on"),
    files: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files you expect to modify (enables checkpointing)"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("Task priority 0-3 (default: 2, lower = higher priority)"),
    agent_name: tool.schema
      .string()
      .optional()
      .describe("Agent name for tracking (auto-generated if not provided)"),
  },
  async execute(args) {
    // Generate agent name if not provided
    const agentName = args.agent_name || `single-${Date.now().toString(36)}`;
    
    // Create the tracking bead using bd CLI
    const createArgs = [
      "create",
      args.task_description.slice(0, 100), // Title (truncated)
      "-t", "task",
      "-p", String(args.priority ?? 2),
      "-d", `Single-agent tracked task.\n\nAgent: ${agentName}\nFiles: ${args.files?.join(", ") || "none specified"}`,
      "--json",
    ];

    const result = await runBdCommand(createArgs);

    if (result.exitCode !== 0) {
      // Check if beads is initialized
      const initCheck = await runBdCommand(["list", "--json"]);
      if (initCheck.exitCode !== 0) {
        return JSON.stringify(
          {
            success: false,
            error: "Beads not initialized",
            hint: "Run 'bd init' in the project root to initialize beads tracking",
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          success: false,
          error: `Failed to create tracking bead: ${result.stderr}`,
          hint: "Check if bd CLI is installed and working with 'bd --version'",
        },
        null,
        2,
      );
    }

    // Parse the created bead
    const stdout = result.stdout.trim();
    let bead: { id: string; title: string; status: string };
    try {
      const parsed = JSON.parse(stdout);
      bead = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to parse bead response: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }

    // Save initial checkpoint for recovery support
    let checkpointSaved = false;
    try {
      await saveCheckpoint(
        {
          epic_id: bead.id, // Single tasks are their own "epic"
          bead_id: bead.id,
          agent_name: agentName,
          task_description: args.task_description,
          files: args.files || [],
          strategy: "auto", // Single tasks use auto strategy
          progress_percent: 0,
          last_milestone: "started",
          files_touched: [],
        },
        args.project_key,
      );
      checkpointSaved = true;
    } catch (error) {
      // Non-fatal - just log warning
      console.warn(
        `[hive_track_single] Failed to save initial checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Mark bead as in-progress
    await runBdCommand(["update", bead.id, "--status", "in_progress", "--json"]);

    return JSON.stringify(
      {
        success: true,
        bead_id: bead.id,
        agent_name: agentName,
        task_description: args.task_description,
        files: args.files || [],
        checkpoint_enabled: checkpointSaved,
        next_steps: [
          `Use hive_progress(bead_id="${bead.id}", ...) to report progress`,
          `Use hive_checkpoint(bead_id="${bead.id}", ...) for manual checkpoints`,
          `Use hive_spawn_child(parent_bead_id="${bead.id}", ...) if complexity emerges`,
          `Use hive_complete(bead_id="${bead.id}", ...) when done`,
        ],
        philosophy: "Even simple tasks deserve observability",
      },
      null,
      2,
    );
  },
});

/**
 * Create a child bead under a parent for emergent work
 *
 * Philosophy: "Complexity emerges - capture it"
 *
 * This tool enables self-organizing task structure. When working on a task,
 * you may discover additional work that needs tracking. Rather than losing
 * this insight, you can spawn a child bead to capture the emergent complexity.
 *
 * Key behaviors:
 * - Creates child bead linked to parent
 * - Logs discovery via hivemail to coordinator thread
 * - Returns child_bead_id for independent tracking
 * - Enables recursive decomposition without coordinator overhead
 *
 * Use this when:
 * - You discover a subtask while working
 * - A bug is found that needs separate tracking
 * - The task naturally decomposes into parts
 * - You want to parallelize by spawning work for other agents
 *
 * @example
 * ```typescript
 * // Working on a feature, discover a bug
 * const child = await hive_spawn_child({
 *   parent_bead_id: "bd-abc123",
 *   title: "Fix null pointer in auth handler",
 *   description: "Discovered while implementing login - auth.ts line 42",
 *   type: "bug",
 * });
 *
 * // Child is now tracked separately
 * await hive_progress({ bead_id: child.child_bead_id, ... });
 * ```
 */
export const hive_spawn_child = tool({
  description: `Create a child bead under a parent for emergent work.

Philosophy: "Complexity emerges - capture it"

Use this when you discover subtasks, bugs, or additional work while executing a task. Creates a child bead, notifies the coordinator, and returns the child_bead_id for tracking.`,
  args: {
    parent_bead_id: tool.schema.string().describe("Parent bead ID to create child under"),
    title: tool.schema.string().describe("Title of the child task"),
    description: tool.schema
      .string()
      .optional()
      .describe("Description of what needs to be done"),
    files: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files related to this child task"),
    type: tool.schema
      .enum(["task", "bug", "chore"])
      .default("task")
      .describe("Type of work (default: task)"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("Priority 0-3 (inherits from parent if not specified)"),
    agent_name: tool.schema
      .string()
      .optional()
      .describe("Agent name for tracking"),
    project_key: tool.schema
      .string()
      .optional()
      .describe("Project path (defaults to cwd)"),
  },
  async execute(args) {
    const projectKey = args.project_key || process.cwd();
    const agentName = args.agent_name || `spawner-${Date.now().toString(36)}`;

    // Extract epic ID from parent (for thread notifications)
    // e.g., "bd-abc123.1" -> "bd-abc123", or "bd-abc123" -> "bd-abc123"
    const epicId = args.parent_bead_id.includes(".")
      ? args.parent_bead_id.split(".")[0]
      : args.parent_bead_id;

    // Build description with context
    const description = [
      args.description || "",
      "",
      `Spawned from: ${args.parent_bead_id}`,
      args.files && args.files.length > 0
        ? `Files: ${args.files.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Create child bead using bd CLI
    const createArgs = [
      "create",
      args.title,
      "-t", args.type || "task",
      "-p", String(args.priority ?? 2),
      "-d", description,
      "--parent", args.parent_bead_id,
      "--json",
    ];

    const result = await runBdCommand(createArgs);

    if (result.exitCode !== 0) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to create child bead: ${result.stderr}`,
          hint: "Verify parent bead exists with 'bd show " + args.parent_bead_id + "'",
        },
        null,
        2,
      );
    }

    // Parse the created bead
    const stdout = result.stdout.trim();
    let childBead: { id: string; title: string; status: string; type: string };
    try {
      const parsed = JSON.parse(stdout);
      childBead = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to parse bead response: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }

    // Send discovery notification to coordinator thread
    let notificationSent = false;
    try {
      const discoveryBody = `## Child Task Discovered

**Parent**: ${args.parent_bead_id}
**Child**: ${childBead.id}
**Type**: ${args.type || "task"}
**Title**: ${args.title}

${args.description ? `**Description**: ${args.description}\n` : ""}
${args.files && args.files.length > 0 ? `**Files**: ${args.files.map((f) => `\`${f}\``).join(", ")}\n` : ""}

### Context

This child was spawned during task execution, indicating emergent complexity.
The agent discovered work that benefits from separate tracking.

### Philosophy

"Complexity emerges - capture it"

Self-organizing task structure allows the hive to adapt without coordinator overhead.`;

      await sendSwarmMessage({
        projectPath: projectKey,
        fromAgent: agentName,
        toAgents: [], // Broadcast to thread
        subject: `Discovery: ${childBead.id} spawned from ${args.parent_bead_id}`,
        body: discoveryBody,
        threadId: epicId,
        importance: args.type === "bug" ? "high" : "normal",
      });

      notificationSent = true;
    } catch (error) {
      // Non-fatal - just log warning
      console.warn(
        `[hive_spawn_child] Failed to send discovery notification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Store discovery pattern in semantic memory
    let memoryStored = false;
    try {
      const storage = getStorage();
      await storage.storePattern({
        id: `discovery-${childBead.id}-${Date.now()}`,
        content: `Child ${args.type || "task"} "${args.title}" discovered during ${args.parent_bead_id}. ${args.description || ""}`,
        kind: "pattern", // Discoveries are positive patterns (emergent complexity is expected)
        is_negative: false,
        success_count: 0,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["emergent", "discovery", args.type || "task", ...(args.files || [])],
        example_beads: [args.parent_bead_id, childBead.id],
      });
      memoryStored = true;
    } catch (error) {
      // Non-fatal - just log warning
      console.warn(
        `[hive_spawn_child] Failed to store discovery pattern: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return JSON.stringify(
      {
        success: true,
        child_bead_id: childBead.id,
        parent_bead_id: args.parent_bead_id,
        epic_id: epicId,
        type: childBead.type,
        title: args.title,
        notification_sent: notificationSent,
        memory_stored: memoryStored,
        next_steps: [
          `Use hive_progress(bead_id="${childBead.id}", ...) to track child progress`,
          `Use hive_complete(bead_id="${childBead.id}", ...) when child is done`,
          `Parent ${args.parent_bead_id} can continue independently`,
        ],
        philosophy: "Complexity emerges - capture it",
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Spec-Aware Orchestration Tools
// ============================================================================

/**
 * Generate specs for subtasks during orchestration
 *
 * This tool integrates spec generation into the hive orchestration flow.
 * Call after decomposition to optionally create specs for complex subtasks.
 *
 * Spec generation is triggered when:
 * - explicit_spec=true flag is passed
 * - Task complexity >= 3
 * - Task type is "feature" or "epic"
 * - Subtask count > 5
 *
 * Auto-approval happens when:
 * - Complexity == 3 AND no open questions
 * - explicit auto_approve=true
 *
 * @example
 * ```typescript
 * // After decomposition
 * const decomposition = await hive_decompose(...);
 *
 * // Generate specs for complex subtasks
 * const specResult = await hive_generate_specs({
 *   epic_title: "Add OAuth support",
 *   subtasks: decomposition.subtasks,
 *   task_type: "feature",
 * });
 * ```
 */
export const hive_generate_specs = tool({
  description: `Generate specs for subtasks during orchestration. Integrates spec_quick_write with complexity-based triggers.

Use after hive_decompose to create specs for complex subtasks. Specs are auto-approved when complexity=3 and no open questions exist.

Triggers:
- explicit_spec=true
- complexity >= 3
- task type is "feature" or "epic"
- subtask count > 5`,
  args: {
    epic_title: tool.schema.string().describe("Title of the parent epic"),
    subtasks: tool.schema
      .array(
        tool.schema.object({
          title: tool.schema.string(),
          description: tool.schema.string().optional(),
          files: tool.schema.array(tool.schema.string()),
          estimated_complexity: tool.schema.number().min(1).max(5),
          dependencies: tool.schema.array(tool.schema.number()).optional(),
        }),
      )
      .describe("Subtasks from decomposition"),
    task_type: tool.schema
      .enum(["feature", "epic", "task", "bug", "chore"])
      .default("task")
      .describe("Type of the parent task"),
    explicit_spec: tool.schema
      .boolean()
      .optional()
      .describe("Explicitly trigger spec generation for all subtasks"),
    open_questions: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Open questions that prevent auto-approval"),
    config: tool.schema
      .object({
        complexity_threshold: tool.schema.number().optional(),
        auto_approve_complexity: tool.schema.number().optional(),
        default_confidence: tool.schema.number().optional(),
      })
      .optional()
      .describe("Override default spec generation config"),
  },
  async execute(args, ctx) {
    // Check if spec generation is triggered at all
    const triggerCheck = isSpecGenerationTriggered({
      explicit_flag: args.explicit_spec,
      task_type: args.task_type,
      subtask_count: args.subtasks.length,
      config: args.config,
    });

    if (!triggerCheck.triggered) {
      return JSON.stringify(
        {
          success: true,
          specs_generated: 0,
          reason: triggerCheck.reason,
          subtasks_analyzed: args.subtasks.length,
          message: "No specs generated - triggers not met",
        },
        null,
        2,
      );
    }

    const hasOpenQuestions =
      args.open_questions !== undefined && args.open_questions.length > 0;

    const results: Array<{
      subtask_title: string;
      decision: SpecGenerationDecision;
      spec_id?: string;
      auto_approved?: boolean;
      error?: string;
    }> = [];

    // Process each subtask
    for (const subtask of args.subtasks) {
      // Determine if this specific subtask should get a spec
      const decision = shouldGenerateSpec(
        subtask,
        args.task_type,
        hasOpenQuestions,
        args.config,
      );

      if (decision.should_generate) {
        // Generate the spec
        const specResult = await generateSubtaskSpec(
          subtask,
          args.epic_title,
          decision,
          ctx,
        );

        results.push({
          subtask_title: subtask.title,
          decision,
          spec_id: specResult.spec_id,
          auto_approved: specResult.auto_approved,
          error: specResult.error,
        });
      } else {
        results.push({
          subtask_title: subtask.title,
          decision,
        });
      }
    }

    // Summarize results
    const specsGenerated = results.filter((r) => r.spec_id).length;
    const autoApproved = results.filter((r) => r.auto_approved).length;
    const needsReview = specsGenerated - autoApproved;
    const skipped = results.filter((r) => !r.decision.should_generate).length;

    return JSON.stringify(
      {
        success: true,
        trigger_reason: triggerCheck.reason,
        specs_generated: specsGenerated,
        auto_approved: autoApproved,
        needs_review: needsReview,
        skipped,
        has_open_questions: hasOpenQuestions,
        results: results.map((r) => ({
          subtask: r.subtask_title,
          generated: !!r.spec_id,
          spec_id: r.spec_id,
          auto_approved: r.auto_approved,
          reasoning: r.decision.reasoning,
          confidence: r.decision.confidence,
          error: r.error,
        })),
        next_steps:
          needsReview > 0
            ? [
                `${needsReview} spec(s) require human review`,
                "Use spec_query(status='draft') to list pending specs",
                "Use spec_submit() to submit specs for review",
              ]
            : specsGenerated > 0
              ? [
                  `${autoApproved} spec(s) auto-approved`,
                  "Specs are ready for implementation",
                  "Use spec_implement() when ready",
                ]
              : ["No specs generated for these subtasks"],
      },
      null,
      2,
    );
  },
});

/**
 * Check if a task should trigger spec generation
 *
 * Lightweight check to determine if specs should be generated without
 * actually creating them. Use before decomposition to inform the planning.
 */
export const hive_check_spec_trigger = tool({
  description: `Check if a task should trigger spec generation. Use before decomposition to inform planning.

Returns trigger status without generating specs. Useful for understanding when spec_quick_write should be used.`,
  args: {
    task_description: tool.schema.string().describe("Task being analyzed"),
    task_type: tool.schema
      .enum(["feature", "epic", "task", "bug", "chore"])
      .default("task")
      .describe("Type of task"),
    estimated_complexity: tool.schema
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe("Estimated complexity (1-5)"),
    subtask_count: tool.schema
      .number()
      .optional()
      .describe("Expected number of subtasks"),
    explicit_spec: tool.schema
      .boolean()
      .optional()
      .describe("Explicit spec generation flag"),
  },
  async execute(args) {
    const triggerResult = isSpecGenerationTriggered({
      explicit_flag: args.explicit_spec,
      task_type: args.task_type,
      task_complexity: args.estimated_complexity,
      subtask_count: args.subtask_count,
    });

    // Provide guidance based on result
    const guidance = triggerResult.triggered
      ? {
          recommendation: "Generate specs for complex subtasks",
          when_to_auto_approve:
            "complexity <= 3 AND no open questions AND high confidence",
          tools_to_use: [
            "spec_quick_write (with auto_approve=true for routine tasks)",
            "hive_generate_specs (after decomposition)",
          ],
        }
      : {
          recommendation: "Spec generation not needed for this task",
          override:
            "Use explicit_spec=true to force spec generation if needed",
        };

    return JSON.stringify(
      {
        task_type: args.task_type,
        estimated_complexity: args.estimated_complexity,
        subtask_count: args.subtask_count,
        explicit_spec: args.explicit_spec,
        will_trigger: triggerResult.triggered,
        reason: triggerResult.reason,
        guidance,
        config: DEFAULT_SPEC_CONFIG,
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Export tools
// ============================================================================

export const orchestrateTools = {
  hive_init,
  hive_status,
  hive_progress,
  hive_broadcast,
  hive_complete,
  hive_record_outcome,
  hive_accumulate_error,
  hive_get_error_context,
  hive_resolve_error,
  hive_check_strikes,
  hive_checkpoint,
  hive_recover,
  hive_learn,
  hive_track_single,
  hive_spawn_child,
  hive_generate_specs,
  hive_check_spec_trigger,
};
