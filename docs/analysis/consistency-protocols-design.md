# Cross-Agent Consistency Protocols

**Status**: Design Specification (Zero-Config Edition)  
**Author**: SwiftStorm (Hive Agent) / Revised by: WildStar (Hive Agent)  
**Date**: 2025-12-15  
**Last Updated**: 2025-12-15  
**Related**: `src/schemas/verification.ts`, `src/hive-orchestrate.ts`, `src/learning.ts`, `src/storage.ts`

## Executive Summary

This document defines **Zero-Config Consistency Protocols** for multi-agent coordination. These protocols reduce mistakes and improve consistency across parallel agents through **automatic detection** and **existing infrastructure reuse**:

1. **Pre-Flight Protocol**: Auto-detected health checks before agents start
2. **Shared Gotchas Protocol**: Broadcast discovered issues via existing LanceDB patterns
3. **Style Enforcement Protocol**: Auto-detect and delegate to existing linters
4. **Enhanced Verification Gates**: Strengthen existing `hive_complete` gate
5. **Guardian Integration**: Quality monitoring by specialized guardian workers

### Zero-Config Principles

**We don't force configuration. We detect and adapt.**

- **Detect tsconfig.json** → run typecheck
- **Detect package.json** → check dependencies  
- **Detect .eslintrc** → run ESLint
- **Detect biome.json** → run Biome
- **No config file?** → Skip that check gracefully

### Reuse Over Rebuild

**We enhance what exists. We don't duplicate.**

- **Gotchas** → Use existing `learning.ts` with `is_negative: true` patterns
- **Verification** → Enhance existing `hive_complete` gate, don't replace
- **Storage** → Use existing LanceDB, no new storage classes

## Problem Statement

### Current State

**What exists:**
- `hive_complete` runs typecheck + tests at completion
- `learning.ts` tracks outcomes and errors
- `output-guardrails.ts` validates tool outputs
- 3-strike detection prevents repeated failures

**What's missing:**
- ❌ Pre-flight checks: Agents start on broken codebases
- ❌ Shared gotchas: Agent A discovers bug, Agent B repeats same mistake
- ❌ Style enforcement: Parallel agents use different patterns
- ❌ Mid-task verification: Errors discovered only at completion (too late)

### Impact

**Observed Failure Modes:**
1. **Late Error Detection**: Agent works for 20 minutes, discovers typecheck failure at `hive_complete`
2. **Repeated Mistakes**: Multiple agents hit same edge case (e.g., null handling in schema)
3. **Inconsistent Styles**: Agent A uses `async/await`, Agent B uses `.then()` chains in same codebase
4. **Broken Start State**: Agent starts work on code that doesn't compile

**Cost:**
- Wasted agent time (rework after verification failure)
- Inconsistent codebase quality
- Higher error_count in outcome tracking
- More 3-strikes due to preventable errors

## Design: Five-Layer Protocol Stack

### Layer 0: Zero-Config Detection

**Purpose**: Auto-detect project conventions and available tools.

#### Detection Table

| **If Project Has...** | **Then Run...** | **Required** | **Fallback** |
|-----------------------|-----------------|--------------|--------------|
| `tsconfig.json` | `tsc --noEmit` | Yes | Skip if missing |
| `package.json` | Check deps freshness | No | Skip if missing |
| `.eslintrc*` | `npx eslint` | No | Skip if missing |
| `biome.json` | `bunx biome check` | No | Skip if missing |
| `.git/` | `git status` | No | Skip if missing |
| `vitest.config.*` | `bun test` | Yes (if exists) | Skip if no tests |
| `jest.config.*` | `npm test` | Yes (if exists) | Skip if no tests |

#### Detection Implementation

```typescript
interface ProjectConventions {
  has_typescript: boolean;
  has_linter: "eslint" | "biome" | null;
  has_tests: "vitest" | "jest" | "bun" | null;
  has_git: boolean;
  has_dependencies: boolean;
}

async function detectProjectConventions(
  projectPath: string
): Promise<ProjectConventions> {
  const checkFile = async (path: string) => {
    return await Bun.file(join(projectPath, path)).exists();
  };

  return {
    has_typescript: await checkFile("tsconfig.json"),
    has_linter: 
      (await checkFile(".eslintrc")) || (await checkFile(".eslintrc.json")) 
        ? "eslint"
        : (await checkFile("biome.json"))
          ? "biome"
          : null,
    has_tests:
      (await checkFile("vitest.config.ts")) || (await checkFile("vitest.config.js"))
        ? "vitest"
        : (await checkFile("jest.config.js"))
          ? "jest"
          : (await checkFile("package.json")) // Check for "bun test" in scripts
            ? "bun"
            : null,
    has_git: await checkFile(".git/config"),
    has_dependencies: await checkFile("package.json"),
  };
}
```

#### Zero-Config Philosophy

**Don't force config. Detect and adapt:**

1. **TypeScript projects** → Typecheck is required
2. **Non-TypeScript projects** → Skip typecheck
3. **Projects with ESLint** → Run ESLint
4. **Projects without linters** → Skip style checks (don't force new config)
5. **Projects with tests** → Run tests
6. **Projects without tests** → Skip test checks (but warn)

**Key principle**: Never fail because something is missing. Adapt to what's there.

---

### Layer 1: Pre-Flight Protocol

**Purpose**: Verify codebase health BEFORE agent starts work, using auto-detected checks.

#### Protocol Definition

```typescript
interface PreFlightCheck {
  name: string;
  required: boolean; // If true, failure blocks agent start
  check: () => Promise<PreFlightResult>;
}

interface PreFlightResult {
  passed: boolean;
  message: string;
  blockers?: string[]; // Why agent can't proceed
  warnings?: string[]; // Non-blocking issues
  metadata?: Record<string, unknown>;
}

interface PreFlightProtocol {
  checks: PreFlightCheck[];
  on_failure: "block" | "warn" | "skip";
}
```

#### Auto-Detected Checks

**All checks are auto-detected. No manual configuration.**

**1. Typecheck Health** (conditional: only if `tsconfig.json` exists)
```typescript
{
  name: "typecheck",
  required: true, // But only runs if TypeScript detected
  check: async (conventions: ProjectConventions) => {
    if (!conventions.has_typescript) {
      return {
        passed: true,
        message: "No TypeScript config - skipping typecheck",
        skipped: true
      };
    }
    
    const result = await Bun.$`tsc --noEmit`.quiet().nothrow();
    return {
      passed: result.exitCode === 0,
      message: result.exitCode === 0 
        ? "✓ Typecheck passed" 
        : "✗ Typecheck failed - fix before starting",
      blockers: result.exitCode !== 0 
        ? [result.stderr.toString().slice(0, 500)]
        : undefined
    };
  }
}
```

**2. Existing Tests** (conditional: only if test framework detected)
```typescript
{
  name: "existing_tests",
  required: true, // But only runs if tests detected
  check: async (conventions: ProjectConventions) => {
    if (!conventions.has_tests) {
      return {
        passed: true,
        message: "No test framework detected - skipping tests",
        skipped: true,
        warnings: ["Consider adding tests to improve quality"]
      };
    }
    
    // Run tests with detected framework
    const testCommand = 
      conventions.has_tests === "vitest" ? "bunx vitest run" :
      conventions.has_tests === "jest" ? "npm test" :
      "bun test";
    
    const result = await Bun.$`${testCommand}`.quiet().nothrow();
    return {
      passed: result.exitCode === 0,
      message: result.exitCode === 0
        ? `✓ Tests passed (${conventions.has_tests})`
        : `✗ Tests failed (${conventions.has_tests})`,
      blockers: result.exitCode !== 0
        ? ["Test suite failing - fix before starting"]
        : undefined
    };
  }
}
```

**3. Git Status** (conditional: only if `.git/` exists)
```typescript
{
  name: "git_status",
  required: false,
  check: async (conventions: ProjectConventions) => {
    if (!conventions.has_git) {
      return {
        passed: true,
        message: "Not a git repository - skipping",
        skipped: true
      };
    }
    
    const status = await Bun.$`git status --porcelain`.quiet().text();
    const hasUncommitted = status.trim().length > 0;
    return {
      passed: true, // Never blocks
      message: hasUncommitted
        ? "⚠ Uncommitted changes present"
        : "✓ Clean working tree",
      warnings: hasUncommitted
        ? ["Working tree has uncommitted changes - consider committing first"]
        : undefined
    };
  }
}
```

**4. Dependency Health** (conditional: only if `package.json` exists)
```typescript
{
  name: "dependencies",
  required: false,
  check: async (conventions: ProjectConventions) => {
    if (!conventions.has_dependencies) {
      return {
        passed: true,
        message: "No package.json - skipping dependency check",
        skipped: true
      };
    }
    
    const packageJson = Bun.file("package.json");
    const lockfile = Bun.file("bun.lock") || Bun.file("package-lock.json");
    
    if (!await lockfile.exists()) {
      return {
        passed: false,
        message: "No lockfile found",
        warnings: ["Run 'bun install' or 'npm install' to generate lockfile"]
      };
    }
    
    // Check if package.json is newer than node_modules
    const pkgStat = await packageJson.stat();
    const nodeModules = Bun.file("node_modules/.bin");
    const nmStat = await nodeModules.exists() ? await nodeModules.stat() : null;
    
    if (nmStat && pkgStat.mtime > nmStat.mtime) {
      return {
        passed: false,
        message: "⚠ Dependencies may be stale",
        warnings: ["package.json modified after node_modules - run 'bun install'"]
      };
    }
    
    return { passed: true, message: "✓ Dependencies appear fresh" };
  }
}
```

#### Integration with hive_init

**Extend hive_init to run auto-detected pre-flight checks:**

```typescript
export const hive_init = tool({
  description: "Initialize hive session: auto-detect project, run pre-flight checks, discover skills",
  args: {
    project_path: tool.schema.string().optional(),
    skip_preflight: tool.schema.boolean().optional()
      .describe("Skip pre-flight checks (use sparingly)"),
  },
  async execute(args) {
    const projectPath = args.project_path || process.cwd();
    
    // Step 1: Auto-detect project conventions
    const conventions = await detectProjectConventions(projectPath);
    
    // ... existing tool availability checks ...
    
    // Step 2: Run pre-flight protocol (auto-detected checks only)
    let preflightResults: PreFlightResult[] = [];
    if (!args.skip_preflight) {
      preflightResults = await runPreFlightProtocol(conventions);
      
      const blockers = preflightResults
        .filter(r => !r.passed && !r.skipped && r.blockers)
        .flatMap(r => r.blockers!);
      
      if (blockers.length > 0) {
        return JSON.stringify({
          ready: false,
          preflight_failed: true,
          conventions: conventions,
          blockers: blockers,
          message: "Pre-flight checks failed - fix issues before starting hive",
          hint: "Use skip_preflight=true to bypass (not recommended)"
        }, null, 2);
      }
    }
    
    return JSON.stringify({
      ready: true,
      conventions: {
        typescript: conventions.has_typescript,
        linter: conventions.has_linter,
        tests: conventions.has_tests,
        git: conventions.has_git,
      },
      preflight: {
        passed: true,
        checks: preflightResults.map(r => ({
          name: r.name,
          passed: r.passed,
          skipped: r.skipped,
          message: r.message
        }))
      },
      // ... existing response ...
    }, null, 2);
  }
});
```

**Key Changes:**
1. ✅ **Auto-detection first** - Detect conventions before running checks
2. ✅ **Conditional execution** - Only run checks for detected tools
3. ✅ **Graceful skipping** - Missing tools don't cause failures
4. ✅ **Transparent reporting** - Show what was detected and what was skipped

---

### Layer 2: Shared Gotchas Protocol

**Purpose**: Broadcast discovered issues to all agents working on the same epic, using **existing LanceDB storage**.

#### Reuse Existing Infrastructure

**✅ WHAT WE HAVE**: `learning.ts` already has `storePattern()` with `is_negative: true` for anti-patterns.

**✅ WHAT WE REUSE**: Store gotchas as anti-patterns in existing LanceDB, no new storage class needed.

#### Protocol Definition

```typescript
interface Gotcha {
  id: string; // Unique identifier
  epic_id: string; // Epic this applies to
  discovered_by: string; // Agent name
  category: GotchaCategory;
  title: string; // Short description
  details: string; // What went wrong
  mitigation: string; // How to avoid
  files_affected?: string[]; // Relevant files
  discovered_at: string; // ISO-8601 timestamp
  severity: "info" | "warning" | "critical";
}

type GotchaCategory = 
  | "type-error"
  | "null-handling"
  | "edge-case"
  | "api-quirk"
  | "test-requirement"
  | "pattern-violation"
  | "dependency-issue";
```

#### Storage Implementation (Reuse Existing)

**Use existing `learning.ts` methods - NO new classes:**

```typescript
import { getStorage } from "./storage";
import type { DecompositionPattern } from "./pattern-maturity";

/**
 * Store a gotcha using existing LanceDB patterns storage
 * 
 * Gotchas are stored as anti-patterns (is_negative: true) with:
 * - kind: "anti_pattern" (existing enum value)
 * - is_negative: true (existing flag)
 * - tags: [category, severity, epic_id, ...files]
 */
async function storeGotcha(gotcha: Gotcha): Promise<void> {
  const storage = getStorage();
  
  // Use existing storePattern method with is_negative flag
  await storage.storePattern({
    id: gotcha.id,
    content: `[${gotcha.category}] ${gotcha.title}: ${gotcha.details}`,
    kind: "anti_pattern", // Existing kind enum value
    is_negative: true, // Existing flag for anti-patterns
    success_count: 0,
    failure_count: 1,
    created_at: gotcha.discovered_at,
    updated_at: gotcha.discovered_at,
    tags: [
      gotcha.category,
      gotcha.severity,
      gotcha.epic_id,
      ...(gotcha.files_affected || [])
    ],
    example_beads: [gotcha.discovered_by],
    reason: gotcha.mitigation
  });
}

/**
 * Query gotchas by epic using existing getAntiPatterns + filtering
 */
async function getGotchasByEpic(epic_id: string): Promise<Gotcha[]> {
  const storage = getStorage();
  
  // Use existing getAntiPatterns method
  const antiPatterns = await storage.getAntiPatterns();
  
  // Filter by epic_id tag
  const relevantPatterns = antiPatterns.filter(p => 
    p.tags?.includes(epic_id)
  );
  
  return relevantPatterns.map(patternToGotcha);
}

/**
 * Query gotchas by files using existing semantic search
 */
async function getGotchasByFiles(files: string[]): Promise<Gotcha[]> {
  const storage = getStorage();
  
  // Use existing findSimilarPatterns for semantic search
  const allGotchas: Gotcha[] = [];
  
  for (const file of files) {
    const patterns = await storage.findSimilarPatterns(file, 10);
    const gotchas = patterns
      .filter(p => p.is_negative && p.kind === "anti_pattern")
      .map(patternToGotcha);
    allGotchas.push(...gotchas);
  }
  
  // Deduplicate by id
  return Array.from(
    new Map(allGotchas.map(g => [g.id, g])).values()
  );
}

/**
 * Convert DecompositionPattern to Gotcha format
 */
function patternToGotcha(pattern: DecompositionPattern): Gotcha {
  // Extract metadata from tags
  const category = pattern.tags?.find(t => 
    ["type-error", "null-handling", "edge-case", "api-quirk", 
     "test-requirement", "pattern-violation", "dependency-issue"].includes(t)
  ) as GotchaCategory || "edge-case";
  
  const severity = pattern.tags?.find(t => 
    ["info", "warning", "critical"].includes(t)
  ) as "info" | "warning" | "critical" || "warning";
  
  const epic_id = pattern.tags?.find(t => t.startsWith("epic-")) || "";
  
  return {
    id: pattern.id,
    epic_id,
    discovered_by: pattern.example_beads?.[0] || "unknown",
    category,
    title: pattern.content.split(":")[0].replace(/^\[.*?\]\s*/, ""),
    details: pattern.content,
    mitigation: pattern.reason || "See details",
    files_affected: pattern.tags?.filter(t => t.includes("/") || t.includes("\\")),
    discovered_at: pattern.created_at,
    severity,
  };
}
```

**Key Benefits:**
1. ✅ **No new storage class** - Use existing `LearningStorage` interface
2. ✅ **No new database schema** - Use existing `is_negative` flag
3. ✅ **Semantic search built-in** - Use existing `findSimilarPatterns()`
4. ✅ **Tags for filtering** - Use existing `tags` array for epic_id, category, severity

#### Broadcasting Tool

**New tool: `hive_report_gotcha`**

```typescript
export const hive_report_gotcha = tool({
  description: "Report a discovered issue (gotcha) to all agents in the epic. Use when you discover an edge case, bug, or pattern violation that other agents should know about.",
  args: {
    project_key: tool.schema.string(),
    agent_name: tool.schema.string(),
    epic_id: tool.schema.string(),
    category: tool.schema.enum([
      "type-error",
      "null-handling", 
      "edge-case",
      "api-quirk",
      "test-requirement",
      "pattern-violation",
      "dependency-issue"
    ]),
    title: tool.schema.string().max(100),
    details: tool.schema.string(),
    mitigation: tool.schema.string()
      .describe("How to avoid this issue"),
    files_affected: tool.schema.array(tool.schema.string()).optional(),
    severity: tool.schema.enum(["info", "warning", "critical"]).default("warning"),
  },
  async execute(args) {
    const gotcha: Gotcha = {
      id: `gotcha-${args.epic_id}-${Date.now()}`,
      epic_id: args.epic_id,
      discovered_by: args.agent_name,
      category: args.category,
      title: args.title,
      details: args.details,
      mitigation: args.mitigation,
      files_affected: args.files_affected,
      discovered_at: new Date().toISOString(),
      severity: args.severity
    };
    
    // Store in semantic memory
    const store = new SemanticGotchaStore(getStorage());
    await store.store(gotcha);
    
    // Broadcast to all agents via hive-mail
    await sendSwarmMessage({
      projectPath: args.project_key,
      fromAgent: args.agent_name,
      toAgents: [], // Broadcast
      subject: `[${args.severity.toUpperCase()}] Gotcha: ${args.title}`,
      body: formatGotcha(gotcha),
      threadId: args.epic_id,
      importance: args.severity === "critical" ? "urgent" : "high",
      ackRequired: args.severity === "critical"
    });
    
    return JSON.stringify({
      success: true,
      gotcha_id: gotcha.id,
      stored: true,
      broadcast: true,
      message: "Gotcha reported to all agents in epic"
    }, null, 2);
  }
});
```

#### Query Tool

**New tool: `hive_query_gotchas`**

```typescript
export const hive_query_gotchas = tool({
  description: "Query reported gotchas for the epic or specific files. Use before starting work on files to see known issues.",
  args: {
    epic_id: tool.schema.string().optional(),
    files: tool.schema.array(tool.schema.string()).optional(),
    severity: tool.schema.enum(["info", "warning", "critical"]).optional(),
  },
  async execute(args) {
    const store = new SemanticGotchaStore(getStorage());
    
    let gotchas: Gotcha[] = [];
    if (args.epic_id) {
      gotchas = await store.getByEpic(args.epic_id);
    } else if (args.files) {
      gotchas = await store.getByFiles(args.files);
    }
    
    // Filter by severity if specified
    if (args.severity) {
      gotchas = gotchas.filter(g => g.severity === args.severity);
    }
    
    return JSON.stringify({
      count: gotchas.length,
      gotchas: gotchas.map(g => ({
        id: g.id,
        category: g.category,
        title: g.title,
        details: g.details,
        mitigation: g.mitigation,
        severity: g.severity,
        discovered_by: g.discovered_by,
        discovered_at: g.discovered_at,
        files_affected: g.files_affected
      })),
      message: gotchas.length > 0
        ? "Review these gotchas before proceeding"
        : "No gotchas reported for this scope"
    }, null, 2);
  }
});
```

#### Integration with Subtask Prompts

**Extend `hive_subtask_prompt` to inject gotchas:**

```typescript
export function generateSubtaskPrompt(args: SubtaskPromptArgs): string {
  // ... existing prompt generation ...
  
  // Query gotchas for this epic and files
  const gotchas = await queryGotchasForSubtask(args.epic_id, args.files);
  
  const gotchasSection = gotchas.length > 0 ? `

## [KNOWN GOTCHAS]

Other agents have discovered ${gotchas.length} issue(s) relevant to your work:

${gotchas.map((g, i) => `
### ${i + 1}. [${g.severity.toUpperCase()}] ${g.title}

**Category**: ${g.category}
**What happened**: ${g.details}
**How to avoid**: ${g.mitigation}
${g.files_affected ? `**Affected files**: ${g.files_affected.join(", ")}` : ""}

`).join("\n")}

**Action Required**: Review these gotchas before starting. If you encounter similar issues, use \`hive_report_gotcha\` to add to the list.

` : "";

  return `${existingPrompt}${gotchasSection}`;
}
```

---

### Layer 3: Style Enforcement Protocol

**Purpose**: Delegate to existing linters when present, don't force new configuration.

#### Zero-Config Approach

**✅ WHAT WE DON'T DO**: Create custom style rules that duplicate linter functionality.

**✅ WHAT WE DO**: Auto-detect existing linters and delegate to them.

#### Auto-Detection Strategy

```typescript
interface LinterConfig {
  name: "eslint" | "biome" | null;
  command: string | null;
  config_file: string | null;
  autofix_command: string | null;
}

/**
 * Auto-detect which linter (if any) the project uses
 */
async function detectLinter(projectPath: string): Promise<LinterConfig> {
  const checkFile = async (path: string) => {
    return await Bun.file(join(projectPath, path)).exists();
  };

  // Check for ESLint
  const eslintConfigs = [
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    "eslint.config.js",
  ];
  
  for (const config of eslintConfigs) {
    if (await checkFile(config)) {
      return {
        name: "eslint",
        command: "npx eslint",
        config_file: config,
        autofix_command: "npx eslint --fix",
      };
    }
  }

  // Check for Biome
  if (await checkFile("biome.json")) {
    return {
      name: "biome",
      command: "bunx biome check",
      config_file: "biome.json",
      autofix_command: "bunx biome check --apply",
    };
  }

  // No linter detected
  return {
    name: null,
    command: null,
    config_file: null,
    autofix_command: null,
  };
}
```

#### Protocol Definition (Simplified)

```typescript
interface StyleCheckResult {
  has_linter: boolean;
  linter_name: string | null;
  passed: boolean;
  violations: StyleViolation[];
  autofix_available: boolean;
  message: string;
}

interface StyleViolation {
  file: string;
  line?: number;
  column?: number;
  rule: string;
  message: string;
  severity: "error" | "warning" | "info";
}
```

#### Delegate to Existing Linters

**Don't reinvent the wheel. Use what's already there.**

**Detection → Delegation Table:**

| **Detected Linter** | **Check Command** | **Autofix Command** | **When to Run** |
|---------------------|-------------------|---------------------|-----------------|
| ESLint | `npx eslint <files>` | `npx eslint --fix <files>` | If `.eslintrc*` exists |
| Biome | `bunx biome check <files>` | `bunx biome check --apply <files>` | If `biome.json` exists |
| None | Skip gracefully | N/A | No config = no enforcement |

**Implementation:**

```typescript
/**
 * Run style check by delegating to detected linter
 */
async function runStyleCheck(
  files: string[],
  linter: LinterConfig
): Promise<StyleCheckResult> {
  // No linter detected - skip gracefully
  if (!linter.name) {
    return {
      has_linter: false,
      linter_name: null,
      passed: true,
      violations: [],
      autofix_available: false,
      message: "No linter detected - skipping style check (this is OK)",
    };
  }

  // Run detected linter
  const fileArgs = files.join(" ");
  const result = await Bun.$`${linter.command} ${fileArgs}`
    .quiet()
    .nothrow();

  // Parse linter output (format depends on linter)
  const violations = parseLinterOutput(result.stdout.toString(), linter.name);

  return {
    has_linter: true,
    linter_name: linter.name,
    passed: result.exitCode === 0,
    violations: violations,
    autofix_available: !!linter.autofix_command,
    message: result.exitCode === 0
      ? `✓ Style check passed (${linter.name})`
      : `✗ Style violations found (${linter.name})`,
  };
}

/**
 * Parse linter output to extract violations
 */
function parseLinterOutput(
  output: string,
  linter: "eslint" | "biome"
): StyleViolation[] {
  if (linter === "eslint") {
    // ESLint outputs JSON if --format json is used
    // For simplicity, parse text output
    return parseESLintTextOutput(output);
  } else if (linter === "biome") {
    // Biome outputs structured format
    return parseBiomeOutput(output);
  }
  
  return [];
}
```

**Why This Approach?**

1. ✅ **Respects existing conventions** - Use the linter the project already chose
2. ✅ **No forced configuration** - Projects without linters aren't forced to add one
3. ✅ **Consistent with team standards** - Team's ESLint/Biome rules take precedence
4. ✅ **Less code to maintain** - We don't maintain style rules, just delegate
5. ✅ **Auto-fix available** - Use linter's built-in fix capabilities

#### Style Enforcement Tool (Simplified)

**New tool: `hive_check_style` - Delegates to detected linter**

```typescript
export const hive_check_style = tool({
  description: "Check files for style violations using project's existing linter (ESLint/Biome). Skips gracefully if no linter detected.",
  args: {
    files: tool.schema.array(tool.schema.string())
      .describe("Files to check"),
    autofix: tool.schema.boolean().default(false)
      .describe("Automatically fix violations using linter's autofix"),
  },
  async execute(args) {
    // Step 1: Auto-detect linter
    const linter = await detectLinter(process.cwd());
    
    // Step 2: Run linter (or skip if none detected)
    const result = await runStyleCheck(args.files, linter);
    
    // Step 3: Auto-fix if requested and available
    let fixedCount = 0;
    if (args.autofix && result.autofix_available && !result.passed) {
      const fileArgs = args.files.join(" ");
      const fixResult = await Bun.$`${linter.autofix_command!} ${fileArgs}`
        .quiet()
        .nothrow();
      
      if (fixResult.exitCode === 0) {
        fixedCount = result.violations.length;
      }
    }
    
    return JSON.stringify({
      has_linter: result.has_linter,
      linter: result.linter_name,
      total_violations: result.violations.length,
      errors: result.violations.filter(v => v.severity === "error").length,
      warnings: result.violations.filter(v => v.severity === "warning").length,
      fixed: fixedCount,
      violations: result.violations.map(v => ({
        file: v.file,
        line: v.line,
        rule: v.rule,
        severity: v.severity,
        message: v.message,
      })),
      passed: result.passed,
      message: result.message,
      hint: !result.has_linter 
        ? "No linter detected. To add style checking, consider adding ESLint or Biome."
        : result.autofix_available && !args.autofix
          ? `Run with autofix=true to automatically fix violations using ${result.linter_name}`
          : undefined
    }, null, 2);
  }
});
```

**Key Benefits:**
1. ✅ **Zero new rules** - Delegates to existing linter rules
2. ✅ **Respects team choices** - Uses the linter the project already configured
3. ✅ **Graceful degradation** - No linter = no enforcement (not an error)
4. ✅ **Built-in autofix** - Uses linter's native autofix capabilities
5. ✅ **Simple implementation** - ~30 lines vs. hundreds for custom rules

#### Integration with hive_complete

**Add optional style check to existing Verification Gate:**

```typescript
async function runVerificationGate(
  filesTouched: string[],
  conventions: ProjectConventions
): Promise<VerificationGateResult> {
  const steps: VerificationStep[] = [];
  
  // ... existing typecheck and test steps ...
  
  // Add style check (only if linter detected)
  if (conventions.has_linter) {
    const linter = await detectLinter(process.cwd());
    const styleResult = await runStyleCheck(filesTouched, linter);
    
    steps.push({
      name: "style_check",
      passed: styleResult.passed,
      skipped: false,
      message: styleResult.message,
      error: styleResult.passed 
        ? undefined 
        : `${styleResult.violations.length} violations found`,
    });
    
    // Only block on style ERRORS, not warnings
    const styleErrors = styleResult.violations.filter(v => v.severity === "error");
    if (styleErrors.length > 0) {
      blockers.push(
        `Style errors: ${styleErrors.length} violation(s). Run 'hive_check_style' with autofix=true, or fix manually.`
      );
    }
  } else {
    // No linter - skip gracefully
    steps.push({
      name: "style_check",
      passed: true,
      skipped: true,
      message: "No linter detected - skipping style check",
    });
  }
  
  // ... rest of gate ...
}
```

**Philosophy:**
- ✅ **Errors block** - Style errors (if linter defines them) block completion
- ✅ **Warnings don't block** - Style warnings are reported but don't prevent completion
- ✅ **No linter = no problem** - Missing linter is not a failure condition

---

### Layer 4: Enhanced Verification Gates

**Purpose**: Strengthen existing `hive_complete` gate with progressive enforcement.

#### Reuse Existing Gate

**✅ WHAT EXISTS**: `hive-orchestrate.ts` already has `hive_complete` with typecheck + tests.

**✅ WHAT WE DO**: Add new checks to existing gate, don't replace it.

#### Protocol Definition

```typescript
interface VerificationGate {
  name: string;
  stages: VerificationStage[];
  enforcement: "strict" | "progressive" | "advisory";
}

interface VerificationStage {
  name: string;
  order: number; // Execution order
  required: boolean; // Must pass to proceed
  checks: VerificationCheck[];
}

interface VerificationCheck {
  name: string;
  run: (context: VerificationContext) => Promise<CheckResult>;
  timeout_ms?: number;
}

interface VerificationContext {
  bead_id: string;
  files_touched: string[];
  agent_name: string;
  epic_id: string;
}

interface CheckResult {
  passed: boolean;
  message: string;
  details?: string;
  suggestions?: string[];
}
```

#### Enhanced Gate Stages

**Stage 1: Pre-Verification (Quick)**
```typescript
{
  name: "pre-verification",
  order: 1,
  required: true,
  checks: [
    {
      name: "syntax_valid",
      run: async (ctx) => {
        // Quick syntax check (faster than full typecheck)
        for (const file of ctx.files_touched) {
          if (file.endsWith(".ts") || file.endsWith(".tsx")) {
            try {
              await Bun.build({
                entrypoints: [file],
                target: "node",
                minify: false,
                plugins: []
              });
            } catch (error) {
              return {
                passed: false,
                message: `Syntax error in ${file}`,
                details: error.message
              };
            }
          }
        }
        return { passed: true, message: "All files have valid syntax" };
      }
    }
  ]
}
```

**Stage 2: Type Safety (Comprehensive)**
```typescript
{
  name: "type-safety",
  order: 2,
  required: true,
  checks: [
    {
      name: "typecheck_full",
      run: async (ctx) => {
        const result = await Bun.$`tsc --noEmit`.quiet().nothrow();
        return {
          passed: result.exitCode === 0,
          message: result.exitCode === 0
            ? "Typecheck passed"
            : "Typecheck failed",
          details: result.stderr.toString(),
          suggestions: result.exitCode !== 0
            ? ["Run 'tsc --noEmit' to see full errors", "Fix type errors before completing"]
            : undefined
        };
      },
      timeout_ms: 30000 // 30 second timeout
    },
    {
      name: "no_any_types",
      run: async (ctx) => {
        // Check for 'any' type usage
        const violations: string[] = [];
        for (const file of ctx.files_touched) {
          const content = await Bun.file(file).text();
          const anyPattern = /:\s*any\b/g;
          const matches = Array.from(content.matchAll(anyPattern));
          if (matches.length > 0) {
            violations.push(`${file}: ${matches.length} usage(s) of 'any' type`);
          }
        }
        
        return {
          passed: violations.length === 0,
          message: violations.length === 0
            ? "No 'any' types found"
            : `Found ${violations.length} file(s) with 'any' types`,
          details: violations.join("\n"),
          suggestions: violations.length > 0
            ? ["Replace 'any' with specific types", "Use 'unknown' if type is truly unknown"]
            : undefined
        };
      }
    }
  ]
}
```

**Stage 3: Test Coverage (Required)**
```typescript
{
  name: "test-coverage",
  order: 3,
  required: true,
  checks: [
    {
      name: "new_tests_exist",
      run: async (ctx) => {
        // Check if test files exist for modified non-test files
        const prodFiles = ctx.files_touched.filter(f => 
          !f.includes(".test.") && !f.includes(".spec.")
        );
        
        const missingTests: string[] = [];
        for (const file of prodFiles) {
          const testFile = file.replace(/\.(ts|tsx)$/, ".test.ts");
          const exists = await Bun.file(testFile).exists();
          if (!exists) {
            missingTests.push(file);
          }
        }
        
        return {
          passed: missingTests.length === 0,
          message: missingTests.length === 0
            ? "All modified files have tests"
            : `${missingTests.length} file(s) missing tests`,
          details: missingTests.join("\n"),
          suggestions: missingTests.length > 0
            ? [`Create test files for: ${missingTests.join(", ")}`]
            : undefined
        };
      }
    },
    {
      name: "tests_pass",
      run: async (ctx) => {
        // Run tests for touched files
        const testFiles = ctx.files_touched.filter(f =>
          f.includes(".test.") || f.includes(".spec.")
        );
        
        if (testFiles.length === 0) {
          return {
            passed: true,
            message: "No test files modified"
          };
        }
        
        const result = await Bun.$`bun test ${testFiles}`.quiet().nothrow();
        return {
          passed: result.exitCode === 0,
          message: result.exitCode === 0
            ? "All tests passed"
            : "Tests failed",
          details: result.stderr.toString(),
          suggestions: result.exitCode !== 0
            ? [`Run 'bun test ${testFiles.join(" ")}' to see failures`]
            : undefined
        };
      },
      timeout_ms: 60000 // 60 second timeout
    }
  ]
}
```

**Stage 4: Style & Consistency (Advisory)**
```typescript
{
  name: "style-consistency",
  order: 4,
  required: false, // Advisory only
  checks: [
    {
      name: "style_check",
      run: async (ctx) => {
        // Run style checks from Layer 3
        const violations = await checkAllStyles(ctx.files_touched);
        const errors = violations.filter(v => v.severity === "error");
        
        return {
          passed: errors.length === 0,
          message: errors.length === 0
            ? `${violations.length} style warnings (advisory)`
            : `${errors.length} style errors`,
          details: violations.map(v => 
            `${v.file}:${v.line} [${v.severity}] ${v.message}`
          ).join("\n"),
          suggestions: violations.length > 0
            ? ["Run 'hive_check_style' with autofix=true to auto-fix"]
            : undefined
        };
      }
    },
    {
      name: "gotcha_review",
      run: async (ctx) => {
        // Check if agent reviewed gotchas
        const gotchas = await queryGotchasForSubtask(ctx.epic_id, ctx.files_touched);
        
        // This is advisory - just inform about gotchas
        return {
          passed: true,
          message: gotchas.length > 0
            ? `${gotchas.length} gotcha(s) relevant to your work`
            : "No relevant gotchas",
          details: gotchas.map(g => 
            `[${g.severity}] ${g.title}: ${g.mitigation}`
          ).join("\n"),
          suggestions: gotchas.length > 0
            ? ["Review gotchas to ensure you've addressed them"]
            : undefined
        };
      }
    }
  ]
}
```

#### Progressive Enforcement

**Enforcement Modes:**

1. **Strict Mode** (default)
   - All required checks must pass
   - Advisory checks are reported but don't block

2. **Progressive Mode** (for gradual adoption)
   - First failure: Warning only
   - Second failure: Block with "are you sure?" override
   - Third failure: Hard block (requires fix)

3. **Advisory Mode** (for legacy codebases)
   - All checks are advisory
   - Nothing blocks completion
   - Violations tracked in learning.ts

```typescript
interface EnforcementTracker {
  getFailureCount(bead_id: string, check_name: string): Promise<number>;
  recordFailure(bead_id: string, check_name: string): Promise<void>;
  resetFailures(bead_id: string, check_name: string): Promise<void>;
}

async function enforceGate(
  result: VerificationGateResult,
  mode: "strict" | "progressive" | "advisory",
  context: VerificationContext
): Promise<EnforcementDecision> {
  if (mode === "strict") {
    return {
      allow: result.passed,
      message: result.summary,
      override_allowed: false
    };
  }
  
  if (mode === "advisory") {
    return {
      allow: true,
      message: `Advisory: ${result.summary}`,
      override_allowed: true
    };
  }
  
  // Progressive mode
  if (result.passed) {
    return {
      allow: true,
      message: result.summary,
      override_allowed: false
    };
  }
  
  // Check failure counts for each failed check
  const tracker = getEnforcementTracker();
  for (const step of result.steps.filter(s => !s.passed)) {
    const count = await tracker.getFailureCount(context.bead_id, step.name);
    await tracker.recordFailure(context.bead_id, step.name);
    
    if (count === 0) {
      // First failure: warn only
      return {
        allow: true,
        message: `⚠️  First failure for '${step.name}' - warning only (fix before next attempt)`,
        override_allowed: true,
        warning: true
      };
    } else if (count === 1) {
      // Second failure: ask for confirmation
      return {
        allow: false,
        message: `⚠️  Second failure for '${step.name}' - override available but not recommended`,
        override_allowed: true,
        requires_confirmation: true
      };
    } else {
      // Third+ failure: hard block
      return {
        allow: false,
        message: `🛑 Multiple failures for '${step.name}' - must fix before completing`,
        override_allowed: false
      };
    }
  }
  
  return { allow: false, message: "Unexpected enforcement state" };
}
```

---

## Integration Plan

### Phase 1: Pre-Flight (Week 1)

**Tasks:**
1. Create `src/schemas/verification.ts` with protocol types
2. Implement `runPreFlightProtocol()` in `src/hive-orchestrate.ts`
3. Add pre-flight to `hive_init`
4. Add `skip_preflight` flag for backwards compatibility

**Testing:**
- Unit tests for each pre-flight check
- Integration test: hive_init with failing typecheck
- Integration test: hive_init with passing checks

### Phase 2: Shared Gotchas (Week 2)

**Tasks:**
1. Add `Gotcha` types to `src/schemas/verification.ts`
2. Implement `SemanticGotchaStore` using LanceDB
3. Create `hive_report_gotcha` tool
4. Create `hive_query_gotchas` tool
5. Inject gotchas into subtask prompts

**Testing:**
- Unit tests for gotcha storage/query
- Integration test: Agent A reports gotcha, Agent B queries it
- Integration test: Gotchas appear in subtask prompts

### Phase 3: Style Enforcement (Week 3)

**Tasks:**
1. Define `StyleRule` interface
2. Implement 4 built-in rules
3. Create `hive_check_style` tool
4. Add style check to verification gate

**Testing:**
- Unit tests for each style rule
- Integration test: Style check blocks completion
- Integration test: Autofix repairs violations

### Phase 4: Enhanced Gates (Week 4)

**Tasks:**
1. Define multi-stage verification structure
2. Implement 4 stages with checks
3. Add progressive enforcement
4. Track enforcement failures

**Testing:**
- Unit tests for each check
- Integration test: Progressive mode allows first failure
- Integration test: Progressive mode blocks third failure

---

## Anti-Pattern Catalog

### Common Consistency Mistakes

#### 1. **Silent Failures**
**Anti-Pattern:**
```typescript
// Agent completes without checking if tests exist
await hive_complete({
  bead_id: "task-1",
  summary: "Implemented feature",
  files_touched: ["src/feature.ts"],
  skip_verification: true // ❌ Skipping blindly
});
```

**Correct Pattern:**
```typescript
// Check for gotchas first
const gotchas = await hive_query_gotchas({
  files: ["src/feature.ts"]
});

// Review gotchas before completing
// ... address any issues ...

// Complete with verification
await hive_complete({
  bead_id: "task-1",
  summary: "Implemented feature",
  files_touched: ["src/feature.ts"]
  // Verification runs automatically
});
```

#### 2. **Ignored Gotchas**
**Anti-Pattern:**
```typescript
// Agent discovers edge case but doesn't share
try {
  const result = processInput(null);
} catch (error) {
  // ❌ Just fixing locally, not reporting
  const result = processInput(null) ?? defaultValue;
}
```

**Correct Pattern:**
```typescript
// Agent discovers edge case and reports it
await hive_report_gotcha({
  epic_id: "epic-123",
  category: "null-handling",
  title: "processInput doesn't handle null",
  details: "processInput() throws on null input",
  mitigation: "Use default value or validate before calling",
  files_affected: ["src/processor.ts"],
  severity: "warning"
});

// Then fix locally
const result = processInput(input) ?? defaultValue;
```

#### 3. **Inconsistent Patterns**
**Anti-Pattern:**
```typescript
// Agent A uses async/await
async function fetchUserA() {
  const user = await db.query("SELECT * FROM users");
  return user;
}

// Agent B uses .then() in same codebase
function fetchUserB() {
  return db.query("SELECT * FROM users")
    .then(user => user); // ❌ Inconsistent
}
```

**Correct Pattern:**
```typescript
// Run style check before completing
await hive_check_style({
  files: ["src/userA.ts", "src/userB.ts"]
});

// Style checker catches inconsistency
// Fix to match project pattern (async/await)
async function fetchUserB() {
  const user = await db.query("SELECT * FROM users");
  return user;
}
```

#### 4. **Late Error Discovery**
**Anti-Pattern:**
```typescript
// Agent works for 30 minutes
// ... makes changes ...

// Finally tries to complete
await hive_complete({
  files_touched: ["src/big-change.ts"]
});

// ❌ Typecheck fails - wasted 30 minutes
```

**Correct Pattern:**
```typescript
// Run pre-flight before starting
await hive_init({ project_path: "." });
// Pre-flight catches broken baseline

// Work incrementally with mid-checks
// ... make changes ...

// Quick syntax check (10 seconds)
await runQuickCheck(["src/big-change.ts"]);

// ... more changes ...

// Final verification at completion
await hive_complete({
  files_touched: ["src/big-change.ts"]
});
```

---

## Metrics & Success Criteria

### Key Metrics

**1. Error Detection Timing**
- **Target**: Catch 80% of errors before `hive_complete`
- **Measure**: Pre-flight blocks / Total completion failures
- **Current baseline**: ~0% (no pre-flight checks)

**2. Gotcha Effectiveness**
- **Target**: 50% reduction in repeated mistakes
- **Measure**: (Unique gotchas reported) / (Total gotchas encountered)
- **Track**: Semantic memory queries for "gotcha" kind

**3. Style Consistency**
- **Target**: 90% of files pass style checks
- **Measure**: Files with 0 style violations / Total files modified
- **Track**: `hive_check_style` results

**4. Verification Gate Pass Rate**
- **Target**: 70% pass on first attempt (up from current ~50%)
- **Measure**: `hive_complete` success without retry / Total attempts
- **Track**: Outcome tracking in learning.ts

### Success Criteria

**Adoption (Phase 1-2)**
- ✅ Pre-flight runs in 100% of hive_init calls
- ✅ At least 5 gotchas reported per epic
- ✅ Gotchas appear in subtask prompts

**Impact (Phase 3-4)**
- ✅ 30% reduction in completion failures
- ✅ 50% reduction in 3-strike events
- ✅ 80% of agents query gotchas before starting
- ✅ Style violations decrease by 60%

**Long-term (Month 3+)**
- ✅ Semantic memory contains >100 gotchas
- ✅ Average error_count per task drops by 40%
- ✅ Agent time-to-completion improves by 25%

---

## Future Enhancements

### 1. Smart Gotcha Ranking
Use semantic similarity to show most relevant gotchas first:
```typescript
async function queryRelevantGotchas(
  files: string[],
  context: string
): Promise<Gotcha[]> {
  // Query semantic memory with context embedding
  const patterns = await storage.querySimilar(context, {
    kind: "gotcha",
    limit: 5
  });
  return patterns.map(patternToGotcha);
}
```

### 2. Cross-Epic Learning
Share gotchas across epics in same repository:
```typescript
interface GotchaScope {
  level: "epic" | "repository" | "global";
  epic_id?: string;
  repo_id?: string;
}

// Query repository-wide gotchas
const repoGotchas = await store.getByScope({
  level: "repository",
  repo_id: getCurrentRepo()
});
```

### 3. Auto-Generated Style Rules
Learn style rules from existing codebase:
```typescript
async function inferStyleRules(
  codebase: string[]
): Promise<StyleRule[]> {
  // Analyze existing code patterns
  const patterns = analyzePatterns(codebase);
  
  // Generate rules from dominant patterns
  return patterns.map(p => ({
    id: `inferred-${p.name}`,
    name: p.name,
    description: `Inferred from ${p.occurrences} examples`,
    check: createCheckFromPattern(p)
  }));
}
```

### 4. Real-time Gotcha Alerts
Push gotchas to active agents via WebSocket:
```typescript
// Agent subscribes to gotcha stream
const stream = subscribeToGotchas(epic_id);

stream.on("gotcha", (gotcha) => {
  if (isRelevantToMyWork(gotcha, myFiles)) {
    console.log(`⚠️  New gotcha: ${gotcha.title}`);
    // Optionally pause work and review
  }
});
```

### 5. Gotcha Resolution Tracking
Track which gotchas led to actual fixes:
```typescript
interface GotchaResolution {
  gotcha_id: string;
  resolved_by: string;
  resolution_type: "fixed" | "mitigated" | "not-applicable";
  details: string;
  files_changed: string[];
}

// Mark gotcha as resolved
await store.resolveGotcha(gotcha_id, {
  resolved_by: agent_name,
  resolution_type: "fixed",
  details: "Added null check in processInput()",
  files_changed: ["src/processor.ts"]
});
```

---

## Appendix A: Schema Definitions

See `src/schemas/verification.ts` for complete TypeScript definitions.

---

## Appendix B: Migration Guide

### For Existing Codebases

**Step 1: Enable Pre-Flight (Advisory Mode)**
```typescript
// Start with warnings only
hive_init({ preflight_mode: "advisory" });
```

**Step 2: Fix Baseline Issues**
```typescript
// Run pre-flight checks manually
const results = await runPreFlightProtocol();
// Address any blockers
```

**Step 3: Enable Progressive Enforcement**
```typescript
// Allow first failures, block repeated failures
hive_init({ preflight_mode: "progressive" });
```

**Step 4: Enable Strict Mode**
```typescript
// Full enforcement
hive_init({ preflight_mode: "strict" });
```

### For New Projects

Start with strict mode from day one:
```typescript
hive_init({
  preflight_mode: "strict",
  style_rules: "recommended"
});
```

---

## References

1. **Existing Code**
   - `src/hive-orchestrate.ts` - Current verification gate
   - `src/learning.ts` - Outcome tracking and 3-strike detection
   - `src/output-guardrails.ts` - Tool output validation

2. **Related Patterns**
   - "Patterns for Building AI Agents" p.31 - Subagent context sharing
   - "Patterns for Building AI Agents" p.40 - Error examination and correction
   - Gate Function (from superpowers) - IDENTIFY → RUN → READ → VERIFY → CLAIM

3. **Design Principles**
   - Fail fast (pre-flight vs. post-completion)
   - Share learnings (gotchas)
   - Consistent patterns (style enforcement)
   - Progressive adoption (advisory → strict)

---

**End of Design Specification**
