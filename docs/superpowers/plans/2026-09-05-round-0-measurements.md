# Round 0 — what the drawcast server actually costs to serve

Date: 2026-09-05. Task 15 of `2026-09-05-round-0-private-cast.md`.
Spec: `docs/superpowers/specs/2026-09-05-private-publishing-and-learner-identity-design.md`
(§4 for the storage decision, §15 for the questions this answers).

Measured against the deployed app, five samples each, from one machine in
Norway. The cast is `anvil/diminishing/diminishing-marginal-utility.yaml`,
published by Hans through the real Share panel with narration baked in.

## The headline: the measurement found a bug nothing else could

**Every audio read since the endpoint was written answered `500`.** Anvil
cannot serialise a `bytes` body:

```
anvil.server.SerializationError: Cannot serialize return value from function.
Cannot serialize <class 'bytes'> object at msg['response']['body']
```

253 pytest tests, 4533 vitest tests, `tsc`, a production build and eight
reviews all passed over it, because `api.py` imports `anvil` and cannot be
executed under pytest — the handler was only ever pinned as source text. The
ledger recorded that limitation as a deferred minor; it turned out to be
load-bearing.

It sounded fine to the author, and that is the part worth remembering.
`cloudPlayback` defaults on, so the player re-synthesised each line with the
*same* cloud voice that had been baked. Indistinguishable by ear. The task
review predicted exactly this — "a baked voice silently replaced by a
synthesiser is indistinguishable from one that was never baked, and nobody
will report it" — and it took a deliberate measurement, not listening, to
catch it. Fixed in `drawcast-anvil` `8759352` by returning the Media object.

This is the argument for §12's rule that round 0 is the code **plus** the
measurements. The measurement was not paperwork.

## What it costs

| request | bytes | median | notes |
|---|---|---|---|
| spec, gated | 1 326 | **0.220 s** | almost entirely round trip, not payload |
| audio, first play | 197.9 KB stored → 145.9 KB on the wire | **0.393 s** | `content-encoding: gzip` |
| audio, replay (304) | 0 | **0.239 s** | ETag on the row's `updated` |
| the same class of file from GitHub raw | 1.44 MB | **0.101 s** | CDN, one request, warm |

**Anvil's cost is distance, not throughput.** A 1.3 KB spec and a 146 KB
audio blob take almost the same time, because both are one round trip to a
single region with no CDN in front of it — about 0.22 s of the 0.39 s is the
trip itself. GitHub serves eleven times the bytes in a quarter of the time
because a CDN edge is nearer than Anvil is.

**Sequential fetching was costing a whole round trip**, so the two now leave
together (`4f92c5b`). Before: 0.220 + 0.393 ≈ 0.61 s before a line was drawn.
After, the wall clock is the slower of the two, ≈ 0.39 s. That is arithmetic
from the table above, not a browser measurement.

**A replay costs 0.24 s and no bytes.** `private, no-cache` plus the ETag
means the browser keeps the megabytes and asks first, so a second play pays
one small round trip rather than the transfer. That is the shape §4 chose
when it rejected `immutable`, and it behaves as designed.

## The questions §15 asked

**Does a real audio body upload?** Yes — but only **198 KB** has been proven.
Hans published this cast through the app and the narration stored and now
serves. The multi-megabyte case is **still unverified**: the HTA lectures are
1.4–6.8 MB, and nothing has yet pushed one of those through `POST /cast/audio`.
Until it has, the deferred "no cap on the audio body" stays deferred on
purpose — a cap set now would be our number rather than Anvil's limit.

**Is the Media object's own URL directly servable?** Not asked any more. §4
was amended mid-round to stream through the gated endpoint instead, because a
media URL is unguessable but **ungated**, which is what the gate exists to
prevent for a private cast. The streaming path is what these numbers measure.

**Does the 304 carry CORS headers?** **Yes.** This was the round's last
unverified assumption with a user-visible failure mode — if it had not, every
replay of a baked private lecture would have fallen silently back to a
synthesised voice, which is the one failure nobody would report.

```
HTTP/2 304
access-control-allow-origin: *
etag: "1788617694.849084"
cache-control: private, no-cache
```

**Is compression worth building?** No — it is already there. Anvil gzips the
response: 197.9 KB stored becomes 145.9 KB on the wire, 73 %.

That also answers whether the audio should be stored as binary instead of
base64-in-YAML. On a real 1.44 MB baked lecture:

```
audio document (base64 in YAML)   1.43 MB   99 % of it base64 payload
the real MP3 bytes behind it      1.07 MB
gzip of the whole document        1.06 MB   ← smaller than the raw MP3
```

**Gzip recovers the entire base64 overhead** — base64 uses 64 symbols and
deflate takes the redundancy straight back. Binary would save 24 %; gzip
already saves 25 %, for nothing. And binary would fork the format: the GitHub
path must stay text in a repo, so a binary Anvil path means two audio formats
kept in step by hand — the exact fault this round spent the day catching.

The remaining gain is **storage**, not bandwidth: Anvil holds the blob
uncompressed. Storing it gzipped and inflating client-side (`DecompressionStream`)
would cut 25 % of what counts against the quota, in two functions, without
touching the format. Worth a round only if the quota says so.

## Still open

- **The Anvil plan's storage and bandwidth quota.** Hans confirmed a Business
  account, which is what §0 already assumed for scheduled tasks, but the
  numbers have not been read off the plan page. §15 says this should come
  before round 0 is worth starting; it is now the one input still missing.
- **A multi-megabyte audio upload**, and with it the cap question above.
- A duplicate `Cache-Control` on every response — Anvil adds its own
  `no-cache, no-store` beside ours. Harmless, and not worth a round.
