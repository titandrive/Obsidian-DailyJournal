import { App, getAllTags, moment, setIcon, TFile } from "obsidian";
import { entryDate, Moment } from "./dates";
import { PlaceHistory, PlaceModal, SongPickerModal } from "./modals";
import { CheckInFields, JournalSettings, Place } from "./settings";
import { HardcoverDay, savedReading } from "./hardcover";
import { meteoconSvg } from "./meteocons";
import { episodePage, playerUrl, Song, SONG_KEYS, songProperties, thumbnailUrl, youtubeMusicUrl } from "./music";
import { blockFields, blockOnThisDay, blockShowsWeather, parseBlock } from "./template";
import { entryPlace, fetchWeather, PIN_ICON, weatherIcon, weatherText } from "./weather";
import { RETRY_AFTER_MS } from "./net";

/** What the cards need from the plugin. */
export interface JournalHost {
	app: App;
	settings: JournalSettings;
	weatherTried: Set<string>;
	placeHistory: PlaceHistory;
	setEntryPlace(file: TFile, place: Place | null, withWeather: boolean): Promise<string | null>;
	/** Fetch the entry's reading from Hardcover and save it in the entry. */
	refreshReading(file: TFile, date: Moment): Promise<void>;
	readingTried: Set<string>;
	/** Entries whose failed first lookup has its one automatic retry scheduled ("pending") or used ("done"). */
	readingRetries: Map<string, "pending" | "done">;
	weatherRetried: Set<string>;
	/** Plugin.registerInterval: the timer is cleared if the plugin unloads (works for timeouts too). */
	registerInterval(id: number): number;
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
		case "onthisday": return renderOnThisDay(host, el, date, blockOnThisDay(options));
		case "row": {
			// Several cards side by side in one block, e.g. "row reading song": compact versions of each,
			// stacked again when the note is too narrow (see .dj-row-cards).
			const grid = el.createDiv({ cls: "dj-row-wrap" }).createDiv({ cls: "dj-row-cards" });
			// Create every column first, then fill them, so each card is laid out at its final width.
			const cells = options.filter((o) => o !== "row" && o !== "header").map((o) => [o, grid.createDiv({ cls: "dj-row-cell" })] as const);
			await Promise.all(cells.map(([o, cell]) => renderSection(host, o, cell, file)));
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
		}, undefined, host.placeHistory).open();
	};

	// Star (bottom right, after the chips): marks the entry as a favorite, saved as `favorite: true`, so search and the Insights base can find it.
	let starred = fm.favorite === true;
	const star = chips.createEl("button", { cls: "dj-star" });
	setIcon(star, "star");
	const paintStar = () => {
		star.toggleClass("is-on", starred);
		star.setAttr("aria-label", starred ? "Remove from favorites" : "Add to favorites");
	};
	star.onclick = () => {
		starred = !starred;
		paintStar();
		void app.fileManager.processFrontMatter(file, (f) => { if (starred) f.favorite = true; else delete f.favorite; });
	};
	paintStar();

	// First time an entry is opened, look up that day's weather and save it.
	// Tried once per entry per session, so a failed lookup can't turn into a retry loop.
	if (weatherOn && !fm.weather && !host.weatherTried.has(file.path) && !date.isAfter(moment(), "day")) {
		host.weatherTried.add(file.path);
		const save = async (weather: string) => {
			if (weatherChip.isConnected) showWeather(weather);
			await app.fileManager.processFrontMatter(file, (f) => { if (!f.weather) f.weather = weather; });
		};
		const weather = await fetchWeather(place, date, settings.units);
		if (weather) await save(weather);
		else if (!host.weatherRetried.has(file.path)) {
			// Weather service down or slow: try once more a minute later (it fills in on a later start otherwise).
			host.weatherRetried.add(file.path);
			host.registerInterval(window.setTimeout(async () => {
				if (app.metadataCache.getFileCache(file)?.frontmatter?.weather) return;
				const retry = await fetchWeather(place, date, settings.units);
				if (retry) await save(retry);
			}, RETRY_AFTER_MS));
		}
	}
}

async function renderReading(host: JournalHost, el: HTMLElement, file: TFile, date: Moment, fm: Frontmatter): Promise<void> {
	const day = savedReading(fm);
	if (day) return drawReading(el, day, date);

	// Not fetched yet: ask Hardcover and save it in the entry (the card redraws from that). A failed
	// first lookup is retried once, a minute later; after that only "Refresh reading" asks again, so
	// a failing lookup can't turn into a retry loop.
	const muted = (text: string) => card(el, "Currently reading").createDiv({ cls: "dj-muted", text });
	if (!host.settings.hardcoverToken) return void muted("Add your Hardcover API token in Daily Journal's settings to show what you read.");
	if (date.isAfter(moment(), "day")) return;
	const path = file.path;
	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
	if (host.readingTried.has(path)) {
		return void muted(host.readingRetries.get(path) === "pending"
			? "Couldn't load from Hardcover. Trying again in a minute…"
			: "Couldn't load from Hardcover. Run \"Refresh reading\" to try again.");
	}
	host.readingTried.add(path);
	const loading = muted("Loading from Hardcover…");
	try {
		await host.refreshReading(file, date);
	} catch (e) {
		if (host.readingRetries.has(path)) {
			loading.setText(`Couldn't load from Hardcover: ${message(e)} Run "Refresh reading" to try again.`);
			return;
		}
		host.readingRetries.set(path, "pending");
		loading.setText(`Couldn't load from Hardcover: ${message(e)} Trying again in a minute.`);
		host.registerInterval(window.setTimeout(async () => {
			host.readingRetries.set(path, "done");
			if (savedReading(host.app.metadataCache.getFileCache(file)?.frontmatter ?? {})) return; // refreshed meanwhile
			try {
				await host.refreshReading(file, date); // redraws the card on success
			} catch (e2) {
				if (loading.isConnected) loading.setText(`Still couldn't load from Hardcover: ${message(e2)} Run "Refresh reading" to try again.`);
			}
		}, RETRY_AFTER_MS));
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
/** Shared by the book and song/podcast cards, so neither grows taller than the other beside it. */
const TITLE_SIZES = ["0.92em", "0.82em", "0.74em"];

/**
 * Run `measure` once the element is laid out: after the next frame (in a side-by-side row the other
 * card is drawn just after this one), and if it isn't on screen yet (the editor only lays out cards
 * scrolled into view), when it first becomes visible. Runs once, then stops watching.
 */
function whenLaidOut(el: HTMLElement, measure: () => void): void {
	// Check again a little later too: fonts (e.g. a custom font plugin) can swap in after the first
	// check and widen the text. Fitting only ever shrinks, so extra checks are harmless.
	for (const ms of [500, 2000]) window.setTimeout(() => { if (el.isConnected && el.offsetWidth) measure(); }, ms);
	window.requestAnimationFrame(() => {
		if (el.isConnected && el.offsetWidth) { measure(); return; }
		const io = new IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting) || !el.offsetWidth) return;
			io.disconnect();
			window.requestAnimationFrame(measure);
		});
		io.observe(el);
		// Never keep watching a card that's gone.
		window.setTimeout(() => io.disconnect(), 10 * 60 * 1000);
	});
}

function shrinkToTwoLines(el: HTMLElement, sizes = TITLE_SIZES, clamp = true, ready = false): void {
	if (!ready) { whenLaidOut(el, () => shrinkToTwoLines(el, sizes, clamp, true)); return; }
	for (const size of sizes.slice(Math.max(0, sizes.indexOf(el.style.fontSize) + 1))) {
		if (lineCount(el) <= 2) return;
		el.style.fontSize = size;
	}
	// Still too long at the smallest size: cut it at two lines ("…"), full text on hover.
	if (clamp && lineCount(el) > 2) { el.addClass("dj-clamp-2"); el.setAttr("title", el.textContent ?? ""); }
}

/** A one-line text that's too wide steps down in size (same steps as titles), then ends in "…". */
function shrinkToOneLine(el: HTMLElement, sizes = TITLE_SIZES, ready = false): void {
	if (!ready) { whenLaidOut(el, () => shrinkToOneLine(el, sizes, true)); return; }
	for (const size of sizes.slice(Math.max(0, sizes.indexOf(el.style.fontSize) + 1))) {
		if (el.scrollWidth <= el.clientWidth) return;
		el.style.fontSize = size;
	}
	if (el.scrollWidth > el.clientWidth) el.setAttr("title", el.textContent ?? "");
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

	// Several books: a page at a time with a pager (‹ 1/2 ›) beside the label, most pages read first.
	// A page holds one book, or two side by side when the card is wide enough (the pager hides when
	// they all fit). Every book sits in the same grid row, so the card is as tall as the tallest book
	// and doesn't jump when paging.
	const books = [...day.books].sort((a, b) => (b.pages ?? 0) - (a.pages ?? 0));
	let list: HTMLElement = c;
	const rows: HTMLElement[] = [];
	let layout = () => {};
	if (books.length > 1) {
		const head = createDiv({ cls: "dj-card-head" });
		const label = c.querySelector(":scope > .dj-label");
		c.prepend(head);
		if (label) head.append(label);
		const pager = head.createDiv({ cls: "dj-pager" });
		const prev = pager.createEl("button", { text: "‹", attr: { "aria-label": "Previous" } });
		const count = pager.createSpan({ cls: "dj-pager-count" });
		const next = pager.createEl("button", { text: "›", attr: { "aria-label": "Next" } });
		list = c.createDiv({ cls: "dj-book-pages" });
		let page = 0, perPage = 1;
		const pages = () => Math.ceil(books.length / perPage);
		const show = (i: number) => {
			page = (i + pages()) % pages();
			rows.forEach((r, j) => {
				r.toggleClass("is-shown", Math.floor(j / perPage) === page);
				r.style.gridColumn = String((j % perPage) + 1);
			});
			list.style.gridTemplateColumns = `repeat(${perPage}, minmax(0, 1fr))`;
			pager.toggle(pages() > 1);
			count.setText(`${page + 1}/${pages()}`);
		};
		// Two per page from about 560px wide; rechecked when the card is resized.
		layout = () => {
			const fit = list.clientWidth >= 560 ? 2 : 1;
			if (fit === perPage && list.style.gridTemplateColumns) return;
			const first = page * perPage;
			perPage = fit;
			show(Math.floor(first / perPage));
		};
		const watch = new ResizeObserver(() => (list.isConnected ? layout() : watch.disconnect()));
		watch.observe(list);
		prev.onclick = () => show(page - 1);
		next.onclick = () => show(page + 1);
		// Swipe left/right on phones.
		let startX: number | null = null;
		list.addEventListener("touchstart", (e) => { startX = e.touches[0]?.clientX ?? null; }, { passive: true });
		list.addEventListener("touchend", (e) => {
			const dx = startX === null ? 0 : (e.changedTouches[0]?.clientX ?? startX) - startX;
			startX = null;
			if (Math.abs(dx) > 40 && pages() > 1) show(page + (dx < 0 ? 1 : -1));
		});
	}

	for (const b of books) {
		const row = list.createDiv({ cls: "dj-book" });
		rows.push(row);
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
		// The cover sits in a wrapper so the Started/Finished chip can overlay its bottom edge instead of
		// taking a line of its own (which made the card, and the card beside it, taller).
		const coverWrap = row.createDiv({ cls: "dj-cover-wrap" });
		const fallback = () => { img?.remove(); coverWrap.prepend(linkable(createDiv({ cls: "dj-cover dj-cover-fallback", text: initials }))); };
		const img = b.cover ? linkable(coverWrap.createEl("img", { cls: "dj-cover", attr: { src: b.cover, alt: b.title } })) as HTMLImageElement : null;
		if (img) img.onerror = fallback; else fallback();

		const info = row.createDiv({ cls: "dj-book-info" });
		const title = info.createEl("a", { cls: "dj-book-title", text: b.title, href: b.url ?? "#" });
		if (b.url) title.addEventListener("click", openBook); else title.removeAttribute("href");
		shrinkToTwoLines(title);
		// The rating goes on the author line (the chip on the cover only has room for one word).
		const byline = [b.author, b.finished && b.rating ? `rated ${b.rating}` : ""].filter(Boolean).join(" · ");
		if (byline) info.createDiv({ cls: "dj-book-author", text: byline });
		const chip = b.finished ? "Finished" : b.started ? "Started" : "";
		if (chip) coverWrap.createSpan({ cls: "dj-badge dj-cover-badge" + (b.finished ? " is-finished" : ""), text: chip });
		if (b.to !== null) {
			info.createDiv({ cls: "dj-bar" }).createDiv().style.width = `${Math.min(100, b.to)}%`;
			const line = info.createDiv({ cls: "dj-progress" });
			line.createSpan({ cls: "dj-progress-pct", text: b.from !== null && b.from !== b.to ? `${Math.round(b.from)}% → ${Math.round(b.to)}%` : `${Math.round(b.to)}%` });
			if (b.pages) line.createSpan({ text: `+${b.pages} pages` });
		}
	}
	rows[0]?.addClass("is-shown");
	layout();
	if (!day.quotes.length) return;
	// In a side-by-side row the card is half width: quotes go in their own full-width card under the
	// row (like the song player), so both cards in the row stay compact.
	const row = el.closest(".dj-row-wrap") as HTMLElement | null;
	let target = c;
	if (row) {
		row.querySelectorAll(":scope > .dj-row-quotes").forEach((q) => q.remove());
		target = createDiv({ cls: "dj-card dj-row-quotes" });
		row.querySelector(":scope > .dj-row-cards")?.after(target);
	}
	if (row) shrinkToOneLine(target.createDiv({ cls: "dj-label dj-one-line", text: "Today's Highlights" }), ["0.76em", "0.68em"]);
	for (const q of day.quotes) {
		const bq = target.createEl("blockquote", { cls: "dj-quote", text: q.text });
		// Book title and page under every quote: "— All The Pretty Horses · p. 46".
		const page = Number(q.page) > 0 ? ` · p. ${Number(q.page)}` : "";
		bq.createDiv({ cls: "dj-quote-source", text: `— ${q.book}${page}` });
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
		// Skipped meals are listed in `skipped_meals` (e.g. [breakfast, lunch]) rather than typed in, so
		// Trends can count them; skipping clears whatever was written for that meal.
		const skippedNow = (): string[] => {
			const f = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const s = f.skipped_meals;
			const listed = (Array.isArray(s) ? s : s ? [s] : []).map(String);
			// Older entries where "skipped" was typed in count as skipped too.
			const typed = ["breakfast", "lunch", "dinner"].filter((k) => typeof f[k] === "string" && /^skip(ped)?$/i.test(f[k].trim()));
			return [...new Set([...listed, ...typed])];
		};
		let skipped = skippedNow();
		const setSkipped = (key: string, on: boolean) => {
			skipped = on ? [...skipped.filter((k) => k !== key), key] : skipped.filter((k) => k !== key);
			return app.fileManager.processFrontMatter(file, (f) => {
				const order = ["breakfast", "lunch", "dinner"];
				const list = order.filter((k) => skipped.includes(k));
				if (list.length) f.skipped_meals = list; else delete f.skipped_meals;
				// Skipping clears what was written; un-skipping clears an old typed "skipped".
				if (on || (typeof f[key] === "string" && /^skip(ped)?$/i.test(f[key].trim()))) delete f[key];
			});
		};
		const meal = (label: string, key: string, placeholder: string, canSkip = true) => {
			const row = meals.createDiv({ cls: "dj-meal" });
			row.createSpan({ text: label });
			const box = row.createDiv({ cls: "dj-meal-box" });
			const t = textField(box, key, placeholder);
			if (!canSkip) {
				mealSuggest(host, t, box, (value) => { void save(key, value); });
				return;
			}
			const skip = row.createEl("button", { cls: "dj-meal-skip", text: "Skip", attr: { "aria-label": `Skipped ${label.toLowerCase()}` } });
			const paint = () => {
				const on = skipped.includes(key);
				row.toggleClass("is-skipped", on);
				skip.toggleClass("is-on", on);
				skip.setText(on ? "Skipped" : "Skip");
				t.disabled = on;
				t.placeholder = on ? "Skipped" : placeholder;
				if (on) t.value = "";
			};
			skip.onclick = () => { void setSkipped(key, !skipped.includes(key)); paint(); };
			// Typing "skip" or "skipped" counts as tapping Skip.
			const commit = (value: string) => {
				if (/^skip(ped)?$/i.test(value.trim())) { void setSkipped(key, true); paint(); return; }
				void save(key, value.trim() || null);
			};
			t.onchange = () => commit(t.value);
			mealSuggest(host, t, box, commit);
			paint();
		};
		meal("Breakfast", "breakfast", "What did you have for breakfast?");
		meal("Lunch", "lunch", "What did you have for lunch?");
		meal("Dinner", "dinner", "What did you have for dinner?");
		// Older entries kept food in a single "ate" property; still show it so nothing disappears.
		if (fm.ate) meal("Other", "ate", "", false);
	}

	if (fields.tags) {
		// Tags go in the note's own `tags` property (next to "journal"), so they work in search, the tag pane and Bases.
		const box = item("Tags");
		box.addClass("dj-tags");
		const chips = box.createDiv({ cls: "dj-row" });
		const input = box.createEl("input", { cls: "dj-tag-input", type: "text", attr: { placeholder: "Add a tag…", list: "dj-tag-list" } });
		// Suggest tags from journal entries, rebuilt on each focus so tags added in other entries show up right away.
		const refreshSuggestions = () => {
			const list = document.getElementById("dj-tag-list") ?? document.body.createEl("datalist", { attr: { id: "dj-tag-list" } });
			list.empty();
			// Only tags used in journal entries, not the rest of the vault.
			const journalTags = new Set<string>();
			for (const entry of host.journalEntries()) {
				const cache = app.metadataCache.getFileCache(entry.file);
				for (const tag of (cache && getAllTags(cache)) ?? []) journalTags.add(tag.replace(/^#/, ""));
			}
			journalTags.delete("journal");
			for (const name of [...journalTags].sort((a, b) => a.localeCompare(b))) list.createEl("option", { attr: { value: name } });
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
	// Directory podcast episode: plays from its audio file.
	if (fm.song && fm.song_kind === "podcast" && typeof fm.song_audio === "string" && fm.song_audio) {
		return {
			id: String(fm.song_id ?? ""), title: String(fm.song), artist: fm.artist ? String(fm.artist) : "",
			cover: fm.song_cover ? String(fm.song_cover) : null, kind: "podcast", audio: fm.song_audio,
			page: typeof fm.song_url === "string" ? fm.song_url : null,
		};
	}
	const id = typeof fm.song_id === "string" && /^[\w-]{11}$/.test(fm.song_id) ? fm.song_id : null;
	if (!fm.song || !id) return null;
	// Always show the band-free thumbnail, also for songs saved with an older one.
	return { id, title: String(fm.song), artist: fm.artist ? String(fm.artist) : "", cover: thumbnailUrl(id), kind: fm.song_kind === "podcast" ? "podcast" : "music" };
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

	// In a side-by-side row the card is too narrow for a video: the player opens full-width under the row.
	const playerHost = () => (el.closest(".dj-row-wrap") as HTMLElement | null) ?? body;
	const closePlayer = () => {
		for (const host of new Set([playerHost(), body])) host.querySelectorAll(":scope > .dj-song-player").forEach((p) => p.remove());
	};

	const showSong = (song: Song) => {
		closePlayer();
		body.empty();
		const row = body.createDiv({ cls: "dj-book dj-song" });
		// Album art with a play button over it. The player is only created when you press play.
		const cover = row.createDiv({ cls: "dj-song-art" });
		art(cover, song, "dj-cover dj-song-cover");
		const play = cover.createEl("button", { cls: "dj-song-play", attr: { "aria-label": "Play" } });
		setIcon(play, "play");
		const info = row.createDiv({ cls: "dj-book-info" });
		// YouTube items open in YouTube Music; directory episodes open their own page (or the audio file).
		const link = song.audio ? (song.page ?? song.audio) : youtubeMusicUrl(song.id);
		const title = info.createEl("a", { cls: "dj-book-title", text: song.title, href: link, attr: { "aria-label": song.audio ? "Open the episode's page" : "Open in YouTube Music" } });
		title.onclick = (e) => { e.preventDefault(); window.open(link, "_blank"); };
		shrinkToTwoLines(title); // podcast episode titles run long
		// Artist, or the podcast's show name; long names shrink to fit one line like titles do.
		if (song.artist) shrinkToOneLine(info.createDiv({ cls: "dj-book-author", text: song.artist }));
		const actions = info.createDiv({ cls: "dj-song-actions" });
		const change = actions.createEl("a", { cls: "dj-song-change", text: "Change", href: "#" });
		change.onclick = (e) => { e.preventDefault(); pick(); };
		const remove = actions.createEl("a", { cls: "dj-song-change", text: "Remove", href: "#" });
		remove.onclick = (e) => { e.preventDefault(); void save(null); showEmpty(); };

		let player: HTMLElement | null = null;
		play.onclick = () => {
			if (player) { player.remove(); player = null; setIcon(play, "play"); play.setAttr("aria-label", "Play"); return; }
			closePlayer();
			if (song.audio) {
				// A podcast episode is just audio: a compact player that fits inside the card, even half-width.
				player = body.createDiv({ cls: "dj-song-player dj-song-audio" });
				player.createEl("audio", { attr: { src: song.audio, controls: "", autoplay: "", preload: "none" } });
				setIcon(play, "square"); play.setAttr("aria-label", "Stop");
				return;
			}
			player = playerHost().createDiv({ cls: "dj-song-player" });
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
	const pick = () => new SongPickerModal(app, settings.youtubeApiKey, async (song) => {
		showSong(song);
		// For a directory episode, look up its web page once (from the show's feed) before saving.
		if (song.audio && !song.page) song.page = await episodePage(song);
		void save(song);
		if (song.page) showSong(song);
	}).open();
	const showEmpty = () => {
		closePlayer();
		body.empty();
		const add = body.createEl("button", { cls: "dj-song-add" });
		setIcon(add.createSpan({ cls: "dj-song-add-icon" }), "music");
		add.createSpan({ text: "Add a song or podcast" });
		add.onclick = pick;
	};

	const song = savedSong(fm);
	if (song) showSong(song); else showEmpty();
}

/**
 * Every meal written in any entry (breakfast, lunch and dinner pooled), most frequent first, with
 * the spelling used most often. Case-insensitive, so "Yogurt" and "yogurt" count as one meal.
 */
function pastMeals(host: JournalHost): string[] {
	const counts = new Map<string, { text: string; n: number; spellings: Map<string, number> }>();
	for (const { file } of host.journalEntries()) {
		const fm = host.app.metadataCache.getFileCache(file)?.frontmatter;
		for (const key of ["breakfast", "lunch", "dinner"]) {
			const v = fm?.[key];
			if (typeof v !== "string" || !v.trim() || /^skip(ped)?$/i.test(v.trim())) continue;
			const text = v.trim(), k = text.toLowerCase();
			const c = counts.get(k) ?? { text, n: 0, spellings: new Map<string, number>() };
			c.n++;
			c.spellings.set(text, (c.spellings.get(text) ?? 0) + 1);
			counts.set(k, c);
		}
	}
	return [...counts.values()]
		.map((c) => ({ n: c.n, text: [...c.spellings].sort((a, b) => b[1] - a[1])[0][0] }))
		.sort((a, b) => b.n - a.n || a.text.localeCompare(b.text))
		.map((c) => c.text);
}

/**
 * Suggestions under a meal box from meals you've written before: prefix matches first, then
 * matches anywhere, most frequent first. ↑↓ and Enter/Tab (or a click) fill in the exact saved
 * text, so the same meal is always spelled the same way.
 */
function mealSuggest(host: JournalHost, input: HTMLTextAreaElement, box: HTMLElement, commit: (value: string) => void): void {
	let all: string[] = [];
	let list: HTMLElement | null = null;
	let items: string[] = [];
	let active = -1;
	const close = () => { list?.remove(); list = null; items = []; active = -1; };
	const paint = () => list?.querySelectorAll(".dj-suggest-item").forEach((el, i) => el.toggleClass("is-active", i === active));
	const accept = (value: string) => {
		input.value = value;
		close();
		commit(value);
	};
	const update = () => {
		const typed = input.value.trim().toLowerCase();
		close();
		if (!typed) return;
		const starts = all.filter((m) => m.toLowerCase().startsWith(typed));
		const contains = all.filter((m) => !m.toLowerCase().startsWith(typed) && m.toLowerCase().includes(typed));
		items = [...starts, ...contains].filter((m) => m.toLowerCase() !== typed).slice(0, 6);
		if (!items.length) return;
		list = box.createDiv({ cls: "dj-suggest" });
		items.forEach((m, i) => {
			const el = list!.createDiv({ cls: "dj-suggest-item", text: m });
			// mousedown, not click: picking must happen before the box loses focus.
			el.addEventListener("mousedown", (e) => { e.preventDefault(); accept(m); });
			el.addEventListener("mousemove", () => { active = i; paint(); });
		});
	};
	input.addEventListener("focus", () => { all = pastMeals(host); });
	input.addEventListener("input", update);
	input.addEventListener("blur", () => window.setTimeout(close, 100));
	input.addEventListener("keydown", (e) => {
		if (!list || !items.length) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			active = e.key === "ArrowDown" ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1);
			paint();
		} else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
			e.preventDefault();
			accept(items[active]);
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	});
}

/** The first line written under an entry's first writing prompt, as plain text. */
function firstAnswer(text: string): string | null {
	const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
	const lines = body.split("\n");
	const start = lines.findIndex((l) => /^#{1,6}\s/.test(l));
	if (start < 0) return null;
	for (const line of lines.slice(start + 1)) {
		if (/^#{1,6}\s|^```/.test(line)) break;
		const plain = line.replace(/[*_`>#]|\[\[([^\]|]*\|)?|\]\]/g, "").trim();
		if (plain) return plain;
	}
	return null;
}

/** "1 month ago", "1 year ago", "3 years ago" */
function agoLabel(then: Moment, now: Moment): string {
	const years = now.diff(then, "years");
	if (years >= 1) return years === 1 ? "1 year ago" : `${years} years ago`;
	const months = now.diff(then, "months");
	return months <= 1 ? "1 month ago" : `${months} months ago`;
}

async function renderOnThisDay(host: JournalHost, el: HTMLElement, date: Moment, show: { month: boolean; years: boolean }): Promise<void> {
	const { app } = host;
	const monthAgo = date.clone().subtract(1, "month");
	const hits = host.journalEntries().filter((d) => d.date.isBefore(date, "day") && (
		(show.month && d.date.isSame(monthAgo, "day")) ||
		(show.years && d.date.month() === date.month() && d.date.date() === date.date())
	)).reverse();
	if (!hits.length) return;
	const grid = card(el, "On this day").createDiv({ cls: "dj-otd" });
	for (const { file, date: then } of hits) {
		const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Frontmatter;
		const tile = grid.createEl("a", { cls: "dj-otd-tile", href: "#" });
		tile.onclick = openFile(app, file);

		// Top: when, then weather and rating.
		const head = tile.createDiv({ cls: "dj-otd-head" });
		const when = head.createDiv({ cls: "dj-otd-when" });
		when.createDiv({ cls: "dj-otd-ago", text: agoLabel(then, date) });
		when.createDiv({ cls: "dj-otd-date", text: then.format(then.year() === date.year() ? "ddd, MMM D" : "ddd, MMM D, YYYY") });
		const meta = head.createDiv({ cls: "dj-otd-meta" });
		if (fm.weather) {
			const sky = meta.createSpan({ cls: "dj-otd-sky", attr: { "aria-label": weatherText(String(fm.weather)) } });
			sky.innerHTML = meteoconSvg(weatherIcon(String(fm.weather)));
		}
		if (Number(fm.day_rating)) meta.createSpan({ cls: "dj-otd-rating", text: `${Number(fm.day_rating)}/10` });

		// Below: two lines of what you wrote, with that day's book and song art beside them.
		const body = tile.createDiv({ cls: "dj-otd-body" });
		const snippet = body.createDiv({ cls: "dj-otd-snippet" });
		const reading = fm.reading as { books?: Array<{ title?: string; cover?: string }> } | undefined;
		const book = reading?.books?.[0];
		const media: Array<{ src: string; title: string; cls: string }> = [];
		if (book?.cover) media.push({ src: String(book.cover), title: String(book.title ?? ""), cls: "dj-otd-book" });
		if (fm.song_cover) media.push({ src: String(fm.song_cover), title: [fm.song, fm.artist].filter(Boolean).join(" · "), cls: "dj-otd-song" });
		if (media.length) {
			const strip = body.createDiv({ cls: "dj-otd-media" });
			for (const m of media) {
				const img = strip.createEl("img", { cls: m.cls, attr: { src: m.src, alt: "", "aria-label": m.title } });
				img.onerror = () => img.remove();
			}
		}
		void app.vault.cachedRead(file).then((text) => {
			const line = firstAnswer(text);
			if (line) snippet.setText(line); else snippet.addClass("is-empty");
		});
	}
}
