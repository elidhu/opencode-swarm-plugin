/**
 * Hive Config Module - Shared configuration for hive coordination
 *
 * This module contains configuration types and constants used across
 * multiple hive modules, preventing circular dependencies.
 *
 * Extracted from hive-orchestrate.ts to allow hive-prompts.ts
 * to import shared config without creating a circular dependency.
 *
 * @module hive-config
 */

// ============================================================================
// Spec Generation Types
// ============================================================================

/**
 * Configuration for spec generation triggers
 */
export interface SpecGenerationConfig {
  /** Minimum complexity to generate spec (default: 3) */
  complexity_threshold: number;
  /** Auto-approve specs at this complexity (default: 3) */
  auto_approve_complexity: number;
  /** Maximum complexity before requiring human review (default: 4+) */
  review_required_complexity: number;
  /** Task types that should generate specs */
  spec_types: ("feature" | "epic" | "task")[];
  /** Task types that should NOT generate specs */
  skip_types: ("bug" | "chore")[];
  /** Default confidence for generated specs */
  default_confidence: number;
}

/**
 * Default spec generation configuration
 */
export const DEFAULT_SPEC_CONFIG: SpecGenerationConfig = {
  complexity_threshold: 3,
  auto_approve_complexity: 3,
  review_required_complexity: 4,
  spec_types: ["feature", "epic"],
  skip_types: ["bug", "chore"],
  default_confidence: 0.75,
};

/**
 * Result of spec generation analysis
 */
export interface SpecGenerationDecision {
  /** Whether a spec should be generated */
  should_generate: boolean;
  /** Whether the spec should be auto-approved */
  auto_approve: boolean;
  /** Reasoning for the decision */
  reasoning: string;
  /** Calculated confidence score */
  confidence: number;
}

/**
 * Subtask info used for spec generation
 */
export interface SubtaskForSpec {
  title: string;
  description?: string;
  files: string[];
  estimated_complexity: number;
  dependencies?: number[];
}
