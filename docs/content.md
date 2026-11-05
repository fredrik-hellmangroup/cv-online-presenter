# Markdown content

Each Markdown file starts with YAML front matter delimited by `---`. Required fields are `title`, `description`, `locale`, `status`, and `type`. `status` is either `draft` or `published`. `locale` must appear in `content/site.json` under `supportedLocales`; an unavailable translation must not be listed there.

Type-specific required fields are: `page` (`title`, `description`), `profile` (`displayName`, `headline`, `summary`), `experience` (`role`, `organization`, `dates`, `highlights`), `project` (`title`, `summary`, `technologies`, `links`), and `service` or `skill` (`label`, `description`).

Run `dotnet run --project tools/Portfolio.Content.Validator -- --content content/pages` to validate the documents from the app repository. Invalid YAML, missing fields, unsupported locales, unknown statuses, empty published bodies, unsafe URL schemes, and unresolved internal links return a non-zero exit code with a file-specific message.

Markdown is rendered with raw HTML disabled and sanitized HTML. Only `http`, `https`, `mailto`, and `tel` URL schemes are permitted in rendered links. Other schemes are rejected by validation and removed during sanitization.

## Project pages and the project list

Besides the required fields, a `project` document may carry presentation metadata. All of it is optional; what is missing is simply not shown.

| Field | Used for |
| --- | --- |
| `summary` | Card text on `/projects`, and the lead paragraph under the heading when the Markdown intro has no paragraph of its own. |
| `technologies` | Tags on the card (which also light up the constellation on hover) and the technology buttons under "Teknik i uppdraget". |
| `period`, `role`, `industry` | The fact cards (Period, Roll, Bransch) under the heading. |
| `category` | The word after the period on the card; falls back to `industry`. |
| `assignment` | The title of the matching assignment in the CV, when it differs from the project's title. The CV links each assignment (git log and card) to the project whose `title` or `assignment` matches. |
| `order` | Sort order on `/projects` (ascending); projects without it come last, alphabetically. |

Section headings are classified by name: "Ansvar…"/"Arbetssätt…" (responsibilities), "Resultat…"/"Utfall…" (results), and "Teknik"/"Teknik i …" (technologies, replaced by the buttons). A summary card is added only when the intro text differs from `summary`.

The `/projects` page shows the heading and the introduction before the first `##` of `projects.md`; the cards are generated. `/contact` ends with "Fortsätt utforska", cards built from the title and description of `services`, `projects` and `cv`.

`/services` opens with a two-column hero built by `PageHero` from the Markdown: the `#` heading and the paragraphs before the first `##` form the left column, and every `##` with its text becomes an item in the panel on the right. The front matter of the page may add `kicker` (small line above the heading), `panelEyebrow` and `panelTitle` (the panel's heading); all are optional. A page without a `#` heading or without any `##` section is rendered as plain Markdown instead.


## Editorial page ownership

The private content generator owns the single H1 for every published non-CV page. The app does not infer a title H1 from front matter: it renders the authored Markdown heading and surrounding editorial content. Project detail metadata supplies the summary and technology tags; section headings in Markdown provide the responsibilities and results sections. The CV is the exception: its `CvPresenter`/`CvHero` owns the H1 and structured CV layout.

For integration checks against generated content, set `EDITORIAL_CONTENT_PAGES` to the external generated `content/pages` directory when running the app's `EditorialPageTests`. The test reads the directory in place; it neither copies nor records its facts. See [repositories.md](repositories.md#generated-content-validation).
