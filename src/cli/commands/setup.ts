/**
 * Setup Command - Interactive Installer with Location-Aware Configuration
 * 
 * Installs dependencies and creates hive configuration files.
 * Supports both global (~/.config/opencode/) and project-local (.opencode/) installation.
 */

import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  resolveConfigPath,
  configExists,
  writeConfig,
  CONFIG_VERSION,
  type ConfigLocation,
  type ConfigType,
} from "../config.js";
import {
  getHiveCommand,
  getPlannerAgent,
  getWorkerAgent,
  getPluginWrapper,
} from "../templates.js";
import { checkCommand, runInstall } from "../utils.js";
import {
  DEPENDENCIES,
  COORDINATOR_MODELS,
  WORKER_MODELS,
  type Dependency,
} from "../constants.js";

// ============================================================================
// Types
// ============================================================================

interface CheckResult {
  dep: Dependency;
  available: boolean;
  version?: string;
}

// ============================================================================
// Utilities
// ============================================================================

async function checkAllDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const dep of DEPENDENCIES) {
    const { available, version } = await checkCommand(dep.command, dep.checkArgs);
    results.push({ dep, available, version });
  }
  return results;
}

// ============================================================================
// Location Selection
// ============================================================================

async function promptLocation(): Promise<ConfigLocation | symbol> {
  return await p.select({
    message: "Where should hive be installed?",
    options: [
      {
        value: "global",
        label: "Global (~/.config/opencode/)",
        hint: "Available in all projects",
      },
      {
        value: "project",
        label: "Project (.opencode/)",
        hint: "Only in this project (team collaboration)",
      },
      {
        value: "both",
        label: "Both",
        hint: "Global + project override",
      },
    ],
    initialValue: "global",
  });
}

// ============================================================================
// Configuration Writing
// ============================================================================

interface WriteConfigOptions {
  location: ConfigLocation;
  coordinatorModel: string;
  workerModel: string;
}

function writeConfigs(options: WriteConfigOptions): string[] {
  const { location, coordinatorModel, workerModel } = options;
  const created: string[] = [];

  const locations: Array<Exclude<ConfigLocation, "both">> = 
    location === "both" ? ["global", "project"] : [location];

  for (const loc of locations) {
    // Write plugin wrapper
    writeConfig(loc, "plugin", getPluginWrapper());
    created.push(resolveConfigPath(loc, "plugin"));

    // Write command
    writeConfig(loc, "command", getHiveCommand());
    created.push(resolveConfigPath(loc, "command"));

    // Write planner agent
    writeConfig(loc, "planner", getPlannerAgent(coordinatorModel));
    created.push(resolveConfigPath(loc, "planner"));

    // Write worker agent
    writeConfig(loc, "worker", getWorkerAgent(workerModel));
    created.push(resolveConfigPath(loc, "worker"));
  }

  return created;
}

// ============================================================================
// Existing Config Detection
// ============================================================================

function detectExistingConfigs(): string[] {
  const configTypes: ConfigType[] = ["plugin", "command", "planner", "worker"];
  const existing: string[] = [];

  for (const type of configTypes) {
    if (configExists("global", type)) {
      existing.push(resolveConfigPath("global", type));
    }
    if (configExists("project", type)) {
      existing.push(resolveConfigPath("project", type));
    }
  }

  return existing;
}

async function handleExistingConfig(): Promise<"skip" | "models" | "reinstall" | symbol> {
  p.log.success("Hive is already configured!");
  
  const existing = detectExistingConfigs();
  p.log.message(`  Found ${existing.length} config files`);

  return await p.select({
    message: "What would you like to do?",
    options: [
      { value: "skip", label: "Keep existing config", hint: "Exit without changes" },
      { value: "models", label: "Update agent models", hint: "Keep customizations, just change models" },
      { value: "reinstall", label: "Reinstall everything", hint: "Check deps and regenerate all config files" },
    ],
  });
}

async function updateModels(): Promise<void> {
  const coordinatorModel = await p.select({
    message: "Select coordinator model:",
    options: COORDINATOR_MODELS,
    initialValue: "anthropic/claude-sonnet-4-5",
  });

  if (p.isCancel(coordinatorModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const workerModel = await p.select({
    message: "Select worker model:",
    options: WORKER_MODELS,
    initialValue: "anthropic/claude-haiku-4-5",
  });

  if (p.isCancel(workerModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Update planner agent model
  const plannerPath = resolveConfigPath("global", "planner");
  if (existsSync(plannerPath)) {
    const content = readFileSync(plannerPath, "utf-8");
    const updated = content.replace(/^model: .+$/m, `model: ${coordinatorModel}`);
    writeFileSync(plannerPath, updated);
    p.log.success(`Planner: ${coordinatorModel}`);
  }

  // Update worker agent model
  const workerPath = resolveConfigPath("global", "worker");
  if (existsSync(workerPath)) {
    const content = readFileSync(workerPath, "utf-8");
    const updated = content.replace(/^model: .+$/m, `model: ${workerModel}`);
    writeFileSync(workerPath, updated);
    p.log.success(`Worker: ${workerModel}`);
  }

  p.outro("Models updated!");
}

// ============================================================================
// Setup Command
// ============================================================================

export async function setup() {
  p.intro(`hive setup v${CONFIG_VERSION}`);

  // Check for existing config
  const existing = detectExistingConfigs();
  if (existing.length > 0) {
    const action = await handleExistingConfig();

    if (p.isCancel(action) || action === "skip") {
      p.outro("Config unchanged. Run 'hive config' to see file locations.");
      return;
    }

    if (action === "models") {
      await updateModels();
      return;
    }

    // action === "reinstall" continues below
  }

  // Check dependencies
  const s = p.spinner();
  s.start("Checking dependencies...");

  const results = await checkAllDependencies();
  s.stop("Dependencies checked");

  const missing = results.filter((r) => !r.available);

  // Show dependency status
  for (const { dep, available } of results) {
    if (available) {
      p.log.success(dep.name);
    } else {
      p.log.error(`${dep.name} - not found`);
    }
  }

  // Install missing dependencies
  if (missing.length > 0) {
    p.log.step(`Missing ${missing.length} dependencies`);

    for (const { dep } of missing) {
      const shouldInstall = await p.confirm({
        message: `Install ${dep.name}? (${dep.description})`,
        initialValue: true,
      });

      if (p.isCancel(shouldInstall)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (shouldInstall) {
        const installSpinner = p.spinner();
        installSpinner.start(`Installing ${dep.name}...`);

        const success = await runInstall(dep.install);

        if (success) {
          installSpinner.stop(`${dep.name} installed`);
        } else {
          installSpinner.stop(`Failed to install ${dep.name}`);
          p.log.error(`Manual install: ${dep.install}`);
        }
      } else {
        p.log.warn(`Skipping ${dep.name} - hive may not work correctly`);
      }
    }
  }

  // Prompt for location
  p.log.step("Configure hive agents...");

  const location = await promptLocation();
  if (p.isCancel(location)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Select models
  const coordinatorModel = await p.select({
    message: "Select coordinator model:",
    options: COORDINATOR_MODELS,
    initialValue: "anthropic/claude-sonnet-4-5",
  });

  if (p.isCancel(coordinatorModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const workerModel = await p.select({
    message: "Select worker model:",
    options: WORKER_MODELS,
    initialValue: "anthropic/claude-haiku-4-5",
  });

  if (p.isCancel(workerModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Write configuration files
  p.log.step("Setting up OpenCode integration...");

  const created = writeConfigs({
    location: location as ConfigLocation,
    coordinatorModel: coordinatorModel as string,
    workerModel: workerModel as string,
  });

  // Show summary
  p.log.success("Configuration files created:");
  for (const path of created) {
    p.log.message(`  ✓ ${path}`);
  }

  // Show next steps
  if (location === "project" || location === "both") {
    p.note(
      "Add .opencode/ to git to share with your team\n" +
      "Or add to .gitignore for local customization",
      "Team Collaboration"
    );
  }

  p.note(
    'cd your-project\n' +
    'bd init\n' +
    'opencode\n' +
    '/hive "your task"',
    "Next steps"
  );

  p.outro("Setup complete! Run 'hive doctor' to verify.");
}
