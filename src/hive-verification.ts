/**
 * Hive Verification Module - Verification Gate Logic
 *
 * Implements the Gate Function pattern from superpowers:
 * 1. IDENTIFY: What command proves this claim?
 * 2. RUN: Execute the FULL command (fresh, complete)
 * 3. READ: Full output, check exit code, count failures
 * 4. VERIFY: Does output confirm the claim?
 * 5. ONLY THEN: Make the claim
 *
 * This module handles verification of completed work before
 * allowing task completion:
 * - Type checking (tsc --noEmit)
 * - Test execution for touched files
 * - Failure classification
 *
 * @module hive-verification
 */

// ============================================================================
// Verification Gate Types
// ============================================================================

/**
 * Verification Gate result - tracks each verification step
 *
 * Based on the Gate Function from superpowers:
 * 1. IDENTIFY: What command proves this claim?
 * 2. RUN: Execute the FULL command (fresh, complete)
 * 3. READ: Full output, check exit code, count failures
 * 4. VERIFY: Does output confirm the claim?
 * 5. ONLY THEN: Make the claim
 */
export interface VerificationStep {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  output?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface VerificationGateResult {
  passed: boolean;
  steps: VerificationStep[];
  summary: string;
  blockers: string[];
}

// ============================================================================
// Verification Functions
// ============================================================================

/**
 * Run typecheck verification
 *
 * Attempts to run TypeScript type checking on the project.
 * Falls back gracefully if tsc is not available.
 */
export async function runTypecheckVerification(): Promise<VerificationStep> {
  const step: VerificationStep = {
    name: "typecheck",
    command: "tsc --noEmit",
    passed: false,
    exitCode: -1,
  };

  try {
    // Check if tsconfig.json exists in current directory
    const tsconfigExists = await Bun.file("tsconfig.json").exists();
    if (!tsconfigExists) {
      step.skipped = true;
      step.skipReason = "No tsconfig.json found";
      step.passed = true; // Don't block if no TypeScript
      return step;
    }

    const result = await Bun.$`tsc --noEmit`.quiet().nothrow();
    step.exitCode = result.exitCode;
    step.passed = result.exitCode === 0;

    if (!step.passed) {
      step.error = result.stderr.toString().slice(0, 1000); // Truncate for context
      step.output = result.stdout.toString().slice(0, 1000);
    }
  } catch (error) {
    step.skipped = true;
    step.skipReason = `tsc not available: ${error instanceof Error ? error.message : String(error)}`;
    step.passed = true; // Don't block if tsc unavailable
  }

  return step;
}

/**
 * Run test verification for specific files
 *
 * Attempts to find and run tests related to the touched files.
 * Uses common test patterns (*.test.ts, *.spec.ts, __tests__/).
 */
export async function runTestVerification(
  filesTouched: string[],
): Promise<VerificationStep> {
  const step: VerificationStep = {
    name: "tests",
    command: "bun test <related-files>",
    passed: false,
    exitCode: -1,
  };

  if (filesTouched.length === 0) {
    step.skipped = true;
    step.skipReason = "No files touched";
    step.passed = true;
    return step;
  }

  // Find test files related to touched files
  const testPatterns: string[] = [];
  for (const file of filesTouched) {
    // Skip if already a test file
    if (file.includes(".test.") || file.includes(".spec.")) {
      testPatterns.push(file);
      continue;
    }

    // Look for corresponding test file
    const baseName = file.replace(/\.(ts|tsx|js|jsx)$/, "");
    testPatterns.push(`${baseName}.test.ts`);
    testPatterns.push(`${baseName}.test.tsx`);
    testPatterns.push(`${baseName}.spec.ts`);
  }

  // Check if any test files exist
  const existingTests: string[] = [];
  for (const pattern of testPatterns) {
    try {
      const exists = await Bun.file(pattern).exists();
      if (exists) {
        existingTests.push(pattern);
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  if (existingTests.length === 0) {
    step.skipped = true;
    step.skipReason = "No related test files found";
    step.passed = true;
    return step;
  }

  try {
    step.command = `bun test ${existingTests.join(" ")}`;
    const result = await Bun.$`bun test ${existingTests}`.quiet().nothrow();
    step.exitCode = result.exitCode;
    step.passed = result.exitCode === 0;

    if (!step.passed) {
      step.error = result.stderr.toString().slice(0, 1000);
      step.output = result.stdout.toString().slice(0, 1000);
    }
  } catch (error) {
    step.skipped = true;
    step.skipReason = `Test runner failed: ${error instanceof Error ? error.message : String(error)}`;
    step.passed = true; // Don't block if test runner unavailable
  }

  return step;
}

/**
 * Run the full Verification Gate
 *
 * Implements the Gate Function (IDENTIFY -> RUN -> READ -> VERIFY -> CLAIM):
 * 1. Typecheck
 * 2. Tests for touched files
 *
 * All steps must pass (or be skipped with valid reason) to proceed.
 */
export async function runVerificationGate(
  filesTouched: string[],
): Promise<VerificationGateResult> {
  const steps: VerificationStep[] = [];
  const blockers: string[] = [];

  // Step 1: Typecheck
  const typecheckStep = await runTypecheckVerification();
  steps.push(typecheckStep);
  if (!typecheckStep.passed && !typecheckStep.skipped) {
    blockers.push(
      `Typecheck failed: ${typecheckStep.error?.slice(0, 100) || "type errors found"}. Try: Run 'tsc --noEmit' to see full errors, check tsconfig.json configuration, or fix reported type errors in modified files.`,
    );
  }

  // Step 2: Tests
  const testStep = await runTestVerification(filesTouched);
  steps.push(testStep);
  if (!testStep.passed && !testStep.skipped) {
    blockers.push(
      `Tests failed: ${testStep.error?.slice(0, 100) || "test failures"}. Try: Run 'bun test ${testStep.command.split(" ").slice(2).join(" ")}' to see full output, check test assertions, or fix failing tests in modified files.`,
    );
  }

  // Build summary
  const passedCount = steps.filter((s) => s.passed).length;
  const skippedCount = steps.filter((s) => s.skipped).length;
  const failedCount = steps.filter((s) => !s.passed && !s.skipped).length;

  const summary =
    failedCount === 0
      ? `Verification passed: ${passedCount} checks passed, ${skippedCount} skipped`
      : `Verification FAILED: ${failedCount} checks failed, ${passedCount} passed, ${skippedCount} skipped`;

  return {
    passed: failedCount === 0,
    steps,
    summary,
    blockers,
  };
}

/**
 * Classify failure based on error message heuristics
 *
 * Simple pattern matching to categorize why a task failed.
 * Used when failure_mode is not explicitly provided.
 *
 * @param error - Error object or message
 * @returns FailureMode classification
 */
export function classifyFailure(error: Error | string): string {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();

  if (msg.includes("timeout")) return "timeout";
  if (msg.includes("conflict") || msg.includes("reservation"))
    return "conflict";
  if (msg.includes("validation") || msg.includes("schema")) return "validation";
  if (msg.includes("context") || msg.includes("token"))
    return "context_overflow";
  if (msg.includes("blocked") || msg.includes("dependency"))
    return "dependency_blocked";
  if (msg.includes("cancel")) return "user_cancelled";

  // Check for tool failure patterns
  if (
    msg.includes("tool") ||
    msg.includes("command") ||
    msg.includes("failed to execute")
  ) {
    return "tool_failure";
  }

  return "unknown";
}

// ============================================================================
// Verification Prompt Generation
// ============================================================================

/**
 * Create a verification prompt for an agent to self-verify work
 *
 * This generates a structured prompt that guides agents through
 * verification before claiming completion.
 *
 * @param context - Context about the work to verify
 * @returns Formatted verification prompt
 */
export function createVerificationPrompt(context: {
  taskDescription: string;
  filesTouched: string[];
  expectedOutcomes?: string[];
}): string {
  const lines = [
    "## Verification Gate",
    "",
    "Before claiming this task complete, verify your work:",
    "",
    "### Task",
    context.taskDescription,
    "",
    "### Files Modified",
    ...context.filesTouched.map((f) => `- \`${f}\``),
    "",
    "### Verification Steps",
    "",
    "1. **IDENTIFY**: What command proves your changes work?",
    "   - TypeScript projects: `tsc --noEmit`",
    "   - Test files exist: `bun test <related-tests>`",
    "",
    "2. **RUN**: Execute the verification command(s) FRESH and COMPLETE",
    "",
    "3. **READ**: Check the FULL output:",
    "   - Exit code must be 0",
    "   - No errors or warnings",
    "   - All tests pass",
    "",
    "4. **VERIFY**: Does the output confirm your changes are correct?",
    "",
    "5. **ONLY THEN**: Call hive_complete with your summary",
    "",
  ];

  if (context.expectedOutcomes && context.expectedOutcomes.length > 0) {
    lines.push("### Expected Outcomes");
    lines.push("");
    context.expectedOutcomes.forEach((outcome, i) => {
      lines.push(`${i + 1}. ${outcome}`);
    });
    lines.push("");
  }

  lines.push(
    "**WARNING**: Do not skip verification. The hive_complete tool will run these checks automatically.",
  );

  return lines.join("\n");
}

/**
 * Format verification result for display
 *
 * Creates a human-readable summary of verification results
 * suitable for logging or display to users.
 *
 * @param result - Verification gate result
 * @returns Formatted string
 */
export function formatVerificationResult(result: VerificationGateResult): string {
  const lines = [
    result.passed ? "Verification PASSED" : "Verification FAILED",
    "",
    result.summary,
    "",
  ];

  if (result.steps.length > 0) {
    lines.push("### Steps");
    lines.push("");
    for (const step of result.steps) {
      const status = step.skipped
        ? `SKIPPED (${step.skipReason})`
        : step.passed
          ? "PASSED"
          : "FAILED";
      lines.push(`- ${step.name}: ${status}`);
      if (step.error && !step.passed && !step.skipped) {
        lines.push(`  Error: ${step.error.slice(0, 100)}...`);
      }
    }
    lines.push("");
  }

  if (result.blockers.length > 0) {
    lines.push("### Blockers");
    lines.push("");
    result.blockers.forEach((blocker, i) => {
      lines.push(`${i + 1}. ${blocker}`);
    });
  }

  return lines.join("\n");
}
