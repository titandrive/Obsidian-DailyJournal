# Daily Journal

A daily journal for Obsidian. Each entry gets a set of cards above your writing:

- **Header**: the date, links to your previous and next entries, that day's weather, and the entry's location (defaults to your default location; change it per entry while traveling).
- **Currently reading**: what you read that day, from your [Hardcover](https://hardcover.app) reading journal: each book's cover, progress and pages read, books started or finished (with your rating), and quotes you saved. On days with no reading it shows when you last read. Works for past entries too. Needs a Hardcover API token. Each entry asks Hardcover once and saves the result in its properties (`reading`, plus `books` and `pages_read` for Bases); after that it only updates when you run **Refresh reading**.
- **Earworm of the day**: a song for the day from YouTube. Paste a YouTube or YouTube Music link (works out of the box), or add a free YouTube Data API key in settings to search by song, artist or both. The card shows the art, title and artist; the play button plays the whole song in the card, and the title opens it in YouTube Music. Saved as properties (`song`, `artist`, plus the video id, link and art), so the Journal base lists your songs. With Currently reading on too, the two cards sit side by side in one row (stacked again on narrow screens).
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

With **Journal base** on (the default), it also keeps `Journal.base` in the journal folder: a table of every entry (location, weather, rating, sleep, work, exercise, food, book and pages read) and a By month view with averages and page totals. Its weather icons live in `Weather Icons/` beside it. The base follows your settings; turning it off moves both to the trash, and turning it back on recreates them.

## Settings

- **Entries**: journal folder and date format, using the layout as Daily notes' template, the Journal base, filling new entries, and writing prompts (edited in a dialog: drag to reorder, indent to make sub-headings).
- **Cards**: each card with its own settings: Weather (on/off, default location, °F/°C), Reading (Hardcover API token), Song of the day (optional YouTube API key for search), Check-in (which fields to show), and On this day.
- **Appearance**: hide the title and Properties box in entries.

Each entry keeps the layout it was created with (its cards, weather on/off, check-in fields, location, and whether its title and Properties show), so changing settings only affects new entries. **Apply to existing entries** updates older ones to the current settings without touching your writing.

## Getting a Hardcover API token

The Reading card reads your reading journal from [Hardcover](https://hardcover.app), so it needs your Hardcover API token. It's free and takes a minute.

1. Sign in at [hardcover.app](https://hardcover.app).
2. Open [Settings → Hardcover API](https://hardcover.app/account/api) (account menu → **Settings** → **Hardcover API**).
3. Copy the token shown there. It may start with `Bearer`; paste it with or without that.
4. In Obsidian, open **Settings → Daily Journal → Reading**, paste it into **Hardcover API token** and click **Test**. It should say "Connected to Hardcover as" your username.

The token can read your Hardcover account, so keep it private. It's stored in this plugin's settings in your vault and only sent to Hardcover. Hardcover tokens expire after a while; if the Reading card says the token was rejected, get a new one from the same page.

## Getting a YouTube API key

The Song of the day card works without a key: paste a YouTube or YouTube Music link. A free YouTube Data API key adds a search bar, so you can find songs by title, artist or both. It takes about five minutes and needs only a Google account (no credit card).

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in.
2. Create a project: click the project picker at the top, then **New Project**, give it a name (for example "Daily Journal") and click **Create**. Make sure the new project is selected.
3. Turn on the YouTube API: open [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) (or **APIs & Services → Library** and search for it) and click **Enable**.
4. Create the key: go to **APIs & Services → Credentials**, click **Create credentials → API key**, and copy the key (it starts with `AIza`).
5. Recommended: restrict it. On the key's page, under **API restrictions**, choose **Restrict key**, tick **YouTube Data API v3** and click **Save**. If the key ever leaked, it would then only work for YouTube searches.
6. In Obsidian, open **Settings → Daily Journal → Song of the day**, paste the key into **YouTube API key** and click **Test**. A new key can take a few minutes to start working.

The free allowance is 10,000 units a day and a search costs 100, so about 100 searches a day. The card only searches after you pause typing, so picking a song uses a few. The key is stored in this plugin's settings in your vault, not sent anywhere except YouTube.

## Data

Weather icons are [Meteocons](https://github.com/basmilius/weather-icons) by Bas Milius (MIT License).

Songs come from YouTube: pasted links are looked up with YouTube's oEmbed service (no key needed), search uses the YouTube Data API with your key, and songs play through the embed page Obsidian uses for its own YouTube embeds.

Weather comes from [Open-Meteo](https://open-meteo.com) (no account needed). Location search uses Open-Meteo's geocoding API. Each entry stores its weather once, so past entries don't change.

## Install with BRAT

Add this repository in [BRAT](https://github.com/TfTHacker/obsidian42-brat), then enable **Daily Journal** in Community plugins.

## Building

```bash
cd plugin
npm install
npm run build
```
