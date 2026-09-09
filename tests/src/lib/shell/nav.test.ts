import { expect, test } from "vitest";
import { navModel } from "../../../../src/lib/shell/nav";

/**
 * The nav's one real hazard is a row that looks pressable and refuses. Three of
 * its six rows are statuses of a room rather than pages, and a room only exists
 * once you are in one, so "does this row have somewhere to go" is the property
 * worth pinning down. The rest is which row is standing.
 */

const ROOM_ROWS = ["room", "voting", "plan"];

test("with no room open, no room row offers a destination", () => {
  const rows = navModel("home");
  for (const row of rows.filter((r) => ROOM_ROWS.includes(r.id))) {
    expect(row.href, row.id).toBeNull();
  }
});

test("the three real pages always offer their destination", () => {
  const rows = navModel("home");
  expect(rows.find((r) => r.id === "home")?.href).toBe("/");
  expect(rows.find((r) => r.id === "start")?.href).toBe("/start");
  expect(rows.find((r) => r.id === "settings")?.href).toBe("/settings");
});

test("an open room gives all three room rows the same one destination", () => {
  const rows = navModel("room", { roomCode: "1004", roomStatus: "lobby" });
  const hrefs = rows.filter((r) => ROOM_ROWS.includes(r.id)).map((r) => r.href);
  expect(hrefs).toEqual(["/room/1004", "/room/1004", "/room/1004"]);
});

test("exactly one row is selected, on every route", () => {
  const cases = [
    navModel("home"),
    navModel("start"),
    navModel("settings"),
    navModel("room", { roomCode: "1004", roomStatus: "lobby" }),
    navModel("room", { roomCode: "1004", roomStatus: "swiping" }),
    navModel("room", { roomCode: "1004", roomStatus: "matched" }),
  ];
  for (const rows of cases) {
    expect(rows.filter((r) => r.selected)).toHaveLength(1);
  }
});

test("a room status selects the row for the screen, not the row for the URL", () => {
  const at = (status: Parameters<typeof navModel>[1] extends undefined ? never : "lobby" | "building" | "swiping" | "matched" | "booked") =>
    navModel("room", { roomCode: "1004", roomStatus: status }).find((r) => r.selected)?.id;

  expect(at("lobby")).toBe("room");
  // The deck being built is still the voting screen, not the lobby.
  expect(at("building")).toBe("voting");
  expect(at("swiping")).toBe("voting");
  expect(at("matched")).toBe("plan");
  // Booked is the end of the plan, not a sixth row.
  expect(at("booked")).toBe("plan");
});

test("a room route with no status falls back to the room row rather than nothing", () => {
  const rows = navModel("room", { roomCode: "1004" });
  expect(rows.find((r) => r.selected)?.id).toBe("room");
});

test("values fill in when the caller has them and hold a placeholder when it does not", () => {
  const empty = navModel("start");
  expect(empty.find((r) => r.id === "room")?.value).toBe("—");
  expect(empty.find((r) => r.id === "voting")?.value).toBe("—");
  expect(empty.find((r) => r.id === "plan")?.value).toBe("—");

  const full = navModel("room", {
    roomCode: "1004",
    roomStatus: "swiping",
    swiped: 3,
    deckSize: 9,
    planTotal: "$24",
  });
  expect(full.find((r) => r.id === "room")?.value).toBe("1004");
  expect(full.find((r) => r.id === "voting")?.value).toBe("3/9");
  expect(full.find((r) => r.id === "plan")?.value).toBe("$24");
});

test("a half-known deck position does not render half a fraction", () => {
  const rows = navModel("room", { roomCode: "1004", swiped: 3 });
  expect(rows.find((r) => r.id === "voting")?.value).toBe("—");
});

test("a page row carries no value, and no value is ever the empty string", () => {
  const rows = navModel("room", { roomCode: "1004", roomStatus: "swiping", swiped: 3, deckSize: 9 });
  // The three pages have no reading to give. An em dash there would claim the
  // value is merely unknown.
  for (const id of ["home", "start", "settings"]) {
    expect(rows.find((r) => r.id === id)?.value, id).toBeNull();
  }
  for (const row of rows) {
    if (row.value !== null) expect(row.value.length, row.id).toBeGreaterThan(0);
  }
});

test("a zero swipe count is a real value, not a missing one", () => {
  const rows = navModel("room", { roomCode: "1004", swiped: 0, deckSize: 9 });
  expect(rows.find((r) => r.id === "voting")?.value).toBe("0/9");
});
