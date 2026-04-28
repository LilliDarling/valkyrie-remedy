import type { APIRoute } from "astro";

export const prerender = false;

// RFC 5322-ish email regex. Strict enough for client validation; MailerLite
// performs canonical validation server-side too.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Map of allowed `source` values → env var holding the MailerLite group ID.
// The client cannot supply a group ID directly; we look it up server-side.
const SOURCE_GROUP_ENV: Record<string, string> = {
  course: "MAILERLITE_GROUP_COURSE",
};

// Best-effort, in-isolate rate limit. Cloudflare Workers run many isolates
// across POPs; an attacker hitting different edges effectively bypasses this.
// Real enforcement should be configured as a Cloudflare Rate Limiting Rule
// against POST /api/waitlist (e.g. 10 req / min / IP). This is defense in
// depth for the common case.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Reject bodies larger than this. The expected payload is a small JSON
// object; anything larger is either a misuse or a deliberate amplification.
const MAX_BODY_BYTES = 1024;

// Cap upstream calls so a slow MailerLite doesn't tie up worker capacity.
const UPSTREAM_TIMEOUT_MS = 8_000;

// Origins permitted to invoke this endpoint. Production is set from
// `PUBLIC_SITE_ORIGIN`; localhost is allowed for dev.
const DEV_ORIGINS = new Set([
  "http://localhost:4321",
  "http://127.0.0.1:4321",
]);

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

function clientIp(request: Request, clientAddress: string | undefined): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    clientAddress ||
    "unknown"
  );
}

function readEnv(locals: App.Locals, key: string): string | undefined {
  const runtimeEnv = locals.runtime?.env as
    | Record<string, string | undefined>
    | undefined;
  const buildEnv = import.meta.env as unknown as Record<
    string,
    string | undefined
  >;
  return runtimeEnv?.[key] ?? buildEnv[key];
}

function isAllowedOrigin(origin: string | null, siteOrigin: string): boolean {
  if (!origin) return false;
  if (origin === siteOrigin) return true;
  if (DEV_ORIGINS.has(origin)) return true;
  return false;
}

export const POST: APIRoute = async ({
  request,
  clientAddress,
  locals,
  site,
}) => {
  // Same-origin enforcement. Rejects cross-site POSTs which is a poor-man's
  // CSRF guard for an endpoint that doesn't read cookies but does spend our
  // outbound MailerLite quota.
  const origin = request.headers.get("origin");
  const siteOrigin =
    readEnv(locals, "PUBLIC_SITE_ORIGIN") ||
    (site ? new URL(site).origin : "");
  if (siteOrigin && !isAllowedOrigin(origin, siteOrigin)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  // Body size pre-check. Note: `Content-Length` is advisory; we still rely
  // on the JSON parse to bail on malformed bodies.
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Payload too large" }, 413);
  }

  const ip = clientIp(request, clientAddress);
  if (isRateLimited(ip)) {
    return jsonResponse(
      { error: "Too many requests. Please try again later." },
      429,
      { "retry-after": "60" }
    );
  }

  let body: { email?: unknown; source?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  // Honeypot: a `website` field is rendered hidden in the form. Real users
  // never see or fill it; bots that auto-complete every field do. We return
  // a fake-success to make the bait less obvious.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return jsonResponse({ success: true }, 201);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const source = typeof body.source === "string" ? body.source : "";

  if (!email) {
    return jsonResponse({ error: "Email is required" }, 400);
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: "Please enter a valid email address" }, 400);
  }

  const apiKey = readEnv(locals, "MAILERLITE_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "Server is not configured." }, 500);
  }

  const payload: { email: string; groups?: string[] } = { email };
  if (source in SOURCE_GROUP_ENV) {
    const groupId = readEnv(locals, SOURCE_GROUP_ENV[source]);
    if (groupId) payload.groups = [groupId];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("https://connect.mailerlite.com/api/subscribers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    return jsonResponse(
      { error: "Subscription service is unreachable. Please try again." },
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // Map upstream errors into safe, generic messages. Avoid forwarding
    // upstream copy verbatim — it can leak internal field names or status.
    if (res.status === 422) {
      return jsonResponse(
        { error: "Please check the email address and try again." },
        400
      );
    }
    if (res.status === 429) {
      return jsonResponse(
        { error: "We're getting a lot of signups. Please try again shortly." },
        429
      );
    }
    return jsonResponse({ error: "Failed to subscribe" }, 502);
  }

  return jsonResponse({ success: true }, 201);
};

export const ALL: APIRoute = () => {
  return new Response(null, {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
};
