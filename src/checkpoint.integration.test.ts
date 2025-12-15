/**
 * Integration tests for checkpoint and recovery system
 *
 * Tests the full checkpoint/recovery flow including:
 * - Saving checkpoints with dual-write pattern
 * - Loading latest checkpoints
 * - Milestone detection and auto-checkpoint triggers
 * - Fresh start detection
 * - Recovery event tracking
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  getMilestone,
  shouldAutoCheckpoint,
} from "./checkpoint";
import { getDatabase } from "./streams";
import { runMigrations } from "./streams/migrations";
import type { SwarmBeadContext } from "./schemas/checkpoint";

describe("Checkpoint Integration Tests", () => {
  const testProjectPath = ":memory:";
  let db: Awaited<ReturnType<typeof getDatabase>>;

  beforeEach(async () => {
    // Get fresh in-memory database for each test
    db = await getDatabase(testProjectPath);
    await runMigrations(db);
  });

  describe("saveCheckpoint", () => {
    it("should save a checkpoint with dual-write pattern", async () => {
      const checkpoint = await saveCheckpoint(
        {
          epic_id: "test-epic-1",
          bead_id: "test-epic-1.1",
          agent_name: "worker-1",
          task_description: "Implement feature X",
          files: ["src/foo.ts", "src/bar.ts"],
          strategy: "file-based",
          progress_percent: 50,
          last_milestone: "half",
          files_touched: ["src/foo.ts"],
        },
        testProjectPath,
      );

      expect(checkpoint.epic_id).toBe("test-epic-1");
      expect(checkpoint.bead_id).toBe("test-epic-1.1");
      expect(checkpoint.progress_percent).toBe(50);
      expect(checkpoint.recovery_state).toBe("pending");
      expect(checkpoint.checkpointed_at).toBeDefined();

      // Verify event was written
      const events = await db.query(
        "SELECT * FROM events WHERE type = 'checkpoint_created' AND data->>'bead_id' = $1",
        ["test-epic-1.1"],
      );
      expect(events.rows.length).toBe(1);

      // Verify table was written
      const contexts = await db.query(
        "SELECT * FROM swarm_contexts WHERE bead_id = $1",
        ["test-epic-1.1"],
      );
      expect(contexts.rows.length).toBe(1);
    });

    it("should upsert on subsequent saves", async () => {
      // First save
      await saveCheckpoint(
        {
          epic_id: "test-epic-2",
          bead_id: "test-epic-2.1",
          agent_name: "worker-1",
          task_description: "Task",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 25,
        },
        testProjectPath,
      );

      // Second save (should upsert, not insert)
      await saveCheckpoint(
        {
          epic_id: "test-epic-2",
          bead_id: "test-epic-2.1",
          agent_name: "worker-1",
          task_description: "Task",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 50,
        },
        testProjectPath,
      );

      // Should have 2 events (audit trail)
      const events = await db.query(
        "SELECT * FROM events WHERE type = 'checkpoint_created' AND data->>'bead_id' = $1",
        ["test-epic-2.1"],
      );
      expect(events.rows.length).toBe(2);

      // But only 1 row in table (upserted)
      const contexts = await db.query(
        "SELECT * FROM swarm_contexts WHERE bead_id = $1",
        ["test-epic-2.1"],
      );
      expect(contexts.rows.length).toBe(1);

      // Latest progress should be 50%
      const row = contexts.rows[0] as { context: unknown };
      const contextData =
        typeof row.context === "string"
          ? JSON.parse(row.context)
          : row.context;
      const context = contextData as SwarmBeadContext;
      expect(context.progress_percent).toBe(50);
    });
  });

  describe("loadCheckpoint", () => {
    it("should load the latest checkpoint", async () => {
      // Save multiple checkpoints
      await saveCheckpoint(
        {
          epic_id: "test-epic-3",
          bead_id: "test-epic-3.1",
          agent_name: "worker-1",
          task_description: "Task",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 25,
        },
        testProjectPath,
      );

      await saveCheckpoint(
        {
          epic_id: "test-epic-3",
          bead_id: "test-epic-3.1",
          agent_name: "worker-1",
          task_description: "Task",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 75,
        },
        testProjectPath,
      );

      const result = await loadCheckpoint(
        {
          epic_id: "test-epic-3",
          bead_id: "test-epic-3.1",
        },
        testProjectPath,
      );

      expect(result.success).toBe(true);
      expect(result.fresh_start).toBe(false);
      expect(result.context).toBeDefined();
      expect(result.context!.progress_percent).toBe(75);
      expect(result.context!.recovery_state).toBe("recovered");

      // Verify checkpoint_recovered event was written
      const events = await db.query(
        "SELECT * FROM events WHERE type = 'checkpoint_recovered' AND data->>'bead_id' = $1",
        ["test-epic-3.1"],
      );
      expect(events.rows.length).toBe(1);
    });

    it("should return fresh_start when no checkpoint exists", async () => {
      const result = await loadCheckpoint(
        {
          epic_id: "nonexistent-epic",
          bead_id: "nonexistent-bead",
        },
        testProjectPath,
      );

      expect(result.success).toBe(true);
      expect(result.fresh_start).toBe(true);
      expect(result.context).toBeUndefined();
    });

    it("should filter by agent_name when provided", async () => {
      // Save checkpoints for different agents
      await saveCheckpoint(
        {
          epic_id: "test-epic-4",
          bead_id: "test-epic-4.1",
          agent_name: "worker-1",
          task_description: "Task",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 25,
        },
        testProjectPath,
      );

      await saveCheckpoint(
        {
          epic_id: "test-epic-4",
          bead_id: "test-epic-4.1",
          agent_name: "worker-2",
          task_description: "Task",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 50,
        },
        testProjectPath,
      );

      // Load checkpoint for worker-2
      const result = await loadCheckpoint(
        {
          epic_id: "test-epic-4",
          bead_id: "test-epic-4.1",
          agent_name: "worker-2",
        },
        testProjectPath,
      );

      expect(result.success).toBe(true);
      expect(result.context!.agent_name).toBe("worker-2");
      expect(result.context!.progress_percent).toBe(50);
    });
  });

  describe("listCheckpoints", () => {
    it("should list all checkpoints for an epic", async () => {
      // Save checkpoints for multiple beads
      await saveCheckpoint(
        {
          epic_id: "test-epic-5",
          bead_id: "test-epic-5.1",
          agent_name: "worker-1",
          task_description: "Task 1",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 50,
        },
        testProjectPath,
      );

      await saveCheckpoint(
        {
          epic_id: "test-epic-5",
          bead_id: "test-epic-5.2",
          agent_name: "worker-2",
          task_description: "Task 2",
          files: ["src/bar.ts"],
          strategy: "feature-based",
          progress_percent: 75,
        },
        testProjectPath,
      );

      const checkpoints = await listCheckpoints("test-epic-5", testProjectPath);

      expect(checkpoints.length).toBe(2);
      // Should be ordered by most recent first
      expect(checkpoints[0].bead_id).toBe("test-epic-5.2");
      expect(checkpoints[1].bead_id).toBe("test-epic-5.1");
    });

    it("should return empty array for epic with no checkpoints", async () => {
      const checkpoints = await listCheckpoints(
        "nonexistent-epic",
        testProjectPath,
      );
      expect(checkpoints.length).toBe(0);
    });
  });

  describe("Milestone Detection", () => {
    it("should correctly detect milestones", () => {
      expect(getMilestone(0)).toBe("started");
      expect(getMilestone(24)).toBe("started");
      expect(getMilestone(25)).toBe("quarter");
      expect(getMilestone(49)).toBe("quarter");
      expect(getMilestone(50)).toBe("half");
      expect(getMilestone(74)).toBe("half");
      expect(getMilestone(75)).toBe("three-quarters");
      expect(getMilestone(99)).toBe("three-quarters");
      expect(getMilestone(100)).toBe("complete");
    });

    it("should trigger auto-checkpoint at milestone boundaries", () => {
      // No checkpoint at start
      expect(shouldAutoCheckpoint(0, 0)).toBe(false);
      expect(shouldAutoCheckpoint(10, 5)).toBe(false);

      // Checkpoint at 25%
      expect(shouldAutoCheckpoint(25, 24)).toBe(true);
      expect(shouldAutoCheckpoint(30, 24)).toBe(true);

      // No checkpoint within same milestone
      expect(shouldAutoCheckpoint(30, 26)).toBe(false);

      // Checkpoint at 50%
      expect(shouldAutoCheckpoint(50, 49)).toBe(true);
      expect(shouldAutoCheckpoint(55, 45)).toBe(true);

      // Checkpoint at 75%
      expect(shouldAutoCheckpoint(75, 74)).toBe(true);
      expect(shouldAutoCheckpoint(80, 70)).toBe(true);

      // No checkpoint at 100% (use hive_complete instead)
      expect(shouldAutoCheckpoint(100, 99)).toBe(false);
    });

    it("should not trigger when going backwards", () => {
      expect(shouldAutoCheckpoint(25, 50)).toBe(false);
      expect(shouldAutoCheckpoint(50, 75)).toBe(false);
    });
  });

  describe("Recovery Flow", () => {
    it("should support full crash recovery flow", async () => {
      // 1. Agent starts task and saves checkpoint at 25%
      await saveCheckpoint(
        {
          epic_id: "test-epic-6",
          bead_id: "test-epic-6.1",
          agent_name: "worker-1",
          task_description: "Implement feature X",
          files: ["src/foo.ts"],
          strategy: "file-based",
          progress_percent: 25,
          last_milestone: "quarter",
          directives: ["Keep functions pure", "Add tests"],
          files_touched: ["src/foo.ts"],
        },
        testProjectPath,
      );

      // 2. Agent crashes (simulated)

      // 3. Coordinator recovers checkpoint
      const recovery = await loadCheckpoint(
        {
          epic_id: "test-epic-6",
          bead_id: "test-epic-6.1",
        },
        testProjectPath,
      );

      expect(recovery.success).toBe(true);
      expect(recovery.context).toBeDefined();

      const context = recovery.context!;
      expect(context.progress_percent).toBe(25);
      expect(context.last_milestone).toBe("quarter");
      expect(context.directives).toEqual(["Keep functions pure", "Add tests"]);
      expect(context.files_touched).toEqual(["src/foo.ts"]);
      expect(context.recovery_state).toBe("recovered");

      // 4. Verify recovery event was recorded
      const events = await db.query(
        "SELECT * FROM events WHERE type = 'checkpoint_recovered' AND data->>'bead_id' = $1",
        ["test-epic-6.1"],
      );
      expect(events.rows.length).toBe(1);
      const row = events.rows[0];
      expect(row).toBeDefined();
      const rowData = row as { data: Record<string, unknown> };
      expect(rowData.data.success).toBe(true);
    });
  });
});
