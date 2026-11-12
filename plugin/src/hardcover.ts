import { requestUrl } from "obsidian";
import { Moment } from "./dates";

const API = "https://api.hardcover.app/v1/graphql";

export interface HardcoverBookDay {
	title: string;
	author: string | null;
	cover: string | null;
	url: string | null;
	from: number | null; // progress % at the start of the day
	to: number | null; // progress % at the end of the day
	started: boolean;
	finished: boolean;
	realStart?: string; // internal: start date from a finish event, when it isn't this day
}

export interface HardcoverDay {
	books: HardcoverBookDay[];
	quotes: Array<{ text: string; book: string }>;
}

async function query<T>(token: string, gql: string, variables: Record<string, unknown> = {}): Promise<T> {
	const auth = /^bearer\s/i.test(token.trim()) ? token.trim() : `Bearer ${token.trim()}`;
	const res = await requestUrl({
		url: API,
		method: "POST",
		contentType: "application/json",
		headers: { Authorization: auth },
		body: JSON.stringify({ query: gql, variables }),
		throw: false,
	});
	if (res.status === 401 || res.status === 403) throw new Error("Hardcover rejected the API token.");
	if (res.status === 429) throw new Error("Hardcover is limiting requests right now. Try again in a minute.");
	if (res.status >= 400) throw new Error(`Hardcover error (${res.status}).`);
	if (res.json.errors?.length) throw new Error(res.json.errors[0].message);
	return res.json.data as T;
}

/** The token's Hardcover user, or an error explaining why it doesn't work. */
export async function hardcoverUser(token: string): Promise<{ id: number; username: string }> {
	const data = await query<{ me: Array<{ id: number; username: string }> }>(token, "{ me { id username } }");
	if (!data.me?.length) throw new Error("Hardcover didn't return a user for this token.");
	return data.me[0];
}

const userIds = new Map<string, number>();
const days = new Map<string, { at: number; day: HardcoverDay }>();

/**
 * What you read on a day, from your Hardcover reading journal. Hardcover keeps one progress
 * entry per book per day (updated as you read), timestamped in UTC when it was created.
 * Results are cached; today's are refreshed after 10 minutes.
 */
export async function hardcoverDay(token: string, date: Moment): Promise<HardcoverDay> {
	const key = `${token.slice(-8)}|${date.format("YYYY-MM-DD")}`;
	const cached = days.get(key);
	const isToday = date.isSame(window.moment(), "day");
	if (cached && (!isToday || Date.now() - cached.at < 10 * 60 * 1000)) return cached.day;

	let userId = userIds.get(token);
	if (userId === undefined) {
		userId = (await hardcoverUser(token)).id;
		userIds.set(token, userId);
	}
	const utc = (m: Moment) => m.clone().utc().format("YYYY-MM-DDTHH:mm:ss");
	const data = await query<{ reading_journals: Array<Record<string, any>> }>(token, `
		query($user: Int!, $from: timestamp!, $to: timestamp!) {
			reading_journals(where: { user_id: { _eq: $user }, created_at: { _gte: $from, _lt: $to } }, order_by: { created_at: asc }) {
				event entry metadata
				book { title slug cached_image contributions(limit: 1) { author { name } } }
			}
		}`, { user: userId, from: utc(date.clone().startOf("day")), to: utc(date.clone().add(1, "day").startOf("day")) });

	const books = new Map<string, HardcoverBookDay>();
	const quotes: HardcoverDay["quotes"] = [];
	for (const row of data.reading_journals ?? []) {
		const b = row.book;
		if (!b?.title) continue;
		if (row.event === "quote" && row.entry) { quotes.push({ text: String(row.entry), book: b.title }); continue; }
		const book: HardcoverBookDay = books.get(b.title) ?? {
			title: b.title,
			author: b.contributions?.[0]?.author?.name ?? null,
			cover: b.cached_image?.url ?? null,
			url: b.slug ? `https://hardcover.app/books/${b.slug}` : null,
			from: null, to: null, started: false, finished: false,
		};
		if (row.event === "user_book_read_started") book.started = true;
		if (row.event === "user_book_read_finished") {
			book.finished = true;
			// A read re-created on the day it was finished logs a "started" event that day too;
			// the finish event knows the real start date.
			const startedAt = row.metadata?.started_at;
			if (startedAt && startedAt !== date.format("YYYY-MM-DD")) book.realStart = startedAt;
		}
		if (row.event === "progress_updated") {
			const was = Number(row.metadata?.progress_was), now = Number(row.metadata?.progress);
			if (!isNaN(was) && !isNaN(now)) {
				book.from = book.from ?? was;
				book.to = now;
			}
		}
		books.set(b.title, book);
	}
	for (const book of books.values()) {
		if (book.realStart) book.started = false;
		delete book.realStart;
	}
	// Keep books that moved forward, or were started or finished. Drops no-change and backwards blips.
	const day: HardcoverDay = {
		books: [...books.values()].filter((b) => b.started || b.finished || (b.from !== null && b.to !== null && b.to > b.from)),
		quotes,
	};
	days.set(key, { at: Date.now(), day });
	return day;
}
