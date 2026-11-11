import { App, Modal, moment, setIcon } from "obsidian";
import { Moment } from "./dates";
import { MAX_PROMPT_LEVEL, Place, Prompt } from "./settings";
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

/** Edit writing prompts: reorder by dragging, set heading level with indent/outdent, add and remove. */
export class PromptsModal extends Modal {
	private items: Prompt[];
	private list!: HTMLElement;

	constructor(app: App, prompts: Prompt[], private onSave: (prompts: Prompt[]) => void) {
		super(app);
		this.items = prompts.map((p) => ({ ...p }));
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal", "dj-prompts-modal");
		this.titleEl.setText("Writing prompts");
		this.contentEl.createDiv({ cls: "dj-prompts-hint", text: "Drag to reorder. Indent to make a prompt a sub-heading of the one above." });
		this.list = this.contentEl.createDiv({ cls: "dj-prompts" });

		const add = this.contentEl.createEl("button", { cls: "dj-prompt-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: "Add prompt" });
		add.onclick = () => {
			this.items.push({ text: "", level: this.items[this.items.length - 1]?.level ?? 0 });
			this.render();
			this.list.querySelector<HTMLInputElement>(".dj-prompt-row:last-child input")?.focus();
		};

		const footer = this.contentEl.createDiv({ cls: "dj-prompts-footer" });
		footer.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		const save = footer.createEl("button", { cls: "mod-cta", text: "Save" });
		save.onclick = () => {
			this.onSave(this.items.map((p) => ({ text: p.text.trim(), level: p.level })).filter((p) => p.text));
			this.close();
		};

		this.render();
	}

	private render(): void {
		this.list.empty();
		this.items.forEach((item, index) => {
			const row = this.list.createDiv({ cls: "dj-prompt-row" });
			row.style.setProperty("--dj-level", String(item.level));

			const handle = row.createDiv({ cls: "dj-prompt-handle", attr: { "aria-label": "Drag to reorder" } });
			setIcon(handle, "grip-vertical");
			handle.addEventListener("pointerdown", (e) => this.startDrag(e, row, item));

			row.createSpan({ cls: "dj-prompt-level", text: "#".repeat(2 + item.level) });
			const input = row.createEl("input", { type: "text", attr: { placeholder: "Prompt" } });
			input.value = item.text;
			input.addEventListener("input", () => { item.text = input.value; });

			const button = (icon: string, label: string, disabled: boolean, run: () => void) => {
				const b = row.createEl("button", { cls: "dj-prompt-btn", attr: { "aria-label": label } });
				setIcon(b, icon);
				b.disabled = disabled;
				b.onclick = run;
			};
			button("indent-decrease", "Outdent", item.level === 0, () => { item.level--; this.render(); });
			button("indent-increase", "Indent", item.level >= MAX_PROMPT_LEVEL, () => { item.level++; this.render(); });
			button("minus", "Remove", false, () => { this.items.splice(index, 1); this.render(); });
		});
	}

	/** Pointer-based dragging (works with mouse and touch): rows move live, order is read back on release. */
	private startDrag(e: PointerEvent, row: HTMLElement, item: Prompt): void {
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		row.addClass("is-dragging");
		const rowItem = new Map<HTMLElement, Prompt>();
		Array.from(this.list.children).forEach((el, i) => rowItem.set(el as HTMLElement, this.items[i]));

		const move = (ev: PointerEvent) => {
			const others = Array.from(this.list.children).filter((el) => el !== row) as HTMLElement[];
			const before = others.find((el) => {
				const r = el.getBoundingClientRect();
				return ev.clientY < r.top + r.height / 2;
			});
			if (before) this.list.insertBefore(row, before);
			else this.list.appendChild(row);
		};
		const end = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
			row.removeClass("is-dragging");
			this.items = Array.from(this.list.children).map((el) => rowItem.get(el as HTMLElement) ?? item);
			this.render();
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** A yes/no confirmation. */
export class ConfirmModal extends Modal {
	constructor(app: App, private heading: string, private message: string, private confirmText: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("dj-modal");
		this.titleEl.setText(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		const footer = this.contentEl.createDiv({ cls: "dj-prompts-footer" });
		footer.createEl("button", { text: "Cancel" }).onclick = () => this.close();
		footer.createEl("button", { cls: "mod-cta", text: this.confirmText }).onclick = () => { this.close(); this.onConfirm(); };
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
