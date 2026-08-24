"use client";

import { Button } from "@crm/ui/components/button";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { toast } from "sonner";

export function PasscodeSignIn() {
	const id = useId();
	const router = useRouter();
	const [passcode, setPasscode] = useState("");
	const [pending, setPending] = useState(false);

	function fail(message?: string) {
		setPending(false);
		toast.error(message ?? "Could not sign in.");
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);

		const response = await fetch("/api/auth/passcode", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ passcode }),
		});

		if (!response.ok) {
			const body = await response.json().catch(() => null);
			fail(
				typeof body?.message === "string"
					? body.message
					: typeof body?.error === "string"
						? body.error
						: undefined,
			);
			return;
		}

		router.replace("/");
		router.refresh();
	}

	return (
		<form className="flex w-full flex-col gap-3" onSubmit={submit}>
			<Field>
				<FieldLabel htmlFor={id}>CRM passcode</FieldLabel>
				<Input
					id={id}
					autoComplete="current-password"
					autoFocus
					inputMode="numeric"
					maxLength={200}
					onChange={(event) => setPasscode(event.target.value)}
					type="password"
					value={passcode}
				/>
			</Field>

			<Button disabled={pending || passcode.trim() === ""} type="submit">
				{pending ? <Spinner data-icon="inline-start" /> : null}
				Enter CRM
			</Button>
		</form>
	);
}
