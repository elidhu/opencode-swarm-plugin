/**
 * Verification schemas for Cross-Agent Consistency Protocols
 *
 * Defines types for:
 * - Pre-Flight Protocol: Health checks before agents start
 * - Shared Gotchas Protocol: Broadcasting discovered issues
 * - Style Enforcement Protocol: Consistent patterns
 * - Enhanced Verification Gates: Multi-stage validation
 *
 * @see docs/analysis/consistency-protocols-design.md
 */

import { z } from "zod";

// ============================================================================
// Pre-Flight Protocol
// ============================================================================

/**
 * Result from a single pre-flight check
 */
export const PreFlightResultSchema = z.object({
  passed: z.boolean(),
  message: z.string(),
  blockers: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type PreFlightResult = z.infer<typeof PreFlightResultSchema>;

/**
 * A single pre-flight check to run before agent starts
 */
export const PreFlightCheckSchema = z.object({
  name: z.string(),
  required: z.boolean().describe("If true, failure blocks agent start"),
  // Note: check function not serializable, defined in implementation
});
export type PreFlightCheck = z.infer<typeof PreFlightCheckSchema>;

/**
 * Configuration for pre-flight protocol
 */
export const PreFlightProtocolSchema = z.object({
  checks: z.array(PreFlightCheckSchema),
  on_failure: z.enum(["block", "warn", "skip"]),
});
export type PreFlightProtocol = z.infer<typeof PreFlightProtocolSchema>;

// ============================================================================
// Shared Gotchas Protocol
// ============================================================================

/**
 * Category of gotcha (what type of issue)
 */
export const GotchaCategorySchema = z.enum([
  "type-error",
  "null-handling",
  "edge-case",
  "api-quirk",
  "test-requirement",
  "pattern-violation",
  "dependency-issue",
]);
export type GotchaCategory = z.infer<typeof GotchaCategorySchema>;

/**
 * A discovered issue that should be shared with all agents
 *
 * @example
 * {
 *   id: "gotcha-epic-123-1234567890",
 *   epic_id: "epic-123",
 *   discovered_by: "agent-worker-1",
 *   category: "null-handling",
 *   title: "processInput doesn't handle null",
 *   details: "processInput() throws TypeError on null input",
 *   mitigation: "Use default value or validate before calling",
 *   files_affected: ["src/processor.ts"],
 *   discovered_at: "2025-12-15T10:30:00Z",
 *   severity: "warning"
 * }
 */
export const GotchaSchema = z.object({
  id: z.string(),
  epic_id: z.string(),
  discovered_by: z.string(),
  category: GotchaCategorySchema,
  title: z.string().max(100),
  details: z.string(),
  mitigation: z.string().describe("How to avoid this issue"),
  files_affected: z.array(z.string()).optional(),
  discovered_at: z.string().datetime(),
  severity: z.enum(["info", "warning", "critical"]),
  resolved_at: z.string().datetime().optional(),
  resolved_by: z.string().optional(),
});
export type Gotcha = z.infer<typeof GotchaSchema>;

/**
 * Request to report a gotcha
 */
export const ReportGotchaArgsSchema = z.object({
  project_key: z.string(),
  agent_name: z.string(),
  epic_id: z.string(),
  category: GotchaCategorySchema,
  title: z.string().max(100),
  details: z.string(),
  mitigation: z.string(),
  files_affected: z.array(z.string()).optional(),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
});
export type ReportGotchaArgs = z.infer<typeof ReportGotchaArgsSchema>;

/**
 * Request to query gotchas
 */
export const QueryGotchasArgsSchema = z.object({
  epic_id: z.string().optional(),
  files: z.array(z.string()).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  category: GotchaCategorySchema.optional(),
});
export type QueryGotchasArgs = z.infer<typeof QueryGotchasArgsSchema>;

// ============================================================================
// Style Enforcement Protocol
// ============================================================================

/**
 * Category of style rule
 */
export const StyleCategorySchema = z.enum([
  "naming",
  "formatting",
  "patterns",
  "imports",
  "error-handling",
  "async",
  "types",
]);
export type StyleCategory = z.infer<typeof StyleCategorySchema>;

/**
 * A single style violation found during checking
 */
export const StyleViolationSchema = z.object({
  rule_id: z.string(),
  file: z.string(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  message: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  suggestion: z.string().optional(),
  autofix_available: z.boolean(),
});
export type StyleViolation = z.infer<typeof StyleViolationSchema>;

/**
 * Context passed to style rule checks
 */
export const FileContextSchema = z.object({
  path: z.string(),
  content: z.string(),
  ast: z.unknown().optional(),
});
export type FileContext = z.infer<typeof FileContextSchema>;

/**
 * A style rule definition
 */
export const StyleRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: StyleCategorySchema,
  enabled: z.boolean().default(true),
  // Note: check and autofix functions not serializable, defined in implementation
});
export type StyleRule = z.infer<typeof StyleRuleSchema>;

/**
 * Request to check style
 */
export const CheckStyleArgsSchema = z.object({
  files: z.array(z.string()),
  rules: z.array(z.string()).optional(),
  autofix: z.boolean().default(false),
});
export type CheckStyleArgs = z.infer<typeof CheckStyleArgsSchema>;

/**
 * Result from style checking
 */
export const StyleCheckResultSchema = z.object({
  total_violations: z.number().int().min(0),
  errors: z.number().int().min(0),
  warnings: z.number().int().min(0),
  info: z.number().int().min(0),
  fixed: z.number().int().min(0),
  violations: z.array(StyleViolationSchema),
  passed: z.boolean(),
  message: z.string(),
});
export type StyleCheckResult = z.infer<typeof StyleCheckResultSchema>;

// ============================================================================
// Enhanced Verification Gates
// ============================================================================

/**
 * Result from a single verification check
 */
export const CheckResultSchema = z.object({
  passed: z.boolean(),
  message: z.string(),
  details: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

/**
 * Context passed to verification checks
 */
export const VerificationContextSchema = z.object({
  bead_id: z.string(),
  files_touched: z.array(z.string()),
  agent_name: z.string(),
  epic_id: z.string(),
  project_key: z.string().optional(),
});
export type VerificationContext = z.infer<typeof VerificationContextSchema>;

/**
 * A single verification check
 */
export const VerificationCheckSchema = z.object({
  name: z.string(),
  timeout_ms: z.number().int().positive().optional(),
  // Note: run function not serializable, defined in implementation
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

/**
 * A stage in the verification gate
 */
export const VerificationStageSchema = z.object({
  name: z.string(),
  order: z.number().int().min(1),
  required: z.boolean().describe("Must pass to proceed"),
  checks: z.array(VerificationCheckSchema),
});
export type VerificationStage = z.infer<typeof VerificationStageSchema>;

/**
 * Enforcement mode for verification gates
 */
export const EnforcementModeSchema = z.enum([
  "strict", // All required checks must pass
  "progressive", // First failure warns, second blocks
  "advisory", // Nothing blocks, all warnings
]);
export type EnforcementMode = z.infer<typeof EnforcementModeSchema>;

/**
 * A complete verification gate with multiple stages
 */
export const VerificationGateSchema = z.object({
  name: z.string(),
  stages: z.array(VerificationStageSchema),
  enforcement: EnforcementModeSchema,
});
export type VerificationGate = z.infer<typeof VerificationGateSchema>;

/**
 * Result from a verification step (from existing hive-orchestrate.ts)
 */
export const VerificationStepSchema = z.object({
  name: z.string(),
  command: z.string(),
  passed: z.boolean(),
  exitCode: z.number(),
  output: z.string().optional(),
  error: z.string().optional(),
  skipped: z.boolean().optional(),
  skipReason: z.string().optional(),
});
export type VerificationStep = z.infer<typeof VerificationStepSchema>;

/**
 * Result from running the full verification gate
 */
export const VerificationGateResultSchema = z.object({
  passed: z.boolean(),
  steps: z.array(VerificationStepSchema),
  summary: z.string(),
  blockers: z.array(z.string()),
});
export type VerificationGateResult = z.infer<typeof VerificationGateResultSchema>;

/**
 * Decision from enforcement logic
 */
export const EnforcementDecisionSchema = z.object({
  allow: z.boolean(),
  message: z.string(),
  override_allowed: z.boolean(),
  requires_confirmation: z.boolean().optional(),
  warning: z.boolean().optional(),
});
export type EnforcementDecision = z.infer<typeof EnforcementDecisionSchema>;

// ============================================================================
// Enforcement Tracking
// ============================================================================

/**
 * Record of verification failures for progressive enforcement
 */
export const EnforcementFailureSchema = z.object({
  bead_id: z.string(),
  check_name: z.string(),
  failure_count: z.number().int().min(0),
  first_failure_at: z.string().datetime(),
  last_failure_at: z.string().datetime(),
});
export type EnforcementFailure = z.infer<typeof EnforcementFailureSchema>;

// ============================================================================
// Metrics
// ============================================================================

/**
 * Metrics for consistency protocols
 */
export const ConsistencyMetricsSchema = z.object({
  /** Percentage of errors caught before hive_complete */
  error_detection_timing: z.number().min(0).max(100),
  /** Unique gotchas reported / Total gotchas encountered */
  gotcha_effectiveness: z.number().min(0).max(1),
  /** Files with 0 style violations / Total files modified */
  style_consistency: z.number().min(0).max(100),
  /** hive_complete success without retry / Total attempts */
  verification_gate_pass_rate: z.number().min(0).max(100),
  /** Total gotchas reported */
  total_gotchas: z.number().int().min(0),
  /** Total pre-flight blocks */
  preflight_blocks: z.number().int().min(0),
  /** Total style violations fixed */
  style_fixes: z.number().int().min(0),
});
export type ConsistencyMetrics = z.infer<typeof ConsistencyMetricsSchema>;

// ============================================================================
// Exports
// ============================================================================

export const verificationSchemas = {
  // Pre-Flight
  PreFlightResultSchema,
  PreFlightCheckSchema,
  PreFlightProtocolSchema,

  // Gotchas
  GotchaCategorySchema,
  GotchaSchema,
  ReportGotchaArgsSchema,
  QueryGotchasArgsSchema,

  // Style
  StyleCategorySchema,
  StyleViolationSchema,
  FileContextSchema,
  StyleRuleSchema,
  CheckStyleArgsSchema,
  StyleCheckResultSchema,

  // Verification Gates
  CheckResultSchema,
  VerificationContextSchema,
  VerificationCheckSchema,
  VerificationStageSchema,
  EnforcementModeSchema,
  VerificationGateSchema,
  VerificationStepSchema,
  VerificationGateResultSchema,
  EnforcementDecisionSchema,

  // Enforcement
  EnforcementFailureSchema,

  // Metrics
  ConsistencyMetricsSchema,
};
