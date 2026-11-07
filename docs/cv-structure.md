# How the CV page is built

`/cv` is rendered from the CV Markdown in the content repository. `CvPresenter` (`src/Portfolio.Content/CvPresenter.cs`) reads the **sanitized HTML** of that page and derives everything below from it, so no facts are added or invented. If the document does not follow the structure, the page falls back to plain Markdown rendering.

## Expected Markdown structure

The Swedish heading names are defaults in `CvHeadings`; pass another `CvHeadings` to `CvPresenter.Build` for a different language or template.

| Markdown | Used for |
| --- | --- |
| `# NAME – tagline` | Hero heading (the only `h1` on the page). Text after ` – ` becomes a smaller tagline line inside the same `h1`. |
| `## Roller` with a list | Role pills in the hero. The section itself is left out of the body. |
| `## Översikt`, first paragraph | First sentence becomes the hero summary. `över N års erfarenhet` in the overview gives the first figure. |
| `## Praktiskt` with a list of `Label: value` | Small fact cards (availability, working model, languages, references…) shown at the end of the overview. The section itself is left out of the body and the table of contents. Optional; items without a `:` are ignored. |
| `## Branscherfarenhet`, comma-separated paragraph | Number of industries (figure). |
| `## Anställningar`, first list item `Role, Company, 2023 - pågående` | Hero kicker: `Company · Role · sedan 2023`. |
| `## Uppdragshistorik` with one `###` per assignment | Assignment cards, the git log, and the figure for number of assignments. |
| `**Period:** 2023 - pågående` and `**Roll:** …` under each `###` | Period (`2016`, `2018 - 2020`, or `2023 - pågående`) and role. |
| `#### Nyckelord` followed by a comma-separated line | Technology tags on the card, and the source of the skill buttons (see below). Technologies that appear together in at least two assignments are linked in the constellation, and hovering or reading an assignment lights its technologies. |

### Technologies come from the assignment keywords

There is no technology list to maintain in the CV Markdown. The skill buttons (`button.skill-btn`) on `/cv` and `/services`, the nodes of the background constellation and the *nyckelteknologier* figure are all derived from the `#### Nyckelord` of the assignments. Duplicates are merged without regard to case, and within a group the keywords used in the most assignments come first.

The optional `techGroups` array in `content/site.json` only decides which group a keyword is listed under. Groups appear in the order given, and keywords that are in no group are listed last under *Övrigt* (`CvHeadings.OtherSkills`); items that no assignment uses are ignored. Without `techGroups` all keywords form one group. When groups are defined, *Övrigt* is not counted in the *nyckelteknologier* figure. Keywords you have reviewed and deliberately left out can be listed in `"techReview": { "ignored": [...] }` in the same file; only `npm run content:tech:report` reads it (see [source-map.md](./source-map.md#technology-coverage-report)).

```json
"techGroups": [
  { "name": "Kärnplattform", "items": [".NET", "C#", "SQL Server"] },
  { "name": "Moln och DevOps", "items": ["Azure DevOps", "Docker", "Kubernetes"] }
]
```

Every group needs a name and at least one item, and an item may only appear in one group (case-insensitive); otherwise the content release fails validation when it is loaded. The list is rendered at the end of the `## Kompetensområden` section (`CvHeadings.Competence`), or first among the sections after the history if there is none, under the title `CvHeadings.Skills` (*Teknik i uppdragen*). Clicking a button highlights the technology; clicking again or pressing Escape releases it.

The recommended section order is Översikt, Praktiskt, Uppdragshistorik, Kompetensområden, Branscherfarenhet: what the visitor most often wants (the assignments) comes right after the overview. Everything before `## Uppdragshistorik` is rendered above the git log and everything after it below the assignment cards, so another order also works. Other sections (for example `## Kompetensområden`) render as normal Markdown; the derived technology list is added at the end of `## Kompetensområden`.

## PDF and print

The hero has a **Skriv ut** button (revealed by JavaScript) and a print stylesheet (light, A4, without navigation and background). **Ladda ner PDF** appears only when `src/Portfolio.Web/wwwroot/downloads/cv.pdf` exists; the folder is git-ignored, so the PDF belongs to the deployment and never to the template. Create it by printing `/cv` to PDF.

## Services technology explorer

`/services` renders the grouped `SkillGroups` and `Assignments` derived by `CvPresenter` below the services Markdown and before the CV call to action. The filter narrows the chips and group cards in place, reports visible/total counts, and exposes a no-match message. Selecting a technology toggles `aria-pressed`, updates the live usage status from assignment keywords, and sends the selected skill to the constellation; Escape clears the selection unless the CV search panel is open. The explorer is not rendered on the home page. Its buttons and counts are server-rendered so the skill content remains available without JavaScript; filtering and pinning are progressive client enhancements.

## Git log

`GitGraphLayout` lays assignments out like `git log --graph`: each assignment is a branch that is merged into the trunk when it ends and branched off when it starts, newest first. Overlapping assignments get separate lanes, ongoing assignments start at the `HEAD` row, and single-year assignments are a branch and a merge in the same year. The short commit ids are a stable hash of the title and carry no meaning. Rows link to the matching assignment card.

## Background data

Every page carries `#constellation-data` (a hidden element with a JSON `data-json` attribute holding the skill groups and the keywords per assignment), so the constellation also appears on other pages. The `ConstellationEngine` matches keywords to technologies by whole words (`SQL` matches `SQL Server`, `Azure` matches `Azure DevOps`).

Behind the technologies there is ambient dust (`constellation-motes.ts`): unlabelled specks that drift, twinkle and link up faintly, with an occasional brighter star. The amount follows the screen area (calmer on narrow screens), the dust is pushed away by the cursor, and it brightens near the cursor and near highlighted technologies. It holds still with reduced motion, so a profile with few technologies still has a lively background.

### Placement of the technologies

The technologies are not on fixed positions (`constellation-layout.ts`, `constellation-engine.ts`):

- **Random on every load.** Each page load scatters the technologies at random inside the usable area (never under the sticky header or the search button), spread apart from one another. A window resize keeps the places they already have.
- **Clear of text.** The engine measures the visible text (tightly around the letters) and the cards (`SURFACE_SELECTOR`, `TEXT_SELECTOR`) and re-measures while the page scrolls. A technology that ends up behind a block is nudged out through its nearest edge (gently, `OBSTACLE_PUSH`), and a destination that gets covered is replaced after a short pause (`RETARGET_COOLDOWN_MS`); the glide to a new place is slow (`HOME_EASE`), so scrolling never makes the technologies dart around. A technology may sit partly behind an edge (`OVERLAP_ALLOWED`) but not completely behind a block. When there is no room (a full page of text) the engine still places the technologies instead of failing. This is switched off below `NARROW_VIEWPORT` (700 px): on a phone the content covers almost the whole screen, so the technologies float freely behind it, and their names are always shown (a little stronger than on a wide screen, `NARROW_LABEL_ALPHA`) so they can be read through the cards.
- **Moves over time.** Every technology picks a new random destination every 20 to 60 seconds and glides there slowly. With reduced motion the layout stays as scattered on load.

A new kind of card or text block that should be avoided is added to `SURFACE_SELECTOR` or `TEXT_SELECTOR`.

## Portrait

Optional. Place an optimised image at `src/Portfolio.Web/wwwroot/img/profile.webp` (portrait, 4:5, around 640×800). The hero shows it automatically when the file exists. Confirm that you have the right to publish the photo before adding it.

## Font

Headings use Barlow Condensed 700/800 (SIL Open Font License 1.1, `wwwroot/fonts/OFL.txt`), served from the same origin.
