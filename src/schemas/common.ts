/**
 * Common schema primitives shared across all schema modules
 *
 * This module provides reusable Zod schemas for:
 * - Timestamp validation (ISO-8601 with timezone offset)
 * - Bead ID format validation (with subtask support)
 *
 * @module schemas/common
 */
import { z } from "zod";

/**
 * Standard error message for timestamp validation
 */
const TIMESTAMP_ERROR =
  "Must be ISO-8601 datetime with timezone (e.g., 2024-01-15T10:30:00Z)";

/**
 * Required timestamp field with timezone offset.
 *
 * Validates ISO-8601 datetime strings with timezone information.
 * Use for created_at, started_at, and other required timestamp fields.
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   created_at: RequiredTimestampSchema,
 * });
 * ```
 */
export const RequiredTimestampSchema = z.string().datetime({
  offset: true,
  message: TIMESTAMP_ERROR,
});

/**
 * Optional timestamp field with timezone offset.
 *
 * Validates ISO-8601 datetime strings with timezone information when present.
 * Use for updated_at, closed_at, and other optional timestamp fields.
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   updated_at: OptionalTimestampSchema,
 * });
 * ```
 */
export const OptionalTimestampSchema = RequiredTimestampSchema.optional();

/**
 * Bead ID format validation (without subtask suffix).
 *
 * Validates the base bead ID format: `project-name-hash`
 * Examples:
 * - `my-project-abc12` ✓
 * - `opencode-hive-plugin-1i8` ✓
 * - `my-project-abc12.1` ✗ (use SubtaskIdSchema)
 *
 * @see {SubtaskIdSchema} for IDs with subtask suffixes
 */
export const BeadIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)+$/,
    "Invalid bead ID: expected format 'project-name-abc12'",
  );

/**
 * Subtask ID format validation (with dot-notation suffix).
 *
 * Validates subtask ID format: `project-name-hash.suffix`
 * Examples:
 * - `my-project-abc12.1` ✓ (numeric index)
 * - `my-project-abc12.e2e-test` ✓ (named suffix)
 * - `opencode-hive-plugin-1i8.3` ✓
 * - `my-project-abc12` ✗ (use BeadIdSchema)
 *
 * @see {BeadIdSchema} for base bead IDs without suffixes
 */
export const SubtaskIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)+\.[\w-]+$/,
    "Invalid subtask ID: expected format 'project-name-abc12.1' or 'project-name-abc12.subtask-name'",
  );

/**
 * Union of bead and subtask ID formats.
 *
 * Accepts both base bead IDs and subtask IDs.
 * Use when a field can reference either type.
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   id: AnyBeadIdSchema, // Can be 'project-abc' or 'project-abc.1'
 *   parent_id: BeadIdSchema.optional(), // Must be base bead ID
 * });
 * ```
 */
export const AnyBeadIdSchema = z.union([BeadIdSchema, SubtaskIdSchema]);
