/// <reference path="../.astro/types.d.ts" />

type Runtime = import("@astrojs/cloudflare").Runtime<{
  MAILERLITE_API_KEY: string;
  MAILERLITE_GROUP_COURSE: string;
}>;

declare namespace App {
  interface Locals extends Runtime {}
}
