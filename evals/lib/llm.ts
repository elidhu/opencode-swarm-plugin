/**
 * LLM Client for Evalite Evals
 *
 * Uses AI SDK v6 with Vercel AI Gateway.
 * Gateway handles provider routing - just pass "provider/model" string.
 *
 * @module evals/lib/llm
 */
import { generateText, gateway } from "ai";
import type { GatewayModelId } from "ai";

/**
 * Default model for decomposition evals
 * Using Claude Sonnet for good balance of quality and cost
 */
export const DEFAULT_MODEL: GatewayModelId = "anthropic/claude-sonnet-4-5";

/**
 * Generate a decomposition from a task description
 *
 * @param prompt - The full decomposition prompt
 * @param model - Gateway model ID (e.g., "anthropic/claude-sonnet-4-5")
 * @returns The raw text response from the LLM
 */
export async function generateDecomposition(
  prompt: string,
  model: GatewayModelId = DEFAULT_MODEL,
): Promise<string> {
  const { text } = await generateText({
    model: gateway(model),
    prompt,
    maxOutputTokens: 4096,
  });

  return text;
}

/**
 * Format a decomposition prompt from task and context
 *
 * Uses the same prompt template as hive_plan_prompt
 */
export function formatDecompositionPrompt(
  task: string,
  context?: string,
  maxSubtasks: number = 6,
): string {
  const contextSection = context ? `## Context\n${context}` : "";

  return `You are decomposing a task into parallelizable subtasks for a swarm of agents.

## Task
${task}

${contextSection}

## Requirements

1. **Break into 2-${maxSubtasks} independent subtasks** that can run in parallel
2. **Assign files** - each subtask must specify which files it will modify
3. **No file overlap** - files cannot appear in multiple subtasks (they get exclusive locks)
4. **Order by dependency** - if subtask B needs subtask A's output, A must come first in the array
5. **Estimate complexity** - 1 (trivial) to 5 (complex)

## Response Format

Respond with ONLY a JSON object matching this schema (no markdown, no explanation):

{
  "epic": {
    "title": "string",
    "description": "string"
  },
  "subtasks": [
    {
      "title": "string",
      "description": "string",
      "files": ["string"],
      "dependencies": [0],
      "estimated_complexity": 1
    }
  ]
}

## Guidelines

- **Plan aggressively** - when in doubt, split further
- **Prefer smaller, focused subtasks** over large complex ones
- **Include test files** in the same subtask as the code they test
- **Be specific about files** - use actual file paths, not placeholders

Now decompose the task. Respond with JSON only:`;
}

/**
 * Extract JSON from LLM response
 *
 * Handles responses that may have markdown code blocks or extra text
 */
export function extractJson(text: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // Return as-is if no JSON found
  return text;
}
