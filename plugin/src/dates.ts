import { moment, normalizePath, TAbstractFile, TFile } from "obsidian";
import { JournalSettings } from "./settings";

type Moment = ReturnType<typeof moment>;

/** The date a journal entry is for, or null if the file isn't a journal entry. */
export function entryDate(settings: JournalSettings, file: TAbstractFile | null): Moment | null {
	if (!(file instanceof TFile) || file.extension !== "md") return null;
	const folder = normalizePath(settings.folder);
	if (folder !== "/" && !file.path.startsWith(folder + "/")) return null;
	const nameFormat = settings.dateFormat.split("/").pop() ?? settings.dateFormat;
	const date = moment(file.basename, nameFormat, true);
	return date.isValid() ? date : null;
}

/** Vault path of the entry for a given date, e.g. "Daily Notes/2026/Nov/11-10-26.md". */
export function entryPath(settings: JournalSettings, date: Moment): string {
	const folder = normalizePath(settings.folder);
	return normalizePath(`${folder === "/" ? "" : folder + "/"}${date.format(settings.dateFormat)}.md`);
}

export type { Moment };
