import { describe, expect, test } from "vitest";

// Vite inlines every VITE_* var into the client bundle as a literal string, so
// a secret behind that prefix is published, not configured. The Anthropic and
// TTS keys are vended by netlify/functions/keys.mts precisely to avoid that —
// setting the VITE_ fallbacks in a build environment would silently defeat it.
//
// This is a build gate, not just a unit test, so it has to run on every path
// that builds: `npm test` precedes `npm run build` in both
// .github/workflows/deploy.yml (Pages) and netlify.toml's build command
// (Netlify — the deploy that actually holds the paid keys). Adding a third
// build path means adding the suite to it.
//
// This repo has no vite-env.d.ts declaring ImportMetaEnv, so index through a
// cast rather than `keyof ImportMetaEnv` — that keeps `npx tsc --noEmit` clean
// on the very test meant to protect the build.
const env = import.meta.env as unknown as Record<string, string | undefined>;

describe("no secret is compiled into the bundle", () => {
  test.each(["VITE_ANTHROPIC_API_KEY", "VITE_GOOGLE_TTS_KEY"])("%s is not defined at build time", (name) => {
    expect(env[name]).toBeUndefined();
  });

  test("the two Google vars that ARE public stay public-only — no secret material", () => {
    // A client id ends in .apps.googleusercontent.com and an API key starts
    // "AIza". Neither is secret. This asserts the shape so a private key or an
    // Anthropic key pasted into the wrong var fails the build loudly.
    const id = env.VITE_GOOGLE_CLIENT_ID;
    if (id) expect(id.endsWith(".apps.googleusercontent.com")).toBe(true);
    const key = env.VITE_GOOGLE_PICKER_KEY;
    if (key) expect(key.startsWith("AIza")).toBe(true);
  });
});
