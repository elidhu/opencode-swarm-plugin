/**
 * Directory Context Utility
 *
 * A shared utility for managing working directory state across modules.
 * Replaces the duplicated module-level singleton pattern found in:
 * - beads.ts
 * - skills.ts
 * - hive-mail.ts
 * - discovery.ts
 * - spec.ts
 *
 * Design principles (from system-design skill):
 * - Deep module: Simple interface hiding state management complexity
 * - Information hiding: Each named context encapsulates its own state
 * - Define errors out of existence: Always returns a valid directory
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Callback for when directory changes (e.g., to invalidate caches)
 */
export type DirectoryChangeCallback = (
  newDir: string,
  oldDir: string | null
) => void;

/**
 * Configuration options for creating a directory context
 */
export interface DirectoryContextOptions {
  /**
   * Default directory to use when none is explicitly set.
   * If not provided, defaults to process.cwd()
   */
  defaultDirectory?: string | (() => string);

  /**
   * Whether to return undefined instead of fallback when not explicitly set.
   * Useful for contexts that need to know if a directory was explicitly configured.
   * Default: false
   */
  strictMode?: boolean;

  /**
   * Optional callback invoked when directory changes
   */
  onChange?: DirectoryChangeCallback;
}

/**
 * A directory context instance for a specific named module
 */
export interface DirectoryContext {
  /**
   * Get the current working directory for this context.
   * Returns the set directory, or the default (process.cwd() unless configured otherwise).
   * In strict mode, returns undefined if not explicitly set.
   */
  get(): string;
  getStrict(): string | undefined;

  /**
   * Set the working directory for this context.
   * @param directory - Absolute path to the directory
   */
  set(directory: string): void;

  /**
   * Reset to unset state (will use default on next get())
   */
  reset(): void;

  /**
   * Check if a directory has been explicitly set
   */
  isSet(): boolean;

  /**
   * Execute a function with a temporary directory context.
   * Restores the previous directory after the function completes (even on error).
   *
   * @param directory - Temporary directory to use
   * @param fn - Function to execute
   * @returns The return value of fn
   */
  withContext<T>(directory: string, fn: () => T): T;

  /**
   * Execute an async function with a temporary directory context.
   * Restores the previous directory after the function completes (even on error).
   *
   * @param directory - Temporary directory to use
   * @param fn - Async function to execute
   * @returns Promise resolving to the return value of fn
   */
  withContextAsync<T>(directory: string, fn: () => Promise<T>): Promise<T>;
}

// ============================================================================
// Internal State
// ============================================================================

/** Registry of all created contexts */
const contexts = new Map<string, DirectoryContext>();

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create or retrieve a named directory context.
 *
 * Each named context maintains its own independent directory state.
 * Calling with the same name returns the same context instance.
 *
 * @param name - Unique name for this context (e.g., "beads", "skills", "discovery")
 * @param options - Configuration options (only used on first creation)
 * @returns DirectoryContext instance
 *
 * @example
 * ```typescript
 * // In beads.ts
 * const beadsDir = createDirectoryContext("beads");
 * beadsDir.set("/path/to/project");
 * console.log(beadsDir.get()); // "/path/to/project"
 *
 * // In skills.ts - with cache invalidation
 * const skillsDir = createDirectoryContext("skills", {
 *   onChange: () => { skillsCache = null; }
 * });
 *
 * // Scoped operations
 * const result = beadsDir.withContext("/other/path", () => {
 *   return doSomething(beadsDir.get()); // uses "/other/path"
 * });
 * // beadsDir.get() is back to "/path/to/project"
 * ```
 */
export function createDirectoryContext(
  name: string,
  options: DirectoryContextOptions = {}
): DirectoryContext {
  // Return existing context if already created
  const existing = contexts.get(name);
  if (existing) {
    return existing;
  }

  // Internal state for this context
  let currentDirectory: string | null = null;

  const getDefault = (): string => {
    if (typeof options.defaultDirectory === "function") {
      return options.defaultDirectory();
    }
    return options.defaultDirectory ?? process.cwd();
  };

  const context: DirectoryContext = {
    get(): string {
      return currentDirectory ?? getDefault();
    },

    getStrict(): string | undefined {
      return currentDirectory ?? undefined;
    },

    set(directory: string): void {
      const oldDir = currentDirectory;
      currentDirectory = directory;
      options.onChange?.(directory, oldDir);
    },

    reset(): void {
      const oldDir = currentDirectory;
      currentDirectory = null;
      if (oldDir !== null) {
        options.onChange?.(getDefault(), oldDir);
      }
    },

    isSet(): boolean {
      return currentDirectory !== null;
    },

    withContext<T>(directory: string, fn: () => T): T {
      const previous = currentDirectory;
      currentDirectory = directory;
      try {
        return fn();
      } finally {
        currentDirectory = previous;
      }
    },

    async withContextAsync<T>(
      directory: string,
      fn: () => Promise<T>
    ): Promise<T> {
      const previous = currentDirectory;
      currentDirectory = directory;
      try {
        return await fn();
      } finally {
        currentDirectory = previous;
      }
    },
  };

  contexts.set(name, context);
  return context;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get a directory context by name (must already exist)
 *
 * @param name - Name of the context
 * @returns DirectoryContext or undefined if not created yet
 */
export function getDirectoryContext(name: string): DirectoryContext | undefined {
  return contexts.get(name);
}

/**
 * Check if a context exists
 */
export function hasDirectoryContext(name: string): boolean {
  return contexts.has(name);
}

/**
 * Get all registered context names
 */
export function listDirectoryContexts(): string[] {
  return Array.from(contexts.keys());
}

/**
 * Reset all contexts to their default state.
 * Useful for testing.
 */
export function resetAllDirectoryContexts(): void {
  contexts.forEach((context) => {
    context.reset();
  });
}

/**
 * Clear all registered contexts.
 * Useful for testing to ensure clean state.
 */
export function clearAllDirectoryContexts(): void {
  contexts.clear();
}

// ============================================================================
// Pre-defined Context Names (for consistency across modules)
// ============================================================================

/**
 * Well-known context names used across the codebase.
 * Using these constants ensures consistency and enables IDE autocomplete.
 */
export const CONTEXT_NAMES = {
  BEADS: "beads",
  SKILLS: "skills",
  HIVE_MAIL: "hive-mail",
  DISCOVERY: "discovery",
  SPEC: "spec",
} as const;

export type ContextName = (typeof CONTEXT_NAMES)[keyof typeof CONTEXT_NAMES];
