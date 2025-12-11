/**
 * Task decomposition schemas
 *
 * These schemas define the structure for breaking down tasks
 * into parallelizable subtasks for swarm execution.
 */
import { z } from "zod";

/**
 * Effort estimation levels
 */
export const EffortLevelSchema = z.enum([
  "trivial", // < 5 min
  "small", // 5-30 min
  "medium", // 30 min - 2 hours
  "large", // 2+ hours
]);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

/**
 * Dependency type between subtasks
 */
export const DependencyTypeSchema = z.enum([
  "blocks", // Must complete before dependent can start
  "requires", // Needs output from another task
  "related", // Informational relationship
]);
export type DependencyType = z.infer<typeof DependencyTypeSchema>;

/**
 * Subtask in a decomposition
 */
export const DecomposedSubtaskSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  files: z.array(z.string()), // File paths this subtask will modify
  estimated_effort: EffortLevelSchema,
  risks: z.array(z.string()).optional().default([]),
});
export type DecomposedSubtask = z.infer<typeof DecomposedSubtaskSchema>;

/**
 * Dependency between subtasks
 */
export const SubtaskDependencySchema = z.object({
  from: z.number().int().min(0), // Subtask index
  to: z.number().int().min(0), // Subtask index
  type: DependencyTypeSchema,
});
export type SubtaskDependency = z.infer<typeof SubtaskDependencySchema>;

/**
 * Full task decomposition result
 *
 * Returned by the decomposition agent, validated before spawning.
 */
export const TaskDecompositionSchema = z.object({
  task: z.string(), // Original task description
  reasoning: z.string().optional(), // Why this decomposition
  subtasks: z.array(DecomposedSubtaskSchema).min(1),
  dependencies: z.array(SubtaskDependencySchema).optional().default([]),
  shared_context: z.string().optional(), // Context to pass to all agents
});
export type TaskDecomposition = z.infer<typeof TaskDecompositionSchema>;

/**
 * Arguments for task decomposition
 */
export const DecomposeArgsSchema = z.object({
  task: z.string().min(1),
  max_subtasks: z.number().int().min(1).default(5),
  context: z.string().optional(),
});
export type DecomposeArgs = z.infer<typeof DecomposeArgsSchema>;

/**
 * Spawn result for a single agent
 */
export const SpawnedAgentSchema = z.object({
  bead_id: z.string(),
  agent_name: z.string(), // Agent Mail name (e.g., "BlueLake")
  task_id: z.string().optional(), // OpenCode task ID
  status: z.enum(["pending", "running", "completed", "failed"]),
  files: z.array(z.string()), // Reserved files
  reservation_ids: z.array(z.number()).optional(), // Agent Mail reservation IDs
});
export type SpawnedAgent = z.infer<typeof SpawnedAgentSchema>;

/**
 * Result of spawning a swarm
 */
export const SwarmSpawnResultSchema = z.object({
  epic_id: z.string(),
  coordinator_name: z.string(), // Agent Mail name of coordinator
  thread_id: z.string(), // Agent Mail thread for this swarm
  agents: z.array(SpawnedAgentSchema),
  started_at: z.string().datetime({ offset: true }), // ISO-8601 with timezone
});
export type SwarmSpawnResult = z.infer<typeof SwarmSpawnResultSchema>;

/**
 * Progress update from an agent
 */
export const AgentProgressSchema = z.object({
  bead_id: z.string(),
  agent_name: z.string(),
  status: z.enum(["in_progress", "blocked", "completed", "failed"]),
  progress_percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  files_touched: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  timestamp: z.string().datetime({ offset: true }), // ISO-8601 with timezone
});
export type AgentProgress = z.infer<typeof AgentProgressSchema>;

/**
 * Swarm status summary
 */
export const SwarmStatusSchema = z.object({
  epic_id: z.string(),
  total_agents: z.number().int().min(0),
  running: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  blocked: z.number().int().min(0),
  agents: z.array(SpawnedAgentSchema),
  last_update: z.string().datetime({ offset: true }), // ISO-8601 with timezone
});
export type SwarmStatus = z.infer<typeof SwarmStatusSchema>;
