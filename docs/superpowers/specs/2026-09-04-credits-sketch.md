# Sketch: credits for paying users (round B) — for reaction, not a spec

Date: 2026-09-04. Depends on round A (accounts with author keys exist).

## The shape

Three parties, one signed token between them:

- **Anvil = identity and money.** An account page (login with Google,
  Microsoft or email; Microsoft covers organisation accounts and can be
  locked to one tenant). Stripe Checkout sells credit packs; the page shows
  the balance and a "Connect drawcast" button.
- **Netlify = keys and the proxy.** The functions that already hold the
  Anthropic and Google keys gain a proxy path: generation and translation
  (Anthropic, streamed), cloud voices (Google TTS). Every proxied call is
  metered (tokens in/out per model, TTS characters) and debited.
- **The token.** On "Connect drawcast" Anvil issues a signed, short-lived
  credit token (user id, expiry) and hands it to drawcast (redirect with the
  token in the hash, stored like the API key). Netlify verifies it with a
  shared secret and debits the user's balance; drawcast points its API client
  at the proxy whenever a token is present. No key ever reaches the browser.

## Where the balance lives

Money-like counters need strong consistency; Netlify Blobs proved unreliable
for counting. Options: Netlify DB (Postgres) as the ledger that both sides
write to via signed calls, or the ledger in Anvil's Data Tables with Netlify
debiting through an authenticated endpoint per call (one extra round trip per
generation). Recommendation: the ledger on the Netlify side (it is where every
debit happens), Anvil credits it on payment.

## Questions only Hans can answer

1. Packs and prices (e.g. 100 kr = N credits), and the unit: one credit per
   1k tokens? per TTS character? A single price list for both?
2. Which models are offered (Opus costs ~5× Sonnet); does the user choose?
3. Free trial credits on signup, yes/no and how many.
4. Does the existing password scheme (trusted colleagues, raw keys) stay
   beside credits, or is it retired?
5. Terms, VAT and refunds — Stripe handles VAT if configured; someone must
   write the terms.
6. Should credits also cover the course generator's batch runs (twenty
   lectures = a lot of tokens)?

## Size

Bigger than the learners round: a Netlify proxy with metering and a ledger, a
Stripe flow in Anvil, an account page, the token handshake, and the client
switch. Best done as its own spec after round A is live.
