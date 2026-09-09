"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/account/auth-client";
import { Button, ErrorText, Input } from "@/components/ui";
import { SocialButtons } from "@/components/SocialButtons";
import { Screen } from "@/components/questly/Screen";

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
    // No account roundel: a "Sign in" control beside a sign-in form is the
    // same offer twice.
    <Screen badge={false}>
      <h1 className="display text-[38px] text-text">Sign in</h1>

      <form action={onSubmit} className="flex flex-col gap-3">
        <Input name="identifier" placeholder="Username or email" required autoComplete="username" />
        <Input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <SocialButtons redirectTo={redirectTo} />

      <p className="text-[13px] text-dim">
        No account?{" "}
        <Link
          href={`/sign-up?redirect=${encodeURIComponent(redirectTo)}`}
          className="text-text underline underline-offset-4"
        >
          Sign up
        </Link>
      </p>
    </Screen>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
