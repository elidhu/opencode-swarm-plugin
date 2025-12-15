/**
 * Tests for eval-capture module
 *
 * Tests JSONL storage, metric calculation, and capture lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  captureDecomposition,
  captureSubtaskOutcome,
  finalizeEvalRecord,
  loadEvalRecords,
  findEvalRecord,
  queryEvalRecords,
  getEvalSummary,
} from "./eval-capture";
import type { SubtaskOutcome } from "./eval-capture";
import type { BeadTree } from "./schemas/bead";

// Test data directory
const TEST_DIR = join(process.cwd(), ".opencode-test");
const ORIGINAL_CWD = process.cwd();

// Helper to create test bead tree
function createTestBeadTree(opts: {
  epicTitle: string;
  subtaskCount: number;
  filesPerSubtask?: number;
}): BeadTree {
  const subtasks: Array<{
    title: string;
    description: string;
    files: string[];
    dependencies: number[];
    estimated_complexity: number;
  }> = [];
  
  for (let i = 0; i < opts.subtaskCount; i++) {
    const files: string[] = [];
    for (let j = 0; j < (opts.filesPerSubtask ?? 1); j++) {
      files.push(`src/file${i}_${j}.ts`);
    }
    subtasks.push({
      title: `Subtask ${i + 1}`,
      description: `Description for subtask ${i + 1}`,
      files,
      dependencies: [],
      estimated_complexity: 2,
    });
  }
  
  return {
    epic: { title: opts.epicTitle, description: `Description for ${opts.epicTitle}` },
    subtasks,
  };
}

describe("eval-capture", () => {
  beforeEach(async () => {
    // Create isolated test directory
    await mkdir(TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    // Restore original directory and cleanup
    process.chdir(ORIGINAL_CWD);
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("captureDecomposition", () => {
    it("creates initial eval record with planning data", async () => {
      const beadTree = createTestBeadTree({
        epicTitle: "Test Epic",
        subtaskCount: 2,
      });

      const recordId = await captureDecomposition({
        task: "Test task",
        strategy: "file-based",
        beadTree,
        epicId: "test-epic-123",
        context: "Test context",
        maxSubtasks: 5,
      });

      expect(recordId).toMatch(/^eval-test-epic-123-\d+$/);

      const records = await loadEvalRecords();
      expect(records).toHaveLength(1);

      const record = records[0];
      expect(record.id).toBe(recordId);
      expect(record.task).toBe("Test task");
      expect(record.strategy).toBe("file-based");
      expect(record.epic_id).toBe("test-epic-123");
      expect(record.subtask_count).toBe(2);
      expect(record.outcomes).toEqual([]);
      expect(record.finalized).toBe(false);
    });

    it("handles auto strategy", async () => {
      const beadTree = createTestBeadTree({
        epicTitle: "Auto Test",
        subtaskCount: 1,
      });

      await captureDecomposition({
        task: "Test",
        strategy: "auto",
        beadTree,
        epicId: "epic-auto",
      });

      const records = await loadEvalRecords();
      expect(records[0].strategy).toBe("auto");
    });
  });

  describe("captureSubtaskOutcome", () => {
    let recordId: string;

    beforeEach(async () => {
      const beadTree = createTestBeadTree({
        epicTitle: "Test Epic",
        subtaskCount: 2,
      });

      recordId = await captureDecomposition({
        task: "Test task",
        strategy: "file-based",
        beadTree,
        epicId: "test-epic-456",
      });
    });

    it("appends outcome and recalculates metrics", async () => {
      const outcome1: SubtaskOutcome = {
        bead_id: "test-epic-456.1",
        title: "Subtask 1",
        agent_name: "agent-1",
        duration_ms: 5000,
        files_touched: ["src/file1.ts", "src/extra.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      };

      await captureSubtaskOutcome("test-epic-456", outcome1);

      const record = await findEvalRecord("test-epic-456");
      expect(record).toBeDefined();
      expect(record!.outcomes).toHaveLength(1);
      expect(record!.outcomes[0].bead_id).toBe("test-epic-456.1");

      // Metrics should be calculated
      expect(record!.actual_files).toBeDefined();
      expect(record!.scope_accuracy).toBeDefined();
      expect(record!.success_rate).toBe(1.0);
    });

    it("calculates time balance with multiple outcomes", async () => {
      const outcome1: SubtaskOutcome = {
        bead_id: "test-epic-456.1",
        title: "Subtask 1",
        duration_ms: 1000,
        files_touched: ["src/file1.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      };

      const outcome2: SubtaskOutcome = {
        bead_id: "test-epic-456.2",
        title: "Subtask 2",
        duration_ms: 5000,
        files_touched: ["src/file2.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      };

      await captureSubtaskOutcome("test-epic-456", outcome1);
      await captureSubtaskOutcome("test-epic-456", outcome2);

      const record = await findEvalRecord("test-epic-456");
      expect(record!.time_balance).toBeCloseTo(5.0, 1); // 5000 / 1000
      expect(record!.total_duration_ms).toBe(6000);
    });

    it("handles failures in success rate", async () => {
      const outcome1: SubtaskOutcome = {
        bead_id: "test-epic-456.1",
        title: "Subtask 1",
        duration_ms: 1000,
        files_touched: [],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      };

      const outcome2: SubtaskOutcome = {
        bead_id: "test-epic-456.2",
        title: "Subtask 2",
        duration_ms: 2000,
        files_touched: [],
        success: false,
        error_count: 3,
        retry_count: 2,
        timestamp: new Date().toISOString(),
      };

      await captureSubtaskOutcome("test-epic-456", outcome1);
      await captureSubtaskOutcome("test-epic-456", outcome2);

      const record = await findEvalRecord("test-epic-456");
      expect(record!.success_rate).toBe(0.5); // 1 / 2
    });
  });

  describe("finalizeEvalRecord", () => {
    it("marks record as finalized and checks quality", async () => {
      const beadTree = createTestBeadTree({
        epicTitle: "Quality Test",
        subtaskCount: 2,
      });

      await captureDecomposition({
        task: "Test",
        strategy: "file-based",
        beadTree,
        epicId: "quality-epic",
      });

      // Add well-balanced outcomes
      await captureSubtaskOutcome("quality-epic", {
        bead_id: "quality-epic.1",
        title: "Task 1",
        duration_ms: 1000,
        files_touched: ["src/file0_0.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      });

      await captureSubtaskOutcome("quality-epic", {
        bead_id: "quality-epic.2",
        title: "Task 2",
        duration_ms: 1200,
        files_touched: ["src/file1_0.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      });

      await finalizeEvalRecord("quality-epic");

      const record = await findEvalRecord("quality-epic");
      expect(record!.finalized).toBe(true);
      expect(record!.finalize_timestamp).toBeDefined();
      expect(record!.quality_passed).toBe(true);
      expect(record!.quality_issues).toBeUndefined();
    });

    it("detects quality issues", async () => {
      const beadTree: BeadTree = {
        epic: { title: "Poor Quality Test", description: "" },
        subtasks: [
          {
            title: "Task 1",
            description: "",
            files: ["src/file1.ts", "src/shared.ts"],
            dependencies: [],
            estimated_complexity: 1,
          },
          {
            title: "Task 2",
            description: "",
            files: ["src/file2.ts", "src/shared.ts"], // Overlap!
            dependencies: [],
            estimated_complexity: 1,
          },
        ],
      };

      await captureDecomposition({
        task: "Test",
        strategy: "file-based",
        beadTree,
        epicId: "poor-epic",
      });

      // Add imbalanced outcomes
      await captureSubtaskOutcome("poor-epic", {
        bead_id: "poor-epic.1",
        title: "Task 1",
        duration_ms: 1000,
        files_touched: ["src/file1.ts", "src/shared.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      });

      await captureSubtaskOutcome("poor-epic", {
        bead_id: "poor-epic.2",
        title: "Task 2",
        duration_ms: 10000, // 10x slower!
        files_touched: ["src/file2.ts", "src/shared.ts", "src/extra1.ts", "src/extra2.ts"],
        success: false, // Failed
        error_count: 2,
        retry_count: 1,
        timestamp: new Date().toISOString(),
      });

      await finalizeEvalRecord("poor-epic");

      const record = await findEvalRecord("poor-epic");
      expect(record!.finalized).toBe(true);
      expect(record!.quality_passed).toBe(false);
      expect(record!.quality_issues).toBeDefined();
      expect(record!.quality_issues!.length).toBeGreaterThan(0);

      // Should detect: poor time balance, file overlap, incomplete success
      expect(record!.quality_issues!.some((i) => i.includes("time balance"))).toBe(true);
      expect(record!.quality_issues!.some((i) => i.includes("File conflicts"))).toBe(true);
      expect(record!.quality_issues!.some((i) => i.includes("success"))).toBe(true);
    });
  });

  describe("queryEvalRecords", () => {
    beforeEach(async () => {
      // Create multiple test records
      const strategies = ["file-based", "feature-based", "risk-based"] as const;

      for (let i = 0; i < 3; i++) {
        const beadTree = createTestBeadTree({
          epicTitle: `Epic ${i}`,
          subtaskCount: 1,
        });

        const epicId = `epic-${i}`;
        await captureDecomposition({
          task: `Task ${i}`,
          strategy: strategies[i],
          beadTree,
          epicId,
        });

        // Finalize some records
        if (i < 2) {
          await captureSubtaskOutcome(epicId, {
            bead_id: `${epicId}.1`,
            title: "Task",
            duration_ms: 1000,
            files_touched: [`src/file${i}_0.ts`],
            success: true,
            error_count: 0,
            retry_count: 0,
            timestamp: new Date().toISOString(),
          });
          await finalizeEvalRecord(epicId);
        }
      }
    });

    it("queries by strategy", async () => {
      const fileBasedRecords = await queryEvalRecords({ strategy: "file-based" });
      expect(fileBasedRecords).toHaveLength(1);
      expect(fileBasedRecords[0].strategy).toBe("file-based");
    });

    it("queries by finalized status", async () => {
      const finalized = await queryEvalRecords({ finalized: true });
      expect(finalized).toHaveLength(2);

      const active = await queryEvalRecords({ finalized: false });
      expect(active).toHaveLength(1);
    });

    it("queries by quality", async () => {
      const passed = await queryEvalRecords({ qualityPassed: true });
      expect(passed).toHaveLength(2);
      expect(passed.every((r) => r.quality_passed === true)).toBe(true);
    });
  });

  describe("getEvalSummary", () => {
    it("computes summary statistics", async () => {
      const beadTree1 = createTestBeadTree({
        epicTitle: "Summary Test 1",
        subtaskCount: 1,
      });

      const beadTree2 = createTestBeadTree({
        epicTitle: "Summary Test 2",
        subtaskCount: 1,
      });

      await captureDecomposition({
        task: "Test 1",
        strategy: "file-based",
        beadTree: beadTree1,
        epicId: "summary-1",
      });

      await captureDecomposition({
        task: "Test 2",
        strategy: "feature-based",
        beadTree: beadTree2,
        epicId: "summary-2",
      });

      // Finalize one
      await captureSubtaskOutcome("summary-1", {
        bead_id: "summary-1.1",
        title: "Task",
        duration_ms: 1000,
        files_touched: ["src/file0_0.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      });
      await finalizeEvalRecord("summary-1");

      const summary = await getEvalSummary();
      expect(summary.total_decompositions).toBe(2);
      expect(summary.finalized_count).toBe(1);
      expect(summary.by_strategy["file-based"]).toBe(1);
      expect(summary.by_strategy["feature-based"]).toBe(1);
    });
  });

  describe("metric calculation edge cases", () => {
    it("handles zero planned files", async () => {
      const beadTree: BeadTree = {
        epic: { title: "Empty Files Test", description: "" },
        subtasks: [
          {
            title: "Task",
            description: "",
            files: [],
            dependencies: [],
            estimated_complexity: 1,
          },
        ],
      };

      await captureDecomposition({
        task: "Test",
        strategy: "file-based",
        beadTree,
        epicId: "empty-files",
      });

      await captureSubtaskOutcome("empty-files", {
        bead_id: "empty-files.1",
        title: "Task",
        duration_ms: 1000,
        files_touched: [],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      });

      const record = await findEvalRecord("empty-files");
      expect(record!.scope_accuracy).toBe(0);
    });

    it("handles single subtask (no time balance)", async () => {
      const beadTree = createTestBeadTree({
        epicTitle: "Single Task",
        subtaskCount: 1,
      });

      await captureDecomposition({
        task: "Test",
        strategy: "file-based",
        beadTree,
        epicId: "single-task",
      });

      await captureSubtaskOutcome("single-task", {
        bead_id: "single-task.1",
        title: "Task",
        duration_ms: 1000,
        files_touched: ["src/file0_0.ts"],
        success: true,
        error_count: 0,
        retry_count: 0,
        timestamp: new Date().toISOString(),
      });

      const record = await findEvalRecord("single-task");
      expect(record!.time_balance).toBe(1); // No comparison possible
    });
  });
});
