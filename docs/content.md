# Markdown content

Each Markdown file starts with YAML front matter delimited by `---`. Required fields are `title`, `description`, `locale`, `status`, and `type`. `status` is either `draft` or `published`. `locale` must appear in `content/site.json` under `supportedLocales`; an unavailable translation must not be listed there.

Type-specific required fields are: `page` (`title`, `description`), `profile` (`displayName`, `headline`, `summary`), `experience` (`role`, `organization`, `dates`, `highlights`), `project` (`title`, `summary`, `technologies`, `links`), and `service` or `skill` (`label`, `description`).

Run `dotnet run --project tools/Portfolio.Content.Validator -- --content content/pages` to validate the documents from the app repository. Invalid YAML, missing fields, unsupported locales, unknown statuses, empty published bodies, unsafe URL schemes, and unresolved internal links return a non-zero exit code with a file-specific message.

Markdown is rendered with raw HTML disabled and sanitized HTML. Only `http`, `https`, `mailto`, and `tel` URL schemes are permitted in rendered links. Other schemes are rejected by validation and removed during sanitization.


## Editorial page ownership

The private content generator owns the single H1 for every published non-CV page. The app does not infer a title H1 from front matter: it renders the authored Markdown heading and surrounding editorial content. Project detail metadata supplies the summary and technology tags; section headings in Markdown provide the responsibilities and results sections. The CV is the exception: its `CvPresenter`/`CvHero` owns the H1 and structured CV layout.

For integration checks against generated content, set `EDITORIAL_CONTENT_PAGES` to the external generated `content/pages` directory when running the app's `EditorialPageTests`. The test reads the directory in place; it neither copies nor records its facts. See [repositories.md](repositories.md#generated-content-validation).
