import type { APIRoute } from "astro";

export const prerender = false;

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const SOURCE_GROUP_ENV: Record<string, string> = {
  course: "MAILERLITE_GROUP_COURSE",
};

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

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

function readEnv(
  locals: App.Locals,
  key: string
): string | undefined {
  const runtimeEnv = locals.runtime?.env as
    | Record<string, string | undefined>
    | undefined;
  const buildEnv = import.meta.env as unknown as Record<
    string,
    string | undefined
  >;
  return runtimeEnv?.[key] ?? buildEnv[key];
}

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const ip = clientIp(request, clientAddress);
  if (isRateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      { status: 429, headers: { "content-type": "application/json" } }
    );
  }

  let body: { email?: unknown; source?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const source = typeof body.source === "string" ? body.source : "";

  if (!email) {
    return new Response(JSON.stringify({ error: "Email is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return new Response(
      JSON.stringify({ error: "Please enter a valid email address" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const apiKey = readEnv(locals, "MAILERLITE_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server is not configured." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const payload: { email: string; groups?: string[] } = { email };
  if (source in SOURCE_GROUP_ENV) {
    const groupId = readEnv(locals, SOURCE_GROUP_ENV[source]);
    if (groupId) payload.groups = [groupId];
  }

  const res = await fetch("https://connect.mailerlite.com/api/subscribers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return new Response(
      JSON.stringify({ error: data.message || "Failed to subscribe" }),
      { status: res.status, headers: { "content-type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};
