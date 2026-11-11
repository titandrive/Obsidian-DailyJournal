import { MarkdownRenderChild, Notice, normalizePath, Plugin, TAbstractFile, TFile, moment } from "obsidian";
import { entryDate, entryPath, Moment } from "./src/dates";
import { MonthPicker, PlaceModal } from "./src/modals";
import { JournalHost, renderSection } from "./src/render";
import { DEFAULT_SETTINGS, JournalSettings, Place } from "./src/settings";
import { JournalSettingTab } from "./src/settings-tab";
import { entryTemplate } from "./src/template";
import { entryPlace, fetchWeather, hasOwnPlace } from "./src/weather";

/** One rendered `journal` block. Redraws when its entry's properties change (e.g. weather arrives). */
class JournalBlock extends MarkdownRenderChild {
	private timer = 0;

	constructor(private plugin: DailyJournal, containerEl: HTMLElement, private section: string, private file: TFile) {
		super(containerEl);
	}

	onload(): void {
		this.render();
		this.registerEvent(this.plugin.app.metadataCache.on("changed", (changed) => {
			if (changed.path !== this.file.path) return;
			// Don't redraw under someone typing in one of the card's fields.
			if (this.containerEl.contains(document.activeElement)) return;
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => this.render(), 150);
		}));
	}

	onunload(): void {
		window.clearTimeout(this.timer);
	}

	private render(): void {
		this.containerEl.empty();
		this.containerEl.addClass("dj-block");
		void renderSection(this.plugin, this.section, this.containerEl, this.file);
	}
}

export default class DailyJournal extends Plugin implements JournalHost {
	settings!: JournalSettings;
	weatherTried = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new JournalSettingTab(this.app, this));
		this.applyNoteChrome();

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
			callback: () => new MonthPicker(this.app, null, (d) => this.hasEntry(d), (d) => this.openEntry(d),
				{ title: "Create journal entry for…", allowTaken: true }).open(),
		});
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

		// Fill new, empty entries (e.g. from Obsidian's Daily notes or the Hearth "Today" card) with the template.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on("create", (file) => this.fillIfEmpty(file)));
		});
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}), fields: { ...DEFAULT_SETTINGS.fields, ...(saved?.fields ?? {}) } };
		if (!saved) {
			// First run: use the same folder and date format as Obsidian's Daily notes, so they agree.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const daily = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
			if (daily?.folder) this.settings.folder = normalizePath(daily.folder);
			if (daily?.format) this.settings.dateFormat = daily.format;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.applyNoteChrome();
	}

	/** Hides the filename title and Properties box in journal notes (the cards show that info). */
	applyNoteChrome(): void {
		document.body.toggleClass("dj-hide-chrome", this.settings.hideNoteChrome);
	}

	onunload(): void {
		document.body.removeClass("dj-hide-chrome");
	}

	journalEntries(): Array<{ file: TFile; date: Moment }> {
		return this.app.vault.getMarkdownFiles()
			.map((file) => ({ file, date: entryDate(this.settings, file) }))
			.filter((e): e is { file: TFile; date: Moment } => e.date !== null)
			.sort((a, b) => a.date.valueOf() - b.date.valueOf());
	}

	private withActiveEntry(checking: boolean, run: (file: TFile, date: Moment) => void): boolean {
		const file = this.app.workspace.getActiveFile();
		const date = entryDate(this.settings, file);
		if (!file || !date) return false;
		if (!checking) run(file, date);
		return true;
	}

	private pickDate(file: TFile, date: Moment): void {
		new MonthPicker(this.app, date, (d) => this.hasEntry(d), (picked) => this.moveEntry(file, picked)).open();
	}

	private hasEntry(date: Moment): boolean {
		return !!this.app.vault.getAbstractFileByPath(entryPath(this.settings, date));
	}

	private pickPlace(file: TFile): void {
		const own = hasOwnPlace(this.app.metadataCache.getFileCache(file)?.frontmatter);
		new PlaceModal(this.app, own ? this.settings.home : null, (place) => { void this.setEntryPlace(file, place); }).open();
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
			const text = await this.app.vault.read(file);
			const untouched = text.trim() === "" || (this.settings.replaceDailyTemplate && await this.isDailyNotesTemplate(text));
			if (untouched) await this.app.vault.modify(file, entryTemplate(this.settings));
		}, 500);
	}

	/**
	 * Whether a note's text is exactly what Daily notes' template produces ({{date}}-style
	 * placeholders match anything). Anything with real writing in it doesn't match.
	 */
	private async isDailyNotesTemplate(text: string): Promise<boolean> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const path = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options?.template;
		if (!path) return false;
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path.endsWith(".md") ? path : path + ".md"));
		if (!(file instanceof TFile)) return false;
		const template = (await this.app.vault.read(file)).trim();
		const pattern = template.split(/\{\{[^}]*\}\}/)
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("[\\s\\S]*?");
		return new RegExp(`^${pattern}$`).test(text.trim());
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
		const weather = date.isAfter(moment(), "day") ? null : await fetchWeather(place, date, this.settings.units);
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (weather) fm.weather = weather;
			else delete fm.weather;
		});
		new Notice(`Moved entry to ${date.format("dddd, MMM D, YYYY")}${weather ? "" : " (weather unavailable)"}.`);
	}

	/** Sets an entry's location (null = back to home) and refreshes its weather. Returns the new weather. */
	async setEntryPlace(file: TFile, place: Place | null): Promise<string | null> {
		const date = entryDate(this.settings, file);
		const weather = date && !date.isAfter(moment(), "day")
			? await fetchWeather(place ?? this.settings.home, date, this.settings.units)
			: null;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (place) Object.assign(fm, { location: place.name, latitude: place.lat, longitude: place.lon, timezone: place.tz });
			else for (const k of ["location", "latitude", "longitude", "timezone"]) delete fm[k];
			if (weather) fm.weather = weather;
			else delete fm.weather;
		});
		return weather;
	}
}
