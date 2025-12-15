/**
 * Specialization Schemas - Agent competence tracking for emergent organization
 *
 * Defines schemas for tracking which agents excel at which types of tasks.
 * Used by the emergent self-organization system to assign specialists to subtasks.
 *
 * Key concepts:
 * - **Task Dimensions**: Ways to categorize tasks (file type, strategy, complexity, domain)
 * - **Specialization Score**: Per-agent competence on a specific dimension value
 * - **Agent Specialization**: Aggregate profile showing an agent's top specializations
 *
 * @see docs/analysis/emergent-organization-design.md
 * @module schemas/specialization
 */

import { z } from "zod";

// ============================================================================
// Task Dimensions
// ============================================================================

/**
 * Task dimension for specialization tracking
 *
 * Dimensions categorize tasks in different ways:
 * - `file_type`: Programming language or file format (e.g., "typescript", "python", "markdown")
 * - `strategy`: Decomposition strategy used (e.g., "file-based", "feature-based", "risk-based")
 * - `complexity`: Estimated complexity (1-5 scale, represented as string "1-2", "3", "4-5")
 * - `domain`: Functional domain (e.g., "frontend", "backend", "infra")
 *
 * Each dimension+value pair (e.g., file_type:typescript) tracks a distinct specialization.
 */
export const TaskDimensionSchema = z.enum([
  "file_type", // e.g., "typescript", "python", "markdown"
  "strategy", // e.g., "file-based", "feature-based", "risk-based"
  "complexity", // e.g., "1-2", "3", "4-5"
  "domain", // e.g., "frontend", "backend", "infra"
]);

export type TaskDimension = z.infer<typeof TaskDimensionSchema>;

// ============================================================================
// Specialization Score
// ============================================================================

/**
 * Specialization score for an agent on a specific dimension value
 *
 * Tracks an agent's performance on a particular task characteristic.
 * Example: Agent "WiseCloud" on dimension "file_type" value "typescript"
 *
 * **Competence Calculation**:
 * - Success rate (40%): successful_tasks / total_tasks
 * - Speed score (30%): faster than median = higher score
 * - Error score (30%): fewer errors = higher score
 * - Combined: competence ∈ [0, 1]
 *
 * **Confidence Calculation**:
 * - Based on sample size: confidence = min(1, total_tasks / 20)
 * - Higher confidence with more observations (asymptotes at 20 tasks)
 * - Low confidence (<0.3) = don't trust specialization yet
 */
export const SpecializationScoreSchema = z.object({
  /** Agent identifier (e.g., "WiseCloud", "BrightStar") */
  agent_id: z.string(),

  /** Task dimension being tracked */
  dimension: TaskDimensionSchema,

  /** Dimension value (e.g., "typescript", "file-based", "frontend") */
  value: z.string(),

  /** Success count on this dimension value */
  success_count: z.number().int().min(0).default(0),

  /** Failure count on this dimension value */
  failure_count: z.number().int().min(0).default(0),

  /** Average duration for successful tasks (milliseconds) */
  avg_duration_ms: z.number().min(0).default(0),

  /** Average error count per task */
  avg_error_count: z.number().min(0).default(0),

  /**
   * Competence score (0-1, higher = more specialized)
   *
   * Weighted combination of:
   * - Success rate: 40%
   * - Speed: 30% (faster than median = higher)
   * - Low errors: 30%
   */
  competence: z.number().min(0).max(1).default(0.5),

  /**
   * Confidence in score (0-1, based on sample size)
   *
   * Formula: min(1, total_tasks / 20)
   * - 0 tasks → 0.0 confidence
   * - 10 tasks → 0.5 confidence
   * - 20+ tasks → 1.0 confidence
   */
  confidence: z.number().min(0).max(1).default(0),

  /** When this score was last updated (ISO-8601) */
  last_updated: z.string(),
});

export type SpecializationScore = z.infer<typeof SpecializationScoreSchema>;

// ============================================================================
// Agent Specialization Profile
// ============================================================================

/**
 * Aggregate specialization profile for an agent
 *
 * Summarizes an agent's overall performance and top specializations.
 * Used for quick lookups: "Which agent is best for TypeScript tasks?"
 *
 * **Top Specializations Format**: "dimension:value" strings, e.g.:
 * - "file_type:typescript"
 * - "strategy:file-based"
 * - "domain:frontend"
 *
 * Ranked by weighted competence (competence × confidence).
 */
export const AgentSpecializationSchema = z.object({
  /** Agent identifier */
  agent_id: z.string(),

  /** Total tasks completed by this agent */
  total_tasks: z.number().int().min(0).default(0),

  /** Overall success rate across all tasks */
  success_rate: z.number().min(0).max(1).default(0),

  /**
   * Specialization scores per dimension
   *
   * Full list of all tracked dimension:value pairs for this agent.
   * Use for detailed competence analysis.
   */
  scores: z.array(SpecializationScoreSchema).default([]),

  /**
   * Top 3 specializations (dimension:value format)
   *
   * Example: ["file_type:typescript", "strategy:file-based", "domain:frontend"]
   *
   * Ranked by weighted competence (competence × confidence).
   * Only includes specializations with confidence >0.3.
   */
  top_specializations: z.array(z.string()).max(3).default([]),

  /** Agent first seen timestamp (ISO-8601) */
  first_seen: z.string(),

  /** Agent last seen timestamp (ISO-8601) */
  last_seen: z.string(),
});

export type AgentSpecialization = z.infer<typeof AgentSpecializationSchema>;

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Result of querying for a specialist agent
 */
export interface SpecialistQuery {
  /** Agent ID of the specialist */
  agentId: string;

  /** Confidence in the match (0-1) */
  confidence: number;

  /** Matching specialization scores */
  matchedScores: SpecializationScore[];
}

/**
 * Task characteristics for specialization matching
 *
 * Used to query for the best agent for a task.
 * Example:
 * ```typescript
 * const dimensions = new Map<TaskDimension, string>([
 *   ["file_type", "typescript"],
 *   ["domain", "frontend"],
 *   ["complexity", "3"],
 * ]);
 * ```
 */
export type TaskDimensions = Map<TaskDimension, string>;

// ============================================================================
// Exports
// ============================================================================

export const specializationSchemas = {
  TaskDimensionSchema,
  SpecializationScoreSchema,
  AgentSpecializationSchema,
};
