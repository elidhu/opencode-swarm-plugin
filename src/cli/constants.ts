/**
 * CLI Constants
 * 
 * Shared constants for dependencies and model options.
 */

// ============================================================================
// Types
// ============================================================================

export interface Dependency {
  name: string;
  command: string;
  checkArgs: string[];
  install: string;
  installType: "brew" | "curl" | "npm" | "manual";
  description: string;
}

export interface ModelOption {
  value: string;
  label: string;
  hint: string;
}

// ============================================================================
// Dependencies
// ============================================================================

// Only required dependencies - hive is self-contained and zero-config
// semantic-memory was intentionally removed (requires Ollama service, violates zero-config)
// We use embedded LanceDB for vector storage instead
export const DEPENDENCIES: Dependency[] = [
  {
    name: "OpenCode",
    command: "opencode",
    checkArgs: ["--version"],
    install: "brew install sst/tap/opencode",
    installType: "brew",
    description: "AI coding assistant (plugin host)",
  },
  {
    name: "Beads",
    command: "bd",
    checkArgs: ["--version"],
    install: "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash",
    installType: "curl",
    description: "Git-backed issue tracking",
  },
];

// ============================================================================
// Model Options
// ============================================================================

export const COORDINATOR_MODELS: ModelOption[] = [
  { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", hint: "Recommended" },
  { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", hint: "Most capable" },
  { value: "openai/gpt-4o", label: "GPT-4o", hint: "Fast" },
  { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Fast" },
];

export const WORKER_MODELS: ModelOption[] = [
  { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Recommended" },
  { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", hint: "More capable" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast and cheap" },
  { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Fast" },
];
