import { describe, expect, test } from "vitest";
import {
  MOOD_LABEL,
  NAV_ROOMS_SHOWN,
  STATUS_LABEL,
  navRoomsModel,
  type MyRoom,
} from "../../../../src/lib/shell/rooms";

function room(code: string, over: Partial<MyRoom> = {}): MyRoom {
  return {
    code,
    mood: "grass",
    status: "lobby",
    whenAt: 1_800_000_000_000,
    isHost: true,
    demo: false,
    ...over,
  };
}

describe("navRoomsModel", () => {
  test("says the moods and statuses in the same words the settings screen uses", () => {
    const { rows } = navRoomsModel([room("8363", { mood: "hangout", status: "booked" })]);
    expect(rows[0].label).toBe(MOOD_LABEL.hangout);
    expect(rows[0].sub).toBe(STATUS_LABEL.booked);
  });

  test("every row goes to its own room", () => {
    const { rows } = navRoomsModel([room("8363"), room("7728")]);
    expect(rows.map((r) => r.href)).toEqual(["/room/8363", "/room/7728"]);
  });

  // The room you are standing in is already named on "Your room" three rows up.
  test("leaves out the room you are currently in", () => {
    const { rows } = navRoomsModel([room("8363"), room("7728")], "8363");
    expect(rows.map((r) => r.code)).toEqual(["7728"]);
  });

  test("being in a room lets one more of the others through", () => {
    const all = ["1", "2", "3", "4", "5"].map((c) => room(c));
    expect(navRoomsModel(all).rows).toHaveLength(NAV_ROOMS_SHOWN);
    // Four shown either way, but the excluded room frees one of the four.
    const inside = navRoomsModel(all, "1");
    expect(inside.rows.map((r) => r.code)).toEqual(["2", "3", "4", "5"]);
    expect(inside.more).toBe(0);
  });

  test("counts what did not fit, and counts nothing when everything did", () => {
    expect(navRoomsModel(["1", "2", "3", "4", "5", "6"].map((c) => room(c))).more).toBe(2);
    expect(navRoomsModel([room("1")]).more).toBe(0);
    expect(navRoomsModel([]).rows).toEqual([]);
    expect(navRoomsModel([]).more).toBe(0);
  });

  // `more` is a count of rows for a link, never a negative number to render.
  test("a list shorter than the cap never reports negative overflow", () => {
    expect(navRoomsModel([room("1"), room("2")]).more).toBe(0);
  });

  test("keeps the server's order rather than re-sorting it", () => {
    const { rows } = navRoomsModel([
      room("1", { whenAt: 1 }),
      room("2", { whenAt: 9 }),
      room("3", { whenAt: 5 }),
    ]);
    expect(rows.map((r) => r.code)).toEqual(["1", "2", "3"]);
  });

  // A seeded room says so instead of reporting a status, because "Waiting for
  // people" about a room full of fabricated strangers is the claim the
  // product's honesty rule exists to prevent.
  test("a demonstration room is labelled as one rather than by its status", () => {
    const { rows } = navRoomsModel([room("1001", { demo: true, status: "swiping" })]);
    expect(rows[0].sub).toBe("Demonstration room");
  });

  // The maps are keyed on server enums, and a value nobody has taught them yet
  // must still produce a row rather than "undefined".
  test("an unknown mood or status falls back to the raw value", () => {
    const { rows } = navRoomsModel([room("1", { mood: "zzz", status: "qqq" })]);
    expect(rows[0].label).toBe("zzz");
    expect(rows[0].sub).toBe("qqq");
  });
});
