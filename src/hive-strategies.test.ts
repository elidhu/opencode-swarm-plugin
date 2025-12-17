/**
 * Comprehensive tests for hive-strategies.ts module
 *
 * Tests strategy selection, guidelines formatting, and keyword matching logic.
 */
import type { ToolContext } from "@opencode-ai/plugin";
import { describe, expect, it } from "bun:test";
import {
  type DecompositionStrategy,
  DecompositionStrategySchema,
  formatStrategyGuidelines,
  hive_select_strategy,
  NEGATIVE_MARKERS,
  POSITIVE_MARKERS,
  selectStrategy,
  STRATEGIES,
  type StrategyDefinition,
} from "./hive-strategies";

// ============================================================================
// 1. Strategy Constants and Types
// ============================================================================

describe("Strategy Constants", () => {
  describe("STRATEGIES", () => {
    it("defines all four strategy types", () => {
      const strategyKeys = Object.keys(STRATEGIES);
      expect(strategyKeys).toContain("file-based");
      expect(strategyKeys).toContain("feature-based");
      expect(strategyKeys).toContain("risk-based");
      expect(strategyKeys).toContain("research-based");
      expect(strategyKeys.length).toBe(4);
    });

    it("each strategy has required properties", () => {
      for (const [name, def] of Object.entries(STRATEGIES)) {
        expect(def.name).toBe(name as Exclude<DecompositionStrategy, "auto">);
        expect(def.description).toBeTruthy();
        expect(Array.isArray(def.keywords)).toBe(true);
        expect(def.keywords.length).toBeGreaterThan(0);
        expect(Array.isArray(def.guidelines)).toBe(true);
        expect(def.guidelines.length).toBeGreaterThan(0);
        expect(Array.isArray(def.antiPatterns)).toBe(true);
        expect(def.antiPatterns.length).toBeGreaterThan(0);
        expect(Array.isArray(def.examples)).toBe(true);
        expect(def.examples.length).toBeGreaterThan(0);
      }
    });

    it("file-based strategy has correct keywords", () => {
      const keywords = STRATEGIES["file-based"].keywords;
      expect(keywords).toContain("refactor");
      expect(keywords).toContain("migrate");
      expect(keywords).toContain("rename");
      expect(keywords).toContain("cleanup");
    });

    it("feature-based strategy has correct keywords", () => {
      const keywords = STRATEGIES["feature-based"].keywords;
      expect(keywords).toContain("add");
      expect(keywords).toContain("implement");
      expect(keywords).toContain("build");
      expect(keywords).toContain("feature");
    });

    it("risk-based strategy has correct keywords", () => {
      const keywords = STRATEGIES["risk-based"].keywords;
      expect(keywords).toContain("fix");
      expect(keywords).toContain("bug");
      expect(keywords).toContain("security");
      expect(keywords).toContain("critical");
    });

    it("research-based strategy has correct keywords", () => {
      const keywords = STRATEGIES["research-based"].keywords;
      expect(keywords).toContain("research");
      expect(keywords).toContain("investigate");
      expect(keywords).toContain("explore");
      expect(keywords).toContain("analyze");
    });
  });

  describe("POSITIVE_MARKERS", () => {
    it("contains expected positive markers", () => {
      expect(POSITIVE_MARKERS).toContain("always");
      expect(POSITIVE_MARKERS).toContain("must");
      expect(POSITIVE_MARKERS).toContain("required");
      expect(POSITIVE_MARKERS).toContain("ensure");
      expect(POSITIVE_MARKERS).toContain("use");
      expect(POSITIVE_MARKERS).toContain("prefer");
    });
  });

  describe("NEGATIVE_MARKERS", () => {
    it("contains expected negative markers", () => {
      expect(NEGATIVE_MARKERS).toContain("never");
      expect(NEGATIVE_MARKERS).toContain("dont");
      expect(NEGATIVE_MARKERS).toContain("don't");
      expect(NEGATIVE_MARKERS).toContain("avoid");
      expect(NEGATIVE_MARKERS).toContain("forbid");
      expect(NEGATIVE_MARKERS).toContain("no ");
      expect(NEGATIVE_MARKERS).toContain("not ");
    });
  });

  describe("DecompositionStrategySchema", () => {
    it("validates all strategy types", () => {
      expect(DecompositionStrategySchema.safeParse("file-based").success).toBe(
        true,
      );
      expect(
        DecompositionStrategySchema.safeParse("feature-based").success,
      ).toBe(true);
      expect(DecompositionStrategySchema.safeParse("risk-based").success).toBe(
        true,
      );
      expect(
        DecompositionStrategySchema.safeParse("research-based").success,
      ).toBe(true);
      expect(DecompositionStrategySchema.safeParse("auto").success).toBe(true);
    });

    it("rejects invalid strategy types", () => {
      expect(DecompositionStrategySchema.safeParse("invalid").success).toBe(
        false,
      );
      expect(DecompositionStrategySchema.safeParse("").success).toBe(false);
      expect(DecompositionStrategySchema.safeParse(123).success).toBe(false);
    });
  });
});

// ============================================================================
// 2. selectStrategy Function
// ============================================================================

describe("selectStrategy", () => {
  describe("file-based strategy selection", () => {
    it("selects file-based for refactoring tasks", () => {
      const result = selectStrategy("Refactor the authentication module");
      expect(result.strategy).toBe("file-based");
    });

    it("selects file-based for migration tasks", () => {
      const result = selectStrategy("Migrate all components to React 18");
      expect(result.strategy).toBe("file-based");
    });

    it("selects file-based for rename tasks", () => {
      const result = selectStrategy("Rename userId to accountId everywhere");
      expect(result.strategy).toBe("file-based");
    });

    it("selects file-based for cleanup tasks", () => {
      const result = selectStrategy("Cleanup unused imports in all files");
      expect(result.strategy).toBe("file-based");
    });

    it("selects file-based for lint/format tasks", () => {
      const result = selectStrategy("Format all TypeScript files");
      expect(result.strategy).toBe("file-based");
    });

    it("selects file-based for upgrade tasks", () => {
      const result = selectStrategy("Upgrade all dependencies");
      expect(result.strategy).toBe("file-based");
    });

    it("selects file-based for deprecate tasks", () => {
      const result = selectStrategy("Deprecate the old API endpoints");
      expect(result.strategy).toBe("file-based");
    });
  });

  describe("feature-based strategy selection", () => {
    it("selects feature-based for add tasks", () => {
      const result = selectStrategy("Add user authentication feature");
      expect(result.strategy).toBe("feature-based");
    });

    it("selects feature-based for implement tasks", () => {
      const result = selectStrategy("Implement payment processing");
      expect(result.strategy).toBe("feature-based");
    });

    it("selects feature-based for build tasks", () => {
      const result = selectStrategy("Build a dashboard for analytics");
      expect(result.strategy).toBe("feature-based");
    });

    it("selects feature-based for create tasks", () => {
      const result = selectStrategy("Create a new reporting module");
      expect(result.strategy).toBe("feature-based");
    });

    it("selects feature-based for integrate tasks", () => {
      const result = selectStrategy("Integrate with Stripe payments");
      expect(result.strategy).toBe("feature-based");
    });

    it("selects feature-based for enable tasks", () => {
      const result = selectStrategy("Enable dark mode support");
      expect(result.strategy).toBe("feature-based");
    });
  });

  describe("risk-based strategy selection", () => {
    it("selects risk-based for bug fix tasks", () => {
      const result = selectStrategy("Fix the login bug");
      expect(result.strategy).toBe("risk-based");
    });

    it("selects risk-based for security tasks", () => {
      const result = selectStrategy("Address security vulnerability in auth");
      expect(result.strategy).toBe("risk-based");
    });

    it("selects risk-based for critical tasks", () => {
      const result = selectStrategy("Handle critical payment error");
      expect(result.strategy).toBe("risk-based");
    });

    it("selects risk-based for hotfix tasks", () => {
      const result = selectStrategy("Hotfix the production crash");
      expect(result.strategy).toBe("risk-based");
    });

    it("selects risk-based for patch tasks", () => {
      const result = selectStrategy("Patch the API endpoint");
      expect(result.strategy).toBe("risk-based");
    });

    it("selects risk-based for audit tasks", () => {
      const result = selectStrategy("Audit the codebase for vulnerabilities");
      expect(result.strategy).toBe("risk-based");
    });
  });

  describe("research-based strategy selection", () => {
    it("selects research-based for research tasks", () => {
      const result = selectStrategy("Research best practices for caching");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for investigate tasks", () => {
      const result = selectStrategy("Investigate the performance issue");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for explore tasks", () => {
      const result = selectStrategy("Explore different auth solutions");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for analyze tasks", () => {
      const result = selectStrategy("Analyze the error logs");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for question-style tasks", () => {
      const result = selectStrategy("What is the best approach for this?");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for 'how does' questions", () => {
      const result = selectStrategy("How does the authentication flow work?");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for compare tasks", () => {
      const result = selectStrategy("Compare different database options");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for documentation lookups", () => {
      const result = selectStrategy(
        "Look up the documentation for this library",
      );
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for multi-word keyword 'find out'", () => {
      const result = selectStrategy("Find out why the tests are failing");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for multi-word keyword 'learn about'", () => {
      const result = selectStrategy("Learn about React hooks");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for debug options", () => {
      const result = selectStrategy("What debug options are available?");
      expect(result.strategy).toBe("research-based");
    });

    it("selects research-based for configuration options", () => {
      const result = selectStrategy("Find configuration options for webpack");
      expect(result.strategy).toBe("research-based");
    });
  });

  describe("edge cases", () => {
    it("defaults to feature-based when no keywords match", () => {
      const result = selectStrategy("Do something with the code");
      expect(result.strategy).toBe("feature-based");
      expect(result.reasoning).toContain("No strong keyword signals");
    });

    it("handles empty string input", () => {
      const result = selectStrategy("");
      expect(result.strategy).toBe("feature-based");
      expect(result.confidence).toBe(0.5);
    });

    it("is case-insensitive", () => {
      const result1 = selectStrategy("REFACTOR the code");
      const result2 = selectStrategy("refactor the code");
      const result3 = selectStrategy("ReFaCtOr the code");
      expect(result1.strategy).toBe("file-based");
      expect(result2.strategy).toBe("file-based");
      expect(result3.strategy).toBe("file-based");
    });

    it("uses word boundaries for single-word keywords", () => {
      // "debug" should NOT match "bug" (word boundary)
      const result = selectStrategy("Debug the application");
      // Debug is in research-based keywords now, but "bug" shouldn't match
      expect(result.strategy).not.toBe("risk-based");
    });

    it("handles multi-word keywords correctly", () => {
      // "update all" is a file-based keyword
      const result = selectStrategy("Update all the tests");
      expect(result.strategy).toBe("file-based");
    });
  });

  describe("confidence scoring", () => {
    it("returns higher confidence when keywords clearly match one strategy", () => {
      const result = selectStrategy("Refactor and migrate all modules");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("returns lower confidence when multiple strategies could apply", () => {
      // Mix keywords from different strategies equally
      // fix=risk, research=research, add=feature - all have same score
      const result = selectStrategy("Fix research add");
      // With equal scores, confidence should be closer to 0.5
      expect(result.confidence).toBeLessThan(0.95);
    });

    it("returns 0.5 confidence when no keywords match", () => {
      const result = selectStrategy("Do something generic");
      expect(result.confidence).toBe(0.5);
    });

    it("confidence does not exceed 0.95", () => {
      // Even with many matches, confidence should be capped
      const result = selectStrategy(
        "refactor migrate rename replace convert upgrade deprecate remove cleanup",
      );
      expect(result.confidence).toBeLessThanOrEqual(0.95);
    });
  });

  describe("alternatives", () => {
    it("returns alternatives sorted by score", () => {
      const result = selectStrategy("Refactor the authentication module");
      expect(Array.isArray(result.alternatives)).toBe(true);
      // All non-winner strategies should be in alternatives
      expect(result.alternatives.length).toBe(3);
      // First alternative should not be the winner
      expect(result.alternatives[0].strategy).not.toBe(result.strategy);
    });

    it("alternatives have scores", () => {
      const result = selectStrategy("Add a new feature");
      for (const alt of result.alternatives) {
        expect(typeof alt.score).toBe("number");
        expect(typeof alt.strategy).toBe("string");
      }
    });
  });

  describe("reasoning", () => {
    it("includes matched keywords in reasoning", () => {
      const result = selectStrategy("Refactor the authentication module");
      expect(result.reasoning).toContain("refactor");
    });

    it("includes strategy description in reasoning", () => {
      const result = selectStrategy("Add user authentication");
      expect(result.reasoning).toContain(STRATEGIES["feature-based"].description);
    });

    it("indicates default reasoning when no keywords match", () => {
      const result = selectStrategy("Something without keywords");
      expect(result.reasoning).toContain("No strong keyword signals");
      expect(result.reasoning).toContain("feature-based");
    });
  });
});

// ============================================================================
// 3. formatStrategyGuidelines Function
// ============================================================================

describe("formatStrategyGuidelines", () => {
  it("formats file-based strategy guidelines", () => {
    const result = formatStrategyGuidelines("file-based");

    expect(result).toContain("## Strategy: file-based");
    expect(result).toContain(STRATEGIES["file-based"].description);
    expect(result).toContain("### Guidelines");
    expect(result).toContain("### Anti-Patterns");
    expect(result).toContain("### Examples");
  });

  it("formats feature-based strategy guidelines", () => {
    const result = formatStrategyGuidelines("feature-based");

    expect(result).toContain("## Strategy: feature-based");
    expect(result).toContain(STRATEGIES["feature-based"].description);
    expect(result).toContain("vertical slice");
  });

  it("formats risk-based strategy guidelines", () => {
    const result = formatStrategyGuidelines("risk-based");

    expect(result).toContain("## Strategy: risk-based");
    expect(result).toContain(STRATEGIES["risk-based"].description);
    expect(result).toContain("tests FIRST");
  });

  it("formats research-based strategy guidelines", () => {
    const result = formatStrategyGuidelines("research-based");

    expect(result).toContain("## Strategy: research-based");
    expect(result).toContain(STRATEGIES["research-based"].description);
    expect(result).toContain("Parallel");
  });

  it("includes all guidelines as bullet points", () => {
    const result = formatStrategyGuidelines("file-based");
    const guidelineCount = STRATEGIES["file-based"].guidelines.length;

    // Count bullet points in guidelines section
    const guidelineSection = result.split("### Anti-Patterns")[0];
    const bulletCount = (guidelineSection.match(/^- /gm) || []).length;

    expect(bulletCount).toBe(guidelineCount);
  });

  it("includes all anti-patterns as bullet points", () => {
    const result = formatStrategyGuidelines("feature-based");
    const antiPatternCount = STRATEGIES["feature-based"].antiPatterns.length;

    // Each anti-pattern should be a bullet point
    for (const antiPattern of STRATEGIES["feature-based"].antiPatterns) {
      expect(result).toContain(`- ${antiPattern}`);
    }
  });

  it("includes all examples as bullet points", () => {
    const result = formatStrategyGuidelines("risk-based");

    for (const example of STRATEGIES["risk-based"].examples) {
      expect(result).toContain(`- ${example}`);
    }
  });
});

// ============================================================================
// 4. hive_select_strategy Tool
// ============================================================================

describe("hive_select_strategy", () => {
  const mockCtx = {} as ToolContext;

  it("returns JSON with strategy selection", async () => {
    const result = await hive_select_strategy.execute(
      { task: "Refactor the auth module" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toBe("file-based");
    expect(typeof parsed.confidence).toBe("number");
    expect(typeof parsed.reasoning).toBe("string");
    expect(typeof parsed.description).toBe("string");
    expect(Array.isArray(parsed.guidelines)).toBe(true);
    expect(Array.isArray(parsed.anti_patterns)).toBe(true);
    expect(Array.isArray(parsed.alternatives)).toBe(true);
  });

  it("includes strategy guidelines in response", async () => {
    const result = await hive_select_strategy.execute(
      { task: "Add new feature" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.guidelines.length).toBeGreaterThan(0);
    expect(parsed.anti_patterns.length).toBeGreaterThan(0);
  });

  it("includes alternatives with descriptions", async () => {
    const result = await hive_select_strategy.execute(
      { task: "Fix the bug" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.alternatives.length).toBe(3);
    for (const alt of parsed.alternatives) {
      expect(alt.strategy).toBeTruthy();
      expect(alt.description).toBeTruthy();
      expect(typeof alt.score).toBe("number");
    }
  });

  it("incorporates codebase_context in reasoning", async () => {
    const result = await hive_select_strategy.execute(
      {
        task: "Add authentication",
        codebase_context: "React TypeScript project with Redux state management",
      },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.reasoning).toContain("Codebase context considered");
    expect(parsed.reasoning).toContain("React TypeScript");
  });

  it("truncates long codebase_context", async () => {
    const longContext = "x".repeat(500);
    const result = await hive_select_strategy.execute(
      {
        task: "Add feature",
        codebase_context: longContext,
      },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    // Context should be truncated to ~200 chars + "..."
    expect(parsed.reasoning).toContain("...");
    expect(parsed.reasoning.length).toBeLessThan(longContext.length);
  });

  it("handles task without codebase_context", async () => {
    const result = await hive_select_strategy.execute(
      { task: "Research best practices" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toBe("research-based");
    expect(parsed.reasoning).not.toContain("Codebase context considered");
  });

  it("rounds confidence to 2 decimal places", async () => {
    const result = await hive_select_strategy.execute(
      { task: "Refactor and migrate" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    const confidenceStr = parsed.confidence.toString();
    const decimalPlaces = confidenceStr.includes(".")
      ? confidenceStr.split(".")[1].length
      : 0;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// 5. Strategy Definition Type Tests
// ============================================================================

describe("StrategyDefinition type", () => {
  it("all strategies conform to StrategyDefinition interface", () => {
    const validateDefinition = (def: StrategyDefinition) => {
      expect(typeof def.name).toBe("string");
      expect(typeof def.description).toBe("string");
      expect(Array.isArray(def.keywords)).toBe(true);
      expect(Array.isArray(def.guidelines)).toBe(true);
      expect(Array.isArray(def.antiPatterns)).toBe(true);
      expect(Array.isArray(def.examples)).toBe(true);
    };

    for (const strategy of Object.values(STRATEGIES)) {
      validateDefinition(strategy);
    }
  });
});

// ============================================================================
// 6. Integration Tests - Strategy Selection with Complex Tasks
// ============================================================================

describe("Complex task selection", () => {
  it("selects highest-scoring strategy when multiple keywords present", () => {
    // This task has multiple keywords: "research" (research-based) but "add" and "implement" (feature-based)
    const result = selectStrategy("Add and implement new caching feature");
    // feature-based should win with 3 matches (add, implement, new, feature)
    expect(result.strategy).toBe("feature-based");
  });

  it("handles real-world task descriptions", () => {
    const tasks: Array<{
      task: string;
      expected: Exclude<DecompositionStrategy, "auto">;
    }> = [
      {
        task: "Migrate the codebase from CommonJS to ES Modules",
        expected: "file-based",
      },
      {
        task: "Implement OAuth 2.0 authentication with Google and GitHub providers",
        expected: "feature-based",
      },
      {
        task: "Fix critical SQL injection vulnerability in the search endpoint",
        expected: "risk-based",
      },
      {
        task: "Research and evaluate different caching strategies for our API",
        expected: "research-based",
      },
    ];

    for (const { task, expected } of tasks) {
      const result = selectStrategy(task);
      expect(result.strategy).toBe(expected);
    }
  });

  it("handles tasks with common ambiguous words", () => {
    // "update" could be feature or file-based
    const result = selectStrategy("Update the user profile page");
    // "update all" is file-based keyword, but just "update" isn't a keyword
    // Should default based on other signals or fall back
    expect(["feature-based", "file-based"]).toContain(result.strategy);
  });
});
