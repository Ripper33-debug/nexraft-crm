// Vercel Node serverless function that wraps the TanStack Start SSR handler.
//
// The Vite build emits dist/server/server.js as a Web-standard fetch handler
// (`export default { fetch(request) }`). Vercel's Node runtime hands us Node's
// IncomingMessage/ServerResponse, so this adapter converts between the two.
// vercel.json rewrites every non-static path to this function.
import type { IncomingMessage, ServerResponse } from "node:http";

// Built at deploy time by `vite build` (see vercel.json buildCommand).
// @ts-expect-error - no types for the built artifact
import server from "../dist/server/server.js";

type FetchHandler = {
  fetch: (request: Request, env?: unknown, ctx?: unknown) => Promise<Response> | Response;
};

const handler = server as FetchHandler;

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const host = req.headers.host || "localhost";
    const url = `${proto}://${host}${req.url || "/"}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (value != null) {
        headers.set(key, value);
      }
    }

    let body: Buffer | undefined;
    const method = req.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
      }
      body = Buffer.concat(chunks);
    }

    const request = new Request(url, {
      method,
      headers,
      body: body && body.length ? body : undefined,
    });

    const response = await handler.fetch(request);

    res.statusCode = response.status;

    // Set-Cookie can legitimately appear multiple times; preserve them all.
    const setCookies =
      typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      res.setHeader(key, value);
    });
    if (setCookies.length) res.setHeader("set-cookie", setCookies);

    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<h1>Server error</h1><p>The page failed to load.</p>");
  }
}
