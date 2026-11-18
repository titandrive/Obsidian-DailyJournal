import { requestWithin } from "./net";

/*
 * What you played, from RAWG (rawg.io), a free video game database. Needs a free RAWG API key.
 * RAWG asks apps using its data to credit it with a link, which the Playing card's settings do.
 */

export interface Game {
	id: number;
	title: string;
	year?: string | null;
	cover?: string | null;
	platforms: string[];
	url: string;
}

async function rawg(key: string, path: string, query: Record<string, string> = {}): Promise<any> {
	const k = key.trim();
	if (!k) throw new Error("Add a RAWG API key in Daily Journal's settings.");
	const params = new URLSearchParams({ ...query, key: k });
	const res = await requestWithin("RAWG", { url: `https://api.rawg.io/api${path}?${params}`, headers: { accept: "application/json" }, throw: false });
	if (res.status === 401 || res.status === 403) throw new Error("RAWG didn't accept the API key.");
	if (res.status < 200 || res.status >= 300) throw new Error(`RAWG answered ${res.status}.`);
	return res.json;
}

/** Games matching a title, most relevant first. */
export async function searchGames(key: string, query: string): Promise<Game[]> {
	const data = await rawg(key, "/games", { search: query, page_size: "12", search_precise: "true" });
	return (data?.results ?? []).map((g: any): Game => ({
		id: Number(g.id),
		title: String(g.name ?? ""),
		year: typeof g.released === "string" ? g.released.slice(0, 4) : null,
		cover: typeof g.background_image === "string" ? g.background_image : null,
		platforms: (g.platforms ?? []).map((p: any) => String(p?.platform?.name ?? "")).filter(Boolean),
		url: g.slug ? `https://rawg.io/games/${g.slug}` : `https://rawg.io/games/${g.id}`,
	}));
}

/** Check a key with one small search. */
export async function testRawgKey(key: string): Promise<string> {
	const found = await searchGames(key, "Hades");
	return found.length ? "RAWG works." : "The key works, but the test search found nothing.";
}

/** Properties an entry saves for what you played, so Bases and Insights can use them. */
export const GAME_KEYS = ["playing", "playing_year", "playing_cover", "playing_platforms", "playing_url", "playing_rawg"];

export function gameProperties(g: Game): Record<string, unknown> {
	const props: Record<string, unknown> = {
		playing: g.title, playing_year: g.year ?? null, playing_cover: g.cover ?? null,
		playing_platforms: g.platforms.length ? g.platforms : null, playing_url: g.url, playing_rawg: g.id,
	};
	for (const k of Object.keys(props)) if (props[k] === null) delete props[k];
	return props;
}

/** What an entry says you played, or null. */
export function savedGame(fm: Record<string, any>): Game | null {
	if (!fm.playing) return null;
	return {
		id: Number(fm.playing_rawg) || 0,
		title: String(fm.playing),
		year: fm.playing_year != null ? String(fm.playing_year) : null,
		cover: typeof fm.playing_cover === "string" ? fm.playing_cover : null,
		platforms: Array.isArray(fm.playing_platforms) ? fm.playing_platforms.map(String) : [],
		url: typeof fm.playing_url === "string" ? fm.playing_url : "https://rawg.io",
	};
}
