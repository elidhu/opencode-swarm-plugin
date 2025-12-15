# CLI Commands

This directory contains modular command implementations for the `hive` CLI.

## Architecture

Each command is a self-contained module that exports:
- Main command function (e.g., `syncCommand()`)
- CLI argument parser (e.g., `main()`)
- Help text function

## Commands

### sync.ts

**Purpose**: Update configuration files to match bundled templates

**Status**: ✅ Implementation complete, awaiting config.ts dependency

**Usage**:
```bash
hive sync                           # Interactive sync with prompts
hive sync --force                   # Update all without prompts
hive sync --dry-run                 # Preview what would be updated
hive sync --location plugin/hive.ts # Sync only the plugin file
```

**Features**:
- Version parsing from file headers
- Semantic version comparison
- Colorized diff display
- Interactive prompts (y/n/all/skip)
- Backup to .bak files
- Comprehensive error handling
- Summary report

**Dependencies**:
- `@clack/prompts` (installed)
- `../config` module (pending from subtask 1)

**Integration Requirements**:

The command expects `src/cli/config.ts` to export:
```typescript
// Union type of all config file locations
export type TemplateLocation = 
  | "plugin/hive.ts" 
  | "command/hive.md" 
  | "agent/hive-planner.md"
  | "agent/hive-worker.md";

// Template interface
export interface Template {
  generate: () => string;
}

// Template registry
export const templates: Record<TemplateLocation, Template>;

// Get bundled version for a location
export async function getConfigVersion(
  location: TemplateLocation
): Promise<string>;
```

**Integration Steps**:

1. Wait for `src/cli/config.ts` to be created by subtask 1
2. In `sync.ts`, uncomment line 21 (import statement)
3. Delete lines 27-37 (placeholder implementations)
4. Run `bun run typecheck` to verify
5. Test with: `bun run bin/hive.ts sync --dry-run`

**Version Header Format**:

Config files should include version headers:
```typescript
// @version 1.0.0
// or
// Version: 1.0.0
```

```markdown
<!-- @version 1.0.0 -->
```

## Adding New Commands

1. Create `src/cli/commands/your-command.ts`
2. Export `yourCommand()` function and `main()` parser
3. Import in `bin/hive.ts` and add to switch statement
4. Update this README

## Testing

```bash
# Type check
bun run typecheck

# Test specific command (when config.ts available)
bun run bin/hive.ts sync --help
```
