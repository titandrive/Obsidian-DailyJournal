export interface Place {
	name: string;
	lat: number;
	lon: number;
	tz: string;
}

/** A writing prompt in new entries. Level 0 is a ## heading, 1 is ###, and so on. */
export interface Prompt {
	text: string;
	level: number;
}

export const MAX_PROMPT_LEVEL = 3;

export interface CheckInFields {
	rating: boolean;
	sleep: boolean;
	exercise: boolean;
	food: boolean;
	tags: boolean;
}

export interface JournalSettings {
	folder: string;
	dateFormat: string;
	home: Place;
	showWeather: boolean;
	units: "f" | "c";
	booksFolder: string;
	showReading: boolean;
	showOnThisDay: boolean;
	fields: CheckInFields;
	prompts: Prompt[];
	fillNewEntries: boolean;
	useAsDailyTemplate: boolean;
	hideNoteChrome: boolean;
}

export const DEFAULT_SETTINGS: JournalSettings = {
	folder: "Daily Notes",
	dateFormat: "YYYY/MMM/MM-DD-YY",
	home: { name: "Los Angeles", lat: 34.05223, lon: -118.24368, tz: "America/Los_Angeles" },
	showWeather: true,
	units: "f",
	booksFolder: "Books",
	showReading: true,
	showOnThisDay: true,
	fields: { rating: true, sleep: true, exercise: true, food: true, tags: true },
	prompts: [
		{ text: "How was your day?", level: 0 },
		{ text: "What was the best part of your day?", level: 1 },
		{ text: "What was the worst part of your day?", level: 1 },
	],
	fillNewEntries: true,
	useAsDailyTemplate: true,
	hideNoteChrome: true,
};
