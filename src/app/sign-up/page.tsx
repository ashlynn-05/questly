"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/account/auth-client";
import { Button, ErrorText, Input } from "@/components/ui";
import { SocialButtons } from "@/components/SocialButtons";
import { Screen } from "@/components/questly/Screen";

function SignUpForm() {
  const router = useRouter();
  // The same `?redirect=` /sign-in honours, for the same reason: somebody who
  // hits the account wall halfway through the funnel and creates an account
  // instead of signing in must land back where they were, not at the start.
  const redirectTo = useSearchParams().get("redirect") ?? "/start";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    setPending(true);

    const { error } = await authClient.signUp.email({
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
    });

    setPending(false);
    if (error) {
      setError(error.message ?? "Could not create the account");
      return;
    }
    router.push(redirectTo);
  }

  return (
    <Screen badge={false}>
      <h1 className="display text-[38px] text-text">Create an account</h1>

      <form action={onSubmit} className="flex flex-col gap-3">
        <Input name="name" placeholder="Display name" required autoComplete="name" />
        <Input name="username" placeholder="Username" required autoComplete="username" />
        <Input name="email" type="email" placeholder="Email" required autoComplete="email" />
        <Input
          name="password"
          type="password"
          placeholder="Password (min 8 characters)"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Sign up"}
        </Button>
      </form>

      <SocialButtons redirectTo={redirectTo} />

      <p className="text-[13px] text-dim">
        Already have an account?{" "}
        <Link
          href={`/sign-in?redirect=${encodeURIComponent(redirectTo)}`}
          className="text-text underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </Screen>
  );
}

// `useSearchParams` client-side renders the tree up to the nearest Suspense
// boundary, so it gets one of its own rather than taking the whole route with
// it. Same shape as /sign-in.
export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
