# Adeeb’s Vault — Adeeb’s personal archive

A personal portfolio, film diary, series archive, and watchlist. Same black / yellow visual direction as the original design, rebuilt as a responsive static site.

**No backend, account system, API key, paid database, or production build step is required.** GitHub stores the public content in [`data/archive.json`](data/archive.json), alongside the frontend. GitHub Pages can serve the repository root directly. The existing `CNAME` remains `adeebmuh.me`.

## Update your ratings without editing HTML

1. Open `https://adeebmuh.me/studio.html` after deployment.
2. Add or edit a film/series, give it a rating out of 5 (including decimals such as 4.4 or 4.8), and save to your draft. Profile and projects can also be edited here.
3. Open **Publish → Preview my draft** to check your changes. This preview is local to the same browser and shows a yellow preview banner.
4. Choose **Copy archive JSON**, then **Open my GitHub file**.
5. Replace the contents of `data/archive.json` with the copied JSON and commit the change to `main`.
6. Wait for GitHub Pages to finish deploying, then refresh your site.

The studio also downloads/imports `archive.json` backups. Drafts use this browser’s local storage; they do not sync between devices. If the browser cannot store a draft, the editor warns you to download it. The regular public site always loads the committed file; visitors’ local changes cannot modify it. No GitHub passwords or tokens belong in the website.

The published collection contains Adeeb’s own ratings. Anime has its own collection, alongside Films, Series, and Watchlist. Use the language filter to browse Tamil, Japanese, Hindi, English, or any language you add later. In Studio, choose a collection and enter languages separated by commas. Ratings use a five-star scale in 0.1-star steps; the numeric rating and star fill preserve your exact score. Watchlist entries are unrated. Watched dates are optional, and none were guessed for the initial collection.

Instagram links are controlled by `profile.instagram` and can be updated under **My Profile** in Studio. Project Phantom is listed as current work, linking to its official site; no unconfirmed role or job title is claimed.

## Project structure

- `index.html` — public portfolio and archive
- `studio.html` — local draft editor, preview, import/export, and GitHub publishing instructions
- `data/archive.json` — public profile, projects, and film/series records
- `assets/css/` — responsive site and editor styles
- `assets/js/` — shared validation/filtering, public renderer, and editor
- `assets/images/` / `assets/fonts/` — self-hosted assets

## Check locally

With Node.js 20 or later:

```sh
npm test
npm run build
```

The build validates the archive and local asset references, then creates `dist/`. The original source also works directly on GitHub Pages; there are no npm dependencies. For a local preview with Python installed, run `python -m http.server 8000` in the repository and open `http://localhost:8000`. Opening the HTML with `file://` will not load the JSON archive.

## GitHub Pages

Keep the existing Pages setup if it already serves this repository. For a fresh setup: repository **Settings → Pages → Deploy from a branch → main → / (root)**. Keep the custom domain and DNS setup that you use for `adeebmuh.me`. Hash-based navigation (`#films`, `#about`, `#film/perfect-days`) works without server routing. Set **Enforce HTTPS** when available.

For a fork, update `CNAME`, the canonical/Open Graph URLs and sitemap, `profile.website` / `profile.github` in the JSON, and the repository link in `studio.html`.

## Assets

The chrome hero artwork comes from the original supplied design. Film posters and anime cover art identify the works being reviewed; see [asset sources](assets/images/SOURCES.md). They remain the property of their respective rightsholders. Fonts are Syne, Geist, and JetBrains Mono, self-hosted with the accompanying Open Font License files. No film metadata API is called at runtime.

When application code or CSS changes, bump the asset query versions in HTML and the `core.js` module imports together so returning visitors receive the matching renderer and validator. Content-only changes to `data/archive.json` do not require a version bump.
