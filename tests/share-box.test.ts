// The share box's one pure rule: the picture a /c/ link's card shows. The
// dialog itself is checked by eye (spec 2026-10-02-share-design §6).
import { expect, test } from "vitest";
import { cardImageUrl, DESKTOP_PLATFORMS } from "../src/ui/share-box";

test("a /c/ link's picture is its /card/ twin; a plain link has none", () => {
  expect(cardImageUrl({ url: "https://www.drawcast.app/c/vaccines", card: true })).toBe("https://www.drawcast.app/card/vaccines.png");
  expect(cardImageUrl({ url: "https://www.drawcast.app/c/learn-russian/3", card: true })).toBe("https://www.drawcast.app/card/learn-russian/3.png");
  expect(cardImageUrl({ url: "https://www.drawcast.app/c/gh/ann/casts/casts/herd.yaml", card: true })).toBe("https://www.drawcast.app/card/gh/ann/casts/casts/herd.png");
  expect(cardImageUrl({ url: "https://www.drawcast.app/#gdrive=abcdefghijkl", card: false })).toBeUndefined();
});

test("the computer's list, email first", () => {
  expect(DESKTOP_PLATFORMS).toEqual(["email", "facebook", "linkedin", "x", "bluesky", "whatsapp"]);
});
