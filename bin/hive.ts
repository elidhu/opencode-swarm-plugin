#!/usr/bin/env bun
/**
 * OpenCode Hive Plugin CLI
 *
 * Commands:
 *   hive setup    - Interactive installer for all dependencies
 *   hive doctor   - Check dependency health
 *   hive init     - Initialize beads in current project
 *   hive sync     - Update config templates to latest versions
 *   hive config   - Show paths to config files
 *   hive inbox    - Human inbox for Swarm Mail messages
 *   hive spec     - Design specification management
 *   hive update   - Update to latest version
 *   hive version  - Show version info
 *   hive tool     - Execute a tool (for plugin wrapper)
 *   hive help     - Show help
 *   hive          - Interactive mode (same as setup)
 */

import * as p from "@clack/prompts";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Import command modules
import { setup } from "../src/cli/commands/setup.js";
import { doctor } from "../src/cli/commands/doctor.js";
import { init } from "../src/cli/commands/init.js";
import { syncCommand as sync } from "../src/cli/commands/sync.js";
import { config } from "../src/cli/commands/config.js";
import { inboxCommand } from "../src/cli/commands/inbox.js";

// Import shared utilities
import { dim, yellow, cyan, green, magenta, HONEYCOMB, BANNER, TAGLINE, PACKAGE_NAME, getRandomMessage } from "../src/cli/branding.js";
import { runInstall } from "../src/cli/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

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
// Simple Commands (inline)
// ============================================================================

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
  console.log(magenta("  " + getRandomMessage()));
  console.log(`
${cyan("Commands:")}
  hive setup     Interactive installer
  hive doctor    Health check
  hive init      Initialize beads in current project
  hive sync      Update config templates to latest versions
  hive config    Show paths to generated config files
  hive inbox     Human inbox for Swarm Mail messages
  hive spec      Design specification management
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

${cyan("Config Locations:")} ${dim("(project overrides global)")}
  ${cyan("Global:")}  ~/.config/opencode/{command,agent,plugin}/
  ${cyan("Project:")} .opencode/{command,agent,plugin}/

${cyan("Config Files:")}
  command/hive.md        /hive command prompt
  agent/hive-planner.md  @hive-planner (coordinator)
  agent/hive-worker.md   @hive-worker (executor)
  plugin/hive.ts         Plugin loader

${dim("Run 'hive config' to see active config paths")}
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
  case "sync":
    await sync();
    break;
  case "config":
    await config();
    break;
  case "inbox": {
    // Pass remaining args to inbox command
    const inboxArgs = process.argv.slice(3);
    await inboxCommand(inboxArgs);
    break;
  }
  case "spec": {
    // Spec command - dynamically import to handle potential non-existence
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const specModule = await import("../src/cli/commands/spec.js") as any;
      const specArgs = process.argv.slice(3);
      if (typeof specModule.specCommand === "function") {
        await specModule.specCommand(specArgs);
      } else {
        console.error("Spec command module found but specCommand not exported.");
        console.log("Available spec tools: spec_write, spec_submit, spec_implement, spec_query");
        console.log("Run: hive tool spec_query");
        process.exit(1);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
        console.error("Spec command not yet implemented. Use spec_* tools directly.");
        console.log("Available spec tools: spec_write, spec_submit, spec_implement, spec_query");
        console.log("Run: hive tool spec_query");
        process.exit(1);
      }
      throw e;
    }
    break;
  }
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
