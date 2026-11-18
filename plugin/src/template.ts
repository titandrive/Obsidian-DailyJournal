import { CheckInFields, JournalSettings } from "./settings";

/*
 * Each entry carries its own layout, written when the entry is created, so changing settings
 * later only affects new entries:
 *   - which cards it has: the `journal` blocks present in the note
 *   - weather on/off: the header block's options ("header weather" / "header no-weather")
 *   - check-in fields: the check-in block's options ("checkin rating sleep food")
 *   - title and Properties shown: the "dj-show-chrome" CSS class (hidden without it)
 * Blocks without options (entries made before this) keep their original behavior: weather on, all fields.
 */

export const SHOW_CHROME = "dj-show-chrome";

export const FIELD_KEYS: Array<keyof CheckInFields> = ["rating", "sleep", "work", "exercise", "food", "tags"];
type Section = "header" | "reading" | "song" | "watch" | "play" | "checkin" | "onthisday";

const block = (line: string) => "```journal\n" + line + "\n```\n";

export function parseBlock(source: string): { section: string; options: string[] } {
	const [section = "", ...options] = source.trim().split(/\s+/);
	return { section, options };
}

export function blockShowsWeather(options: string[]): boolean {
	return !options.includes("no-weather");
}

/** Which earlier entries an On this day block shows. Entries from before these options existed show both. */
export function blockOnThisDay(options: string[]): { month: boolean; years: boolean } {
	const month = options.includes("month"), years = options.includes("years");
	return month || years ? { month, years } : { month: true, years: true };
}

export function blockFields(options: string[]): CheckInFields {
	const listed = options.filter((o): o is keyof CheckInFields => (FIELD_KEYS as string[]).includes(o));
	// Entries from before field options existed had exactly these four.
	if (!listed.length) return { rating: true, sleep: true, work: false, exercise: true, food: true, tags: false };
	const has = (k: keyof CheckInFields) => listed.includes(k);
	return { rating: has("rating"), sleep: has("sleep"), work: has("work"), exercise: has("exercise"), food: has("food"), tags: has("tags") };
}

/** The block line for each card under the current settings, or null when the card is off. */
function layoutLines(settings: JournalSettings): Record<Section, string | null> {
	const fields = FIELD_KEYS.filter((k) => settings.fields[k]);
	return {
		header: settings.showWeather ? "header weather" : "header no-weather",
		reading: settings.showReading ? "reading" : null,
		song: settings.showSong ? "song" : null,
		// Watching and Playing need their key; without one the card stays off.
		watch: settings.showWatching && settings.tmdbKey ? "watch" : null,
		play: settings.showPlaying && settings.rawgKey ? "play" : null,
		checkin: fields.length ? "checkin " + fields.join(" ") : null,
		onthisday: settings.showOnThisDay && (settings.onThisDayMonth || settings.onThisDayYears)
			? ["onthisday", settings.onThisDayMonth && "month", settings.onThisDayYears && "years"].filter(Boolean).join(" ")
			: null,
	};
}

/** Body of a new journal entry. The cards are `journal` code blocks the plugin renders. */
export function entryTemplate(settings: JournalSettings): string {
	const home = settings.home;
	const lines = layoutLines(settings);
	const parts = [
		"---", "tags:", "  - journal", "cssclasses:", "  - journal",
		// Title and Properties are hidden in entries unless the entry was made with them shown.
		...(settings.hideNoteChrome ? [] : ["  - " + SHOW_CHROME]),
		// The default location is saved in the entry, so changing it later doesn't move old entries.
		`location: ${JSON.stringify(home.name)}`, `latitude: ${home.lat}`, `longitude: ${home.lon}`, `timezone: ${JSON.stringify(home.tz)}`,
		"---", "",
	];
	for (const section of ["header", "onthisday", "reading", "song", "watch", "play", "checkin"] as Section[]) {
		const line = lines[section];
		if (!line) continue;
		// On this day hugs the header (no blank line), so when it has nothing to show it takes no space.
		if (section === "onthisday") { parts[parts.length - 1] += block(line); continue; }
		// Reading and Song share one row, side by side, when both are on; so do Watching and Playing.
		if (section === "reading" && lines.song) { parts.push(block(ROW_LINE)); continue; }
		if (section === "song" && lines.reading) continue;
		if (section === "watch" && lines.play) { parts.push(block(MEDIA_ROW_LINE)); continue; }
		if (section === "play" && lines.watch) continue;
		parts.push(block(line));
	}
	for (const prompt of settings.prompts) {
		parts.push(`${"#".repeat(2 + prompt.level)} ${prompt.text}`, ""); // one empty line to write on
	}
	return parts.join("\n");
}

const BLOCK = (section: Section) => new RegExp("```journal\\n" + section + "(?:[ \\t][^\\n]*)?\\n```\\n?");

/** Reading and Song side by side in one block (see renderSection's "row"); Watching and Playing likewise. */
const ROW_LINE = "row reading song";
const MEDIA_ROW_LINE = "row watch play";
const ROW = /```journal\nrow(?:[ \t]([^\n]*))?\n```\n?/g;

/**
 * An existing entry rewritten to the current card settings: cards added or removed, weather and
 * check-in options updated. Writing, headings and properties are left alone. Notes without a
 * header block aren't journal-layout entries and come back unchanged.
 */
export function applyLayout(text: string, settings: JournalSettings): string {
	if (!BLOCK("header").test(text)) return text;
	const lines = layoutLines(settings);
	let out = text.replace(BLOCK("header"), block(lines.header as string));

	// "hardcover" was the Reading card's block name while it sat beside the old book-notes card.
	const HARDCOVER = /```journal\nhardcover(?:[ \t][^\n]*)?\n```\n?/;
	if (HARDCOVER.test(out)) {
		out = BLOCK("reading").test(out) ? out.replace(new RegExp(HARDCOVER.source + "\\n?"), "") : out.replace(HARDCOVER, block("reading"));
	}

	// A side-by-side row counts as its cards for now; it's rebuilt below when both are on.
	out = out.replace(ROW, (_m, opts: string | undefined) => (opts ?? "").trim().split(/\s+/).filter(Boolean).map((o) => block(o)).join("\n"));

	// Cards between the header and the writing, in order: reading, song, watching, playing, then check-in.
	const order: Section[] = ["header", "reading", "song", "watch", "play", "checkin"];
	for (const section of ["reading", "song", "watch", "play", "checkin"] as Section[]) {
		const line = lines[section];
		if (line && BLOCK(section).test(out)) {
			out = out.replace(BLOCK(section), block(line));
		} else if (line) {
			// Insert after the nearest earlier card that's present.
			const before = order.slice(0, order.indexOf(section)).reverse().find((s) => BLOCK(s).test(out)) ?? "header";
			out = out.replace(BLOCK(before), (m) => m + "\n" + block(line));
		} else {
			out = out.replace(new RegExp(BLOCK(section).source + "\\n?"), "");
		}
	}

	// Both on: Reading and Song share one row, and so do Watching and Playing.
	if (lines.reading && lines.song && BLOCK("reading").test(out) && BLOCK("song").test(out)) {
		out = out.replace(BLOCK("reading"), block(ROW_LINE)).replace(new RegExp(BLOCK("song").source + "\\n?"), "");
	}
	if (lines.watch && lines.play && BLOCK("watch").test(out) && BLOCK("play").test(out)) {
		out = out.replace(BLOCK("watch"), block(MEDIA_ROW_LINE)).replace(new RegExp(BLOCK("play").source + "\\n?"), "");
	}

	// On this day sits right after the header (it used to be at the end of the entry).
	out = out.replace(new RegExp("\\n*" + BLOCK("onthisday").source), "\n");
	if (lines.onthisday) out = out.replace(BLOCK("header"), (m) => m + block(lines.onthisday as string));
	return out;
}
