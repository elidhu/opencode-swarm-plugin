/**
 * Sync Command - Update configuration files to match bundled templates
 * 
 * Compares installed config files with bundled templates and offers
 * interactive updates with backup support.
 */

import * as p from "@clack/prompts";
import { readFileSync, copyFileSync } from "fs";
import {
  resolveConfigPath,
  configExists,
  getConfigVersion,
  writeConfig,
  CONFIG_VERSION,
  type ConfigType,
} from "../config.js";
import {
  getHiveCommand,
  getPlannerAgent,
  getWorkerAgent,
  getPluginWrapper,
} from "../templates.js";

// ============================================================================
// Types
// ============================================================================

interface SyncOptions {
  force?: boolean;
  dryRun?: boolean;
  location?: "global" | "project";
}

interface FileStatus {
  configType: ConfigType;
  location: "global" | "project";
  path: string;
  exists: boolean;
  currentVersion: string | null;
  outdated: boolean;
  currentContent: string | null;
  bundledContent: string;
}

interface SyncResult {
  updated: number;
  skipped: number;
  backedUp: number;
  errors: string[];
}

// ============================================================================
// Template Generation
// ============================================================================

/**
 * Extract model from existing config content
 * Looks for "model: xxx" in YAML frontmatter
 */
function extractModel(content: string | null): string | null {
  if (!content) return null;
  
  const match = content.match(/^model:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Get bundled template content for a config type
 * Preserves user's model choice from existing config
 */
function getBundledContent(configType: ConfigType, existingContent: string | null = null): string {
  switch (configType) {
    case "plugin":
      return getPluginWrapper();
    case "command":
      return getHiveCommand();
    case "planner": {
      const model = extractModel(existingContent) ?? "anthropic/claude-sonnet-4-5";
      return getPlannerAgent(model);
    }
    case "worker": {
      const model = extractModel(existingContent) ?? "anthropic/claude-haiku-4-5";
      return getWorkerAgent(model);
    }
  }
}

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generate simple colorized diff between two strings
 */
function generateDiff(
  oldContent: string,
  newContent: string,
  maxLines: number = 20
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const output: string[] = [];
  output.push(`\x1b[36m@@ Changes @@\x1b[0m`);

  const maxLen = Math.max(oldLines.length, newLines.length);
  let changesShown = 0;

  for (let i = 0; i < maxLen && changesShown < maxLines; i++) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[i] ?? "";

    if (oldLine !== newLine) {
      if (oldLine) {
        output.push(`\x1b[31m- ${oldLine}\x1b[0m`);
        changesShown++;
      }
      if (newLine) {
        output.push(`\x1b[32m+ ${newLine}\x1b[0m`);
        changesShown++;
      }
    }
  }

  if (changesShown >= maxLines) {
    output.push(`\x1b[2m... (diff truncated)\x1b[0m`);
  }

  return output.join("\n");
}

// ============================================================================
// File Status
// ============================================================================

/**
 * Get status of all config files
 */
function getFileStatuses(options: SyncOptions): FileStatus[] {
  const statuses: FileStatus[] = [];
  const configTypes: ConfigType[] = ["plugin", "command", "planner", "worker"];
  const locations: Array<"global" | "project"> = options.location 
    ? [options.location] 
    : ["global", "project"];

  for (const location of locations) {
    for (const configType of configTypes) {
      const exists = configExists(location, configType);
      const path = resolveConfigPath(location, configType);
      
      let currentVersion: string | null = null;
      let currentContent: string | null = null;
      let outdated = false;

      if (exists) {
        currentVersion = getConfigVersion(path);
        currentContent = readFileSync(path, "utf-8");
        // Outdated if version differs or no version header
        outdated = currentVersion !== CONFIG_VERSION;
      }

      // Generate bundled content, preserving user's model choice if exists
      const bundledContent = getBundledContent(configType, currentContent);

      statuses.push({
        configType,
        location,
        path,
        exists,
        currentVersion,
        outdated,
        currentContent,
        bundledContent,
      });
    }
  }

  return statuses;
}

// ============================================================================
// File Operations
// ============================================================================

function backupFile(filePath: string): boolean {
  try {
    copyFileSync(filePath, `${filePath}.bak`);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Interactive Prompts
// ============================================================================

async function promptForUpdate(
  status: FileStatus,
  showDiff: boolean
): Promise<"yes" | "no" | "all" | "skip"> {
  if (showDiff && status.currentContent) {
    console.log("\n" + generateDiff(status.currentContent, status.bundledContent));
  }

  const action = await p.select({
    message: `Update ${status.location}/${status.configType}? (${status.currentVersion || "no version"} → ${CONFIG_VERSION})`,
    options: [
      { value: "yes", label: "Yes", hint: "Update this file" },
      { value: "no", label: "No", hint: "Skip this file" },
      { value: "all", label: "All", hint: "Update all remaining files" },
      { value: "skip", label: "Skip All", hint: "Skip all remaining files" },
    ],
  });

  if (p.isCancel(action)) {
    return "skip";
  }

  return action as "yes" | "no" | "all" | "skip";
}

// ============================================================================
// Main Command
// ============================================================================

export async function syncCommand(options: SyncOptions = {}): Promise<void> {
  const isDryRun = options.dryRun ?? false;
  const isForce = options.force ?? false;

  p.intro(`hive sync${isDryRun ? " --dry-run" : ""}${isForce ? " --force" : ""}`);

  if (isDryRun) {
    p.log.info("Dry run mode - no files will be modified");
  }

  // Get file statuses
  const spinner = p.spinner();
  spinner.start("Checking configuration files...");

  const statuses = getFileStatuses(options);
  const outdated = statuses.filter((s) => s.exists && s.outdated);

  spinner.stop("Configuration files checked");

  if (outdated.length === 0) {
    p.log.success("All configuration files are up to date!");
    p.outro("No updates needed");
    return;
  }

  p.log.info(`Found ${outdated.length} outdated file(s)`);

  // Dry run - just show what would be updated
  if (isDryRun) {
    for (const status of outdated) {
      console.log(`\n${status.location}/${status.configType}:`);
      console.log(`  Current: ${status.currentVersion || "no version"}`);
      console.log(`  Bundled: ${CONFIG_VERSION}`);
      console.log(`  Path: ${status.path}`);

      if (status.currentContent) {
        console.log("\nDiff:");
        console.log(generateDiff(status.currentContent, status.bundledContent));
      }
    }

    p.outro(`${outdated.length} file(s) would be updated`);
    return;
  }

  // Interactive or force mode
  const result: SyncResult = {
    updated: 0,
    skipped: 0,
    backedUp: 0,
    errors: [],
  };

  let updateAll = isForce;

  for (const status of outdated) {
    let shouldUpdate = updateAll;

    if (!shouldUpdate) {
      const action = await promptForUpdate(status, true);

      if (action === "skip") {
        result.skipped += outdated.length - result.updated - result.skipped;
        break;
      } else if (action === "all") {
        updateAll = true;
        shouldUpdate = true;
      } else if (action === "yes") {
        shouldUpdate = true;
      }
    }

    if (shouldUpdate) {
      // Backup existing file
      if (status.exists) {
        const backed = backupFile(status.path);
        if (backed) {
          result.backedUp++;
          p.log.success(`Backed up: ${status.path}.bak`);
        } else {
          result.errors.push(`Failed to backup ${status.path}`);
          p.log.error(`Failed to backup ${status.path}`);
          continue;
        }
      }

      // Update file using writeConfig
      try {
        writeConfig(status.location, status.configType, status.bundledContent);
        result.updated++;
        p.log.success(`Updated: ${status.location}/${status.configType}`);
      } catch (error) {
        result.errors.push(`Failed to update ${status.path}`);
        p.log.error(`Failed to update ${status.path}`);
      }
    } else {
      result.skipped++;
      p.log.info(`Skipped: ${status.location}/${status.configType}`);
    }
  }

  // Summary
  console.log();
  p.note(
    [
      `Updated: ${result.updated}`,
      `Skipped: ${result.skipped}`,
      `Backed up: ${result.backedUp}`,
      result.errors.length > 0 ? `Errors: ${result.errors.length}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    "Sync Summary"
  );

  p.outro(
    result.errors.length > 0
      ? "Sync completed with errors"
      : "Sync completed successfully"
  );
}

/**
 * CLI entry point with argument parsing
 */
export async function main(args: string[] = []): Promise<void> {
  const options: SyncOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--dry-run" || arg === "-d") {
      options.dryRun = true;
    } else if (arg === "--location" || arg === "-l") {
      const loc = args[++i];
      if (loc === "global" || loc === "project") {
        options.location = loc;
      } else {
        console.error(`Invalid location: ${loc}. Use 'global' or 'project'`);
        process.exit(1);
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  await syncCommand(options);
}

function printHelp(): void {
  console.log(`
Usage: hive sync [options]

Update configuration files to match bundled templates.

Options:
  --force, -f           Skip prompts and update all outdated files
  --dry-run, -d         Preview changes without updating files
  --location, -l <loc>  Sync specific location only ('global' or 'project')
  --help, -h            Show this help message

Examples:
  hive sync                      Interactive sync with prompts
  hive sync --force              Update all without prompts
  hive sync --dry-run            Preview what would be updated
  hive sync --location global    Sync only global configs
`);
}
