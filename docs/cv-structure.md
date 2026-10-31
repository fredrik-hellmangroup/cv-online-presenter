# How the CV page is built

`/cv` is rendered from the CV Markdown in the content repository. `CvPresenter` (`src/Portfolio.Content/CvPresenter.cs`) reads the **sanitized HTML** of that page and derives everything below from it, so no facts are added or invented. If the document does not follow the structure, the page falls back to plain Markdown rendering.

## Expected Markdown structure

The Swedish heading names are defaults in `CvHeadings`; pass another `CvHeadings` to `CvPresenter.Build` for a different language or template.

| Markdown | Used for |
| --- | --- |
| `# NAME` | Hero heading (the only `h1` on the page). |
| `## Roller` with a list | Role pills in the hero. The section itself is left out of the body. |
| `## Översikt`, first paragraph | First sentence becomes the hero summary. `över N års erfarenhet` in the overview gives the first figure. |
| `## Branscherfarenhet`, comma-separated paragraph | Number of industries (figure). |
| `## Anställningar`, first list item `Role, Company, 2023 - pågående` | Hero kicker: `Company · Role · sedan 2023`. |
| `**Nyckelteknik**` followed by a list of `Group: a, b, c` | Skill chips, and the nodes of the background constellation. |
| `## Uppdragshistorik` with one `###` per assignment | Assignment cards, the git log, and the figure for number of assignments. |
| `**Period:** 2023 - pågående` and `**Roll:** …` under each `###` | Period (`2016`, `2018 - 2020`, or `2023 - pågående`) and role. |
| `#### Nyckelord` followed by a comma-separated line | Technology tags on the card. Technologies that appear together in at least two assignments are linked in the constellation, and hovering or reading an assignment lights its technologies. |

Other sections (for example `## Kompetensområden` and `## Språk`) render as normal Markdown.

## Git log

`GitGraphLayout` lays assignments out like `git log --graph`: each assignment is a branch that is merged into the trunk when it ends and branched off when it starts, newest first. Overlapping assignments get separate lanes, ongoing assignments start at the `HEAD` row, and single-year assignments are a branch and a merge in the same year. The short commit ids are a stable hash of the title and carry no meaning. Rows link to the matching assignment card.

## Background data

Every page carries `#constellation-data` (a hidden element with a JSON `data-json` attribute holding the skill groups and the keywords per assignment), so the constellation also appears on other pages. The `ConstellationEngine` matches keywords to technologies by whole words (`SQL` matches `SQL Server`, `Azure` matches `Azure DevOps`).

## Portrait

Optional. Place an optimised image at `src/Portfolio.Web/wwwroot/img/profile.webp` (portrait, 4:5, around 640×800). The hero shows it automatically when the file exists. Confirm that you have the right to publish the photo before adding it.

## Font

Headings use Barlow Condensed 700/800 (SIL Open Font License 1.1, `wwwroot/fonts/OFL.txt`), served from the same origin.
