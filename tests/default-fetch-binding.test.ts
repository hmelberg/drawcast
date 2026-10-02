import { afterEach, describe, expect, it } from "vitest";
import { defaultDeps as iconDeps } from "../src/render/icon";
import { defaultDeps as imageDeps } from "../src/render/image";

// A browser's fetch throws "Illegal invocation" when called with a `this` that is
// not the window, e.g. as `deps.fetch(url)` on a plain object.
const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});
function browserLikeFetch() {
  globalThis.fetch = function (this: unknown) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(new Response("ok"));
  } as typeof fetch;
}

describe("default deps bind fetch", () => {
  it("icon deps.fetch works as a method call", async () => {
    browserLikeFetch();
    const deps = iconDeps();
    expect(await (await deps.fetch("http://x/")).text()).toBe("ok");
  });
  it("image deps.fetch works as a method call", async () => {
    browserLikeFetch();
    const deps = imageDeps();
    expect(await (await deps.fetch("http://x/")).text()).toBe("ok");
  });
});
