/**
 * Hive Tool Helpers - Reduce boilerplate in tool definitions
 *
 * Provides helper functions to wrap common patterns like:
 * - Try/catch error handling
 * - JSON.stringify formatting
 * - Session state loading
 * - Consistent error responses
 */

import { tool } from "@opencode-ai/plugin";
import type { MailSessionState } from "./streams/events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// Types
// ============================================================================

/** Tool execution context from OpenCode plugin */
export interface ToolContext {
  sessionID: string;
}

/** Result that can be serialized to JSON */
export type ToolResult = Record<string, unknown>;

/** Handler function that returns a serializable result */
export type ToolHandler<TArgs> = (
  args: TArgs,
  state: MailSessionState | null,
  ctx: ToolContext,
) => Promise<ToolResult>;

/** Handler function that doesn't require session state */
export type StatelessToolHandler<TArgs> = (
  args: TArgs,
  ctx: ToolContext,
) => Promise<ToolResult>;

/** Type for tool schema arguments (any value is acceptable) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArgsSchema = Record<string, any>;

// ============================================================================
// Session State Management
// ============================================================================

const SESSION_STATE_DIR =
  process.env.HIVE_STATE_DIR || join(tmpdir(), "hive-sessions");

function getSessionStatePath(sessionID: string): string {
  const safeID = sessionID.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(SESSION_STATE_DIR, `${safeID}.json`);
}

export function loadSessionState(sessionID: string): MailSessionState | null {
  const path = getSessionStatePath(sessionID);
  try {
    if (existsSync(path)) {
      const data = readFileSync(path, "utf-8");
      return JSON.parse(data) as MailSessionState;
    }
  } catch (error) {
    console.warn(`[hive-tool] Could not load session state: ${error}`);
  }
  return null;
}

export function saveSessionState(
  sessionID: string,
  state: MailSessionState,
): boolean {
  try {
    if (!existsSync(SESSION_STATE_DIR)) {
      mkdirSync(SESSION_STATE_DIR, { recursive: true });
    }
    const path = getSessionStatePath(sessionID);
    writeFileSync(path, JSON.stringify(state, null, 2));
    return true;
  } catch (error) {
    console.warn(`[hive-tool] Could not save session state: ${error}`);
    return false;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a hive tool with automatic error handling and JSON formatting
 *
 * Wraps the boilerplate pattern:
 * - Try/catch with consistent error formatting
 * - JSON.stringify with proper indentation
 * - Session state loading
 *
 * @param description Tool description
 * @param argsSchema Schema definition using tool.schema
 * @param handler Handler function that receives (args, state, ctx)
 * @param options Optional configuration
 * @returns Tool definition ready to export
 *
 * @example
 * ```ts
 * export const my_tool = createHiveTool(
 *   "My tool description",
 *   {
 *     param: tool.schema.string().describe("Parameter description"),
 *   },
 *   async (args, state, ctx) => {
 *     if (!state) {
 *       throw new Error("Session not initialized");
 *     }
 *     // ... tool logic
 *     return { success: true, data: "result" };
 *   }
 * );
 * ```
 */
export function createHiveTool<TArgs = Record<string, unknown>>(
  description: string,
  argsSchema: ArgsSchema,
  handler: ToolHandler<TArgs>,
  options: {
    /** Whether to check for session initialization (default: true) */
    requireSession?: boolean;
  } = {},
): ReturnType<typeof tool> {
  const { requireSession = true } = options;

  return tool({
    description,
    args: argsSchema,
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      const sessionID = ctx.sessionID || "default";
      const state = loadSessionState(sessionID);

      // Check session requirement
      if (requireSession && !state) {
        return JSON.stringify(
          { error: "Session not initialized. Call hivemail_init first." },
          null,
          2,
        );
      }

      try {
        const result = await handler(args as TArgs, state, ctx);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify(
          {
            error: `Failed: ${error instanceof Error ? error.message : String(error)}`,
          },
          null,
          2,
        );
      }
    },
  });
}

/**
 * Create a stateless hive tool (doesn't require session)
 *
 * Similar to createHiveTool but for tools that don't need session state.
 * Use this for tools like health checks or initialization.
 *
 * @example
 * ```ts
 * export const my_stateless_tool = createStatelessHiveTool(
 *   "Tool that doesn't need session",
 *   { param: tool.schema.string() },
 *   async (args, ctx) => {
 *     return { success: true };
 *   }
 * );
 * ```
 */
export function createStatelessHiveTool<TArgs = Record<string, unknown>>(
  description: string,
  argsSchema: ArgsSchema,
  handler: StatelessToolHandler<TArgs>,
): ReturnType<typeof tool> {
  return tool({
    description,
    args: argsSchema,
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const result = await handler(args as TArgs, ctx);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify(
          {
            error: `Failed: ${error instanceof Error ? error.message : String(error)}`,
          },
          null,
          2,
        );
      }
    },
  });
}
