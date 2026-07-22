import { createFileRoute, Link } from "@tanstack/react-router";

import { Button, Field, Input } from "../components/crm/ui";
import { LogoMark } from "../components/crm/brand";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({ error: (s.error as string) || "" }),
  component: LoginPage,
});

function LoginPage() {
  const { error } = Route.useSearch();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3">
            <LogoMark size={44} radius={11} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-bone">
            Nexraft<span className="text-signal"> CRM</span>
          </h1>
          <p className="text-sm text-mute">Sign in to your workspace</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-xl">
          {error ? (
            <div className="mb-4 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-600">{error}</div>
          ) : null}
          <form method="post" action="/api/auth/login" className="space-y-4">
            <Field label="Email">
              <Input type="email" name="email" required autoComplete="email" placeholder="you@nexraft.com" />
            </Field>
            <Field label="Password">
              <Input type="password" name="password" required autoComplete="current-password" />
            </Field>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-mute">
          Need an account?{" "}
          <Link to="/signup" search={{ error: "" }} className="font-medium text-signal hover:text-signal-strong">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
