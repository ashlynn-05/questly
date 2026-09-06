"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button, Input } from "@/components/ui";

export default function DashboardPage() {
  const router = useRouter();
  const user = useQuery(api.auth.getCurrentUser);
  const events = useQuery(api.events.list);
  const createEvent = useMutation(api.events.create);
  const removeEvent = useMutation(api.events.remove);
  const [title, setTitle] = useState("");

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-neutral-600">
            {user === undefined ? "Loading..." : user ? `${user.name || user.email} (${user.email})` : "Signed out"}
          </p>
        </div>
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Realtime check &mdash; open a second tab, add here, watch it appear there
        </h2>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            await createEvent({ title });
            setTitle("");
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
          />
          <Button type="submit">Add</Button>
        </form>

        <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200">
          {events === undefined && <li className="p-3 text-sm text-neutral-500">Loading...</li>}
          {events?.length === 0 && <li className="p-3 text-sm text-neutral-500">No events yet.</li>}
          {events?.map((event) => (
            <li key={event._id} className="flex items-center justify-between p-3">
              <span className="text-sm">
                {event.title}
                <span className="ml-2 text-neutral-500">by {event.createdByName}</span>
              </span>
              <button
                onClick={() => removeEvent({ id: event._id })}
                className="text-xs text-neutral-500 underline hover:text-red-600"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <nav className="flex gap-4 text-sm">
        <Link href="/demo/places" className="underline">Places demo</Link>
        <Link href="/demo/ai" className="underline">AI demo</Link>
      </nav>
    </main>
  );
}
