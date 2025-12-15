/**
 * Config System - Layered Configuration Management
 * 
 * Provides utilities for managing global and project-level configuration files.
 * Supports versioned configs with automatic fallback from project to global scope.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Constants
// ============================================================================

/**
 * Read version from package.json
 */
function getPackageVersion(): string {
  const pkgPath = join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

export const CONFIG_VERSION = getPackageVersion();

// ============================================================================
// Types
// ============================================================================

export type ConfigLocation = "global" | "project" | "both";

export type ConfigType = 
  | "plugin"      // hive.ts
  | "command"     // hive.md
  | "planner"     // hive-planner.md
  | "worker";     // hive-worker.md

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the global config directory (~/.config/opencode/)
 */
export function getGlobalConfigDir(): string {
  return join(homedir(), ".config", "opencode");
}

/**
 * Get the project config directory (.opencode/)
 */
export function getProjectConfigDir(): string {
  return ".opencode";
}

/**
 * Resolve full path to a config file
 * 
 * @param location - 'global' or 'project'
 * @param configType - Type of config file
 * @returns Full absolute path to config file
 */
export function resolveConfigPath(
  location: Exclude<ConfigLocation, "both">,
  configType: ConfigType
): string {
  const baseDir = location === "global" 
    ? getGlobalConfigDir() 
    : getProjectConfigDir();

  switch (configType) {
    case "plugin":
      return join(baseDir, "plugin", "hive.ts");
    case "command":
      return join(baseDir, "command", "hive.md");
    case "planner":
      return join(baseDir, "agent", "hive-planner.md");
    case "worker":
      return join(baseDir, "agent", "hive-worker.md");
  }
}

/**
 * Check if a config file exists
 */
export function configExists(
  location: Exclude<ConfigLocation, "both">,
  configType: ConfigType
): boolean {
  const path = resolveConfigPath(location, configType);
  return existsSync(path);
}

/**
 * Write a config file to disk
 * Creates parent directories if needed
 */
export function writeConfig(
  location: Exclude<ConfigLocation, "both">,
  configType: ConfigType,
  content: string
): void {
  const path = resolveConfigPath(location, configType);
  const dir = dirname(path);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  writeFileSync(path, content, "utf-8");
}

/**
 * Read config with fallback: project first, then global
 * Returns null if neither exists
 */
export function readConfigWithFallback(configType: ConfigType): string | null {
  // Try project first
  if (configExists("project", configType)) {
    const path = resolveConfigPath("project", configType);
    return readFileSync(path, "utf-8");
  }
  
  // Fallback to global
  if (configExists("global", configType)) {
    const path = resolveConfigPath("global", configType);
    return readFileSync(path, "utf-8");
  }
  
  return null;
}

/**
 * Extract config version from file content
 * Looks for: # hive-config-version: X.Y.Z
 * Returns null if no version found
 */
export function getConfigVersion(filepath: string): string | null {
  if (!existsSync(filepath)) {
    return null;
  }
  
  const content = readFileSync(filepath, "utf-8");
  const match = content.match(/# hive-config-version: ([\d.]+)/);
  return match ? match[1] : null;
}
