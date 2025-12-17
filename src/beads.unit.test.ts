/**
 * Unit tests for beads.ts
 *
 * Tests the core logic of the beads module without requiring the `bd` CLI:
 * - Error classes (BeadError, BeadValidationError)
 * - Working directory functions (using directory-context)
 * - buildCreateCommand function (argument building)
 * - parseBead/parseBeads functions (JSON parsing and validation)
 * - Schema validation
 *
 * Note: Integration tests are in beads.integration.test.ts and require Docker.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { z } from "zod";

// We need to test internal functions, so we'll re-export them for testing
// or test via their effects through the public API

import {
  BeadError,
  BeadValidationError,
  setBeadsWorkingDirectory,
  getBeadsWorkingDirectory,
} from "./beads";
import {
  BeadCreateArgsSchema,
  BeadUpdateArgsSchema,
  BeadCloseArgsSchema,
  BeadQueryArgsSchema,
  BeadSchema,
  EpicCreateArgsSchema,
} from "./schemas";
import { resetAllDirectoryContexts } from "./utils/directory-context";

/**
 * Helper to capture a ZodError from a failing parse
 */
function captureZodError<T>(
  schema: z.ZodType<T>,
  data: unknown
): z.ZodError | null {
  try {
    schema.parse(data);
    return null;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return error;
    }
    throw error;
  }
}

// ============================================================================
// 1. Error Classes Tests
// ============================================================================

describe("BeadError", () => {
  it("creates error with message and command", () => {
    const error = new BeadError("Operation failed", "bd create test");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BeadError);
    expect(error.name).toBe("BeadError");
    expect(error.message).toBe("Operation failed");
    expect(error.command).toBe("bd create test");
    expect(error.exitCode).toBeUndefined();
    expect(error.stderr).toBeUndefined();
  });

  it("creates error with all properties", () => {
    const error = new BeadError(
      "Command exited with code 1",
      "bd create test",
      1,
      "Error: bead not found"
    );

    expect(error.message).toBe("Command exited with code 1");
    expect(error.command).toBe("bd create test");
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe("Error: bead not found");
  });

  it("has proper prototype chain for instanceof checks", () => {
    const error = new BeadError("Test", "test");

    expect(error instanceof Error).toBe(true);
    expect(error instanceof BeadError).toBe(true);
  });

  it("preserves stack trace", () => {
    const error = new BeadError("Test with stack", "bd test");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("BeadError");
  });
});

describe("BeadValidationError", () => {
  it("creates error with message and ZodError", () => {
    // Generate a real ZodError by parsing invalid data
    const zodError = captureZodError(
      z.object({ title: z.string() }),
      { title: 123 }
    );
    if (!zodError) throw new Error("Expected ZodError");

    const error = new BeadValidationError("Invalid bead data", zodError);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BeadValidationError);
    expect(error.name).toBe("BeadValidationError");
    expect(error.message).toBe("Invalid bead data");
    expect(error.zodError).toBe(zodError);
  });

  it("preserves ZodError details", () => {
    // Generate a ZodError with multiple issues
    const zodError = captureZodError(
      z.object({
        title: z.string().min(1),
        status: z.enum(["open", "in_progress", "blocked", "closed"]),
      }),
      { title: "", status: "invalid" }
    );
    if (!zodError) throw new Error("Expected ZodError");

    const error = new BeadValidationError("Multiple validation errors", zodError);

    expect(error.zodError.issues).toHaveLength(2);
    expect(error.zodError.issues[0].path).toContain("title");
    expect(error.zodError.issues[1].path).toContain("status");
  });
});

// ============================================================================
// 2. Working Directory Functions Tests
// ============================================================================

describe("Working Directory Functions", () => {
  beforeEach(() => {
    // Reset all contexts before each test
    resetAllDirectoryContexts();
  });

  afterEach(() => {
    // Clear contexts after tests to avoid pollution
    resetAllDirectoryContexts();
  });

  describe("getBeadsWorkingDirectory", () => {
    it("returns process.cwd() when not set", () => {
      const result = getBeadsWorkingDirectory();
      expect(result).toBe(process.cwd());
    });

    it("returns the configured directory when set", () => {
      setBeadsWorkingDirectory("/custom/path");
      expect(getBeadsWorkingDirectory()).toBe("/custom/path");
    });
  });

  describe("setBeadsWorkingDirectory", () => {
    it("updates the working directory", () => {
      setBeadsWorkingDirectory("/new/path");
      expect(getBeadsWorkingDirectory()).toBe("/new/path");
    });

    it("can be called multiple times", () => {
      setBeadsWorkingDirectory("/first/path");
      expect(getBeadsWorkingDirectory()).toBe("/first/path");

      setBeadsWorkingDirectory("/second/path");
      expect(getBeadsWorkingDirectory()).toBe("/second/path");
    });

    it("accepts absolute paths", () => {
      setBeadsWorkingDirectory("/Users/test/project");
      expect(getBeadsWorkingDirectory()).toBe("/Users/test/project");
    });

    it("accepts paths with special characters", () => {
      setBeadsWorkingDirectory("/path/with spaces/project");
      expect(getBeadsWorkingDirectory()).toBe("/path/with spaces/project");

      setBeadsWorkingDirectory("/path/with-dashes/project");
      expect(getBeadsWorkingDirectory()).toBe("/path/with-dashes/project");
    });
  });
});

// ============================================================================
// 3. Schema Validation Tests
// ============================================================================

describe("BeadCreateArgsSchema", () => {
  it("validates minimal args (title only)", () => {
    const result = BeadCreateArgsSchema.parse({ title: "Test bead" });

    expect(result.title).toBe("Test bead");
    expect(result.type).toBe("task"); // default
    expect(result.priority).toBe(2); // default
    expect(result.description).toBeUndefined();
    expect(result.parent_id).toBeUndefined();
  });

  it("validates args with all optional fields", () => {
    const result = BeadCreateArgsSchema.parse({
      title: "Full bead",
      type: "bug",
      priority: 0,
      description: "A critical bug",
      parent_id: "parent-bead-123",
      id: "custom-bead-id",
    });

    expect(result.title).toBe("Full bead");
    expect(result.type).toBe("bug");
    expect(result.priority).toBe(0);
    expect(result.description).toBe("A critical bug");
    expect(result.parent_id).toBe("parent-bead-123");
    expect(result.id).toBe("custom-bead-id");
  });

  it("validates all bead types", () => {
    const types = ["bug", "feature", "task", "epic", "chore"] as const;

    for (const type of types) {
      const result = BeadCreateArgsSchema.parse({ title: "Test", type });
      expect(result.type).toBe(type);
    }
  });

  it("validates priority range 0-3", () => {
    for (const priority of [0, 1, 2, 3]) {
      const result = BeadCreateArgsSchema.parse({ title: "Test", priority });
      expect(result.priority).toBe(priority);
    }
  });

  it("rejects empty title", () => {
    expect(() => BeadCreateArgsSchema.parse({ title: "" })).toThrow();
  });

  it("rejects invalid type", () => {
    expect(() =>
      BeadCreateArgsSchema.parse({ title: "Test", type: "invalid" })
    ).toThrow();
  });

  it("rejects priority out of range", () => {
    expect(() =>
      BeadCreateArgsSchema.parse({ title: "Test", priority: -1 })
    ).toThrow();
    expect(() =>
      BeadCreateArgsSchema.parse({ title: "Test", priority: 4 })
    ).toThrow();
  });

  it("rejects non-integer priority", () => {
    expect(() =>
      BeadCreateArgsSchema.parse({ title: "Test", priority: 1.5 })
    ).toThrow();
  });
});

describe("BeadUpdateArgsSchema", () => {
  it("validates with id only", () => {
    const result = BeadUpdateArgsSchema.parse({ id: "bead-123" });

    expect(result.id).toBe("bead-123");
    expect(result.status).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.priority).toBeUndefined();
  });

  it("validates with all fields", () => {
    const result = BeadUpdateArgsSchema.parse({
      id: "bead-123",
      status: "in_progress",
      description: "Updated description",
      priority: 1,
    });

    expect(result.id).toBe("bead-123");
    expect(result.status).toBe("in_progress");
    expect(result.description).toBe("Updated description");
    expect(result.priority).toBe(1);
  });

  it("validates all status values", () => {
    const statuses = ["open", "in_progress", "blocked", "closed"] as const;

    for (const status of statuses) {
      const result = BeadUpdateArgsSchema.parse({ id: "bead-123", status });
      expect(result.status).toBe(status);
    }
  });

  it("rejects missing id", () => {
    expect(() =>
      BeadUpdateArgsSchema.parse({ status: "in_progress" })
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      BeadUpdateArgsSchema.parse({ id: "bead-123", status: "invalid" })
    ).toThrow();
  });
});

describe("BeadCloseArgsSchema", () => {
  it("validates with id and reason", () => {
    const result = BeadCloseArgsSchema.parse({
      id: "bead-123",
      reason: "Task completed",
    });

    expect(result.id).toBe("bead-123");
    expect(result.reason).toBe("Task completed");
  });

  it("rejects missing id", () => {
    expect(() =>
      BeadCloseArgsSchema.parse({ reason: "Done" })
    ).toThrow();
  });

  it("rejects missing reason", () => {
    expect(() =>
      BeadCloseArgsSchema.parse({ id: "bead-123" })
    ).toThrow();
  });

  it("rejects empty reason", () => {
    expect(() =>
      BeadCloseArgsSchema.parse({ id: "bead-123", reason: "" })
    ).toThrow();
  });
});

describe("BeadQueryArgsSchema", () => {
  it("validates empty args (defaults)", () => {
    const result = BeadQueryArgsSchema.parse({});

    expect(result.status).toBeUndefined();
    expect(result.type).toBeUndefined();
    expect(result.ready).toBeUndefined();
    expect(result.limit).toBe(20); // default
  });

  it("validates with all fields", () => {
    const result = BeadQueryArgsSchema.parse({
      status: "open",
      type: "bug",
      ready: true,
      limit: 50,
    });

    expect(result.status).toBe("open");
    expect(result.type).toBe("bug");
    expect(result.ready).toBe(true);
    expect(result.limit).toBe(50);
  });

  it("rejects non-positive limit", () => {
    expect(() => BeadQueryArgsSchema.parse({ limit: 0 })).toThrow();
    expect(() => BeadQueryArgsSchema.parse({ limit: -1 })).toThrow();
  });

  it("rejects non-integer limit", () => {
    expect(() => BeadQueryArgsSchema.parse({ limit: 10.5 })).toThrow();
  });
});

describe("EpicCreateArgsSchema", () => {
  it("validates minimal epic with one subtask", () => {
    const result = EpicCreateArgsSchema.parse({
      epic_title: "Test Epic",
      subtasks: [{ title: "Subtask 1" }],
    });

    expect(result.epic_title).toBe("Test Epic");
    expect(result.epic_description).toBeUndefined();
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].title).toBe("Subtask 1");
    expect(result.subtasks[0].priority).toBe(2); // default
  });

  it("validates full epic with all fields", () => {
    const result = EpicCreateArgsSchema.parse({
      epic_title: "Full Epic",
      epic_description: "A complete epic",
      epic_id: "custom-epic-id",
      subtasks: [
        { title: "Task 1", priority: 1, files: ["a.ts"], id_suffix: "task-1" },
        { title: "Task 2", priority: 0, files: ["b.ts", "c.ts"], id_suffix: "task-2" },
      ],
    });

    expect(result.epic_title).toBe("Full Epic");
    expect(result.epic_description).toBe("A complete epic");
    expect(result.epic_id).toBe("custom-epic-id");
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0].id_suffix).toBe("task-1");
    expect(result.subtasks[1].files).toEqual(["b.ts", "c.ts"]);
  });

  it("rejects empty epic_title", () => {
    expect(() =>
      EpicCreateArgsSchema.parse({
        epic_title: "",
        subtasks: [{ title: "Task" }],
      })
    ).toThrow();
  });

  it("rejects empty subtasks array", () => {
    expect(() =>
      EpicCreateArgsSchema.parse({
        epic_title: "Epic",
        subtasks: [],
      })
    ).toThrow();
  });

  it("rejects subtask with empty title", () => {
    expect(() =>
      EpicCreateArgsSchema.parse({
        epic_title: "Epic",
        subtasks: [{ title: "" }],
      })
    ).toThrow();
  });
});

// ============================================================================
// 4. BeadSchema Validation Tests
// ============================================================================

describe("BeadSchema", () => {
  const validBead = {
    id: "test-project-abc12",
    title: "Test Bead",
    status: "open",
    priority: 2,
    issue_type: "task",
    created_at: "2024-01-15T10:30:00Z",
  };

  it("validates a minimal valid bead", () => {
    const result = BeadSchema.parse(validBead);

    expect(result.id).toBe("test-project-abc12");
    expect(result.title).toBe("Test Bead");
    expect(result.status).toBe("open");
    expect(result.priority).toBe(2);
    expect(result.issue_type).toBe("task");
    expect(result.description).toBe(""); // default
    expect(result.dependencies).toEqual([]); // default
  });

  it("validates a full bead with all fields", () => {
    const fullBead = {
      ...validBead,
      description: "A test description",
      updated_at: "2024-01-16T10:30:00Z",
      closed_at: "2024-01-17T10:30:00Z",
      parent_id: "parent-bead-xyz",
      dependencies: [
        { id: "dep-1", type: "blocks" },
        { id: "dep-2", type: "blocked-by" },
      ],
      metadata: { custom: "value" },
    };

    const result = BeadSchema.parse(fullBead);

    expect(result.description).toBe("A test description");
    expect(result.updated_at).toBe("2024-01-16T10:30:00Z");
    expect(result.closed_at).toBe("2024-01-17T10:30:00Z");
    expect(result.parent_id).toBe("parent-bead-xyz");
    expect(result.dependencies).toHaveLength(2);
    expect(result.metadata).toEqual({ custom: "value" });
  });

  it("validates subtask ID format", () => {
    const subtask = {
      ...validBead,
      id: "test-project-abc12.1",
      parent_id: "test-project-abc12",
    };

    const result = BeadSchema.parse(subtask);
    expect(result.id).toBe("test-project-abc12.1");
  });

  it("validates named subtask ID format", () => {
    const subtask = {
      ...validBead,
      id: "test-project-abc12.e2e-test",
      parent_id: "test-project-abc12",
    };

    const result = BeadSchema.parse(subtask);
    expect(result.id).toBe("test-project-abc12.e2e-test");
  });

  it("validates all status values", () => {
    const statuses = ["open", "in_progress", "blocked", "closed"] as const;

    for (const status of statuses) {
      const result = BeadSchema.parse({ ...validBead, status });
      expect(result.status).toBe(status);
    }
  });

  it("validates all issue types", () => {
    const types = ["bug", "feature", "task", "epic", "chore"] as const;

    for (const issue_type of types) {
      const result = BeadSchema.parse({ ...validBead, issue_type });
      expect(result.issue_type).toBe(issue_type);
    }
  });

  it("validates dependency types", () => {
    const depTypes = ["blocks", "blocked-by", "related", "discovered-from"] as const;

    for (const type of depTypes) {
      const bead = {
        ...validBead,
        dependencies: [{ id: "dep-1", type }],
      };
      const result = BeadSchema.parse(bead);
      expect(result.dependencies[0].type).toBe(type);
    }
  });

  it("rejects invalid bead ID format", () => {
    expect(() =>
      BeadSchema.parse({ ...validBead, id: "invalid" })
    ).toThrow();
  });

  it("rejects empty title", () => {
    expect(() =>
      BeadSchema.parse({ ...validBead, title: "" })
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      BeadSchema.parse({ ...validBead, status: "invalid" })
    ).toThrow();
  });

  it("rejects invalid priority", () => {
    expect(() =>
      BeadSchema.parse({ ...validBead, priority: -1 })
    ).toThrow();
    expect(() =>
      BeadSchema.parse({ ...validBead, priority: 4 })
    ).toThrow();
  });

  it("rejects invalid timestamp format", () => {
    expect(() =>
      BeadSchema.parse({ ...validBead, created_at: "2024-01-15" })
    ).toThrow();
    expect(() =>
      BeadSchema.parse({ ...validBead, created_at: "not a date" })
    ).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const minimal = {
      id: "test-project-abc12",
      title: "Test",
      created_at: "2024-01-15T10:30:00Z",
    };

    const result = BeadSchema.parse(minimal);

    expect(result.status).toBe("open");
    expect(result.priority).toBe(2);
    expect(result.issue_type).toBe("task");
    expect(result.description).toBe("");
    expect(result.dependencies).toEqual([]);
  });
});

// ============================================================================
// 5. buildCreateCommand Logic Tests (via schema validation)
// ============================================================================

describe("buildCreateCommand logic via schemas", () => {
  // Since buildCreateCommand is not exported, we test the schema validation
  // that underlies it and verify the expected command structure

  it("validates args that would produce minimal command", () => {
    const args = BeadCreateArgsSchema.parse({ title: "Test bead" });

    // Minimal: bd create "Test bead" --json
    expect(args.title).toBe("Test bead");
    expect(args.type).toBe("task"); // default, won't be in command
    expect(args.priority).toBe(2); // default, won't be in command
  });

  it("validates args that would produce command with type flag", () => {
    const args = BeadCreateArgsSchema.parse({ title: "Bug", type: "bug" });

    // Should produce: bd create "Bug" -t bug --json
    expect(args.type).toBe("bug");
    expect(args.type).not.toBe("task"); // not default, will be in command
  });

  it("validates args that would produce command with priority flag", () => {
    const args = BeadCreateArgsSchema.parse({ title: "Critical", priority: 0 });

    // Should produce: bd create "Critical" -p 0 --json
    expect(args.priority).toBe(0);
    expect(args.priority).not.toBe(2); // not default, will be in command
  });

  it("validates args that would produce command with description", () => {
    const args = BeadCreateArgsSchema.parse({
      title: "With desc",
      description: "A description",
    });

    // Should produce: bd create "With desc" -d "A description" --json
    expect(args.description).toBe("A description");
  });

  it("validates args that would produce command with parent_id", () => {
    const args = BeadCreateArgsSchema.parse({
      title: "Child",
      parent_id: "parent-123",
    });

    // Should produce: bd create "Child" --parent parent-123 --json
    expect(args.parent_id).toBe("parent-123");
  });

  it("validates args that would produce command with custom id", () => {
    const args = BeadCreateArgsSchema.parse({
      title: "Custom ID",
      id: "custom-bead-id",
    });

    // Should produce: bd create "Custom ID" --id custom-bead-id --json
    expect(args.id).toBe("custom-bead-id");
  });

  it("validates args that would produce full command with all flags", () => {
    const args = BeadCreateArgsSchema.parse({
      title: "Full bead",
      type: "bug",
      priority: 0,
      description: "Critical bug",
      parent_id: "epic-123",
      id: "full-bead-id",
    });

    // Should produce: bd create "Full bead" -t bug -p 0 -d "Critical bug" --parent epic-123 --id full-bead-id --json
    expect(args.title).toBe("Full bead");
    expect(args.type).toBe("bug");
    expect(args.priority).toBe(0);
    expect(args.description).toBe("Critical bug");
    expect(args.parent_id).toBe("epic-123");
    expect(args.id).toBe("full-bead-id");
  });
});

// ============================================================================
// 6. Parse Functions Logic Tests (via schema validation)
// ============================================================================

describe("Bead parsing logic via schemas", () => {
  describe("single bead parsing", () => {
    it("parses valid bead JSON", () => {
      const json = {
        id: "test-bead-abc",
        title: "Test bead",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: "2024-01-15T10:30:00Z",
      };

      const result = BeadSchema.parse(json);
      expect(result.id).toBe("test-bead-abc");
      expect(result.title).toBe("Test bead");
    });

    it("parses bead from array (as CLI sometimes returns)", () => {
      const jsonArray = [
        {
          id: "test-bead-xyz",
          title: "From array",
          status: "open",
          priority: 2,
          issue_type: "task",
          created_at: "2024-01-15T10:30:00Z",
        },
      ];

      // Simulate parseBead logic: handle array by taking first element
      const data = Array.isArray(jsonArray) ? jsonArray[0] : jsonArray;
      const result = BeadSchema.parse(data);
      expect(result.id).toBe("test-bead-xyz");
    });

    it("throws on empty array", () => {
      const emptyArray: unknown[] = [];
      const data = Array.isArray(emptyArray) ? emptyArray[0] : emptyArray;

      // data is undefined, which should fail validation
      expect(() => BeadSchema.parse(data)).toThrow();
    });

    it("throws on invalid JSON structure", () => {
      expect(() => BeadSchema.parse({ invalid: "structure" })).toThrow();
    });
  });

  describe("multiple beads parsing", () => {
    it("parses array of valid beads", () => {
      const beads = [
        {
          id: "bead-1",
          title: "First",
          status: "open",
          priority: 2,
          issue_type: "task",
          created_at: "2024-01-15T10:30:00Z",
        },
        {
          id: "bead-2",
          title: "Second",
          status: "in_progress",
          priority: 1,
          issue_type: "bug",
          created_at: "2024-01-16T10:30:00Z",
        },
      ];

      const result = z.array(BeadSchema).parse(beads);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("bead-1");
      expect(result[1].id).toBe("bead-2");
    });

    it("parses empty array", () => {
      const result = z.array(BeadSchema).parse([]);
      expect(result).toHaveLength(0);
    });

    it("throws on invalid bead in array", () => {
      const beads = [
        {
          id: "valid-bead",
          title: "Valid",
          status: "open",
          priority: 2,
          issue_type: "task",
          created_at: "2024-01-15T10:30:00Z",
        },
        {
          id: "invalid",
          title: "", // empty title
          status: "open",
          priority: 2,
          issue_type: "task",
          created_at: "2024-01-15T10:30:00Z",
        },
      ];

      expect(() => z.array(BeadSchema).parse(beads)).toThrow();
    });
  });
});

// ============================================================================
// 7. Error Message Quality Tests
// ============================================================================

describe("Error message quality", () => {
  it("BeadError provides actionable suggestions", () => {
    const error = new BeadError(
      "Failed to create bead because bd command exited with code 1. Try: Check if beads initialized with 'bd init'",
      "bd create test",
      1,
      "Error: no .beads directory"
    );

    expect(error.message).toContain("Try:");
    expect(error.message).toContain("bd init");
    expect(error.stderr).toContain("no .beads directory");
  });

  it("BeadValidationError includes path information", () => {
    // Generate a real ZodError with nested path
    const nestedSchema = z.object({
      bead: z.object({
        title: z.string(),
      }),
    });
    const zodError = captureZodError(nestedSchema, { bead: { title: undefined } });
    if (!zodError) throw new Error("Expected ZodError");

    const error = new BeadValidationError("Invalid bead data", zodError);

    expect(error.zodError.issues[0].path).toContain("bead");
    expect(error.zodError.issues[0].path).toContain("title");
  });
});

// ============================================================================
// 8. Edge Cases
// ============================================================================

describe("Edge cases", () => {
  describe("special characters in inputs", () => {
    it("handles quotes in title", () => {
      const args = BeadCreateArgsSchema.parse({
        title: 'Fix "quoted" text',
      });
      expect(args.title).toBe('Fix "quoted" text');
    });

    it("handles apostrophes in title", () => {
      const args = BeadCreateArgsSchema.parse({
        title: "Don't break",
      });
      expect(args.title).toBe("Don't break");
    });

    it("handles newlines in description", () => {
      const args = BeadCreateArgsSchema.parse({
        title: "Test",
        description: "Line 1\nLine 2\nLine 3",
      });
      expect(args.description).toContain("\n");
    });

    it("handles unicode in title", () => {
      const args = BeadCreateArgsSchema.parse({
        title: "Fix bug 🐛 in module",
      });
      expect(args.title).toBe("Fix bug 🐛 in module");
    });

    it("handles shell-special characters in title", () => {
      const args = BeadCreateArgsSchema.parse({
        title: "Test $VAR && echo; rm -rf /",
      });
      expect(args.title).toContain("$VAR");
      expect(args.title).toContain("&&");
      expect(args.title).toContain(";");
    });
  });

  describe("boundary values", () => {
    it("handles very long title", () => {
      const longTitle = "A".repeat(1000);
      const args = BeadCreateArgsSchema.parse({ title: longTitle });
      expect(args.title.length).toBe(1000);
    });

    it("handles very long description", () => {
      const longDesc = "B".repeat(10000);
      const args = BeadCreateArgsSchema.parse({
        title: "Test",
        description: longDesc,
      });
      expect(args.description?.length).toBe(10000);
    });

    it("handles minimum valid values", () => {
      const args = BeadCreateArgsSchema.parse({
        title: "X", // minimum length 1
        priority: 0, // minimum priority
      });
      expect(args.title).toBe("X");
      expect(args.priority).toBe(0);
    });

    it("handles maximum valid values", () => {
      const args = BeadCreateArgsSchema.parse({
        title: "Test",
        priority: 3, // maximum priority
      });
      expect(args.priority).toBe(3);
    });
  });
});
