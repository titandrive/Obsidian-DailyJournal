import { App, normalizePath, Notice, PluginSettingTab, Setting } from "obsidian";
import type DailyJournal from "../main";
import { ConfirmModal, PlaceModal, PromptsModal } from "./modals";
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

		new Setting(containerEl).setName("Cards").setHeading()
			.setDesc("Changes apply to new entries. Use \"Apply to existing entries\" at the bottom to update older ones.");
		// Each card is one block: its main setting on top, its own settings indented inside it.
		let group = containerEl;
		const card = () => { group = containerEl.createDiv({ cls: "dj-setting-group" }); return group; };
		const sub = (setting: Setting, visible = true) => {
			setting.settingEl.addClass("dj-setting-sub");
			setting.settingEl.toggle(visible);
			return setting;
		};

		new Setting(card())
			.setName("Weather")
			.setDesc("That day's weather in each entry's header, for the entry's location.")
			.addToggle((t) => t.setValue(s.showWeather).onChange(async (v) => { s.showWeather = v; await save(); this.display(); }));
		const home = sub(new Setting(group).setName("Default location").setDesc(s.home.name));
		home.addButton((b) => b.setButtonText("Change…").onClick(() => {
			new PlaceModal(this.app, null, async (place) => {
				if (!place) return;
				s.home = place;
				await save();
				this.display();
			}, "Default location").open();
		}));
		sub(new Setting(group).setName("Temperature"), s.showWeather)
			.addDropdown((d) => d.addOption("f", "Fahrenheit (°F)").addOption("c", "Celsius (°C)").setValue(s.units)
				.onChange(async (v) => { s.units = v === "c" ? "c" : "f"; await save(); }));

		new Setting(card())
			.setName("Reading")
			.setDesc("Your current book, its progress, and highlights made that day (from book notes, e.g. MoonSync).")
			.addToggle((t) => t.setValue(s.showReading).onChange(async (v) => { s.showReading = v; await save(); this.display(); }));
		sub(new Setting(group).setName("Books folder").setDesc("Where book notes live."), s.showReading)
			.addText((t) => t.setPlaceholder("Books").setValue(s.booksFolder)
				.onChange(async (v) => { s.booksFolder = normalizePath(v || "Books"); await save(); }));

		new Setting(card()).setName("Check-in").setDesc("Fields saved as properties, so Bases can chart and query them. Hidden when all are off.");
		const fields: Array<[keyof CheckInFields, string]> = [
			["rating", "Day rating (1–10)"], ["sleep", "Sleep (hours)"], ["exercise", "Exercise"], ["food", "Food (breakfast, lunch, dinner)"], ["tags", "Tags"],
		];
		for (const [key, name] of fields) {
			sub(new Setting(group).setName(name))
				.addToggle((t) => t.setValue(s.fields[key]).onChange(async (v) => { s.fields[key] = v; await save(); }));
		}

		new Setting(card())
			.setName("On this day")
			.setDesc("Links to entries from the same date in earlier months and years.")
			.addToggle((t) => t.setValue(s.showOnThisDay).onChange(async (v) => { s.showOnThisDay = v; await save(); }));

		new Setting(containerEl).setName("Appearance").setHeading();
		new Setting(containerEl)
			.setName("Hide title and properties in entries")
			.setDesc("The cards already show the date and check-in data.")
			.addToggle((t) => t.setValue(s.hideNoteChrome).onChange(async (v) => { s.hideNoteChrome = v; await save(); }));

		new Setting(containerEl).setName("Existing entries").setHeading();
		new Setting(containerEl)
			.setName("Apply to existing entries")
			.setDesc("Settings above only apply to new entries. This updates older entries to match them: cards, weather, check-in fields and whether the title and Properties show, and gives entries without a location the default one. Your writing and headings aren't changed.")
			.addButton((b) => b.setButtonText("Apply…").onClick(async () => {
				const files = await this.plugin.entriesNeedingLayout();
				if (!files.length) { new Notice("All entries already match the current settings."); return; }
				const n = files.length;
				new ConfirmModal(this.app, "Apply to existing entries",
					`This updates ${n} entr${n === 1 ? "y" : "ies"} to the current settings. Your writing and headings aren't changed.`,
					"Update", () => { void this.plugin.applyLayoutToEntries(files); }).open();
			}));
	}
}
