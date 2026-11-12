# Daily Journal

A daily journal for Obsidian. Each entry gets a set of cards above your writing:

- **Header**: the date, links to your previous and next entries, that day's weather, and the entry's location (defaults to your default location; change it per entry while traveling).
- **Reading**: what you read that day, from your [Hardcover](https://hardcover.app) reading journal: each book's cover, progress and pages read, books started or finished (with your rating), and quotes you saved. On days with no reading it shows when you last read. Works for past entries too. Needs a Hardcover API token. Each entry asks Hardcover once and saves the result in its properties (`reading`, plus `books` and `pages_read` for Bases); after that it only updates when you run **Refresh reading**.
- **Check-in**: day rating (1–10), sleep, whether you worked, exercise, food (breakfast, lunch, dinner) and tags, saved as note properties so you can chart or query them with Bases.
- **On this day**: links to entries from the same date in earlier months and years.

Works on desktop and mobile; the cards adapt to narrow screens.

## Commands

- **Open today's entry**: creates today's entry from the journal layout if needed.
- **Create Journal (Yesterday)** / **Create Journal (Choose Date)**: creates (or opens) the entry for yesterday or any date picked in a month calendar.
- **Change date (yesterday)** / **Change date (choose date)**: moves the open entry to another date (with a month picker) and fetches that date's weather. Also in the right-click menu for entries.
- **Change location**: sets the open entry's location and refreshes its weather.

Commands that act on an entry only appear while a journal entry is open.

## With Obsidian's Daily notes

Daily Journal uses the same folder and date format as Daily notes (copied on first run, adjustable in settings). With **Use as Daily notes template** on (the default), it keeps the journal layout in a template file (`Daily Journal.md` in your Templates folder) and sets it as Daily notes' template, so Obsidian's own daily-note command uses it. Empty entries created any other way (calendars, dashboards) are filled with the layout too.

## Settings

- **Entries**: journal folder and date format, using the layout as Daily notes' template, filling new entries, and writing prompts (edited in a dialog: drag to reorder, indent to make sub-headings).
- **Cards**: each card with its own settings: Weather (on/off, default location, °F/°C), Reading (Hardcover API token), Check-in (which fields to show), and On this day.
- **Appearance**: hide the title and Properties box in entries.

Each entry keeps the layout it was created with (its cards, weather on/off, check-in fields, location, and whether its title and Properties show), so changing settings only affects new entries. **Apply to existing entries** updates older ones to the current settings without touching your writing.

## Data

Weather icons are [Meteocons](https://github.com/basmilius/weather-icons) by Bas Milius (MIT License).

Weather comes from [Open-Meteo](https://open-meteo.com) (no account needed). Location search uses Open-Meteo's geocoding API. Each entry stores its weather once, so past entries don't change.

## Install with BRAT

Add this repository in [BRAT](https://github.com/TfTHacker/obsidian42-brat), then enable **Daily Journal** in Community plugins.

## Building

```bash
cd plugin
npm install
npm run build
```
