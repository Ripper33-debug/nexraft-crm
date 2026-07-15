import { createFileRoute, Link } from "@tanstack/react-router";

import { Button, Field, Input } from "../components/crm/ui";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({ error: (s.error as string) || "" }),
  component: LoginPage,
});

function LoginPage() {
  const { error } = Route.useSearch();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
            N
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Nexraft CRM</h1>
          <p className="text-sm text-slate-500">Sign in to your account</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {error ? (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
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
        <p className="mt-4 text-center text-sm text-slate-500">
          Need an account?{" "}
          <Link to="/signup" search={{ error: "" }} className="font-medium text-indigo-600 hover:text-indigo-700">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
