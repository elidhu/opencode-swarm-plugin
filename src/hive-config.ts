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
// Subtask Types
// ============================================================================

/**
 * Subtask info used for decomposition
 */
export interface SubtaskInfo {
  title: string;
  description?: string;
  files: string[];
  estimated_complexity: number;
  dependencies?: number[];
}
