import { forgetDraft } from "./funnel";
import { clearSessionKeys } from "./session";

/**
 * Everything this browser is holding on behalf of the person signing out.
 *
 * One function rather than a habit at three call sites, because the defect it
 * fixes was exactly a forgotten call. Signing out cleared the room capability
 * tokens and left the funnel draft where it was, and the draft is not inert:
 * `/start` restores it for whoever is signed in NEXT, and finishing the funnel
 * submits it through `saveQuiz`, which derives the user id from the CURRENT
 * identity. So on a shared laptop one person's quiz answers were written to the
 * next person's account, shown back to them as "Your answers", and used to rank
 * their decks -- with nothing on screen to suggest where they came from.
 *
 * Better Auth's own `signOut()` is deliberately NOT called here. It is a
 * network round trip that can fail, and it belongs to the caller along with
 * where to navigate afterwards; this is only the local half. Call this first:
 * clearing local state before the request means a failed sign-out leaves a
 * browser holding nothing rather than holding everything.
 */
export function clearLocalState() {
  clearSessionKeys();
  forgetDraft();
}
