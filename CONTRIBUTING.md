# Contributing to Question Deck

## Project Structure

```
question-deck/
+-- index.html              ? App shell (load order in <script> tags matters)
+-- 404.html                ? GitHub Pages SPA redirect
+-- styles.css              ? All UI + print styles
+-- js/
¦   +-- config.js           ? ? Start here: CDN URL, feature flags, subject map
¦   +-- utils.js            ? Shared pure helpers (escapeHtml, displayName, …)
¦   +-- mathUtils.js        ? LaTeX / KaTeX rendering pipeline
¦   +-- questionApi.js      ? Data-fetching layer (CDN ? JSON indexes)
¦   +-- pdfGenerator.js     ? Browser print-to-PDF
¦   +-- pptGenerator.js     ? PptxGenJS slide builder
¦   +-- pptModal.js         ? Settings modals + sticky action bar
¦   +-- app.js              ? View layer & state machine (loaded last)
+-- data/
    +-- *.json              ? Local question data (only used in dev/testing)
```

## Adding a New Feature

1. **New utility function?** ? add it to `js/utils.js`.
2. **New configuration value?** ? add it to `js/config.js` under `APP_CONFIG`.
3. **New export format?** ? create `js/<format>Generator.js`, expose a single function,
   add a `<script>` tag in `index.html` *before* `app.js`, then wire the button in `app.js`.
4. **New subject?** ? add an entry to `APP_CONFIG.SUBJECT_META` in `js/config.js`.

## Script Load Order (index.html)

```
config.js      ? no deps
utils.js       ? needs APP_CONFIG
mathUtils.js   ? no runtime deps
pdfGenerator.js
pptGenerator.js
pptModal.js
questionApi.js ? needs APP_CONFIG
app.js         ? needs everything above
```

## Deploying

Push to `main` branch. GitHub Actions (`.github/workflows/pages.yml`) will publish
the site automatically via GitHub Pages.

Alternatively, enable Pages manually:
**Settings ? Pages ? Deploy from branch ? main / (root)**
