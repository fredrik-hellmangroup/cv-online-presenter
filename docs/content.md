# Markdown content

Last updated: 2026-11-06

Each Markdown file starts with YAML front matter delimited by `---`. Every
document requires non-empty `title`, `description`, `locale`, `status`, and
`type`. `status` is `draft` or `published`; `locale` must be listed in
`content/site.json` under `supportedLocales`.

Type-specific required fields are:

| `type` | Required fields in addition to the common fields |
|---|---|
| `page` | `title`, `description` (already required for every document) |
| `profile` | `displayName`, `headline`, `summary` |
| `experience` | `role`, `organization`, `dates`, `highlights` |
| `project` | `title`, `summary`, `technologies` |
| `service` or `skill` | `label`, `description` |

`links` is **not required** for project metadata. If present, it must be a
non-empty string; it is not a list of Markdown destinations and does not create
a link by itself. Use Markdown links in the page body for actual links. Those
body destinations are validated separately.

The Node.js validator reports malformed front matter, missing fields,
unsupported locales, invalid statuses, empty published bodies, raw HTML, and
unsafe URL destinations. For links from published pages, it permits the core
application routes and one-level routes for published project documents; a
generic published slug does not automatically become an approved app route.
Relative destinations are resolved against the current page. The synthetic
test suite covers approved and rejected routes. The .NET validator
independently checks page metadata, project route shape, locale, publication
status, and that internal links resolve to published pages. Both validators
are used by the shared content-validation workflow. Rendered Markdown has raw
HTML disabled and sanitized; permitted schemes are `http`, `https`, `mailto`,
and `tel`.

From the app repository root, validate the public synthetic template with:

```powershell
npm run content:validate
dotnet run --project tools/Portfolio.Content.Validator -- --content content/pages
```

For private content, run `.\scripts\validate-content.ps1 -ContentRoot <content-root>`
from the app repository root; it runs both validators against the private tree.
The manual equivalent is `npm run content:validate -- --root <content-root>` and
`dotnet run --project tools/Portfolio.Content.Validator -- --content <content-root>\content\pages`.
Do not copy private files into this repository.

## Project pages and the project list

The app's published project route is one level deep:
`/projects/{slug}`. Nested project paths such as `/projects/a/b` are rejected
by the .NET validator. This app-route hierarchy is separate from the
source-map hierarchy used to find evidence in the canonical CV; see
[source-map.md](source-map.md#source-evidence-and-project-hierarchy).

The required project metadata is `title`, `summary`, and `technologies`
(alongside the common fields). The following presentation metadata is
optional:

| Field | Current use |
|---|---|
| `summary` | Text on the `/projects` card; also shown as the lead if the detail-page introduction has no paragraph, or as a summary section when it differs from the intro. |
| `technologies` | Tags on the project card and technology buttons on the detail page. |
| `period`, `role`, `industry` | Optional fact cards on the project detail page. |
| `category` | Card label after the period; falls back to `industry`. |
| `assignment` | Alternate title used when linking a CV assignment to a project whose title differs. |
| `order` | Ascending project-list order. Valid source-map values range from `0` through `2147483646`; the app reserves `Int32.MaxValue` (`2147483647`) as its unordered sentinel, which missing or unparseable values resolve to before sorting last, then by title. |
| `links` | Optional non-empty string accepted as metadata; the current project renderer does not treat it as a URL list. |

Project detail H2 headings are classified for presentation: headings containing
“Ansvar”, “Arbetssätt”, or “Responsibilit…” are responsibility sections;
“Result”, “Outcome”, or “Utfall” identify result sections; “Sammanfatt…” or
“Summary” identify summary sections; and “Teknik”, “Tekniker”, “Teknik i …”,
“Technology”, or “Technologies” identify technology sections. The front-matter summary and
technology list are shown in their dedicated UI, so duplicate Markdown
sections of those kinds are omitted when that metadata is present. Other H2
sections render as ordinary project sections.

The `/projects` page uses its authored Markdown introduction before the first
`##`; project cards are drawn from published project documents. A project's
front-matter route is derived from its path under `content/pages/projects/`.

## Page hero and editorial ownership

On `/services`, a Markdown `#` heading and the paragraphs before the first
`##` form the lead. If any H2 section contains H3 headings, each H2 becomes a
tab and its H3 sections become items; text before the first H3 is the tab
introduction. Without
JavaScript, the groups remain visible under their headings. At most four groups
are allowed (the generator rejects more); the technology list is not a tab but
sits under the panel in its own section. If there are no
H3 headings, each H2 becomes a flat panel item instead. The optional `kicker`,
`panelEyebrow`, and `panelTitle` front-matter fields supply the hero's labels.
Without a suitable H1 and at least one H2 section, the page renders as ordinary
Markdown.

The generator owns the single H1 for published non-CV pages and emits it from
the mapped metadata. The CV is the exception: `CvPresenter`/`CvHero` owns its
H1 and structured layout. Project detail metadata supplies the summary and
technology UI, while the Markdown body supplies the introduction and editorial
sections.

For integration checks against generated content, set
`EDITORIAL_CONTENT_PAGES` to the external generated `content/pages` directory
when running the app's `EditorialPageTests`. The test reads that directory in
place; it neither copies nor records its facts. See
[repositories.md](repositories.md#generated-content-validation).
