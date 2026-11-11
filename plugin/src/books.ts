import { App, normalizePath, TFile } from "obsidian";

export function pct(v: unknown): number | null {
	const n = parseFloat(String(v ?? "").replace("%", ""));
	return isNaN(n) ? null : n;
}

function bookNotes(app: App, folder: string): TFile[] {
	const prefix = normalizePath(folder) + "/";
	return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
}

/** The most recently read unfinished book (newest last_read; file time only breaks ties). */
export function currentBook(app: App, folder: string): { file: TFile; progress: number } | null {
	const best = bookNotes(app, folder)
		.map((file) => ({ file, fm: app.metadataCache.getFileCache(file)?.frontmatter ?? {} }))
		.filter((b) => b.fm.title && pct(b.fm.progress) !== null)
		.filter((b) => b.fm.reading_status !== "finished" && (pct(b.fm.progress) ?? 0) < 100)
		.sort((a, b) => String(b.fm.last_read ?? "").localeCompare(String(a.fm.last_read ?? "")) ||
			b.file.stat.mtime - a.file.stat.mtime)[0];
	return best ? { file: best.file, progress: pct(best.fm.progress) as number } : null;
}

export function bookFromLink(app: App, value: unknown, from: string): TFile | null {
	const m = String(value ?? "").match(/\[\[([^\]|]+)/);
	return m ? app.metadataCache.getFirstLinkpathDest(m[1], from) : null;
}

export function bookLink(app: App, file: TFile): string {
	const title = app.metadataCache.getFileCache(file)?.frontmatter?.title ?? file.basename;
	return `[[${file.path.replace(/\.md$/, "")}|${title}]]`;
}

/** [!quote] callouts whose header carries the given date, e.g. "Chapter 3 • May 6, 2026". */
export function quotesOn(text: string, day: string): string[] {
	const out: string[][] = [];
	let cur: string[] | null = null;
	for (const line of text.split("\n")) {
		const head = line.match(/^>\s*\[!quote\][-+]?\s*(.*)$/i);
		if (head) {
			if (cur) out.push(cur);
			cur = head[1].includes(day) ? [] : null;
			continue;
		}
		if (cur && line.startsWith(">")) { cur.push(line.replace(/^>\s?/, "")); continue; }
		if (cur) { out.push(cur); cur = null; }
	}
	if (cur) out.push(cur);
	return out.map((l) => l.join("\n").trim()).filter(Boolean);
}

/** Highlights made on a given day across all book notes. */
export async function highlightsOn(app: App, folder: string, day: string): Promise<Array<{ text: string; file: TFile }>> {
	const found: Array<{ text: string; file: TFile }> = [];
	for (const file of bookNotes(app, folder)) {
		for (const text of quotesOn(await app.vault.cachedRead(file), day)) found.push({ text, file });
	}
	return found;
}
