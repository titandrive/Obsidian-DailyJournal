import { BasesView, QueryController, TFile } from "obsidian";
import { entryDate, Moment } from "./dates";
import { JournalSettings } from "./settings";

/*
 * The Trends view: a Bases view type that summarizes the entries the base shows (so the base's
 * filters and search narrow it too). Reads each entry's properties straight from its frontmatter.
 */

export const TRENDS_VIEW = "journal-trends";

type Frontmatter = Record<string, unknown>;
interface Day { file: TFile; date: Moment; fm: Frontmatter }
interface Row { label: string; value: number; text: string; hint?: string }

const num = (v: unknown): number | null => {
	const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
	return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const one = (n: number) => (Math.round(n * 10) / 10).toString();
const times = (n: number) => `${n}×`;

/** Values counted case-insensitively, each shown with its most used spelling, most frequent first. */
function ranked(values: string[], limit: number): Row[] {
	const counts = new Map<string, { n: number; spellings: Map<string, number> }>();
	for (const text of values) {
		if (!text) continue;
		const c = counts.get(text.toLowerCase()) ?? { n: 0, spellings: new Map<string, number>() };
		c.n++;
		c.spellings.set(text, (c.spellings.get(text) ?? 0) + 1);
		counts.set(text.toLowerCase(), c);
	}
	return [...counts.values()]
		.map((c) => ({ n: c.n, label: [...c.spellings].sort((a, b) => b[1] - a[1])[0][0] }))
		.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
		.slice(0, limit)
		.map((c) => ({ label: c.label, value: c.n, text: times(c.n) }));
}

/** Average day rating for each group of days, in the order the groups are given. */
function ratingBy(days: Day[], groups: Array<[string, (d: Day) => boolean]>): Row[] {
	const rows: Row[] = [];
	for (const [label, test] of groups) {
		const r = days.filter(test).map((d) => num(d.fm.day_rating)).filter((n): n is number => n !== null);
		if (r.length) rows.push({ label, value: mean(r), text: one(mean(r)), hint: `${r.length} day${r.length === 1 ? "" : "s"}` });
	}
	return rows;
}

export class TrendsView extends BasesView {
	type = TRENDS_VIEW;

	constructor(controller: QueryController, private el: HTMLElement, private settings: () => JournalSettings) {
		super(controller);
		el.addClass("dj-trends-host");
	}

	onDataUpdated(): void {
		const days: Day[] = [];
		for (const entry of this.data.data) {
			const date = entryDate(this.settings(), entry.file);
			if (!date) continue;
			days.push({ file: entry.file, date, fm: (this.app.metadataCache.getFileCache(entry.file)?.frontmatter ?? {}) as Frontmatter });
		}
		days.sort((a, b) => a.date.valueOf() - b.date.valueOf());
		this.render(days);
	}

	private render(days: Day[]): void {
		const el = this.el;
		el.empty();
		const root = el.createDiv({ cls: "dj-trends" });
		if (!days.length) {
			root.createDiv({ cls: "dj-trends-empty", text: "No journal entries match this base's filters." });
			return;
		}

		const ratings = days.map((d) => num(d.fm.day_rating)).filter((n): n is number => n !== null);
		const sleeps = days.map((d) => num(d.fm.sleep)).filter((n): n is number => n !== null);
		const exercised = days.filter((d) => typeof d.fm.exercise === "boolean");
		const pages = days.reduce((sum, d) => sum + (num(d.fm.pages_read) ?? 0), 0);
		const { current, longest } = streaks(days);

		const tiles = root.createDiv({ cls: "dj-trends-tiles" });
		const tile = (label: string, value: string, hint?: string) => {
			const t = tiles.createDiv({ cls: "dj-trends-tile" });
			t.createDiv({ cls: "dj-trends-tile-value", text: value });
			t.createDiv({ cls: "dj-trends-tile-label", text: label });
			if (hint) t.createDiv({ cls: "dj-trends-tile-hint", text: hint });
		};
		tile("Entries", String(days.length), `${days[0].date.format("MMM D, YYYY")} – ${days[days.length - 1].date.format("MMM D, YYYY")}`);
		tile("Streak", `${current} day${current === 1 ? "" : "s"}`, `Longest ${longest}`);
		if (ratings.length) tile("Avg. day rating", one(mean(ratings)), "out of 10");
		if (sleeps.length) tile("Avg. sleep", `${one(mean(sleeps))} h`);
		if (exercised.length) tile("Exercised", `${Math.round(100 * exercised.filter((d) => d.fm.exercise).length / exercised.length)}%`, "of days");
		if (pages) tile("Pages read", pages.toLocaleString());

		const grid = root.createDiv({ cls: "dj-trends-grid" });
		const card = (title: string, note?: string) => {
			const c = grid.createDiv({ cls: "dj-trends-card" });
			const head = c.createDiv({ cls: "dj-trends-card-head" });
			head.createDiv({ cls: "dj-trends-card-title", text: title });
			if (note) head.createDiv({ cls: "dj-trends-card-note", text: note });
			return c;
		};

		const recent = days.filter((d) => !d.date.isBefore(days[days.length - 1].date.clone().subtract(89, "days"), "day"));
		lineChart(card("Day rating", "Last 90 days · line is the 7-day average"), recent, (d) => num(d.fm.day_rating), 10);
		lineChart(card("Sleep", "Last 90 days · hours · line is the 7-day average"), recent, (d) => num(d.fm.sleep), 12);

		const meals = ranked(days.flatMap((d) => ["breakfast", "lunch", "dinner"].map((k) => str(d.fm[k]))), 10);
		if (meals.length) barList(card("Most eaten", "Breakfast, lunch and dinner"), meals);

		const weekday = ratingBy(days, [1, 2, 3, 4, 5, 6, 0].map((w) => [days[0].date.clone().day(w).format("dddd"), (d: Day) => d.date.day() === w]));
		if (weekday.length) barList(card("Day rating by weekday"), weekday, 10);

		const good: Row[] = [
			...ratingBy(days, [["Exercised", (d) => d.fm.exercise === true], ["Didn't exercise", (d) => d.fm.exercise === false]]),
			...ratingBy(days, [
				["Under 6 h sleep", (d) => (num(d.fm.sleep) ?? 99) < 6],
				["6–7 h sleep", (d) => { const s = num(d.fm.sleep); return s !== null && s >= 6 && s < 7; }],
				["7–8 h sleep", (d) => { const s = num(d.fm.sleep); return s !== null && s >= 7 && s < 8; }],
				["8 h+ sleep", (d) => (num(d.fm.sleep) ?? -1) >= 8],
				["Worked", (d) => d.fm.worked === true], ["Day off", (d) => d.fm.worked === false],
			]),
		];
		if (good.length) barList(card("What goes with good days", "Average day rating"), good, 10);

		const skies = [...new Set(days.map((d) => sky(d.fm)).filter(Boolean))];
		const byWeather = ratingBy(days, skies.map((s) => [s, (d: Day) => sky(d.fm) === s])).sort((a, b) => b.value - a.value);
		if (byWeather.length > 1) barList(card("Day rating by weather"), byWeather, 10);

		const months = new Map<string, number>();
		for (const d of days) {
			const p = num(d.fm.pages_read);
			if (p) months.set(d.date.format("YYYY-MM"), (months.get(d.date.format("YYYY-MM")) ?? 0) + p);
		}
		if (months.size) {
			const rows = [...months].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
				.map(([m, n]) => ({ label: window.moment(m, "YYYY-MM").format("MMMM YYYY"), value: n, text: n.toLocaleString() }));
			const c = card("Pages read by month");
			barList(c, rows);
			const finished = days.flatMap((d) => finishedBooks(d.fm).map((title) => ({ title, date: d.date })));
			if (finished.length) {
				c.createDiv({ cls: "dj-trends-subhead", text: "Finished" });
				const list = c.createDiv({ cls: "dj-trends-books" });
				for (const b of finished.reverse()) {
					const row = list.createDiv({ cls: "dj-trends-book" });
					row.createSpan({ text: b.title });
					row.createSpan({ cls: "dj-trends-muted", text: b.date.format("MMM D, YYYY") });
				}
			}
		}

		const artists = ranked(days.map((d) => str(d.fm.artist)), 8);
		if (artists.length) barList(card("Top artists", "Earworm of the day"), artists);
	}
}

/** "Clear · H 68° / L 47°" → "Clear" */
function sky(fm: Frontmatter): string {
	return str(fm.weather).split("·")[0].trim();
}

function finishedBooks(fm: Frontmatter): string[] {
	const books = (fm.reading as { books?: unknown } | undefined)?.books;
	if (!Array.isArray(books)) return [];
	return books.filter((b) => b && b.finished === true && str(b.title)).map((b) => str(b.title));
}

/** Days in a row with an entry: ending today (or yesterday, if today's isn't written yet), and the longest run. */
function streaks(days: Day[]): { current: number; longest: number } {
	const keys = new Set(days.map((d) => d.date.format("YYYY-MM-DD")));
	let longest = 0, run = 0, prev: Moment | null = null;
	for (const d of days) {
		run = prev && d.date.diff(prev, "days") === 1 ? run + 1 : prev && d.date.isSame(prev, "day") ? run : 1;
		longest = Math.max(longest, run);
		prev = d.date;
	}
	const day = window.moment().startOf("day");
	if (!keys.has(day.format("YYYY-MM-DD"))) day.subtract(1, "day");
	let current = 0;
	while (keys.has(day.format("YYYY-MM-DD"))) { current++; day.subtract(1, "day"); }
	return { current, longest };
}

/** Labelled horizontal bars; `max` fixes the scale (e.g. 10 for ratings), otherwise the largest value fills the track. */
function barList(el: HTMLElement, rows: Row[], max?: number): void {
	const top = max ?? Math.max(...rows.map((r) => r.value));
	const list = el.createDiv({ cls: "dj-trends-bars" });
	for (const r of rows) {
		const row = list.createDiv({ cls: "dj-trends-bar-row", attr: r.hint ? { "aria-label": r.hint } : {} });
		row.createDiv({ cls: "dj-trends-bar-label", text: r.label });
		row.createDiv({ cls: "dj-trends-bar-track" }).createDiv({ cls: "dj-trends-bar-fill" }).style.width = `${Math.max(2, (100 * r.value) / (top || 1))}%`;
		row.createDiv({ cls: "dj-trends-bar-value", text: r.text });
	}
}

/** Each day's value as a dot, with the 7-day average as a line. Hover a dot for its date and value. */
function lineChart(el: HTMLElement, days: Day[], value: (d: Day) => number | null, yMax: number): void {
	const pts = days.map((d) => ({ d, v: value(d) })).filter((p): p is { d: Day; v: number } => p.v !== null);
	if (pts.length < 2) { el.remove(); return; }
	const W = 600, H = 160, L = 26, R = 8, T = 8, B = 22;
	const start = pts[0].d.date, span = Math.max(1, pts[pts.length - 1].d.date.diff(start, "days"));
	const top = Math.max(yMax, ...pts.map((p) => p.v));
	const x = (m: Moment) => L + ((W - L - R) * m.diff(start, "days")) / span;
	const y = (v: number) => T + (H - T - B) * (1 - v / top);

	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
	svg.setAttribute("class", "dj-trends-chart");
	const add = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
		const node = document.createElementNS(ns, tag);
		for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
		parent.appendChild(node);
		return node;
	};
	for (const v of [0, top / 2, top]) {
		add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "dj-trends-grid-line" });
		add("text", { x: L - 6, y: y(v) + 4, class: "dj-trends-axis", "text-anchor": "end" }).textContent = one(v);
	}
	add("text", { x: L, y: H - 4, class: "dj-trends-axis" }).textContent = start.format("MMM D");
	add("text", { x: W - R, y: H - 4, class: "dj-trends-axis", "text-anchor": "end" }).textContent = pts[pts.length - 1].d.date.format("MMM D");

	const avg = pts.map((p) => {
		const win = pts.filter((q) => !q.d.date.isAfter(p.d.date, "day") && p.d.date.diff(q.d.date, "days") < 7);
		return `${x(p.d.date).toFixed(1)},${y(mean(win.map((q) => q.v))).toFixed(1)}`;
	});
	add("polyline", { points: avg.join(" "), class: "dj-trends-line" });
	for (const p of pts) {
		const g = add("g", { class: "dj-trends-dot" });
		add("circle", { cx: x(p.d.date), cy: y(p.v), r: 9, class: "dj-trends-hit" }, g);
		add("circle", { cx: x(p.d.date), cy: y(p.v), r: 3 }, g);
		add("title", {}, g).textContent = `${p.d.date.format("ddd, MMM D")}: ${one(p.v)}`;
	}
	el.appendChild(svg);
}
