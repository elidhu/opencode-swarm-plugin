/**
 * CLI Executor - Unified command execution utility
 *
 * Provides a consistent interface for spawning CLI commands with:
 * - Command resolution (native vs fallback like bunx)
 * - Bun.spawn with stdout/stderr capture
 * - Exit code handling
 * - Optional working directory support
 * - Error handling with structured results
 *
 * Eliminates ~100 lines of duplicate command spawning code across modules.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a CLI command execution
 */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Options for command execution
 */
export interface ExecuteOptions {
  /** Working directory for the command (optional) */
  cwd?: string;
  /** Convert stdout/stderr to strings (default: true) */
  asString?: boolean;
}

/**
 * Command resolver function
 * Returns the full command array to execute (e.g., ["semantic-memory"] or ["bunx", "semantic-memory"])
 */
export type CommandResolver = () => Promise<string[]>;

// ============================================================================
// Core Executor
// ============================================================================

/**
 * Execute a CLI command with unified error handling
 *
 * @param command - Command array (e.g., ["bd", "list", "--json"])
 * @param options - Execution options (working directory, etc.)
 * @returns Command result with exit code and output
 *
 * @example
 * ```typescript
 * // Simple command
 * const result = await executeCommand(["bd", "list", "--json"]);
 *
 * // With working directory
 * const result = await executeCommand(["bd", "list"], { cwd: "/path/to/project" });
 * ```
 */
export async function executeCommand(
  command: string[],
  options: ExecuteOptions = {},
): Promise<CommandResult> {
  const { cwd, asString = true } = options;

  try {
    const proc = Bun.spawn(command, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Capture output
    const stdoutBuffer = Buffer.from(await new Response(proc.stdout).arrayBuffer());
    const stderrBuffer = Buffer.from(await new Response(proc.stderr).arrayBuffer());

    // Wait for process to exit
    const exitCode = await proc.exited;

    // Ensure cleanup
    try {
      proc.kill();
    } catch {
      // Ignore errors from killing already-exited process
    }

    // Convert to strings if requested
    const stdout = asString ? stdoutBuffer.toString() : stdoutBuffer.toString();
    const stderr = asString ? stderrBuffer.toString() : stderrBuffer.toString();

    return { exitCode, stdout, stderr };
  } catch (error) {
    // Return structured error result on exceptions
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Error executing command ${command[0]}: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Command Resolution with Caching
// ============================================================================

/**
 * Create a cached command resolver
 *
 * Resolves a command once (e.g., checking for native install vs bunx fallback)
 * and caches the result for subsequent calls.
 *
 * @param resolver - Function that resolves the command
 * @returns Cached resolver function
 *
 * @example
 * ```typescript
 * const resolveSemanticMemory = createCachedResolver(async () => {
 *   const nativeResult = await executeCommand(["which", "semantic-memory"]);
 *   if (nativeResult.exitCode === 0) {
 *     return ["semantic-memory"];
 *   }
 *   return ["bunx", "semantic-memory"];
 * });
 *
 * // First call does resolution
 * const cmd1 = await resolveSemanticMemory(); // ["semantic-memory"]
 * // Second call uses cache
 * const cmd2 = await resolveSemanticMemory(); // ["semantic-memory"] (cached)
 * ```
 */
export function createCachedResolver(resolver: CommandResolver): CommandResolver {
  let cachedCommand: string[] | null = null;

  return async () => {
    if (cachedCommand) {
      return cachedCommand;
    }
    cachedCommand = await resolver();
    return cachedCommand;
  };
}

/**
 * Create a resettable cached resolver
 *
 * Returns both the resolver and a reset function.
 *
 * @example
 * ```typescript
 * const [resolveSemanticMemory, resetCache] = createResettableResolver(async () => {
 *   const which = await executeCommand(["which", "semantic-memory"]);
 *   return which.exitCode === 0 ? ["semantic-memory"] : ["bunx", "semantic-memory"];
 * });
 *
 * // Use resolver
 * const cmd = await resolveSemanticMemory();
 *
 * // Reset cache for testing
 * resetCache();
 * ```
 */
export function createResettableResolver(
  resolver: CommandResolver,
): [CommandResolver, () => void] {
  let cachedCommand: string[] | null = null;

  const resettableResolver = async () => {
    if (cachedCommand) {
      return cachedCommand;
    }
    cachedCommand = await resolver();
    return cachedCommand;
  };

  const reset = () => {
    cachedCommand = null;
  };

  return [resettableResolver, reset];
}

// ============================================================================
// Convenience Wrappers
// ============================================================================

/**
 * Execute a command with a resolver
 *
 * Combines command resolution and execution in one call.
 *
 * @param resolver - Function that resolves the command
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Command result
 *
 * @example
 * ```typescript
 * const resolveSemanticMemory = createCachedResolver(async () => {
 *   const which = await executeCommand(["which", "semantic-memory"]);
 *   return which.exitCode === 0 ? ["semantic-memory"] : ["bunx", "semantic-memory"];
 * });
 *
 * // Execute with resolution
 * const result = await executeWithResolver(
 *   resolveSemanticMemory,
 *   ["store", "content", "--collection", "test"]
 * );
 * ```
 */
export async function executeWithResolver(
  resolver: CommandResolver,
  args: string[],
  options: ExecuteOptions = {},
): Promise<CommandResult> {
  const command = await resolver();
  return executeCommand([...command, ...args], options);
}

/**
 * Check if a command is available
 *
 * @param command - Command to check (e.g., "semantic-memory")
 * @returns True if command is available
 *
 * @example
 * ```typescript
 * if (await isCommandAvailable("semantic-memory")) {
 *   console.log("semantic-memory is installed");
 * }
 * ```
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  // Try 'which' on Unix-like systems
  const result = await executeCommand(["which", command]);
  return result.exitCode === 0;
}
