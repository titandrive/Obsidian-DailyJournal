import { App, moment, setIcon, TFile } from "obsidian";
import { entryDate, Moment } from "./dates";
import { PlaceModal, SongPickerModal } from "./modals";
import { CheckInFields, JournalSettings, Place } from "./settings";
import { HardcoverDay, savedReading } from "./hardcover";
import { meteoconSvg } from "./meteocons";
import { playerUrl, Song, SONG_KEYS, songProperties, thumbnailUrl, youtubeMusicUrl } from "./music";
import { blockFields, blockShowsWeather, parseBlock } from "./template";
import { entryPlace, fetchWeather, PIN_ICON, weatherIcon, weatherText } from "./weather";

/** What the cards need from the plugin. */
export interface JournalHost {
	app: App;
	settings: JournalSettings;
	weatherTried: Set<string>;
	setEntryPlace(file: TFile, place: Place | null, withWeather: boolean): Promise<string | null>;
	/** Fetch the entry's reading from Hardcover and save it in the entry. */
	refreshReading(file: TFile, date: Moment): Promise<void>;
	readingTried: Set<string>;
	journalEntries(): Array<{ file: TFile; date: Moment }>;
}

type Frontmatter = Record<string, unknown>;

const openFile = (app: App, file: TFile) => (e: MouseEvent) => {
	e.preventDefault();
	app.workspace.getLeaf(e.ctrlKey || e.metaKey).openFile(file);
};

function link(app: App, parent: HTMLElement, text: string, file: TFile, cls?: string): HTMLAnchorElement {
	const a = parent.createEl("a", { text, href: "#", cls });
	a.onclick = openFile(app, file);
	return a;
}

function card(parent: HTMLElement, label?: string): HTMLElement {
	const c = parent.createDiv({ cls: "dj-card" });
	if (label) c.createDiv({ cls: "dj-label", text: label });
	return c;
}

export async function renderSection(host: JournalHost, source: string, el: HTMLElement, file: TFile): Promise<void> {
	const { section, options } = parseBlock(source);
	const date = entryDate(host.settings, file);
	if (!date) return;
	const fm: Frontmatter = host.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	// Keep clicks inside the cards from moving the editor cursor into the code block.
	el.addEventListener("mousedown", (e) => { if (!(e.target instanceof HTMLAnchorElement)) e.stopPropagation(); });

	switch (section) {
		case "header": return renderHeader(host, el, file, date, fm, blockShowsWeather(options));
		case "reading":
		case "hardcover": // the block's name before it replaced the book-notes card
			return renderReading(host, el, file, date, fm);
		case "checkin": return renderCheckIn(host, el, file, fm, blockFields(options));
		case "song": return renderSong(host, el, file, fm);
		case "onthisday": return renderOnThisDay(host, el, date);
		case "row": {
			// Several cards side by side in one block, e.g. "row reading song": compact versions of each,
			// stacked again when the note is too narrow (see .dj-row-cards).
			const grid = el.createDiv({ cls: "dj-row-wrap" }).createDiv({ cls: "dj-row-cards" });
			await Promise.all(options.filter((o) => o !== "row" && o !== "header").map((o) => renderSection(host, o, grid.createDiv({ cls: "dj-row-cell" }), file)));
			return;
		}
	}
}

async function renderHeader(host: JournalHost, el: HTMLElement, file: TFile, date: Moment, fm: Frontmatter, weatherOn: boolean): Promise<void> {
	const { app, settings } = host;
	const c = card(el);
	const entries = host.journalEntries();
	const prev = [...entries].reverse().find((d) => d.date.isBefore(date, "day"));
	const next = entries.find((d) => d.date.isAfter(date, "day"));

	// Top row: previous entry far left, weekday centered, next entry far right.
	const bar = c.createDiv({ cls: "dj-topnav" });
	const left = bar.createDiv();
	bar.createDiv({ cls: "dj-label", text: date.format("dddd") });
	const right = bar.createDiv();
	if (prev) link(app, left, "‹ " + prev.date.format("MMM D"), prev.file, "dj-navlink");
	if (next) link(app, right, next.date.format("MMM D") + " ›", next.file, "dj-navlink");
	const big = c.createDiv({ cls: "dj-date", text: date.format("MMMM D") });
	big.createSpan({ cls: "dj-year", text: "  " + date.format("YYYY") });

	const chips = c.createDiv({ cls: "dj-row" });
	const weatherChip = chips.createSpan({ cls: "dj-chip" });
	const weatherIconEl = weatherChip.createSpan({ cls: "dj-weather-icon" });
	const weatherLabel = weatherChip.createSpan();
	const showWeather = (weather: string | null) => {
		weatherChip.toggle(!!weather);
		if (!weather) return;
		weatherIconEl.innerHTML = meteoconSvg(weatherIcon(weather));
		weatherLabel.setText(weatherText(weather));
	};
	showWeather(weatherOn && fm.weather ? String(fm.weather) : null);

	const place = entryPlace(fm, settings.home);
	const placeChip = chips.createEl("a", { cls: "dj-chip", href: "#", attr: { "aria-label": "Change location for this entry" } });
	placeChip.createSpan({ cls: "dj-icon" }).innerHTML = PIN_ICON;
	const placeName = placeChip.createSpan({ text: place.name });
	placeChip.onclick = (e) => {
		e.preventDefault();
		const current = entryPlace(app.metadataCache.getFileCache(file)?.frontmatter, settings.home);
		new PlaceModal(app, current.name !== settings.home.name ? settings.home : null, async (chosen) => {
			placeName.setText((chosen ?? settings.home).name);
			const weather = await host.setEntryPlace(file, chosen, weatherOn);
			showWeather(weatherOn ? weather : null);
		}).open();
	};

	// First time an entry is opened, look up that day's weather and save it.
	// Tried once per entry per session, so a failed lookup can't turn into a retry loop.
	if (weatherOn && !fm.weather && !host.weatherTried.has(file.path) && !date.isAfter(moment(), "day")) {
		host.weatherTried.add(file.path);
		const weather = await fetchWeather(place, date, settings.units);
		if (weather) {
			showWeather(weather);
			await app.fileManager.processFrontMatter(file, (f) => { f.weather = weather; });
		}
	}
}

async function renderReading(host: JournalHost, el: HTMLElement, file: TFile, date: Moment, fm: Frontmatter): Promise<void> {
	const day = savedReading(fm);
	if (day) return drawReading(el, day, date);

	// Not fetched yet: ask Hardcover once and save it in the entry (the card redraws from that).
	// After this, only "Refresh reading" asks again. Tried once per entry per session, so a
	// failed lookup can't turn into a retry loop.
	const muted = (text: string) => card(el, "Currently reading").createDiv({ cls: "dj-muted", text });
	if (!host.settings.hardcoverToken) return void muted("Add your Hardcover API token in Daily Journal's settings to show what you read.");
	if (date.isAfter(moment(), "day")) return;
	if (host.readingTried.has(file.path)) return void muted("Couldn't load from Hardcover. Run \"Refresh reading\" to try again.");
	host.readingTried.add(file.path);
	const loading = muted("Loading from Hardcover…");
	try {
		await host.refreshReading(file, date);
	} catch (e) {
		loading.setText(`Couldn't load from Hardcover: ${e instanceof Error ? e.message : String(e)} Run "Refresh reading" to try again.`);
	}
}

/** Lines a text element currently wraps to (one rect per line box). */
function lineCount(el: HTMLElement): number {
	const range = document.createRange();
	range.selectNodeContents(el);
	return new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
}

/**
 * Long titles step down in size until they fit on two lines (at most two steps). Measured once,
 * when the card is on screen: no observers, so a resize can never start a redraw loop.
 */
function shrinkToTwoLines(el: HTMLElement, sizes = ["0.92em", "0.82em"], tries = 0): void {
	if (!el.isConnected || !el.offsetWidth) {
		if (tries < 30) window.requestAnimationFrame(() => shrinkToTwoLines(el, sizes, tries + 1));
		return;
	}
	for (const size of sizes) {
		if (lineCount(el) <= 2) return;
		el.style.fontSize = size;
	}
}

export function drawReading(el: HTMLElement, day: HardcoverDay, date: Moment): void {
	const c = card(el, "Currently reading");
	if (!day.books.length && !day.quotes.length) {
		const last = day.lastRead ? moment(day.lastRead.date, "YYYY-MM-DD") : null;
		const gap = last ? date.clone().startOf("day").diff(last, "days") : 0;
		const text = day.lastRead && last
			? `No reading logged. Last read ${day.lastRead.title}, ${last.format("MMM D")} (${gap} day${gap === 1 ? "" : "s"} earlier).`
			: "No reading logged.";
		c.createDiv({ cls: "dj-muted", text });
		return;
	}

	// Day total, when more than one book (or time) is involved.
	if (day.pages && day.books.length > 1) c.createDiv({ cls: "dj-day-total", text: `${day.pages} pages` });

	for (const b of day.books) {
		const row = c.createDiv({ cls: "dj-book" });
		const initials = b.title.split(/[\s:]+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
		// The cover and title open the book on Hardcover. Opened explicitly: inside the editor, a plain
		// link's click doesn't reach Obsidian's link handling.
		const openBook = (e: MouseEvent) => { e.preventDefault(); if (b.url) window.open(b.url, "_blank"); };
		const linkable = (node: HTMLElement) => {
			if (!b.url) return node;
			node.addClass("dj-clickable");
			node.setAttr("aria-label", "Open on Hardcover");
			node.addEventListener("click", openBook);
			return node;
		};
		const fallback = () => { img?.remove(); row.prepend(linkable(createDiv({ cls: "dj-cover dj-cover-fallback", text: initials }))); };
		const img = b.cover ? linkable(row.createEl("img", { cls: "dj-cover", attr: { src: b.cover, alt: b.title } })) as HTMLImageElement : null;
		if (img) img.onerror = fallback; else fallback();

		const info = row.createDiv({ cls: "dj-book-info" });
		const title = info.createEl("a", { cls: "dj-book-title", text: b.title, href: b.url ?? "#" });
		if (b.url) title.addEventListener("click", openBook); else title.removeAttribute("href");
		shrinkToTwoLines(title);
		if (b.author) info.createDiv({ cls: "dj-book-author", text: b.author });
		const badges = info.createDiv({ cls: "dj-row" });
		if (b.started) badges.createSpan({ cls: "dj-badge", text: "Started" });
		if (b.finished) badges.createSpan({ cls: "dj-badge", text: b.rating ? `Finished · rated ${b.rating}` : "Finished" });
		if (b.to !== null) {
			info.createDiv({ cls: "dj-bar" }).createDiv().style.width = `${Math.min(100, b.to)}%`;
			const line = info.createDiv({ cls: "dj-progress" });
			line.createSpan({ cls: "dj-progress-pct", text: b.from !== null && b.from !== b.to ? `${Math.round(b.from)}% → ${Math.round(b.to)}%` : `${Math.round(b.to)}%` });
			if (b.pages) line.createSpan({ text: `+${b.pages} pages` });
		}
	}
	for (const q of day.quotes) {
		const bq = c.createEl("blockquote", { cls: "dj-quote", text: q.text });
		bq.createDiv({ cls: "dj-quote-source", text: "— " + q.book });
	}
}

function renderCheckIn(host: JournalHost, el: HTMLElement, file: TFile, fm: Frontmatter, fields: CheckInFields): void {
	const { app } = host;
	if (!Object.values(fields).some(Boolean)) return;
	const save = (key: string, value: unknown) => app.fileManager.processFrontMatter(file, (f) => {
		if (value === null) delete f[key]; else f[key] = value;
	});
	const list = card(el, "Check-in").createDiv({ cls: "dj-list" });
	const item = (name: string) => {
		const row = list.createDiv({ cls: "dj-item" });
		row.createDiv({ cls: "dj-name", text: name });
		return row.createDiv();
	};
	// Text box that wraps and grows with its content (CSS field-sizing), saved when you leave it.
	const textField = (parent: HTMLElement, key: string, placeholder: string) => {
		const t = parent.createEl("textarea", { cls: "dj-line", attr: { rows: "1", placeholder } });
		t.value = fm[key] != null ? String(fm[key]) : "";
		t.onchange = () => save(key, t.value.trim() || null);
		return t;
	};

	if (fields.rating) {
		// Tap a number, tinted from red (1) to green (10). Tap it again to clear.
		let rating = Number(fm.day_rating) || null;
		const scale = item("Day rating");
		scale.addClass("dj-scale");
		const dots: HTMLButtonElement[] = [];
		const paint = () => dots.forEach((d, i) => d.toggleClass("is-on", rating === i + 1));
		for (let i = 1; i <= 10; i++) {
			const b = scale.createEl("button", { text: String(i) });
			b.style.setProperty("--dj-hue", `hsl(${Math.round(((i - 1) / 9) * 125)}, 65%, 68%)`);
			b.onclick = () => { rating = rating === i ? null : i; paint(); save("day_rating", rating); };
			dots.push(b);
		}
		paint();
	}

	if (fields.sleep) {
		const row = item("Sleep");
		row.addClass("dj-sleep");
		const sleep = row.createEl("input", { cls: "dj-num", type: "text", attr: { inputmode: "decimal", placeholder: "—" } });
		sleep.value = fm.sleep != null ? String(fm.sleep) : "";
		row.createSpan({ text: "hours" });
		sleep.onchange = () => {
			const hours = parseFloat(sleep.value.replace(",", "."));
			const ok = !isNaN(hours) && hours >= 0 && hours <= 24;
			sleep.value = ok ? String(hours) : "";
			save("sleep", ok ? hours : null);
		};
	}

	// A Yes/No pill toggle saved as a boolean property. Tracked locally so it updates on click,
	// not after Obsidian re-reads the file. Tapping the selected pill clears it.
	const yesNo = (parent: HTMLElement, key: string, onChange?: (value: boolean | null) => void) => {
		const toggle = parent.createDiv({ cls: "dj-toggle" });
		let value: boolean | null = typeof fm[key] === "boolean" ? fm[key] as boolean : null;
		const pills = ([["Yes", true], ["No", false]] as Array<[string, boolean]>).map(([text, v]) => {
			const b = toggle.createEl("button", { text });
			b.onclick = () => { value = value === v ? null : v; paint(); save(key, value); };
			return { b, v };
		});
		const paint = () => {
			for (const { b, v } of pills) b.toggleClass("is-on", value === v);
			onChange?.(value);
		};
		return paint;
	};

	if (fields.work) yesNo(item("Work"), "worked")();

	if (fields.exercise) {
		const ex = item("Exercise");
		ex.addClass("dj-exercise");
		let note: HTMLTextAreaElement | null = null;
		const paint = yesNo(ex, "exercise", (value) => note?.toggle(value === true));
		note = textField(ex, "exercise_note", "What did you do?");
		paint();
	}

	if (fields.food) {
		const meals = item("Food");
		meals.addClass("dj-meals");
		const meal = (label: string, key: string, placeholder: string) => {
			const row = meals.createDiv({ cls: "dj-meal" });
			row.createSpan({ text: label });
			textField(row, key, placeholder);
		};
		meal("Breakfast", "breakfast", "What did you have for breakfast?");
		meal("Lunch", "lunch", "What did you have for lunch?");
		meal("Dinner", "dinner", "What did you have for dinner?");
		// Older entries kept food in a single "ate" property; still show it so nothing disappears.
		if (fm.ate) meal("Other", "ate", "");
	}

	if (fields.tags) {
		// Tags go in the note's own `tags` property (next to "journal"), so they work in search, the tag pane and Bases.
		const box = item("Tags");
		box.addClass("dj-tags");
		const chips = box.createDiv({ cls: "dj-row" });
		const input = box.createEl("input", { cls: "dj-tag-input", type: "text", attr: { placeholder: "Add a tag…", list: "dj-tag-list" } });
		// Suggest every tag in the vault, rebuilt on each focus so tags added elsewhere show up right away.
		const refreshSuggestions = () => {
			const list = document.getElementById("dj-tag-list") ?? document.body.createEl("datalist", { attr: { id: "dj-tag-list" } });
			list.empty();
			// getTags() exists in Obsidian but isn't in its published types.
			const vaultTags = (app.metadataCache as unknown as { getTags?: () => Record<string, number> }).getTags?.() ?? {};
			for (const tag of Object.keys(vaultTags).sort()) {
				const name = tag.replace(/^#/, "");
				if (name !== "journal") list.createEl("option", { attr: { value: name } });
			}
		};
		refreshSuggestions();
		const current = (): string[] => {
			const t = app.metadataCache.getFileCache(file)?.frontmatter?.tags;
			return (Array.isArray(t) ? t : t ? [t] : []).map(String);
		};
		let tags = current().filter((t) => t !== "journal");
		const store = () => app.fileManager.processFrontMatter(file, (f) => {
			const keep = (Array.isArray(f.tags) ? f.tags : f.tags ? [f.tags] : []).map(String).filter((t: string) => t === "journal");
			f.tags = [...(keep.length ? keep : ["journal"]), ...tags];
		});
		const paint = () => {
			chips.empty();
			chips.toggle(tags.length > 0);
			for (const tag of tags) {
				const chip = chips.createSpan({ cls: "dj-chip dj-tag", text: "#" + tag });
				const x = chip.createEl("button", { cls: "dj-tag-remove", text: "×", attr: { "aria-label": `Remove #${tag}` } });
				x.onclick = () => { tags = tags.filter((t) => t !== tag); paint(); void store(); };
			}
		};
		const add = () => {
			const fresh = input.value.split(/[,\s]+/).map((t) => t.replace(/^#+/, "").trim()).filter(Boolean)
				.filter((t) => t !== "journal" && !tags.includes(t));
			input.value = "";
			if (!fresh.length) return;
			tags = [...tags, ...fresh];
			paint();
			void store();
		};
		input.addEventListener("focus", refreshSuggestions);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } });
		input.addEventListener("change", add);
		paint();
	}
}

/** The song saved in an entry, or null (older Apple-based picks have no YouTube id and are ignored). */
function savedSong(fm: Frontmatter): Song | null {
	const id = typeof fm.song_id === "string" && /^[\w-]{11}$/.test(fm.song_id) ? fm.song_id : null;
	if (!fm.song || !id) return null;
	// Always show the band-free thumbnail, also for songs saved with an older one.
	return { id, title: String(fm.song), artist: fm.artist ? String(fm.artist) : "", cover: thumbnailUrl(id) };
}

function renderSong(host: JournalHost, el: HTMLElement, file: TFile, fm: Frontmatter): void {
	const { app, settings } = host;
	const body = card(el, "Earworm of the day").createDiv();
	const save = (song: Song | null) => app.fileManager.processFrontMatter(file, (f) => {
		for (const k of SONG_KEYS) delete f[k];
		if (song) Object.assign(f, songProperties(song));
	});
	const art = (parent: HTMLElement, song: Song, cls: string) => {
		const fallback = () => { img?.remove(); const d = createDiv({ cls: `${cls} dj-cover-fallback` }); setIcon(d, "music"); parent.prepend(d); };
		const img = song.cover ? parent.createEl("img", { cls, attr: { src: song.cover, alt: "" } }) : null;
		if (img) img.onerror = fallback; else fallback();
		return img;
	};

	const showSong = (song: Song) => {
		body.empty();
		const row = body.createDiv({ cls: "dj-book dj-song" });
		// Album art with a play button over it. The player is only created when you press play.
		const cover = row.createDiv({ cls: "dj-song-art" });
		art(cover, song, "dj-cover dj-song-cover");
		const play = cover.createEl("button", { cls: "dj-song-play", attr: { "aria-label": "Play" } });
		setIcon(play, "play");
		const info = row.createDiv({ cls: "dj-book-info" });
		const title = info.createEl("a", { cls: "dj-book-title", text: song.title, href: youtubeMusicUrl(song.id), attr: { "aria-label": "Open in YouTube Music" } });
		title.onclick = (e) => { e.preventDefault(); window.open(youtubeMusicUrl(song.id), "_blank"); };
		if (song.artist) info.createDiv({ cls: "dj-book-author", text: song.artist });
		const actions = info.createDiv({ cls: "dj-song-actions" });
		const change = actions.createEl("a", { cls: "dj-song-change", text: "Change", href: "#" });
		change.onclick = (e) => { e.preventDefault(); pick(); };
		const remove = actions.createEl("a", { cls: "dj-song-change", text: "Remove", href: "#" });
		remove.onclick = (e) => { e.preventDefault(); void save(null); showEmpty(); };

		let player: HTMLElement | null = null;
		play.onclick = () => {
			if (player) { player.remove(); player = null; setIcon(play, "play"); play.setAttr("aria-label", "Play"); return; }
			player = body.createDiv({ cls: "dj-song-player" });
			// Same frame settings as Obsidian's own YouTube embeds.
			player.createEl("iframe", { cls: "external-embed", attr: {
				src: playerUrl(song.id), title: song.title, frameborder: "0", allowfullscreen: "",
				allow: "autoplay; fullscreen; encrypted-media; picture-in-picture",
				sandbox: "allow-forms allow-presentation allow-same-origin allow-popups-to-escape-sandbox allow-scripts allow-modals allow-popups",
				referrerpolicy: "strict-origin-when-cross-origin",
			} });
			setIcon(play, "square"); play.setAttr("aria-label", "Stop");
		};
	};

	// Picking happens in a search dialog (roomy even when the card is half a row wide).
	const pick = () => new SongPickerModal(app, settings.youtubeApiKey, (song) => { showSong(song); void save(song); }).open();
	const showEmpty = () => {
		body.empty();
		const add = body.createEl("button", { cls: "dj-song-add" });
		setIcon(add.createSpan({ cls: "dj-song-add-icon" }), "music");
		add.createSpan({ text: "Add a song" });
		add.onclick = pick;
	};

	const song = savedSong(fm);
	if (song) showSong(song); else showEmpty();
}

function renderOnThisDay(host: JournalHost, el: HTMLElement, date: Moment): void {
	const monthAgo = date.clone().subtract(1, "month");
	const hits = host.journalEntries().filter((d) => d.date.isBefore(date, "day") && (
		d.date.isSame(monthAgo, "day") || (d.date.month() === date.month() && d.date.date() === date.date())
	)).reverse();
	if (!hits.length) return;
	const row = card(el, "On this day").createDiv({ cls: "dj-row" });
	for (const d of hits) link(host.app, row, d.date.format("MMM D, YYYY"), d.file, "dj-chip");
}
