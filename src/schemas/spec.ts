/**
 * Specification schemas for design-specification-strategy
 *
 * These schemas support the specification lifecycle:
 * - Draft: Work-in-progress specifications
 * - Review: Submitted for human review
 * - Approved: Human-approved, ready for implementation
 * - Implemented: Implementation complete
 * - Deprecated: Superseded or no longer relevant
 *
 * @see docs/analysis/design-specification-strategy.md
 * @module schemas/spec
 */
import { z } from "zod";
import { AnyBeadIdSchema, RequiredTimestampSchema } from "./common";

/**
 * Specification status lifecycle
 */
export const SpecStatusSchema = z.enum([
  "draft", // Work-in-progress, not ready for review
  "review", // Submitted for human review
  "approved", // Human-approved, ready for implementation
  "implemented", // Implementation complete
  "deprecated", // Superseded or no longer relevant
]);
export type SpecStatus = z.infer<typeof SpecStatusSchema>;

/**
 * Approver type - tracks who approved a specification
 *
 * - human: Manually approved by a human reviewer
 * - system: Auto-approved by the system (via spec_quick_write or autoApproveSpec)
 */
export const ApproverTypeSchema = z.enum(["human", "system"]);
export type ApproverType = z.infer<typeof ApproverTypeSchema>;

/**
 * Requirement type (normative language)
 *
 * Based on RFC 2119 terminology:
 * - shall: Mandatory (absolute requirement)
 * - must: Mandatory (emphatic)
 * - should: Recommended
 * - may: Optional
 */
export const RequirementTypeSchema = z.enum([
  "shall", // Mandatory (absolute requirement)
  "must", // Mandatory (emphatic)
  "should", // Recommended
  "may", // Optional
]);
export type RequirementType = z.infer<typeof RequirementTypeSchema>;

/**
 * A scenario within a requirement (Given-When-Then format)
 */
export const SpecScenarioSchema = z.object({
  /** Scenario name for identification */
  name: z.string(),
  /** Preconditions (Given) */
  given: z.string(),
  /** Action or event (When) */
  when: z.string(),
  /** Expected outcomes (Then) - multiple assertions allowed */
  then: z.array(z.string()),
});
export type SpecScenario = z.infer<typeof SpecScenarioSchema>;

/**
 * A single requirement within a spec
 */
export const SpecRequirementSchema = z.object({
  /** Unique requirement ID within the spec */
  id: z.string(),
  /** Short name (max 50 chars) */
  name: z.string().max(50),
  /** Requirement type (normative language) */
  type: RequirementTypeSchema,
  /** Full description of the requirement */
  description: z.string(),
  /** Test scenarios in Given-When-Then format */
  scenarios: z.array(SpecScenarioSchema),
  /** Tags for categorization */
  tags: z.array(z.string()).default([]),
});
export type SpecRequirement = z.infer<typeof SpecRequirementSchema>;

/**
 * Non-functional requirements (NFR) section
 */
export const SpecNfrSchema = z.object({
  /** Performance requirements */
  performance: z.string().optional(),
  /** Security requirements */
  security: z.string().optional(),
  /** Scalability requirements */
  scalability: z.string().optional(),
});
export type SpecNfr = z.infer<typeof SpecNfrSchema>;

/**
 * Core specification entry
 *
 * Represents a versioned specification for a capability.
 * ID format: `spec-{capability}-v{version}` (e.g., `spec-file-locking-v1`)
 */
export const SpecEntrySchema = z.object({
  /** Unique identifier: spec-{capability}-v{version} */
  id: z.string().regex(/^spec-[a-z0-9-]+-v\d+$/),

  /** Capability name (directory name) */
  capability: z.string().regex(/^[a-z0-9-]+$/),

  /** Sequence version number */
  version: z.number().int().min(1),

  /** Current lifecycle status */
  status: SpecStatusSchema,

  /** Display title */
  title: z.string().min(1).max(100),

  /** Purpose statement (min 20 chars per OpenSpec) */
  purpose: z.string().min(20),

  /** Structured requirements */
  requirements: z.array(SpecRequirementSchema),

  /** Non-functional requirements (free-form) */
  nfr: SpecNfrSchema.optional(),

  /** Dependencies on other specs */
  dependencies: z.array(z.string()).default([]),

  /** Linked bead for tracking */
  bead_id: AnyBeadIdSchema.optional(),

  /** Discovery that spawned this spec */
  discovery_id: z.string().optional(),

  /** Original author */
  author: z.string(),

  /** Timestamps */
  created_at: RequiredTimestampSchema,
  updated_at: RequiredTimestampSchema,
  approved_at: RequiredTimestampSchema.optional(),

  /** Who approved this spec (human or system) */
  approved_by: z.union([ApproverTypeSchema, z.string()]).optional(),

  /** Auto-approval flag - if true, spec can be auto-approved without human review */
  auto_approve: z.boolean().optional(),

  /** Confidence score (0-1) for auto-approval threshold decisions */
  confidence: z.number().min(0).max(1).optional(),

  /** Open questions (cleared on approval) */
  open_questions: z.array(z.string()).default([]),

  /** Tags for categorization */
  tags: z.array(z.string()).default([]),

  /** File path relative to project root */
  file_path: z.string(),
});
export type SpecEntry = z.infer<typeof SpecEntrySchema>;

/**
 * Task within a change proposal
 */
export const SpecChangeTaskSchema = z.object({
  /** Task title */
  title: z.string(),
  /** Task description */
  description: z.string().optional(),
  /** Effort estimate (1-5 scale) */
  estimated_effort: z.number().int().min(1).max(5),
});
export type SpecChangeTask = z.infer<typeof SpecChangeTaskSchema>;

/**
 * Change proposal status
 */
export const SpecChangeProposalStatusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "rejected",
]);
export type SpecChangeProposalStatus = z.infer<
  typeof SpecChangeProposalStatusSchema
>;

/**
 * Change proposal for an existing spec
 *
 * Used when proposing modifications to an approved specification.
 */
export const SpecChangeProposalSchema = z.object({
  /** Unique proposal ID */
  id: z.string(),

  /** Target specification capability */
  spec_capability: z.string(),

  /** Current version being changed */
  current_version: z.number().int(),

  /** Proposed new version number */
  proposed_version: z.number().int(),

  /** Why this change? */
  proposal: z.string(),

  /** Technical design decisions */
  design: z.string().optional(),

  /** Implementation task breakdown */
  tasks: z.array(SpecChangeTaskSchema),

  /** Proposal status */
  status: SpecChangeProposalStatusSchema,

  /** Linkage to tracking bead */
  bead_id: AnyBeadIdSchema.optional(),

  /** Proposal author */
  author: z.string(),

  /** Timestamps */
  created_at: RequiredTimestampSchema,
  updated_at: RequiredTimestampSchema,
});
export type SpecChangeProposal = z.infer<typeof SpecChangeProposalSchema>;

// ============================================================================
// Exports
// ============================================================================

export const specSchemas = {
  SpecStatusSchema,
  ApproverTypeSchema,
  RequirementTypeSchema,
  SpecScenarioSchema,
  SpecRequirementSchema,
  SpecNfrSchema,
  SpecEntrySchema,
  SpecChangeTaskSchema,
  SpecChangeProposalStatusSchema,
  SpecChangeProposalSchema,
};
