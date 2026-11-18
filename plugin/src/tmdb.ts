import { requestWithin } from "./net";

/*
 * What you watched, from TMDB (The Movie Database): search movies and TV shows, then a show's
 * seasons and episodes. Needs a free TMDB key: either the short "API Key" or the long "API Read
 * Access Token" works. This product uses the TMDB API but is not endorsed or certified by TMDB.
 */

/** A movie, a whole TV show, or one episode of a show. */
export interface Watch {
	kind: "movie" | "tv";
	id: number;
	title: string;
	year?: string | null;
	poster?: string | null;
	season?: number | null;
	episode?: number | null;
	episodeTitle?: string | null;
	url: string;
}

export interface Season {
	number: number;
	name: string;
	episodes: number;
	year?: string | null;
}

export interface Episode {
	number: number;
	title: string;
	date?: string | null;
}

const IMAGE = "https://image.tmdb.org/t/p/w342";
const year = (date: unknown) => (typeof date === "string" && date.length >= 4 ? date.slice(0, 4) : null);
const pageUrl = (kind: "movie" | "tv", id: number) => `https://www.themoviedb.org/${kind}/${id}`;

/** One TMDB request. The long read-access token goes in a header; the short API key in the URL. */
async function tmdb(key: string, path: string, query: Record<string, string> = {}): Promise<any> {
	const k = key.trim();
	if (!k) throw new Error("Add a TMDB API key in Daily Journal's settings.");
	const token = k.startsWith("eyJ") || k.length > 60;
	const params = new URLSearchParams({ ...query, ...(token ? {} : { api_key: k }) });
	const res = await requestWithin("TMDB", {
		url: `https://api.themoviedb.org/3${path}?${params}`,
		headers: { accept: "application/json", ...(token ? { Authorization: `Bearer ${k}` } : {}) },
		throw: false,
	});
	if (res.status === 401) throw new Error("TMDB didn't accept the API key.");
	if (res.status < 200 || res.status >= 300) throw new Error(`TMDB answered ${res.status}.`);
	return res.json;
}

/** Movies and shows matching a title, most relevant first. */
export async function searchTitles(key: string, query: string): Promise<Watch[]> {
	const data = await tmdb(key, "/search/multi", { query, include_adult: "false" });
	return (data?.results ?? [])
		.filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
		.slice(0, 15)
		.map((r: any): Watch => ({
			kind: r.media_type,
			id: r.id,
			title: String(r.title ?? r.name ?? ""),
			year: year(r.release_date ?? r.first_air_date),
			poster: r.poster_path ? IMAGE + r.poster_path : null,
			url: pageUrl(r.media_type, r.id),
		}));
}

/** A show's seasons, in order (specials, if any, last). */
export async function seasonsOf(key: string, showId: number): Promise<Season[]> {
	const data = await tmdb(key, `/tv/${showId}`);
	const seasons: Season[] = (data?.seasons ?? []).map((s: any) => ({
		number: Number(s.season_number), name: String(s.name ?? `Season ${s.season_number}`), episodes: Number(s.episode_count ?? 0), year: year(s.air_date),
	}));
	return [...seasons.filter((s) => s.number > 0), ...seasons.filter((s) => s.number === 0)];
}

/** The episodes of one season, in order. */
export async function episodesOf(key: string, showId: number, season: number): Promise<Episode[]> {
	const data = await tmdb(key, `/tv/${showId}/season/${season}`);
	return (data?.episodes ?? []).map((e: any) => ({ number: Number(e.episode_number), title: String(e.name ?? ""), date: e.air_date ?? null }));
}

/** Check a key with one small search. */
export async function testTmdbKey(key: string): Promise<string> {
	const found = await searchTitles(key, "Better Call Saul");
	return found.length ? "TMDB works." : "The key works, but the test search found nothing.";
}

/** "S4E6" */
export const episodeCode = (w: Watch) => (w.season != null && w.episode != null ? `S${w.season}E${w.episode}` : null);

/** Properties an entry saves for what you watched, so Bases and Insights can use them. */
export const WATCH_KEYS = [
	"watching", "watching_type", "watching_year", "watching_season", "watching_episode", "watching_episode_title",
	"watching_poster", "watching_url", "watching_tmdb",
];

export function watchProperties(w: Watch): Record<string, unknown> {
	const props: Record<string, unknown> = {
		watching: w.title, watching_type: w.kind, watching_year: w.year ?? null, watching_poster: w.poster ?? null,
		watching_url: w.url, watching_tmdb: w.id,
	};
	if (w.kind === "tv" && w.season != null) props.watching_season = w.season;
	if (w.kind === "tv" && w.episode != null) { props.watching_episode = w.episode; props.watching_episode_title = w.episodeTitle ?? null; }
	for (const k of Object.keys(props)) if (props[k] === null) delete props[k];
	return props;
}

/** What an entry says you watched, or null. */
export function savedWatch(fm: Record<string, any>): Watch | null {
	if (!fm.watching) return null;
	const kind = fm.watching_type === "movie" ? "movie" : "tv";
	const id = Number(fm.watching_tmdb) || 0;
	return {
		kind, id, title: String(fm.watching),
		year: fm.watching_year != null ? String(fm.watching_year) : null,
		poster: typeof fm.watching_poster === "string" ? fm.watching_poster : null,
		season: fm.watching_season != null ? Number(fm.watching_season) : null,
		episode: fm.watching_episode != null ? Number(fm.watching_episode) : null,
		episodeTitle: fm.watching_episode_title != null ? String(fm.watching_episode_title) : null,
		url: typeof fm.watching_url === "string" ? fm.watching_url : (id ? pageUrl(kind, id) : "https://www.themoviedb.org"),
	};
}
