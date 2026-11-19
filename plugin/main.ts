import { debounce, MarkdownRenderChild, MarkdownView, Notice, normalizePath, Platform, Plugin, TAbstractFile, TFile, TFolder, moment } from "obsidian";
import { BASE_NAME, ICONS_FOLDER, journalBase, OLD_BASE_NAMES, SKY_ICONS } from "./src/base";
import { entryDate, entryPath, Moment } from "./src/dates";
import { HardcoverDay, hardcoverDay, readingProperties } from "./src/hardcover";
import { MonthPicker, PlaceHistory, PlaceModal } from "./src/modals";
import { drawReading, JournalHost, renderSection } from "./src/render";
import { DEFAULT_SETTINGS, JournalSettings, Place, Prompt } from "./src/settings";
import { JournalSettingTab } from "./src/settings-tab";
import { applyLayout, blockShowsWeather, entryTemplate, parseBlock, SHOW_CHROME } from "./src/template";
import { entryPlace, fetchWeather } from "./src/weather";
import { TRENDS_VIEW, redrawInsights, TrendsView } from "./src/trends";
import { SONG_KEYS } from "./src/music";
import { BaseTabs } from "./src/basetabs";

/**
 * The properties each card shows, so a card only redraws when one of its own changes (saving a tag
 * shouldn't redraw the header or the reading card). On this day shows other entries, never its own.
 */
const CARD_PROPS: Record<string, string[]> = {
	header: ["weather", "location", "latitude", "longitude", "timezone", "favorite"],
	reading: ["reading", "books", "pages_read"],
	hardcover: ["reading", "books", "pages_read"],
	song: SONG_KEYS,
	checkin: ["day_rating", "mood", "sleep", "worked", "exercise", "exercise_note", "breakfast", "lunch", "dinner", "ate", "skipped_meals", "tags"],
	onthisday: [],
};

/** The part of an entry's properties a block's cards show ("row reading song" covers both cards). */
function propsFor(section: string, fm: Record<string, unknown>): string {
	const words = section.trim().split(/\s+/);
	const cards = words[0] === "row" ? words.slice(1) : [words[0]];
	const keys = cards.flatMap((c) => CARD_PROPS[c] ?? Object.keys(fm));
	return JSON.stringify(keys.map((k) => [k, fm[k] ?? null]));
}

/** One rendered `journal` block. Redraws when the properties its cards show change (e.g. weather arrives). */
class JournalBlock extends MarkdownRenderChild {
	private timer = 0;
	/** The properties this block's cards showed when last drawn (see propsFor). */
	private drawnProps = "";

	constructor(private plugin: DailyJournal, containerEl: HTMLElement, private section: string, private file: TFile) {
		super(containerEl);
	}

	onload(): void {
		this.plugin.blocks.add(this);
		this.render();
		this.registerEvent(this.plugin.app.metadataCache.on("changed", (changed, _data, cache) => {
			if (changed.path !== this.file.path) return;
			// Obsidian reports a change on every autosave while you type, and most property changes
			// belong to other cards: only redraw when this block's own properties changed.
			if (propsFor(this.section, cache.frontmatter ?? {}) === this.drawnProps) return;
			// Don't redraw under someone typing in one of the card's fields.
			if (this.containerEl.contains(document.activeElement)) return;
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => this.render(), 150);
		}));
	}

	onunload(): void {
		window.clearTimeout(this.timer);
		this.plugin.blocks.delete(this);
	}

	/** Redraw this block's Reading card from freshly fetched data, if it's a Reading card for that entry. */
	showReading(file: TFile, date: Moment, day: HardcoverDay): void {
		const kind = this.section.split(/\s+/)[0];
		if (this.file.path !== file.path || (kind !== "reading" && kind !== "hardcover")) return;
		window.clearTimeout(this.timer);
		this.containerEl.empty();
		this.containerEl.addClass("dj-block");
		drawReading(this.containerEl, day, date);
	}

	private render(): void {
		this.drawnProps = propsFor(this.section, this.plugin.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {});
		this.containerEl.empty();
		this.containerEl.addClass("dj-block");
		void renderSection(this.plugin, this.section, this.containerEl, this.file);
	}
}

export default class DailyJournal extends Plugin implements JournalHost {
	/** An entry that was just opened and should get keyboard focus on its Earworm card, until a deadline. */
	private startFocus: { path: string; until: number } | null = null;

	focusStart(file: TFile, el: HTMLElement): void {
		const want = this.startFocus;
		if (!want || want.path !== file.path || Date.now() > want.until) return;
		if (this.app.workspace.getActiveViewOfType(MarkdownView)?.file !== file) return;
		// Cards are drawn before Obsidian puts them on the page: wait for it (until the deadline).
		if (!el.isConnected) { window.setTimeout(() => this.focusStart(file, el), 30); return; }
		this.startFocus = null;
		const focus = () => (el.focus as (o?: object) => void)({ preventScroll: true, focusVisible: true });
		focus();
		// Something else (the editor, Remember Cursor Position) may put the cursor back into the text a
		// moment later, without a focus event to catch: for a second and a half, whenever the text has
		// focus instead, take it back, unless you've clicked or typed (then you're left alone).
		const doc = el.doc;
		let yours = false;
		const mine = () => { yours = true; };
		doc.addEventListener("mousedown", mine, true);
		doc.addEventListener("keydown", mine, true);
		const started = Date.now();
		const check = window.setInterval(() => {
			const now = doc.activeElement as HTMLElement | null;
			const stolen = !!now?.closest?.(".cm-content") && !now.closest(".block-language-journal");
			if (!yours && el.isConnected && stolen) focus();
			if (yours || !el.isConnected || Date.now() - started > 1500) {
				window.clearInterval(check);
				doc.removeEventListener("mousedown", mine, true);
				doc.removeEventListener("keydown", mine, true);
			}
		}, 50);
	}

	settings!: JournalSettings;
	private baseTabs?: BaseTabs;
	weatherTried = new Set<string>();
	readingTried = new Set<string>();
	readingRetries = new Map<string, "pending" | "done">();
	weatherRetried = new Set<string>();
	blocks = new Set<JournalBlock>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new JournalSettingTab(this.app, this));

		// A Trends tab for the Insights base (Bases view types need Obsidian 1.10+).
		this.registerBasesView?.(TRENDS_VIEW, {
			name: "Trends", icon: "chart-line",
			factory: (controller, containerEl) => new TrendsView(controller, containerEl, () => this.settings, (folded) => {
				this.settings.insightsFolded = folded;
				return this.saveData(this.settings);
			}),
		});

		this.registerMarkdownCodeBlockProcessor("journal", (source, el, ctx) => {
			const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (file instanceof TFile) ctx.addChild(new JournalBlock(this, el, source.trim(), file));
		});

		this.addCommand({
			id: "open-today",
			name: "Open today's entry",
			callback: () => this.openEntry(moment()),
		});
		this.addCommand({
			id: "create-yesterday",
			name: "Create Journal (Yesterday)",
			callback: () => this.openEntry(moment().subtract(1, "day")),
		});
		this.addCommand({
			id: "create-choose",
			name: "Create Journal (Choose Date)",
			callback: () => this.pickEntryDate(),
		});
		this.addCommand({
			id: "open-insights",
			name: "Open Insights",
			callback: () => void this.openInsights(),
		});

		// Sidebar buttons.
		this.addRibbonIcon("chart-line", "Open Insights", () => void this.openInsights());
		this.addRibbonIcon("calendar-minus", "Create Journal (Yesterday)", () => void this.openEntry(moment().subtract(1, "day")));
		this.addRibbonIcon("calendar-search", "Create Journal (Choose Date)", () => this.pickEntryDate());
		this.addCommand({
			id: "change-date-yesterday",
			name: "Change date (yesterday)",
			checkCallback: (checking) => this.withActiveEntry(checking, (file, date) => this.moveEntry(file, date.clone().subtract(1, "day"))),
		});
		this.addCommand({
			id: "change-date-choose",
			name: "Change date (choose date)",
			checkCallback: (checking) => this.withActiveEntry(checking, (file, date) => this.pickDate(file, date)),
		});
		this.addCommand({
			id: "refresh-reading",
			name: "Refresh reading",
			checkCallback: (checking) => this.withActiveEntry(checking, async (file, date) => {
				if (!this.settings.hardcoverToken) { new Notice("Add your Hardcover API token in Daily Journal's settings first."); return; }
				try {
					await this.refreshReading(file, date);
					new Notice("Reading updated from Hardcover.");
				} catch (e) {
					new Notice(`Couldn't load from Hardcover: ${e instanceof Error ? e.message : String(e)}`);
				}
			}),
		});
		this.addCommand({
			id: "change-location",
			name: "Change location",
			checkCallback: (checking) => this.withActiveEntry(checking, (file) => this.pickPlace(file)),
		});

		// The same date actions in the right-click menu (file explorer, tab header) for journal entries.
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			const date = entryDate(this.settings, file);
			if (!date || !(file instanceof TFile)) return;
			menu.addItem((item) => item.setTitle("Change date (yesterday)").setIcon("calendar-minus").setSection("action")
				.onClick(() => this.moveEntry(file, date.clone().subtract(1, "day"))));
			menu.addItem((item) => item.setTitle("Change date (choose date)").setIcon("calendar-days").setSection("action")
				.onClick(() => this.pickDate(file, date)));
		}));

		// Hide the title and Properties in open journal entries (the same way Frontmatter Hider does it:
		// a class on each open note's content area, refreshed whenever notes or their properties change).
		const refresh = () => this.refreshChrome();
		this.registerEvent(this.app.workspace.on("layout-change", refresh));
		this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
		this.registerEvent(this.app.workspace.on("file-open", refresh));
		// Keyboard: opening an entry puts focus on the Earworm card (the first thing to fill in), so
		// Enter opens the song search and Tab moves on through the check-in. Computers only. The card
		// focuses itself as it draws (focusStart); if it's already drawn, it's focused here.
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			this.startFocus = null;
			if (Platform.isMobile || !file || !entryDate(this.settings, file)) return;
			this.startFocus = { path: file.path, until: Date.now() + 2000 };
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const start = view?.file === file ? view.containerEl.querySelector<HTMLElement>("[data-dj-start]") : null;
			if (start) this.focusStart(file, start);
		}));
		this.registerEvent(this.app.metadataCache.on("changed", refresh));

		// Tab buttons in every base's header. Redrawn when panes change or a base's views are edited.
		const tabs = this.baseTabs = new BaseTabs(this, () => this.settings.baseTabs);
		const refreshTabs = debounce(() => tabs.refresh(), 150, true);
		this.registerEvent(this.app.workspace.on("layout-change", refreshTabs));
		this.registerEvent(this.app.workspace.on("active-leaf-change", refreshTabs));
		this.registerEvent(this.app.vault.on("modify", (f) => { if (f.path.endsWith(".base")) refreshTabs(); }));

		// Fill new, empty entries (e.g. from Obsidian's Daily notes or the Hearth "Today" card) with the template.
		this.app.workspace.onLayoutReady(() => {
			this.refreshChrome();
			tabs.refresh();
			this.registerEvent(this.app.vault.on("create", (file) => this.fillIfEmpty(file)));
			void this.syncDailyTemplate();
			void this.syncJournalBase();
		});
	}

	refreshBaseTabs(): void {
		this.baseTabs?.refresh();
	}

	onunload(): void {
		this.baseTabs?.clearAll();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) leaf.view.contentEl.removeClass("dj-chrome-hidden");
		});
	}

	/** Marks each open journal entry whose title and Properties should be hidden. */
	private refreshChrome(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			const fm = view.file ? this.app.metadataCache.getFileCache(view.file)?.frontmatter : undefined;
			const classes: unknown[] = Array.isArray(fm?.cssclasses) ? fm.cssclasses : [fm?.cssclasses];
			view.contentEl.toggleClass("dj-chrome-hidden", classes.includes("journal") && !classes.includes(SHOW_CHROME));
		});
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}), fields: { ...DEFAULT_SETTINGS.fields, ...(saved?.fields ?? {}) } };
		// Earlier versions stored prompts as plain strings: first one main heading, the rest sub-headings.
		this.settings.prompts = (this.settings.prompts as Array<Prompt | string>).map((p, i) =>
			typeof p === "string" ? { text: p, level: i === 0 ? 0 : 1 } : p);
		if (!saved) {
			// First run: use the same folder and date format as Obsidian's Daily notes, so they agree.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const daily = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
			if (daily?.folder) this.settings.folder = normalizePath(daily.folder);
			if (daily?.format) this.settings.dateFormat = daily.format;
		}
	}

	/** Settings changed on another device (synced): use them, and redraw Insights (e.g. folded sections). */
	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		redrawInsights();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.syncDailyTemplate();
		await this.syncJournalBase();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private corePlugin(id: string): any {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (this.app as any).internalPlugins?.getPluginById?.(id)?.instance;
	}

	/** Where the journal layout is kept as a template: the core Templates folder, if set. */
	templatePath(): string {
		const folder = this.corePlugin("templates")?.options?.folder;
		return normalizePath(`${folder ? folder + "/" : ""}Daily Journal.md`);
	}

	/**
	 * With "Use as Daily notes template" on, keep the template file in step with the settings and
	 * point Daily notes at it. Turned off, clear Daily notes' template if it still points here.
	 */
	async syncDailyTemplate(): Promise<void> {
		const path = this.templatePath();
		const name = path.replace(/\.md$/, "");
		const daily = this.corePlugin("daily-notes");
		const setDailyTemplate = async (value: string) => {
			if (!daily?.options || daily.options.template === value) return;
			daily.options.template = value;
			await daily.plugin?.saveData?.(daily.options);
		};

		if (this.settings.useAsDailyTemplate) {
			const text = entryTemplate(this.settings);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				if ((await this.app.vault.read(existing)) !== text) await this.app.vault.modify(existing, text);
			} else {
				await this.ensureFolder(path);
				await this.app.vault.create(path, text);
			}
			await setDailyTemplate(name);
		} else if (normalizePath(daily?.options?.template ?? "") === name) {
			await setDailyTemplate("");
		}
	}

	basePath(): string {
		return normalizePath(`${this.settings.folder}/${BASE_NAME}`);
	}

	/**
	 * Keep the Insights base in the journal folder while the setting is on, matching the current
	 * settings; move it to the trash when it's turned off or the journal folder moves. Only acts on an existing folder, so typing a folder name doesn't scatter
	 * bases across half-typed paths.
	 */
	async syncJournalBase(): Promise<void> {
		const s = this.settings;
		const folder = normalizePath(s.folder || "/");
		const exists = folder === "/" || this.app.vault.getAbstractFileByPath(folder) instanceof TFolder;
		const target = s.journalBase && exists ? folder : null;
		if (s.baseFolder !== null && s.baseFolder !== target && (target !== null || !s.journalBase)) {
			await this.removeJournalBase(s.baseFolder);
			s.baseFolder = null;
			await this.saveData(s);
		}
		if (target === null) return;

		const write = async (path: string, text: string) => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				if ((await this.app.vault.read(file)) !== text) await this.app.vault.modify(file, text);
			} else {
				await this.ensureFolder(path);
				await this.app.vault.create(path, text);
			}
		};
		const inFolder = (name: string) => normalizePath(folder === "/" ? name : `${folder}/${name}`);
		// A base under an earlier name is renamed (so links to it follow), or trashed if the new one exists.
		for (const old of OLD_BASE_NAMES) {
			const file = this.app.vault.getAbstractFileByPath(inFolder(old));
			if (!(file instanceof TFile)) continue;
			if (this.app.vault.getAbstractFileByPath(inFolder(BASE_NAME))) await this.app.fileManager.trashFile(file);
			else await this.app.fileManager.renameFile(file, inFolder(BASE_NAME));
		}
		await write(inFolder(BASE_NAME), journalBase(s));
		await this.removeOldWeatherIcons(inFolder(ICONS_FOLDER));
		if (s.baseFolder !== target) { s.baseFolder = target; await this.saveData(s); }
	}

	/**
	 * The base used to show weather with image files kept in a "Weather Icons" folder beside it; it now
	 * uses Obsidian's built-in icons. Trash that folder, but only if it holds nothing but those icons.
	 */
	private async removeOldWeatherIcons(path: string): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (!(folder instanceof TFolder)) return;
		const ours = new Set(SKY_ICONS.map((i) => `${i}.svg`));
		if (folder.children.every((f) => f instanceof TFile && ours.has(f.name))) await this.app.fileManager.trashFile(folder);
	}

	private async removeJournalBase(folder: string): Promise<void> {
		const inFolder = (name: string) => normalizePath(folder === "/" ? name : `${folder}/${name}`);
		for (const path of [inFolder(BASE_NAME), ...OLD_BASE_NAMES.map(inFolder)]) {
			const item = this.app.vault.getAbstractFileByPath(path);
			if (item) await this.app.fileManager.trashFile(item);
		}
		await this.removeOldWeatherIcons(inFolder(ICONS_FOLDER));
	}

	journalEntries(): Array<{ file: TFile; date: Moment }> {
		return this.app.vault.getMarkdownFiles()
			.map((file) => ({ file, date: entryDate(this.settings, file) }))
			.filter((e): e is { file: TFile; date: Moment } => e.date !== null)
			.sort((a, b) => a.date.valueOf() - b.date.valueOf());
	}

	/** Fetch the entry's reading from Hardcover and save it in the entry's properties. */
	async refreshReading(file: TFile, date: Moment): Promise<void> {
		const day = await hardcoverDay(this.settings.hardcoverToken, date);
		const props = readingProperties(day);
		await this.app.fileManager.processFrontMatter(file, (f) => { Object.assign(f, props); });
		// Redraw from the data in hand: Obsidian's property cache can lag right after a save.
		for (const block of this.blocks) block.showReading(file, date, day);
	}

	private withActiveEntry(checking: boolean, run: (file: TFile, date: Moment) => void): boolean {
		const file = this.app.workspace.getActiveFile();
		const date = entryDate(this.settings, file);
		if (!file || !date) return false;
		if (!checking) run(file, date);
		return true;
	}

	private pickDate(file: TFile, date: Moment): void {
		new MonthPicker(this.app, date, (d) => this.hasEntry(d), (picked) => this.moveEntry(file, picked),
			{ onOpenExisting: (d) => void this.openEntry(d) }).open();
	}

	private hasEntry(date: Moment): boolean {
		return !!this.app.vault.getAbstractFileByPath(entryPath(this.settings, date));
	}

	/** Recently picked locations (newest first, at most 8), kept in the plugin's settings. */
	readonly placeHistory: PlaceHistory = {
		get: () => this.settings.recentPlaces ?? [],
		add: (place) => {
			const same = (p: Place) => p.name === place.name && Math.abs(p.lat - place.lat) < 1e-3 && Math.abs(p.lon - place.lon) < 1e-3;
			this.settings.recentPlaces = [place, ...(this.settings.recentPlaces ?? []).filter((p) => !same(p))].slice(0, 8);
			void this.saveData(this.settings);
		},
		clear: () => {
			this.settings.recentPlaces = [];
			void this.saveData(this.settings);
		},
	};

	private pickPlace(file: TFile): void {
		const current = entryPlace(this.app.metadataCache.getFileCache(file)?.frontmatter, this.settings.home);
		new PlaceModal(this.app, current.name !== this.settings.home.name ? this.settings.home : null, async (place) => {
			await this.setEntryPlace(file, place, await this.entryShowsWeather(file));
		}, undefined, this.placeHistory).open();
	}

	/** Whether an entry's header shows weather (set when the entry was created). */
	async entryShowsWeather(file: TFile): Promise<boolean> {
		const header = (await this.app.vault.cachedRead(file)).match(/```journal\n(header[^\n]*)/);
		return header ? blockShowsWeather(parseBlock(header[1]).options) : false;
	}

	private showsChrome(fm: Record<string, unknown> | undefined): boolean {
		const classes = fm?.cssclasses;
		return Array.isArray(classes) ? classes.includes(SHOW_CHROME) : classes === SHOW_CHROME;
	}

	/** Entries the current settings would change (cards, weather, check-in fields, appearance, missing location). */
	async entriesNeedingLayout(): Promise<TFile[]> {
		const out: TFile[] = [];
		for (const { file } of this.journalEntries()) {
			const text = await this.app.vault.cachedRead(file);
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const isLayout = /```journal\nheader/.test(text);
			const noPlace = isLayout && !fm?.location;
			const chromeOff = isLayout && this.showsChrome(fm) !== !this.settings.hideNoteChrome;
			if (applyLayout(text, this.settings) !== text || noPlace || chromeOff) out.push(file);
		}
		return out;
	}

	/** Brings existing entries up to the current card settings. Writing and headings are untouched. */
	async applyLayoutToEntries(files: TFile[]): Promise<void> {
		const home = this.settings.home;
		for (const file of files) {
			await this.app.vault.process(file, (text) => applyLayout(text, this.settings));
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				if (!fm.location) Object.assign(fm, { location: home.name, latitude: home.lat, longitude: home.lon, timezone: home.tz });
				const classes: string[] = (Array.isArray(fm.cssclasses) ? fm.cssclasses : [fm.cssclasses]).filter((c: unknown) => typeof c === "string" && c && c !== SHOW_CHROME);
				if (!classes.includes("journal")) classes.unshift("journal");
				if (!this.settings.hideNoteChrome) classes.push(SHOW_CHROME);
				fm.cssclasses = classes;
			});
		}
		new Notice(`Updated ${files.length} entr${files.length === 1 ? "y" : "ies"}.`);
	}

	pickEntryDate(): void {
		new MonthPicker(this.app, null, (d) => this.hasEntry(d), (d) => this.openEntry(d),
			{ title: "Create journal entry for…", allowTaken: true }).open();
	}

	/** Open the Insights base, creating it first if it isn't there yet. */
	async openInsights(): Promise<void> {
		let file = this.app.vault.getAbstractFileByPath(this.basePath());
		if (!(file instanceof TFile)) {
			await this.syncJournalBase();
			file = this.app.vault.getAbstractFileByPath(this.basePath());
		}
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
		else new Notice(this.settings.journalBase ? `Couldn't find the journal folder "${this.settings.folder}".` : "Turn on Insights base in Daily Journal's settings first.");
	}

	async openEntry(date: Moment): Promise<void> {
		const path = entryPath(this.settings, date);
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			await this.ensureFolder(path);
			file = await this.app.vault.create(path, entryTemplate(this.settings));
		}
		await this.app.workspace.getLeaf(false).openFile(file as TFile);
	}

	private async ensureFolder(path: string): Promise<void> {
		const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
	}

	private fillIfEmpty(file: TAbstractFile): void {
		if (!this.settings.fillNewEntries || !entryDate(this.settings, file) || !(file instanceof TFile)) return;
		// Give whatever created the file (e.g. Daily notes with its own template) a moment to write first.
		window.setTimeout(async () => {
			if ((await this.app.vault.read(file)).trim() === "") await this.app.vault.modify(file, entryTemplate(this.settings));
		}, 500);
	}

	/** Moves an entry to another date and fetches that date's weather for the entry's location. */
	async moveEntry(file: TFile, date: Moment): Promise<void> {
		const target = entryPath(this.settings, date);
		if (target === file.path) return;
		if (this.app.vault.getAbstractFileByPath(target)) {
			new Notice(`There's already a journal entry for ${date.format("MMM D, YYYY")}.`);
			return;
		}
		await this.ensureFolder(target);
		await this.app.fileManager.renameFile(file, target);

		const place = entryPlace(this.app.metadataCache.getFileCache(file)?.frontmatter, this.settings.home);
		if (!(await this.entryShowsWeather(file))) {
			new Notice(`Moved entry to ${date.format("dddd, MMM D, YYYY")}.`);
			return;
		}
		const weather = date.isAfter(moment(), "day") ? null : await fetchWeather(place, date, this.settings.units);
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (weather) fm.weather = weather;
			else delete fm.weather;
		});
		new Notice(`Moved entry to ${date.format("dddd, MMM D, YYYY")}${weather ? "" : " (weather unavailable)"}.`);
	}

	/** Sets an entry's location (null = the default location) and refreshes its weather. Returns the new weather. */
	async setEntryPlace(file: TFile, place: Place | null, withWeather: boolean): Promise<string | null> {
		const chosen = place ?? this.settings.home;
		const date = entryDate(this.settings, file);
		const weather = withWeather && date && !date.isAfter(moment(), "day")
			? await fetchWeather(chosen, date, this.settings.units)
			: null;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			// Saved explicitly (even the default), so later changes to the default don't move this entry.
			Object.assign(fm, { location: chosen.name, latitude: chosen.lat, longitude: chosen.lon, timezone: chosen.tz });
			if (!withWeather) return; // weather isn't shown in this entry; leave any saved weather alone
			if (weather) fm.weather = weather;
			else delete fm.weather;
		});
		return weather;
	}
}
