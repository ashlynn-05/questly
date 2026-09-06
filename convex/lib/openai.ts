/**
 * The one place this backend talks to OpenAI's chat endpoint.
 *
 * Three features want the same thing -- a small model, asked for JSON, giving
 * JSON back -- so they share one implementation rather than three copies of a
 * `fetch` block that would drift apart the first time the model name changes.
 *
 * Deliberately free of Convex imports: it is a plain module under `lib/`, so it
 * can be called from any action and unit-tested against a stubbed `fetch`.
 */

const CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** Small, fast and cheap. Every caller here wants structure, not prose. */
const CHAT_MODEL = "gpt-4o-mini";

/**
 * One JSON-mode chat completion. Returns the parsed object, which is `unknown`
 * on purpose -- a model's output is untrusted input, so every caller narrows
 * the fields it reads.
 *
 * Throws a plain `Error` (never a `ConvexError`) on a missing key or a bad
 * response: both are our problem, not the user's, and a redacted "Server Error"
 * in the browser is the right amount of detail for them. Callers that can carry
 * on without the model's answer catch it and fall back.
 */
export async function jsonCompletion(prompt: string): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Run: npx convex env set OPENAI_API_KEY <key>");
  }

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  // JSON mode guarantees parseable JSON, but an empty choices array does not,
  // so the "{}" fallback keeps a truncated response from throwing a SyntaxError
  // that reads like a bug in the caller.
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}
