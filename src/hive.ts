/**
 * Hive Module - High-level hive coordination
 *
 * This module re-exports from focused submodules for backward compatibility.
 * For new code, prefer importing from specific modules:
 * - hive-config.ts - Shared configuration (prevents circular deps)
 * - hive-strategies.ts - Strategy selection
 * - hive-decompose.ts - Task decomposition
 * - hive-prompts.ts - Prompt templates
 * - hive-orchestrate.ts - Status and completion
 *
 * @module hive
 */

// Re-export everything for backward compatibility
export * from "./hive-config";
export * from "./hive-strategies";
export * from "./hive-decompose";
export * from "./hive-prompts";
export * from "./hive-orchestrate";

// Import tools from each module
import { strategyTools } from "./hive-strategies";
import { decomposeTools } from "./hive-decompose";
import { promptTools } from "./hive-prompts";
import { orchestrateTools } from "./hive-orchestrate";
import { strikeTools } from "./hive-strikes";

/**
 * Combined hive tools for plugin registration.
 * Includes all tools from strategy, decompose, prompt, orchestrate, and strikes modules.
 */
export const hiveTools = {
  ...strategyTools,
  ...decomposeTools,
  ...promptTools,
  ...orchestrateTools,
  ...strikeTools,
};
