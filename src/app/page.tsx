import Link from "next/link";

const LINKS = [
  { href: "/sign-up", label: "Sign up", note: "username + email + password" },
  { href: "/sign-in", label: "Sign in", note: "username or email, plus OAuth" },
  { href: "/dashboard", label: "Dashboard", note: "protected route, realtime Convex list" },
  { href: "/demo/places", label: "Places demo", note: "radius search + interactive map" },
  { href: "/demo/ai", label: "AI demo", note: "OpenAI embeddings + Convex vector search" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">when-to-meet</h1>
        <p className="text-sm text-neutral-600">
          Stack scaffold. Each link below exercises one layer end to end.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="flex flex-col gap-0.5 p-3 hover:bg-neutral-50">
              <span className="text-sm font-medium underline">{link.label}</span>
              <span className="text-xs text-neutral-500">{link.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
