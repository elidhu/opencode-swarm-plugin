/**
 * Swarm Decompose Module - Task decomposition and validation
 *
 * Handles breaking tasks into parallelizable subtasks with file assignments,
 * validates decomposition structure, and detects conflicts.
 *
 * Key responsibilities:
 * - Decomposition prompt generation
 * - BeadTree validation
 * - File conflict detection
 * - Instruction conflict detection
 * - Delegation to planner subagents
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { BeadTreeSchema } from "./schemas";
import {
  POSITIVE_MARKERS,
  NEGATIVE_MARKERS,
  type DecompositionStrategy,
} from "./hive-strategies";

// ============================================================================
// Decomposition Prompt (temporary - will be moved to hive-prompts.ts)
// ============================================================================

/**
 * Prompt for decomposing a task into parallelizable subtasks.
 *
 * Used by hive_decompose to instruct the agent on how to break down work.
 * The agent responds with a BeadTree that gets validated.
 */
const DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a hive of agents.

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
const STRATEGY_DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a hive of agents.

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

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * A detected conflict between subtask instructions
 */
export interface InstructionConflict {
  subtask_a: number;
  subtask_b: number;
  directive_a: string;
  directive_b: string;
  conflict_type: "positive_negative" | "contradictory";
  description: string;
}

/**
 * Extract directives from text based on marker words
 */
function extractDirectives(text: string): {
  positive: string[];
  negative: string[];
} {
  const sentences = text.split(/[.!?\n]+/).map((s) => s.trim().toLowerCase());
  const positive: string[] = [];
  const negative: string[] = [];

  for (const sentence of sentences) {
    if (!sentence) continue;

    const hasPositive = POSITIVE_MARKERS.some((m) => sentence.includes(m));
    const hasNegative = NEGATIVE_MARKERS.some((m) => sentence.includes(m));

    if (hasPositive && !hasNegative) {
      positive.push(sentence);
    } else if (hasNegative) {
      negative.push(sentence);
    }
  }

  return { positive, negative };
}

/**
 * Check if two directives conflict
 *
 * Simple heuristic: look for common subjects with opposite polarity
 */
function directivesConflict(positive: string, negative: string): boolean {
  // Extract key nouns/concepts (simple word overlap check)
  const positiveWords = new Set(
    positive.split(/\s+/).filter((w) => w.length > 3),
  );
  const negativeWords = negative.split(/\s+/).filter((w) => w.length > 3);

  // If they share significant words, they might conflict
  const overlap = negativeWords.filter((w) => positiveWords.has(w));
  return overlap.length >= 2;
}

/**
 * Detect conflicts between subtask instructions
 *
 * Looks for cases where one subtask says "always use X" and another says "avoid X".
 *
 * @param subtasks - Array of subtask descriptions
 * @returns Array of detected conflicts
 *
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/curate.ts#L36-L89
 */
export function detectInstructionConflicts(
  subtasks: Array<{ title: string; description?: string }>,
): InstructionConflict[] {
  const conflicts: InstructionConflict[] = [];

  // Extract directives from each subtask
  const subtaskDirectives = subtasks.map((s, i) => ({
    index: i,
    title: s.title,
    ...extractDirectives(`${s.title} ${s.description || ""}`),
  }));

  // Compare each pair of subtasks
  for (let i = 0; i < subtaskDirectives.length; i++) {
    for (let j = i + 1; j < subtaskDirectives.length; j++) {
      const a = subtaskDirectives[i];
      const b = subtaskDirectives[j];

      // Check if A's positive conflicts with B's negative
      for (const posA of a.positive) {
        for (const negB of b.negative) {
          if (directivesConflict(posA, negB)) {
            conflicts.push({
              subtask_a: i,
              subtask_b: j,
              directive_a: posA,
              directive_b: negB,
              conflict_type: "positive_negative",
              description: `Subtask ${i} says "${posA}" but subtask ${j} says "${negB}"`,
            });
          }
        }
      }

      // Check if B's positive conflicts with A's negative
      for (const posB of b.positive) {
        for (const negA of a.negative) {
          if (directivesConflict(posB, negA)) {
            conflicts.push({
              subtask_a: j,
              subtask_b: i,
              directive_a: posB,
              directive_b: negA,
              conflict_type: "positive_negative",
              description: `Subtask ${j} says "${posB}" but subtask ${i} says "${negA}"`,
            });
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detect file conflicts in a bead tree
 *
 * @param subtasks - Array of subtasks with file assignments
 * @returns Array of files that appear in multiple subtasks
 */
export function detectFileConflicts(
  subtasks: Array<{ files: string[] }>,
): string[] {
  const allFiles = new Map<string, number>();
  const conflicts: string[] = [];

  for (const subtask of subtasks) {
    for (const file of subtask.files) {
      const count = allFiles.get(file) || 0;
      allFiles.set(file, count + 1);
      if (count === 1) {
        // Second occurrence - it's a conflict
        conflicts.push(file);
      }
    }
  }

  return conflicts;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Decompose a task into a bead tree
 *
 * This is a PROMPT tool - it returns a prompt for the agent to respond to.
 * The agent's response (JSON) should be validated with BeadTreeSchema.
 *
 * Optionally queries CASS for similar past tasks to inform decomposition.
 */
export const hive_decompose = tool({
  description:
    "Generate decomposition prompt for breaking task into parallelizable subtasks.",
  args: {
    task: tool.schema.string().min(1).describe("Task description to decompose"),
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
  },
  async execute(args) {
    const { formatMemoryQueryForDecomposition } = await import("./learning");

    const contextSection = args.context
      ? `## Additional Context\n${args.context}`
      : "## Additional Context\n(none provided)";

    const prompt = DECOMPOSITION_PROMPT.replace("{task}", args.task)
      .replace("{max_subtasks}", (args.max_subtasks ?? 5).toString())
      .replace("{context_section}", contextSection);

    return JSON.stringify(
      {
        prompt,
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
          "Parse agent response as JSON and validate with BeadTreeSchema from schemas/bead.ts",
        memory_query: formatMemoryQueryForDecomposition(args.task, 3),
      },
      null,
      2,
    );
  },
});

/**
 * Validate a decomposition response from an agent
 *
 * Use this after the agent responds to swarm:decompose to validate the structure.
 */
export const hive_validate_decomposition = tool({
  description: "Validate a decomposition response against BeadTreeSchema",
  args: {
    response: tool.schema
      .string()
      .describe("JSON response from agent (BeadTree format)"),
  },
  async execute(args) {
    try {
      const parsed = JSON.parse(args.response);
      const validated = BeadTreeSchema.parse(parsed);

      // Additional validation: check for file conflicts
      const conflicts = detectFileConflicts(validated.subtasks);

      if (conflicts.length > 0) {
        return JSON.stringify(
          {
            valid: false,
            error: `File conflicts detected: ${conflicts.join(", ")}`,
            hint: "Each file can only be assigned to one subtask",
          },
          null,
          2,
        );
      }

      // Check dependency indices are valid
      for (let i = 0; i < validated.subtasks.length; i++) {
        const deps = validated.subtasks[i].dependencies;
        for (const dep of deps) {
          // Check bounds first
          if (dep < 0 || dep >= validated.subtasks.length) {
            return JSON.stringify(
              {
                valid: false,
                error: `Invalid dependency: subtask ${i} depends on ${dep}, but only ${validated.subtasks.length} subtasks exist (indices 0-${validated.subtasks.length - 1})`,
                hint: "Dependency index is out of bounds",
              },
              null,
              2,
            );
          }
          // Check forward references
          if (dep >= i) {
            return JSON.stringify(
              {
                valid: false,
                error: `Invalid dependency: subtask ${i} depends on ${dep}, but dependencies must be earlier in the array`,
                hint: "Reorder subtasks so dependencies come before dependents",
              },
              null,
              2,
            );
          }
        }
      }

      // Check for instruction conflicts between subtasks
      const instructionConflicts = detectInstructionConflicts(
        validated.subtasks,
      );

      return JSON.stringify(
        {
          valid: true,
          bead_tree: validated,
          stats: {
            subtask_count: validated.subtasks.length,
            total_files: new Set(validated.subtasks.flatMap((s) => s.files))
              .size,
            total_complexity: validated.subtasks.reduce(
              (sum, s) => sum + s.estimated_complexity,
              0,
            ),
          },
          // Include conflicts as warnings (not blocking)
          warnings:
            instructionConflicts.length > 0
              ? {
                  instruction_conflicts: instructionConflicts,
                  hint: "Review these potential conflicts between subtask instructions",
                }
              : undefined,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return JSON.stringify(
          {
            valid: false,
            error: "Schema validation failed",
            details: error.issues,
          },
          null,
          2,
        );
      }
      if (error instanceof SyntaxError) {
        return JSON.stringify(
          {
            valid: false,
            error: "Invalid JSON",
            details: error.message,
          },
          null,
          2,
        );
      }
      throw error;
    }
  },
});

/**
 * Delegate task decomposition to a hive/planner subagent
 *
 * Returns a prompt for spawning a planner agent that will handle all decomposition
 * reasoning. This keeps the coordinator context lean by offloading:
 * - Strategy selection
 * - CASS queries
 * - Skills discovery
 * - File analysis
 * - BeadTree generation
 *
 * The planner returns ONLY structured BeadTree JSON, which the coordinator
 * validates and uses to create beads.
 *
 * @example
 * ```typescript
 * // Coordinator workflow:
 * const delegateResult = await hive_delegate_planning({
 *   task: "Add user authentication",
 *   context: "Next.js 14 app",
 * });
 *
 * // Parse the result
 * const { prompt, subagent_type } = JSON.parse(delegateResult);
 *
 * // Spawn subagent using Task tool
 * const plannerResponse = await Task(prompt, subagent_type);
 *
 * // Validate the response
 * await hive_validate_decomposition({ response: plannerResponse });
 * ```
 */
export const hive_delegate_planning = tool({
  description:
    "Delegate task decomposition to a hive/planner subagent. Returns a prompt to spawn the planner.",
  args: {
    task: tool.schema.string().min(1).describe("The task to decompose"),
    context: tool.schema
      .string()
      .optional()
      .describe("Additional context to include"),
    max_subtasks: tool.schema
      .number()
      .int()
      .min(2)
      .max(10)
      .optional()
      .default(5)
      .describe("Maximum number of subtasks (default: 5)"),
    strategy: tool.schema
      .enum(["auto", "file-based", "feature-based", "risk-based"])
      .optional()
      .default("auto")
      .describe("Decomposition strategy (default: auto-detect)"),
  },
  async execute(args) {
    const { selectStrategy, formatStrategyGuidelines } =
      await import("./hive-strategies");
    const { formatMemoryQueryForDecomposition } = await import("./learning");
    const { listSkills, getSkillsContextForSwarm, findRelevantSkills } =
      await import("./skills");

    let selectedStrategy: Exclude<DecompositionStrategy, "auto">;
    let strategyReasoning: string;

    if (args.strategy && args.strategy !== "auto") {
      selectedStrategy = args.strategy;
      strategyReasoning = `User-specified strategy: ${selectedStrategy}`;
    } else {
      const selection = selectStrategy(args.task);
      selectedStrategy = selection.strategy;
      strategyReasoning = selection.reasoning;
    }

    let skillsContext = "";
    let skillsInfo: { included: boolean; count?: number; relevant?: string[] } =
      { included: false };

    const allSkills = await listSkills();
    if (allSkills.length > 0) {
      skillsContext = await getSkillsContextForSwarm();
      const relevantSkills = await findRelevantSkills(args.task);
      skillsInfo = {
        included: true,
        count: allSkills.length,
        relevant: relevantSkills,
      };

      if (relevantSkills.length > 0) {
        skillsContext += `\n\n**Suggested skills for this task**: ${relevantSkills.join(", ")}`;
      }
    }

    const strategyGuidelines = formatStrategyGuidelines(selectedStrategy);

    const contextSection = args.context
      ? `## Additional Context\n${args.context}`
      : "## Additional Context\n(none provided)";

    const planningPrompt = STRATEGY_DECOMPOSITION_PROMPT.replace(
      "{task}",
      args.task,
    )
      .replace("{strategy_guidelines}", strategyGuidelines)
      .replace("{context_section}", contextSection)
      .replace("{skills_context}", skillsContext || "")
      .replace("{max_subtasks}", (args.max_subtasks ?? 5).toString());

    const subagentInstructions = `
## CRITICAL: Output Format

You are a planner subagent. Your ONLY output must be valid JSON matching the BeadTree schema.

DO NOT include:
- Explanatory text before or after the JSON
- Markdown code fences (\`\`\`json)
- Commentary or reasoning

OUTPUT ONLY the raw JSON object.

## Example Output

{
  "epic": {
    "title": "Add user authentication",
    "description": "Implement OAuth-based authentication system"
  },
  "subtasks": [
    {
      "title": "Set up OAuth provider",
      "description": "Configure OAuth client credentials and redirect URLs",
      "files": ["src/auth/oauth.ts", "src/config/auth.ts"],
      "dependencies": [],
      "estimated_complexity": 2
    },
    {
      "title": "Create auth routes",
      "description": "Implement login, logout, and callback routes",
      "files": ["src/app/api/auth/[...nextauth]/route.ts"],
      "dependencies": [0],
      "estimated_complexity": 3
    }
  ]
}

Now generate the BeadTree for the given task.`;

    const fullPrompt = `${planningPrompt}\n\n${subagentInstructions}`;

    return JSON.stringify(
      {
        prompt: fullPrompt,
        subagent_type: "hive/planner",
        description: "Task decomposition planning",
        strategy: {
          selected: selectedStrategy,
          reasoning: strategyReasoning,
        },
        expected_output: "BeadTree JSON (raw JSON, no markdown)",
        next_steps: [
          "1. Spawn subagent with Task tool using returned prompt",
          "2. Parse subagent response as JSON",
          "3. Validate with hive_validate_decomposition",
          "4. Create beads with beads_create_epic",
        ],
        skills: skillsInfo,
        memory_query: formatMemoryQueryForDecomposition(args.task, 3),
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Errors
// ============================================================================

export class HiveError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HiveError";
  }
}

export class DecompositionError extends HiveError {
  constructor(
    message: string,
    public readonly zodError?: z.ZodError,
  ) {
    super(message, "decompose", zodError?.issues);
  }
}

export const decomposeTools = {
  hive_decompose,
  hive_validate_decomposition,
  hive_delegate_planning,
};
