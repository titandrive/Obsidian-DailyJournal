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
/** What was eaten for a meal, or "" if nothing was written or it was skipped. */
const mealText = (fm: Frontmatter, key: string): string => (skippedMeals(fm).includes(key) || /^skip(ped)?$/i.test(str(fm[key])) ? "" : str(fm[key]));
/** Meals marked skipped (the skipped_meals list, or older entries where "skipped" was typed in). */
function skippedMeals(fm: Frontmatter): string[] {
	const s = fm.skipped_meals;
	const listed = (Array.isArray(s) ? s : s ? [s] : []).map((x) => String(x).toLowerCase());
	return ["breakfast", "lunch", "dinner"].filter((k) => listed.includes(k) || /^skip(ped)?$/i.test(str(fm[k])));
}
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

		// Sections, each with a heading, a row of number tiles and/or a grid of cards. Empty ones are dropped.
		const section = (title: string) => {
			const el = root.createDiv({ cls: "dj-trends-section" });
			el.createDiv({ cls: "dj-trends-section-title", text: title });
			let tiles: HTMLElement | null = null, grid: HTMLElement | null = null;
			return {
				el,
				/** `unit`: small text on the same line as the value, e.g. "of days". */
				tile(label: string, value: string, hint?: string, unit?: string) {
					tiles ??= el.createDiv({ cls: "dj-trends-tiles" });
					const t = tiles.createDiv({ cls: "dj-trends-tile" });
					const v = t.createDiv({ cls: "dj-trends-tile-value", text: value });
					if (unit) v.createSpan({ cls: "dj-trends-tile-unit", text: unit });
					t.createDiv({ cls: "dj-trends-tile-label", text: label });
					if (hint) fitOneLine(t.createDiv({ cls: "dj-trends-tile-hint", text: hint }));
				},
				card(title: string, note?: string) {
					grid ??= el.createDiv({ cls: "dj-trends-grid" });
					const c = grid.createDiv({ cls: "dj-trends-card" });
					const head = c.createDiv({ cls: "dj-trends-card-head" });
					head.createDiv({ cls: "dj-trends-card-title", text: title });
					if (note) head.createDiv({ cls: "dj-trends-card-note", text: note });
					return c;
				},
			};
		};

		// Overview
		const overview = section("Overview");
		overview.tile("Entries", String(days.length), dateRange(days[0].date, days[days.length - 1].date));
		overview.tile("Streak", `${current} day${current === 1 ? "" : "s"}`, `Longest ${longest}`);
		if (ratings.length) overview.tile("Avg. day rating", one(mean(ratings)), "out of 10");
		if (sleeps.length) overview.tile("Avg. sleep", `${one(mean(sleeps))} h`);
		if (exercised.length) overview.tile("Exercised", `${Math.round(100 * exercised.filter((d) => d.fm.exercise).length / exercised.length)}%`, undefined, "of days");

		// Mood and sleep over time
		const moodSleep = section("Averages");
		const recent = days.filter((d) => !d.date.isBefore(days[days.length - 1].date.clone().subtract(89, "days"), "day"));
		lineChart(moodSleep.card("Day rating", "7-day average"), recent, (d) => num(d.fm.day_rating), 10);
		lineChart(moodSleep.card("Sleep", "7-day average"), recent, (d) => num(d.fm.sleep), 12);

		// What lines up with good and bad days
		const patterns = section("Good and bad days");
		const sleepIn = (lo: number, hi: number) => (d: Day) => { const s = num(d.fm.sleep); return s !== null && s >= lo && s < hi; };
		const SLEEP: Array<[string, (d: Day) => boolean]> = [
			["Under 6 h", sleepIn(0, 6)], ["6–7 h", sleepIn(6, 7)], ["7–8 h", sleepIn(7, 8)], ["8 h+", sleepIn(8, 99)],
		];
		const skies = [...new Set(days.map((d) => sky(d.fm)).filter(Boolean))];

		// What moves your rating: each thing's average rating on days with it, minus days without it.
		const factors: Array<[string, (d: Day) => boolean, (d: Day) => boolean]> = [
			["Exercised", (d) => d.fm.exercise === true, (d) => d.fm.exercise === false],
			["Day off", (d) => d.fm.worked === false, (d) => d.fm.worked === true],
			["Read", (d) => (num(d.fm.pages_read) ?? 0) > 0, (d) => !((num(d.fm.pages_read) ?? 0) > 0)],
			["Podcast day", (d) => d.fm.song_kind === "podcast", (d) => !!str(d.fm.song) && d.fm.song_kind !== "podcast"],
			...MEALS.map((k): [string, (d: Day) => boolean, (d: Day) => boolean] =>
				[`Skipped ${k}`, (d) => skippedMeals(d.fm).includes(k), (d) => !!mealText(d.fm, k)]),
			// Any meal skipped, compared with days where meals were logged and none skipped.
			["Skipped a meal", (d) => skippedMeals(d.fm).length > 0, (d) => skippedMeals(d.fm).length === 0 && MEALS.some((k) => !!mealText(d.fm, k))],
			...SLEEP.map(([label, test]): [string, (d: Day) => boolean, (d: Day) => boolean] =>
				[`Slept ${label.toLowerCase()}`, test, (d) => num(d.fm.sleep) !== null && !test(d)]),
			...skies.map((s): [string, (d: Day) => boolean, (d: Day) => boolean] =>
				[s, (d) => sky(d.fm) === s, (d) => !!sky(d.fm) && sky(d.fm) !== s]),
			...ranked(days.flatMap((d) => MEALS.map((k) => mealText(d.fm, k))), 50).filter((m) => m.value >= MIN_DAYS)
				.map((m): [string, (d: Day) => boolean, (d: Day) => boolean] => {
					const ate = (d: Day) => MEALS.some((k) => mealText(d.fm, k).toLowerCase() === m.label.toLowerCase());
					return [m.label, ate, (d) => !ate(d)];
				}),
		];
		const effects = factors.map(([label, withIt, withoutIt]) => {
			const a = days.filter(withIt).map((d) => num(d.fm.day_rating)).filter((n): n is number => n !== null);
			const b = days.filter(withoutIt).map((d) => num(d.fm.day_rating)).filter((n): n is number => n !== null);
			return a.length >= MIN_DAYS && b.length >= MIN_DAYS ? { label, diff: mean(a) - mean(b), n: a.length } : null;
		}).filter((x): x is { label: string; diff: number; n: number } => x !== null && Math.abs(x.diff) >= 0.1);
		const ups = effects.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 4);
		const downs = effects.filter((x) => x.diff < 0).sort((a, b) => b.diff - a.diff).slice(-4);
		if (ratings.length) {
			const c = patterns.card("What moves your rating", "How much higher or lower you rate days with each of these");
			c.addClass("dj-trends-wide");
			if (ups.length || downs.length) {
				diverging(c, [...ups, ...downs]);
				c.createDiv({ cls: "dj-trends-card-note dj-trends-foot", text: "Green means better days, orange means worse." });
			} else {
				c.createDiv({ cls: "dj-trends-muted", text: `Not enough rated days yet. Something shows up here once it has happened on at least ${MIN_DAYS} days and not happened on at least ${MIN_DAYS}.` });
			}
		}

		const byExercise = ratingBy(days, [["Exercised", (d) => d.fm.exercise === true], ["Didn't exercise", (d) => d.fm.exercise === false]]);
		if (byExercise.length) barList(patterns.card("Day rating by exercise", "Average day rating"), byExercise, 10);
		const bySleep = ratingBy(days, SLEEP);
		if (bySleep.length) barList(patterns.card("Day rating by sleep", "Average day rating"), bySleep, 10);
		const byWork = ratingBy(days, [["Worked", (d) => d.fm.worked === true], ["Day off", (d) => d.fm.worked === false]]);
		if (byWork.length) barList(patterns.card("Day rating by work", "Average day rating"), byWork, 10);
		const byWeather = ratingBy(days, skies.map((s) => [s, (d: Day) => sky(d.fm) === s])).sort((a, b) => b.value - a.value);
		if (byWeather.length > 1) barList(patterns.card("Day rating by weather", "Average day rating"), byWeather, 10);

		const rated = (test: (r: number) => boolean) => days.filter((d) => { const r = num(d.fm.day_rating); return r !== null && test(r); });
		if (ratings.length) {
			const c = patterns.card("Good vs bad days", "Good is above 5, bad is below 5");
			c.addClass("dj-trends-wide");
			goodVsBad(c, rated((r) => r >= GOOD_DAY), rated((r) => r <= BAD_DAY), days);
		}

		// Food
		const food = section("Food");
		// Skipped meals: how often each meal is skipped, out of the days that meal was filled in or skipped.
		const skipTotal = days.reduce((n, d) => n + skippedMeals(d.fm).length, 0);
		const skipRows: Row[] = MEALS.map((k) => {
			const pool = days.filter((d) => skippedMeals(d.fm).includes(k) || !!mealText(d.fm, k));
			const n = pool.filter((d) => skippedMeals(d.fm).includes(k)).length;
			const pct = pool.length ? Math.round((100 * n) / pool.length) : 0;
			return { label: k[0].toUpperCase() + k.slice(1), value: n, text: `${n}× · ${pct}%`, hint: `Skipped on ${n} of ${pool.length} days` };
		});
		// Any meal: days with at least one meal skipped, out of the days with any meal logged or skipped.
		const foodDays = days.filter((d) => skippedMeals(d.fm).length > 0 || MEALS.some((k) => !!mealText(d.fm, k)));
		const skipDays = foodDays.filter((d) => skippedMeals(d.fm).length > 0).length;
		const skipDayPct = foodDays.length ? Math.round((100 * skipDays) / foodDays.length) : 0;
		if (skipTotal) {
			// Most times skipped; a tie goes to the one skipped on a bigger share of its days.
			const pctOf = (r: Row) => Number(r.text.split(" · ")[1]?.replace("%", "") ?? 0);
			const most = [...skipRows].sort((a, b) => b.value - a.value || pctOf(b) - pctOf(a))[0];
			food.tile("Days with a skipped meal", `${skipDayPct}%`, `${skipDays} of ${foodDays.length} days`);
			food.tile("Meals skipped", String(skipTotal), `${one(skipTotal / days.length)} per day`);
			food.tile("Most skipped meal", most.label, `${most.text.split(" · ")[1]} of the time`);
		}
		const meals = ranked(days.flatMap((d) => MEALS.map((k) => mealText(d.fm, k))), 5);
		if (meals.length) barList(food.card("Favorite meals", "Breakfast, lunch and dinner"), meals);
		if (skipTotal) barList(food.card("Skipped meals", "Times skipped · share of days"), [
			...skipRows,
			{ label: "Any meal", value: skipDays, text: `${skipDays}× · ${skipDayPct}%`, hint: `Skipped a meal on ${skipDays} of ${foodDays.length} days` },
		]);

		// Reading
		const reading = section("Reading");
		const finished = days.flatMap((d) => finishedBooks(d.fm).map((title) => ({ title, date: d.date })));
		if (pages) {
			const readDays = days.filter((d) => (num(d.fm.pages_read) ?? 0) > 0).length;
			reading.tile("Pages read", pages.toLocaleString());
			reading.tile("Avg. pages per day", one(pages / readDays), "on days you read");
			reading.tile("Books finished", String(finished.length));
		}
		const months = new Map<string, number>();
		for (const d of days) {
			const p = num(d.fm.pages_read);
			if (p) months.set(d.date.format("YYYY-MM"), (months.get(d.date.format("YYYY-MM")) ?? 0) + p);
		}
		if (months.size) {
			const rows = [...months].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
				.map(([m, n]) => ({ label: window.moment(m, "YYYY-MM").format("MMMM YYYY"), value: n, text: n.toLocaleString() }));
			barList(reading.card("Pages read by month"), rows);
		}
		if (finished.length) {
			const list = reading.card("Finished").createDiv({ cls: "dj-trends-books" });
			for (const b of finished.reverse()) {
				const row = list.createDiv({ cls: "dj-trends-book" });
				row.createSpan({ text: b.title });
				row.createSpan({ cls: "dj-trends-muted", text: b.date.format("MMM D, YYYY") });
			}
		}

		// Music and podcasts, from the Earworm of the day card
		const listening = section("Listening");
		const podcast = (d: Day) => d.fm.song_kind === "podcast";
		const artists = ranked(days.filter((d) => !podcast(d)).map((d) => str(d.fm.artist)), 5);
		if (artists.length) barList(listening.card("Top artists"), artists);
		const shows = ranked(days.filter(podcast).map((d) => str(d.fm.artist)), 5);
		if (shows.length) barList(listening.card("Top podcasts"), shows);

		for (const s of [overview, moodSleep, patterns, food, reading, listening]) {
			if (s.el.childElementCount < 2 || !s.el.querySelector(".dj-trends-tile, .dj-trends-card")) s.el.remove();
		}
	}
}

const MEALS = ["breakfast", "lunch", "dinner"];
/** Highest day rating that counts as a bad day. */
const BAD_DAY = 4;

/** Fewest days a thing must appear on (and be missing from) to count in What moves your rating. */
const MIN_DAYS = 3;

/** Rating differences as bars from a center line: right for better days, left for worse. */
function diverging(el: HTMLElement, rows: Array<{ label: string; diff: number; n: number }>): void {
	const top = Math.max(...rows.map((r) => Math.abs(r.diff)));
	const grid = el.createDiv({ cls: "dj-trends-diverge" });
	for (const r of rows) {
		const row = grid.createDiv({ cls: "dj-trends-bar-row", attr: { "aria-label": `${r.n} day${r.n === 1 ? "" : "s"}` } });
		row.createDiv({ cls: "dj-trends-bar-label", text: r.label });
		const neg = row.createDiv({ cls: "dj-trends-diverge-neg" });
		const pos = row.createDiv({ cls: "dj-trends-diverge-pos" });
		const bar = (r.diff > 0 ? pos : neg).createDiv({ cls: r.diff > 0 ? "dj-trends-up" : "dj-trends-down" });
		bar.style.width = `${Math.max(4, (100 * Math.abs(r.diff)) / top)}%`;
		row.createDiv({ cls: "dj-trends-bar-value", text: `${r.diff > 0 ? "+" : "−"}${one(Math.abs(r.diff))}` });
	}
}

/** Days rated this or higher count as good days. */
const GOOD_DAY = 6;

/**
 * Good days, bad days and all days side by side: sleep, exercise, work, and the most common weather
 * and meal for each, so what sets good and bad days apart stands out.
 */
function goodVsBad(el: HTMLElement, good: Day[], bad: Day[], all: Day[]): void {
	const avgOf = (ds: Day[], key: string) => {
		const xs = ds.map((d) => num(d.fm[key])).filter((n): n is number => n !== null);
		return xs.length ? `${one(mean(xs))} h` : null;
	};
	const share = (ds: Day[], key: string) => {
		const known = ds.filter((d) => typeof d.fm[key] === "boolean");
		return known.length ? `${Math.round((100 * known.filter((d) => d.fm[key]).length) / known.length)}%` : null;
	};
	const top = (values: string[]) => ranked(values, 1)[0]?.label ?? null;
	const groups = [good, bad, all];

	const table = el.createDiv({ cls: "dj-trends-compare" });
	for (const cell of ["", "Good days", "Bad days", "All days"]) table.createDiv({ cls: "dj-trends-compare-head", text: cell });
	const row = (label: string, value: (ds: Day[]) => string | null) => {
		const cells = groups.map((ds) => (ds.length ? value(ds) : null));
		if (cells.every((c) => c === null)) return;
		table.createDiv({ text: label });
		cells.forEach((c, i) => table.createDiv({ cls: "dj-trends-compare-value" + (i === 2 ? " dj-trends-muted" : ""), text: c ?? "–" }));
	};
	row("Days", (ds) => String(ds.length));
	row("Sleep", (ds) => avgOf(ds, "sleep"));
	row("Exercised", (ds) => share(ds, "exercise"));
	row("Worked", (ds) => share(ds, "worked"));
	row("Most common weather", (ds) => top(ds.map((d) => sky(d.fm))));
	row("Skipped a meal", (ds) => `${Math.round((100 * ds.filter((d) => skippedMeals(d.fm).length > 0).length) / ds.length)}%`);
	row("Most common meal", (ds) => top(ds.flatMap((d) => MEALS.map((k) => mealText(d.fm, k)))));
}

/** "11/3/26–11/17/26": the full range, compact enough for a tile. */
function dateRange(from: Moment, to: Moment): string {
	return `${from.format("M/D/YY")}–${to.format("M/D/YY")}`;
}

/**
 * Keep a line of text on one line at its full length: when it's wider than its box, step the font
 * down until it fits. Rechecks whenever the box changes size.
 */
function fitOneLine(el: HTMLElement): void {
	const fit = () => {
		el.style.fontSize = "";
		let size = parseFloat(getComputedStyle(el).fontSize);
		while (el.scrollWidth > el.clientWidth + 0.5 && size > 8) {
			size -= 0.5;
			el.style.fontSize = `${size}px`;
		}
	};
	// Removing the tile counts as a size change, which is when the observer lets go.
	const watch = new ResizeObserver(() => (el.isConnected ? fit() : watch.disconnect()));
	watch.observe(el);
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
