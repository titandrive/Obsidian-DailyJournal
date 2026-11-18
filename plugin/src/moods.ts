import wheelData from "./moodlists/junto.json";

/*
 * Moods for the check-in, from the Junto Emotion Wheel (© 2016 The Junto Institute for
 * Entrepreneurial Leadership; for personal use): six core emotions, each with categories, and each
 * category with two more specific feelings. Pick a core emotion, then the word that fits (or search
 * every word). Saved as `mood: [word, ...]`.
 */

export interface MoodFamily {
	/** A core emotion: Anger, Fear, Sadness, Surprise, Love, Joy. */
	name: string;
	/** A theme color, so the core feelings are told apart at a glance. */
	color: string;
	/** Every word in the family, for search and coloring. */
	words: string[];
	/** The family's feelings, each with its more specific ones. Shown as rows of three. */
	rows: Array<{ word: string; more: string[] }>;
}

const COLORS: Record<string, string> = {
	anger: "var(--color-red)",
	fear: "var(--color-purple)",
	sadness: "var(--color-blue)",
	surprise: "var(--color-cyan)",
	love: "var(--color-pink)",
	joy: "var(--color-yellow)",
};

const low = (w: string) => w.trim().toLowerCase();

/** The wheel's families, unpleasant to pleasant (the order of junto.json). */
const FAMILIES: MoodFamily[] = Object.entries(wheelData as Record<string, Record<string, string[]>>).map(([name, inner]) => {
	// Rows in alphabetical order, and the two more specific words in each row too.
	const abc = (a: string, b: string) => a.localeCompare(b);
	const rows = Object.entries(inner)
		.map(([word, more]) => ({ word: low(word), more: more.map(low).sort(abc) }))
		.sort((a, b) => abc(a.word, b.word));
	return {
		name, color: COLORS[low(name)] ?? "var(--color-cyan)", rows,
		words: [...new Set([low(name), ...rows.flatMap((r) => [r.word, ...r.more])])],
	};
});

export function moodFamilies(): MoodFamily[] {
	return FAMILIES;
}

/** The family a mood word belongs to (case-insensitive), or null for a word typed in by hand. */
export function familyOf(word: string): MoodFamily | null {
	const w = low(word);
	return FAMILIES.find((f) => f.words.includes(w)) ?? null;
}

/** Most moods an entry can have: a few precise words say more than a long list. */
export const MAX_MOODS = 3;
