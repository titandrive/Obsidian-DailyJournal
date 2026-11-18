import { App, Modal, moment, Platform, setIcon, SuggestModal } from "obsidian";
import { Moment } from "./dates";
import { MAX_PROMPT_LEVEL, Place, Prompt } from "./settings";
import { PlaceResult, searchPlaces } from "./weather";
import { searchEpisodes, searchShows, searchSongs, showEpisodes, Song, SongKind, songFromLink, videoIdFromUrl } from "./music";
import { familyOf, MAX_MOODS, moodFamilies, MoodFamily } from "./moods";

/** Month calendar for choosing a date. Days that already have an entry are marked (and can't be picked unless allowTaken). */
export class MonthPicker extends Modal {
	private month: Moment;
	/** Days, the 12 months of a year, or a page of 12 years (clicking the month or year in the header). */
	private view: "days" | "months" | "years" = "days";
	private yearPage = 0; // first year shown in the years view
	private bodyHeight = 0; // the days view's height, kept for the other views so nothing moves

	constructor(
		app: App,
		private current: Moment | null,
		private isTaken: (date: Moment) => boolean,
		private onPick: (date: Moment) => void,
		/** onOpenExisting: what clicking a day that already has an entry does when picking it isn't allowed (e.g. open that entry). */
		private options: { title?: string; allowTaken?: boolean; onOpenExisting?: (date: Moment) => void } = {},
	) {
		super(app);
		this.month = (current ?? moment()).clone().startOf("month");
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal");
		this.titleEl.setText(this.options.title ?? "Move entry to…");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Header: ‹  [Month] [Year]  ›. The arrows step by month, year or 12 years depending on the view.
		const head = contentEl.createDiv({ cls: "dj-picker-head" });
		const step = (dir: 1 | -1) => {
			if (this.view === "days") this.month.add(dir, "month");
			else if (this.view === "months") this.month.add(dir, "year");
			else this.yearPage += dir * 12;
			this.render();
		};
		head.createEl("button", { text: "‹", attr: { "aria-label": "Previous" } }).onclick = () => step(-1);
		const title = head.createDiv({ cls: "dj-picker-title" });
		if (this.view === "years") {
			title.createSpan({ cls: "dj-picker-range", text: `${this.yearPage} – ${this.yearPage + 11}` });
		} else {
			const monthBtn = title.createEl("button", { cls: "dj-picker-label", text: this.month.format("MMMM"), attr: { "aria-label": "Choose month" } });
			monthBtn.toggleClass("is-active", this.view === "months");
			monthBtn.onclick = () => { this.view = this.view === "months" ? "days" : "months"; this.render(); };
			const yearBtn = title.createEl("button", { cls: "dj-picker-label", text: this.month.format("YYYY"), attr: { "aria-label": "Choose year" } });
			yearBtn.onclick = () => { this.view = "years"; this.yearPage = this.month.year() - 5; this.render(); };
		}
		head.createEl("button", { text: "›", attr: { "aria-label": "Next" } }).onclick = () => step(1);

		const body = contentEl.createDiv({ cls: "dj-picker-body" });
		if (this.bodyHeight) body.style.height = `${this.bodyHeight}px`;
		if (this.view === "days") this.renderDays(body);
		else if (this.view === "months") this.renderMonths(body);
		else this.renderYears(body);
		if (this.view === "days" && !this.bodyHeight) {
			window.requestAnimationFrame(() => { if (body.offsetHeight) this.bodyHeight = body.offsetHeight; });
		}
	}

	/** Always six weeks (42 days), so the dialog's height never changes between months. */
	private renderDays(body: HTMLElement): void {
		const grid = body.createDiv({ cls: "dj-picker-grid" });
		for (const d of moment.weekdaysMin()) grid.createDiv({ cls: "dj-picker-dow", text: d });
		const today = moment();
		const first = this.month.clone().subtract(this.month.day(), "days");
		for (let i = 0; i < 42; i++) {
			const date = first.clone().add(i, "days");
			const btn = grid.createEl("button", { cls: "dj-picker-day", text: String(date.date()) });
			if (!date.isSame(this.month, "month")) btn.addClass("is-other-month");
			if (date.isSame(today, "day")) btn.addClass("is-today");
			if (this.current && date.isSame(this.current, "day")) {
				btn.addClass("is-current");
				btn.disabled = true;
				continue;
			}
			if (this.isTaken(date)) {
				// A day with an entry is marked with a dot; clicking it opens that entry.
				btn.addClass("has-entry");
				btn.setAttr("aria-label", "Open existing entry");
				if (!this.options.allowTaken) {
					const open = this.options.onOpenExisting;
					if (!open) { btn.disabled = true; continue; }
					btn.onclick = () => { this.close(); open(date); };
					continue;
				}
			}
			btn.onclick = () => { this.close(); this.onPick(date); };
		}
	}

	private renderMonths(body: HTMLElement): void {
		const grid = body.createDiv({ cls: "dj-picker-cells" });
		const now = moment();
		for (let m = 0; m < 12; m++) {
			const btn = grid.createEl("button", { cls: "dj-picker-cell", text: moment().month(m).format("MMM") });
			if (m === this.month.month()) btn.addClass("is-current");
			if (m === now.month() && this.month.year() === now.year()) btn.addClass("is-today");
			btn.onclick = () => { this.month.month(m); this.view = "days"; this.render(); };
		}
	}

	private renderYears(body: HTMLElement): void {
		const grid = body.createDiv({ cls: "dj-picker-cells" });
		const now = moment().year();
		for (let y = this.yearPage; y < this.yearPage + 12; y++) {
			const btn = grid.createEl("button", { cls: "dj-picker-cell", text: String(y) });
			if (y === this.month.year()) btn.addClass("is-current");
			if (y === now) btn.addClass("is-today");
			btn.onclick = () => { this.month.year(y); this.view = "months"; this.render(); };
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** City search. Calls onChoose with a place, or with null for "back to home" (when offered). */
/** Recently picked locations, kept by the plugin. */
export interface PlaceHistory {
	get(): Place[];
	add(place: Place): void;
	clear(): void;
}

export class PlaceModal extends Modal {
	private timer = 0;
	private latest = "";

	constructor(app: App, private home: Place | null, private onChoose: (place: Place | null) => void, private title = "Change location", private history?: PlaceHistory) {
		super(app);
	}

	/** Pick a place: remember it in the history, close, and hand it back. */
	private pick(place: Place): void {
		this.history?.add(place);
		this.close();
		this.onChoose(place);
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal");
		this.titleEl.setText(this.title);
		const input = this.contentEl.createEl("input", { cls: "dj-place-input", type: "text", attr: { placeholder: "Search for a city…" } });
		const results = this.contentEl.createDiv({ cls: "dj-place-results" });

		const showHome = () => {
			results.empty();
			if (!this.home) return;
			const back = results.createEl("button", { cls: "dj-place-option", text: `↺ Back to ${this.home.name}` });
			back.onclick = () => { this.close(); this.onChoose(null); };
		};
		// With an empty search box: "Back to …" and the recently picked locations, with a Clear link.
		const showStart = () => {
			showHome();
			const recent = (this.history?.get() ?? []).filter((p) => p.name !== this.home?.name);
			if (!recent.length) return;
			const head = results.createDiv({ cls: "dj-place-recent-head" });
			head.createSpan({ text: "Recent" });
			const clear = head.createEl("a", { cls: "dj-place-clear", text: "Clear", href: "#" });
			clear.onclick = (e) => { e.preventDefault(); this.history?.clear(); showStart(); };
			for (const place of recent) {
				const opt = results.createEl("button", { cls: "dj-place-option" });
				opt.createSpan({ text: place.name });
				opt.onclick = () => this.pick(place);
			}
		};
		const show = (places: PlaceResult[]) => {
			showHome();
			if (!places.length) results.createDiv({ cls: "dj-place-empty", text: "No matching places" });
			for (const place of places) {
				const opt = results.createEl("button", { cls: "dj-place-option" });
				opt.createSpan({ text: place.name });
				opt.createSpan({ cls: "dj-place-detail", text: place.detail });
				opt.onclick = () => this.pick({ name: place.name, lat: place.lat, lon: place.lon, tz: place.tz });
			}
		};

		showStart();
		input.addEventListener("input", () => {
			window.clearTimeout(this.timer);
			const q = input.value.trim();
			if (q.length < 2) { showStart(); return; }
			this.timer = window.setTimeout(async () => {
				this.latest = q;
				let places: PlaceResult[] = [];
				try { places = await searchPlaces(q); } catch { /* offline */ }
				if (this.latest === q) show(places); // ignore results from an older search
			}, 300);
		});
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		window.clearTimeout(this.timer);
		this.contentEl.empty();
	}
}

/** Edit writing prompts: reorder by dragging, set heading level with indent/outdent, add and remove. */
export class PromptsModal extends Modal {
	private items: Prompt[];
	private list!: HTMLElement;

	constructor(app: App, prompts: Prompt[], private onSave: (prompts: Prompt[]) => void) {
		super(app);
		this.items = prompts.map((p) => ({ ...p }));
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal", "dj-prompts-modal");
		this.titleEl.setText("Writing prompts");
		this.contentEl.createDiv({ cls: "dj-prompts-hint", text: "Drag to reorder. Indent to make a prompt a sub-heading of the one above." });
		this.list = this.contentEl.createDiv({ cls: "dj-prompts" });

		const add = this.contentEl.createEl("button", { cls: "dj-prompt-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: "Add prompt" });
		add.onclick = () => {
			this.items.push({ text: "", level: this.items[this.items.length - 1]?.level ?? 0 });
			this.render();
			this.list.querySelector<HTMLInputElement>(".dj-prompt-row:last-child input")?.focus();
		};

		const footer = this.contentEl.createDiv({ cls: "dj-prompts-footer" });
		footer.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		const save = footer.createEl("button", { cls: "mod-cta", text: "Save" });
		save.onclick = () => {
			this.onSave(this.items.map((p) => ({ text: p.text.trim(), level: p.level })).filter((p) => p.text));
			this.close();
		};

		this.render();
	}

	private render(): void {
		this.list.empty();
		this.items.forEach((item, index) => {
			const row = this.list.createDiv({ cls: "dj-prompt-row" });
			row.style.setProperty("--dj-level", String(item.level));

			const handle = row.createDiv({ cls: "dj-prompt-handle", attr: { "aria-label": "Drag to reorder" } });
			setIcon(handle, "grip-vertical");
			handle.addEventListener("pointerdown", (e) => this.startDrag(e, row, item));

			row.createSpan({ cls: "dj-prompt-level", text: "#".repeat(2 + item.level) });
			const input = row.createEl("input", { type: "text", attr: { placeholder: "Prompt" } });
			input.value = item.text;
			input.addEventListener("input", () => { item.text = input.value; });

			const button = (icon: string, label: string, disabled: boolean, run: () => void) => {
				const b = row.createEl("button", { cls: "dj-prompt-btn", attr: { "aria-label": label } });
				setIcon(b, icon);
				b.disabled = disabled;
				b.onclick = run;
			};
			button("indent-decrease", "Outdent", item.level === 0, () => { item.level--; this.render(); });
			button("indent-increase", "Indent", item.level >= MAX_PROMPT_LEVEL, () => { item.level++; this.render(); });
			button("minus", "Remove", false, () => { this.items.splice(index, 1); this.render(); });
		});
	}

	/** Pointer-based dragging (works with mouse and touch): rows move live, order is read back on release. */
	private startDrag(e: PointerEvent, row: HTMLElement, item: Prompt): void {
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		row.addClass("is-dragging");
		const rowItem = new Map<HTMLElement, Prompt>();
		Array.from(this.list.children).forEach((el, i) => rowItem.set(el as HTMLElement, this.items[i]));

		const move = (ev: PointerEvent) => {
			const others = Array.from(this.list.children).filter((el) => el !== row) as HTMLElement[];
			const before = others.find((el) => {
				const r = el.getBoundingClientRect();
				return ev.clientY < r.top + r.height / 2;
			});
			if (before) this.list.insertBefore(row, before);
			else this.list.appendChild(row);
		};
		const end = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
			row.removeClass("is-dragging");
			this.items = Array.from(this.list.children).map((el) => rowItem.get(el as HTMLElement) ?? item);
			this.render();
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** A yes/no confirmation. */
export class ConfirmModal extends Modal {
	constructor(app: App, private heading: string, private message: string, private confirmText: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal");
		this.titleEl.setText(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		const footer = this.contentEl.createDiv({ cls: "dj-prompts-footer" });
		footer.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		footer.createEl("button", { cls: "mod-cta", text: this.confirmText }).onclick = () => { this.close(); this.onConfirm(); };
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Search dialog for the song of the day, like Obsidian's quick switcher. Paste a YouTube or YouTube
 * Music link, or (with an API key) type a song or artist. Searches wait for a pause in typing, since
 * each one uses part of the key's daily allowance; links resolve right away.
 */
export class SongPickerModal extends SuggestModal<Song> {
	/** Music or Podcasts: remembered for the next time the dialog opens (this session). */
	private static kind: SongKind = "music";
	private latest = 0;
	private shown: Song[] = [];

	private modeButtons = new Map<SongKind, HTMLButtonElement>();
	/** Browsing one podcast (after clicking its name): its latest episodes, with your search kept to go back to. */
	private show: { id: number; name: string; query: string } | null = null;
	/** How many podcast results to fetch: grows with "Show more results", resets on a new search. */
	private pageSize = 10;
	private pageKey = "";
	private showBar!: HTMLElement;

	constructor(app: App, private apiKey: string, private onPick: (song: Song) => void) {
		super(app);
		this.limit = 250; // how many rows the dialog may show; the searches decide how many to fetch
		this.modalEl.addClass("dj-song-modal");
		this.setInstructions([{ command: "↑↓", purpose: "to navigate" }, { command: "↵", purpose: "to pick" }, { command: "tab", purpose: "music / podcasts" }, { command: "esc", purpose: "to cancel" }]);

		// A slim Music | Podcasts switch above the search bar (Tab switches too); below the bar, only results.
		this.inputEl.parentElement?.addClass("dj-song-search-row");
		const modes = createDiv({ cls: "dj-song-modes" });
		for (const [kind, label, icon] of [["music", "Music", "music"], ["podcast", "Podcasts", "mic"]] as Array<[SongKind, string, string]>) {
			const b = modes.createEl("button", { cls: "dj-song-mode", text: label, attr: { "aria-label": `${label} (Tab switches)`, "data-icon": icon } });
			b.onclick = () => { if (this.show) { this.show = null; this.showBar.hide(); } this.setKind(kind); this.inputEl.focus(); };
			this.modeButtons.set(kind, b);
		}
		this.modalEl.prepend(modes);
		this.showBar = createDiv({ cls: "dj-show-bar" });
		this.showBar.hide();
		modes.after(this.showBar);
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this.show) { e.preventDefault(); e.stopPropagation(); this.leaveShow(); }
		}, true);
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); this.switchKind(); }
		});
		this.setKind(SongPickerModal.kind);
	}

	onOpen(): void {
		super.onOpen();
		// Ready to type straight away (after the dialog has finished opening).
		window.setTimeout(() => this.inputEl.focus(), 0);
	}

	/** Show one podcast's latest episodes, newest first; the search box then filters within it. */
	private openShow(id: number, name: string): void {
		this.show = { id, name, query: this.show?.query ?? this.inputEl.value };
		this.showBar.empty();
		const back = this.showBar.createEl("button", { cls: "dj-show-back", attr: { "aria-label": "Back to your search" } });
		setIcon(back.createSpan(), "arrow-left");
		back.createSpan({ text: name });
		back.onclick = () => this.leaveShow();
		this.showBar.show();
		this.setPlaceholder(`Filter ${name} episodes`);
		this.inputEl.value = "";
		this.inputEl.focus();
		this.inputEl.dispatchEvent(new Event("input"));
	}

	private leaveShow(): void {
		if (!this.show) return;
		const query = this.show.query;
		this.show = null;
		this.showBar.hide();
		this.setKind(SongPickerModal.kind);
		this.inputEl.value = query;
		this.inputEl.focus();
		this.inputEl.dispatchEvent(new Event("input"));
	}

	private switchKind(): void {
		if (this.show) { this.show = null; this.showBar.hide(); }
		this.setKind(SongPickerModal.kind === "music" ? "podcast" : "music");
	}

	private setKind(kind: SongKind): void {
		SongPickerModal.kind = kind;
		for (const [k, b] of this.modeButtons) b.toggleClass("is-active", k === kind);
		// Podcast search needs no key; music search does.
		const canSearch = kind === "podcast" || !!this.apiKey;
		this.setPlaceholder(canSearch ? (kind === "podcast" ? "Search podcasts" : "Search music, or paste a YouTube link") : "Paste a YouTube or YouTube Music link");
		this.emptyStateText = ""; // nothing under the bar until there's something to say
		this.inputEl.dispatchEvent(new Event("input")); // search again in the new mode
	}

	async getSuggestions(query: string): Promise<Song[]> {
		const term = query.trim(), mine = ++this.latest;
		const step = this.show ? 20 : 10;
		const key = `${SongPickerModal.kind}|${this.show?.id ?? ""}|${term}`;
		if (key !== this.pageKey) { this.pageKey = key; this.pageSize = step; }
		if (this.show) {
			// Inside a show: its latest episodes, filtered by what's typed.
			try {
				const eps = await showEpisodes(this.show.id, term, this.pageSize);
				if (mine !== this.latest) return this.shown;
				this.emptyStateText = "No episodes match.";
				return (this.shown = this.withMore(eps));
			} catch (e) {
				this.emptyStateText = e instanceof Error ? e.message : String(e);
				return (this.shown = []);
			}
		}
		const isLink = !!videoIdFromUrl(term);
		const canSearch = SongPickerModal.kind === "podcast" || !!this.apiKey;
		if (!term || (!isLink && (!canSearch || term.length < 2))) {
			// Empty bar: show nothing below it. Only explain when typing can't work (no key for music).
			this.emptyStateText = !term || canSearch ? "" : "Paste a YouTube link, or add a YouTube API key in settings to search music.";
			return (this.shown = []);
		}
		if (!isLink) {
			await new Promise((r) => window.setTimeout(r, 450));
			if (mine !== this.latest) return this.shown; // a newer keystroke took over
		}
		try {
			const kind = SongPickerModal.kind;
			const songs = isLink ? [await songFromLink(term, kind)]
				: kind === "podcast" ? await this.podcastResults(term)
				: await searchSongs(this.apiKey, term, 10, kind);
			if (mine !== this.latest) return this.shown;
			this.emptyStateText = kind === "podcast" ? "No episodes found." : "No songs found.";
			return (this.shown = songs);
		} catch (e) {
			this.emptyStateText = e instanceof Error ? e.message : String(e);
			return (this.shown = []);
		}
	}

	/** Matching shows first (pick one to see its latest episodes), then matching episodes. */
	private async podcastResults(term: string): Promise<Song[]> {
		const [shows, episodes] = await Promise.all([searchShows(term).catch(() => []), searchEpisodes(term, this.pageSize)]);
		const showRows: Song[] = shows.map((sh) => ({ id: `__show__${sh.id}`, title: sh.name, artist: "", cover: sh.cover, kind: "podcast", showId: sh.id }));
		return [...showRows, ...this.withMore(episodes)];
	}

	/** Adds a "Show more results" row when the list is full (there may be more). */
	private withMore(songs: Song[]): Song[] {
		return songs.length >= this.pageSize && this.pageSize < 200 ? [...songs, SongPickerModal.MORE] : songs;
	}

	private static readonly MORE: Song = { id: "__more__", title: "Show more results", artist: "", cover: null, kind: "podcast" };

	selectSuggestion(value: Song, evt: MouseEvent | KeyboardEvent): void {
		if (value.id.startsWith("__show__") && value.showId) { this.openShow(value.showId, value.title); return; }
		if (value !== SongPickerModal.MORE) { super.selectSuggestion(value, evt); return; }
		// Keep the dialog open and fetch the next page.
		this.pageSize = Math.min(200, this.pageSize + (this.show ? 20 : 10));
		const key = this.pageKey, size = this.pageSize;
		this.inputEl.dispatchEvent(new Event("input"));
		this.pageKey = key; this.pageSize = size; // the re-run must not reset the page
	}

	renderSuggestion(song: Song, el: HTMLElement): void {
		if (song.id.startsWith("__show__")) {
			// A matching show: picking it lists its latest episodes.
			el.addClass("dj-song-suggestion", "dj-show-row");
			const img = song.cover ? el.createEl("img", { cls: "dj-song-thumb", attr: { src: song.cover, alt: "" } }) : null;
			if (!img) setIcon(el.createDiv({ cls: "dj-song-thumb dj-cover-fallback" }), "mic");
			const text = el.createDiv({ cls: "dj-song-result-text" });
			text.createDiv({ cls: "dj-song-result-title", text: song.title });
			text.createDiv({ cls: "dj-song-result-meta", text: "Podcast · latest episodes" });
			setIcon(el.createSpan({ cls: "dj-show-row-arrow" }), "chevron-right");
			return;
		}
		if (song === SongPickerModal.MORE) {
			el.addClass("dj-song-more");
			setIcon(el.createSpan(), "chevrons-down");
			el.createSpan({ text: "Show more results" });
			return;
		}
		el.addClass("dj-song-suggestion");
		const fallback = () => { img?.remove(); const d = createDiv({ cls: "dj-song-thumb dj-cover-fallback" }); setIcon(d, "music"); el.prepend(d); };
		const img = song.cover ? el.createEl("img", { cls: "dj-song-thumb", attr: { src: song.cover, alt: "" } }) : null;
		if (img) img.onerror = fallback; else fallback();
		const text = el.createDiv({ cls: "dj-song-result-text" });
		text.createDiv({ cls: "dj-song-result-title", text: song.title });
		const date = song.date ? moment(song.date, "YYYY-MM-DD").format("MMM D, YYYY") : null;
		const meta = text.createDiv({ cls: "dj-song-result-meta" });
		if (song.audio && song.artist && !this.show) {
			// A podcast's show name opens that show's latest episodes.
			const show = meta.createSpan({ cls: song.showId ? "dj-show-link" : "", text: song.artist, attr: song.showId ? { "aria-label": `Latest episodes of ${song.artist}` } : {} });
			const browse = (e: MouseEvent) => {
				if (!song.showId) return;
				e.preventDefault(); e.stopPropagation();
				if (e.type === "click") this.openShow(song.showId, song.artist);
			};
			show.addEventListener("mousedown", browse);
			show.addEventListener("click", browse);
		} else if (song.artist) meta.appendText(song.artist);
		if (date) meta.appendText((song.artist ? " · " : "") + date);
	}

	onChooseSuggestion(song: Song): void {
		this.onPick(song);
	}
}

/**
 * The mood finder: pick how you feel, in one to three words. Start from a core feeling on the
 * Junto Emotion Wheel (Anger, Sadness, Joy...) and pick the word that fits best, or search every word. A word that
 * isn't listed can be typed and added with Enter. Done saves; Escape leaves things as they were.
 */
export class MoodPickerModal extends Modal {
	private picked: string[];
	/** The core feeling opened, or null for the six tiles. */
	private family: MoodFamily | null = null;
	/** Which tile to focus after the next redraw (keyboard use), or null to leave focus alone. */
	private focusAt: number | null = null;
	private search!: HTMLInputElement;
	private chosenEl!: HTMLElement;
	private bodyEl!: HTMLElement;

	constructor(app: App, current: string[], private onDone: (moods: string[]) => void) {
		super(app);
		this.picked = [...current];
		this.modalEl.addClass("dj-mood-modal");
	}

	onOpen(): void {
		this.titleEl.setText("How are you feeling?");
		const { contentEl } = this;
		this.search = contentEl.createEl("input", { cls: "dj-mood-search", attr: { type: "text", placeholder: "Search feelings, or type your own" } });
		this.search.addEventListener("input", () => { this.family = null; this.draw(); });
		this.search.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			const typed = this.search.value.trim().toLowerCase();
			if (!typed) { this.finish(); return; }
			// Enter adds the first match, or what was typed if nothing matches.
			const match = this.matches(typed)[0];
			this.toggle(match ?? typed);
			this.search.value = "";
			this.draw();
		});
		this.chosenEl = contentEl.createDiv({ cls: "dj-mood-chosen" });
		this.bodyEl = contentEl.createDiv({ cls: "dj-mood-body" });
		const foot = contentEl.createDiv({ cls: "modal-button-container" });
		foot.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		const done = foot.createEl("button", { cls: "mod-cta", text: "Done" });
		done.onclick = () => this.finish();
		// Key hints, like Obsidian's own pickers.
		const hints = contentEl.createDiv({ cls: "prompt-instructions dj-mood-keys" });
		for (const [key, what] of [["↑↓←→", "move"], ["↵", "pick"], ["⌫", "back"], ["Ctrl ↵", "done"]]) {
			const h = hints.createDiv({ cls: "prompt-instruction" });
			h.createSpan({ cls: "prompt-instruction-command", text: key });
			h.createSpan({ text: what });
		}
		// Captured here so Escape can go back a step instead of closing the whole dialog.
		this.modalEl.addEventListener("keydown", (e) => this.onKey(e), true);
		this.draw();
		// The search box isn't focused (on phones that would open the keyboard over the tiles). On a
		// computer, focus starts on the first core feeling so the arrow keys work straight away.
		if (!Platform.isMobile) window.setTimeout(() => this.focusTile(0), 0);
	}

	/** The tiles you can move between (the families, or the words), in order. */
	private tiles(): HTMLButtonElement[] {
		return Array.from(this.bodyEl.querySelectorAll<HTMLButtonElement>("button.dj-mood-family, button.dj-mood-word"));
	}

	private focusTile(i: number): void {
		const tiles = this.tiles();
		if (!tiles.length) return;
		tiles[Math.max(0, Math.min(i, tiles.length - 1))].focus();
	}

	/** The tile above or below, nearest to the same column (the grid wraps, so this goes by position). */
	private vertical(from: HTMLElement, down: boolean): number | null {
		const tiles = this.tiles();
		const r = from.getBoundingClientRect();
		const x = r.left + r.width / 2;
		const rows = tiles.map((b) => b.getBoundingClientRect());
		const next = rows.map((b, i) => ({ i, b })).filter(({ b }) => (down ? b.top > r.top + 2 : b.top < r.top - 2));
		if (!next.length) return null;
		const rowTop = down ? Math.min(...next.map(({ b }) => b.top)) : Math.max(...next.map(({ b }) => b.top));
		const row = next.filter(({ b }) => Math.abs(b.top - rowTop) < 2);
		row.sort((a, b) => Math.abs(a.b.left + a.b.width / 2 - x) - Math.abs(b.b.left + b.b.width / 2 - x));
		return row[0].i;
	}

	/** Back from a core feeling to the six tiles, with focus on the one you came from. */
	private back(): void {
		if (!this.family) return;
		this.focusAt = moodFamilies().indexOf(this.family);
		this.family = null;
		this.draw();
	}

	private onKey(e: KeyboardEvent): void {
		const target = e.target as HTMLElement;
		const inSearch = target === this.search;
		const tiles = this.tiles();
		const at = tiles.indexOf(target as HTMLButtonElement);
		const handled = () => { e.preventDefault(); e.stopPropagation(); };
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { handled(); this.finish(); return; }
		if (e.key === "Escape" && inSearch && this.search.value) { handled(); this.search.value = ""; this.draw(); return; }
		if (e.key === "Escape" && this.family) { handled(); this.back(); return; }
		if (inSearch) {
			if (e.key === "ArrowDown" && tiles.length) { handled(); this.focusTile(0); }
			else if (e.key === "Backspace" && !this.search.value && this.family) { handled(); this.back(); }
			return;
		}
		if (at < 0) return;
		let to: number | null = null;
		if (e.key === "ArrowRight") to = at + 1 < tiles.length ? at + 1 : at;
		else if (e.key === "ArrowLeft") to = Math.max(0, at - 1);
		else if (e.key === "ArrowDown") to = this.vertical(target, true) ?? at;
		else if (e.key === "ArrowUp") {
			to = this.vertical(target, false);
			if (to === null) { handled(); if (!this.family) this.search.focus(); return; }
		} else if (e.key === "Backspace") { handled(); if (this.family) this.back(); else this.search.focus(); return; }
		else if (!this.family && e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// Typing on a tile goes to the search box.
			handled();
			this.search.focus();
			this.search.value += e.key;
			this.search.dispatchEvent(new Event("input"));
			return;
		}
		if (to !== null) { handled(); tiles[to].focus(); }
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private finish(): void {
		this.onDone(this.picked);
		this.close();
	}

	/** Words containing what's typed, from every family. */
	private matches(term: string): string[] {
		return [...new Set(moodFamilies().flatMap((f) => f.words))].filter((w) => w.includes(term));
	}

	private toggle(word: string): void {
		if (this.picked.includes(word)) this.picked = this.picked.filter((w) => w !== word);
		else if (this.picked.length < MAX_MOODS) this.picked = [...this.picked, word];
	}

	/** A word as a tappable chip, in its family's color, marked when picked. */
	private wordChip(parent: HTMLElement, word: string, main = false): void {
		const on = this.picked.includes(word);
		const full = !on && this.picked.length >= MAX_MOODS;
		const b = parent.createEl("button", { cls: "dj-mood-word" + (on ? " is-on" : "") + (main ? " is-main" : "") + (full ? " is-full" : ""), text: word, attr: full ? { "aria-disabled": "true" } : {} });
		const family = familyOf(word);
		if (family) b.style.setProperty("--dj-mood", family.color);
		b.onclick = () => { if (full) return; this.keepFocus(); this.toggle(word); this.draw(); };
	}

	/** Before a redraw: if a tile has focus, focus the same spot again afterwards. */
	private keepFocus(): void {
		const at = this.tiles().indexOf(activeDocument.activeElement as HTMLButtonElement);
		if (at >= 0) this.focusAt = at;
	}

	/** Redraw, then put keyboard focus back where it was asked to go. */
	private draw(): void {
		this.paint();
		if (this.focusAt !== null) { this.focusTile(this.focusAt); this.focusAt = null; }
	}

	private paint(): void {
		// What's picked so far, at the top.
		this.chosenEl.empty();
		this.chosenEl.toggle(this.picked.length > 0);
		for (const word of this.picked) {
			const chip = this.chosenEl.createSpan({ cls: "dj-chip dj-mood" });
			const family = familyOf(word);
			if (family) chip.style.setProperty("--dj-mood", family.color);
			chip.createSpan({ cls: "dj-mood-dot" });
			chip.createSpan({ text: word });
			const x = chip.createEl("button", { cls: "dj-tag-remove", text: "×", attr: { "aria-label": `Remove ${word}` } });
			x.onclick = () => { this.toggle(word); this.draw(); };
		}
		this.chosenEl.createSpan({ cls: "dj-mood-count", text: `${this.picked.length} of ${MAX_MOODS}` });

		this.bodyEl.empty();
		// Search is for the six tiles; a core feeling's page is short enough without it.
		this.search.toggle(!this.family);
		const term = this.search.value.trim().toLowerCase();
		if (term) {
			// Searching: matching words from every family, or an offer to add what was typed.
			const found = this.matches(term);
			const words = this.bodyEl.createDiv({ cls: "dj-mood-words" });
			for (const w of found) this.wordChip(words, w);
			if (!found.includes(term)) {
				const own = words.createEl("button", { cls: "dj-mood-word dj-mood-own" + (this.picked.length >= MAX_MOODS ? " is-full" : ""), text: `Add "${term}"` });
				own.onclick = () => { if (this.picked.length >= MAX_MOODS) return; this.toggle(term); this.search.value = ""; this.draw(); };
			}
			return;
		}
		if (this.family) {
			// One core feeling: rows of three, the feeling (bold) then its two more specific ones.
			const f = this.family;
			// A header: a small back arrow, then the feeling's name and color, like the tile you tapped.
			const head = this.bodyEl.createDiv({ cls: "dj-mood-head" });
			head.style.setProperty("--dj-mood", f.color);
			const back = head.createEl("button", { cls: "dj-mood-back clickable-icon", attr: { "aria-label": "Back" } });
			setIcon(back, "arrow-left");
			back.onclick = () => this.back();
			head.createSpan({ cls: "dj-mood-dot" });
			head.createSpan({ cls: "dj-mood-head-name", text: f.name });
			const rows = this.bodyEl.createDiv({ cls: "dj-mood-words dj-mood-rows" });
			rows.style.setProperty("--dj-mood", f.color);
			// Column headings, so it's clear the left column is the kind of feeling and the others narrow it.
			rows.createDiv({ cls: "dj-mood-col", text: "Feeling" });
			rows.createDiv({ cls: "dj-mood-col dj-mood-col-more", text: "More specific" });
			for (const r of f.rows) {
				this.wordChip(rows, r.word, true);
				for (const w of r.more) this.wordChip(rows, w);
			}
			return;
		}
		// The six core emotions, unpleasant to pleasant.
		const grid = this.bodyEl.createDiv({ cls: "dj-mood-families" });
		for (const f of moodFamilies()) {
			const tile = grid.createEl("button", { cls: "dj-mood-family" });
			tile.style.setProperty("--dj-mood", f.color);
			const head = tile.createDiv({ cls: "dj-mood-family-name" });
			head.createSpan({ cls: "dj-mood-dot" });
			head.createSpan({ text: f.name });
			const count = this.picked.filter((w) => f.words.includes(w)).length;
			tile.createDiv({ cls: "dj-mood-family-hint" + (count ? " is-count" : ""), text: count ? `${count} picked` : f.rows.slice(0, 3).map((r) => r.word).join(", ") + "…" });
			tile.onclick = () => {
				// From the keyboard (or a tap), land on the first word so arrows work straight away.
				if (this.tiles().includes(activeDocument.activeElement as HTMLButtonElement)) this.focusAt = 0;
				this.family = f;
				this.draw();
			};
		}
	}
}
