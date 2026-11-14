import { requestWithin } from "./net";

/*
 * Song of the day, from YouTube.
 *   - No key: paste a YouTube or YouTube Music link; YouTube's oEmbed service (free, no key) gives
 *     the title, channel and thumbnail.
 *   - With a YouTube Data API key: search by song, artist or both.
 * Either way the song plays in full in YouTube's embedded player, and the title opens it in
 * YouTube Music.
 *
 * Podcasts come from Apple's podcast directory (free, no key): search finds episodes with their
 * show, artwork and the episode's own audio file (from the show's public feed), which plays in a
 * plain audio player. Nothing opens in Apple: the title links to the episode's page from its feed.
 * A pasted YouTube link in podcast mode still works as a YouTube episode.
 */

export type SongKind = "music" | "podcast";

export interface Song {
	id: string; // YouTube video id
	title: string; // song, or podcast episode
	artist: string; // artist, or podcast show
	cover: string | null; // thumbnail URL
	kind: SongKind;
	/** Directory podcasts: the episode's audio file, and its web page (when known). YouTube items have neither. */
	audio?: string | null;
	page?: string | null;
	/** Directory podcasts: the show's id in the directory, for listing its latest episodes. */
	showId?: number | null;
	/** Directory podcasts: what's needed to find the episode's page in its feed when picked. */
	feedUrl?: string | null;
	guid?: string | null;
	date?: string | null; // YYYY-MM-DD
}

/** The video id in a YouTube / YouTube Music / youtu.be link, or null when it isn't one. */
export function videoIdFromUrl(text: string): string | null {
	const t = text.trim();
	if (!/^(https?:\/\/)?([\w-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(t)) return null;
	const m = t.match(/(?:[?&]v=|youtu\.be\/|\/(?:embed|shorts|live|v)\/)([\w-]{11})/);
	return m ? m[1] : null;
}

export const youtubeMusicUrl = (id: string) => `https://music.youtube.com/watch?v=${id}`;
/** The widescreen thumbnail: unlike hqdefault (4:3), it has no letterbox bands, so a square crop is clean. */
export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/**
 * Embedded player URL that starts playing right away. YouTube refuses to play inside Obsidian's
 * desktop app (its pages aren't served over https, so YouTube shows "Video unavailable"); Obsidian's
 * own note embeds go through a small page it hosts for that, so the card does the same.
 */
export function playerUrl(id: string): string {
	const params = `autoplay=1&rel=0`;
	if (location.protocol !== "https:" && /obsidian/i.test(navigator.userAgent)) {
		return `https://releases.obsidian.md/youtube?v=${encodeURIComponent(id)}&${params}`;
	}
	return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
}

/**
 * Song and artist from a video's title and channel. Official "Artist - Topic" uploads have a clean
 * title; music videos are usually "Artist - Song (Official Video)". Podcast episodes keep their
 * whole title, with the channel as the show.
 */
function songFrom(id: string, rawTitle: string, channel: string, cover: string | null, kind: SongKind = "music"): Song {
	let title = decodeEntities(rawTitle).trim();
	let artist = decodeEntities(channel).replace(/\s+-\s+Topic$/i, "").replace(/VEVO$/i, "").trim();
	if (kind === "podcast") return { id, title: title || rawTitle, artist, cover: cover ?? thumbnailUrl(id), kind };
	const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
	if (dash && !/\s-\s+Topic$/i.test(channel)) { artist = dash[1].trim(); title = dash[2].trim(); }
	title = title
		.replace(/\s*[([](official|lyric|lyrics|audio|video|music video|visualizer|hd|4k|remaster|remastered)[^)\]]*[)\]]/gi, "")
		.replace(/\s*\|.*$/, "") // "Song | Live at ..." / "Song | Remastered"
		.replace(/(\s+(hq|hd|4k))?(\s*[+&]\s*|\s+with\s+)?\s*\blyrics?\s*$/i, "") // "Song HQ + Lyrics", "Song Lyrics"
		.replace(/\s+(hq|hd|4k)\s*$/i, "")
		.replace(/\s+/g, " ").trim();
	return { id, title: title || rawTitle, artist, cover: cover ?? thumbnailUrl(id), kind };
}

function decodeEntities(s: string): string {
	return s.replace(/&(#\d+|#x[\da-f]+|amp|quot|apos|lt|gt|#39);/gi, (m, e: string) => {
		const named: Record<string, string> = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", "#39": "'" };
		if (named[e.toLowerCase()]) return named[e.toLowerCase()];
		const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
		return Number.isFinite(code) ? String.fromCodePoint(code) : m;
	});
}

/** A pasted link's song, via YouTube's oEmbed service (no key needed). */
export async function songFromLink(text: string, kind: SongKind = "music"): Promise<Song> {
	const id = videoIdFromUrl(text);
	if (!id) throw new Error("That isn't a YouTube or YouTube Music link.");
	const res = await requestWithin("YouTube", {
		url: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
		throw: false,
	});
	if (res.status === 400 || res.status === 401 || res.status === 404) throw new Error("YouTube couldn't find that video (it may be private or removed).");
	if (res.status >= 400) throw new Error(`YouTube error (${res.status}).`);
	return songFrom(id, String(res.json.title ?? ""), String(res.json.author_name ?? ""), thumbnailUrl(id), kind);
}

/**
 * Videos matching a song, an artist or both (needs a YouTube Data API key). Music searches YouTube's
 * Music category; podcasts search long videos (over 20 minutes), where full episodes are.
 */
export async function searchSongs(apiKey: string, term: string, limit = 8, kind: SongKind = "music"): Promise<Song[]> {
	const q = term.trim();
	if (!q) return [];
	// Music: the Music category plus YouTube's music topic, which drops talk clips and Shorts filed as music.
	const filter = kind === "podcast" ? "&videoDuration=long" : "&videoCategoryId=10&topicId=%2Fm%2F04rlf";
	const res = await requestWithin("YouTube", {
		url: `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video${filter}` +
			`&maxResults=${limit}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey.trim())}`,
		throw: false,
	});
	if (res.status === 400 || res.status === 403) {
		const reason = res.json?.error?.errors?.[0]?.reason ?? res.json?.error?.status ?? "";
		if (/quota/i.test(reason)) throw new Error("Today's YouTube search allowance is used up. Paste a link instead, or try tomorrow.");
		throw new Error("YouTube rejected the API key. Check it in Daily Journal's settings.");
	}
	if (res.status >= 400) throw new Error(`YouTube search failed (${res.status}).`);
	return (res.json?.items ?? [])
		.filter((it: Record<string, any>) => it.id?.videoId)
		.map((it: Record<string, any>) => songFrom(
			it.id.videoId, String(it.snippet?.title ?? ""), String(it.snippet?.channelTitle ?? ""),
			null, // always the band-free thumbnail (see thumbnailUrl)
			kind,
		));
}

const words = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

function episodeFrom(r: Record<string, any>): Song {
	return {
		id: String(r.trackId ?? ""),
		title: decodeEntities(String(r.trackName)).trim(),
		artist: decodeEntities(String(r.collectionName ?? "")).trim(),
		cover: r.artworkUrl600 ?? r.artworkUrl160 ?? r.artworkUrl100 ?? null,
		kind: "podcast",
		showId: Number(r.collectionId) || null,
		audio: String(r.episodeUrl),
		page: null,
		feedUrl: r.feedUrl ? String(r.feedUrl) : null,
		guid: r.episodeGuid ? String(r.episodeGuid) : null,
		date: r.releaseDate ? String(r.releaseDate).slice(0, 10) : null,
	};
}

const newestFirst = (a: Song, b: Song) => (b.date ?? "").localeCompare(a.date ?? "");

async function directory(url: string): Promise<Record<string, any>[]> {
	const res = await requestWithin("The podcast directory", { url, throw: false });
	if (res.status >= 400) throw new Error(`Podcast search failed (${res.status}).`);
	return res.json?.results ?? [];
}

/** Podcast episodes matching what you typed, in the directory's own (relevance) order (no key needed). */
export async function searchEpisodes(term: string, limit = 10): Promise<Song[]> {
	const q = term.trim();
	if (!q) return [];
	return (await directory(`https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=${limit}&term=${encodeURIComponent(q)}`))
		.filter((r) => r.episodeUrl && r.trackName)
		.map(episodeFrom);
}

/** Podcasts (shows) whose name matches what you typed: every typed word appears in the name, or vice versa. */
export async function searchShows(term: string, limit = 2): Promise<Array<{ id: number; name: string; cover: string | null }>> {
	const typed = words(term);
	if (!typed.length) return [];
	return (await directory(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=8&term=${encodeURIComponent(term.trim())}`))
		.map((r) => ({ id: Number(r.collectionId), name: decodeEntities(String(r.collectionName ?? "")).trim(), cover: r.artworkUrl600 ?? r.artworkUrl100 ?? null }))
		.filter((sh) => {
			const name = words(sh.name);
			return sh.id && name.length && (typed.every((w) => name.includes(w)) || name.every((w) => typed.includes(w)));
		})
		.slice(0, limit);
}

/** A show's latest episodes, newest first (up to 200), optionally only titles containing `filter`'s words. */
export async function showEpisodes(showId: number, filter = "", limit = 50): Promise<Song[]> {
	const want = words(filter);
	return (await directory(`https://itunes.apple.com/lookup?id=${showId}&media=podcast&entity=podcastEpisode&limit=200`))
		.filter((r) => r.wrapperType === "podcastEpisode" && r.episodeUrl && r.trackName)
		.map(episodeFrom)
		.filter((e) => { const t = words(e.title); return want.every((w) => t.some((x) => x.startsWith(w))); })
		.sort(newestFirst)
		.slice(0, limit);
}

/**
 * The episode's web page: its feed id when that's a link, else the episode's <link> in the show's
 * feed, else the show's website. Looked up once, when the episode is picked.
 */
export async function episodePage(song: Song): Promise<string | null> {
	if (song.guid && /^https?:\/\//.test(song.guid)) return song.guid;
	if (!song.feedUrl) return null;
	try {
		const res = await requestWithin("The podcast's feed", { url: song.feedUrl, throw: false });
		if (res.status >= 400) return null;
		const xml = new DOMParser().parseFromString(res.text, "text/xml");
		const items = Array.from(xml.querySelectorAll("item"));
		const item = items.find((it) => (song.guid && it.querySelector("guid")?.textContent?.trim() === song.guid)
			|| (song.audio && it.querySelector("enclosure")?.getAttribute("url") === song.audio));
		const link = item?.querySelector("link")?.textContent?.trim() || xml.querySelector("channel > link")?.textContent?.trim();
		return link && /^https?:\/\//.test(link) ? link : null;
	} catch {
		return null;
	}
}

/** Properties saved in the entry for the chosen song or episode. */
export function songProperties(song: Song): Record<string, unknown> {
	if (song.audio) {
		const props: Record<string, unknown> = { song: song.title, artist: song.artist, song_cover: song.cover, song_kind: "podcast", song_audio: song.audio, song_id: song.id };
		if (song.page) props.song_url = song.page;
		return props;
	}
	const props: Record<string, unknown> = { song: song.title, artist: song.artist, song_cover: song.cover, song_id: song.id, song_url: youtubeMusicUrl(song.id) };
	if (song.kind === "podcast") props.song_kind = "podcast";
	return props;
}

export const SONG_KEYS = ["song", "artist", "song_cover", "song_id", "song_url", "song_kind", "song_audio", "song_album", "song_apple"];
