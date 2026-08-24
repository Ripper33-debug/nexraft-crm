import { connection } from "next/server";
import { bufferedProxyResponse } from "@/lib/api-proxy-response";
import { API_URL } from "@/lib/env";

export async function POST(request: Request): Promise<Response> {
	await connection();

	const headers = new Headers(request.headers);
	for (const header of [
		"host",
		"x-forwarded-host",
		"x-forwarded-proto",
		"x-forwarded-for",
		"forwarded",
		"transfer-encoding",
		"connection",
		"keep-alive",
		"content-length",
		"expect",
	]) {
		headers.delete(header);
	}

	let upstream: Response;

	try {
		const init: RequestInit & { duplex?: "half" } = {
			method: "POST",
			headers,
			body: request.body,
			duplex: "half",
			redirect: "manual",
		};

		upstream = await fetch(`${API_URL}/auth/passcode`, init);
	} catch (error) {
		console.error(
			`API proxy: ${API_URL} is not reachable for auth/passcode.`,
			error,
		);

		return Response.json(
			{ error: `The API at ${API_URL} is not reachable.` },
			{ status: 502 },
		);
	}

	const responseHeaders = new Headers(upstream.headers);
	for (const header of [
		"transfer-encoding",
		"connection",
		"content-encoding",
		"content-length",
	]) {
		responseHeaders.delete(header);
	}

	const setCookies = upstream.headers.getSetCookie?.() ?? [];
	if (setCookies.length > 0) {
		responseHeaders.delete("set-cookie");
		for (const cookie of setCookies) {
			responseHeaders.append("set-cookie", cookie);
		}
	}

	return bufferedProxyResponse(upstream, responseHeaders, request.method);
}
