/**
 * OpenCode Plugin Entry Point
 *
 * CRITICAL: Only export the plugin function from this file.
 *
 * OpenCode's plugin loader calls ALL exports as functions during initialization.
 * Exporting classes, constants, or non-function values will cause the plugin
 * to fail to load with cryptic errors.
 *
 * If you need to export utilities for external use, add them to src/index.ts instead.
 *
 * @example
 * // ✅ CORRECT - only export the plugin function
 * export default HivePlugin;
 *
 * // ❌ WRONG - will break plugin loading
 * export const VERSION = "1.0.0";
 * export class Helper {}
 */
import { HivePlugin } from "./index";

// Only export the plugin function - nothing else!
export { HivePlugin };
