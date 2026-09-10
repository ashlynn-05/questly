import { expect, test } from "vitest";
import {
  isJoinReason,
  roomRedirect,
  shouldStartSoloBuild,
  statusTransition,
  waitingScreen,
} from "../../../../src/lib/room/room";

const base = {
  code: "1234",
  ready: true,
  hasKey: true,
  answer: "yours" as const,
  leaving: false,
};

test("a member of a room they belong to is not sent anywhere", () => {
  expect(roomRedirect(base)).toBeNull();
});

// The defect this guard exists for: `ready` is false until the session store
// has actually been read, and redirecting before then bounces every visitor to
// /join on their first render -- members included.
test("nobody is redirected before the session store has been read", () => {
  expect(roomRedirect({ ...base, ready: false, hasKey: false, answer: "loading" })).toBeNull();
});

test("a device holding no key is sent to join, and told which nothing this is", () => {
  expect(roomRedirect({ ...base, hasKey: false, answer: "loading" })).toBe(
    "/join/1234?from=no-key",
  );
});

// The other half of the same defect: a key the room would not take is a
// different situation from no key at all, and the two used to be told the same
// wrong thing.
test("a key the room refuses is sent to join with the other reason", () => {
  expect(roomRedirect({ ...base, answer: "refused" })).toBe("/join/1234?from=dropped");
});

test("no key beats a refusal: without a key there was nothing to refuse", () => {
  expect(roomRedirect({ ...base, hasKey: false, answer: "refused" })).toBe(
    "/join/1234?from=no-key",
  );
});

// Leaving deletes this member's row, so `rooms.get` answers "refused" in the
// same breath. Without this, a member who deliberately left would be bounced
// straight back to the door of the room they just walked out of.
test("a member leaving on purpose is not bounced back to the door", () => {
  expect(roomRedirect({ ...base, answer: "refused", leaving: true })).toBeNull();
  expect(roomRedirect({ ...base, hasKey: false, answer: "refused", leaving: true })).toBeNull();
});

test("a room code is escaped rather than pasted into the path", () => {
  expect(roomRedirect({ ...base, answer: "refused", code: "a b/c" })).toBe(
    "/join/a%20b%2Fc?from=dropped",
  );
});

test("only the two known reasons are accepted back out of a URL", () => {
  expect(isJoinReason("no-key")).toBe(true);
  expect(isJoinReason("dropped")).toBe(true);
  expect(isJoinReason("javascript:alert(1)")).toBe(false);
  expect(isJoinReason("")).toBe(false);
  expect(isJoinReason(null)).toBe(false);
});

/* ---------------------------------------------------------------- focus */

test("arriving on a room moves no focus, whatever status it arrives in", () => {
  expect(statusTransition(null, "lobby")).toEqual({ seen: "lobby", moveFocus: false });
  expect(statusTransition(null, "booked")).toEqual({ seen: "booked", moveFocus: false });
});

test("a status change after arrival moves focus to the new screen", () => {
  expect(statusTransition("lobby", "building")).toEqual({ seen: "building", moveFocus: true });
  expect(statusTransition("matched", "booked")).toEqual({ seen: "booked", moveFocus: true });
});

// Strict Mode double-invokes mount effects, and the room subscription re-emits
// on every roster tick. Neither is a transition.
test("a re-run that lands on the same status moves nothing", () => {
  expect(statusTransition("swiping", "swiping")).toEqual({ seen: "swiping", moveFocus: false });
});

test("no status yet is not a transition, and does not overwrite what was seen", () => {
  expect(statusTransition("swiping", null)).toEqual({ seen: "swiping", moveFocus: false });
  expect(statusTransition(null, null)).toEqual({ seen: null, moveFocus: false });
});

// --- going alone stops pretending to be a room ----------------------------
//
// A solo room still opened a lobby: one filled seat, "Waiting..." rows for
// seats nobody is coming to fill, a "Copy the join link" button and a "Start
// swiping" button warning that nobody else can join once the deck starts. For
// a night the person has just said is only them, that is a screen made
// entirely of other people.

test("a room somebody else is coming to still opens its lobby", () => {
  expect(waitingScreen({ status: "lobby", headcount: 4 })).toBe("lobby");
});

test("a room of one never shows a lobby, only the deck being built", () => {
  expect(waitingScreen({ status: "lobby", headcount: 1 })).toBe("building");
});

test("a build in progress is a build in progress whoever is coming", () => {
  expect(waitingScreen({ status: "building", headcount: 1 })).toBe("building");
  expect(waitingScreen({ status: "building", headcount: 4 })).toBe("building");
});

test("a room that has started waits for nothing", () => {
  for (const status of ["swiping", "matched", "booked"]) {
    expect(waitingScreen({ status, headcount: 1 })).toBeNull();
    expect(waitingScreen({ status, headcount: 4 })).toBeNull();
  }
});

const solo = { status: "lobby", headcount: 1, isHost: true, alreadyStarted: false };

test("a solo room starts its own deck, because there is nobody to press the button", () => {
  expect(shouldStartSoloBuild(solo)).toBe(true);
});

test("a group room waits for its host to say go", () => {
  expect(shouldStartSoloBuild({ ...solo, headcount: 4 })).toBe(false);
});

// The build spends Places and OpenAI quota, and a failed build hands the room
// back to "lobby" -- which is the same state this fires on. Without the latch
// a solo room whose neighbourhood has nothing in it would rebuild forever.
test("it fires once, and a failure leaves the retry to the person", () => {
  expect(shouldStartSoloBuild({ ...solo, alreadyStarted: true })).toBe(false);
});

test("only the host may start it, because the backend refuses anyone else", () => {
  expect(shouldStartSoloBuild({ ...solo, isHost: false })).toBe(false);
});

test("a room already building is not started a second time", () => {
  expect(shouldStartSoloBuild({ ...solo, status: "building" })).toBe(false);
});
