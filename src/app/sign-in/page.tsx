"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, ErrorText, Input } from "@/components/ui";
import { SocialButtons } from "@/components/SocialButtons";

function SignInForm() {
  const router = useRouter();
  const redirectTo = useSearchParams().get("redirect") ?? "/start";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    setPending(true);

    const identifier = String(formData.get("identifier") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    // One field, two endpoints: an "@" means it is an email, otherwise a username.
    const { error } = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier, password })
      : await authClient.signIn.username({ username: identifier, password });

    setPending(false);
    if (error) {
      setError(error.message ?? "Could not sign in");
      return;
    }
    router.push(redirectTo);
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      <form action={onSubmit} className="flex flex-col gap-3">
        <Input name="identifier" placeholder="Username or email" required autoComplete="username" />
        <Input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <SocialButtons redirectTo={redirectTo} />

      <p className="text-sm text-neutral-600">
        No account?{" "}
        <Link href="/sign-up" className="underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
