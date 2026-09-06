import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { throwUserError } from "../../convex/lib/errors";
import { errorCode, userMessage } from "./errors";

describe("userMessage", () => {
  test("reads the sentence the backend actually wrote", () => {
    // Thrown by the real helper every backend failure goes through, so this
    // breaks if either half of the pair changes shape.
    let thrown: unknown;
    try {
      throwUserError("ROOM_FULL", "This room is full. A room holds at most 8 people.");
    } catch (e) {
      thrown = e;
    }

    expect(userMessage(thrown, "Could not join that room.")).toBe(
      "This room is full. A room holds at most 8 people.",
    );
  });

  test("never renders the stringified data", () => {
    // The trap this function exists for: a ConvexError IS an Error, and its
    // `.message` is the JSON of `.data`. `e instanceof Error ? e.message : ...`
    // would put {"code":"ROOM_FULL",...} on the screen.
    const error = new ConvexError({ code: "ROOM_FULL", message: "This room is full." });

    expect(error.message).toContain("ROOM_FULL");
    expect(userMessage(error, "fallback")).toBe("This room is full.");
    expect(userMessage(error, "fallback")).not.toContain("ROOM_FULL");
  });

  test("falls back rather than leaking an internal error's text", () => {
    const internal = new Error("Uncaught TypeError: cannot read properties of undefined");

    expect(userMessage(internal, "Could not open the room.")).toBe("Could not open the room.");
  });

  test("falls back for a ConvexError carrying no message", () => {
    expect(userMessage(new ConvexError({ code: "ROOM_FULL" }), "fallback")).toBe("fallback");
    expect(userMessage(new ConvexError("a bare string"), "fallback")).toBe("fallback");
    expect(userMessage(new ConvexError({ message: "   " }), "fallback")).toBe("fallback");
    expect(userMessage(new ConvexError({ message: 404 }), "fallback")).toBe("fallback");
  });

  test("falls back for anything that is not an error at all", () => {
    expect(userMessage("just a string", "fallback")).toBe("fallback");
    expect(userMessage(undefined, "fallback")).toBe("fallback");
    expect(userMessage(null, "fallback")).toBe("fallback");
  });
});

describe("errorCode", () => {
  test("reads the code the backend actually threw", () => {
    let thrown: unknown;
    try {
      throwUserError("NOT_SIGNED_IN", "You need to sign in first.");
    } catch (e) {
      thrown = e;
    }

    expect(errorCode(thrown)).toBe("NOT_SIGNED_IN");
  });

  test("returns null for a ConvexError carrying no code", () => {
    expect(errorCode(new ConvexError({ message: "This room is full." }))).toBeNull();
    expect(errorCode(new ConvexError("a bare string"))).toBeNull();
    expect(errorCode(new ConvexError({ code: "   " }))).toBeNull();
    expect(errorCode(new ConvexError({ code: 404 }))).toBeNull();
  });

  test("returns null for anything that is not this backend's own error", () => {
    expect(errorCode(new Error("boom"))).toBeNull();
    expect(errorCode("just a string")).toBeNull();
    expect(errorCode(undefined)).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});
