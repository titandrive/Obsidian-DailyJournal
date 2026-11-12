import { App, moment, setIcon, TFile } from "obsidian";
import { bookFromLink, bookLink, currentBook, highlightsOn, pct } from "./books";
import { entryDate, Moment } from "./dates";
import { PlaceModal } from "./modals";
import { CheckInFields, JournalSettings, Place } from "./settings";
import { blockFields, blockShowsWeather, parseBlock } from "./template";
import { entryPlace, fetchWeather, PIN_ICON, weatherIcon, weatherText } from "./weather";

/** What the cards need from the plugin. */
export interface JournalHost {
	app: App;
	settings: JournalSettings;
	weatherTried: Set<string>;
	setEntryPlace(file: TFile, place: Place | null, withWeather: boolean): Promise<string | null>;
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
		case "reading": return renderReading(host, el, file, date, fm);
		case "checkin": return renderCheckIn(host, el, file, fm, blockFields(options));
		case "onthisday": return renderOnThisDay(host, el, date);
	}
}

async function renderHeader(host: JournalHost, el: HTMLElement, file: TFile, date: Moment, fm: Frontmatter, weatherOn: boolean): Promise<void> {
	const { app, settings } = host;
	const c = card(el);
	const top = c.createDiv({ cls: "dj-header" });
	const title = top.createDiv();
	title.createDiv({ cls: "dj-label", text: date.format("dddd") });
	const big = title.createDiv({ cls: "dj-date", text: date.format("MMMM D") });
	big.createSpan({ cls: "dj-year", text: "  " + date.format("YYYY") });

	const nav = top.createDiv({ cls: "dj-row" });
	const entries = host.journalEntries();
	const prev = [...entries].reverse().find((d) => d.date.isBefore(date, "day"));
	const next = entries.find((d) => d.date.isAfter(date, "day"));
	if (prev) link(app, nav, "‹ " + prev.date.format("MMM D"), prev.file, "dj-chip");
	if (next) link(app, nav, next.date.format("MMM D") + " ›", next.file, "dj-chip");

	const chips = c.createDiv({ cls: "dj-row" });
	const weatherChip = chips.createSpan({ cls: "dj-chip" });
	const weatherIconEl = weatherChip.createSpan({ cls: "dj-icon" });
	const weatherLabel = weatherChip.createSpan();
	const showWeather = (weather: string | null) => {
		weatherChip.toggle(!!weather);
		if (!weather) return;
		setIcon(weatherIconEl, weatherIcon(weather));
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
	const { app, settings } = host;
	let book = bookFromLink(app, fm.book, file.path);
	let progress = pct(fm.book_progress);

	// While it's still that day, keep the snapshot in step with the reader.
	if (date.isSame(moment(), "day")) {
		const live = currentBook(app, settings.booksFolder);
		if (live && (live.file !== book || live.progress !== progress)) {
			await app.fileManager.processFrontMatter(file, (f) => {
				f.book = bookLink(app, live.file);
				f.book_progress = live.progress;
			});
			book = live.file;
			progress = live.progress;
		}
	}

	// Progress change since the previous entry that read the same book.
	let before: number | null = null;
	for (const d of [...host.journalEntries()].reverse()) {
		if (!d.date.isBefore(date, "day")) continue;
		const pfm = app.metadataCache.getFileCache(d.file)?.frontmatter ?? {};
		if (pct(pfm.book_progress) === null) continue;
		if (bookFromLink(app, pfm.book, d.file.path) === book) before = pct(pfm.book_progress);
		break;
	}

	const quotes = await highlightsOn(app, settings.booksFolder, date.format("MMM D, YYYY"));
	if (!book && !quotes.length) return;

	const c = card(el, "Reading");
	if (book) {
		const bfm = app.metadataCache.getFileCache(book)?.frontmatter ?? {};
		const row = c.createDiv({ cls: "dj-book" });
		const cover = bfm.cover && app.metadataCache.getFirstLinkpathDest(String(bfm.cover), book.path);
		if (cover) {
			row.createEl("img", { cls: "dj-cover", attr: { src: app.vault.getResourcePath(cover), alt: bfm.title ?? "" } });
		} else {
			// No cover downloaded: show the title's initials instead.
			const initials = String(bfm.title ?? book.basename).split(/[\s:]+/).filter((w) => /^[A-Za-z0-9]/.test(w))
				.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
			row.createDiv({ cls: "dj-cover dj-cover-fallback", text: initials });
		}
		const info = row.createDiv({ cls: "dj-book-info" });
		link(app, info, String(bfm.title ?? book.basename), book, "dj-book-title");
		if (bfm.author) info.createDiv({ cls: "dj-book-author", text: String(bfm.author) });
		if (progress !== null) {
			info.createDiv({ cls: "dj-bar" }).createDiv().style.width = `${progress}%`;
			const line = info.createDiv({ cls: "dj-progress" });
			line.createSpan({ cls: "dj-progress-pct", text: `${progress}%` });
			if (before !== null && before !== progress) {
				const diff = progress - before;
				line.createSpan({ text: `${diff > 0 ? "+" : ""}${diff.toFixed(1)}% today` });
			}
		}
	}
	for (const q of quotes) {
		const bq = c.createEl("blockquote", { cls: "dj-quote", text: q.text });
		if (q.file !== book) {
			const title = app.metadataCache.getFileCache(q.file)?.frontmatter?.title ?? q.file.basename;
			link(app, bq.createDiv({ cls: "dj-quote-source" }), "— " + title, q.file);
		}
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

	if (fields.exercise) {
		const ex = item("Exercise");
		ex.addClass("dj-exercise");
		const toggle = ex.createDiv({ cls: "dj-toggle" });
		const note = textField(ex, "exercise_note", "What did you do?");
		// Track the choice locally so the toggle updates on click, not after Obsidian re-reads the file.
		let exercised: boolean | null = typeof fm.exercise === "boolean" ? fm.exercise : null;
		const pills = ([["Yes", true], ["No", false]] as Array<[string, boolean]>).map(([text, value]) => {
			const b = toggle.createEl("button", { text });
			b.onclick = () => { exercised = exercised === value ? null : value; paint(); save("exercise", exercised); };
			return { b, value };
		});
		const paint = () => {
			for (const { b, value } of pills) b.toggleClass("is-on", exercised === value);
			note.toggle(exercised === true);
		};
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
		if (!document.getElementById("dj-tag-list")) {
			const list = document.body.createEl("datalist", { attr: { id: "dj-tag-list" } });
			// getTags() exists in Obsidian but isn't in its published types.
			const vaultTags = (app.metadataCache as unknown as { getTags?: () => Record<string, number> }).getTags?.() ?? {};
			for (const tag of Object.keys(vaultTags)) list.createEl("option", { attr: { value: tag.replace(/^#/, "") } });
		}
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
		input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } });
		input.addEventListener("change", add);
		paint();
	}
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
