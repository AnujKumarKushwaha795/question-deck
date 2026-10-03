# Question Deck

A browser-based tool for selecting, filtering, and exporting exam questions to **PDF** or **PowerPoint**, with full LaTeX math rendering via [KaTeX](https://katex.org/).

## Features

- 🔍 **Search** questions by paper title, topic, or text
- ☑️ **Select** individual or all visible questions
- 📄 **Questions PDF** — print-ready question paper
- 🔑 **Answer Key PDF** — answer grid + solutions
- 🌙 **Dark PPT** — dark-theme slides (one question per slide, high-DPI)
- ☀️ **Light PPT** — clean white slides
- Full **LaTeX / KaTeX** math rendering (`\(...\)`, `\[...\]`, `$$...$$`, bare commands)
- Handles **tables**, **images**, **lists** embedded in questions

## Project Structure

```
question-deck/
├── index.html          ← App shell
├── styles.css          ← All UI + print styles
├── js/
│   ├── mathUtils.js    ← Full LaTeX/KaTeX rendering pipeline
│   ├── pdfGenerator.js ← Browser print-to-PDF generation
│   ├── pptGenerator.js ← PptxGenJS + dom-to-image slide generator
│   ├── pptModal.js     ← Settings modals + sticky generator bar
│   └── app.js          ← Main app logic (search, selection, rendering)
└── data/
    └── questions_clean.json ← Question data
```

## Running Locally

The app uses `fetch()` to load question data, so it **must be served over HTTP** (not opened as a `file://` URL).

**Option 1 — Python (no install needed):**
```bash
cd question-deck
python -m http.server 8080
# Open http://localhost:8080
```

**Option 2 — Node.js `serve`:**
```bash
npx serve .
```

**Option 3 — VS Code Live Server:**  
Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension and click **Go Live**.

## Deploying to GitHub Pages

1. Push this folder as a GitHub repository (or as the root of one).
2. Go to **Settings → Pages → Source → Deploy from branch**.
3. Select `main` branch, `/ (root)` folder → **Save**.
4. Your app will be live at `https://<username>.github.io/<repo>/`.

> **Note:** The `data/questions_clean.json` file is ~316 KB. GitHub Pages handles this fine, but if you have a much larger dataset, consider hosting the JSON separately (e.g. on a CDN or R2/S3) and updating the `fetch()` URL in `js/app.js`.

## Updating Questions

Replace `data/questions_clean.json` with your own file. The expected schema per question object is:

```json
{
  "question_id": "unique-id",
  "type": "mcq",
  "paperTitle": "JEE Advanced 2023",
  "year": "2023",
  "subject": "Physics",
  "question": {
    "en": {
      "content": "Question text (supports LaTeX)",
      "options": [
        { "identifier": "A", "content": "Option text" },
        { "identifier": "B", "content": "Option text" }
      ],
      "correct_options": ["A"],
      "answer": "",
      "explanation": ""
    }
  }
}
```

Supported `type` values: `mcq`, `mcqm`, `integer`, `subjective`, `fill-blanks`.

## Third-Party Libraries (loaded from CDN)

| Library | Version | Purpose |
|---------|---------|---------|
| [KaTeX](https://katex.org/) | 0.16.8 | Math rendering |
| [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) | 3.12.0 | PowerPoint generation |
| [dom-to-image-more](https://github.com/1904labs/dom-to-image-more) | 3.4.0 | Slide screenshot capture |

All CDN scripts are loaded lazily — PptxGenJS and dom-to-image are only fetched when you click a PPT button.

## License

MIT
