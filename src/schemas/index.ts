/**
 * Schema Definitions - Central export point for all Zod schemas
 *
 * This module re-exports all schema definitions used throughout the plugin.
 * Schemas are organized by domain:
 *
 * ## Common Schemas (Shared Primitives)
 * - `RequiredTimestampSchema` - ISO-8601 datetime with timezone (required)
 * - `OptionalTimestampSchema` - ISO-8601 datetime with timezone (optional)
 * - `BeadIdSchema` - Base bead ID format validation
 * - `SubtaskIdSchema` - Subtask ID format validation (with dot suffix)
 * - `AnyBeadIdSchema` - Union of bead and subtask ID formats
 *
 * ## Bead Schemas (Issue Tracking)
 * - `BeadSchema` - Core bead/issue definition
 * - `BeadStatusSchema` - Status enum (open, in_progress, blocked, closed)
 * - `BeadTypeSchema` - Type enum (bug, feature, task, epic, chore)
 * - `SubtaskSpecSchema` - Subtask specification for epic creation
 *
 * ## Task Schemas (Hive Decomposition)
 * - `TaskDecompositionSchema` - Full task breakdown
 * - `DecomposedSubtaskSchema` - Individual subtask definition
 * - `BeadTreeSchema` - Epic + subtasks structure
 *
 * ## Evaluation Schemas (Agent Self-Assessment)
 * - `EvaluationSchema` - Complete evaluation with criteria
 * - `CriterionEvaluationSchema` - Single criterion result
 *
 * ## Progress Schemas (Hive Coordination)
 * - `SwarmStatusSchema` - Overall hive progress
 * - `AgentProgressSchema` - Individual agent status
 * - `SpawnedAgentSchema` - Spawned agent metadata
 *
 * ## Checkpoint Schemas (Recovery System)
 * - `SwarmBeadContextSchema` - Complete agent checkpoint state
 * - `RecoveryStateSchema` - Recovery state enum
 * - `DecompositionStrategySchema` - Strategy used for decomposition
 * - `ProgressMilestoneSchema` - Progress milestone tracking
 *
 * ## Discovery Schemas (Out-of-Scope Findings)
 * - `DiscoveryEntrySchema` - Core discovery entry
 * - `DiscoveryTypeSchema` - Discovery type categorization
 * - `DiscoveryUrgencySchema` - Urgency level for triage
 * - `DiscoveryStatusSchema` - Discovery lifecycle status
 * - `DiscoveryStatsSchema` - Queue statistics
 *
 * ## Specialization Schemas (Emergent Self-Organization)
 * - `TaskDimensionSchema` - Task categorization dimensions (file_type, strategy, complexity, domain)
 * - `SpecializationScoreSchema` - Agent competence on a dimension value
 * - `AgentSpecializationSchema` - Aggregate agent specialization profile
 *
 * ## Verification Schemas (Cross-Agent Consistency Protocols)
 * - `PreFlightResultSchema`, `PreFlightCheckSchema`, `PreFlightProtocolSchema` - Pre-flight health checks
 * - `GotchaSchema`, `ReportGotchaArgsSchema`, `QueryGotchasArgsSchema` - Shared gotcha broadcasting
 * - `StyleViolationSchema`, `StyleRuleSchema`, `StyleCheckResultSchema` - Style enforcement
 * - `VerificationGateSchema`, `VerificationStageSchema`, `VerificationStepSchema` - Multi-stage verification
 * - `EnforcementModeSchema`, `EnforcementDecisionSchema`, `EnforcementFailureSchema` - Progressive enforcement
 * - `ConsistencyMetricsSchema` - Protocol effectiveness metrics
 *
 * @module schemas
 */

// Common schemas
export {
  RequiredTimestampSchema,
  OptionalTimestampSchema,
  BeadIdSchema,
  SubtaskIdSchema,
  AnyBeadIdSchema,
} from "./common";

// Bead schemas
export {
  BeadStatusSchema,
  BeadTypeSchema,
  BeadDependencySchema,
  BeadSchema,
  BeadCreateArgsSchema,
  BeadUpdateArgsSchema,
  BeadCloseArgsSchema,
  BeadQueryArgsSchema,
  SubtaskSpecSchema,
  BeadTreeSchema,
  EpicCreateArgsSchema,
  EpicCreateResultSchema,
  type BeadStatus,
  type BeadType,
  type BeadDependency,
  type Bead,
  type BeadCreateArgs,
  type BeadUpdateArgs,
  type BeadCloseArgs,
  type BeadQueryArgs,
  type SubtaskSpec,
  type BeadTree,
  type EpicCreateArgs,
  type EpicCreateResult,
} from "./bead";

// Evaluation schemas
export {
  CriterionEvaluationSchema,
  WeightedCriterionEvaluationSchema,
  EvaluationSchema,
  WeightedEvaluationSchema,
  EvaluationRequestSchema,
  SwarmEvaluationResultSchema,
  ValidationResultSchema,
  DEFAULT_CRITERIA,
  type CriterionEvaluation,
  type WeightedCriterionEvaluation,
  type Evaluation,
  type WeightedEvaluation,
  type EvaluationRequest,
  type SwarmEvaluationResult,
  type ValidationResult,
  type DefaultCriterion,
} from "./evaluation";

// Task schemas
export {
  EffortLevelSchema,
  DependencyTypeSchema,
  DecomposedSubtaskSchema,
  SubtaskDependencySchema,
  TaskDecompositionSchema,
  DecomposeArgsSchema,
  SpawnedAgentSchema,
  SwarmSpawnResultSchema,
  AgentProgressSchema,
  SwarmStatusSchema,
  type EffortLevel,
  type DependencyType,
  type DecomposedSubtask,
  type SubtaskDependency,
  type TaskDecomposition,
  type DecomposeArgs,
  type SpawnedAgent,
  type SwarmSpawnResult,
  type AgentProgress,
  type SwarmStatus,
} from "./task";

// Mandate schemas
export {
  MandateContentTypeSchema,
  MandateStatusSchema,
  VoteTypeSchema,
  MandateEntrySchema,
  VoteSchema,
  MandateScoreSchema,
  CreateMandateArgsSchema,
  CastVoteArgsSchema,
  QueryMandatesArgsSchema,
  ScoreCalculationResultSchema,
  DEFAULT_MANDATE_DECAY_CONFIG,
  mandateSchemas,
  type MandateContentType,
  type MandateStatus,
  type VoteType,
  type MandateEntry,
  type Vote,
  type MandateScore,
  type MandateDecayConfig,
  type CreateMandateArgs,
  type CastVoteArgs,
  type QueryMandatesArgs,
  type ScoreCalculationResult,
} from "./mandate";

// Checkpoint schemas
export {
  RecoveryStateSchema,
  DecompositionStrategySchema,
  ProgressMilestoneSchema,
  SwarmBeadContextSchema,
  CheckpointCreateArgsSchema,
  CheckpointRecoverArgsSchema,
  CheckpointRecoveryResultSchema,
  type RecoveryState,
  type DecompositionStrategy,
  type ProgressMilestone,
  type SwarmBeadContext,
  type CheckpointCreateArgs,
  type CheckpointRecoverArgs,
  type CheckpointRecoveryResult,
} from "./checkpoint";

// Discovery schemas
export {
  DiscoveryTypeSchema,
  DiscoveryUrgencySchema,
  DiscoveryStatusSchema,
  DiscoveryEntrySchema,
  DiscoveryCreateArgsSchema,
  DiscoveryUpdateArgsSchema,
  DiscoveryQueryArgsSchema,
  DiscoveryStatsSchema,
  DiscoveryPromoteArgsSchema,
  DiscoveryPromoteResultSchema,
  type DiscoveryType,
  type DiscoveryUrgency,
  type DiscoveryStatus,
  type DiscoveryEntry,
  type DiscoveryCreateArgs,
  type DiscoveryUpdateArgs,
  type DiscoveryQueryArgs,
  type DiscoveryStats,
  type DiscoveryPromoteArgs,
  type DiscoveryPromoteResult,
} from "./discovery";

// Specialization schemas
export {
  TaskDimensionSchema,
  SpecializationScoreSchema,
  AgentSpecializationSchema,
  specializationSchemas,
  type TaskDimension,
  type SpecializationScore,
  type AgentSpecialization,
  type SpecialistQuery,
  type TaskDimensions,
} from "./specialization";

// Verification schemas
export {
  PreFlightResultSchema,
  PreFlightCheckSchema,
  PreFlightProtocolSchema,
  GotchaCategorySchema,
  GotchaSchema,
  ReportGotchaArgsSchema,
  QueryGotchasArgsSchema,
  StyleCategorySchema,
  StyleViolationSchema,
  FileContextSchema,
  StyleRuleSchema,
  CheckStyleArgsSchema,
  StyleCheckResultSchema,
  CheckResultSchema,
  VerificationContextSchema,
  VerificationCheckSchema,
  VerificationStageSchema,
  EnforcementModeSchema,
  VerificationGateSchema,
  VerificationStepSchema,
  VerificationGateResultSchema,
  EnforcementDecisionSchema,
  EnforcementFailureSchema,
  ConsistencyMetricsSchema,
  verificationSchemas,
  type PreFlightResult,
  type PreFlightCheck,
  type PreFlightProtocol,
  type GotchaCategory,
  type Gotcha,
  type ReportGotchaArgs,
  type QueryGotchasArgs,
  type StyleCategory,
  type StyleViolation,
  type FileContext,
  type StyleRule,
  type CheckStyleArgs,
  type StyleCheckResult,
  type CheckResult,
  type VerificationContext,
  type VerificationCheck,
  type VerificationStage,
  type EnforcementMode,
  type VerificationGate,
  type VerificationStep,
  type VerificationGateResult,
  type EnforcementDecision,
  type EnforcementFailure,
  type ConsistencyMetrics,
} from "./verification";
