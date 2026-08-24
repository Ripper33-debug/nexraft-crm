"use client";

import { Button } from "@crm/ui/components/button";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const errorResponse = z
	.object({
		message: z.string().optional(),
		error: z.string().optional(),
	})
	.passthrough();

const successResponse = z
	.object({
		redirectTo: z
			.string()
			.regex(/^\/(?!\/)/)
			.optional(),
	})
	.passthrough();

export function PasscodeSignIn() {
	const id = useId();
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
			const body = errorResponse.safeParse(
				await response.json().catch(() => null),
			);
			fail(body.success ? (body.data.message ?? body.data.error) : undefined);
			return;
		}

		const body = successResponse.safeParse(
			await response.json().catch(() => null),
		);

		window.location.assign(body.success ? (body.data.redirectTo ?? "/") : "/");
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
