/**
 * OpenCode Hive Plugin
 *
 * Multi-agent coordination with beads issue tracking and Hive Mail.
 *
 * @module opencode-hive-plugin
 */
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";

import { beadsTools, setBeadsWorkingDirectory } from "./beads";
import {
  hiveMailTools,
  setHiveMailProjectDirectory,
  type HiveMailState,
} from "./hive-mail";
import { structuredTools } from "./structured";
import { hiveTools } from "./hive";
import { repoCrawlTools } from "./repo-crawl";
import { skillsTools, setSkillsProjectDirectory } from "./skills";
import { mandateTools } from "./mandates";
import {
  guardrailOutput,
  DEFAULT_GUARDRAIL_CONFIG,
  type GuardrailResult,
} from "./output-guardrails";

/**
 * OpenCode Hive Plugin
 *
 * Registers all coordination tools:
 * - beads:* - Type-safe beads issue tracker wrappers
 * - hive-mail:* - Multi-agent coordination with embedded event sourcing
 * - structured:* - Structured output parsing and validation
 * - hive:* - Hive orchestration and task decomposition
 * - repo-crawl:* - GitHub API tools for repository research
 * - skills:* - Agent skills discovery, activation, and execution
 * - mandate:* - Agent voting system for collaborative knowledge curation
 */
export const HivePlugin: Plugin = async (
  input: PluginInput,
): Promise<Hooks> => {
  const { $, directory } = input;

  setBeadsWorkingDirectory(directory);
  setSkillsProjectDirectory(directory);
  setHiveMailProjectDirectory(directory);

  return {
    tool: {
      ...beadsTools,
      ...hiveMailTools,
      ...structuredTools,
      ...hiveTools,
      ...repoCrawlTools,
      ...skillsTools,
      ...mandateTools,
    },

    event: async ({ event }) => {
      // Reserved for future session lifecycle hooks
    },

    "tool.execute.after": async (input, output) => {
      const toolName = input.tool;

      // Apply output guardrails to prevent context blowout
      if (output.output && typeof output.output === "string") {
        const guardrailResult = guardrailOutput(toolName, output.output);
        if (guardrailResult.truncated) {
          output.output = guardrailResult.output;
          console.log(
            `[hive-plugin] Guardrail truncated ${toolName}: ${guardrailResult.originalLength} → ${guardrailResult.truncatedLength} chars`,
          );
        }
      }

      // Auto-sync beads after closing
      if (toolName === "beads_close") {
        void $`bd sync`
          .quiet()
          .nothrow()
          .then(() => {
            console.log("[hive-plugin] Auto-synced beads after close");
          });
      }
    },
  };
};

export default HivePlugin;

// =============================================================================
// Re-exports
// =============================================================================

export * from "./schemas";
export * from "./beads";

export {
  hiveMailTools,
  setHiveMailProjectDirectory,
  getHiveMailProjectDirectory,
  clearSessionState,
  type HiveMailState,
} from "./hive-mail";

export { type MailSessionState } from "./streams/events";

export {
  structuredTools,
  extractJsonFromText,
  formatZodErrors,
  getSchemaByName,
} from "./structured";

export {
  hiveTools,
  HiveError,
  DecompositionError,
  formatSubtaskPrompt,
  formatSubtaskPromptV2,
  formatEvaluationPrompt,
  SUBTASK_PROMPT_V2,
  STRATEGIES,
  selectStrategy,
  formatStrategyGuidelines,
  type DecompositionStrategy,
  type StrategyDefinition,
} from "./hive";

export const allTools = {
  ...beadsTools,
  ...hiveMailTools,
  ...structuredTools,
  ...hiveTools,
  ...repoCrawlTools,
  ...skillsTools,
  ...mandateTools,
} as const;

export type CLIToolName = keyof typeof allTools;

export {
  createStorage,
  createStorageWithFallback,
  getStorage,
  setStorage,
  resetStorage,
  InMemoryStorage,
  SemanticMemoryStorage,
  isSemanticMemoryAvailable,
  DEFAULT_STORAGE_CONFIG,
  type LearningStorage,
  type StorageConfig,
  type StorageBackend,
  type StorageCollections,
} from "./storage";

export {
  checkTool,
  isToolAvailable,
  checkAllTools,
  getToolAvailability,
  withToolFallback,
  ifToolAvailable,
  warnMissingTool,
  requireTool,
  formatToolAvailability,
  resetToolCache,
  type ToolName,
  type ToolStatus,
  type ToolAvailability,
} from "./tool-availability";

export { repoCrawlTools, RepoCrawlError } from "./repo-crawl";

export {
  skillsTools,
  discoverSkills,
  getSkill,
  listSkills,
  parseFrontmatter,
  setSkillsProjectDirectory,
  invalidateSkillsCache,
  getSkillsContextForSwarm,
  findRelevantSkills,
  type Skill,
  type SkillMetadata,
  type SkillRef,
} from "./skills";

export { mandateTools, MandateError } from "./mandates";

export {
  createMandateStorage,
  getMandateStorage,
  setMandateStorage,
  resetMandateStorage,
  updateMandateStatus,
  updateAllMandateStatuses,
  InMemoryMandateStorage,
  SemanticMemoryMandateStorage,
  DEFAULT_MANDATE_STORAGE_CONFIG,
  type MandateStorage,
  type MandateStorageConfig,
  type MandateStorageBackend,
  type MandateStorageCollections,
} from "./mandate-storage";

export {
  evaluatePromotion,
  shouldPromote,
  formatPromotionResult,
  evaluateBatchPromotions,
  getStatusChanges,
  groupByTransition,
  type PromotionResult,
} from "./mandate-promotion";

export {
  guardrailOutput,
  truncateWithBoundaries,
  createMetrics,
  DEFAULT_GUARDRAIL_CONFIG,
  type GuardrailConfig,
  type GuardrailResult,
  type GuardrailMetrics,
} from "./output-guardrails";
