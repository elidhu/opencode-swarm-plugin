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
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
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

  const result = await Bun.$`bd list --parent ${epicId} --json`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    // Don't throw - just return empty and log error prominently
    console.error(
      `[hive] ERROR: Failed to query subtasks for epic ${epicId}:`,
      result.stderr.toString(),
    );
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout.toString());
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
// Verification Gate
// ============================================================================

/**
 * Verification Gate result - tracks each verification step
 *
 * Based on the Gate Function from superpowers:
 * 1. IDENTIFY: What command proves this claim?
 * 2. RUN: Execute the FULL command (fresh, complete)
 * 3. READ: Full output, check exit code, count failures
 * 4. VERIFY: Does output confirm the claim?
 * 5. ONLY THEN: Make the claim
 */
interface VerificationStep {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  output?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

interface VerificationGateResult {
  passed: boolean;
  steps: VerificationStep[];
  summary: string;
  blockers: string[];
}

/**
 * Run typecheck verification
 *
 * Attempts to run TypeScript type checking on the project.
 * Falls back gracefully if tsc is not available.
 */
async function runTypecheckVerification(): Promise<VerificationStep> {
  const step: VerificationStep = {
    name: "typecheck",
    command: "tsc --noEmit",
    passed: false,
    exitCode: -1,
  };

  try {
    // Check if tsconfig.json exists in current directory
    const tsconfigExists = await Bun.file("tsconfig.json").exists();
    if (!tsconfigExists) {
      step.skipped = true;
      step.skipReason = "No tsconfig.json found";
      step.passed = true; // Don't block if no TypeScript
      return step;
    }

    const result = await Bun.$`tsc --noEmit`.quiet().nothrow();
    step.exitCode = result.exitCode;
    step.passed = result.exitCode === 0;

    if (!step.passed) {
      step.error = result.stderr.toString().slice(0, 1000); // Truncate for context
      step.output = result.stdout.toString().slice(0, 1000);
    }
  } catch (error) {
    step.skipped = true;
    step.skipReason = `tsc not available: ${error instanceof Error ? error.message : String(error)}`;
    step.passed = true; // Don't block if tsc unavailable
  }

  return step;
}

/**
 * Run test verification for specific files
 *
 * Attempts to find and run tests related to the touched files.
 * Uses common test patterns (*.test.ts, *.spec.ts, __tests__/).
 */
async function runTestVerification(
  filesTouched: string[],
): Promise<VerificationStep> {
  const step: VerificationStep = {
    name: "tests",
    command: "bun test <related-files>",
    passed: false,
    exitCode: -1,
  };

  if (filesTouched.length === 0) {
    step.skipped = true;
    step.skipReason = "No files touched";
    step.passed = true;
    return step;
  }

  // Find test files related to touched files
  const testPatterns: string[] = [];
  for (const file of filesTouched) {
    // Skip if already a test file
    if (file.includes(".test.") || file.includes(".spec.")) {
      testPatterns.push(file);
      continue;
    }

    // Look for corresponding test file
    const baseName = file.replace(/\.(ts|tsx|js|jsx)$/, "");
    testPatterns.push(`${baseName}.test.ts`);
    testPatterns.push(`${baseName}.test.tsx`);
    testPatterns.push(`${baseName}.spec.ts`);
  }

  // Check if any test files exist
  const existingTests: string[] = [];
  for (const pattern of testPatterns) {
    try {
      const exists = await Bun.file(pattern).exists();
      if (exists) {
        existingTests.push(pattern);
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  if (existingTests.length === 0) {
    step.skipped = true;
    step.skipReason = "No related test files found";
    step.passed = true;
    return step;
  }

  try {
    step.command = `bun test ${existingTests.join(" ")}`;
    const result = await Bun.$`bun test ${existingTests}`.quiet().nothrow();
    step.exitCode = result.exitCode;
    step.passed = result.exitCode === 0;

    if (!step.passed) {
      step.error = result.stderr.toString().slice(0, 1000);
      step.output = result.stdout.toString().slice(0, 1000);
    }
  } catch (error) {
    step.skipped = true;
    step.skipReason = `Test runner failed: ${error instanceof Error ? error.message : String(error)}`;
    step.passed = true; // Don't block if test runner unavailable
  }

  return step;
}

/**
 * Run the full Verification Gate
 *
 * Implements the Gate Function (IDENTIFY → RUN → READ → VERIFY → CLAIM):
 * 1. Typecheck
 * 2. Tests for touched files
 *
 * All steps must pass (or be skipped with valid reason) to proceed.
 */
async function runVerificationGate(
  filesTouched: string[],
): Promise<VerificationGateResult> {
  const steps: VerificationStep[] = [];
  const blockers: string[] = [];

  // Step 1: Typecheck
  const typecheckStep = await runTypecheckVerification();
  steps.push(typecheckStep);
  if (!typecheckStep.passed && !typecheckStep.skipped) {
    blockers.push(
      `Typecheck failed: ${typecheckStep.error?.slice(0, 100) || "type errors found"}. Try: Run 'tsc --noEmit' to see full errors, check tsconfig.json configuration, or fix reported type errors in modified files.`,
    );
  }

  // Step 3: Tests
  const testStep = await runTestVerification(filesTouched);
  steps.push(testStep);
  if (!testStep.passed && !testStep.skipped) {
    blockers.push(
      `Tests failed: ${testStep.error?.slice(0, 100) || "test failures"}. Try: Run 'bun test ${testStep.command.split(" ").slice(2).join(" ")}' to see full output, check test assertions, or fix failing tests in modified files.`,
    );
  }

  // Build summary
  const passedCount = steps.filter((s) => s.passed).length;
  const skippedCount = steps.filter((s) => s.skipped).length;
  const failedCount = steps.filter((s) => !s.passed && !s.skipped).length;

  const summary =
    failedCount === 0
      ? `Verification passed: ${passedCount} checks passed, ${skippedCount} skipped`
      : `Verification FAILED: ${failedCount} checks failed, ${passedCount} passed, ${skippedCount} skipped`;

  return {
    passed: failedCount === 0,
    steps,
    summary,
    blockers,
  };
}

/**
 * Classify failure based on error message heuristics
 *
 * Simple pattern matching to categorize why a task failed.
 * Used when failure_mode is not explicitly provided.
 *
 * @param error - Error object or message
 * @returns FailureMode classification
 */
function classifyFailure(error: Error | string): string {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();

  if (msg.includes("timeout")) return "timeout";
  if (msg.includes("conflict") || msg.includes("reservation"))
    return "conflict";
  if (msg.includes("validation") || msg.includes("schema")) return "validation";
  if (msg.includes("context") || msg.includes("token"))
    return "context_overflow";
  if (msg.includes("blocked") || msg.includes("dependency"))
    return "dependency_blocked";
  if (msg.includes("cancel")) return "user_cancelled";

  // Check for tool failure patterns
  if (
    msg.includes("tool") ||
    msg.includes("command") ||
    msg.includes("failed to execute")
  ) {
    return "tool_failure";
  }

  return "unknown";
}

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
      await Bun.$`bd update ${args.bead_id} --status ${beadStatus} --json`
        .quiet()
        .nothrow();
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
    const closeResult =
      await Bun.$`bd close ${args.bead_id} --reason ${args.summary} --json`
        .quiet()
        .nothrow();

    if (closeResult.exitCode !== 0) {
      throw new Error(
        `Failed to close bead because bd close command failed: ${closeResult.stderr.toString()}. Try: Verify bead exists and is not already closed with 'bd show ${args.bead_id}', check if bead ID is correct with 'beads_query()', or use beads_close tool directly.`,
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
        }

        // Build response with memory storage status
        const response: Record<string, unknown> = {
          bead_id: args.bead_id,
          strike_count: record.strike_count,
          is_striked_out: strikedOut,
          failures: record.failures,
          memory_stored: strikedOut ? memoryStored : undefined,
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
};
