# Workplace English Practice

Workplace English Practice is a personal, vibe-coded browser tool for practicing business email writing and basic workplace phone calls. It uses guided exercises, predefined feedback, and local-only learning records to support learning by doing.

This project is built primarily for personal practice, but anyone is welcome to explore, use, or adapt it.

> This is not an AI grammar checker or professional language assessment tool. Feedback is based on predefined question data.

## What it includes

- Guided choice, tap-to-order, and fill-in-the-blank exercises
- One-sentence recall after each scenario
- Email and phone practice modes
- Predefined explanations for common spelling, grammar, word-order, naturalness, and tone problems
- Mistake review and saved phrases
- Browser-only progress storage
- A local JSON export designed for optional AI-assisted review
- A replaceable JSON question bank

## Privacy

The site does not require an account, call an AI API, use analytics, or automatically upload answers. Progress and practice responses stay in the current browser's `localStorage` unless the user explicitly exports a JSON file.

The included question bank contains only generic workplace situations. It does not contain personal, employer, industry, or real contact information.

## Run locally

Because the question bank is loaded from a separate JSON file, browsers may block it when `index.html` is opened directly with a `file://` URL. Serve the folder with any basic static web server instead.

For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

The project uses only static HTML, CSS, JavaScript, and JSON. It can be published from the repository root with GitHub Pages without a build step.

## Validation

Run `npm test` to validate the question-bank structure, scenario counts, privacy constraints, and external-network boundary.

## License

[MIT](./LICENSE)
