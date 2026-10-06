// Which key an AI call uses (credit plan delivery 1, 2026-10-06): the
// author's own Anthropic key when there is one — free to drawcast, straight
// to Anthropic — otherwise, when signed in, CREDIT_KEY, which makeClient
// turns into a client that spends the account's credit through Anvil.
// Empty means neither: the call site asks for a key or a sign-in.

import { getToken } from "../account";
import { getApiKey } from "../store";
import { CREDIT_KEY } from "./job-transport";

export function llmKey(): string {
  return getApiKey() || (getToken() ? CREDIT_KEY : "");
}

export function usingCredit(): boolean {
  return !getApiKey() && Boolean(getToken());
}

/** The sentence a call site shows when there is no way to pay for a call. */
export const NO_LLM_KEY = "Sign in to use credit, or add your own Anthropic API key in Settings.";
