import { App, normalizePath, PluginSettingTab, Setting } from "obsidian";
import type DailyJournal from "../main";
import { PlaceModal, PromptsModal } from "./modals";
import { CheckInFields } from "./settings";

export class JournalSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: DailyJournal) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl).setName("Entries").setHeading();
		new Setting(containerEl)
			.setName("Journal folder")
			.setDesc("Where journal entries live. Usually the same as Obsidian's Daily notes folder.")
			.addText((t) => t.setPlaceholder("Daily Notes").setValue(s.folder)
				.onChange(async (v) => { s.folder = normalizePath(v || "/"); await save(); }));
		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Path and filename format for entries (Moment.js), e.g. YYYY/MMM/MM-DD-YY. Usually the same as Daily notes.")
			.addText((t) => t.setPlaceholder("YYYY-MM-DD").setValue(s.dateFormat)
				.onChange(async (v) => { s.dateFormat = v.trim() || "YYYY-MM-DD"; await save(); }));
		new Setting(containerEl)
			.setName("Fill new entries")
			.setDesc("When an empty entry is created (Daily notes, a calendar, Hearth), fill it with the journal layout.")
			.addToggle((t) => t.setValue(s.fillNewEntries).onChange(async (v) => { s.fillNewEntries = v; await save(); }));
		new Setting(containerEl)
			.setName("Use as Daily notes template")
			.setDesc(`Keeps the journal layout in ${this.plugin.templatePath()} and sets it as Daily notes' template, so Obsidian's own daily-note command uses it.`)
			.addToggle((t) => t.setValue(s.useAsDailyTemplate).onChange(async (v) => { s.useAsDailyTemplate = v; await save(); }));
		new Setting(containerEl)
			.setName("Writing prompts")
			.setDesc(s.prompts.map((p) => p.text).join(" · ") || "None")
			.addButton((b) => b.setButtonText("Edit…").onClick(() => {
				new PromptsModal(this.app, s.prompts, async (prompts) => {
					s.prompts = prompts;
					await save();
					this.display();
				}).open();
			}));

		new Setting(containerEl).setName("Cards").setHeading();
		// A card, with its own settings indented underneath (hidden while the card is off).
		const sub = (setting: Setting, visible = true) => {
			setting.settingEl.addClass("dj-setting-sub");
			setting.settingEl.toggle(visible);
			return setting;
		};

		new Setting(containerEl).setName("Header").setDesc("The date, previous/next entry links, that day's weather, and the entry's location. Always shown.");
		const home = sub(new Setting(containerEl).setName("Default location").setDesc(s.home.name));
		home.addButton((b) => b.setButtonText("Change…").onClick(() => {
			new PlaceModal(this.app, null, async (place) => {
				if (!place) return;
				s.home = place;
				await save();
				this.display();
			}, "Default location").open();
		}));
		sub(new Setting(containerEl).setName("Temperature"))
			.addDropdown((d) => d.addOption("f", "Fahrenheit (°F)").addOption("c", "Celsius (°C)").setValue(s.units)
				.onChange(async (v) => { s.units = v === "c" ? "c" : "f"; await save(); }));

		new Setting(containerEl)
			.setName("Reading")
			.setDesc("Your current book, its progress, and highlights made that day (from book notes, e.g. MoonSync).")
			.addToggle((t) => t.setValue(s.showReading).onChange(async (v) => { s.showReading = v; await save(); this.display(); }));
		sub(new Setting(containerEl).setName("Books folder").setDesc("Where book notes live."), s.showReading)
			.addText((t) => t.setPlaceholder("Books").setValue(s.booksFolder)
				.onChange(async (v) => { s.booksFolder = normalizePath(v || "Books"); await save(); }));

		new Setting(containerEl).setName("Check-in").setDesc("Fields saved as properties, so Bases can chart and query them. Hidden when all are off.");
		const fields: Array<[keyof CheckInFields, string]> = [
			["rating", "Day rating (1–10)"], ["sleep", "Sleep (hours)"], ["exercise", "Exercise"], ["food", "Food (breakfast, lunch, dinner)"],
		];
		for (const [key, name] of fields) {
			sub(new Setting(containerEl).setName(name))
				.addToggle((t) => t.setValue(s.fields[key]).onChange(async (v) => { s.fields[key] = v; await save(); }));
		}

		new Setting(containerEl)
			.setName("On this day")
			.setDesc("Links to entries from the same date in earlier months and years.")
			.addToggle((t) => t.setValue(s.showOnThisDay).onChange(async (v) => { s.showOnThisDay = v; await save(); }));

		new Setting(containerEl).setName("Appearance").setHeading();
		new Setting(containerEl)
			.setName("Hide title and properties in entries")
			.setDesc("The cards already show the date and check-in data.")
			.addToggle((t) => t.setValue(s.hideNoteChrome).onChange(async (v) => { s.hideNoteChrome = v; await save(); }));
	}
}
