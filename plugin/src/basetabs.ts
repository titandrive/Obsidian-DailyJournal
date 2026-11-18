import { Plugin, setIcon, View, WorkspaceLeaf } from "obsidian";

/*
 * Tab buttons for bases: one icon button per view (tab) in each base's toolbar, right after the views
 * menu, so switching tabs is one tap instead of opening that menu. (Not the pane header: themes and
 * snippets that move the status bar to the top can cover it.) Works on every base. Bases has no public API for this,
 * so it reads the open base's query controller (the object behind Bases' own views menu) and does
 * nothing if that isn't there.
 *
 * Icons: a view can set its own with an `icon` key in the .base file (the Insights base does);
 * otherwise each view gets the icon of its layout (table, cards, list, Trends...).
 */

interface ViewConfig { type?: string; get?(key: string): unknown }
interface Controller {
	viewName: string;
	selectView(name: string): void;
	getQueryViewNames?(): string[];
	query?: { getViewConfig?(name: string): ViewConfig | null };
	plugin?: { getRegistration?(type: string): { icon?: string } | undefined };
	events?: { on(name: string, callback: () => void): unknown; offref?(ref: unknown): void };
}
interface Tabs { key: string; group: HTMLElement; ref: unknown }

const controllerOf = (view: View): Controller | null => {
	const c = (view as unknown as { controller?: Controller }).controller;
	return c && typeof c.selectView === "function" && typeof c.getQueryViewNames === "function" ? c : null;
};

export class BaseTabs {
	private tabs = new Map<View, Tabs>();
	private retries = 0;

	constructor(private plugin: Plugin, private enabled: () => boolean) {}

	/** Add, update or remove the buttons on every open base. */
	refresh(): void {
		const open = new Set<View>();
		let loading = false;
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("bases")) {
			open.add(leaf.view);
			const c = controllerOf(leaf.view);
			if (c && !(c.getQueryViewNames?.() ?? []).length) loading = true;
			this.draw(leaf);
		}
		// A base reads its file a moment after it opens; look again shortly, a few times at most.
		if (loading && this.retries < 5) {
			this.retries++;
			window.setTimeout(() => this.refresh(), 300);
		} else if (!loading) {
			this.retries = 0;
		}
		for (const view of [...this.tabs.keys()]) if (!open.has(view)) this.clear(view);
	}

	clearAll(): void {
		for (const view of [...this.tabs.keys()]) this.clear(view);
	}

	private clear(view: View): void {
		const t = this.tabs.get(view);
		if (!t) return;
		t.group.remove();
		const c = controllerOf(view);
		if (t.ref) c?.events?.offref?.(t.ref);
		this.tabs.delete(view);
	}

	private draw(leaf: WorkspaceLeaf): void {
		const view = leaf.view;
		const c = controllerOf(view);
		const viewsMenu = view.containerEl.querySelector(".bases-toolbar .bases-toolbar-views-menu");
		if (!c || !viewsMenu || !this.enabled()) { this.clear(view); return; }
		const names = c.getQueryViewNames?.() ?? [];
		// One button is no use: there's nothing to switch to.
		if (names.length < 2) { this.clear(view); return; }

		const icon = (name: string) => {
			const config = c.query?.getViewConfig?.(name);
			const own = config?.get?.("icon");
			if (typeof own === "string" && own) return own;
			return (config?.type && c.plugin?.getRegistration?.(config.type)?.icon) || "lucide-table";
		};
		const icons = names.map(icon);
		const key = names.map((n, i) => `${n}\u0000${icons[i]}`).join("\u0001");

		let t = this.tabs.get(view);
		// Rebuilt when the tabs change, or if Bases redrew its toolbar and took the buttons with it.
		if (!t || t.key !== key || !t.group.isConnected) {
			this.clear(view);
			const group = createDiv({ cls: "bases-toolbar-item dj-base-tabs" });
			names.forEach((name, i) => {
				const b = group.createDiv({ cls: "clickable-icon dj-base-tab", attr: { "aria-label": name, "data-view": name } });
				setIcon(b, icons[i]);
				b.onclick = () => c.selectView(name);
			});
			viewsMenu.after(group);
			const ref = c.events?.on("view-changed", () => this.mark(view)) ?? null;
			t = { key, group, ref };
			this.tabs.set(view, t);
		}
		this.mark(view);
	}

	/** Highlight the button for the tab that's showing. */
	private mark(view: View): void {
		const c = controllerOf(view);
		const t = this.tabs.get(view);
		if (!c || !t) return;
		t.group.querySelectorAll<HTMLElement>(".dj-base-tab").forEach((b) => b.toggleClass("is-active", b.dataset.view === c.viewName));
	}
}
