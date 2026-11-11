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
