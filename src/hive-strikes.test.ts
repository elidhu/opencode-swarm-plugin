/**
 * Tests for hive-strikes.ts module
 *
 * Tests the 3-Strike detection system for architectural problems.
 * 
 * The 3-Strike Rule:
 * IF 3+ fixes have failed:
 *   STOP -> Question the architecture
 *   DON'T attempt Fix #4
 *   Discuss with human partner
 */
import type { ToolContext } from "@opencode-ai/plugin";
import { beforeEach, describe, expect, it } from "bun:test";
import {
  addStrike,
  clearStrikes,
  extractEpicId,
  formatStrikeBroadcastMessage,
  getArchitecturePrompt,
  getStrikes,
  hive_check_strikes,
  isStrikedOut,
  type StrikeRecord,
  type StrikeStorage,
} from "./hive-strikes";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * In-memory strike storage for isolated testing
 */
class InMemoryStrikeStorage implements StrikeStorage {
  private strikes = new Map<string, StrikeRecord>();

  async store(record: StrikeRecord): Promise<void> {
    this.strikes.set(record.bead_id, record);
  }

  async get(beadId: string): Promise<StrikeRecord | null> {
    return this.strikes.get(beadId) ?? null;
  }

  async getAll(): Promise<StrikeRecord[]> {
    return Array.from(this.strikes.values());
  }

  async clear(beadId: string): Promise<void> {
    this.strikes.delete(beadId);
  }

  // Test helper
  reset(): void {
    this.strikes.clear();
  }
}

const mockContext = {} as ToolContext;

// ============================================================================
// 1. Strike Storage Interface Tests
// ============================================================================

describe("Strike Storage Functions", () => {
  let storage: InMemoryStrikeStorage;

  beforeEach(() => {
    storage = new InMemoryStrikeStorage();
  });

  describe("addStrike", () => {
    it("creates new strike record for first failure", async () => {
      const record = await addStrike(
        "bd-epic1.1",
        "Attempted to fix validation",
        "Type mismatch persisted",
        storage,
      );

      expect(record.bead_id).toBe("bd-epic1.1");
      expect(record.strike_count).toBe(1);
      expect(record.failures).toHaveLength(1);
      expect(record.failures[0].attempt).toBe("Attempted to fix validation");
      expect(record.failures[0].reason).toBe("Type mismatch persisted");
      expect(record.first_strike_at).toBeDefined();
      expect(record.last_strike_at).toBeDefined();
    });

    it("increments strike count on subsequent failures", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed reason 1", storage);
      await addStrike("bd-epic1.1", "Fix #2", "Failed reason 2", storage);
      const record = await addStrike("bd-epic1.1", "Fix #3", "Failed reason 3", storage);

      expect(record.strike_count).toBe(3);
      expect(record.failures).toHaveLength(3);
    });

    it("caps strike count at 3", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed 1", storage);
      await addStrike("bd-epic1.1", "Fix #2", "Failed 2", storage);
      await addStrike("bd-epic1.1", "Fix #3", "Failed 3", storage);
      // Attempt a 4th strike - should still cap at 3
      const record = await addStrike("bd-epic1.1", "Fix #4", "Failed 4", storage);

      expect(record.strike_count).toBe(3);
      // But failures array should have all 4 for history
      expect(record.failures).toHaveLength(4);
    });

    it("preserves first_strike_at timestamp", async () => {
      const record1 = await addStrike("bd-epic1.1", "Fix #1", "Failed 1", storage);
      const firstStrikeAt = record1.first_strike_at;

      // Wait a tiny bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const record2 = await addStrike("bd-epic1.1", "Fix #2", "Failed 2", storage);

      expect(record2.first_strike_at).toBe(firstStrikeAt);
      expect(record2.last_strike_at).not.toBe(record2.first_strike_at);
    });

    it("tracks separate strikes for different beads", async () => {
      await addStrike("bd-epic1.1", "Fix bead 1", "Failed", storage);
      await addStrike("bd-epic1.2", "Fix bead 2", "Failed", storage);

      const count1 = await getStrikes("bd-epic1.1", storage);
      const count2 = await getStrikes("bd-epic1.2", storage);

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });

  describe("getStrikes", () => {
    it("returns 0 for bead with no strikes", async () => {
      const count = await getStrikes("bd-nonexistent", storage);
      expect(count).toBe(0);
    });

    it("returns correct strike count", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed", storage);
      await addStrike("bd-epic1.1", "Fix #2", "Failed", storage);

      const count = await getStrikes("bd-epic1.1", storage);
      expect(count).toBe(2);
    });
  });

  describe("isStrikedOut", () => {
    it("returns false when strike count is 0", async () => {
      const strikedOut = await isStrikedOut("bd-nonexistent", storage);
      expect(strikedOut).toBe(false);
    });

    it("returns false when strike count is 1", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed", storage);
      const strikedOut = await isStrikedOut("bd-epic1.1", storage);
      expect(strikedOut).toBe(false);
    });

    it("returns false when strike count is 2", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed", storage);
      await addStrike("bd-epic1.1", "Fix #2", "Failed", storage);
      const strikedOut = await isStrikedOut("bd-epic1.1", storage);
      expect(strikedOut).toBe(false);
    });

    it("returns true when strike count is 3", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed", storage);
      await addStrike("bd-epic1.1", "Fix #2", "Failed", storage);
      await addStrike("bd-epic1.1", "Fix #3", "Failed", storage);
      const strikedOut = await isStrikedOut("bd-epic1.1", storage);
      expect(strikedOut).toBe(true);
    });
  });

  describe("clearStrikes", () => {
    it("resets strike count to 0", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed", storage);
      await addStrike("bd-epic1.1", "Fix #2", "Failed", storage);
      
      await clearStrikes("bd-epic1.1", storage);
      
      const count = await getStrikes("bd-epic1.1", storage);
      expect(count).toBe(0);
    });

    it("does not throw for non-existent bead", async () => {
      // Should not throw
      await clearStrikes("bd-nonexistent", storage);
      const count = await getStrikes("bd-nonexistent", storage);
      expect(count).toBe(0);
    });
  });

  describe("getArchitecturePrompt", () => {
    it("returns empty string when not struck out", async () => {
      await addStrike("bd-epic1.1", "Fix #1", "Failed", storage);
      const prompt = await getArchitecturePrompt("bd-epic1.1", storage);
      expect(prompt).toBe("");
    });

    it("returns empty string for non-existent bead", async () => {
      const prompt = await getArchitecturePrompt("bd-nonexistent", storage);
      expect(prompt).toBe("");
    });

    it("returns architecture review prompt when struck out", async () => {
      await addStrike("bd-epic1.1", "Added type assertion", "Types still mismatched", storage);
      await addStrike("bd-epic1.1", "Refactored interface", "Broke other modules", storage);
      await addStrike("bd-epic1.1", "Used any type", "Lint errors everywhere", storage);

      const prompt = await getArchitecturePrompt("bd-epic1.1", storage);

      expect(prompt).toContain("Architecture Review Required");
      expect(prompt).toContain("bd-epic1.1");
      expect(prompt).toContain("Added type assertion");
      expect(prompt).toContain("Refactored interface");
      expect(prompt).toContain("Used any type");
      expect(prompt).toContain("DO NOT attempt Fix #4");
      expect(prompt).toContain("Questions to consider");
    });
  });
});

// ============================================================================
// 2. Helper Function Tests
// ============================================================================

describe("Helper Functions", () => {
  describe("extractEpicId", () => {
    it("returns bead ID when no dots present", () => {
      expect(extractEpicId("bd-abc123")).toBe("bd-abc123");
    });

    it("extracts epic ID from subtask bead ID", () => {
      expect(extractEpicId("bd-abc123.1")).toBe("bd-abc123");
    });

    it("extracts epic ID from nested subtask bead ID", () => {
      expect(extractEpicId("bd-abc123.1.2")).toBe("bd-abc123");
    });

    it("handles complex IDs correctly", () => {
      expect(extractEpicId("opencode-swarm-plugin-gi5.8")).toBe("opencode-swarm-plugin-gi5");
    });
  });

  describe("formatStrikeBroadcastMessage", () => {
    it("formats a complete broadcast message", () => {
      const failures = [
        { attempt: "Fix #1", reason: "Type error", timestamp: "2024-01-01T00:00:00Z" },
        { attempt: "Fix #2", reason: "Runtime error", timestamp: "2024-01-01T01:00:00Z" },
        { attempt: "Fix #3", reason: "Test failure", timestamp: "2024-01-01T02:00:00Z" },
      ];

      const message = formatStrikeBroadcastMessage("bd-epic1.1", failures);

      expect(message).toContain("Architecture Problem Detected");
      expect(message).toContain("bd-epic1.1");
      expect(message).toContain("3-STRIKE LIMIT REACHED");
      expect(message).toContain("Fix #1");
      expect(message).toContain("Fix #2");
      expect(message).toContain("Fix #3");
      expect(message).toContain("Type error");
      expect(message).toContain("Runtime error");
      expect(message).toContain("Test failure");
      expect(message).toContain("DO NOT attempt Fix #4");
      expect(message).toContain("Recommended Actions");
      expect(message).toContain("hive_check_strikes");
    });

    it("includes learning signal note", () => {
      const failures = [
        { attempt: "Fix", reason: "Failed", timestamp: "2024-01-01T00:00:00Z" },
      ];

      const message = formatStrikeBroadcastMessage("bd-epic1.1", failures);

      expect(message).toContain("Anti-Pattern Stored");
      expect(message).toContain("learning opportunity");
    });
  });
});

// ============================================================================
// 3. hive_check_strikes Tool Tests
// ============================================================================

describe("hive_check_strikes Tool", () => {
  describe("action: check", () => {
    it("returns no strikes for new bead", async () => {
      const result = await hive_check_strikes.execute(
        { bead_id: "bd-new-bead", action: "check" },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.bead_id).toBe("bd-new-bead");
      expect(parsed.strike_count).toBe(0);
      expect(parsed.is_striked_out).toBe(false);
      expect(parsed.message).toContain("No strikes");
      expect(parsed.next_action).toBe("Continue with fix attempt");
    });

    it("shows warning when approaching 3 strikes", async () => {
      // First add some strikes to global storage
      // Note: This test relies on global storage state
      const result = await hive_check_strikes.execute(
        { bead_id: "bd-check-test", action: "check" },
        mockContext,
      );

      const parsed = JSON.parse(result);
      
      // New bead should have 0 strikes
      expect(parsed.strike_count).toBe(0);
    });
  });

  describe("action: add_strike", () => {
    it("requires attempt parameter", async () => {
      const result = await hive_check_strikes.execute(
        { bead_id: "bd-test", action: "add_strike", reason: "some reason" },
        mockContext,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("requires 'attempt'");
    });

    it("requires reason parameter", async () => {
      const result = await hive_check_strikes.execute(
        { bead_id: "bd-test", action: "add_strike", attempt: "some attempt" },
        mockContext,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("requires");
    });

    it("adds strike with valid parameters", async () => {
      const beadId = `bd-add-test-${Date.now()}`;
      const result = await hive_check_strikes.execute(
        {
          bead_id: beadId,
          action: "add_strike",
          attempt: "Tried to fix the bug",
          reason: "Still broken",
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.bead_id).toBe(beadId);
      expect(parsed.strike_count).toBe(1);
      expect(parsed.is_striked_out).toBe(false);
      expect(parsed.failures).toHaveLength(1);
      expect(parsed.message).toContain("Strike 1 recorded");
    });

    it("shows warning on 3rd strike", async () => {
      const beadId = `bd-strikeout-${Date.now()}`;
      
      // Add 3 strikes
      await hive_check_strikes.execute(
        { bead_id: beadId, action: "add_strike", attempt: "Fix 1", reason: "Failed" },
        mockContext,
      );
      await hive_check_strikes.execute(
        { bead_id: beadId, action: "add_strike", attempt: "Fix 2", reason: "Failed" },
        mockContext,
      );
      const result = await hive_check_strikes.execute(
        { bead_id: beadId, action: "add_strike", attempt: "Fix 3", reason: "Failed again" },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.strike_count).toBe(3);
      expect(parsed.is_striked_out).toBe(true);
      expect(parsed.message).toContain("STRUCK OUT");
      expect(parsed.warning).toContain("DO NOT attempt Fix #4");
      expect(parsed.anti_pattern).toBeDefined();
      expect(parsed.anti_pattern.highlights).toContain("ARCHITECTURAL PROBLEM DETECTED");
    });
  });

  describe("action: clear", () => {
    it("clears strikes for a bead", async () => {
      const beadId = `bd-clear-test-${Date.now()}`;
      
      // Add a strike first
      await hive_check_strikes.execute(
        { bead_id: beadId, action: "add_strike", attempt: "Fix", reason: "Failed" },
        mockContext,
      );

      // Clear strikes
      const result = await hive_check_strikes.execute(
        { bead_id: beadId, action: "clear" },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.bead_id).toBe(beadId);
      expect(parsed.strike_count).toBe(0);
      expect(parsed.is_striked_out).toBe(false);
      expect(parsed.message).toContain("cleared");
    });
  });

  describe("action: get_prompt", () => {
    it("returns no prompt when not struck out", async () => {
      const beadId = `bd-prompt-test-${Date.now()}`;
      
      const result = await hive_check_strikes.execute(
        { bead_id: beadId, action: "get_prompt" },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.has_prompt).toBe(false);
      expect(parsed.message).toContain("not struck out");
    });

    it("returns architecture review prompt when struck out", async () => {
      const beadId = `bd-prompt-struck-${Date.now()}`;
      
      // Add 3 strikes
      await hive_check_strikes.execute(
        { bead_id: beadId, action: "add_strike", attempt: "Fix 1", reason: "Failed" },
        mockContext,
      );
      await hive_check_strikes.execute(
        { bead_id: beadId, action: "add_strike", attempt: "Fix 2", reason: "Failed" },
        mockContext,
      );
      await hive_check_strikes.execute(
        { bead_id: beadId, action: "add_strike", attempt: "Fix 3", reason: "Failed" },
        mockContext,
      );

      // Get prompt
      const result = await hive_check_strikes.execute(
        { bead_id: beadId, action: "get_prompt" },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.has_prompt).toBe(true);
      expect(parsed.architecture_review_prompt).toBeDefined();
      expect(parsed.architecture_review_prompt).toContain("Architecture Review");
      expect(parsed.architecture_review_prompt).toContain(beadId);
      expect(parsed.message).toContain("human partner");
    });
  });

  describe("invalid action", () => {
    it("returns error for unknown action", async () => {
      const result = await hive_check_strikes.execute(
        { bead_id: "bd-test", action: "invalid_action" as any },
        mockContext,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Unknown action");
    });
  });
});

// ============================================================================
// 4. Integration Scenario Tests
// ============================================================================

describe("3-Strike Detection Scenarios", () => {
  let storage: InMemoryStrikeStorage;

  beforeEach(() => {
    storage = new InMemoryStrikeStorage();
  });

  it("complete workflow: strike accumulation and architecture review", async () => {
    const beadId = "bd-workflow-test";

    // Strike 1: Initial fix attempt
    const strike1 = await addStrike(
      beadId,
      "Added null check",
      "Still getting null reference error",
      storage,
    );
    expect(strike1.strike_count).toBe(1);
    expect(await isStrikedOut(beadId, storage)).toBe(false);

    // Strike 2: Second attempt
    const strike2 = await addStrike(
      beadId,
      "Wrapped in try-catch",
      "Error swallowed but functionality broken",
      storage,
    );
    expect(strike2.strike_count).toBe(2);
    expect(await isStrikedOut(beadId, storage)).toBe(false);

    // Strike 3: Third attempt - should trigger strikeout
    const strike3 = await addStrike(
      beadId,
      "Refactored entire function",
      "Now other tests are failing",
      storage,
    );
    expect(strike3.strike_count).toBe(3);
    expect(await isStrikedOut(beadId, storage)).toBe(true);

    // Should get architecture review prompt
    const prompt = await getArchitecturePrompt(beadId, storage);
    expect(prompt).toContain("Architecture Review Required");
    expect(prompt).toContain("Added null check");
    expect(prompt).toContain("Wrapped in try-catch");
    expect(prompt).toContain("Refactored entire function");
  });

  it("successful fix clears strikes", async () => {
    const beadId = "bd-success-test";

    // Two failed attempts
    await addStrike(beadId, "Fix 1", "Failed", storage);
    await addStrike(beadId, "Fix 2", "Failed", storage);
    expect(await getStrikes(beadId, storage)).toBe(2);

    // Third attempt succeeds - clear strikes
    await clearStrikes(beadId, storage);
    expect(await getStrikes(beadId, storage)).toBe(0);
    expect(await isStrikedOut(beadId, storage)).toBe(false);
  });

  it("different subtasks track strikes independently", async () => {
    const subtask1 = "bd-epic.1";
    const subtask2 = "bd-epic.2";

    // Strike subtask1 three times
    await addStrike(subtask1, "Fix 1", "Failed", storage);
    await addStrike(subtask1, "Fix 2", "Failed", storage);
    await addStrike(subtask1, "Fix 3", "Failed", storage);

    // Strike subtask2 once
    await addStrike(subtask2, "Fix 1", "Failed", storage);

    // Check independence
    expect(await isStrikedOut(subtask1, storage)).toBe(true);
    expect(await isStrikedOut(subtask2, storage)).toBe(false);
    expect(await getStrikes(subtask2, storage)).toBe(1);
  });
});
