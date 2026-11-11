import { JournalSettings } from "./settings";

const block = (section: string) => "```journal\n" + section + "\n```\n";

/** Body of a new journal entry. The cards are `journal` code blocks the plugin renders. */
export function entryTemplate(settings: JournalSettings): string {
	const parts = ["---", "tags:", "  - journal", "cssclasses:", "  - journal", "---", ""];
	parts.push(block("header"));
	if (settings.showReading) parts.push(block("reading"));
	parts.push(block("checkin"));
	settings.prompts.forEach((prompt, i) => {
		parts.push(`${i === 0 ? "##" : "###"} ${prompt}`, "", "");
	});
	parts.push(block("onthisday"));
	return parts.join("\n");
}

/** Rewrites the old Dataview-based blocks (Apps/Scripts/journal) into `journal` blocks. */
export function convertLegacyBlocks(text: string): string {
	const names: Record<string, string> = { nav: "header", header: "header", book: "reading", tracker: "checkin", onthisday: "onthisday" };
	return text.replace(
		/```dataviewjs\s*\nawait dv\.view\("[^"]*journal",\s*\{\s*part:\s*"(\w+)"\s*\}\)\s*\n```/g,
		(match, part: string) => (names[part] ? "```journal\n" + names[part] + "\n```" : match),
	);
}
