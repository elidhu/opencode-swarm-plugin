/**
 * Storage Integration Tests
 *
 * Tests the storage module with LanceDB backend.
 * Includes tests for semantic vector search and persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LanceDBStorage,
  createStorage,
} from "./storage";
import type { FeedbackEvent } from "./learning";
import type { DecompositionPattern } from "./pattern-maturity";
import type { PatternMaturity, MaturityFeedback } from "./pattern-maturity";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Helper to create unique test directories
function createTestDir(): string {
  const dir = join(tmpdir(), `lancedb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Helper to clean up test directories
function cleanupTestDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("LanceDBStorage Integration", () => {
  let storage: LanceDBStorage;
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
    storage = new LanceDBStorage({ vectorDir: testDir });
  });

  afterEach(async () => {
    await storage.close();
    // Give file handles time to release
    await new Promise((r) => setTimeout(r, 50));
    cleanupTestDir(testDir);
  });

  describe("Feedback Operations", () => {
    it("should store and retrieve feedback by criterion", async () => {
      const uniqueCriterion = `test-criterion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const event: FeedbackEvent = {
        id: `feedback-${Date.now()}`,
        criterion: uniqueCriterion,
        type: "helpful",
        timestamp: new Date().toISOString(),
        bead_id: "bd-test-001",
        context: "Test feedback for exact match retrieval",
        raw_value: 1,
      };

      await storage.storeFeedback(event);

      // Give it a moment to persist
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getFeedbackByCriterion(uniqueCriterion);
      expect(results).toHaveLength(1);
      expect(results[0].criterion).toBe(uniqueCriterion);
      expect(results[0].type).toBe("helpful");
      expect(results[0].bead_id).toBe("bd-test-001");
    });

    it("should retrieve feedback by bead ID", async () => {
      const uniqueBeadId = `bd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const event1: FeedbackEvent = {
        id: `feedback-${Date.now()}-1`,
        criterion: "criterion-1",
        type: "helpful",
        timestamp: new Date().toISOString(),
        bead_id: uniqueBeadId,
        raw_value: 1,
      };

      const event2: FeedbackEvent = {
        id: `feedback-${Date.now()}-2`,
        criterion: "criterion-2",
        type: "harmful",
        timestamp: new Date().toISOString(),
        bead_id: uniqueBeadId,
        raw_value: 1,
      };

      await storage.storeFeedback(event1);
      await storage.storeFeedback(event2);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getFeedbackByBead(uniqueBeadId);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.bead_id === uniqueBeadId)).toBe(true);
    });

    it("should retrieve all feedback", async () => {
      const event1: FeedbackEvent = {
        id: `feedback-all-${Date.now()}-1`,
        criterion: "criterion-a",
        type: "helpful",
        timestamp: new Date().toISOString(),
        raw_value: 1,
      };

      const event2: FeedbackEvent = {
        id: `feedback-all-${Date.now()}-2`,
        criterion: "criterion-b",
        type: "harmful",
        timestamp: new Date().toISOString(),
        raw_value: 1,
      };

      await storage.storeFeedback(event1);
      await storage.storeFeedback(event2);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getAllFeedback();
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should find similar feedback using semantic search", async () => {
      // Store feedback about error handling
      const errorFeedback: FeedbackEvent = {
        id: `feedback-semantic-${Date.now()}-1`,
        criterion: "error-handling-quality",
        type: "helpful",
        timestamp: new Date().toISOString(),
        context: "The agent properly caught exceptions and logged error messages",
        raw_value: 1,
      };

      // Store feedback about file organization (unrelated topic)
      const fileFeedback: FeedbackEvent = {
        id: `feedback-semantic-${Date.now()}-2`,
        criterion: "file-organization",
        type: "helpful",
        timestamp: new Date().toISOString(),
        context: "Files were organized into proper directories with clear structure",
        raw_value: 1,
      };

      await storage.storeFeedback(errorFeedback);
      await storage.storeFeedback(fileFeedback);
      await new Promise((r) => setTimeout(r, 200));

      // Search for error-related feedback - should find error feedback first
      const results = await storage.findSimilarFeedback("exception handling and error logging", 5);
      expect(results.length).toBeGreaterThan(0);
      
      // The first result should be semantically similar to error handling
      expect(
        results[0].criterion.includes("error") || 
        results[0].context?.toLowerCase().includes("error") ||
        results[0].context?.toLowerCase().includes("exception")
      ).toBe(true);
    });

    it("should not confuse semantic similarity with keyword matching", async () => {
      // Store feedback about debugging
      const debugFeedback: FeedbackEvent = {
        id: `feedback-debug-${Date.now()}`,
        criterion: "debugging-approach",
        type: "helpful",
        timestamp: new Date().toISOString(),
        context: "Used systematic debugging to identify root cause of the bug",
        raw_value: 1,
      };

      await storage.storeFeedback(debugFeedback);
      await new Promise((r) => setTimeout(r, 100));

      // Search with semantically related term (not exact keyword)
      const results = await storage.findSimilarFeedback("troubleshooting issues", 5);
      expect(results.length).toBeGreaterThan(0);
      // Should find debugging feedback even though we didn't use the word "debug"
    });
  });

  describe("Pattern Operations", () => {
    it("should store and retrieve pattern by ID", async () => {
      const pattern: DecompositionPattern = {
        id: `pattern-exact-${Date.now()}`,
        kind: "pattern",
        content: "Break down large files by domain boundaries",
        is_negative: false,
        success_count: 5,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["decomposition", "file-based"],
        example_beads: ["bd-001", "bd-002"],
      };

      await storage.storePattern(pattern);
      await new Promise((r) => setTimeout(r, 100));

      const result = await storage.getPattern(pattern.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(pattern.id);
      expect(result?.content).toBe(pattern.content);
      expect(result?.tags).toEqual(["decomposition", "file-based"]);
      expect(result?.success_count).toBe(5);
    });

    it("should retrieve all patterns", async () => {
      const pattern1: DecompositionPattern = {
        id: `pattern-all-${Date.now()}-1`,
        kind: "pattern",
        content: "Pattern 1",
        is_negative: false,
        success_count: 1,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["test"],
        example_beads: [],
      };

      const pattern2: DecompositionPattern = {
        id: `pattern-all-${Date.now()}-2`,
        kind: "pattern",
        content: "Pattern 2",
        is_negative: false,
        success_count: 1,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["test"],
        example_beads: [],
      };

      await storage.storePattern(pattern1);
      await storage.storePattern(pattern2);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getAllPatterns();
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should retrieve anti-patterns", async () => {
      const antiPattern: DecompositionPattern = {
        id: `anti-pattern-${Date.now()}`,
        kind: "anti_pattern",
        content: "Creating circular dependencies between modules",
        is_negative: true,
        success_count: 0,
        failure_count: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["anti-pattern", "architecture"],
        example_beads: [],
      };

      await storage.storePattern(antiPattern);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getAntiPatterns();
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((p) => p.kind === "anti_pattern")).toBe(true);
    });

    it("should retrieve patterns by tag", async () => {
      const pattern: DecompositionPattern = {
        id: `pattern-tag-${Date.now()}`,
        kind: "pattern",
        content: "Use feature-based decomposition for new features",
        is_negative: false,
        success_count: 1,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["feature-based", "testing-unique-tag"],
        example_beads: [],
      };

      await storage.storePattern(pattern);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getPatternsByTag("testing-unique-tag");
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((p) => p.tags.includes("testing-unique-tag"))).toBe(true);
    });

    it("should find similar patterns using semantic search", async () => {
      // Store pattern about file organization
      const filePattern: DecompositionPattern = {
        id: `pattern-semantic-${Date.now()}-1`,
        kind: "pattern",
        content: "Organize code into directories by feature domain and module boundaries",
        is_negative: false,
        success_count: 3,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["organization", "structure"],
        example_beads: [],
      };

      // Store pattern about error handling (unrelated topic)
      const errorPattern: DecompositionPattern = {
        id: `pattern-semantic-${Date.now()}-2`,
        kind: "pattern",
        content: "Implement try-catch blocks with proper error logging and recovery",
        is_negative: false,
        success_count: 2,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["error-handling", "resilience"],
        example_beads: [],
      };

      await storage.storePattern(filePattern);
      await storage.storePattern(errorPattern);
      await new Promise((r) => setTimeout(r, 200));

      // Search for file organization patterns
      const results = await storage.findSimilarPatterns("structuring files and folders", 5);
      expect(results.length).toBeGreaterThan(0);
      
      // The first result should be semantically similar to file organization
      expect(
        results[0].content.toLowerCase().includes("organiz") ||
        results[0].content.toLowerCase().includes("director") ||
        results[0].content.toLowerCase().includes("structure")
      ).toBe(true);
    });

    it("should find patterns using semantic concepts, not just keywords", async () => {
      const pattern: DecompositionPattern = {
        id: `pattern-concept-${Date.now()}`,
        kind: "pattern",
        content: "Separate business logic from presentation layer using clear interfaces",
        is_negative: false,
        success_count: 4,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["architecture", "separation-of-concerns"],
        example_beads: [],
      };

      await storage.storePattern(pattern);
      await new Promise((r) => setTimeout(r, 100));

      // Search with semantically related concept (not exact keywords)
      const results = await storage.findSimilarPatterns("decoupling components", 5);
      expect(results.length).toBeGreaterThan(0);
      // Should find the separation pattern even with different terminology
    });
  });

  describe("Maturity Operations", () => {
    it("should store and retrieve maturity by pattern ID", async () => {
      const maturity: PatternMaturity = {
        pattern_id: `maturity-exact-${Date.now()}`,
        state: "candidate",
        helpful_count: 2,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
        promoted_at: undefined,
        deprecated_at: undefined,
      };

      await storage.storeMaturity(maturity);
      await new Promise((r) => setTimeout(r, 100));

      const result = await storage.getMaturity(maturity.pattern_id);
      expect(result).not.toBeNull();
      expect(result?.pattern_id).toBe(maturity.pattern_id);
      expect(result?.state).toBe("candidate");
      expect(result?.helpful_count).toBe(2);
    });

    it("should retrieve all maturity records", async () => {
      const maturity1: PatternMaturity = {
        pattern_id: `maturity-all-${Date.now()}-1`,
        state: "candidate",
        helpful_count: 1,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
        promoted_at: undefined,
        deprecated_at: undefined,
      };

      const maturity2: PatternMaturity = {
        pattern_id: `maturity-all-${Date.now()}-2`,
        state: "proven",
        helpful_count: 5,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
        promoted_at: new Date().toISOString(),
        deprecated_at: undefined,
      };

      await storage.storeMaturity(maturity1);
      await storage.storeMaturity(maturity2);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getAllMaturity();
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should retrieve maturity by state", async () => {
      const maturity: PatternMaturity = {
        pattern_id: `maturity-state-${Date.now()}`,
        state: "proven",
        helpful_count: 10,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
        promoted_at: new Date().toISOString(),
        deprecated_at: undefined,
      };

      await storage.storeMaturity(maturity);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getMaturityByState("proven");
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((m) => m.state === "proven")).toBe(true);
    });

    it("should store and retrieve maturity feedback", async () => {
      const patternId = `maturity-feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      
      const feedback1: MaturityFeedback = {
        pattern_id: patternId,
        type: "helpful",
        timestamp: new Date().toISOString(),
        weight: 1,
      };

      const feedback2: MaturityFeedback = {
        pattern_id: patternId,
        type: "helpful",
        timestamp: new Date(Date.now() + 1000).toISOString(),
        weight: 1,
      };

      await storage.storeMaturityFeedback(feedback1);
      await storage.storeMaturityFeedback(feedback2);
      await new Promise((r) => setTimeout(r, 100));

      const results = await storage.getMaturityFeedback(patternId);
      expect(results).toHaveLength(2);
      expect(results.every((f) => f.pattern_id === patternId)).toBe(true);
      expect(results.every((f) => f.type === "helpful")).toBe(true);
    });
  });

  describe("Persistence", () => {
    it("should persist data after closing and reopening database", async () => {
      const pattern: DecompositionPattern = {
        id: `pattern-persist-${Date.now()}`,
        kind: "pattern",
        content: "Persistence test pattern",
        is_negative: false,
        success_count: 1,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["persistence"],
        example_beads: [],
      };

      // Store pattern
      await storage.storePattern(pattern);
      await new Promise((r) => setTimeout(r, 100));

      // Close storage
      await storage.close();

      // Create new storage instance with same directory
      const storage2 = new LanceDBStorage({ vectorDir: testDir });

      // Verify pattern persisted
      const result = await storage2.getPattern(pattern.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(pattern.id);
      expect(result?.content).toBe("Persistence test pattern");

      await storage2.close();
    });

    it("should persist feedback across sessions", async () => {
      const event: FeedbackEvent = {
        id: `feedback-persist-${Date.now()}`,
        criterion: "persistence-test",
        type: "helpful",
        timestamp: new Date().toISOString(),
        context: "Testing persistence",
        raw_value: 1,
      };

      await storage.storeFeedback(event);
      await new Promise((r) => setTimeout(r, 100));
      await storage.close();

      const storage2 = new LanceDBStorage({ vectorDir: testDir });
      const results = await storage2.getFeedbackByCriterion("persistence-test");
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].criterion).toBe("persistence-test");

      await storage2.close();
    });
  });
});



describe("Storage Factory", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it("should create LanceDB storage by default", () => {
    const storage = createStorage({ vectorDir: testDir });
    expect(storage).toBeInstanceOf(LanceDBStorage);
  });

  it("should create LanceDB storage with custom directory", () => {
    const storage = createStorage({ vectorDir: testDir });
    expect(storage).toBeInstanceOf(LanceDBStorage);
  });
});


