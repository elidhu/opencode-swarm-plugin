/**
 * Hive Prompts Module - Prompt templates and generation
 *
 * Provides all prompt templates used for hive coordination:
 * - Decomposition prompts (basic and strategy-specific)
 * - Subtask agent prompts (V1 and V2)
 * - Evaluation prompts
 *
 * Key responsibilities:
 * - Prompt template definitions
 * - Prompt formatting/generation tools
 * - Template parameter substitution
 */

import { tool } from "@opencode-ai/plugin";
import { getStorage } from "./storage";

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * Prompt for decomposing a task into parallelizable subtasks.
 *
 * Used by hive_decompose to instruct the agent on how to break down work.
 * The agent responds with a BeadTree that gets validated.
 */
export const DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a hive of agents.

## Task
{task}

{context_section}

## MANDATORY: Beads Issue Tracking

**Every subtask MUST become a bead.** This is non-negotiable.

After decomposition, the coordinator will:
1. Create an epic bead for the overall task
2. Create child beads for each subtask
3. Track progress through bead status updates
4. Close beads with summaries when complete

Agents MUST update their bead status as they work. No silent progress.

## Requirements

1. **Break into 2-{max_subtasks} independent subtasks** that can run in parallel
2. **Assign files** - each subtask must specify which files it will modify
3. **No file overlap** - files cannot appear in multiple subtasks (they get exclusive locks)
4. **Order by dependency** - if subtask B needs subtask A's output, A must come first in the array
5. **Estimate complexity** - 1 (trivial) to 5 (complex)
6. **Plan aggressively** - break down more than you think necessary, smaller is better

## Response Format

Respond with a JSON object matching this schema:

\`\`\`typescript
{
  epic: {
    title: string,        // Epic title for the beads tracker
    description?: string  // Brief description of the overall goal
  },
  subtasks: [
    {
      title: string,              // What this subtask accomplishes
      description?: string,       // Detailed instructions for the agent
      files: string[],            // Files this subtask will modify (globs allowed)
      dependencies: number[],     // Indices of subtasks this depends on (0-indexed)
      estimated_complexity: 1-5   // Effort estimate
    },
    // ... more subtasks
  ]
}
\`\`\`

## Guidelines

- **Plan aggressively** - when in doubt, split further. 3 small tasks > 1 medium task
- **Prefer smaller, focused subtasks** over large complex ones
- **Include test files** in the same subtask as the code they test
- **Consider shared types** - if multiple files share types, handle that first
- **Think about imports** - changes to exported APIs affect downstream files
- **Explicit > implicit** - spell out what each subtask should do, don't assume

## File Assignment Examples

- Schema change: \`["src/schemas/user.ts", "src/schemas/index.ts"]\`
- Component + test: \`["src/components/Button.tsx", "src/components/Button.test.tsx"]\`
- API route: \`["src/app/api/users/route.ts"]\`

Now decompose the task:`;

/**
 * Strategy-specific decomposition prompt template
 */
export const STRATEGY_DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a hive of agents.

## Task
{task}

{strategy_guidelines}

{context_section}

{skills_context}

## MANDATORY: Beads Issue Tracking

**Every subtask MUST become a bead.** This is non-negotiable.

After decomposition, the coordinator will:
1. Create an epic bead for the overall task
2. Create child beads for each subtask
3. Track progress through bead status updates
4. Close beads with summaries when complete

Agents MUST update their bead status as they work. No silent progress.

## Requirements

1. **Break into 2-{max_subtasks} independent subtasks** that can run in parallel
2. **Assign files** - each subtask must specify which files it will modify
3. **No file overlap** - files cannot appear in multiple subtasks (they get exclusive locks)
4. **Order by dependency** - if subtask B needs subtask A's output, A must come first in the array
5. **Estimate complexity** - 1 (trivial) to 5 (complex)
6. **Plan aggressively** - break down more than you think necessary, smaller is better

## Response Format

Respond with a JSON object matching this schema:

\`\`\`typescript
{
  epic: {
    title: string,        // Epic title for the beads tracker
    description?: string  // Brief description of the overall goal
  },
  subtasks: [
    {
      title: string,              // What this subtask accomplishes
      description?: string,       // Detailed instructions for the agent
      files: string[],            // Files this subtask will modify (globs allowed)
      dependencies: number[],     // Indices of subtasks this depends on (0-indexed)
      estimated_complexity: 1-5   // Effort estimate
    },
    // ... more subtasks
  ]
}
\`\`\`

Now decompose the task:`;

/**
 * Prompt template for spawned subtask agents.
 *
 * Each agent receives this prompt with their specific subtask details filled in.
 * The prompt establishes context, constraints, and expectations.
 */
export const SUBTASK_PROMPT = `You are a hive agent working on a subtask of a larger epic.

## Your Identity
- **Agent Name**: {agent_name}
- **Bead ID**: {bead_id}
- **Epic ID**: {epic_id}

## Your Subtask
**Title**: {subtask_title}

{subtask_description}

## File Scope
You have exclusive reservations for these files:
{file_list}

**CRITICAL**: Only modify files in your reservation. If you need to modify other files, 
send a message to the coordinator requesting the change.

## Shared Context
{shared_context}

## MANDATORY: Beads Tracking

You MUST keep your bead updated as you work:

1. **Your bead is already in_progress** - don't change this unless blocked
2. **If blocked**: \`bd update {bead_id} --status blocked\` and message coordinator
3. **When done**: Use \`hive_complete\` - it closes your bead automatically
4. **Discovered issues**: Create new beads with \`bd create "issue" -t bug\`

**Never work silently.** Your bead status is how the hive tracks progress.

## MANDATORY: Hive Mail Communication

You MUST communicate with other agents:

1. **Report progress** every significant milestone (not just at the end)
2. **Ask questions** if requirements are unclear - don't guess
3. **Announce blockers** immediately - don't spin trying to fix alone
4. **Coordinate on shared concerns** - if you see something affecting other agents, say so

Use Hive Mail for all communication:
\`\`\`
hivemail_send(
  to: ["coordinator" or specific agent],
  subject: "Brief subject",
  body: "Message content",
  thread_id: "{epic_id}"
)
\`\`\`

## Coordination Protocol

1. **Start**: Your bead is already marked in_progress
2. **Progress**: Use hive_progress to report status updates
3. **Blocked**: Report immediately via Hive Mail - don't spin
4. **Complete**: Use hive_complete when done - it handles:
   - Closing your bead with a summary
   - Releasing file reservations
   - Notifying the coordinator

## Self-Evaluation

Before calling hive_complete, evaluate your work:
- Type safety: Does it compile without errors?
- No obvious bugs: Did you handle edge cases?
- Follows patterns: Does it match existing code style?
- Readable: Would another developer understand it?

If evaluation fails, fix the issues before completing.

## Planning Your Work

Before writing code:
1. **Read the files** you're assigned to understand current state
2. **Plan your approach** - what changes, in what order?
3. **Identify risks** - what could go wrong? What dependencies?
4. **Communicate your plan** via Hive Mail if non-trivial

Begin work on your subtask now.`;

/**
 * Streamlined subtask prompt (V2) - uses Hive Mail and beads
 *
 * This is a cleaner version of SUBTASK_PROMPT that's easier to parse.
 * Agents MUST use Hive Mail for communication and beads for tracking.
 *
 * Supports {error_context} placeholder for retry prompts.
 */
export const SUBTASK_PROMPT_V2 = `You are a hive agent working on: **{subtask_title}**

## [IDENTITY]
Agent: (assigned at spawn)
Bead: {bead_id}
Epic: {epic_id}

## [TASK]
{subtask_description}

## [FILES]
Reserved (exclusive):
{file_list}

Only modify these files. Need others? Message the coordinator.

## [CONTEXT]
{shared_context}

{compressed_context}

{error_context}

## [MANDATORY: HIVE MAIL]

**YOU MUST USE HIVE MAIL FOR ALL COORDINATION.** This is non-negotiable.

### Initialize FIRST (before any work)
\`\`\`
hivemail_init(project_path="$PWD", task_description="{subtask_title}")
\`\`\`

### Reserve Files (if not already reserved by coordinator)
\`\`\`
hivemail_reserve(paths=[...files...], reason="{bead_id}: {subtask_title}")
\`\`\`

### Check Inbox Regularly
\`\`\`
hivemail_inbox()  # Check for coordinator messages
hivemail_read_message(message_id=N)  # Read specific message
\`\`\`

### Report Progress (REQUIRED - don't work silently)
\`\`\`
hivemail_send(
  to=["coordinator"],
  subject="Progress: {bead_id}",
  body="<what you did, blockers, questions>",
  thread_id="{epic_id}"
)
\`\`\`

### When Blocked
\`\`\`
hivemail_send(
  to=["coordinator"],
  subject="BLOCKED: {bead_id}",
  body="<blocker description, what you need>",
  importance="high",
  thread_id="{epic_id}"
)
beads_update(id="{bead_id}", status="blocked")
\`\`\`

### Release Files When Done
\`\`\`
hivemail_release()  # Or let hive_complete handle it
\`\`\`

## [OTHER TOOLS]
### Beads
- beads_update(id, status) - Mark blocked if stuck
- beads_create(title, type) - Log new bugs found

### Skills (if available)
- skills_list() - Discover available skills
- skills_use(name) - Activate skill for specialized guidance

### Completion (REQUIRED)
- hive_complete(project_key, agent_name, bead_id, summary, files_touched)

## [LEARNING]
As you work, note reusable patterns, best practices, or domain insights:
- If you discover something that would help future agents, consider creating a skill
- Use skills_create to codify patterns for the project
- Good skills have clear "when to use" descriptions with actionable instructions
- Skills make hives smarter over time

## [WORKFLOW]
1. **hivemail_init** - Initialize session FIRST
2. Read assigned files
3. Implement changes
4. **hivemail_send** - Report progress to coordinator
5. Verify (typecheck)
6. **hive_complete** - Mark done, release reservations

**CRITICAL: Never work silently. Send progress updates via hivemail_send every significant milestone.**

Begin now.`;

/**
 * Prompt for self-evaluation before completing a subtask.
 *
 * Agents use this to assess their work quality before marking complete.
 */
export const EVALUATION_PROMPT = `Evaluate the work completed for this subtask.

## Subtask
**Bead ID**: {bead_id}
**Title**: {subtask_title}

## Files Modified
{files_touched}

## Evaluation Criteria

For each criterion, assess passed/failed and provide brief feedback:

1. **type_safe**: Code compiles without TypeScript errors
2. **no_bugs**: No obvious bugs, edge cases handled
3. **patterns**: Follows existing codebase patterns and conventions
4. **readable**: Code is clear and maintainable

## Response Format

\`\`\`json
{
  "passed": boolean,        // Overall pass/fail
  "criteria": {
    "type_safe": { "passed": boolean, "feedback": string },
    "no_bugs": { "passed": boolean, "feedback": string },
    "patterns": { "passed": boolean, "feedback": string },
    "readable": { "passed": boolean, "feedback": string }
  },
  "overall_feedback": string,
  "retry_suggestion": string | null  // If failed, what to fix
}
\`\`\`

If any criterion fails, the overall evaluation fails and retry_suggestion 
should describe what needs to be fixed.`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format the V2 subtask prompt for a specific agent
 */
export function formatSubtaskPromptV2(params: {
  bead_id: string;
  epic_id: string;
  subtask_title: string;
  subtask_description: string;
  files: string[];
  shared_context?: string;
  compressed_context?: string;
  error_context?: string;
}): string {
  const fileList =
    params.files.length > 0
      ? params.files.map((f) => `- \`${f}\``).join("\n")
      : "(no specific files - use judgment)";

  const compressedSection = params.compressed_context
    ? params.compressed_context
    : "";

  const errorSection = params.error_context ? params.error_context : "";

  return SUBTASK_PROMPT_V2.replace(/{bead_id}/g, params.bead_id)
    .replace(/{epic_id}/g, params.epic_id)
    .replace("{subtask_title}", params.subtask_title)
    .replace(
      "{subtask_description}",
      params.subtask_description || "(see title)",
    )
    .replace("{file_list}", fileList)
    .replace("{shared_context}", params.shared_context || "(none)")
    .replace("{compressed_context}", compressedSection)
    .replace("{error_context}", errorSection);
}

/**
 * Format the subtask prompt for a specific agent
 */
export function formatSubtaskPrompt(params: {
  agent_name: string;
  bead_id: string;
  epic_id: string;
  subtask_title: string;
  subtask_description: string;
  files: string[];
  shared_context?: string;
}): string {
  const fileList = params.files.map((f) => `- \`${f}\``).join("\n");

  return SUBTASK_PROMPT.replace("{agent_name}", params.agent_name)
    .replace("{bead_id}", params.bead_id)
    .replace(/{epic_id}/g, params.epic_id)
    .replace("{subtask_title}", params.subtask_title)
    .replace("{subtask_description}", params.subtask_description || "(none)")
    .replace("{file_list}", fileList || "(no files assigned)")
    .replace("{shared_context}", params.shared_context || "(none)");
}

/**
 * Format the evaluation prompt
 */
export function formatEvaluationPrompt(params: {
  bead_id: string;
  subtask_title: string;
  files_touched: string[];
}): string {
  const filesList = params.files_touched.map((f) => `- \`${f}\``).join("\n");

  return EVALUATION_PROMPT.replace("{bead_id}", params.bead_id)
    .replace("{subtask_title}", params.subtask_title)
    .replace("{files_touched}", filesList || "(no files recorded)");
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Generate subtask prompt for a spawned agent
 */
export const hive_subtask_prompt = tool({
  description: "Generate the prompt for a spawned subtask agent",
  args: {
    agent_name: tool.schema.string().describe("Agent Mail name for the agent"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    epic_id: tool.schema.string().describe("Epic bead ID"),
    subtask_title: tool.schema.string().describe("Subtask title"),
    subtask_description: tool.schema
      .string()
      .optional()
      .describe("Detailed subtask instructions"),
    files: tool.schema
      .array(tool.schema.string())
      .describe("Files assigned to this subtask"),
    shared_context: tool.schema
      .string()
      .optional()
      .describe("Context shared across all agents"),
  },
  async execute(args) {
    const prompt = formatSubtaskPrompt({
      agent_name: args.agent_name,
      bead_id: args.bead_id,
      epic_id: args.epic_id,
      subtask_title: args.subtask_title,
      subtask_description: args.subtask_description || "",
      files: args.files,
      shared_context: args.shared_context,
    });

    return prompt;
  },
});

/**
 * Prepare a subtask for spawning with Task tool (V2 prompt)
 *
 * Generates a streamlined prompt that tells agents to USE Hive Mail and beads.
 * Returns JSON that can be directly used with Task tool.
 */
export const hive_spawn_subtask = tool({
  description:
    "Prepare a subtask for spawning. Returns prompt with Hive Mail/beads instructions.",
  args: {
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    epic_id: tool.schema.string().describe("Parent epic bead ID"),
    subtask_title: tool.schema.string().describe("Subtask title"),
    subtask_description: tool.schema
      .string()
      .optional()
      .describe("Detailed subtask instructions"),
    files: tool.schema
      .array(tool.schema.string())
      .describe("Files assigned to this subtask"),
    shared_context: tool.schema
      .string()
      .optional()
      .describe("Context shared across all agents"),
  },
  async execute(args) {
    const prompt = formatSubtaskPromptV2({
      bead_id: args.bead_id,
      epic_id: args.epic_id,
      subtask_title: args.subtask_title,
      subtask_description: args.subtask_description || "",
      files: args.files,
      shared_context: args.shared_context,
    });

    return JSON.stringify(
      {
        prompt,
        bead_id: args.bead_id,
        epic_id: args.epic_id,
        files: args.files,
      },
      null,
      2,
    );
  },
});

/**
 * Generate self-evaluation prompt
 */
export const hive_evaluation_prompt = tool({
  description: "Generate self-evaluation prompt for a completed subtask",
  args: {
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    subtask_title: tool.schema.string().describe("Subtask title"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .describe("Files that were modified"),
  },
  async execute(args) {
    const prompt = formatEvaluationPrompt({
      bead_id: args.bead_id,
      subtask_title: args.subtask_title,
      files_touched: args.files_touched,
    });

    return JSON.stringify(
      {
        prompt,
        expected_schema: "Evaluation",
        schema_hint: {
          passed: "boolean",
          criteria: {
            type_safe: { passed: "boolean", feedback: "string" },
            no_bugs: { passed: "boolean", feedback: "string" },
            patterns: { passed: "boolean", feedback: "string" },
            readable: { passed: "boolean", feedback: "string" },
          },
          overall_feedback: "string",
          retry_suggestion: "string | null",
        },
      },
      null,
      2,
    );
  },
});

/**
 * Generate a strategy-specific planning prompt
 *
 * Higher-level than hive_decompose - includes strategy selection and guidelines.
 * Use this when you want the full planning experience with strategy-specific advice.
 */
export const hive_plan_prompt = tool({
  description:
    "Generate strategy-specific decomposition prompt. Auto-selects strategy or uses provided one.",
  args: {
    task: tool.schema.string().min(1).describe("Task description to decompose"),
    strategy: tool.schema
      .enum(["file-based", "feature-based", "risk-based", "auto"])
      .optional()
      .describe("Decomposition strategy (default: auto-detect)"),
    max_subtasks: tool.schema
      .number()
      .int()
      .min(2)
      .max(10)
      .default(5)
      .describe("Maximum number of subtasks (default: 5)"),
    context: tool.schema
      .string()
      .optional()
      .describe("Additional context (codebase info, constraints, etc.)"),
    include_skills: tool.schema
      .boolean()
      .optional()
      .describe("Include available skills in context (default: true)"),
  },
  async execute(args) {
    // Import needed modules dynamically
    const { selectStrategy, formatStrategyGuidelines, STRATEGIES } =
      await import("./hive-strategies");
    const { listSkills, getSkillsContextForSwarm, findRelevantSkills } =
      await import("./skills");

    // Query semantic memory for past learnings
    const storage = getStorage();
    const pastLearnings = await storage.findSimilarPatterns(args.task, 3);

    let learningsContext = "";
    if (pastLearnings.length > 0) {
      learningsContext = `## Past Learnings\n\nBased on similar past tasks, here are relevant patterns:\n\n${pastLearnings.map((p, i) => `${i + 1}. **${p.kind}**: ${p.content}${p.reason ? ` (${p.reason})` : ""}`).join("\n")}\n\n`;
    }

    // Select strategy
    type StrategyName =
      | "file-based"
      | "feature-based"
      | "risk-based"
      | "research-based";
    let selectedStrategy: StrategyName;
    let strategyReasoning: string;

    if (args.strategy && args.strategy !== "auto") {
      selectedStrategy = args.strategy as StrategyName;
      strategyReasoning = `User-specified strategy: ${selectedStrategy}`;
    } else {
      const selection = selectStrategy(args.task);
      selectedStrategy = selection.strategy;
      strategyReasoning = selection.reasoning;
    }

    // Fetch skills context
    let skillsContext = "";
    let skillsInfo: { included: boolean; count?: number; relevant?: string[] } =
      {
        included: false,
      };

    if (args.include_skills !== false) {
      const allSkills = await listSkills();
      if (allSkills.length > 0) {
        skillsContext = await getSkillsContextForSwarm();
        const relevantSkills = await findRelevantSkills(args.task);
        skillsInfo = {
          included: true,
          count: allSkills.length,
          relevant: relevantSkills,
        };

        // Add suggestion for relevant skills
        if (relevantSkills.length > 0) {
          skillsContext += `\n\n**Suggested skills for this task**: ${relevantSkills.join(", ")}`;
        }
      }
    }

    // Format strategy guidelines
    const strategyGuidelines = formatStrategyGuidelines(selectedStrategy);

    // Combine user context
    const contextSection = args.context
      ? `## Additional Context\n${args.context}`
      : "## Additional Context\n(none provided)";

    const basePrompt = STRATEGY_DECOMPOSITION_PROMPT.replace("{task}", args.task)
      .replace("{strategy_guidelines}", strategyGuidelines)
      .replace("{context_section}", contextSection)
      .replace("{skills_context}", skillsContext || "")
      .replace("{max_subtasks}", (args.max_subtasks ?? 5).toString());

    const fullPrompt = learningsContext + basePrompt;

    return JSON.stringify(
      {
        prompt: fullPrompt,
        strategy: {
          selected: selectedStrategy,
          reasoning: strategyReasoning,
          guidelines:
            STRATEGIES[selectedStrategy as keyof typeof STRATEGIES].guidelines,
          anti_patterns:
            STRATEGIES[selectedStrategy as keyof typeof STRATEGIES]
              .antiPatterns,
        },
        expected_schema: "BeadTree",
        schema_hint: {
          epic: { title: "string", description: "string?" },
          subtasks: [
            {
              title: "string",
              description: "string?",
              files: "string[]",
              dependencies: "number[]",
              estimated_complexity: "1-5",
            },
          ],
        },
        validation_note:
          "Parse agent response as JSON and validate with hive_validate_decomposition",
        skills: skillsInfo,
        memory_queried: true,
        patterns_found: pastLearnings.length,
      },
      null,
      2,
    );
  },
});

export const promptTools = {
  hive_subtask_prompt,
  hive_spawn_subtask,
  hive_evaluation_prompt,
  hive_plan_prompt,
};
