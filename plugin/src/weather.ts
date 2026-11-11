import { requestUrl } from "obsidian";
import { Moment } from "./dates";
import { Place } from "./settings";

/** The entry's own location (set while traveling), or the home location. */
export function entryPlace(fm: Record<string, unknown> | undefined, home: Place): Place {
	if (fm && fm.location && fm.latitude != null && fm.longitude != null) {
		return {
			name: String(fm.location),
			lat: Number(fm.latitude),
			lon: Number(fm.longitude),
			tz: typeof fm.timezone === "string" && fm.timezone ? fm.timezone : "auto",
		};
	}
	return home;
}

/** Whether an entry has its own location (vs. using home). */
export function hasOwnPlace(fm: Record<string, unknown> | undefined): boolean {
	return !!(fm && fm.location && fm.latitude != null && fm.longitude != null);
}

const CONDITIONS: Array<[number, string, string]> = [
	[0, "☀", "Clear"], [2, "🌤", "Partly cloudy"], [3, "☁", "Overcast"], [48, "🌫", "Fog"],
	[57, "🌦", "Drizzle"], [67, "🌧", "Rain"], [77, "🌨", "Snow"], [82, "🌧", "Showers"],
	[86, "🌨", "Snow showers"], [Infinity, "⛈", "Thunderstorm"],
];

/** One line of weather for a day at a place, e.g. "🌤 Partly cloudy · H 84° / L 60°". Null on failure. */
export async function fetchWeather(place: Place, date: Moment, units: "f" | "c"): Promise<string | null> {
	try {
		const day = date.format("YYYY-MM-DD");
		const res = await requestUrl({
			url: `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
				"&daily=weather_code,temperature_2m_max,temperature_2m_min" +
				`&temperature_unit=${units === "f" ? "fahrenheit" : "celsius"}` +
				`&timezone=${encodeURIComponent(place.tz)}&start_date=${day}&end_date=${day}`,
		});
		const w = res.json.daily;
		const code: number = w.weather_code[0];
		const [, icon, label] = CONDITIONS.find(([max]) => code <= max) ?? CONDITIONS[CONDITIONS.length - 1];
		return `${icon} ${label} · H ${Math.round(w.temperature_2m_max[0])}° / L ${Math.round(w.temperature_2m_min[0])}°`;
	} catch {
		return null; // offline, or the date is outside the forecast/history range
	}
}

export interface PlaceResult extends Place {
	detail: string;
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
	const res = await requestUrl({
		url: `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=${encodeURIComponent(query)}`,
	});
	const results: Array<Record<string, unknown>> = res.json.results ?? [];
	return results.map((r) => ({
		name: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : null].filter(Boolean).join(", "),
		detail: String(r.country ?? ""),
		lat: Number(r.latitude),
		lon: Number(r.longitude),
		tz: typeof r.timezone === "string" && r.timezone ? r.timezone : "auto",
	}));
}

// Lucide "map-pin-pen" (ISC license), inlined since Obsidian's bundled icon set may not include it.
export const PIN_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" ' +
	'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
	'<path d="M17.97 9.304A8 8 0 0 0 2 10c0 4.69 4.887 9.562 7.022 11.468"/>' +
	'<path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>' +
	'<circle cx="10" cy="10" r="3"/></svg>';
