import { createFileRoute, Link } from "@tanstack/react-router";

import { Button, Field, Input } from "../components/crm/ui";

export const Route = createFileRoute("/signup")({
  validateSearch: (s: Record<string, unknown>) => ({ error: (s.error as string) || "" }),
  component: SignupPage,
});

function SignupPage() {
  const { error } = Route.useSearch();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-signal text-lg font-bold text-ink">
            N
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-bone">Create your account</h1>
          <p className="text-sm text-mute">Join the Nexraft team workspace</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-xl">
          {error ? (
            <div className="mb-4 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-400">{error}</div>
          ) : null}
          <form method="post" action="/api/auth/signup" className="space-y-4">
            <Field label="Full name">
              <Input type="text" name="name" required placeholder="Your name" />
            </Field>
            <Field label="Email">
              <Input type="email" name="email" required autoComplete="email" placeholder="you@nexraft.com" />
            </Field>
            <Field label="Password">
              <Input type="password" name="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
            </Field>
            <Field label="Team access code">
              <Input type="text" name="code" required placeholder="Ask your admin" />
            </Field>
            <Button type="submit" className="w-full">
              Create account
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-mute">
          Already have an account?{" "}
          <Link to="/login" search={{ error: "" }} className="font-medium text-signal hover:text-signal-strong">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
