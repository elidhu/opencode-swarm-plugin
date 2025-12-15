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
 * New metric scorers evaluate decomposition outcomes:
 * - Scope accuracy (planned vs actual files)
 * - Time balance (subtask duration variance)
 * - File overlap (files in multiple subtasks)
 * - Success rate (percentage succeeded)
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
  scopeAccuracyScorer,
  timeBalanceScorer,
  fileOverlapScorer,
  successRateScorer,
  overallQualityScorer,
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

/**
 * Decomposition Outcome Metrics Eval
 *
 * Evaluates completed decompositions using captured eval records.
 * This tests metrics computed from actual execution data.
 *
 * Note: This eval requires eval records to exist at .opencode/eval-data.jsonl
 * Run actual decompositions with capture_eval=true to generate test data.
 */
evalite("Decomposition Outcome Metrics", {
  data: async () => {
    // Load eval records from captured data
    const { loadEvalRecords } = await import("../src/eval-capture.js");
    const records = await loadEvalRecords();
    
    // Filter to finalized records only
    const finalized = records.filter((r) => r.finalized);
    
    if (finalized.length === 0) {
      console.warn(
        "[eval] No finalized eval records found. Run decompositions with capture_eval=true to generate data.",
      );
      return [];
    }
    
    return finalized.map((record) => ({
      input: { epic_id: record.epic_id, task: record.task },
      expected: {}, // No specific expectations, just measure
    }));
  },

  task: async (input) => {
    // Load the specific eval record
    const { findEvalRecord } = await import("../src/eval-capture.js");
    const record = await findEvalRecord(input.epic_id);
    
    if (!record) {
      throw new Error(`Eval record not found for epic ${input.epic_id}`);
    }
    
    return JSON.stringify(record);
  },

  scorers: [
    scopeAccuracyScorer,
    timeBalanceScorer,
    fileOverlapScorer,
    successRateScorer,
    overallQualityScorer,
  ],
});
