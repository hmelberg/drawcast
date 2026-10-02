// Every test lays bundled examples out the way the app does: icons named by
// keyword take their artwork from the offline icon cache (round 6 §8,
// src/scenes/icon-cache.json — `npm run icons` rebuilds it). A keyword the
// cache lacks then warns by name in the layout.
import { registerIconStore } from "../src/spec/icon-data";
import offlineIcons from "../src/scenes/icon-cache.json";

registerIconStore(offlineIcons as Record<string, string>, { complete: true });
