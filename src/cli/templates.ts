/**
 * Config Templates - Version-stamped templates for hive configuration
 * 
 * All templates include version headers for migration tracking.
 * Templates are functions that accept model parameters for customization.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CONFIG_VERSION } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Template Header
// ============================================================================

/**
 * Version header template for markdown config files
 */
export function VERSION_HEADER(version: string = CONFIG_VERSION): string {
  return `# hive-config-version: ${version}`;
}

// ============================================================================
// Command Template
// ============================================================================

/**
 * Generate the /hive command markdown template
 */
export function getHiveCommand(): string {
  return `${VERSION_HEADER()}
---
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
}

// ============================================================================
// Agent Templates
// ============================================================================

/**
 * Generate the hive-planner agent markdown template
 */
export function getPlannerAgent(model: string): string {
  return `${VERSION_HEADER()}
---
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
}

/**
 * Generate the hive-worker agent markdown template
 */
export function getWorkerAgent(model: string): string {
  return `${VERSION_HEADER()}
---
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
}

// ============================================================================
// Plugin Wrapper Template
// ============================================================================

/**
 * Generate the plugin wrapper TypeScript template
 * Tries to read from examples/plugin-wrapper-template.ts
 * Falls back to minimal wrapper if file not found
 */
export function getPluginWrapper(): string {
  const templatePath = join(__dirname, "..", "..", "examples", "plugin-wrapper-template.ts");
  
  try {
    return readFileSync(templatePath, "utf-8");
  } catch {
    console.warn(
      `[hive] Could not read plugin template from ${templatePath}, using minimal wrapper`
    );
    return `// Minimal fallback - install opencode-hive-plugin globally for full functionality
import { HivePlugin } from "opencode-hive-plugin"
export default HivePlugin
`;
  }
}
