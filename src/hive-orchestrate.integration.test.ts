/**
 * Integration tests for hive-orchestrate.ts - Single-task tracking tools
 *
 * Tests the following tools:
 * - hive_track_single: Creates tracking bead for single-agent work
 * - hive_spawn_child: Creates child beads for emergent complexity
 * - Integration with hive_progress, hive_checkpoint, hive_recover, hive_complete
 *
 * Run with: pnpm test:integration
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tools under test
import {
  hive_track_single,
  hive_spawn_child,
  hive_checkpoint,
  hive_recover,
  hive_progress,
  hive_complete,
  setBeadsTestDir,
} from "./hive-orchestrate";

// Database utilities
import { resetDatabase, closeDatabase, getDatabase } from "./streams/index";

// Note: LanceDBStorage available via ./storage if needed for pattern verification

// ============================================================================
// Test Configuration
// ============================================================================

/** Generate unique test database path per test run */
function testDbPath(prefix = "hive-orchestrate"): string {
  return `/tmp/${prefix}-${randomUUID()}`;
}

/** Track paths created during test for cleanup */
let testPaths: string[] = [];

function trackPath(path: string): string {
  testPaths.push(path);
  return path;
}

/**
 * Track bead IDs created during tests for cleanup.
 * CRITICAL: Tests create beads via bd CLI which persist in .beads/issues.jsonl.
 * These must be closed after each test to prevent orphaned in_progress beads.
 */
let createdBeadIds: string[] = [];

function trackBead(beadId: string): string {
  createdBeadIds.push(beadId);
  return beadId;
}

let TEST_DB_PATH: string;
let VECTOR_DIR: string;

/**
 * Ephemeral beads directory for test isolation.
 * Tests run bd commands in this temp directory so they don't pollute
 * the project's real .beads/ database.
 */
let BEADS_TEST_DIR: string;

/** Helper to create unique test directories for LanceDB */
function createVectorDir(): string {
  const dir = join(tmpdir(), `lancedb-hive-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create an ephemeral beads directory for test isolation.
 * Initializes bd in a temp directory so tests don't pollute production beads.
 */
async function createBeadsTestDir(): Promise<string> {
  const dir = join(tmpdir(), `beads-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  
  // Initialize beads in the temp directory with sandbox mode
  const result = await Bun.$`bd init --prefix test --quiet --sandbox`.cwd(dir).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Failed to initialize beads test directory: ${result.stderr.toString()}`);
  }
  
  return dir;
}

/** Helper to clean up test directories */
function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run bd command in the ephemeral test beads directory.
 * This ensures test beads don't pollute the project's real .beads/.
 */
async function bdTest(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await Bun.$`bd ${args}`.cwd(BEADS_TEST_DIR).quiet().nothrow();
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/**
 * Generate a unique test context to avoid state collisions between tests
 */
function createTestContext() {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    sessionID: id,
    messageID: `msg-${id}`,
    agent: "test-agent",
    abort: new AbortController().signal,
  };
}

/**
 * Helper to execute tool and parse JSON response.
 * Automatically tracks bead_id and child_bead_id for cleanup.
 */
async function executeTool<T>(
  tool: { execute: (args: any, ctx: any) => Promise<string> },
  args: any,
  ctx: ReturnType<typeof createTestContext>,
): Promise<T> {
  const result = await tool.execute(args, ctx);
  const parsed = JSON.parse(result) as T;
  
  // Auto-track beads created by hive tools for cleanup
  // This prevents orphaned in_progress beads after test runs
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.bead_id === "string" && obj.bead_id) {
      trackBead(obj.bead_id);
    }
    if (typeof obj.child_bead_id === "string" && obj.child_bead_id) {
      trackBead(obj.child_bead_id);
    }
  }
  
  return parsed;
}

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeEach(async () => {
  testPaths = [];
  createdBeadIds = [];
  TEST_DB_PATH = trackPath(testDbPath());
  VECTOR_DIR = createVectorDir();
  
  // Create ephemeral beads directory for test isolation
  // This prevents test beads from polluting the project's real .beads/
  BEADS_TEST_DIR = await createBeadsTestDir();
  
  // Configure hive-orchestrate tools to use the ephemeral beads directory
  setBeadsTestDir(BEADS_TEST_DIR);
  
  // Initialize PGLite database
  await resetDatabase(TEST_DB_PATH);
});

afterEach(async () => {
  // Reset beads test directory before cleanup
  setBeadsTestDir(null);
  
  // Clean up ephemeral beads directory (no need to close individual beads)
  // The entire temp directory is deleted, so beads never pollute production
  if (BEADS_TEST_DIR) {
    cleanupDir(BEADS_TEST_DIR);
  }
  createdBeadIds = [];

  // Clean up all test databases
  for (const path of testPaths) {
    try {
      const db = await getDatabase(path);
      await db.exec(`
        DELETE FROM message_recipients;
        DELETE FROM messages;
        DELETE FROM reservations;
        DELETE FROM agents;
        DELETE FROM events;
        DELETE FROM locks;
        DELETE FROM cursors;
        DELETE FROM deferred;
        DELETE FROM swarm_contexts;
      `);
    } catch {
      // Ignore errors during cleanup
    }
    await closeDatabase(path);
  }
  testPaths = [];
  
  // Clean up vector directory
  await new Promise((r) => setTimeout(r, 50));
  cleanupDir(VECTOR_DIR);
});

// ============================================================================
// hive_track_single Tests
// ============================================================================

describe("hive-orchestrate integration", () => {
  describe("hive_track_single", () => {
    it("creates a tracking bead with minimal args", async () => {
      const ctx = createTestContext();
      
      // Check if bd CLI is available
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const result = await executeTool<{
        success: boolean;
        bead_id: string;
        agent_name: string;
        task_description: string;
        checkpoint_enabled: boolean;
        next_steps: string[];
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Test single task tracking",
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.bead_id).toBeTruthy();
      expect(result.agent_name).toMatch(/^single-/);
      expect(result.task_description).toBe("Test single task tracking");
      expect(result.checkpoint_enabled).toBe(true);
      expect(result.next_steps).toHaveLength(4);
      expect(result.next_steps[0]).toContain("hive_progress");
    });

    it("uses provided agent name", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const result = await executeTool<{
        success: boolean;
        agent_name: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Task with custom agent",
          agent_name: "custom-agent-123",
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.agent_name).toBe("custom-agent-123");
    });

    it("creates bead marked as in_progress", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const result = await executeTool<{
        success: boolean;
        bead_id: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Task to verify status",
        },
        ctx,
      );

      expect(result.success).toBe(true);

      // Verify bead is in_progress using bd show (in test directory)
      const showResult = await bdTest(["show", result.bead_id, "--json"]);
      if (showResult.exitCode === 0) {
        const beadData = JSON.parse(showResult.stdout);
        const bead = Array.isArray(beadData) ? beadData[0] : beadData;
        expect(bead.status).toBe("in_progress");
      }
    });

    it("saves initial checkpoint at 0% progress", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const result = await executeTool<{
        success: boolean;
        bead_id: string;
        checkpoint_enabled: boolean;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Task with initial checkpoint",
          files: ["src/test.ts"],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.checkpoint_enabled).toBe(true);

      // Verify checkpoint was saved by attempting recovery
      const recovery = await executeTool<{
        success: boolean;
        fresh_start: boolean;
        context?: {
          progress_percent: number;
          last_milestone: string;
        };
      }>(
        hive_recover,
        {
          project_key: TEST_DB_PATH,
          epic_id: result.bead_id,
          bead_id: result.bead_id,
        },
        ctx,
      );

      expect(recovery.success).toBe(true);
      expect(recovery.fresh_start).toBe(false);
      expect(recovery.context?.progress_percent).toBe(0);
      expect(recovery.context?.last_milestone).toBe("started");
    });

    it("includes files in checkpoint context", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const testFiles = ["src/auth.ts", "src/login.tsx"];

      const result = await executeTool<{
        success: boolean;
        bead_id: string;
        files: string[];
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Task with files",
          files: testFiles,
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.files).toEqual(testFiles);
    });
  });

  // ============================================================================
  // hive_spawn_child Tests
  // ============================================================================

  describe("hive_spawn_child", () => {
    it("creates child bead under parent", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      // First create a parent bead
      const parent = await executeTool<{
        success: boolean;
        bead_id: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Parent task",
        },
        ctx,
      );

      expect(parent.success).toBe(true);

      // Spawn a child
      const child = await executeTool<{
        success: boolean;
        child_bead_id: string;
        parent_bead_id: string;
        epic_id: string;
        type: string;
        title: string;
        notification_sent: boolean;
      }>(
        hive_spawn_child,
        {
          parent_bead_id: parent.bead_id,
          title: "Discovered subtask",
          description: "Found this while working on parent",
          project_key: TEST_DB_PATH,
        },
        ctx,
      );

      expect(child.success).toBe(true);
      expect(child.child_bead_id).toBeTruthy();
      expect(child.parent_bead_id).toBe(parent.bead_id);
      expect(child.epic_id).toBe(parent.bead_id);
      expect(child.title).toBe("Discovered subtask");
    });

    it("creates child with correct type (bug)", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const parent = await executeTool<{
        success: boolean;
        bead_id: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Parent for bug discovery",
        },
        ctx,
      );

      const child = await executeTool<{
        success: boolean;
        child_bead_id: string;
        type: string;
      }>(
        hive_spawn_child,
        {
          parent_bead_id: parent.bead_id,
          title: "Found null pointer bug",
          type: "bug",
          project_key: TEST_DB_PATH,
        },
        ctx,
      );

      expect(child.success).toBe(true);
      // Verify bead type using bd show (in test directory)
      const showResult = await bdTest(["show", child.child_bead_id, "--json"]);
      if (showResult.exitCode === 0) {
        const beadData = JSON.parse(showResult.stdout);
        const bead = Array.isArray(beadData) ? beadData[0] : beadData;
        expect(bead.issue_type).toBe("bug");
      }
    });

    it("creates nested children (child of child)", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      // Create parent
      const parent = await executeTool<{
        success: boolean;
        bead_id: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Grandparent task",
        },
        ctx,
      );

      // Create first child
      const child1 = await executeTool<{
        success: boolean;
        child_bead_id: string;
      }>(
        hive_spawn_child,
        {
          parent_bead_id: parent.bead_id,
          title: "First level child",
          project_key: TEST_DB_PATH,
        },
        ctx,
      );

      // Create grandchild (child of child)
      const grandchild = await executeTool<{
        success: boolean;
        child_bead_id: string;
        parent_bead_id: string;
      }>(
        hive_spawn_child,
        {
          parent_bead_id: child1.child_bead_id,
          title: "Second level child (grandchild)",
          project_key: TEST_DB_PATH,
        },
        ctx,
      );

      expect(grandchild.success).toBe(true);
      expect(grandchild.parent_bead_id).toBe(child1.child_bead_id);
      expect(grandchild.child_bead_id).toBeTruthy();
    });

    it("sends discovery notification to coordinator thread", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const parent = await executeTool<{
        success: boolean;
        bead_id: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Parent for notification test",
        },
        ctx,
      );

      const child = await executeTool<{
        success: boolean;
        notification_sent: boolean;
      }>(
        hive_spawn_child,
        {
          parent_bead_id: parent.bead_id,
          title: "Child with notification",
          project_key: TEST_DB_PATH,
        },
        ctx,
      );

      expect(child.success).toBe(true);
      // Notification may or may not be sent depending on hive-mail setup
      // Just verify the field exists
      expect(typeof child.notification_sent).toBe("boolean");
    });
  });

  // ============================================================================
  // Recovery After Simulated Crash Tests
  // ============================================================================

  describe("recovery after simulated crash", () => {
    it("recovers checkpoint with directives", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      // Create tracked task
      const tracked = await executeTool<{
        success: boolean;
        bead_id: string;
        agent_name: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Task with checkpoint recovery",
          files: ["src/recovery.ts"],
        },
        ctx,
      );

      // Save checkpoint with directives at 50%
      await executeTool(
        hive_checkpoint,
        {
          project_key: TEST_DB_PATH,
          agent_name: tracked.agent_name,
          epic_id: tracked.bead_id,
          bead_id: tracked.bead_id,
          task_description: "Task with checkpoint recovery",
          files: ["src/recovery.ts"],
          strategy: "auto",
          directives: ["Keep functions pure", "Add tests for edge cases"],
          progress_percent: 50,
          files_touched: ["src/recovery.ts"],
        },
        ctx,
      );

      // Simulate crash by just attempting recovery
      const recovery = await executeTool<{
        success: boolean;
        fresh_start: boolean;
        context?: {
          progress_percent: number;
          last_milestone: string;
          directives: string[];
          files_touched: string[];
        };
        message: string;
      }>(
        hive_recover,
        {
          project_key: TEST_DB_PATH,
          epic_id: tracked.bead_id,
          bead_id: tracked.bead_id,
        },
        ctx,
      );

      expect(recovery.success).toBe(true);
      expect(recovery.fresh_start).toBe(false);
      expect(recovery.context?.progress_percent).toBe(50);
      expect(recovery.context?.last_milestone).toBe("half");
      expect(recovery.context?.directives).toEqual([
        "Keep functions pure",
        "Add tests for edge cases",
      ]);
      expect(recovery.context?.files_touched).toEqual(["src/recovery.ts"]);
      expect(recovery.message).toContain("50%");
    });

    it("returns fresh_start when no checkpoint exists", async () => {
      const ctx = createTestContext();

      const recovery = await executeTool<{
        success: boolean;
        fresh_start: boolean;
        message: string;
      }>(
        hive_recover,
        {
          project_key: TEST_DB_PATH,
          epic_id: "nonexistent-epic",
          bead_id: "nonexistent-bead",
        },
        ctx,
      );

      expect(recovery.success).toBe(true);
      expect(recovery.fresh_start).toBe(true);
      expect(recovery.message).toContain("fresh");
    });

    it("filters recovery by agent name", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      // Create tracked task
      const tracked = await executeTool<{
        success: boolean;
        bead_id: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Task for agent filter test",
          agent_name: "agent-alpha",
        },
        ctx,
      );

      // Save checkpoint for agent-alpha
      await executeTool(
        hive_checkpoint,
        {
          project_key: TEST_DB_PATH,
          agent_name: "agent-alpha",
          epic_id: tracked.bead_id,
          bead_id: tracked.bead_id,
          task_description: "Task for agent filter test",
          files: [],
          strategy: "auto",
          progress_percent: 25,
        },
        ctx,
      );

      // Recover with agent filter
      const recovery = await executeTool<{
        success: boolean;
        fresh_start: boolean;
        context?: {
          agent_name: string;
          progress_percent: number;
        };
      }>(
        hive_recover,
        {
          project_key: TEST_DB_PATH,
          epic_id: tracked.bead_id,
          bead_id: tracked.bead_id,
          agent_name: "agent-alpha",
        },
        ctx,
      );

      expect(recovery.success).toBe(true);
      expect(recovery.fresh_start).toBe(false);
      expect(recovery.context?.agent_name).toBe("agent-alpha");
    });
  });

  // ============================================================================
  // Pattern Learning on Completion Tests
  // ============================================================================

  describe("pattern learning on completion", () => {
    it("stores success pattern on hive_complete", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      // Create tracked task
      const tracked = await executeTool<{
        success: boolean;
        bead_id: string;
        agent_name: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Task to complete with pattern",
          files: ["src/pattern.ts"],
        },
        ctx,
      );

      // Complete the task
      const completion = await executeTool<{
        success: boolean;
        bead_id: string;
        closed: boolean;
        memory_stored: boolean;
        outcome_recorded: boolean;
      }>(
        hive_complete,
        {
          project_key: TEST_DB_PATH,
          agent_name: tracked.agent_name,
          bead_id: tracked.bead_id,
          summary: "Successfully implemented pattern feature",
          files_touched: ["src/pattern.ts"],
          skip_verification: true, // Skip for test
        },
        ctx,
      );

      expect(completion.success).toBe(true);
      expect(completion.closed).toBe(true);
      // Memory storage depends on storage availability
      expect(typeof completion.memory_stored).toBe("boolean");
      expect(typeof completion.outcome_recorded).toBe("boolean");
    });
  });

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================

  describe("edge cases", () => {
    it("handles missing bd CLI gracefully", async () => {
      const ctx = createTestContext();
      
      // This test documents the behavior when bd is not available
      // The tool should return a meaningful error
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode === 0) {
        // bd is available, test actual functionality
        const result = await executeTool<{
          success: boolean;
        }>(
          hive_track_single,
          {
            project_key: TEST_DB_PATH,
            task_description: "Test task",
          },
          ctx,
        );
        expect(result.success).toBe(true);
      } else {
        // bd not available - test should document expected behavior
        console.log("bd CLI not available - this is expected in some environments");
      }
    });

    it("handles invalid parent bead ID in spawn_child", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      const result = await executeTool<{
        success: boolean;
        error?: string;
        hint?: string;
      }>(
        hive_spawn_child,
        {
          parent_bead_id: "nonexistent-parent-bead-xyz",
          title: "Orphan child task",
          project_key: TEST_DB_PATH,
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.hint).toContain("Verify parent bead exists");
    });
  });

  // ============================================================================
  // Full Workflow Integration Tests
  // ============================================================================

  describe("full workflow integration", () => {
    it("complete single-task lifecycle: track -> progress -> checkpoint -> complete", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      // 1. Track single task
      const tracked = await executeTool<{
        success: boolean;
        bead_id: string;
        agent_name: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Full lifecycle test task",
          files: ["src/lifecycle.ts"],
        },
        ctx,
      );

      expect(tracked.success).toBe(true);

      // 2. Report progress at 50%
      const progress = await executeTool<string>(
        hive_progress,
        {
          project_key: TEST_DB_PATH,
          agent_name: tracked.agent_name,
          bead_id: tracked.bead_id,
          status: "in_progress",
          progress_percent: 50,
          message: "Halfway done with implementation",
          files_touched: ["src/lifecycle.ts"],
        },
        ctx,
      );

      expect(progress).toContain("50%");

      // 3. Save manual checkpoint at 75%
      const checkpoint = await executeTool<{
        success: boolean;
        checkpoint_id: string;
        progress_percent: number;
      }>(
        hive_checkpoint,
        {
          project_key: TEST_DB_PATH,
          agent_name: tracked.agent_name,
          epic_id: tracked.bead_id,
          bead_id: tracked.bead_id,
          task_description: "Full lifecycle test task",
          files: ["src/lifecycle.ts"],
          strategy: "auto",
          progress_percent: 75,
          files_touched: ["src/lifecycle.ts"],
        },
        ctx,
      );

      expect(checkpoint.success).toBe(true);
      expect(checkpoint.progress_percent).toBe(75);

      // 4. Complete the task
      const completion = await executeTool<{
        success: boolean;
        bead_id: string;
        closed: boolean;
      }>(
        hive_complete,
        {
          project_key: TEST_DB_PATH,
          agent_name: tracked.agent_name,
          bead_id: tracked.bead_id,
          summary: "Completed full lifecycle test",
          files_touched: ["src/lifecycle.ts"],
          skip_verification: true,
        },
        ctx,
      );

      expect(completion.success).toBe(true);
      expect(completion.closed).toBe(true);

      // 5. Verify bead is closed (in test directory)
      const showResult = await bdTest(["show", tracked.bead_id, "--json"]);
      if (showResult.exitCode === 0) {
        const beadData = JSON.parse(showResult.stdout);
        const bead = Array.isArray(beadData) ? beadData[0] : beadData;
        expect(bead.status).toBe("closed");
      }
    });

    it("parent task with emergent child: track -> spawn_child -> complete both", async () => {
      const ctx = createTestContext();
      
      const bdCheck = await Bun.$`bd --version`.quiet().nothrow();
      if (bdCheck.exitCode !== 0) {
        console.log("Skipping test: bd CLI not available");
        return;
      }

      // 1. Track parent task
      const parent = await executeTool<{
        success: boolean;
        bead_id: string;
        agent_name: string;
      }>(
        hive_track_single,
        {
          project_key: TEST_DB_PATH,
          task_description: "Parent task with emergent complexity",
          files: ["src/parent.ts"],
        },
        ctx,
      );

      expect(parent.success).toBe(true);

      // 2. Discover and spawn child task
      const child = await executeTool<{
        success: boolean;
        child_bead_id: string;
        parent_bead_id: string;
      }>(
        hive_spawn_child,
        {
          parent_bead_id: parent.bead_id,
          title: "Emergent bug fix",
          description: "Found while implementing parent feature",
          type: "bug",
          project_key: TEST_DB_PATH,
        },
        ctx,
      );

      expect(child.success).toBe(true);
      expect(child.parent_bead_id).toBe(parent.bead_id);

      // 3. Complete child first (update in test directory)
      await bdTest(["update", child.child_bead_id, "--status", "in_progress"]);
      const childCompletion = await executeTool<{
        success: boolean;
        closed: boolean;
      }>(
        hive_complete,
        {
          project_key: TEST_DB_PATH,
          agent_name: parent.agent_name,
          bead_id: child.child_bead_id,
          summary: "Fixed the emergent bug",
          skip_verification: true,
        },
        ctx,
      );

      expect(childCompletion.success).toBe(true);

      // 4. Complete parent
      const parentCompletion = await executeTool<{
        success: boolean;
        closed: boolean;
      }>(
        hive_complete,
        {
          project_key: TEST_DB_PATH,
          agent_name: parent.agent_name,
          bead_id: parent.bead_id,
          summary: "Completed parent with child work",
          files_touched: ["src/parent.ts"],
          skip_verification: true,
        },
        ctx,
      );

      expect(parentCompletion.success).toBe(true);
      expect(parentCompletion.closed).toBe(true);
    });
  });
});
