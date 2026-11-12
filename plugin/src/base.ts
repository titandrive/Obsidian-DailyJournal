import { JournalSettings } from "./settings";

/*
 * The Journal base: a table of every entry (and a By month view) built from the properties the
 * cards save. The plugin keeps it in the journal folder and rewrites it when settings change.
 */

export const BASE_NAME = "Journal.base";
export const ICONS_FOLDER = "Weather Icons";

/** Weather labels (as saved by the header) and their icon files, longest label first. */
const SKY: Array<[string, string]> = [
	["Partly cloudy", "partly-cloudy"], ["Snow showers", "snow-showers"], ["Thunderstorm", "thunderstorm"],
	["Overcast", "overcast"], ["Drizzle", "drizzle"], ["Showers", "showers"], ["Clear", "clear"],
	["Rain", "rain"], ["Snow", "snow"], ["Fog", "fog"],
];

export const SKY_ICONS = SKY.map(([, icon]) => icon);

const q = (s: string) => JSON.stringify(s);

/**
 * A Bases expression for the entry's date, read from its file name. Works when the file name part
 * of the date format uses fixed-width numbers (YYYY, YY, MM, DD) and literal separators, e.g.
 * MM-DD-YY or YYYY-MM-DD. Otherwise falls back to the file's creation time.
 */
function dateFormula(dateFormat: string): string {
	const name = dateFormat.split("/").pop() ?? dateFormat;
	const parts: Record<string, string> = {};
	let i = 0;
	for (const token of name.match(/YYYY|YY|MM|DD|\[[^\]]*\]|[A-Za-z]+|[^A-Za-z[]+/g) ?? []) {
		if (token === "YYYY") parts.year = `file.name.slice(${i}, ${i + 4})`;
		else if (token === "YY") parts.year = `"20" + file.name.slice(${i}, ${i + 2})`;
		else if (token === "MM") parts.month = `file.name.slice(${i}, ${i + 2})`;
		else if (token === "DD") parts.day = `file.name.slice(${i}, ${i + 2})`;
		else if (/^[A-Za-z]/.test(token)) return "file.ctime"; // a name or variable-width token
		i += token.startsWith("[") ? token.length - 2 : token.length;
	}
	if (!parts.year || !parts.month || !parts.day) return "file.ctime";
	return `date(${parts.year} + "-" + ${parts.month} + "-" + ${parts.day})`;
}

/** The base's YAML for the current settings. */
export function journalBase(settings: JournalSettings): string {
	const folder = settings.folder.replace(/\/+$/, "") || "/";
	const icons = `${folder === "/" ? "" : folder + "/"}${ICONS_FOLDER}`;
	const f = settings.fields;

	const columns: Array<[string, string]> = [["formula.day", "Day"], ["formula.place", "Location"]];
	if (settings.showWeather) columns.push(["formula.sky", " "], ["weather", "Weather"]);
	if (f.rating) columns.push(["day_rating", "Rating"]);
	if (f.sleep) columns.push(["sleep", "Sleep (h)"]);
	if (f.work) columns.push(["worked", "Worked"]);
	if (f.exercise) columns.push(["exercise", "Exercised"], ["exercise_note", "Exercise"]);
	if (f.food) columns.push(["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"]);
	if (settings.showReading) columns.push(["books", "Book"], ["pages_read", "Pages"]);
	const monthly = ["formula.day", ...columns.map(([k]) => k).filter((k) => ["day_rating", "sleep", "worked", "exercise", "pages_read"].includes(k))];
	const summaries = [
		f.rating ? "day_rating: Average" : "", f.sleep ? "sleep: Average" : "", settings.showReading ? "pages_read: Sum" : "",
	].filter(Boolean);

	let sky = q("");
	for (const [label, icon] of [...SKY].reverse()) sky = `if(weather.startsWith(${q(label)}), image(${q(`${icons}/${icon}.svg`)}), ${sky})`;

	const lines = [
		"filters:", "  and:",
		folder === "/" ? "    - true" : `    - file.inFolder(${q(folder)})`,
		`    - file.ext == "md"`,
		"formulas:",
		`  entry_date: ${dateFormula(settings.dateFormat)}`,
		`  day: file.asLink(formula.entry_date.format("ddd, MMM D"))`,
		`  place: if(location, location, ${q(settings.home.name)})`,
		...(settings.showWeather ? [`  sky: if(weather, ${sky}, "")`] : []),
		`  month: formula.entry_date.format("YYYY · MMMM")`,
		"properties:",
		"  formula.month:", "    displayName: Month",
		// Plain names unquoted, the way Obsidian writes them when it saves the base.
		...columns.flatMap(([k, name]) => [`  ${k}:`, `    displayName: ${/^[A-Za-z][\w ()%.-]*$/.test(name) ? name : q(name)}`]),
		"views:",
		"  - type: table", "    name: Journal", "    order:",
		...columns.map(([k]) => `      - ${k}`),
		"    sort:", "      - property: formula.entry_date", "        direction: DESC",
		...(summaries.length ? ["    summaries:", ...summaries.map((s) => "      " + s)] : []),
		"  - type: table", "    name: By month",
		"    groupBy:", "      property: formula.month", "      direction: DESC",
		"    order:", ...monthly.map((k) => `      - ${k}`),
		"    sort:", "      - property: formula.entry_date", "        direction: DESC",
		...(summaries.length ? ["    summaries:", ...summaries.map((s) => "      " + s)] : []),
	];
	return lines.join("\n") + "\n";
}
