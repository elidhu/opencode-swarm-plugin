/**
 * Doctor Command - Comprehensive health check and diagnostics
 * 
 * Checks all dependencies, config version consistency, detects mismatches,
 * suggests upgrades, and identifies orphaned/stale configs.
 */

import * as p from "@clack/prompts";
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
import { checkCommand } from "../utils.js";
import { DEPENDENCIES, type Dependency } from "../constants.js";
import { dim, yellow, cyan, green } from "../branding.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Types
// ============================================================================

interface CheckResult {
  dep: Dependency;
  available: boolean;
  version?: string;
}

type ConfigFileType = {
  type: ConfigType;
  desc: string;
};

interface VersionCheck {
  location: "global" | "project";
  type: ConfigType;
  desc: string;
  exists: boolean;
  version: string | null;
  outdated: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const CONFIG_FILES: ConfigFileType[] = [
  { type: "plugin", desc: "Plugin loader" },
  { type: "command", desc: "/hive command" },
  { type: "planner", desc: "@hive-planner agent" },
  { type: "worker", desc: "@hive-worker agent" },
];

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check all dependencies
 */
async function checkAllDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const dep of DEPENDENCIES) {
    const { available, version } = await checkCommand(dep.command, dep.checkArgs);
    results.push({ dep, available, version });
  }
  return results;
}

/**
 * Get fix command for a dependency
 */
function getFixCommand(dep: Dependency): string | null {
  switch (dep.name) {
    case "OpenCode":
      return "brew install sst/tap/opencode";
    case "Beads":
      return "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash";
    default:
      return dep.installType !== "manual" ? dep.install : null;
  }
}

/**
 * Check version consistency for all config files
 */
function checkVersionConsistency(): VersionCheck[] {
  const checks: VersionCheck[] = [];
  
  for (const { type, desc } of CONFIG_FILES) {
    // Check global
    const globalExists = configExists("global", type);
    if (globalExists) {
      const globalPath = resolveConfigPath("global", type);
      const globalVersion = getConfigVersion(globalPath);
      const outdated = globalVersion ? globalVersion !== CONFIG_VERSION : true;
      
      checks.push({
        location: "global",
        type,
        desc,
        exists: true,
        version: globalVersion,
        outdated,
      });
    } else {
      checks.push({
        location: "global",
        type,
        desc,
        exists: false,
        version: null,
        outdated: false,
      });
    }
    
    // Check project
    const projectExists = configExists("project", type);
    if (projectExists) {
      const projectPath = resolveConfigPath("project", type);
      const projectVersion = getConfigVersion(projectPath);
      const outdated = projectVersion ? projectVersion !== CONFIG_VERSION : true;
      
      checks.push({
        location: "project",
        type,
        desc,
        exists: true,
        version: projectVersion,
        outdated,
      });
    } else {
      checks.push({
        location: "project",
        type,
        desc,
        exists: false,
        version: null,
        outdated: false,
      });
    }
  }
  
  return checks;
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
 * Run comprehensive health check
 */
export async function doctor(): Promise<void> {
  p.intro(cyan("hive doctor") + dim(" v" + CONFIG_VERSION));
  
  // ========================================================================
  // Check Project Initialization
  // ========================================================================
  
  const isInitialized = existsSync(".beads");
  
  if (!isInitialized) {
    p.log.warn("This is not an initialized hive project");
    p.note(
      "Initialize this project with:\n" +
      "  hive init\n\n" +
      "This will set up beads for task tracking and optionally\n" +
      "create project-local hive configuration.",
      "Not Initialized"
    );
    p.log.step(""); // Blank line for spacing
  }
  
  // ========================================================================
  // Check Dependencies
  // ========================================================================
  
  const s = p.spinner();
  s.start("Checking dependencies...");
  
  const results = await checkAllDependencies();
  
  s.stop("Dependencies");
  
  for (const { dep, available, version } of results) {
    if (available) {
      p.log.success(dep.name + (version ? " v" + version : ""));
    } else {
      p.log.error(dep.name + " - not found");
      const fixCmd = getFixCommand(dep);
      if (fixCmd) p.log.message(dim("   └─ Fix: " + fixCmd));
    }
  }
  
  const missing = results.filter((r) => !r.available);
  
  // ========================================================================
  // Check Config Versions (only for initialized projects)
  // ========================================================================
  
  let versionChecks: VersionCheck[] = [];
  let existingChecks: VersionCheck[] = [];
  let outdatedChecks: VersionCheck[] = [];
  let missingChecks: VersionCheck[] = [];
  
  if (isInitialized) {
    versionChecks = checkVersionConsistency();
    existingChecks = versionChecks.filter((c) => c.exists);
    outdatedChecks = existingChecks.filter((c) => c.outdated);
    missingChecks = versionChecks.filter((c) => !c.exists);
    
    // Show configs in compact table format
    if (existingChecks.length > 0) {
      p.log.step("Configuration:");
      for (const { type, desc } of CONFIG_FILES) {
        const globalCheck = versionChecks.find((c) => c.type === type && c.location === "global");
        const projectCheck = versionChecks.find((c) => c.type === type && c.location === "project");
        
        if (globalCheck?.exists || projectCheck?.exists) {
          const globalStr = globalCheck?.exists 
            ? `${globalCheck.outdated ? "⚠" : "✓"} global ${dim(`(${globalCheck.version || "?"})`)}` 
            : "";
          const projectStr = projectCheck?.exists 
            ? `${projectCheck.outdated ? "⚠" : "✓"} project ${dim(`(${projectCheck.version || "?"})`)}` 
            : "";
          const parts = [globalStr, projectStr].filter(Boolean).join("  ");
          console.log(`  ${yellow(desc)}: ${parts}`);
        }
      }
    }
    
    if (outdatedChecks.length > 0) {
      p.log.warn(`${outdatedChecks.length} outdated config(s) - run 'hive sync' to update`);
    } else if (existingChecks.length > 0) {
      p.log.success("All configs up to date");
    }
    
    const missingGlobal = missingChecks.filter((c) => c.location === "global");
    if (missingGlobal.length > 0) {
      console.log(dim(`  Note: ${missingGlobal.length} global config(s) missing. Run 'hive setup' to create.`));
    }
    
    // ========================================================================
    // Check Version Mismatches
    // ========================================================================
    
    const mismatches: string[] = [];
    
    for (const { type, desc } of CONFIG_FILES) {
      const globalCheck = versionChecks.find(
        (c) => c.type === type && c.location === "global" && c.exists
      );
      const projectCheck = versionChecks.find(
        (c) => c.type === type && c.location === "project" && c.exists
      );
      
      if (globalCheck && projectCheck) {
        if (globalCheck.version !== projectCheck.version) {
          mismatches.push(
            `${desc}: global (${globalCheck.version || "none"}) ≠ project (${projectCheck.version || "none"})`
          );
        }
      }
    }
    
    if (mismatches.length > 0) {
      p.log.step("Version mismatches detected:");
      for (const mismatch of mismatches) {
        p.log.warn(mismatch);
      }
      p.log.message(
        dim("   └─ Consider running 'hive sync' to align versions")
      );
    }
    
    // ========================================================================
    // Check Skills (compact)
    // ========================================================================
    
    p.log.step("Skills:");
    const configDir = getGlobalConfigDir();
    const globalSkillsPath = join(configDir, "skills");
    const bundledSkillsPath = join(__dirname, "..", "..", "..", "global-skills");
    
    const globalSkills = existsSync(globalSkillsPath) ? getSkills(globalSkillsPath) : [];
    const bundledSkills = existsSync(bundledSkillsPath) ? getSkills(bundledSkillsPath) : [];
    
    if (globalSkills.length > 0) {
      console.log(`  ${green("✓")} Global (${globalSkills.length}): ${globalSkills.join(", ")}`);
    } else {
      console.log(`  ${dim("○")} Global: none ${dim("(run 'hive setup' to create)")}`);
    }
    
    if (bundledSkills.length > 0) {
      console.log(`  ${green("✓")} Bundled (${bundledSkills.length}): ${bundledSkills.join(", ")}`);
    }
    
    // ========================================================================
    // Check for Orphaned Configs
    // ========================================================================
    
    // Check for stale project configs in non-git directories
    const projectConfigExists = configExists("project", "plugin") || 
                                 configExists("project", "command") ||
                                 configExists("project", "planner") ||
                                 configExists("project", "worker");
    
    if (projectConfigExists && !existsSync(".git")) {
      p.log.warn("Project config files found but no .git directory");
      p.log.message(
        dim("   └─ Project configs are meant for git repositories")
      );
    }
  }
  
  // ========================================================================
  // Summary
  // ========================================================================
  
  if (missing.length > 0) {
    p.outro(
      yellow(
        `⚠ Missing ${missing.length} dependencies. Run 'hive setup' to install.`
      )
    );
    process.exit(1);
  } else if (!isInitialized) {
    p.outro(
      yellow("⚠ Project not initialized. Run 'hive init' to get started.")
    );
  } else if (outdatedChecks.length > 0) {
    p.outro(
      cyan("✓ All dependencies installed. ") + 
      dim(`${outdatedChecks.length} outdated config(s)`)
    );
  } else {
    p.outro(cyan("✓ Everything looks good! Hive is ready to fly. 🐝"));
  }
}
