import { expect, test } from "vitest";
import { isJoinReason, roomRedirect, statusTransition } from "../../../src/lib/room";

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
