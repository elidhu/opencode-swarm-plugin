/**
 * Init Command - Initialize Beads and Project Configuration
 * 
 * Initializes beads in the current project and optionally creates
 * project-local hive configuration for team collaboration.
 */

import * as p from "@clack/prompts";
import { existsSync, mkdirSync } from "fs";
import {
  getProjectConfigDir,
  resolveConfigPath,
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
import { runCommand } from "../utils.js";
import { COORDINATOR_MODELS, WORKER_MODELS } from "../constants.js";

// ============================================================================
// Bead Creation
// ============================================================================

async function promptCreateFirstBead(): Promise<boolean> {
  const createBead = await p.confirm({
    message: "Create your first bead?",
    initialValue: true,
  });

  if (p.isCancel(createBead)) {
    return false;
  }

  if (!createBead) {
    return false;
  }

  const title = await p.text({
    message: "Bead title:",
    placeholder: "Implement user authentication",
    validate: (v) => (v.length === 0 ? "Title required" : undefined),
  });

  if (p.isCancel(title)) {
    return false;
  }

  const beadType = await p.select({
    message: "Type:",
    options: [
      { value: "feature", label: "Feature", hint: "New functionality" },
      { value: "bug", label: "Bug", hint: "Something broken" },
      { value: "task", label: "Task", hint: "General work item" },
      { value: "chore", label: "Chore", hint: "Maintenance" },
    ],
  });

  if (p.isCancel(beadType)) {
    return false;
  }

  const beadSpinner = p.spinner();
  beadSpinner.start("Creating bead...");

  const createSuccess = await runCommand(
    `bd create --title "${title}" --type ${beadType}`
  );

  if (createSuccess) {
    beadSpinner.stop("Bead created");
    return true;
  } else {
    beadSpinner.stop("Failed to create bead");
    return false;
  }
}

// ============================================================================
// Project Config Creation
// ============================================================================

async function promptProjectConfig(): Promise<boolean> {
  const createConfig = await p.confirm({
    message: "Create project-local hive config?",
    initialValue: false,
  });

  if (p.isCancel(createConfig)) {
    return false;
  }

  return createConfig as boolean;
}

async function createProjectConfig(): Promise<string[]> {
  // Select models
  const coordinatorModel = await p.select({
    message: "Select coordinator model:",
    options: COORDINATOR_MODELS,
    initialValue: "anthropic/claude-sonnet-4-5",
  });

  if (p.isCancel(coordinatorModel)) {
    throw new Error("Cancelled");
  }

  const workerModel = await p.select({
    message: "Select worker model:",
    options: WORKER_MODELS,
    initialValue: "anthropic/claude-haiku-4-5",
  });

  if (p.isCancel(workerModel)) {
    throw new Error("Cancelled");
  }

  // Create directory structure
  const projectDir = getProjectConfigDir();
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
  }

  const created: string[] = [];

  // Write all config files
  const configTypes: ConfigType[] = ["plugin", "command", "planner", "worker"];
  
  for (const type of configTypes) {
    let content: string;
    
    switch (type) {
      case "plugin":
        content = getPluginWrapper();
        break;
      case "command":
        content = getHiveCommand();
        break;
      case "planner":
        content = getPlannerAgent(coordinatorModel as string);
        break;
      case "worker":
        content = getWorkerAgent(workerModel as string);
        break;
    }

    writeConfig("project", type, content);
    created.push(resolveConfigPath("project", type));
  }

  return created;
}

// ============================================================================
// Skills Directory Creation
// ============================================================================

async function promptCreateSkillsDir(): Promise<boolean> {
  const createSkills = await p.confirm({
    message: "Create project skills directory (.opencode/skills/)?",
    initialValue: false,
  });

  if (p.isCancel(createSkills)) {
    return false;
  }

  return createSkills as boolean;
}

function createSkillsDirectory(): string {
  const skillsPath = `${getProjectConfigDir()}/skills`;
  
  if (!existsSync(skillsPath)) {
    mkdirSync(skillsPath, { recursive: true });
    return skillsPath;
  }
  
  return ""; // Already exists
}

// ============================================================================
// Init Command
// ============================================================================

export async function init() {
  p.intro(`hive init v${CONFIG_VERSION}`);

  // Check for git repository
  const gitDir = existsSync(".git");
  if (!gitDir) {
    p.log.error("Not in a git repository");
    p.log.message("Run 'git init' first, or cd to a git repo");
    p.outro("Aborted");
    process.exit(1);
  }

  // Check for existing beads
  const beadsDir = existsSync(".beads");
  if (beadsDir) {
    p.log.warn("Beads already initialized in this project");

    const reinit = await p.confirm({
      message: "Re-initialize beads?",
      initialValue: false,
    });

    if (p.isCancel(reinit) || !reinit) {
      p.outro("Aborted");
      process.exit(0);
    }
  }

  // Initialize beads
  const s = p.spinner();
  s.start("Initializing beads...");

  const success = await runCommand("bd init");

  if (!success) {
    s.stop("Failed to initialize beads");
    p.log.error("Make sure 'bd' is installed: hive doctor");
    p.outro("Aborted");
    process.exit(1);
  }

  s.stop("Beads initialized");
  p.log.success("Created .beads/ directory");

  // Prompt to create first bead
  await promptCreateFirstBead();

  // Prompt for project-local config
  const shouldCreateConfig = await promptProjectConfig();

  if (shouldCreateConfig) {
    try {
      const created = await createProjectConfig();
      
      p.log.success("Project config created:");
      for (const path of created) {
        p.log.message(`  ✓ ${path}`);
      }

      p.note(
        "Add .opencode/ to git to share with your team:\n" +
        "  git add .opencode/\n" +
        "  git commit -m \"Add hive configuration\"\n\n" +
        "Or add to .gitignore for local customization:\n" +
        "  echo \".opencode/\" >> .gitignore",
        "Team Collaboration"
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Cancelled") {
        p.log.warn("Project config creation cancelled");
      } else {
        throw error;
      }
    }
  }

  // Prompt for skills directory
  const shouldCreateSkills = await promptCreateSkillsDir();

  if (shouldCreateSkills) {
    const skillsPath = createSkillsDirectory();
    if (skillsPath) {
      p.log.success(`Created ${skillsPath}/`);
      p.log.message("Add project-specific skills here for your team");
    } else {
      p.log.warn(`${getProjectConfigDir()}/skills/ already exists`);
    }
  }

  // Show next steps
  p.outro("Project initialized! Use '/hive' in OpenCode to get started.");
}
