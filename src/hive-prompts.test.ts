/**
 * Unit tests for hive-prompts.ts
 *
 * Tests all prompt template constants and generation functions:
 * - Template structure validation
 * - Variable substitution
 * - Edge cases (empty inputs, special characters)
 */
import type { ToolContext } from "@opencode-ai/plugin";
import { describe, expect, it } from "bun:test";
import {
  // Template constants
  DECOMPOSITION_PROMPT,
  STRATEGY_DECOMPOSITION_PROMPT,
  SUBTASK_PROMPT,
  SUBTASK_PROMPT_V2,
  EVALUATION_PROMPT,
  // Formatting functions
  formatSubtaskPrompt,
  formatSubtaskPromptV2,
  formatEvaluationPrompt,
  // Tools
  hive_subtask_prompt,
  hive_spawn_subtask,
  hive_evaluation_prompt,
} from "./hive-prompts";

// ============================================================================
// 1. Template Constants Structure Tests
// ============================================================================

describe("Template Constants", () => {
  describe("DECOMPOSITION_PROMPT", () => {
    it("contains required placeholders", () => {
      expect(DECOMPOSITION_PROMPT).toContain("{task}");
      expect(DECOMPOSITION_PROMPT).toContain("{context_section}");
      expect(DECOMPOSITION_PROMPT).toContain("{max_subtasks}");
    });

    it("includes beads tracking instructions", () => {
      expect(DECOMPOSITION_PROMPT).toContain("MANDATORY: Beads Issue Tracking");
      expect(DECOMPOSITION_PROMPT).toContain("Every subtask MUST become a bead");
    });

    it("includes response format schema", () => {
      expect(DECOMPOSITION_PROMPT).toContain("epic:");
      expect(DECOMPOSITION_PROMPT).toContain("subtasks:");
      expect(DECOMPOSITION_PROMPT).toContain("estimated_complexity");
    });

    it("includes file assignment examples", () => {
      expect(DECOMPOSITION_PROMPT).toContain("File Assignment Examples");
      expect(DECOMPOSITION_PROMPT).toContain("src/schemas/user.ts");
    });
  });

  describe("STRATEGY_DECOMPOSITION_PROMPT", () => {
    it("contains strategy-specific placeholders", () => {
      expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("{task}");
      expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("{strategy_guidelines}");
      expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("{context_section}");
      expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("{skills_context}");
      expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("{max_subtasks}");
    });

    it("has same base structure as DECOMPOSITION_PROMPT", () => {
      expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("MANDATORY: Beads Issue Tracking");
      expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("Response Format");
    });
  });

  describe("SUBTASK_PROMPT", () => {
    it("contains required placeholders", () => {
      expect(SUBTASK_PROMPT).toContain("{agent_name}");
      expect(SUBTASK_PROMPT).toContain("{bead_id}");
      expect(SUBTASK_PROMPT).toContain("{epic_id}");
      expect(SUBTASK_PROMPT).toContain("{subtask_title}");
      expect(SUBTASK_PROMPT).toContain("{subtask_description}");
      expect(SUBTASK_PROMPT).toContain("{file_list}");
      expect(SUBTASK_PROMPT).toContain("{shared_context}");
    });

    it("includes hive mail instructions", () => {
      expect(SUBTASK_PROMPT).toContain("MANDATORY: Hive Mail Communication");
      expect(SUBTASK_PROMPT).toContain("hivemail_send");
    });

    it("includes beads tracking instructions", () => {
      expect(SUBTASK_PROMPT).toContain("MANDATORY: Beads Tracking");
      expect(SUBTASK_PROMPT).toContain("bd update");
    });

    it("includes coordination protocol", () => {
      expect(SUBTASK_PROMPT).toContain("Coordination Protocol");
      expect(SUBTASK_PROMPT).toContain("hive_complete");
    });

    it("includes self-evaluation guidance", () => {
      expect(SUBTASK_PROMPT).toContain("Self-Evaluation");
      expect(SUBTASK_PROMPT).toContain("Type safety");
    });
  });

  describe("SUBTASK_PROMPT_V2", () => {
    it("contains required placeholders", () => {
      expect(SUBTASK_PROMPT_V2).toContain("{bead_id}");
      expect(SUBTASK_PROMPT_V2).toContain("{epic_id}");
      expect(SUBTASK_PROMPT_V2).toContain("{subtask_title}");
      expect(SUBTASK_PROMPT_V2).toContain("{subtask_description}");
      expect(SUBTASK_PROMPT_V2).toContain("{file_list}");
      expect(SUBTASK_PROMPT_V2).toContain("{shared_context}");
      expect(SUBTASK_PROMPT_V2).toContain("{compressed_context}");
      expect(SUBTASK_PROMPT_V2).toContain("{error_context}");
    });

    it("has cleaner section markers", () => {
      expect(SUBTASK_PROMPT_V2).toContain("## [IDENTITY]");
      expect(SUBTASK_PROMPT_V2).toContain("## [TASK]");
      expect(SUBTASK_PROMPT_V2).toContain("## [FILES]");
      expect(SUBTASK_PROMPT_V2).toContain("## [CONTEXT]");
      expect(SUBTASK_PROMPT_V2).toContain("## [WORKFLOW]");
    });

    it("includes mandatory hivemail usage", () => {
      expect(SUBTASK_PROMPT_V2).toContain("MANDATORY: HIVE MAIL");
      expect(SUBTASK_PROMPT_V2).toContain("hivemail_init");
      expect(SUBTASK_PROMPT_V2).toContain("hivemail_reserve");
      expect(SUBTASK_PROMPT_V2).toContain("hivemail_send");
    });

    it("includes learning section", () => {
      expect(SUBTASK_PROMPT_V2).toContain("## [LEARNING]");
      expect(SUBTASK_PROMPT_V2).toContain("skills_create");
    });
  });

  describe("EVALUATION_PROMPT", () => {
    it("contains required placeholders", () => {
      expect(EVALUATION_PROMPT).toContain("{bead_id}");
      expect(EVALUATION_PROMPT).toContain("{subtask_title}");
      expect(EVALUATION_PROMPT).toContain("{files_touched}");
    });

    it("lists evaluation criteria", () => {
      expect(EVALUATION_PROMPT).toContain("type_safe");
      expect(EVALUATION_PROMPT).toContain("no_bugs");
      expect(EVALUATION_PROMPT).toContain("patterns");
      expect(EVALUATION_PROMPT).toContain("readable");
    });

    it("includes response format", () => {
      expect(EVALUATION_PROMPT).toContain("Response Format");
      expect(EVALUATION_PROMPT).toContain("passed");
      expect(EVALUATION_PROMPT).toContain("criteria");
      expect(EVALUATION_PROMPT).toContain("overall_feedback");
      expect(EVALUATION_PROMPT).toContain("retry_suggestion");
    });
  });

});

// ============================================================================
// 2. Format Functions Tests
// ============================================================================

describe("formatSubtaskPrompt", () => {
  it("substitutes all placeholders correctly", () => {
    const result = formatSubtaskPrompt({
      agent_name: "worker-1",
      bead_id: "proj-123.1",
      epic_id: "proj-123",
      subtask_title: "Implement feature X",
      subtask_description: "Add the new feature with tests",
      files: ["src/feature.ts", "src/feature.test.ts"],
      shared_context: "This is a TypeScript project",
    });

    expect(result).toContain("worker-1");
    expect(result).toContain("proj-123.1");
    expect(result).toContain("proj-123");
    expect(result).toContain("Implement feature X");
    expect(result).toContain("Add the new feature with tests");
    expect(result).toContain("- `src/feature.ts`");
    expect(result).toContain("- `src/feature.test.ts`");
    expect(result).toContain("This is a TypeScript project");
  });

  it("handles empty description", () => {
    const result = formatSubtaskPrompt({
      agent_name: "worker-1",
      bead_id: "proj-123.1",
      epic_id: "proj-123",
      subtask_title: "Test task",
      subtask_description: "",
      files: ["a.ts"],
    });

    expect(result).toContain("(none)");
  });

  it("handles empty shared_context", () => {
    const result = formatSubtaskPrompt({
      agent_name: "worker-1",
      bead_id: "proj-123.1",
      epic_id: "proj-123",
      subtask_title: "Test task",
      subtask_description: "desc",
      files: ["a.ts"],
    });

    expect(result).toContain("(none)");
  });

  it("handles empty files array", () => {
    const result = formatSubtaskPrompt({
      agent_name: "worker-1",
      bead_id: "proj-123.1",
      epic_id: "proj-123",
      subtask_title: "Test task",
      subtask_description: "desc",
      files: [],
    });

    expect(result).toContain("(no files assigned)");
  });

  it("handles special characters in inputs", () => {
    const result = formatSubtaskPrompt({
      agent_name: "worker-$special",
      bead_id: "proj-{123}.1",
      epic_id: "proj-{123}",
      subtask_title: "Test \"quotes\" and 'apostrophes'",
      subtask_description: "Line1\nLine2\tTabbed",
      files: ["src/path/with spaces/file.ts"],
      shared_context: "Context with { braces } and $vars",
    });

    expect(result).toContain("worker-$special");
    expect(result).toContain("proj-{123}.1");
    expect(result).toContain('Test "quotes" and \'apostrophes\'');
    expect(result).toContain("Line1\nLine2\tTabbed");
    expect(result).toContain("src/path/with spaces/file.ts");
    expect(result).toContain("Context with { braces } and $vars");
  });

  it("replaces multiple occurrences of epic_id", () => {
    const result = formatSubtaskPrompt({
      agent_name: "worker-1",
      bead_id: "proj-abc.1",
      epic_id: "proj-abc",
      subtask_title: "Task",
      subtask_description: "Desc",
      files: ["a.ts"],
    });

    // epic_id appears multiple times in template (thread_id usage)
    const occurrences = result.split("proj-abc").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe("formatSubtaskPromptV2", () => {
  it("substitutes all placeholders correctly", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "proj-456.2",
      epic_id: "proj-456",
      subtask_title: "V2 Feature Implementation",
      subtask_description: "Implement with the new template",
      files: ["src/v2/feature.ts", "src/v2/feature.test.ts"],
      shared_context: "Using V2 template",
      compressed_context: "Compressed: file1.ts has imports",
      error_context: "Previous attempt failed due to missing import",
    });

    expect(result).toContain("proj-456.2");
    expect(result).toContain("proj-456");
    expect(result).toContain("V2 Feature Implementation");
    expect(result).toContain("Implement with the new template");
    expect(result).toContain("- `src/v2/feature.ts`");
    expect(result).toContain("Using V2 template");
    expect(result).toContain("Compressed: file1.ts has imports");
    expect(result).toContain("Previous attempt failed due to missing import");
  });

  it("handles empty files array with graceful message", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "proj-456.2",
      epic_id: "proj-456",
      subtask_title: "Task without files",
      subtask_description: "No specific files",
      files: [],
    });

    expect(result).toContain("(no specific files - use judgment)");
  });

  it("handles missing optional fields", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "proj-789.1",
      epic_id: "proj-789",
      subtask_title: "Minimal task",
      subtask_description: "",
      files: ["a.ts"],
    });

    expect(result).toContain("(see title)");
    expect(result).toContain("(none)");
    // Empty compressed_context and error_context should result in empty strings
    expect(result).not.toContain("undefined");
  });

  it("replaces all global occurrences of bead_id and epic_id", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "test-bead-id",
      epic_id: "test-epic-id",
      subtask_title: "Task",
      subtask_description: "Desc",
      files: ["a.ts"],
    });

    // Both should appear in multiple places
    const beadOccurrences = result.split("test-bead-id").length - 1;
    const epicOccurrences = result.split("test-epic-id").length - 1;
    expect(beadOccurrences).toBeGreaterThanOrEqual(3);
    expect(epicOccurrences).toBeGreaterThanOrEqual(2);
  });

  it("handles unicode characters", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "proj-unicode.1",
      epic_id: "proj-unicode",
      subtask_title: "Feature with unicode",
      subtask_description: "Description with chinese 中文 and emoji 🎉",
      files: ["src/文件.ts"],
      shared_context: "日本語 context",
    });

    expect(result).toContain("中文");
    expect(result).toContain("日本語");
    expect(result).toContain("src/文件.ts");
  });
});

describe("formatEvaluationPrompt", () => {
  it("substitutes all placeholders correctly", () => {
    const result = formatEvaluationPrompt({
      bead_id: "proj-eval.5",
      subtask_title: "Evaluate this feature",
      files_touched: ["src/feature.ts", "src/feature.test.ts", "src/types.ts"],
    });

    expect(result).toContain("proj-eval.5");
    expect(result).toContain("Evaluate this feature");
    expect(result).toContain("- `src/feature.ts`");
    expect(result).toContain("- `src/feature.test.ts`");
    expect(result).toContain("- `src/types.ts`");
  });

  it("handles empty files_touched array", () => {
    const result = formatEvaluationPrompt({
      bead_id: "proj-empty.1",
      subtask_title: "No files changed",
      files_touched: [],
    });

    expect(result).toContain("(no files recorded)");
  });

  it("handles single file", () => {
    const result = formatEvaluationPrompt({
      bead_id: "proj-single.1",
      subtask_title: "Single file change",
      files_touched: ["only-this.ts"],
    });

    expect(result).toContain("- `only-this.ts`");
    expect(result.match(/`only-this\.ts`/g)?.length).toBe(1);
  });
});

// ============================================================================
// 3. Tool Tests
// ============================================================================

describe("hive_subtask_prompt tool", () => {
  const mockCtx = {} as ToolContext;

  it("returns formatted prompt", async () => {
    const result = await hive_subtask_prompt.execute(
      {
        agent_name: "tool-test-agent",
        bead_id: "tool-test.1",
        epic_id: "tool-test",
        subtask_title: "Test Tool Execution",
        subtask_description: "Testing the tool",
        files: ["a.ts", "b.ts"],
        shared_context: "Test context",
      },
      mockCtx,
    );

    expect(typeof result).toBe("string");
    expect(result).toContain("tool-test-agent");
    expect(result).toContain("tool-test.1");
    expect(result).toContain("Test Tool Execution");
    expect(result).toContain("- `a.ts`");
    expect(result).toContain("Test context");
  });

  it("handles missing optional fields", async () => {
    const result = await hive_subtask_prompt.execute(
      {
        agent_name: "minimal-agent",
        bead_id: "minimal.1",
        epic_id: "minimal",
        subtask_title: "Minimal test",
        files: ["x.ts"],
      },
      mockCtx,
    );

    expect(result).toContain("minimal-agent");
    expect(result).not.toContain("undefined");
  });
});

describe("hive_spawn_subtask tool", () => {
  const mockCtx = {} as ToolContext;

  it("returns JSON with prompt and metadata", async () => {
    const result = await hive_spawn_subtask.execute(
      {
        bead_id: "spawn-test.1",
        epic_id: "spawn-test",
        subtask_title: "Spawn Test",
        subtask_description: "Testing spawn",
        files: ["spawn.ts"],
        shared_context: "Spawn context",
      },
      mockCtx,
    );

    const parsed = JSON.parse(result);
    expect(parsed.prompt).toBeDefined();
    expect(parsed.bead_id).toBe("spawn-test.1");
    expect(parsed.epic_id).toBe("spawn-test");
    expect(parsed.files).toEqual(["spawn.ts"]);
  });

  it("uses V2 template", async () => {
    const result = await hive_spawn_subtask.execute(
      {
        bead_id: "v2-test.1",
        epic_id: "v2-test",
        subtask_title: "V2 Test",
        files: ["v2.ts"],
      },
      mockCtx,
    );

    const parsed = JSON.parse(result);
    // V2 template has specific markers
    expect(parsed.prompt).toContain("## [IDENTITY]");
    expect(parsed.prompt).toContain("## [TASK]");
  });
});

describe("hive_evaluation_prompt tool", () => {
  const mockCtx = {} as ToolContext;

  it("returns JSON with prompt and schema hints", async () => {
    const result = await hive_evaluation_prompt.execute(
      {
        bead_id: "eval-test.1",
        subtask_title: "Evaluation Test",
        files_touched: ["evaluated.ts", "another.ts"],
      },
      mockCtx,
    );

    const parsed = JSON.parse(result);
    expect(parsed.prompt).toContain("eval-test.1");
    expect(parsed.prompt).toContain("Evaluation Test");
    expect(parsed.prompt).toContain("- `evaluated.ts`");
    expect(parsed.expected_schema).toBe("Evaluation");
    expect(parsed.schema_hint).toBeDefined();
    expect(parsed.schema_hint.passed).toBe("boolean");
    expect(parsed.schema_hint.criteria).toBeDefined();
  });

  it("includes all criteria in schema_hint", async () => {
    const result = await hive_evaluation_prompt.execute(
      {
        bead_id: "criteria-test.1",
        subtask_title: "Criteria Test",
        files_touched: ["c.ts"],
      },
      mockCtx,
    );

    const parsed = JSON.parse(result);
    expect(parsed.schema_hint.criteria.type_safe).toBeDefined();
    expect(parsed.schema_hint.criteria.no_bugs).toBeDefined();
    expect(parsed.schema_hint.criteria.patterns).toBeDefined();
    expect(parsed.schema_hint.criteria.readable).toBeDefined();
  });
});

// ============================================================================
// 4. Edge Cases and Integration Tests
// ============================================================================

describe("Edge cases", () => {
  it("handles very long file lists", () => {
    const files = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    const result = formatSubtaskPromptV2({
      bead_id: "long-list.1",
      epic_id: "long-list",
      subtask_title: "Many files",
      subtask_description: "Testing long file list",
      files,
    });

    // All files should be included
    expect(result).toContain("src/file0.ts");
    expect(result).toContain("src/file49.ts");
    // Check file list format
    files.forEach((file) => {
      expect(result).toContain(`- \`${file}\``);
    });
  });

  it("handles very long description", () => {
    const longDescription = "A".repeat(10000);
    const result = formatSubtaskPromptV2({
      bead_id: "long-desc.1",
      epic_id: "long-desc",
      subtask_title: "Long description",
      subtask_description: longDescription,
      files: ["a.ts"],
    });

    expect(result).toContain(longDescription);
  });

  it("handles newlines in all fields", () => {
    const result = formatSubtaskPrompt({
      agent_name: "agent\nwith\nnewlines",
      bead_id: "newline\ntest.1",
      epic_id: "newline\ntest",
      subtask_title: "Title\nwith\nnewlines",
      subtask_description: "Description\nwith\nmultiple\nnewlines",
      files: ["file\nwith\nnewline.ts"],
      shared_context: "Context\nwith\nnewlines",
    });

    // All newlines should be preserved
    expect(result).toContain("agent\nwith\nnewlines");
    expect(result).toContain("Title\nwith\nnewlines");
    expect(result).toContain("Description\nwith\nmultiple\nnewlines");
  });

  it("handles regex-special characters in inputs", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "regex.+test$[1]",
      epic_id: "regex.+test$",
      subtask_title: "Title with ^regex$ special (chars)*",
      subtask_description: "Pattern: /\\d+/g and \\w+ stuff",
      files: ["src/*.ts", "src/**/*.tsx"],
    });

    // Should not throw and should contain the patterns
    expect(result).toContain("regex.+test$[1]");
    expect(result).toContain("Title with ^regex$ special (chars)*");
    expect(result).toContain("src/*.ts");
  });

  it("handles empty string for all optional fields", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "empty.1",
      epic_id: "empty",
      subtask_title: "Empty optionals",
      subtask_description: "",
      files: [],
      shared_context: "",
      compressed_context: "",
      error_context: "",
    });

    expect(result).toContain("(see title)");
    expect(result).toContain("(no specific files");
    expect(result).toContain("(none)");
    expect(result).not.toContain("undefined");
  });

  it("preserves JSON-like content in descriptions", () => {
    const jsonContent = '{"key": "value", "array": [1, 2, 3]}';
    const result = formatSubtaskPromptV2({
      bead_id: "json.1",
      epic_id: "json",
      subtask_title: "JSON in description",
      subtask_description: `Parse this JSON: ${jsonContent}`,
      files: ["parser.ts"],
    });

    expect(result).toContain(jsonContent);
  });

  it("handles markdown in descriptions", () => {
    const markdown = `
## Header
- Item 1
- Item 2

\`\`\`typescript
const x = 1;
\`\`\`

**Bold** and *italic*
`;
    const result = formatSubtaskPromptV2({
      bead_id: "md.1",
      epic_id: "md",
      subtask_title: "Markdown content",
      subtask_description: markdown,
      files: ["test.ts"],
    });

    expect(result).toContain("## Header");
    expect(result).toContain("- Item 1");
    expect(result).toContain("```typescript");
    expect(result).toContain("**Bold**");
  });
});

// ============================================================================
// 5. Template Consistency Tests
// ============================================================================

describe("Template consistency", () => {
  it("V1 and V2 subtask prompts have consistent terminology", () => {
    // Both should mention hive mail
    expect(SUBTASK_PROMPT).toContain("Hive Mail");
    expect(SUBTASK_PROMPT_V2).toContain("HIVE MAIL");

    // Both should mention beads
    expect(SUBTASK_PROMPT).toContain("bead");
    expect(SUBTASK_PROMPT_V2).toContain("bead");

    // Both should mention hive_complete
    expect(SUBTASK_PROMPT).toContain("hive_complete");
    expect(SUBTASK_PROMPT_V2).toContain("hive_complete");
  });

  it("all templates use consistent placeholder syntax", () => {
    const allTemplates = [
      DECOMPOSITION_PROMPT,
      STRATEGY_DECOMPOSITION_PROMPT,
      SUBTASK_PROMPT,
      SUBTASK_PROMPT_V2,
      EVALUATION_PROMPT,
    ];

    // All placeholders should use {name} syntax
    allTemplates.forEach((template) => {
      // Should not have ${name} syntax (JavaScript template literals)
      expect(template).not.toMatch(/\$\{[^}]+\}/);
    });
  });

  it("decomposition templates require same core fields", () => {
    // Both decomposition prompts should require the same response schema
    expect(DECOMPOSITION_PROMPT).toContain("epic:");
    expect(DECOMPOSITION_PROMPT).toContain("subtasks:");
    expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("epic:");
    expect(STRATEGY_DECOMPOSITION_PROMPT).toContain("subtasks:");
  });
});
