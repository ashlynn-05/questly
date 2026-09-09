import { PURGE_WINDOW_DAYS } from "@convex/lib/account";
import { MAX_AVATAR_MB } from "@convex/lib/avatar";

/**
 * The explanations `/settings` used to say out loud, all of the time.
 *
 * WHAT THIS FIXED. Six of the eight things on that screen ended in a paragraph
 * of 12px dim prose -- roughly 250 words, more text than every control and
 * label on the page put together. The prose was correct and worth having: the
 * account really is deleted in two halves, a seat really does live on the
 * device that holds it. But it was on screen permanently, so somebody who came
 * to change their name read three explanations of things they were not doing
 * to find the field, and read them again on every visit. That is the cost of
 * setting help at a size that says "skip me" and then leaving it in the way.
 *
 * The copy is not shortened here, it is MOVED: same sentences, asked for by a
 * question mark next to the thing they explain, and shown at 15px in a dialog
 * where they can actually be read rather than at 12px where they cannot.
 *
 * WHY IT LIVES IN `src/lib` AND NOT IN THE JSX. Two reasons, and the second is
 * the real one. The test suite runs a single `edge-runtime` environment with no
 * DOM, so anything inside a component is unreachable to it -- the same reason
 * `menu.ts` and `avatar.ts` are here. And prose held as data can be checked as
 * data: `help.test.ts` asserts the deletion topic still states the window the
 * backend actually enforces, which a sentence typed into a `<p>` cannot.
 *
 * BODIES ARE PARAGRAPHS, NOT ONE STRING. A dialog that has to explain the two
 * halves of account deletion has three things to say and needs the breaks; a
 * dialog explaining an image format has one.
 */
export type HelpEntry = {
  /** Names the dialog, and the trigger's accessible name is built from it. */
  title: string;
  body: readonly string[];
};

export const HELP = {
  picture: {
    title: "Your picture",
    body: [
      `PNG, JPEG, WebP or GIF, under ${MAX_AVATAR_MB}MB. Without one your roundel shows your initials.`,
      // Said because the preview beside the control is 44px and looks like a
      // mistake otherwise. It is the size the picture is actually used at.
      "It is only ever drawn at the size of the roundel in the corner of the screen, so a face fills it better than a landscape.",
    ],
  },
  name: {
    title: "Your display name",
    body: [
      "What a room calls you when you open one.",
      "The name people see inside a room is the one typed at its door, so changing this does not rename you in a room you are already in.",
    ],
  },
  answers: {
    title: "Your answers",
    body: [
      "These are what every venue you are shown is ranked against, along with what you said the night is for.",
      "Retaking the quiz starts from the answers you gave last time, so you only change what has changed.",
    ],
  },
  push: {
    title: "Notifications",
    body: [
      "The moments worth knowing about happen on somebody else's phone: the room fills up, everyone lands on the same place, the plan gets written, the night is booked.",
      "A notification names the room number and nothing else — never a venue, a person or a price. It is drawn on a locked screen, in front of whoever is holding the phone.",
      "This is per device, and turning it off here turns it off on this one. You are never notified about something you did yourself.",
    ],
  },
  rooms: {
    title: "Your rooms",
    body: [
      "A room opens on the device that holds its seat. On a new device, join again with the room number — you will be given the same seat back, not a second one.",
      "Rooms you were let into as a guest, before signing in, are not listed here. Those live at the link you were sent.",
    ],
  },
  signout: {
    title: "Signing out",
    body: [
      "Signing out also drops the seats this browser is holding, and the answers to a quiz you have not finished.",
      "You can take a seat back by joining with the room number again.",
    ],
  },
  deletion: {
    title: "Deleting your account",
    body: [
      "Your seat in every room goes immediately, along with the swipes and votes you cast there. That part cannot be undone.",
      `Everything else is kept for ${PURGE_WINDOW_DAYS} days. Sign back in within that time and the account comes back as it was. After that it is erased.`,
      "You cannot delete while you are still hosting a night that has not been booked and has not yet passed — the room would have no one who could start it.",
    ],
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpTopic = keyof typeof HELP;

export const HELP_TOPICS = Object.keys(HELP) as HelpTopic[];
