# Daily Journal

A daily journal for Obsidian. Each entry gets a set of cards above your writing:

- **Header**: the date, links to your previous and next entries, that day's weather, and the entry's location (defaults to your default location; change it per entry while traveling).
- **Reading**: your current book with its cover, progress change since your last entry, and any highlights you made that day (from book notes such as [MoonSync](https://github.com/titandrive/Obsidian-MoonSync)'s).
- **Check-in**: day rating (1–10), sleep, exercise, and food (breakfast, lunch, dinner), saved as note properties so you can chart or query them with Bases.
- **On this day**: links to entries from the same date in earlier months and years.

Works on desktop and mobile; the cards adapt to narrow screens.

## Commands

- **Open today's entry**: creates today's entry from the journal layout if needed.
- **Create Journal (Yesterday)** / **Create Journal (Choose Date)**: creates (or opens) the entry for yesterday or any date picked in a month calendar.
- **Change date (yesterday)** / **Change date (choose date)**: moves the open entry to another date (with a month picker) and fetches that date's weather. Also in the right-click menu for entries.
- **Change location**: sets the open entry's location and refreshes its weather.

Commands that act on an entry only appear while a journal entry is open.

## With Obsidian's Daily notes

Daily Journal uses the same folder and date format as Daily notes (copied on first run, adjustable in settings). Notes that Daily notes, a calendar plugin, or a dashboard create are filled with the journal layout automatically while they're empty, so leave Daily notes' **Template** setting blank.

## Settings

Journal folder and date format, writing prompts, default location, °F/°C, which check-in fields to show, the reading card and books folder, and whether to hide the title and Properties box in entries.

## Data

Weather comes from [Open-Meteo](https://open-meteo.com) (no account needed). Location search uses Open-Meteo's geocoding API. Each entry stores its weather once, so past entries don't change.

## Install with BRAT

Add this repository in [BRAT](https://github.com/TfTHacker/obsidian42-brat), then enable **Daily Journal** in Community plugins.

## Building

```bash
cd plugin
npm install
npm run build
```
