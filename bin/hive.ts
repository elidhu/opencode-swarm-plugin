#!/usr/bin/env bun
/**
 * OpenCode Hive Plugin CLI
 *
 * Commands:
 *   hive setup    - Interactive installer for all dependencies
 *   hive doctor   - Check dependency health
 *   hive init     - Initialize beads in current project
 *   hive version  - Show version info
 *   hive          - Interactive mode (same as setup)
 */

import * as p from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

// ============================================================================
// ASCII Art & Branding
// ============================================================================

const BEE = `
    \\ \` - ' /
   - .(o o). -
    (  >.<  )
     /|   |\\
    (_|   |_)  bzzzz...
`;

const HONEYCOMB = `
  / \\__/ \\__/ \\__/ \\__/ \\
  \\__/ \\__/ \\__/ \\__/ \\__/
  / \\__/ \\__/ \\__/ \\__/ \\
  \\__/ \\__/ \\__/ \\__/ \\__/
`;

const BANNER = `
 ██╗  ██╗██╗██╗   ██╗███████╗
 ██║  ██║██║██║   ██║██╔════╝
 ███████║██║██║   ██║█████╗  
 ██╔══██║██║╚██╗ ██╔╝██╔══╝  
 ██║  ██║██║ ╚████╔╝ ███████╗
 ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝
`;

const TAGLINE = "The hive mind for your codebase";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

const PACKAGE_NAME = "opencode-hive-plugin";

// ============================================================================
// Seasonal Messages
// ============================================================================

type Season = "spooky" | "holiday" | "new-year" | "summer" | "default";

function getSeason(): Season {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (month === 1 && day <= 7) return "new-year";
  if (month === 10 && day > 7) return "spooky";
  if (month === 12 && day > 7 && day < 26) return "holiday";
  if (month >= 6 && month <= 8) return "summer";
  return "default";
}

interface SeasonalBee {
  messages: string[];
  decorations?: string[];
}

function getSeasonalBee(): SeasonalBee {
  const season = getSeason();
  const year = new Date().getFullYear();

  switch (season) {
    case "new-year":
      return {
        messages: [
          `New year, new hive! Let's build something amazing in ${year}!`,
          `${year} is the year of the hive mind! bzzzz...`,
          `Kicking off ${year} with coordinated chaos!`,
        ],
        decorations: ["🎉", "🎊", "✨"],
      };
    case "spooky":
      return {
        messages: [
          `Boo! Just kidding. Let's spawn some agents!`,
          `The hive is buzzing with spooky energy...`,
          `Something wicked this way computes...`,
        ],
        decorations: ["🎃", "👻", "🕷️", "🦇"],
      };
    case "holiday":
      return {
        messages: [
          `'Tis the season to parallelize!`,
          `The hive is warm and cozy. Let's build!`,
          `The best gift? A well-coordinated hive.`,
        ],
        decorations: ["🎄", "🎁", "❄️", "⭐"],
      };
    case "summer":
      return {
        messages: [
          `Summer vibes and parallel pipelines!`,
          `The hive is buzzing in the sunshine!`,
          `Hot code, cool agents. Let's go!`,
        ],
        decorations: ["☀️", "🌻", "🌴"],
      };
    default:
      return {
        messages: [
          `The hive awaits your command.`,
          `Ready to coordinate the hive!`,
          `Let's build something awesome together.`,
          `Parallel agents, standing by.`,
          `The bees are ready to work.`,
          `Many agents, one mission.`,
        ],
      };
  }
}

function getRandomMessage(): string {
  const { messages } = getSeasonalBee();
  return messages[Math.floor(Math.random() * messages.length)];
}

function getDecoratedBee(): string {
  const { decorations } = getSeasonalBee();
  if (!decorations || Math.random() > 0.5) return cyan(BEE);

  const decoration =
    decorations[Math.floor(Math.random() * decorations.length)];
  return cyan(BEE.replace("bzzzz...", `bzzzz... ${decoration}`));
}

// ============================================================================
// Model Configuration
// ============================================================================

interface ModelOption {
  value: string;
  label: string;
  hint: string;
}

const COORDINATOR_MODELS: ModelOption[] = [
  { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", hint: "Recommended" },
  { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", hint: "Most capable" },
  { value: "openai/gpt-4o", label: "GPT-4o", hint: "Fast" },
  { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Fast" },
];

const WORKER_MODELS: ModelOption[] = [
  { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Recommended" },
  { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", hint: "More capable" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast and cheap" },
  { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Fast" },
];

// ============================================================================
// Update Checking
// ============================================================================

interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const latest = data.version;
    const updateAvailable =
      latest !== VERSION && compareVersions(latest, VERSION) > 0;
    return { current: VERSION, latest, updateAvailable };
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

function showUpdateNotification(info: UpdateInfo) {
  if (info.updateAvailable) {
    console.log();
    console.log(yellow("  ╭───────────────────────────────────────────────────╮"));
    console.log(yellow("  │") + "  Update available! " + dim(info.current) + " → " + green(info.latest) + "              " + yellow("│"));
    console.log(yellow("  │") + "  Run: " + cyan("npm install -g " + PACKAGE_NAME + "@latest") + yellow("│"));
    console.log(yellow("  ╰───────────────────────────────────────────────────╯"));
    console.log();
  }
}

// ============================================================================
// Types
// ============================================================================

interface Dependency {
  name: string;
  command: string;
  checkArgs: string[];
  required: boolean;
  install: string;
  installType: "brew" | "curl" | "npm" | "manual";
  description: string;
}

interface CheckResult {
  dep: Dependency;
  available: boolean;
  version?: string;
}

// ============================================================================
// Dependencies
// ============================================================================

const DEPENDENCIES: Dependency[] = [
  {
    name: "OpenCode",
    command: "opencode",
    checkArgs: ["--version"],
    required: true,
    install: "brew install sst/tap/opencode",
    installType: "brew",
    description: "AI coding assistant (plugin host)",
  },
  {
    name: "Beads",
    command: "bd",
    checkArgs: ["--version"],
    required: true,
    install: "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash",
    installType: "curl",
    description: "Git-backed issue tracking",
  },
  {
    name: "semantic-memory",
    command: "semantic-memory",
    checkArgs: ["stats"],
    required: false,
    install: "npm install -g semantic-memory",
    installType: "npm",
    description: "Learning persistence",
  },
];

// ============================================================================
// Utilities
// ============================================================================

async function checkCommand(
  cmd: string,
  args: string[],
): Promise<{ available: boolean; version?: string }> {
  try {
    const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const output = await new Response(proc.stdout).text();
      const versionMatch = output.match(/v?(\d+\.\d+\.\d+)/);
      return { available: true, version: versionMatch?.[1] };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

async function runInstall(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function checkAllDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const dep of DEPENDENCIES) {
    const { available, version } = await checkCommand(dep.command, dep.checkArgs);
    results.push({ dep, available, version });
  }
  return results;
}

// ============================================================================
// File Templates
// ============================================================================

function getPluginWrapper(): string {
  const templatePath = join(__dirname, "..", "examples", "plugin-wrapper-template.ts");
  try {
    return readFileSync(templatePath, "utf-8");
  } catch {
    console.warn(`[hive] Could not read plugin template from ${templatePath}, using minimal wrapper`);
    return `// Minimal fallback - install opencode-hive-plugin globally for full functionality
import { HivePlugin } from "opencode-hive-plugin"
export default HivePlugin
`;
  }
}

const HIVE_COMMAND = `---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a hive coordinator. Decompose the task into beads and spawn parallel agents.

## Task

$ARGUMENTS

## Workflow

### 1. Initialize
\`hivemail_init(project_path="$PWD", task_description="Hive: <task>")\`

### 2. Decompose
\`\`\`
hive_select_strategy(task="<task>")
hive_plan_prompt(task="<task>", context="<context>")
hive_validate_decomposition(response="<BeadTree JSON>")
\`\`\`

### 3. Create Beads
\`beads_create_epic(epic_title="<task>", subtasks=[...])\`

### 4. Reserve Files
\`hivemail_reserve(paths=[...], reason="<bead-id>: <desc>")\`

### 5. Spawn Agents (ALL in single message)
\`\`\`
hive_spawn_subtask(bead_id, epic_id, subtask_title, files, shared_context)
Task(subagent_type="hive-worker", prompt="<from above>")
\`\`\`

### 6. Monitor
\`\`\`
hive_status(epic_id, project_key)
hivemail_inbox()
\`\`\`

### 7. Complete
\`\`\`
hive_complete(...)
beads_sync()
\`\`\`

## Strategy Reference

| Strategy       | Best For                 | Keywords                               |
| -------------- | ------------------------ | -------------------------------------- |
| file-based     | Refactoring, migrations  | refactor, migrate, rename, update all  |
| feature-based  | New features             | add, implement, build, create, feature |
| risk-based     | Bug fixes, security      | fix, bug, security, critical, urgent   |

Begin decomposition now.
`;

const getPlannerAgent = (model: string) => `---
name: hive-planner
description: Strategic task decomposition for hive coordination
model: ${model}
---

You are a hive planner. Decompose tasks into optimal parallel subtasks.

## Workflow

1. **Strategy Selection**: \`hive_select_strategy(task="<task>")\`

2. **Generate Plan**: \`hive_plan_prompt(task="<task>", context="<context>")\`

3. **Output BeadTree** (JSON only, no markdown):

\`\`\`json
{
  "epic": { "title": "...", "description": "..." },
  "subtasks": [
    {
      "title": "...",
      "description": "...",
      "files": ["src/..."],
      "dependencies": [],
      "estimated_complexity": 2
    }
  ]
}
\`\`\`

## Rules

- 2-7 subtasks
- No file overlap between subtasks
- Include tests with the code they test
- Order by dependency (if B needs A, A comes first)
`;

const getWorkerAgent = (model: string) => `---
name: hive-worker
description: Executes subtasks in the hive - fast, focused
model: ${model}
---

You are a hive worker agent. Execute your assigned subtask efficiently.

## Workflow

1. **Read** assigned files
2. **Implement** changes
3. **Verify** (typecheck, lint if applicable)
4. **Complete** with \`hive_complete\`

## Rules

- Focus ONLY on your assigned files
- Report blockers immediately via Hive Mail
- Call hive_complete when done

## Communication

\`\`\`
hivemail_send(
  to=["coordinator"],
  subject="Progress/Blocker",
  body="...",
  thread_id="<epic_id>"
)
\`\`\`
`;

// ============================================================================
// Commands
// ============================================================================

function getFixCommand(dep: Dependency): string | null {
  switch (dep.name) {
    case "OpenCode":
      return "brew install sst/tap/opencode";
    case "Beads":
      return "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash";
    case "semantic-memory":
      return "npm install -g semantic-memory";
    default:
      return dep.installType !== "manual" ? dep.install : null;
  }
}

async function doctor() {
  p.intro("hive doctor v" + VERSION);

  const s = p.spinner();
  s.start("Checking dependencies...");

  const results = await checkAllDependencies();

  s.stop("Dependencies checked");

  const required = results.filter((r) => r.dep.required);
  const optional = results.filter((r) => !r.dep.required);

  p.log.step("Required dependencies:");
  for (const { dep, available, version } of required) {
    if (available) {
      p.log.success(dep.name + (version ? " v" + version : ""));
    } else {
      p.log.error(dep.name + " - not found");
      const fixCmd = getFixCommand(dep);
      if (fixCmd) p.log.message(dim("   └─ Fix: " + fixCmd));
    }
  }

  p.log.step("Optional dependencies:");
  for (const { dep, available, version } of optional) {
    if (available) {
      p.log.success(dep.name + (version ? " v" + version : "") + " - " + dep.description);
    } else {
      p.log.warn(dep.name + " - not found (" + dep.description + ")");
      const fixCmd = getFixCommand(dep);
      if (fixCmd) p.log.message(dim("   └─ Fix: " + fixCmd));
    }
  }

  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

  // Check skills
  p.log.step("Skills:");
  const configDir = join(homedir(), ".config", "opencode");
  const globalSkillsPath = join(configDir, "skills");
  const bundledSkillsPath = join(__dirname, "..", "global-skills");

  if (existsSync(globalSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const skills = readdirSync(globalSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      if (skills.length > 0) {
        p.log.success(`Global skills (${skills.length}): ${skills.join(", ")}`);
      } else {
        p.log.warn("Global skills directory exists but is empty");
      }
    } catch {
      p.log.warn("Global skills directory: " + globalSkillsPath);
    }
  } else {
    p.log.warn("No global skills directory (run 'hive setup' to create)");
  }

  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      p.log.success(`Bundled skills (${bundled.length}): ${bundled.join(", ")}`);
    } catch {
      p.log.warn("Could not read bundled skills");
    }
  }

  if (requiredMissing.length > 0) {
    p.outro("Missing " + requiredMissing.length + " required dependencies. Run 'hive setup' to install.");
    process.exit(1);
  } else if (optionalMissing.length > 0) {
    p.outro("All required dependencies installed. " + optionalMissing.length + " optional missing.");
  } else {
    p.outro("All dependencies installed!");
  }

  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

async function setup() {
  console.clear();
  console.log(yellow(HONEYCOMB));
  console.log(yellow(BANNER));
  console.log(getDecoratedBee());
  console.log();
  console.log(magenta("  " + getRandomMessage()));
  console.log();

  p.intro("opencode-hive-plugin v" + VERSION);

  const configDir = join(homedir(), ".config", "opencode");
  const pluginDir = join(configDir, "plugin");
  const commandDir = join(configDir, "command");
  const agentDir = join(configDir, "agent");

  const pluginPath = join(pluginDir, "hive.ts");
  const commandPath = join(commandDir, "hive.md");
  const plannerAgentPath = join(agentDir, "hive-planner.md");
  const workerAgentPath = join(agentDir, "hive-worker.md");

  const existingFiles = [pluginPath, commandPath, plannerAgentPath, workerAgentPath].filter((f) => existsSync(f));

  if (existingFiles.length > 0) {
    p.log.success("Hive is already configured!");
    p.log.message(dim("  Found " + existingFiles.length + "/4 config files"));

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "skip", label: "Keep existing config", hint: "Exit without changes" },
        { value: "models", label: "Update agent models", hint: "Keep customizations, just change models" },
        { value: "reinstall", label: "Reinstall everything", hint: "Check deps and regenerate all config files" },
      ],
    });

    if (p.isCancel(action) || action === "skip") {
      p.outro("Config unchanged. Run 'hive config' to see file locations.");
      return;
    }

    if (action === "models") {
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

      if (existsSync(plannerAgentPath)) {
        const content = readFileSync(plannerAgentPath, "utf-8");
        const updated = content.replace(/^model: .+$/m, `model: ${coordinatorModel}`);
        writeFileSync(plannerAgentPath, updated);
        p.log.success("Planner: " + coordinatorModel);
      }
      if (existsSync(workerAgentPath)) {
        const content = readFileSync(workerAgentPath, "utf-8");
        const updated = content.replace(/^model: .+$/m, `model: ${workerModel}`);
        writeFileSync(workerAgentPath, updated);
        p.log.success("Worker: " + workerModel);
      }
      p.outro("Models updated!");
      return;
    }
  }

  // Full setup flow
  const s = p.spinner();
  s.start("Checking dependencies...");

  const results = await checkAllDependencies();

  s.stop("Dependencies checked");

  const required = results.filter((r) => r.dep.required);
  const optional = results.filter((r) => !r.dep.required);
  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

  for (const { dep, available } of results) {
    if (available) {
      p.log.success(dep.name);
    } else if (dep.required) {
      p.log.error(dep.name + " (required)");
    } else {
      p.log.warn(dep.name + " (optional)");
    }
  }

  if (requiredMissing.length > 0) {
    p.log.step("Missing " + requiredMissing.length + " required dependencies");

    for (const { dep } of requiredMissing) {
      const shouldInstall = await p.confirm({
        message: "Install " + dep.name + "? (" + dep.description + ")",
        initialValue: true,
      });

      if (p.isCancel(shouldInstall)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (shouldInstall) {
        const installSpinner = p.spinner();
        installSpinner.start("Installing " + dep.name + "...");

        const success = await runInstall(dep.install);

        if (success) {
          installSpinner.stop(dep.name + " installed");
        } else {
          installSpinner.stop("Failed to install " + dep.name);
          p.log.error("Manual install: " + dep.install);
        }
      } else {
        p.log.warn("Skipping " + dep.name + " - hive may not work correctly");
      }
    }
  }

  if (optionalMissing.length > 0) {
    const installable = optionalMissing.filter((r) => r.dep.installType !== "manual");

    if (installable.length > 0) {
      const toInstall = await p.multiselect({
        message: "Install optional dependencies?",
        options: installable.map(({ dep }) => ({
          value: dep.name,
          label: dep.name,
          hint: dep.description,
        })),
        required: false,
      });

      if (p.isCancel(toInstall)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (Array.isArray(toInstall) && toInstall.length > 0) {
        for (const name of toInstall) {
          const { dep } = installable.find((r) => r.dep.name === name)!;

          const installSpinner = p.spinner();
          installSpinner.start("Installing " + dep.name + "...");

          const success = await runInstall(dep.install);

          if (success) {
            installSpinner.stop(dep.name + " installed");
          } else {
            installSpinner.stop("Failed to install " + dep.name);
            p.log.message("  Manual: " + dep.install);
          }
        }
      }
    }

    const manual = optionalMissing.filter((r) => r.dep.installType === "manual");
    if (manual.length > 0) {
      p.log.step("Manual installation required:");
      for (const { dep } of manual) {
        p.log.message("  " + dep.name + ": " + dep.install);
      }
    }
  }

  // Model selection
  p.log.step("Configure hive agents...");

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

  p.log.step("Setting up OpenCode integration...");

  const skillsDir = join(configDir, "skills");
  for (const dir of [pluginDir, commandDir, agentDir, skillsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  writeFileSync(pluginPath, getPluginWrapper());
  p.log.success("Plugin: " + pluginPath);

  writeFileSync(commandPath, HIVE_COMMAND);
  p.log.success("Command: " + commandPath);

  writeFileSync(plannerAgentPath, getPlannerAgent(coordinatorModel as string));
  p.log.success("Planner agent: " + plannerAgentPath);

  writeFileSync(workerAgentPath, getWorkerAgent(workerModel as string));
  p.log.success("Worker agent: " + workerAgentPath);

  p.log.success("Skills directory: " + skillsDir);

  const bundledSkillsPath = join(__dirname, "..", "global-skills");
  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      p.log.message(dim("  Bundled skills: " + bundled.join(", ")));
    } catch {
      // Ignore
    }
  }

  p.note('cd your-project\nbd init\nopencode\n/hive "your task"', "Next steps");

  p.outro("Setup complete! Run 'hive doctor' to verify.");
}

async function init() {
  p.intro("hive init v" + VERSION);

  const gitDir = existsSync(".git");
  if (!gitDir) {
    p.log.error("Not in a git repository");
    p.log.message("Run 'git init' first, or cd to a git repo");
    p.outro("Aborted");
    process.exit(1);
  }

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

  const s = p.spinner();
  s.start("Initializing beads...");

  const success = await runInstall("bd init");

  if (success) {
    s.stop("Beads initialized");
    p.log.success("Created .beads/ directory");

    const createBead = await p.confirm({
      message: "Create your first bead?",
      initialValue: true,
    });

    if (!p.isCancel(createBead) && createBead) {
      const title = await p.text({
        message: "Bead title:",
        placeholder: "Implement user authentication",
        validate: (v) => (v.length === 0 ? "Title required" : undefined),
      });

      if (!p.isCancel(title)) {
        const typeResult = await p.select({
          message: "Type:",
          options: [
            { value: "feature", label: "Feature", hint: "New functionality" },
            { value: "bug", label: "Bug", hint: "Something broken" },
            { value: "task", label: "Task", hint: "General work item" },
            { value: "chore", label: "Chore", hint: "Maintenance" },
          ],
        });

        if (!p.isCancel(typeResult)) {
          const beadSpinner = p.spinner();
          beadSpinner.start("Creating bead...");

          const createSuccess = await runInstall('bd create --title "' + title + '" --type ' + typeResult);

          if (createSuccess) {
            beadSpinner.stop("Bead created");
          } else {
            beadSpinner.stop("Failed to create bead");
          }
        }
      }
    }

    const createSkillsDir = await p.confirm({
      message: "Create project skills directory (.opencode/skills/)?",
      initialValue: false,
    });

    if (!p.isCancel(createSkillsDir) && createSkillsDir) {
      const skillsPath = ".opencode/skills";
      if (!existsSync(skillsPath)) {
        mkdirSync(skillsPath, { recursive: true });
        p.log.success("Created " + skillsPath + "/");
      } else {
        p.log.warn(skillsPath + "/ already exists");
      }
    }

    p.outro("Project initialized! Use '/hive' in OpenCode to get started.");
  } else {
    s.stop("Failed to initialize beads");
    p.log.error("Make sure 'bd' is installed: hive doctor");
    p.outro("Aborted");
    process.exit(1);
  }
}

async function version() {
  console.log(yellow(HONEYCOMB));
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE));
  console.log();
  console.log("  Version: " + VERSION);
  console.log("  Docs:    https://github.com/elidhu/opencode-hive-plugin");
  console.log();

  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

function config() {
  const configDir = join(homedir(), ".config", "opencode");
  const pluginPath = join(configDir, "plugin", "hive.ts");
  const commandPath = join(configDir, "command", "hive.md");
  const plannerAgentPath = join(configDir, "agent", "hive-planner.md");
  const workerAgentPath = join(configDir, "agent", "hive-worker.md");
  const globalSkillsPath = join(configDir, "skills");

  console.log(yellow(HONEYCOMB));
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log();
  console.log(cyan("Config Files:"));
  console.log();

  const files = [
    { path: pluginPath, desc: "Plugin loader", emoji: "🔌" },
    { path: commandPath, desc: "/hive command prompt", emoji: "📜" },
    { path: plannerAgentPath, desc: "@hive-planner agent", emoji: "🤖" },
    { path: workerAgentPath, desc: "@hive-worker agent", emoji: "🐝" },
  ];

  for (const { path, desc, emoji } of files) {
    const exists = existsSync(path);
    const status = exists ? "✓" : "✗";
    const color = exists ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${emoji} ${desc}`);
    console.log(`     ${color}${status}\x1b[0m ${dim(path)}`);
    console.log();
  }

  console.log(cyan("Skills:"));
  console.log();

  const globalSkillsExists = existsSync(globalSkillsPath);
  const globalStatus = globalSkillsExists ? "✓" : "✗";
  const globalColor = globalSkillsExists ? "\x1b[32m" : "\x1b[31m";
  console.log(`  📚 Global skills directory`);
  console.log(`     ${globalColor}${globalStatus}\x1b[0m ${dim(globalSkillsPath)}`);

  if (globalSkillsExists) {
    try {
      const { readdirSync } = require("fs");
      const skills = readdirSync(globalSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      if (skills.length > 0) {
        console.log(`     ${dim(`Found ${skills.length} skill(s): ${skills.join(", ")}`)}`);
      }
    } catch {
      // Ignore
    }
  }
  console.log();

  console.log(`  📁 Project skills locations ${dim("(checked in order)")}`);
  console.log(`     ${dim(".opencode/skills/")}`);
  console.log(`     ${dim(".claude/skills/")}`);
  console.log(`     ${dim("skills/")}`);
  console.log();

  const bundledSkillsPath = join(__dirname, "..", "global-skills");
  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      console.log(`  🎁 Bundled skills ${dim("(always available)")}`);
      console.log(`     ${dim(bundled.join(", "))}`);
      console.log();
    } catch {
      // Ignore
    }
  }

  console.log(dim("Edit these files to customize hive behavior."));
  console.log(dim("Run 'hive setup' to regenerate defaults."));
  console.log();
}

async function update() {
  p.intro("hive update v" + VERSION);

  const s = p.spinner();
  s.start("Checking for updates...");

  const updateInfo = await checkForUpdates();

  if (!updateInfo) {
    s.stop("Failed to check for updates");
    p.log.error("Could not reach npm registry");
    p.outro("Try again later or update manually:");
    console.log("  " + cyan("npm install -g " + PACKAGE_NAME + "@latest"));
    process.exit(1);
  }

  if (!updateInfo.updateAvailable) {
    s.stop("Already on latest version");
    p.log.success("You're running " + VERSION);
    p.outro("No update needed!");
    return;
  }

  s.stop("Update available: " + VERSION + " → " + updateInfo.latest);

  const confirmUpdate = await p.confirm({
    message: "Update to v" + updateInfo.latest + "?",
    initialValue: true,
  });

  if (p.isCancel(confirmUpdate) || !confirmUpdate) {
    p.outro("Update cancelled");
    return;
  }

  const updateSpinner = p.spinner();
  updateSpinner.start("Updating to v" + updateInfo.latest + "...");

  const success = await runInstall("npm install -g " + PACKAGE_NAME + "@latest");

  if (success) {
    updateSpinner.stop("Updated to v" + updateInfo.latest);
    p.outro("Success! Restart your terminal to use the new version.");
  } else {
    updateSpinner.stop("Update failed");
    p.log.error("Failed to update via npm");
    p.log.message("Try manually:");
    console.log("  " + cyan("npm install -g " + PACKAGE_NAME + "@latest"));
    p.outro("Update failed");
    process.exit(1);
  }
}

async function help() {
  console.log(yellow(HONEYCOMB));
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log(getDecoratedBee());
  console.log(magenta("  " + getRandomMessage()));
  console.log(`
${cyan("Commands:")}
  hive setup     Interactive installer
  hive doctor    Health check
  hive init      Initialize beads in current project
  hive config    Show paths to generated config files
  hive update    Update to latest version
  hive version   Show version and banner
  hive tool      Execute a tool (for plugin wrapper)
  hive help      Show this help

${cyan("Tool Execution:")}
  hive tool --list                    List all available tools
  hive tool <name>                    Execute tool with no args
  hive tool <name> --json '<args>'    Execute tool with JSON args

${cyan("Usage in OpenCode:")}
  /hive "Add user authentication with OAuth"
  @hive-planner "Decompose this into parallel tasks"
  @hive-worker "Execute this specific subtask"

${cyan("Customization:")}
  Edit the generated files to customize behavior:
  ${dim("~/.config/opencode/command/hive.md")}       - /hive command prompt
  ${dim("~/.config/opencode/agent/hive-planner.md")}  - @hive-planner (coordinator)
  ${dim("~/.config/opencode/agent/hive-worker.md")}   - @hive-worker (executor)
  ${dim("~/.config/opencode/plugin/hive.ts")}        - Plugin loader

${dim("Docs: https://github.com/elidhu/opencode-hive-plugin")}
`);

  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

// ============================================================================
// Tool Execution
// ============================================================================

async function executeTool(toolName: string, argsJson?: string) {
  const { allTools } = await import("../src/index");

  if (!(toolName in allTools)) {
    const availableTools = Object.keys(allTools).sort();
    console.log(JSON.stringify({
      success: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: `Unknown tool: ${toolName}`,
        available_tools: availableTools,
      },
    }));
    process.exit(2);
  }

  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.log(JSON.stringify({
        success: false,
        error: {
          code: "INVALID_JSON",
          message: `Invalid JSON args: ${e instanceof Error ? e.message : String(e)}`,
          raw_input: argsJson.slice(0, 200),
        },
      }));
      process.exit(3);
    }
  }

  const mockContext = {
    sessionID: process.env.OPENCODE_SESSION_ID || `cli-${Date.now()}`,
    messageID: process.env.OPENCODE_MESSAGE_ID || `msg-${Date.now()}`,
    agent: process.env.OPENCODE_AGENT || "cli",
    abort: new AbortController().signal,
  };

  const toolDef = allTools[toolName as keyof typeof allTools];

  try {
    const result = await toolDef.execute(args as any, mockContext);

    try {
      const parsed = JSON.parse(result);
      if (typeof parsed === "object" && "success" in parsed) {
        console.log(JSON.stringify(parsed));
      } else {
        console.log(JSON.stringify({ success: true, data: parsed }));
      }
    } catch {
      console.log(JSON.stringify({ success: true, data: result }));
    }
    process.exit(0);
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: {
        code: error instanceof Error ? error.name : "TOOL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    }));
    process.exit(1);
  }
}

async function listTools() {
  const { allTools } = await import("../src/index");
  const tools = Object.keys(allTools).sort();

  console.log(yellow(HONEYCOMB));
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log();
  console.log(cyan("Available tools:") + ` (${tools.length} total)`);
  console.log();

  const groups: Record<string, string[]> = {};
  for (const tool of tools) {
    const prefix = tool.split("_")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(tool);
  }

  for (const [prefix, toolList] of Object.entries(groups)) {
    console.log(green(`  ${prefix}:`));
    for (const t of toolList) {
      console.log(`    ${t}`);
    }
    console.log();
  }

  console.log(dim("Usage: hive tool <name> [--json '<args>']"));
  console.log(dim("Example: hive tool beads_ready"));
  console.log(dim('Example: hive tool beads_create --json \'{"title": "Fix bug"}\''));
}

// ============================================================================
// Main
// ============================================================================

const command = process.argv[2];

switch (command) {
  case "setup":
    await setup();
    break;
  case "doctor":
    await doctor();
    break;
  case "init":
    await init();
    break;
  case "config":
    config();
    break;
  case "update":
    await update();
    break;
  case "tool": {
    const toolName = process.argv[3];
    if (!toolName || toolName === "--list" || toolName === "-l") {
      await listTools();
    } else {
      const jsonFlagIndex = process.argv.indexOf("--json");
      const argsJson = jsonFlagIndex !== -1 ? process.argv[jsonFlagIndex + 1] : undefined;
      await executeTool(toolName, argsJson);
    }
    break;
  }
  case "version":
  case "--version":
  case "-v":
    await version();
    break;
  case "help":
  case "--help":
  case "-h":
    await help();
    break;
  case undefined:
    await setup();
    break;
  default:
    console.error("Unknown command: " + command);
    help();
    process.exit(1);
}
