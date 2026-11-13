import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

/** How long any web request may take before the plugin gives up on it. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * requestUrl with a time limit. A server that never answers would otherwise leave a card waiting
 * indefinitely (Obsidian's requestUrl has no timeout of its own). `what` names the service in the error.
 */
export function requestWithin(what: string, params: RequestUrlParam): Promise<RequestUrlResponse> {
	let timer = 0;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => reject(new Error(`${what} didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`)), REQUEST_TIMEOUT_MS);
	});
	return Promise.race([requestUrl(params), timeout]).finally(() => window.clearTimeout(timer));
}

/** How long a card waits before trying a failed first lookup once more. */
export const RETRY_AFTER_MS = 60_000;
