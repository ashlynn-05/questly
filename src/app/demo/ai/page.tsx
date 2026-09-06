"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button, ErrorText, Input } from "@/components/ui";

type Match = { _id: string; text: string; score: number };

export default function AiDemoPage() {
  const snippets = useQuery(api.ai.store.list);
  const addSnippet = useAction(api.ai.embeddings.addSnippet);
  const semanticSearch = useAction(api.ai.embeddings.semanticSearch);

  const [text, setText] = useState("");
  const [queryText, setQueryText] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function guard(fn: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">AI demo</h1>
        <p className="text-sm text-neutral-600">
          OpenAI embeddings stored in Convex, queried with native vector search. Search by
          meaning &mdash; try a phrase that shares no words with the snippet.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void guard(async () => {
            await addSnippet({ text });
            setText("");
          });
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a snippet" />
        <Button type="submit" disabled={pending}>Add</Button>
      </form>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void guard(async () => setMatches(await semanticSearch({ query: queryText })));
        }}
      >
        <Input
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search by meaning"
        />
        <Button type="submit" disabled={pending}>Search</Button>
      </form>

      <ErrorText>{error}</ErrorText>

      {matches && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Matches
          </h2>
          <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200">
            {matches.length === 0 && <li className="p-3 text-sm text-neutral-500">No matches.</li>}
            {matches.map((match) => (
              <li key={match._id} className="flex justify-between gap-3 p-3 text-sm">
                <span>{match.text}</span>
                <span className="shrink-0 text-neutral-500">{match.score.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          All snippets
        </h2>
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200">
          {snippets === undefined && <li className="p-3 text-sm text-neutral-500">Loading...</li>}
          {snippets?.length === 0 && <li className="p-3 text-sm text-neutral-500">None yet.</li>}
          {snippets?.map((snippet) => (
            <li key={snippet._id} className="p-3 text-sm">{snippet.text}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
