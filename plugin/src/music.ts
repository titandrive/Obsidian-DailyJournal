import { requestUrl } from "obsidian";

/*
 * Song of the day, from YouTube.
 *   - No key: paste a YouTube or YouTube Music link; YouTube's oEmbed service (free, no key) gives
 *     the title, channel and thumbnail.
 *   - With a YouTube Data API key: search by song, artist or both.
 * Either way the song plays in full in YouTube's embedded player, and the title opens it in
 * YouTube Music.
 */

export interface Song {
	id: string; // YouTube video id
	title: string;
	artist: string;
	cover: string | null; // thumbnail URL
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
 * title; music videos are usually "Artist - Song (Official Video)".
 */
function songFrom(id: string, rawTitle: string, channel: string, cover: string | null): Song {
	let title = decodeEntities(rawTitle).trim();
	let artist = decodeEntities(channel).replace(/\s+-\s+Topic$/i, "").replace(/VEVO$/i, "").trim();
	const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
	if (dash && !/\s-\s+Topic$/i.test(channel)) { artist = dash[1].trim(); title = dash[2].trim(); }
	title = title
		.replace(/\s*[([](official|lyric|lyrics|audio|video|music video|visualizer|hd|4k|remaster|remastered)[^)\]]*[)\]]/gi, "")
		.replace(/\s*\|.*$/, "") // "Song | Live at ..." / "Song | Remastered"
		.replace(/(\s+(hq|hd|4k))?(\s*[+&]\s*|\s+with\s+)?\s*\blyrics?\s*$/i, "") // "Song HQ + Lyrics", "Song Lyrics"
		.replace(/\s+(hq|hd|4k)\s*$/i, "")
		.replace(/\s+/g, " ").trim();
	return { id, title: title || rawTitle, artist, cover: cover ?? thumbnailUrl(id) };
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
export async function songFromLink(text: string): Promise<Song> {
	const id = videoIdFromUrl(text);
	if (!id) throw new Error("That isn't a YouTube or YouTube Music link.");
	const res = await requestUrl({
		url: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
		throw: false,
	});
	if (res.status === 400 || res.status === 401 || res.status === 404) throw new Error("YouTube couldn't find that video (it may be private or removed).");
	if (res.status >= 400) throw new Error(`YouTube error (${res.status}).`);
	return songFrom(id, String(res.json.title ?? ""), String(res.json.author_name ?? ""), thumbnailUrl(id));
}

/** Music videos matching a song, an artist or both (needs a YouTube Data API key). */
export async function searchSongs(apiKey: string, term: string, limit = 8): Promise<Song[]> {
	const q = term.trim();
	if (!q) return [];
	const res = await requestUrl({
		url: "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10" +
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
		));
}

/** Properties saved in the entry for the chosen song. */
export function songProperties(song: Song): Record<string, unknown> {
	return { song: song.title, artist: song.artist, song_cover: song.cover, song_id: song.id, song_url: youtubeMusicUrl(song.id) };
}

export const SONG_KEYS = ["song", "artist", "song_cover", "song_id", "song_url", "song_album", "song_apple"];
