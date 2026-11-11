import { App, normalizePath, PluginSettingTab, Setting } from "obsidian";
import type DailyJournal from "../main";
import { PlaceModal } from "./modals";
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
			.setName("Replace Daily notes template")
			.setDesc("If Daily notes has a template set, swap it for the journal layout when a new entry is created. Entries that already have your writing (e.g. synced from another device) are never touched.")
			.addToggle((t) => t.setValue(s.replaceDailyTemplate).onChange(async (v) => { s.replaceDailyTemplate = v; await save(); }));
		new Setting(containerEl)
			.setName("Writing prompts")
			.setDesc("One per line. The first becomes the main heading; the rest are sub-headings. Used for new entries.")
			.addTextArea((t) => {
				t.setValue(s.prompts.join("\n")).onChange(async (v) => {
					s.prompts = v.split("\n").map((l) => l.trim()).filter(Boolean);
					await save();
				});
				t.inputEl.rows = 4;
			});

		new Setting(containerEl).setName("Weather & location").setHeading();
		const home = new Setting(containerEl)
			.setName("Default location")
			.setDesc(s.home.name);
		home.addButton((b) => b.setButtonText("Change…").onClick(() => {
			new PlaceModal(this.app, null, async (place) => {
				if (!place) return;
				s.home = place;
				await save();
				this.display();
			}, "Default location").open();
		}));
		new Setting(containerEl)
			.setName("Temperature")
			.addDropdown((d) => d.addOption("f", "Fahrenheit (°F)").addOption("c", "Celsius (°C)").setValue(s.units)
				.onChange(async (v) => { s.units = v === "c" ? "c" : "f"; await save(); }));

		new Setting(containerEl).setName("Cards").setHeading();
		new Setting(containerEl)
			.setName("Reading card")
			.setDesc("Show your current book, its progress, and highlights made that day (from book notes, e.g. MoonSync).")
			.addToggle((t) => t.setValue(s.showReading).onChange(async (v) => { s.showReading = v; await save(); }));
		new Setting(containerEl)
			.setName("Books folder")
			.setDesc("Where book notes live.")
			.addText((t) => t.setPlaceholder("Books").setValue(s.booksFolder)
				.onChange(async (v) => { s.booksFolder = normalizePath(v || "Books"); await save(); }));

		const fields: Array<[keyof CheckInFields, string]> = [
			["rating", "Day rating (1–10)"], ["sleep", "Sleep (hours)"], ["exercise", "Exercise"], ["food", "Food (breakfast, lunch, dinner)"],
		];
		for (const [key, name] of fields) {
			new Setting(containerEl)
				.setName(`Check-in: ${name}`)
				.addToggle((t) => t.setValue(s.fields[key]).onChange(async (v) => { s.fields[key] = v; await save(); }));
		}

		new Setting(containerEl).setName("Appearance").setHeading();
		new Setting(containerEl)
			.setName("Hide title and properties in entries")
			.setDesc("The cards already show the date and check-in data.")
			.addToggle((t) => t.setValue(s.hideNoteChrome).onChange(async (v) => { s.hideNoteChrome = v; await save(); }));
	}
}
