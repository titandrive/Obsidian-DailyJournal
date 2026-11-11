import { JournalSettings } from "./settings";

const block = (section: string) => "```journal\n" + section + "\n```\n";

/** Body of a new journal entry. The cards are `journal` code blocks the plugin renders. */
export function entryTemplate(settings: JournalSettings): string {
	const parts = ["---", "tags:", "  - journal", "cssclasses:", "  - journal", "---", ""];
	parts.push(block("header"));
	if (settings.showReading) parts.push(block("reading"));
	parts.push(block("checkin"));
	for (const prompt of settings.prompts) {
		parts.push(`${"#".repeat(2 + prompt.level)} ${prompt.text}`, "", "");
	}
	if (settings.showOnThisDay) parts.push(block("onthisday"));
	return parts.join("\n");
}
