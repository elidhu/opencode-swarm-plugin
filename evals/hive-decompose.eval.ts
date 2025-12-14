/**
 * Swarm Decomposition Quality Eval
 *
 * Tests the quality of task decomposition for swarm coordination.
 * Uses real LLM calls via AI SDK + Vercel AI Gateway.
 *
 * Scorers evaluate:
 * - Subtask independence (no file conflicts)
 * - Complexity balance (even distribution)
 * - Coverage completeness (all required files)
 * - Instruction clarity (actionable descriptions)
 *
 * Run with: pnpm evalite evals/swarm-decomposition.eval.ts
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 */
import { evalite } from "evalite";
import {
  subtaskIndependence,
  complexityBalance,
  coverageCompleteness,
  instructionClarity,
} from "./scorers/index.js";
import { decompositionCases } from "./fixtures/decomposition-cases.js";
import {
  generateDecomposition,
  formatDecompositionPrompt,
  extractJson,
} from "./lib/llm.js";

/**
 * Swarm Decomposition Quality Eval
 *
 * Tests decomposition quality with real LLM calls.
 */
evalite("Swarm Decomposition Quality", {
  // Test data from fixtures
  data: async () =>
    decompositionCases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.expected,
    })),

  // Task: generate real decomposition via Claude
  task: async (input) => {
    const prompt = formatDecompositionPrompt(input.task, input.context);
    const response = await generateDecomposition(prompt);
    return extractJson(response);
  },

  // Scorers evaluate decomposition quality
  scorers: [
    subtaskIndependence,
    complexityBalance,
    coverageCompleteness,
    instructionClarity,
  ],
});

/**
 * Edge Case Eval: Minimal and Complex Tasks
 *
 * Tests handling of edge cases in decomposition.
 */
evalite("Decomposition Edge Cases", {
  data: async () => [
    {
      input: { task: "Fix typo in README.md" },
      expected: { minSubtasks: 1, maxSubtasks: 2 },
    },
    {
      input: { task: "Refactor entire codebase from JavaScript to TypeScript" },
      expected: { minSubtasks: 4, maxSubtasks: 8 },
    },
  ],

  task: async (input) => {
    const prompt = formatDecompositionPrompt(input.task, undefined, 8);
    const response = await generateDecomposition(prompt);
    return extractJson(response);
  },

  scorers: [subtaskIndependence, coverageCompleteness],
});
