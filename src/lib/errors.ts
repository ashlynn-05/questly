import { ConvexError } from "convex/values";

/**
 * The one way this app turns a thrown thing into a sentence a person reads.
 *
 * Every user-actionable failure in the backend goes through `throwUserError`,
 * which throws a `ConvexError` carrying `{ code, message }` -- `message` is the
 * sentence already written at the call site ("This room is full."). The trap is
 * that a `ConvexError` IS an `Error`, and its `.message` is the *stringified
 * data*, so `e instanceof Error ? e.message : ...` puts
 * `{"code":"ROOM_FULL","message":"This room is full."}` on the screen. Read
 * `.data`, never `.message`.
 *
 * A plain `Error` never reaches the UI either: it is an internal fault the user
 * cannot act on, its text is redacted to "Server Error" on production Convex
 * deployments anyway, and a stack-trace fragment is not a sentence. Those get
 * the caller's fallback.
 */
export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "object" && data !== null && "message" in data) {
      const message = (data as { message: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return fallback;
}
