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
	pages: number; // pages read that day
	page: number | null; // page reached by the end of the day
	started: boolean;
	finished: boolean;
	rating: number | null; // your rating, shown when the book was finished that day
	realStart?: string; // internal: start date from a finish event, when it isn't this day
	bookPages?: number; // internal: the book's page count, to cap odd completion jumps
	bookId?: number; // internal: Hardcover book id
	lastPage?: number | null; // internal: page reached by the previous progress entry today
	finishPage?: number | null; // internal: page Hardcover set when the book was marked finished
	needsBase?: boolean; // internal: finished with no progress entry earlier that day
}

export interface HardcoverDay {
	books: HardcoverBookDay[];
	quotes: Array<{ text: string; book: string }>;
	pages: number; // total pages read that day
	lastRead: { title: string; date: string } | null; // most recent reading before this day (YYYY-MM-DD), when none on it
}

/**
 * Reading saved in an entry's properties, so the card doesn't ask Hardcover every time it's shown:
 *   reading:    the card's data (books, quotes, last read)
 *   books:      titles read that day, for Bases and search
 *   pages_read: total pages read that day, for Bases
 */
export function readingProperties(day: HardcoverDay): Record<string, unknown> {
	return {
		reading: { books: day.books, quotes: day.quotes, last_read: day.lastRead },
		books: day.books.map((b) => b.title),
		pages_read: day.pages,
	};
}

/** The reading saved in an entry, or null when it hasn't been fetched yet. */
export function savedReading(fm: Record<string, unknown>): HardcoverDay | null {
	const r = fm.reading as Record<string, any> | undefined;
	if (!r || typeof r !== "object" || !Array.isArray(r.books)) return null;
	const books = r.books as HardcoverBookDay[];
	return {
		books,
		quotes: Array.isArray(r.quotes) ? r.quotes : [],
		pages: Number(fm.pages_read) || books.reduce((n, b) => n + (Number(b.pages) || 0), 0),
		lastRead: r.last_read?.title ? { title: String(r.last_read.title), date: String(r.last_read.date) } : null,
	};
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

/**
 * What you read on a day, from your Hardcover reading journal. Hardcover keeps one progress
 * entry per book per day (updated as you read), timestamped in UTC when it was created.
 * Always asks Hardcover; callers save the result in the entry.
 */
export async function hardcoverDay(token: string, date: Moment): Promise<HardcoverDay> {
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
				book { id title slug pages cached_image contributions(limit: 1) { author { name } } user_books(where: { user_id: { _eq: $user } }) { rating } }
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
			from: null, to: null, pages: 0, page: null, started: false, finished: false,
			rating: b.user_books?.[0]?.rating ?? null,
			bookPages: Number(b.pages) || undefined,
			bookId: Number(b.id) || undefined,
			lastPage: null,
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
			const m = row.metadata ?? {};
			const was = Number(m.progress_was), now = Number(m.progress);
			const page = Number(m.progress_pages) > 0 ? Number(m.progress_pages) : null;
			if (m.source === "completion") {
				// Marking a book finished logs its jump to 100% against a fresh read, as if from 0%.
				// Count it from the page you'd actually reached instead.
				if (!isNaN(now)) book.to = now;
				if (book.from === null) book.needsBase = true;
				else if (page !== null && book.lastPage) book.pages += Math.max(0, page - book.lastPage);
				book.finishPage = page;
			} else {
				if (!isNaN(was) && !isNaN(now)) {
					book.from = book.from ?? was;
					book.to = now;
				}
				if (Number(m.pages_delta) > 0) book.pages += Number(m.pages_delta);
			}
			if (page !== null) { book.page = page; book.lastPage = page; }
		}
		books.set(b.title, book);
	}
	// Books finished with no progress entry earlier that day: measure from their last entry before it.
	const needBase = [...books.values()].filter((b) => b.needsBase && b.bookId);
	if (needBase.length) {
		const prior = await query<{ reading_journals: Array<Record<string, any>> }>(token, `
			query($user: Int!, $books: [Int!]!, $before: timestamp!) {
				reading_journals(where: { user_id: { _eq: $user }, book_id: { _in: $books }, event: { _eq: "progress_updated" }, created_at: { _lt: $before } },
					distinct_on: book_id, order_by: [{ book_id: asc }, { created_at: desc }]) { book_id metadata }
			}`, { user: userId, books: needBase.map((b) => b.bookId), before: utc(date.clone().startOf("day")) });
		for (const book of needBase) {
			const m = (prior.reading_journals ?? []).find((r) => r.book_id === book.bookId)?.metadata;
			const basePct = Number(m?.progress), basePage = Number(m?.progress_pages);
			if (m && !isNaN(basePct)) book.from = basePct;
			if (book.finishPage && basePage > 0) book.pages += Math.max(0, book.finishPage - basePage);
			else if (book.bookPages && book.from !== null && book.to !== null) book.pages += Math.max(0, Math.round((book.to - book.from) / 100 * book.bookPages));
		}
	}
	for (const book of books.values()) {
		if (book.realStart) book.started = false;
		// Finishing can log a page jump bigger than the book; never count more than its length.
		if (book.bookPages && book.pages > book.bookPages) book.pages = book.bookPages;
		if (!book.finished) book.rating = null;
		delete book.realStart;
		delete book.bookPages;
		delete book.bookId;
		delete book.lastPage;
		delete book.finishPage;
		delete book.needsBase;
	}
	// Keep books that moved forward, or were started or finished. Drops no-change and backwards blips.
	const kept = [...books.values()].filter((b) => b.started || b.finished || (b.from !== null && b.to !== null && b.to > b.from));
	const day: HardcoverDay = {
		books: kept,
		quotes,
		pages: kept.reduce((n, b) => n + b.pages, 0),
		lastRead: null,
	};
	if (!kept.length) {
		// Nothing that day: find the most recent day you made progress, so the card can say so.
		const before = await query<{ reading_journals: Array<Record<string, any>> }>(token, `
			query($user: Int!, $before: timestamp!) {
				reading_journals(where: { user_id: { _eq: $user }, event: { _eq: "progress_updated" }, created_at: { _lt: $before } },
					order_by: { created_at: desc }, limit: 50) { created_at metadata book { title } }
			}`, { user: userId, before: utc(date.clone().startOf("day")) });
		const hit = (before.reading_journals ?? []).find((r) => Number(r.metadata?.progress) > Number(r.metadata?.progress_was));
		if (hit?.book?.title) day.lastRead = { title: hit.book.title, date: window.moment.utc(hit.created_at).local().format("YYYY-MM-DD") };
	}
	return day;
}
