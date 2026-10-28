---
name: vault-movie-diary
description: Maintain Adeeb's Vault movie and series diary with exact ratings, personal reviews, local WebP posters, and validation.
user-invocable: true
---

# Adeeb's Vault Movie Diary Agent

Read AGENTS.md and inspect the latest repository state before editing. Follow the existing structure and schema in data/archive.json. Keep the website static and compatible with GitHub Pages; the Studio stores browser-local drafts. Do not introduce backends, database services, credentials, tokens, or runtime API dependencies.

## Diary updates

- Identify the exact title, version, year, and whether it is a film, series, or anime. Verify factual metadata using reliable sources when available.
- If a dictated title or version is unclear, ask Adeeb for clarification and leave that entry unpublished. Do not silently substitute a similar title. "Lion", "BKU", and "Zaalima" require clarification unless the request supplies enough identifying information.
- Preserve the latest rating Adeeb gives exactly on the five-star scale, including decimals such as 3.9, 4.4, and 4.9. Never round. Ask for a missing rating when needed; do not invent one.
- Use Adeeb's supplied review. Leave review and watchedOn empty when not provided. Never invent personal opinions, dates, favourites, or professional roles.
- Use verified metadata only. Leave unknown optional metadata empty, or runtime at 0, according to the existing schema.
- Keep anime under category "anime". Use type "series" for TV series. Reuse an existing entry's ID when updating it and avoid duplicate IDs.
- Preserve existing entries, profile, projects (including Project Phantom), and Instagram @ax_guy. Limit edits to the requested diary update.

## Posters

- Find suitable vertical promotional artwork for the confirmed title and version from a legitimate public source.
- Download it into assets/images/ and convert to actual WebP bytes, not just a renamed extension. Use descriptive names such as breaking-bad-poster.webp.
- Preserve proportions and the full poster. Resize large artwork and compress sensibly without unnecessary cropping or stretching.
- Set poster to the local path, for example assets/images/breaking-bad-poster.webp, and record the source URL and rightsholder acknowledgement in assets/images/SOURCES.md.
- Do not hotlink images or replace an existing poster unless requested. Do not invent artwork URLs. If downloading or conversion is blocked, report it and do not publish a broken path.

## Checks and handoff

- Validate JSON, unique IDs, exact ratings, and all local poster paths. Run npm run check.
- Review the diff to confirm unrelated content and the design are preserved.
- When asked to add or update diary entries, prepare the requested changes on the task branch and create or update a pull request through the available GitHub workflow. Report which entries changed, poster sources, and check results.
- Do not merge, publish to the default branch, or deploy unless the user has authorized publication. Never claim the public site was updated merely because a pull request was opened; report deployment only when verified.
