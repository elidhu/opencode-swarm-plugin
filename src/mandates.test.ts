/**
 * Tests for mandates.ts - Tool implementations and mandate logic
 *
 * Tests the tool implementations in mandates.ts including:
 * - mandate_file: Create new mandate entries
 * - mandate_vote: Cast votes on mandates
 * - mandate_query: Semantic search for mandates
 * - mandate_list: List mandates with filters
 * - mandate_stats: Get voting statistics
 *
 * Uses MockMandateStorage for fast, isolated unit tests.
 * Uses setMandateStorage() to inject mock storage into tools.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  mandate_file,
  mandate_vote,
  mandate_query,
  mandate_list,
  mandate_stats,
  MandateError,
  mandateTools,
} from "./mandates";
import {
  setMandateStorage,
  resetMandateStorage,
  type MandateStorage,
} from "./mandate-storage";
import type {
  MandateEntry,
  Vote,
  MandateScore,
  MandateStatus,
  MandateContentType,
} from "./schemas/mandate";
import { DEFAULT_MANDATE_DECAY_CONFIG } from "./schemas/mandate";
import { calculateDecayedValue } from "./learning";

// ============================================================================
// Mock Context for Tool Execution
// ============================================================================

/**
 * Mock tool context for execute functions
 * The real context is provided by OpenCode runtime
 */
const mockCtx = {
  sessionID: "test-session-" + Date.now(),
  messageID: "test-message-" + Date.now(),
  agent: "test-agent",
  abort: new AbortController().signal,
} as ToolContext;

// ============================================================================
// Mock Storage Implementation
// ============================================================================

/**
 * Mock mandate storage for unit testing
 *
 * Implements MandateStorage interface with in-memory data structures.
 * This enables fast, isolated tests without database dependencies.
 */
class MockMandateStorage implements MandateStorage {
  private entries: Map<string, MandateEntry> = new Map();
  private votes: Map<string, Vote> = new Map();

  async store(entry: MandateEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async get(id: string): Promise<MandateEntry | null> {
    return this.entries.get(id) || null;
  }

  async find(query: string, limit: number = 10): Promise<MandateEntry[]> {
    const lowerQuery = query.toLowerCase();
    const results = Array.from(this.entries.values()).filter(
      (entry) =>
        entry.content.toLowerCase().includes(lowerQuery) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
    );
    return results.slice(0, limit);
  }

  async list(filter?: {
    status?: MandateStatus;
    content_type?: MandateContentType;
  }): Promise<MandateEntry[]> {
    let results = Array.from(this.entries.values());

    if (filter) {
      results = results.filter((entry) => {
        if (filter.status && entry.status !== filter.status) return false;
        if (filter.content_type && entry.content_type !== filter.content_type)
          return false;
        return true;
      });
    }

    return results;
  }

  async update(id: string, updates: Partial<MandateEntry>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(
        `Mandate '${id}' not found. Use list() to see available mandates.`,
      );
    }

    const updated = { ...existing, ...updates };
    this.entries.set(id, updated);
  }

  async vote(vote: Vote): Promise<void> {
    const existing = await this.hasVoted(vote.mandate_id, vote.agent_name);
    if (existing) {
      throw new Error(
        `Agent '${vote.agent_name}' has already voted on mandate '${vote.mandate_id}'. Each agent can vote once per mandate to ensure fair consensus.`,
      );
    }

    this.votes.set(vote.id, vote);
  }

  async getVotes(mandateId: string): Promise<Vote[]> {
    return Array.from(this.votes.values()).filter(
      (vote) => vote.mandate_id === mandateId,
    );
  }

  async hasVoted(mandateId: string, agentName: string): Promise<boolean> {
    const votes = await this.getVotes(mandateId);
    return votes.some((vote) => vote.agent_name === agentName);
  }

  async calculateScore(mandateId: string): Promise<MandateScore> {
    const votes = await this.getVotes(mandateId);
    const now = new Date();

    let rawUpvotes = 0;
    let rawDownvotes = 0;
    let decayedUpvotes = 0;
    let decayedDownvotes = 0;

    for (const vote of votes) {
      const decayed = calculateDecayedValue(
        vote.timestamp,
        now,
        DEFAULT_MANDATE_DECAY_CONFIG.halfLifeDays,
      );
      const value = vote.weight * decayed;

      if (vote.vote_type === "upvote") {
        rawUpvotes++;
        decayedUpvotes += value;
      } else {
        rawDownvotes++;
        decayedDownvotes += value;
      }
    }

    const totalDecayed = decayedUpvotes + decayedDownvotes;
    const voteRatio = totalDecayed > 0 ? decayedUpvotes / totalDecayed : 0;
    const netVotes = decayedUpvotes - decayedDownvotes;

    const decayedScore = netVotes * voteRatio;

    return {
      mandate_id: mandateId,
      net_votes: netVotes,
      vote_ratio: voteRatio,
      decayed_score: decayedScore,
      last_calculated: now.toISOString(),
      raw_upvotes: rawUpvotes,
      raw_downvotes: rawDownvotes,
      decayed_upvotes: decayedUpvotes,
      decayed_downvotes: decayedDownvotes,
    };
  }

  async close(): Promise<void> {
    // No cleanup needed
  }

  // Helper methods for tests
  clear(): void {
    this.entries.clear();
    this.votes.clear();
  }

  getEntryCount(): number {
    return this.entries.size;
  }

  getVoteCount(): number {
    return this.votes.size;
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

let mockStorage: MockMandateStorage;

function createMockEntry(
  id: string,
  overrides: Partial<MandateEntry> = {},
): MandateEntry {
  return {
    id,
    content: `Test mandate content for ${id}`,
    content_type: "tip",
    author_agent: "TestAgent",
    created_at: new Date().toISOString(),
    status: "candidate",
    tags: [],
    ...overrides,
  };
}

function parseToolResult<T>(result: string): T {
  return JSON.parse(result) as T;
}

// ============================================================================
// Tests
// ============================================================================

describe("mandates.ts", () => {
  beforeEach(() => {
    // Create fresh mock storage for each test
    mockStorage = new MockMandateStorage();
    // Inject mock storage into the mandate module
    setMandateStorage(mockStorage);
  });

  afterEach(async () => {
    // Reset storage after each test
    await resetMandateStorage();
  });

  afterAll(async () => {
    // Clean up
    await resetMandateStorage();
  });

  // ==========================================================================
  // MandateError Tests
  // ==========================================================================

  describe("MandateError", () => {
    it("should create error with operation name", () => {
      const error = new MandateError("Test message", "test_operation");
      expect(error.message).toBe("Test message");
      expect(error.operation).toBe("test_operation");
      expect(error.name).toBe("MandateError");
    });

    it("should create error with details", () => {
      const details = { foo: "bar" };
      const error = new MandateError("Test message", "test_op", details);
      expect(error.details).toEqual(details);
    });
  });

  // ==========================================================================
  // mandate_file Tests
  // ==========================================================================

  describe("mandate_file", () => {
    it("should create a new mandate entry", async () => {
      const result = await mandate_file.execute(
        {
          content: "Use semantic memory for persistence",
          content_type: "tip",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ success: boolean; mandate: MandateEntry }>(result);

      expect(parsed.success).toBe(true);
      expect(parsed.mandate.content).toBe("Use semantic memory for persistence");
      expect(parsed.mandate.content_type).toBe("tip");
      expect(parsed.mandate.status).toBe("candidate");
      expect(parsed.mandate.id).toMatch(/^mandate-/);
    });

    it("should create mandate with tags", async () => {
      const result = await mandate_file.execute(
        {
          content: "Use Effect for async operations",
          content_type: "tip",
          tags: ["async", "effect", "typescript"],
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ mandate: MandateEntry }>(result);

      expect(parsed.mandate.tags).toEqual(["async", "effect", "typescript"]);
    });

    it("should create mandate with metadata", async () => {
      const result = await mandate_file.execute(
        {
          content: "const foo = 'bar';",
          content_type: "snippet",
          metadata: { language: "typescript", version: "5.0" },
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ mandate: MandateEntry }>(result);

      expect(parsed.mandate.metadata).toEqual({ language: "typescript", version: "5.0" });
    });

    it("should create mandate with source tracking", async () => {
      const result = await mandate_file.execute(
        {
          content: "Always validate input",
          content_type: "tip",
          source: "directive",
          source_ref: "bead-123",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ mandate: MandateEntry }>(result);

      expect(parsed.mandate.source).toBe("directive");
      expect(parsed.mandate.source_ref).toBe("bead-123");
    });

    it("should support all content types", async () => {
      const contentTypes = ["idea", "tip", "lore", "snippet", "feature_request"] as const;

      for (const contentType of contentTypes) {
        const result = await mandate_file.execute(
          {
            content: `Test ${contentType}`,
            content_type: contentType,
          },
          mockCtx,
        );

        const parsed = parseToolResult<{ mandate: MandateEntry }>(result);
        expect(parsed.mandate.content_type).toBe(contentType);
      }
    });

    it("should reject empty content", async () => {
      await expect(
        mandate_file.execute(
          {
            content: "",
            content_type: "tip",
          },
          mockCtx,
        ),
      ).rejects.toThrow();
    });

    it("should store mandate in storage", async () => {
      await mandate_file.execute(
        {
          content: "Test mandate",
          content_type: "tip",
        },
        mockCtx,
      );

      expect(mockStorage.getEntryCount()).toBe(1);
    });

    it("should generate unique IDs", async () => {
      const result1 = await mandate_file.execute(
        {
          content: "First mandate",
          content_type: "tip",
        },
        mockCtx,
      );

      const result2 = await mandate_file.execute(
        {
          content: "Second mandate",
          content_type: "tip",
        },
        mockCtx,
      );

      const parsed1 = parseToolResult<{ mandate: MandateEntry }>(result1);
      const parsed2 = parseToolResult<{ mandate: MandateEntry }>(result2);

      expect(parsed1.mandate.id).not.toBe(parsed2.mandate.id);
    });
  });

  // ==========================================================================
  // mandate_vote Tests
  // ==========================================================================

  describe("mandate_vote", () => {
    beforeEach(async () => {
      // Create a mandate to vote on
      const entry = createMockEntry("mandate-test-1");
      await mockStorage.store(entry);
    });

    it("should cast upvote on existing mandate", async () => {
      const result = await mandate_vote.execute(
        {
          mandate_id: "mandate-test-1",
          vote_type: "upvote",
          agent_name: "VotingAgent",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ success: boolean; vote: Vote }>(result);

      expect(parsed.success).toBe(true);
      expect(parsed.vote.vote_type).toBe("upvote");
      expect(parsed.vote.agent_name).toBe("VotingAgent");
      expect(parsed.vote.mandate_id).toBe("mandate-test-1");
    });

    it("should cast downvote on existing mandate", async () => {
      const result = await mandate_vote.execute(
        {
          mandate_id: "mandate-test-1",
          vote_type: "downvote",
          agent_name: "VotingAgent",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ vote: Vote }>(result);

      expect(parsed.vote.vote_type).toBe("downvote");
    });

    it("should throw error for non-existent mandate", async () => {
      await expect(
        mandate_vote.execute(
          {
            mandate_id: "non-existent-mandate",
            vote_type: "upvote",
            agent_name: "VotingAgent",
          },
          mockCtx,
        ),
      ).rejects.toThrow(MandateError);

      await expect(
        mandate_vote.execute(
          {
            mandate_id: "non-existent-mandate",
            vote_type: "upvote",
            agent_name: "VotingAgent",
          },
          mockCtx,
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should throw error for duplicate votes", async () => {
      // First vote should succeed
      await mandate_vote.execute(
        {
          mandate_id: "mandate-test-1",
          vote_type: "upvote",
          agent_name: "VotingAgent",
        },
        mockCtx,
      );

      // Second vote from same agent should fail
      await expect(
        mandate_vote.execute(
          {
            mandate_id: "mandate-test-1",
            vote_type: "downvote",
            agent_name: "VotingAgent",
          },
          mockCtx,
        ),
      ).rejects.toThrow(MandateError);

      await expect(
        mandate_vote.execute(
          {
            mandate_id: "mandate-test-1",
            vote_type: "downvote",
            agent_name: "VotingAgent",
          },
          mockCtx,
        ),
      ).rejects.toThrow(/already voted/);
    });

    it("should allow different agents to vote on same mandate", async () => {
      await mandate_vote.execute(
        {
          mandate_id: "mandate-test-1",
          vote_type: "upvote",
          agent_name: "Agent1",
        },
        mockCtx,
      );

      const result = await mandate_vote.execute(
        {
          mandate_id: "mandate-test-1",
          vote_type: "upvote",
          agent_name: "Agent2",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ success: boolean }>(result);
      expect(parsed.success).toBe(true);
    });

    it("should return promotion information", async () => {
      // Add multiple upvotes to potentially trigger status change
      const agents = ["Agent1", "Agent2", "Agent3"];
      let lastResult: string = "";

      for (const agent of agents) {
        lastResult = await mandate_vote.execute(
          {
            mandate_id: "mandate-test-1",
            vote_type: "upvote",
            agent_name: agent,
          },
          mockCtx,
        );
      }

      const parsed = parseToolResult<{
        promotion: {
          previous_status: string;
          new_status: string;
          status_changed: boolean;
          score: MandateScore;
        };
      }>(lastResult);

      expect(parsed.promotion).toBeDefined();
      expect(parsed.promotion.score).toBeDefined();
      expect(typeof parsed.promotion.status_changed).toBe("boolean");
    });

    it("should generate unique vote IDs", async () => {
      const result1 = await mandate_vote.execute(
        {
          mandate_id: "mandate-test-1",
          vote_type: "upvote",
          agent_name: "Agent1",
        },
        mockCtx,
      );

      const result2 = await mandate_vote.execute(
        {
          mandate_id: "mandate-test-1",
          vote_type: "upvote",
          agent_name: "Agent2",
        },
        mockCtx,
      );

      const parsed1 = parseToolResult<{ vote: Vote }>(result1);
      const parsed2 = parseToolResult<{ vote: Vote }>(result2);

      expect(parsed1.vote.id).not.toBe(parsed2.vote.id);
      expect(parsed1.vote.id).toMatch(/^vote-/);
    });
  });

  // ==========================================================================
  // mandate_query Tests
  // ==========================================================================

  describe("mandate_query", () => {
    beforeEach(async () => {
      // Create several mandates for query tests
      await mockStorage.store(
        createMockEntry("m1", {
          content: "Use Effect for async operations",
          content_type: "tip",
          status: "candidate",
          tags: ["async", "effect"],
        }),
      );
      await mockStorage.store(
        createMockEntry("m2", {
          content: "Prefer semantic memory for persistence",
          content_type: "tip",
          status: "mandate",
          tags: ["storage"],
        }),
      );
      await mockStorage.store(
        createMockEntry("m3", {
          content: "Add support for webhooks",
          content_type: "feature_request",
          status: "candidate",
          tags: ["api"],
        }),
      );
    });

    it("should query mandates by content", async () => {
      const result = await mandate_query.execute(
        {
          query: "Effect",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ count: number; results: unknown[] }>(result);

      expect(parsed.count).toBe(1);
      expect(parsed.results).toHaveLength(1);
    });

    it("should query mandates by tags", async () => {
      const result = await mandate_query.execute(
        {
          query: "async",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ count: number }>(result);
      expect(parsed.count).toBeGreaterThanOrEqual(1);
    });

    it("should filter by status", async () => {
      const result = await mandate_query.execute(
        {
          query: "semantic",
          status: "mandate",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        count: number;
        results: Array<{ status: string }>;
      }>(result);

      expect(parsed.count).toBe(1);
      expect(parsed.results[0].status).toBe("mandate");
    });

    it("should filter by content_type", async () => {
      const result = await mandate_query.execute(
        {
          query: "support",
          content_type: "feature_request",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        count: number;
        results: Array<{ content_type: string }>;
      }>(result);

      expect(parsed.count).toBe(1);
      expect(parsed.results[0].content_type).toBe("feature_request");
    });

    it("should respect limit parameter", async () => {
      const result = await mandate_query.execute(
        {
          query: "",
          limit: 1,
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ results: unknown[] }>(result);
      expect(parsed.results.length).toBeLessThanOrEqual(1);
    });

    it("should return score information", async () => {
      const result = await mandate_query.execute(
        {
          query: "Effect",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        results: Array<{
          score: {
            net_votes: number;
            vote_ratio: number;
            decayed_score: number;
          };
        }>;
      }>(result);

      expect(parsed.results[0].score).toBeDefined();
      expect(typeof parsed.results[0].score.net_votes).toBe("number");
    });

    it("should handle empty results gracefully", async () => {
      const result = await mandate_query.execute(
        {
          query: "nonexistent-query-xyz",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ count: number; results: unknown[] }>(result);
      expect(parsed.count).toBe(0);
      expect(parsed.results).toHaveLength(0);
    });
  });

  // ==========================================================================
  // mandate_list Tests
  // ==========================================================================

  describe("mandate_list", () => {
    beforeEach(async () => {
      await mockStorage.store(
        createMockEntry("m1", { content_type: "tip", status: "candidate" }),
      );
      await mockStorage.store(
        createMockEntry("m2", { content_type: "idea", status: "mandate" }),
      );
      await mockStorage.store(
        createMockEntry("m3", { content_type: "tip", status: "mandate" }),
      );
      await mockStorage.store(
        createMockEntry("m4", { content_type: "snippet", status: "rejected" }),
      );
    });

    it("should list all mandates without filters", async () => {
      const result = await mandate_list.execute({}, mockCtx);

      const parsed = parseToolResult<{ count: number }>(result);
      expect(parsed.count).toBe(4);
    });

    it("should filter by status", async () => {
      const result = await mandate_list.execute(
        {
          status: "mandate",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        count: number;
        results: Array<{ status: string }>;
      }>(result);

      expect(parsed.count).toBe(2);
      parsed.results.forEach((r) => {
        expect(r.status).toBe("mandate");
      });
    });

    it("should filter by content_type", async () => {
      const result = await mandate_list.execute(
        {
          content_type: "tip",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        count: number;
        results: Array<{ content_type: string }>;
      }>(result);

      expect(parsed.count).toBe(2);
      parsed.results.forEach((r) => {
        expect(r.content_type).toBe("tip");
      });
    });

    it("should filter by both status and content_type", async () => {
      const result = await mandate_list.execute(
        {
          status: "mandate",
          content_type: "tip",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        count: number;
        results: Array<{ status: string; content_type: string }>;
      }>(result);

      expect(parsed.count).toBe(1);
      expect(parsed.results[0].status).toBe("mandate");
      expect(parsed.results[0].content_type).toBe("tip");
    });

    it("should respect limit parameter", async () => {
      const result = await mandate_list.execute(
        {
          limit: 2,
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ count: number }>(result);
      expect(parsed.count).toBeLessThanOrEqual(2);
    });

    it("should include filter information in response", async () => {
      const result = await mandate_list.execute(
        {
          status: "mandate",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        filters: { status: string; content_type: string };
      }>(result);

      expect(parsed.filters.status).toBe("mandate");
      expect(parsed.filters.content_type).toBe("all");
    });

    it("should truncate content for list view", async () => {
      // Add a mandate with long content
      const longContent = "x".repeat(300);
      await mockStorage.store(
        createMockEntry("m-long", { content: longContent }),
      );

      const result = await mandate_list.execute({}, mockCtx);

      const parsed = parseToolResult<{
        results: Array<{ id: string; content: string }>;
      }>(result);

      const longEntry = parsed.results.find((r) => r.id === "m-long");
      expect(longEntry?.content.length).toBeLessThanOrEqual(200);
    });
  });

  // ==========================================================================
  // mandate_stats Tests
  // ==========================================================================

  describe("mandate_stats", () => {
    beforeEach(async () => {
      // Set up test data
      await mockStorage.store(
        createMockEntry("m1", { content_type: "tip", status: "candidate" }),
      );
      await mockStorage.store(
        createMockEntry("m2", { content_type: "idea", status: "mandate" }),
      );

      // Add votes to m1
      await mockStorage.vote({
        id: "v1",
        mandate_id: "m1",
        agent_name: "Agent1",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      });
      await mockStorage.vote({
        id: "v2",
        mandate_id: "m1",
        agent_name: "Agent2",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      });
      await mockStorage.vote({
        id: "v3",
        mandate_id: "m1",
        agent_name: "Agent3",
        vote_type: "downvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      });
    });

    it("should return stats for specific mandate", async () => {
      const result = await mandate_stats.execute(
        {
          mandate_id: "m1",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        mandate_id: string;
        status: string;
        votes: {
          total: number;
          raw_upvotes: number;
          raw_downvotes: number;
          net_votes: number;
          vote_ratio: number;
        };
        voters: Array<{ agent: string; vote_type: string }>;
      }>(result);

      expect(parsed.mandate_id).toBe("m1");
      expect(parsed.votes.total).toBe(3);
      expect(parsed.votes.raw_upvotes).toBe(2);
      expect(parsed.votes.raw_downvotes).toBe(1);
      expect(parsed.voters).toHaveLength(3);
    });

    it("should return overall system stats when no mandate_id", async () => {
      const result = await mandate_stats.execute({}, mockCtx);

      const parsed = parseToolResult<{
        total_mandates: number;
        by_status: {
          candidate: number;
          established: number;
          mandate: number;
          rejected: number;
        };
        by_content_type: {
          idea: number;
          tip: number;
          lore: number;
          snippet: number;
          feature_request: number;
        };
        total_votes: number;
      }>(result);

      expect(parsed.total_mandates).toBe(2);
      expect(parsed.by_status.candidate).toBe(1);
      expect(parsed.by_status.mandate).toBe(1);
      expect(parsed.by_content_type.tip).toBe(1);
      expect(parsed.by_content_type.idea).toBe(1);
      expect(parsed.total_votes).toBe(3);
    });

    it("should throw error for non-existent mandate", async () => {
      await expect(
        mandate_stats.execute(
          {
            mandate_id: "non-existent",
          },
          mockCtx,
        ),
      ).rejects.toThrow(MandateError);
    });

    it("should include voter details", async () => {
      const result = await mandate_stats.execute(
        {
          mandate_id: "m1",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        voters: Array<{
          agent: string;
          vote_type: string;
          timestamp: string;
        }>;
      }>(result);

      expect(parsed.voters).toContainEqual(
        expect.objectContaining({
          agent: "Agent1",
          vote_type: "upvote",
        }),
      );
    });

    it("should return zero stats for empty system", async () => {
      mockStorage.clear();

      const result = await mandate_stats.execute({}, mockCtx);

      const parsed = parseToolResult<{
        total_mandates: number;
        total_votes: number;
      }>(result);

      expect(parsed.total_mandates).toBe(0);
      expect(parsed.total_votes).toBe(0);
    });
  });

  // ==========================================================================
  // Tool Exports Tests
  // ==========================================================================

  describe("mandateTools export", () => {
    it("should export all mandate tools", () => {
      expect(mandateTools.mandate_file).toBe(mandate_file);
      expect(mandateTools.mandate_vote).toBe(mandate_vote);
      expect(mandateTools.mandate_query).toBe(mandate_query);
      expect(mandateTools.mandate_list).toBe(mandate_list);
      expect(mandateTools.mandate_stats).toBe(mandate_stats);
    });

    it("should have exactly 5 tools", () => {
      expect(Object.keys(mandateTools)).toHaveLength(5);
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe("edge cases", () => {
    it("should handle special characters in content", async () => {
      const result = await mandate_file.execute(
        {
          content: "Test with <special> & \"characters\" 'here'",
          content_type: "tip",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ mandate: MandateEntry }>(result);
      expect(parsed.mandate.content).toBe(
        "Test with <special> & \"characters\" 'here'",
      );
    });

    it("should handle unicode content", async () => {
      const result = await mandate_file.execute(
        {
          content: "Unicode test: 你好世界 🎉 émojis",
          content_type: "tip",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ mandate: MandateEntry }>(result);
      expect(parsed.mandate.content).toBe("Unicode test: 你好世界 🎉 émojis");
    });

    it("should handle long content", async () => {
      const longContent = "x".repeat(10000);
      const result = await mandate_file.execute(
        {
          content: longContent,
          content_type: "snippet",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ mandate: MandateEntry }>(result);
      expect(parsed.mandate.content).toBe(longContent);
    });

    it("should handle empty tags array", async () => {
      const result = await mandate_file.execute(
        {
          content: "Test mandate",
          content_type: "tip",
          tags: [],
        },
        mockCtx,
      );

      const parsed = parseToolResult<{ mandate: MandateEntry }>(result);
      expect(parsed.mandate.tags).toEqual([]);
    });

    it("should handle mandate with no votes in stats", async () => {
      await mockStorage.store(createMockEntry("m-no-votes"));

      const result = await mandate_stats.execute(
        {
          mandate_id: "m-no-votes",
        },
        mockCtx,
      );

      const parsed = parseToolResult<{
        votes: {
          total: number;
          net_votes: number;
          vote_ratio: number;
        };
      }>(result);

      expect(parsed.votes.total).toBe(0);
      expect(parsed.votes.net_votes).toBe(0);
      expect(parsed.votes.vote_ratio).toBe(0);
    });
  });

  // ==========================================================================
  // Integration-style Tests (within unit test context)
  // ==========================================================================

  describe("tool workflow integration", () => {
    it("should support complete mandate lifecycle", async () => {
      // 1. Create a mandate
      const createResult = await mandate_file.execute(
        {
          content: "Always validate user input",
          content_type: "tip",
          tags: ["security", "validation"],
        },
        mockCtx,
      );
      const created = parseToolResult<{ mandate: MandateEntry }>(createResult);
      const mandateId = created.mandate.id;

      // 2. Cast votes
      await mandate_vote.execute(
        {
          mandate_id: mandateId,
          vote_type: "upvote",
          agent_name: "Agent1",
        },
        mockCtx,
      );
      await mandate_vote.execute(
        {
          mandate_id: mandateId,
          vote_type: "upvote",
          agent_name: "Agent2",
        },
        mockCtx,
      );

      // 3. Query for the mandate
      const queryResult = await mandate_query.execute(
        {
          query: "validate",
        },
        mockCtx,
      );
      const queried = parseToolResult<{
        results: Array<{ id: string; score: { net_votes: number } }>;
      }>(queryResult);
      
      expect(queried.results.some((r) => r.id === mandateId)).toBe(true);

      // 4. Check stats
      const statsResult = await mandate_stats.execute(
        {
          mandate_id: mandateId,
        },
        mockCtx,
      );
      const stats = parseToolResult<{
        votes: { total: number; raw_upvotes: number };
      }>(statsResult);

      expect(stats.votes.total).toBe(2);
      expect(stats.votes.raw_upvotes).toBe(2);

      // 5. List mandates
      const listResult = await mandate_list.execute(
        {
          content_type: "tip",
        },
        mockCtx,
      );
      const listed = parseToolResult<{
        results: Array<{ id: string }>;
      }>(listResult);

      expect(listed.results.some((r) => r.id === mandateId)).toBe(true);
    });

    it("should handle concurrent operations", async () => {
      // Create mandate
      const createResult = await mandate_file.execute(
        {
          content: "Concurrent test mandate",
          content_type: "tip",
        },
        mockCtx,
      );
      const created = parseToolResult<{ mandate: MandateEntry }>(createResult);
      const mandateId = created.mandate.id;

      // Simulate concurrent votes from different agents
      const votePromises = ["Agent1", "Agent2", "Agent3", "Agent4", "Agent5"].map(
        (agent) =>
          mandate_vote.execute(
            {
              mandate_id: mandateId,
              vote_type: "upvote",
              agent_name: agent,
            },
            mockCtx,
          ),
      );

      await Promise.all(votePromises);

      // Verify all votes were recorded
      const statsResult = await mandate_stats.execute(
        {
          mandate_id: mandateId,
        },
        mockCtx,
      );
      const stats = parseToolResult<{ votes: { total: number } }>(statsResult);

      expect(stats.votes.total).toBe(5);
    });
  });
});
