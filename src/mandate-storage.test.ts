/**
 * Tests for mandate storage
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  SemanticMemoryMandateStorage,
  updateMandateStatus,
  updateAllMandateStatuses,
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

/**
 * Mock mandate storage for unit testing
 *
 * Implements MandateStorage interface with in-memory data structures.
 * This is only for testing - production code uses SemanticMemoryMandateStorage.
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
}

describe("MandateStorage", () => {
  let storage: MandateStorage;

  beforeEach(() => {
    // Use MockMandateStorage for fast, isolated unit tests
    storage = new MockMandateStorage();
  });

  describe("Entry operations", () => {
    it("should store and retrieve mandate entry", async () => {
      const entry: MandateEntry = {
        id: "mandate-1",
        content: "Always use Effect for async operations",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: ["async", "effect"],
      };

      await storage.store(entry);
      const retrieved = await storage.get("mandate-1");

      expect(retrieved).toEqual(entry);
    });

    it("should return null for non-existent mandate", async () => {
      const result = await storage.get("non-existent");
      expect(result).toBeNull();
    });

    it("should find mandates by query", async () => {
      const entry1: MandateEntry = {
        id: "mandate-1",
        content: "Use Effect for async operations",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: ["async"],
      };

      const entry2: MandateEntry = {
        id: "mandate-2",
        content: "Prefer semantic memory for persistence",
        content_type: "tip",
        author_agent: "GreenRiver",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: ["storage"],
      };

      await storage.store(entry1);
      await storage.store(entry2);

      const results = await storage.find("Effect");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("mandate-1");
    });

    it("should list all mandates", async () => {
      const entry1: MandateEntry = {
        id: "mandate-1",
        content: "Tip 1",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };

      const entry2: MandateEntry = {
        id: "mandate-2",
        content: "Idea 1",
        content_type: "idea",
        author_agent: "GreenRiver",
        created_at: new Date().toISOString(),
        status: "mandate",
        tags: [],
      };

      await storage.store(entry1);
      await storage.store(entry2);

      const all = await storage.list();
      expect(all).toHaveLength(2);
    });

    it("should filter mandates by status", async () => {
      const entry1: MandateEntry = {
        id: "mandate-1",
        content: "Tip 1",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };

      const entry2: MandateEntry = {
        id: "mandate-2",
        content: "Idea 1",
        content_type: "idea",
        author_agent: "GreenRiver",
        created_at: new Date().toISOString(),
        status: "mandate",
        tags: [],
      };

      await storage.store(entry1);
      await storage.store(entry2);

      const mandates = await storage.list({ status: "mandate" });
      expect(mandates).toHaveLength(1);
      expect(mandates[0].id).toBe("mandate-2");
    });

    it("should filter mandates by content_type", async () => {
      const entry1: MandateEntry = {
        id: "mandate-1",
        content: "Tip 1",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };

      const entry2: MandateEntry = {
        id: "mandate-2",
        content: "Idea 1",
        content_type: "idea",
        author_agent: "GreenRiver",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };

      await storage.store(entry1);
      await storage.store(entry2);

      const tips = await storage.list({ content_type: "tip" });
      expect(tips).toHaveLength(1);
      expect(tips[0].id).toBe("mandate-1");
    });

    it("should update mandate entry", async () => {
      const entry: MandateEntry = {
        id: "mandate-1",
        content: "Original content",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };

      await storage.store(entry);
      await storage.update("mandate-1", { content: "Updated content" });

      const updated = await storage.get("mandate-1");
      expect(updated?.content).toBe("Updated content");
    });

    it("should throw when updating non-existent mandate", async () => {
      await expect(
        storage.update("non-existent", { content: "Updated" }),
      ).rejects.toThrow("Mandate 'non-existent' not found");
    });
  });

  describe("Vote operations", () => {
    beforeEach(async () => {
      // Create a mandate to vote on
      const entry: MandateEntry = {
        id: "mandate-1",
        content: "Test mandate",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };
      await storage.store(entry);
    });

    it("should cast vote and verify storage", async () => {
      const vote: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      await storage.vote(vote);

      const votes = await storage.getVotes("mandate-1");
      expect(votes).toHaveLength(1);
      expect(votes[0]).toEqual(vote);
    });

    it("should prevent duplicate votes from same agent", async () => {
      const vote1: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      await storage.vote(vote1);

      const vote2: Vote = {
        id: "vote-2",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "downvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      await expect(storage.vote(vote2)).rejects.toThrow(
        "Agent 'GreenRiver' has already voted on mandate 'mandate-1'",
      );
    });

    it("should check if agent has voted", async () => {
      const vote: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      await storage.vote(vote);

      const hasVoted = await storage.hasVoted("mandate-1", "GreenRiver");
      expect(hasVoted).toBe(true);

      const hasNotVoted = await storage.hasVoted("mandate-1", "BlueLake");
      expect(hasNotVoted).toBe(false);
    });

    it("should get all votes for a mandate", async () => {
      const vote1: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      const vote2: Vote = {
        id: "vote-2",
        mandate_id: "mandate-1",
        agent_name: "RedMountain",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      await storage.vote(vote1);
      await storage.vote(vote2);

      const votes = await storage.getVotes("mandate-1");
      expect(votes).toHaveLength(2);
    });
  });

  describe("Score calculation with decay", () => {
    beforeEach(async () => {
      // Create a mandate to vote on
      const entry: MandateEntry = {
        id: "mandate-1",
        content: "Test mandate",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };
      await storage.store(entry);
    });

    it("should calculate score with no votes", async () => {
      const score = await storage.calculateScore("mandate-1");

      expect(score.mandate_id).toBe("mandate-1");
      expect(score.raw_upvotes).toBe(0);
      expect(score.raw_downvotes).toBe(0);
      expect(score.decayed_upvotes).toBe(0);
      expect(score.decayed_downvotes).toBe(0);
      expect(score.net_votes).toBe(0);
      expect(score.vote_ratio).toBe(0);
      expect(score.decayed_score).toBe(0);
    });

    it("should calculate score with recent upvotes", async () => {
      const vote1: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      const vote2: Vote = {
        id: "vote-2",
        mandate_id: "mandate-1",
        agent_name: "RedMountain",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      await storage.vote(vote1);
      await storage.vote(vote2);

      const score = await storage.calculateScore("mandate-1");

      expect(score.raw_upvotes).toBe(2);
      expect(score.raw_downvotes).toBe(0);
      expect(score.decayed_upvotes).toBeCloseTo(2.0, 1); // Recent votes, minimal decay
      expect(score.net_votes).toBeGreaterThan(1.5);
      expect(score.vote_ratio).toBe(1.0); // 100% upvotes
      expect(score.decayed_score).toBeGreaterThan(1.5);
    });

    it("should calculate score with mixed votes", async () => {
      const vote1: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      const vote2: Vote = {
        id: "vote-2",
        mandate_id: "mandate-1",
        agent_name: "RedMountain",
        vote_type: "downvote",
        timestamp: new Date().toISOString(),
        weight: 1.0,
      };

      await storage.vote(vote1);
      await storage.vote(vote2);

      const score = await storage.calculateScore("mandate-1");

      expect(score.raw_upvotes).toBe(1);
      expect(score.raw_downvotes).toBe(1);
      expect(score.vote_ratio).toBeCloseTo(0.5, 1); // 50% ratio
      expect(score.net_votes).toBeCloseTo(0, 1); // Equal votes cancel out
    });

    it("should apply decay to old votes", async () => {
      // Vote from 90 days ago (one half-life)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const oldVote: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: ninetyDaysAgo.toISOString(),
        weight: 1.0,
      };

      await storage.vote(oldVote);

      const score = await storage.calculateScore("mandate-1");

      expect(score.raw_upvotes).toBe(1);
      expect(score.decayed_upvotes).toBeCloseTo(0.5, 1); // ~50% after 90 days
      expect(score.net_votes).toBeCloseTo(0.5, 1);
    });

    it("should handle vote weights", async () => {
      const vote1: Vote = {
        id: "vote-1",
        mandate_id: "mandate-1",
        agent_name: "GreenRiver",
        vote_type: "upvote",
        timestamp: new Date().toISOString(),
        weight: 0.5, // Partial weight
      };

      await storage.vote(vote1);

      const score = await storage.calculateScore("mandate-1");

      expect(score.raw_upvotes).toBe(1); // Count is still 1
      expect(score.decayed_upvotes).toBeCloseTo(0.5, 1); // But weighted value is 0.5
    });
  });

  describe("Status updates based on score", () => {
    it("should transition to mandate status with high score", async () => {
      const entry: MandateEntry = {
        id: "mandate-1",
        content: "Test mandate",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };
      await storage.store(entry);

      // Add 6 upvotes to exceed threshold (net_votes >= 5, ratio >= 0.7)
      for (let i = 0; i < 6; i++) {
        const vote: Vote = {
          id: `vote-${i}`,
          mandate_id: "mandate-1",
          agent_name: `Agent${i}`,
          vote_type: "upvote",
          timestamp: new Date().toISOString(),
          weight: 1.0,
        };
        await storage.vote(vote);
      }

      const result = await updateMandateStatus("mandate-1", storage);

      expect(result.status_changed).toBe(true);
      expect(result.previous_status).toBe("candidate");
      expect(result.new_status).toBe("mandate");
      expect(result.score.net_votes).toBeGreaterThanOrEqual(5);
      expect(result.score.vote_ratio).toBeGreaterThanOrEqual(0.7);
    });

    it("should transition to established status", async () => {
      const entry: MandateEntry = {
        id: "mandate-1",
        content: "Test mandate",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };
      await storage.store(entry);

      // Add 3 upvotes (net_votes >= 2 but < 5)
      for (let i = 0; i < 3; i++) {
        const vote: Vote = {
          id: `vote-${i}`,
          mandate_id: "mandate-1",
          agent_name: `Agent${i}`,
          vote_type: "upvote",
          timestamp: new Date().toISOString(),
          weight: 1.0,
        };
        await storage.vote(vote);
      }

      const result = await updateMandateStatus("mandate-1", storage);

      expect(result.status_changed).toBe(true);
      expect(result.new_status).toBe("established");
    });

    it("should transition to rejected status", async () => {
      const entry: MandateEntry = {
        id: "mandate-1",
        content: "Test mandate",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };
      await storage.store(entry);

      // Add 4 downvotes (net_votes <= -3)
      for (let i = 0; i < 4; i++) {
        const vote: Vote = {
          id: `vote-${i}`,
          mandate_id: "mandate-1",
          agent_name: `Agent${i}`,
          vote_type: "downvote",
          timestamp: new Date().toISOString(),
          weight: 1.0,
        };
        await storage.vote(vote);
      }

      const result = await updateMandateStatus("mandate-1", storage);

      expect(result.status_changed).toBe(true);
      expect(result.new_status).toBe("rejected");
    });

    it("should batch update all mandates", async () => {
      // Create multiple mandates
      const entry1: MandateEntry = {
        id: "mandate-1",
        content: "Tip 1",
        content_type: "tip",
        author_agent: "BlueLake",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };

      const entry2: MandateEntry = {
        id: "mandate-2",
        content: "Tip 2",
        content_type: "tip",
        author_agent: "GreenRiver",
        created_at: new Date().toISOString(),
        status: "candidate",
        tags: [],
      };

      await storage.store(entry1);
      await storage.store(entry2);

      // Add votes to first mandate
      for (let i = 0; i < 6; i++) {
        const vote: Vote = {
          id: `vote-${i}`,
          mandate_id: "mandate-1",
          agent_name: `Agent${i}`,
          vote_type: "upvote",
          timestamp: new Date().toISOString(),
          weight: 1.0,
        };
        await storage.vote(vote);
      }

      const results = await updateAllMandateStatuses(storage);

      expect(results).toHaveLength(2);
      expect(results[0].status_changed).toBe(true);
      expect(results[0].new_status).toBe("mandate");
      expect(results[1].status_changed).toBe(false); // No votes, stays candidate
    });
  });

  describe("Instance checks", () => {
    it("should be instance of MockMandateStorage", () => {
      expect(storage).toBeInstanceOf(MockMandateStorage);
    });
  });
});
