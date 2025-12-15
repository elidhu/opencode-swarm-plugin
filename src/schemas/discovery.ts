/**
 * Discovery Queue Schemas - Out-of-Scope Finding Tracking
 *
 * These schemas define a "parking lot" system for agents to log discoveries
 * made during task execution without derailing from their primary work.
 *
 * ## Use Cases
 * - Bug found in unrelated file while implementing feature
 * - Technical debt noticed but not immediately actionable
 * - Security concern spotted in passing
 * - Feature idea that emerged from context
 * - Question about architecture or design
 *
 * ## Integration Points
 * - **Beads**: Discoveries can be promoted to beads via coordinator
 * - **Hive Mail**: Use thread_id to link discovery to originating task
 * - **LanceDB**: Future: Semantic search over discovery context
 *
 * @module schemas/discovery
 */
import { z } from "zod";
import { RequiredTimestampSchema, AnyBeadIdSchema } from "./common";

/**
 * Discovery type categorization
 *
 * Helps coordinator prioritize and route discoveries to appropriate handlers.
 */
export const DiscoveryTypeSchema = z.enum([
  "bug", // Functional defect found in existing code
  "debt", // Technical debt / code smell
  "security", // Security vulnerability or concern
  "performance", // Performance issue or optimization opportunity
  "idea", // Feature idea or enhancement
  "question", // Clarification needed about design/architecture
  "documentation", // Missing or incorrect documentation
  "test", // Missing test coverage or flaky test
  "dependency", // Outdated or problematic dependency
  "other", // Uncategorized discovery
]);
export type DiscoveryType = z.infer<typeof DiscoveryTypeSchema>;

/**
 * Discovery urgency level
 *
 * Indicates how quickly the discovery should be triaged.
 * Not the same as bead priority - this is about triage timing.
 */
export const DiscoveryUrgencySchema = z.enum([
  "critical", // Blocks current work or production issue
  "high", // Should be addressed soon (this sprint)
  "medium", // Should be triaged within a week
  "low", // Nice to have, can be deferred
  "info", // Informational only, no action needed
]);
export type DiscoveryUrgency = z.infer<typeof DiscoveryUrgencySchema>;

/**
 * Discovery status lifecycle
 *
 * Tracks progression from initial discovery to final resolution.
 */
export const DiscoveryStatusSchema = z.enum([
  "open", // Newly discovered, awaiting triage
  "triaged", // Reviewed by coordinator/human
  "promoted", // Converted to a bead for tracking
  "deferred", // Acknowledged but postponed
  "duplicate", // Already tracked elsewhere
  "rejected", // Not actionable or invalid
  "resolved", // Fixed without creating a bead
]);
export type DiscoveryStatus = z.infer<typeof DiscoveryStatusSchema>;

/**
 * Core discovery entry
 *
 * Captures everything needed to understand and act on a discovery
 * without requiring the agent to break focus from their current task.
 */
export const DiscoveryEntrySchema = z.object({
  /** Unique identifier for the discovery */
  id: z.string().min(1),

  /** Discovery type for categorization and routing */
  type: DiscoveryTypeSchema,

  /** Urgency level for triage prioritization */
  urgency: DiscoveryUrgencySchema.default("medium"),

  /** Current status in the discovery lifecycle */
  status: DiscoveryStatusSchema.default("open"),

  /** Brief title/summary of the discovery (one-line) */
  title: z.string().min(1).max(200),

  /**
   * Detailed description of what was discovered.
   * Should include:
   * - What the agent was doing when they found it
   * - Why it matters
   * - What the issue/opportunity is
   */
  description: z.string().min(1),

  /**
   * Files related to the discovery.
   * Can be:
   * - File where the issue was found
   * - Files that would need changes
   * - Related test files
   */
  related_files: z.array(z.string()).default([]),

  /**
   * Code snippets or error messages.
   * Use markdown code blocks for formatting.
   */
  code_context: z.string().optional(),

  /**
   * Suggested next steps to address the discovery.
   * Agent's recommendation for how to handle this.
   */
  suggested_action: z.string().optional(),

  /**
   * Estimated effort to address (1-5 scale).
   * 1 = trivial (< 15 min)
   * 2 = simple (15-60 min)
   * 3 = moderate (1-4 hours)
   * 4 = significant (1 day)
   * 5 = major (multiple days)
   */
  estimated_effort: z.number().int().min(1).max(5).optional(),

  /**
   * Agent who discovered this.
   * Useful for follow-up questions during triage.
   */
  discovered_by: z.string(),

  /**
   * Bead the agent was working on when they discovered this.
   * Links discovery back to originating work.
   */
  discovered_during: AnyBeadIdSchema,

  /**
   * Hive mail thread ID for the originating task.
   * Enables async discussion about the discovery.
   */
  thread_id: z.string().optional(),

  /**
   * If promoted to a bead, track the bead ID here.
   * Enables "what happened to my discovery?" queries.
   */
  promoted_to_bead: AnyBeadIdSchema.optional(),

  /**
   * Tags for additional categorization.
   * Examples: ["frontend", "auth"], ["postgres", "migration"]
   */
  tags: z.array(z.string()).default([]),

  /** When the discovery was logged */
  created_at: RequiredTimestampSchema,

  /** When it was last updated (status change, triage, etc) */
  updated_at: RequiredTimestampSchema,

  /**
   * Additional metadata for extensibility.
   * Could include: PR links, Jira references, slack threads, etc.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DiscoveryEntry = z.infer<typeof DiscoveryEntrySchema>;

/**
 * Arguments for creating a discovery
 *
 * Minimal fields required from agent to log a discovery.
 * System fills in defaults, timestamps, etc.
 */
export const DiscoveryCreateArgsSchema = z.object({
  type: DiscoveryTypeSchema,
  urgency: DiscoveryUrgencySchema.default("medium"),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  related_files: z.array(z.string()).default([]),
  code_context: z.string().optional(),
  suggested_action: z.string().optional(),
  estimated_effort: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).default([]),
});
export type DiscoveryCreateArgs = z.infer<typeof DiscoveryCreateArgsSchema>;

/**
 * Arguments for updating a discovery (coordinator/triage)
 */
export const DiscoveryUpdateArgsSchema = z.object({
  id: z.string().min(1),
  status: DiscoveryStatusSchema.optional(),
  urgency: DiscoveryUrgencySchema.optional(),
  promoted_to_bead: AnyBeadIdSchema.optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DiscoveryUpdateArgs = z.infer<typeof DiscoveryUpdateArgsSchema>;

/**
 * Arguments for querying discoveries
 */
export const DiscoveryQueryArgsSchema = z.object({
  status: DiscoveryStatusSchema.optional(),
  type: DiscoveryTypeSchema.optional(),
  urgency: DiscoveryUrgencySchema.optional(),
  discovered_by: z.string().optional(),
  discovered_during: AnyBeadIdSchema.optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().default(20),
});
export type DiscoveryQueryArgs = z.infer<typeof DiscoveryQueryArgsSchema>;

/**
 * Discovery queue statistics
 *
 * Provides overview of pending discoveries for coordinator dashboards.
 */
export const DiscoveryStatsSchema = z.object({
  total: z.number().int().min(0),
  by_status: z.record(DiscoveryStatusSchema, z.number().int().min(0)),
  by_type: z.record(DiscoveryTypeSchema, z.number().int().min(0)),
  by_urgency: z.record(DiscoveryUrgencySchema, z.number().int().min(0)),
  oldest_open: RequiredTimestampSchema.optional(),
  newest_open: RequiredTimestampSchema.optional(),
});
export type DiscoveryStats = z.infer<typeof DiscoveryStatsSchema>;

/**
 * Arguments for promoting a discovery to a bead
 */
export const DiscoveryPromoteArgsSchema = z.object({
  discovery_id: z.string().min(1),
  /** Override title from discovery if needed */
  bead_title: z.string().optional(),
  /** Override description from discovery if needed */
  bead_description: z.string().optional(),
  /** Priority for the created bead (0-3) */
  bead_priority: z.number().int().min(0).max(3).optional(),
  /** Parent bead if this should be a subtask */
  parent_bead_id: AnyBeadIdSchema.optional(),
});
export type DiscoveryPromoteArgs = z.infer<typeof DiscoveryPromoteArgsSchema>;

/**
 * Result of promoting a discovery to a bead
 */
export const DiscoveryPromoteResultSchema = z.object({
  success: z.boolean(),
  discovery_id: z.string(),
  bead_id: AnyBeadIdSchema,
  /** Auto-updated discovery with promoted_to_bead and status=promoted */
  updated_discovery: DiscoveryEntrySchema,
});
export type DiscoveryPromoteResult = z.infer<
  typeof DiscoveryPromoteResultSchema
>;
