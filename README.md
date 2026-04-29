# Valkyrie Remedy

The marketing site for Valkyrie Remedy — a one-person engineering practice.

Static pages built with Astro, a single SSR API route, deployed to Cloudflare
Workers with Static Assets.

## Stack

- **[Astro 5](https://astro.build/)** — static site generation + SSR for the
  API route
- **[Tailwind v4](https://tailwindcss.com/)** — utility CSS
- **[Lenis](https://github.com/darkroomengineering/lenis)** — smooth scroll
- **[@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)** — Workers adapter
- **[@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/)** — sitemap generation
- **MailerLite** — course waitlist subscriptions (via REST API)
- **Cal.com** — booking + Stripe-powered intro-call deposits

## Project layout

```
src/
  components/    Astro components (Nav, FinalCta)
  layouts/       Layout.astro — shared head, nav, footer, SEO meta, JSON-LD
  pages/
    api/
      waitlist.ts   SSR endpoint — POST email → MailerLite group
    *.astro         One file per route (static)
  styles/
    global.css      Tokens, atmospheric effects, scrollbar
public/             Static assets, served as-is at the deployed root
  _headers          Cloudflare-Pages-style HTTP headers (security headers, CSP-RO)
  .assetsignore     Tells wrangler which paths to skip from public asset upload
  .well-known/
    security.txt    Security contact for researchers
  Valkyrie.png      Favicon + default OG image
  robots.txt        Sitemap pointer + /api/ disallow
astro.config.mjs    Adapter, sitemap, Tailwind
wrangler.jsonc      Cloudflare Workers deployment config
```

## Local development

Requires Node 20+ (see `.nvmrc` — pinned to 22 LTS).

```bash
npm install
npm run dev          # localhost:4321
```

The API route reads env vars from `.env` during dev. Create a `.env` (it's
gitignored):

```ini
MAILERLITE_API_KEY=<from MailerLite → Integrations → API>
MAILERLITE_GROUP_COURSE=<numeric group ID for the course waitlist>
PUBLIC_SITE_ORIGIN=http://localhost:4321
```

Visit `/courses`, submit a real address; verify the contact lands in the
MailerLite group.

### Other scripts

```bash
npm run build           # Production build → ./dist
npm run check           # astro check (typecheck + lint)
npm run preview         # Astro static preview
npm run preview:worker  # Run via Wrangler locally (closer to prod)
npm run deploy          # Build + wrangler deploy (manual deploy)
```

## Deployment

The site deploys to Cloudflare Workers with Static Assets. Two paths:

### A — Auto-deploy via Workers Builds (recommended)

Once configured, every push to the connected branch triggers a build and
deploy.

1. **Cloudflare → Workers & Pages → Create → Connect Git** → pick this repo.
2. Set:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** (leave default)
   - **Node version:** read automatically from `.nvmrc`
3. **Settings → Variables and Secrets** — add the three env vars below as
   **secrets** (encrypted), not plain vars:
   - `MAILERLITE_API_KEY`
   - `MAILERLITE_GROUP_COURSE`
   - `PUBLIC_SITE_ORIGIN` (e.g. `https://valkyrieremedy.com`)
4. **Settings → Domains & Routes → Add Custom Domain** — add
   `valkyrieremedy.com` and `www.valkyrieremedy.com`. Cloudflare manages
   the DNS records automatically.

Push to `main` → Cloudflare runs `npm run build` → publishes the new
`dist/_worker.js` and `dist/` static files.

### B — Manual deploy

```bash
npm run deploy
```

Wrangler reads `wrangler.jsonc` and uploads. Useful for one-off pushes
without going through CI.

## Configuration files

### `wrangler.jsonc`

Points Wrangler at the SSR worker entry (`./dist/_worker.js/index.js`) and
the static asset directory (`./dist`). `nodejs_compat` is required for
Astro's runtime.

### `public/_headers`

Cloudflare reads this and applies the listed headers to matching responses.
Currently sets HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `X-Frame-Options`, and a Report-Only CSP. After a few
days of clean traffic, promote `Content-Security-Policy-Report-Only` to
`Content-Security-Policy` to enforce.

### `public/.assetsignore`

Lists paths that Wrangler should *not* upload as public assets — the SSR
bundle (`_worker.js`) and the routing manifest (`_routes.json`) belong to
the Worker, not the public bucket.

## Security model

The endpoint surface is intentionally small.

- `POST /api/waitlist` — origin-checked, body-size capped, rate-limited
  per-isolate, honeypotted, with an upstream timeout. Maps `source` →
  MailerLite group via env vars; the client never specifies a group ID.
  Read [`src/pages/api/waitlist.ts`](src/pages/api/waitlist.ts) for details.
- Stripe is handled entirely by Cal.com inside their iframe — no Stripe
  keys or charge logic live in this codebase.
- All secrets are env vars; `.env` is gitignored. Production secrets are
  set in the Cloudflare dashboard.

For the security contact, see [`/.well-known/security.txt`](public/.well-known/security.txt).

## Cloudflare dashboard checklist

These belong in the dashboard, not in the repo:

- **SSL/TLS → Overview** → Encryption mode: **Full (strict)**
- **SSL/TLS → Edge Certificates** → Always Use HTTPS, HSTS (12 months,
  include subdomains, preload), Min TLS 1.2, TLS 1.3 on, Automatic HTTPS
  Rewrites on
- **Security → Bots → Bot Fight Mode** → On
- **Security → WAF → Managed Rules** → enable Cloudflare Managed Ruleset
- **Security → WAF → Rate limiting rules** → POST `/api/waitlist`,
  10 req / 1 min / IP, block 10 min
- **Cal.com event type** → require payment to confirm booking (so the
  slot can't be held without the deposit clearing)

## DMARC

Current record (in DNS):

```
v=DMARC1; p=none; sp=none; pct=100; rua=mailto:<rua>; ruf=mailto:<ruf>; fo=1; adkim=r; aspf=r; rf=afrf
```

Standard rollout: 2 weeks of `p=none` to collect reports → `p=quarantine; pct=10`
→ ramp `pct` to 100 → `p=reject`.

## License / authorship

Private project. © Valkyrie Remedy.
