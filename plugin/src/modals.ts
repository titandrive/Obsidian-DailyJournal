import { App, Modal, moment } from "obsidian";
import { Moment } from "./dates";
import { Place } from "./settings";
import { PlaceResult, searchPlaces } from "./weather";

/** Month calendar for choosing a date. Days that already have an entry are marked (and can't be picked unless allowTaken). */
export class MonthPicker extends Modal {
	private month: Moment;

	constructor(
		app: App,
		private current: Moment | null,
		private isTaken: (date: Moment) => boolean,
		private onPick: (date: Moment) => void,
		private options: { title?: string; allowTaken?: boolean } = {},
	) {
		super(app);
		this.month = (current ?? moment()).clone().startOf("month");
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal");
		this.titleEl.setText(this.options.title ?? "Move entry to…");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const head = contentEl.createDiv({ cls: "dj-picker-head" });
		head.createEl("button", { text: "‹", attr: { "aria-label": "Previous month" } }).onclick = () => { this.month.subtract(1, "month"); this.render(); };
		head.createDiv({ cls: "dj-picker-month", text: this.month.format("MMMM YYYY") });
		head.createEl("button", { text: "›", attr: { "aria-label": "Next month" } }).onclick = () => { this.month.add(1, "month"); this.render(); };

		const grid = contentEl.createDiv({ cls: "dj-picker-grid" });
		for (const d of moment.weekdaysMin()) grid.createDiv({ cls: "dj-picker-dow", text: d });
		for (let i = 0; i < this.month.day(); i++) grid.createDiv();

		const today = moment();
		for (const day = this.month.clone(); day.isSame(this.month, "month"); day.add(1, "day")) {
			const date = day.clone();
			const btn = grid.createEl("button", { cls: "dj-picker-day", text: String(date.date()) });
			if (date.isSame(today, "day")) btn.addClass("is-today");
			if (this.current && date.isSame(this.current, "day")) {
				btn.addClass("is-current");
				btn.disabled = true;
				continue;
			}
			if (this.isTaken(date)) {
				btn.addClass("has-entry");
				btn.setAttr("aria-label", "Already has an entry");
				if (!this.options.allowTaken) {
					btn.disabled = true;
					continue;
				}
			}
			btn.onclick = () => { this.close(); this.onPick(date); };
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** City search. Calls onChoose with a place, or with null for "back to home" (when offered). */
export class PlaceModal extends Modal {
	private timer = 0;
	private latest = "";

	constructor(app: App, private home: Place | null, private onChoose: (place: Place | null) => void, private title = "Change location") {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal");
		this.titleEl.setText(this.title);
		const input = this.contentEl.createEl("input", { cls: "dj-place-input", type: "text", attr: { placeholder: "Search for a city…" } });
		const results = this.contentEl.createDiv({ cls: "dj-place-results" });

		const showHome = () => {
			results.empty();
			if (!this.home) return;
			const back = results.createEl("button", { cls: "dj-place-option", text: `↺ Back to ${this.home.name}` });
			back.onclick = () => { this.close(); this.onChoose(null); };
		};
		const show = (places: PlaceResult[]) => {
			showHome();
			if (!places.length) results.createDiv({ cls: "dj-place-empty", text: "No matching places" });
			for (const place of places) {
				const opt = results.createEl("button", { cls: "dj-place-option" });
				opt.createSpan({ text: place.name });
				opt.createSpan({ cls: "dj-place-detail", text: place.detail });
				opt.onclick = () => {
					this.close();
					this.onChoose({ name: place.name, lat: place.lat, lon: place.lon, tz: place.tz });
				};
			}
		};

		showHome();
		input.addEventListener("input", () => {
			window.clearTimeout(this.timer);
			const q = input.value.trim();
			if (q.length < 2) { showHome(); return; }
			this.timer = window.setTimeout(async () => {
				this.latest = q;
				let places: PlaceResult[] = [];
				try { places = await searchPlaces(q); } catch { /* offline */ }
				if (this.latest === q) show(places); // ignore results from an older search
			}, 300);
		});
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		window.clearTimeout(this.timer);
		this.contentEl.empty();
	}
}
