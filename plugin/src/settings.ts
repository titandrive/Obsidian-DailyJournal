export interface Place {
	name: string;
	lat: number;
	lon: number;
	tz: string;
}

export interface CheckInFields {
	rating: boolean;
	sleep: boolean;
	exercise: boolean;
	food: boolean;
}

export interface JournalSettings {
	folder: string;
	dateFormat: string;
	home: Place;
	units: "f" | "c";
	booksFolder: string;
	showReading: boolean;
	fields: CheckInFields;
	prompts: string[];
	fillNewEntries: boolean;
	useAsDailyTemplate: boolean;
	hideNoteChrome: boolean;
}

export const DEFAULT_SETTINGS: JournalSettings = {
	folder: "Daily Notes",
	dateFormat: "YYYY/MMM/MM-DD-YY",
	home: { name: "Los Angeles", lat: 34.05223, lon: -118.24368, tz: "America/Los_Angeles" },
	units: "f",
	booksFolder: "Books",
	showReading: true,
	fields: { rating: true, sleep: true, exercise: true, food: true },
	prompts: [
		"How was your day?",
		"What was the best part of your day?",
		"What was the worst part of your day?",
	],
	fillNewEntries: true,
	useAsDailyTemplate: true,
	hideNoteChrome: true,
};
