# Valkyrie Remedy

Marketing site for the practice. Astro + Cloudflare Workers (Static Assets), with a single SSR route at `/api/waitlist` that posts to MailerLite.

## Develop

Requires Node 20+ (`.nvmrc` pins 22).

```bash
npm install
npm run dev      # http://localhost:4321
```

Create a local `.env` (gitignored):

```ini
MAILERLITE_API_KEY=...
MAILERLITE_GROUP_COURSE=...
PUBLIC_SITE_ORIGIN=http://localhost:4321
```

## Deploy

Pushes to `main` auto-deploy via Cloudflare Workers Builds. The same env vars must be set as secrets on the Worker (`MAILERLITE_API_KEY`, `MAILERLITE_GROUP_COURSE`, `PUBLIC_SITE_ORIGIN`).

For a manual deploy:

```bash
npm run deploy
```

## Scripts

```bash
npm run dev              # Dev server
npm run build            # Production build → ./dist
npm run preview:worker   # Local Worker preview via Wrangler
npm run check            # astro check (typecheck)
npm run deploy           # Build + wrangler deploy
```

