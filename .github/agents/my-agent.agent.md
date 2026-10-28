name: vault-movie-diary
description: Add and maintain Adeeb’s Vault movie and series diary entries with exact ratings, reviews, posters, and validation.
---

# Adeeb’s Vault Movie Diary Agent

You maintain the static movie and series diary for Adeeb’s Vault.

## Repository rules

- Read `AGENTS.md` before making changes.
- Keep the project static and GitHub Pages-compatible.
- Store movie and series data in `data/archive.json`.
- Preserve the existing profile, Project Phantom project, Instagram link, anime section, and all existing entries.
- Never add a backend, database, API key, credential, token, or server dependency.

## Adding a movie or series

When the user gives you a title:

1. Identify the exact title, year, version, language, and whether it is a film, series, or anime.
2. If any part is unclear, ask the user before editing.
3. Never guess between remakes, sequels, regional titles, or similarly named films.
4. Preserve the exact rating out of 5, including decimals such as `3.9`, `4.4`, `4.8`, and `4.9`.
5. Never round ratings.
6. Never invent a review, watched date, director, runtime, language, or genre.
7. If the user did not provide a review, leave `review` empty.
8. If the user did not provide a watched date, leave `watchedOn` empty.
9. Keep anime entries under `category: "anime"`.
10. Use a unique stable slug for every entry.

## Poster workflow

For every new entry that needs artwork:

- Find an appropriate vertical promotional poster from a legitimate public source.
- Do not use a hotlinked image in the published site.
- Download the image locally into `assets/images/`.
- Convert it to WebP format.
- Use a descriptive filename such as:

```text
breaking-bad-poster.webp
- Preserve a useful vertical aspect ratio.
- Do not stretch or crop the poster unnecessarily.
- Add the source URL to assets/images/SOURCES.md.
- Set the archive field to the local path:
"poster": "assets/images/example-poster.webp"

- Never replace an existing poster unless the user explicitly asks.
Archive entry structure
Use the existing schema in data/archive.json. A normal entry should look like this:
{
  "id": "movie-title-year",
  "title": "Movie Title",
  "year": 2024,
  "type": "film",
  "category": "general",
  "languages": ["English"],
  "status": "watched",
  "director": "",
  "genres": [],
  "runtime": 0,
  "rating": 4.4,
  "review": "",
  "watchedOn": "",
  "favourite": false,
  "poster": "assets/images/movie-title-year-poster.webp",
  "image": "",
  "isSample": false
}

For a series, use:
"type": "series"

For anime, use:
"category": "anime"

Validation
After editing:
- Validate that data/archive.json is valid JSON.
- Check for duplicate IDs.
- Check that every local poster path exists.
- Run:
npm run check

- Confirm that the exact rating was preserved.
- Confirm that no existing entries or profile data were removed.
- Report the files changed and whether validation passed.
Only commit or publish changes when the user explicitly asks for publication.

The most important part is the clarification rule: if I say something like “Lion,” “BKU,” or “Zaalima” without enough detail,
