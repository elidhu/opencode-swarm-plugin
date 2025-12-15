/**
 * Config Command - Show layered configuration status
 * 
 * Displays all config file paths (global AND project), their status,
 * active configuration, skills directories, and version information.
 */

import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { 
  getGlobalConfigDir, 
  resolveConfigPath, 
  configExists,
  getConfigVersion,
  CONFIG_VERSION,
  type ConfigType 
} from "../config.js";
import { dim, yellow, cyan, green, red, orange, HONEYCOMB, BANNER, TAGLINE } from "../branding.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Types
// ============================================================================

type ConfigFileInfo = {
  type: ConfigType;
  desc: string;
  emoji: string;
};

type StatusInfo = {
  exists: boolean;
  version: string | null;
  isActive: boolean;
  outdated: boolean;
};

// ============================================================================
// Config File Definitions
// ============================================================================

const CONFIG_FILES: ConfigFileInfo[] = [
  { type: "plugin", desc: "Plugin loader", emoji: "🔌" },
  { type: "command", desc: "/hive command prompt", emoji: "📜" },
  { type: "planner", desc: "@hive-planner agent", emoji: "🤖" },
  { type: "worker", desc: "@hive-worker agent", emoji: "🐝" },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get status information for a config file at a specific location
 */
function getConfigStatus(
  location: "global" | "project",
  configType: ConfigType
): StatusInfo {
  const exists = configExists(location, configType);
  
  if (!exists) {
    return {
      exists: false,
      version: null,
      isActive: false,
      outdated: false,
    };
  }
  
  const path = resolveConfigPath(location, configType);
  const version = getConfigVersion(path);
  const outdated = version ? version !== CONFIG_VERSION : true;
  
  // Project config is active if it exists, otherwise global is active
  const isActive = location === "project" 
    ? exists 
    : exists && !configExists("project", configType);
  
  return {
    exists,
    version,
    isActive,
    outdated,
  };
}

/**
 * Format status indicator with color
 */
function formatStatus(status: StatusInfo): string {
  if (!status.exists) {
    return red("✗ missing");
  }
  
  if (status.outdated) {
    return orange("⚠ outdated");
  }
  
  return green("✓ exists");
}

/**
 * Get skills from a directory
 */
function getSkills(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ============================================================================
// Main Command
// ============================================================================

/**
 * Display layered configuration status
 */
export function config(): void {
  console.log(yellow(HONEYCOMB));
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + CONFIG_VERSION));
  console.log();
  
  // ========================================================================
  // Config Files
  // ========================================================================
  
  console.log(cyan("Configuration Files:"));
  console.log();
  console.log(dim("  Layered config: project overrides global"));
  console.log();
  
  for (const { type, desc, emoji } of CONFIG_FILES) {
    const globalStatus = getConfigStatus("global", type);
    const projectStatus = getConfigStatus("project", type);
    
    console.log(`  ${emoji} ${desc}`);
    console.log();
    
    // Global config
    const globalPath = resolveConfigPath("global", type);
    const globalIndicator = formatStatus(globalStatus);
    const globalActive = globalStatus.isActive ? cyan(" (active)") : "";
    const globalVersion = globalStatus.version 
      ? dim(` [v${globalStatus.version}]`) 
      : "";
    
    console.log(`     ${globalIndicator}${globalActive}${globalVersion}`);
    console.log(`     ${dim("global: " + globalPath)}`);
    console.log();
    
    // Project config
    const projectPath = resolveConfigPath("project", type);
    const projectIndicator = formatStatus(projectStatus);
    const projectActive = projectStatus.isActive ? cyan(" (active)") : "";
    const projectVersion = projectStatus.version 
      ? dim(` [v${projectStatus.version}]`) 
      : "";
    
    console.log(`     ${projectIndicator}${projectActive}${projectVersion}`);
    console.log(`     ${dim("project: " + projectPath)}`);
    console.log();
  }
  
  // ========================================================================
  // Skills Directories
  // ========================================================================
  
  console.log(cyan("Skills Directories:"));
  console.log();
  
  // Global skills
  const globalSkillsPath = join(getGlobalConfigDir(), "skills");
  const globalSkills = getSkills(globalSkillsPath);
  const globalSkillsExists = existsSync(globalSkillsPath);
  const globalSkillsStatus = globalSkillsExists ? green("✓") : red("✗");
  
  console.log(`  📚 Global skills`);
  console.log(`     ${globalSkillsStatus} ${dim(globalSkillsPath)}`);
  
  if (globalSkills.length > 0) {
    console.log(`     ${dim(`Found ${globalSkills.length}: ${globalSkills.join(", ")}`)}`);
  }
  console.log();
  
  // Project skills (check multiple possible locations)
  const projectSkillsPaths = [
    ".opencode/skills/",
    ".claude/skills/",
    "skills/",
  ];
  
  console.log(`  📁 Project skills ${dim("(checked in order)")}`);
  
  for (const relPath of projectSkillsPaths) {
    const skills = getSkills(relPath);
    const exists = existsSync(relPath);
    const status = exists ? green("✓") : dim("○");
    
    console.log(`     ${status} ${dim(relPath)}`);
    
    if (skills.length > 0) {
      console.log(`        ${dim(`${skills.length} skill(s): ${skills.join(", ")}`)}`);
    }
  }
  console.log();
  
  // Bundled skills
  const bundledSkillsPath = join(__dirname, "..", "..", "..", "global-skills");
  const bundledSkills = getSkills(bundledSkillsPath);
  
  if (bundledSkills.length > 0) {
    console.log(`  🎁 Bundled skills ${dim("(always available)")}`);
    console.log(`     ${dim(bundledSkills.join(", "))}`);
    console.log();
  }
  
  // ========================================================================
  // Version Summary
  // ========================================================================
  
  console.log(cyan("Version Information:"));
  console.log();
  console.log(`  Current plugin version: ${green(CONFIG_VERSION)}`);
  console.log();
  
  // Check for outdated configs
  const outdatedConfigs: string[] = [];
  
  for (const { type, desc } of CONFIG_FILES) {
    const globalStatus = getConfigStatus("global", type);
    const projectStatus = getConfigStatus("project", type);
    
    if (globalStatus.outdated) {
      outdatedConfigs.push(`global ${desc} (${globalStatus.version || "no version"})`);
    }
    
    if (projectStatus.outdated) {
      outdatedConfigs.push(`project ${desc} (${projectStatus.version || "no version"})`);
    }
  }
  
  if (outdatedConfigs.length > 0) {
    console.log(orange("  ⚠ Outdated configurations detected:"));
    for (const config of outdatedConfigs) {
      console.log(orange(`     • ${config}`));
    }
    console.log();
    console.log(dim("  Run 'hive sync' to update templates to latest version"));
    console.log();
  } else {
    console.log(green("  ✓ All configurations are up to date"));
    console.log();
  }
  
  // ========================================================================
  // Footer
  // ========================================================================
  
  console.log(dim("Edit these files to customize hive behavior."));
  console.log(dim("Run 'hive setup' to regenerate defaults."));
  console.log(dim("Run 'hive doctor' for dependency health check."));
  console.log();
}
