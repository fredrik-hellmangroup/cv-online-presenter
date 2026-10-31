# Easter eggs

The easter egg is hidden by default. It is a harmless message (`#easter-egg` in `ContentPage.razor`) that is rendered with the `hidden` attribute and revealed only by a secret trigger. It also gives the particle background a short speed boost. Escape or the **Stäng** button hides it again. Nothing in the reading or navigation flow depends on it, and it makes no network requests.

## Active triggers

| Trigger | How | Implementation |
| --- | --- | --- |
| Logo clicks | Click the glowing dot next to the site name five times within two seconds. | `createClickCounter` in `client/src/egg-triggers.ts`; configured in `easterEggManifest`. |
| Key sequence | Type `k`, `o`, `d` outside text fields, without Ctrl, Alt, or Meta. | `createSequenceMatcher` in `client/src/egg-triggers.ts`. |

Both are declared in `client/src/experience-manifest.ts` (`clickCount`, `clickWindowMs`, `keySequence`) and are covered by `client/test/easter-egg.test.mjs` and the Playwright spec in `tools/a11y/tests/site.spec.mjs`.

The logo dot is `aria-hidden` and not focusable, so the click trigger is a visual discovery for pointer users. The key sequence is the keyboard-accessible route; the message itself is a `role="status"` element, so screen readers announce it once revealed.

## Other options that were considered

| Option | Idea | Why it is not used now |
| --- | --- | --- |
| Hidden button | A small, visually hidden or low-contrast button somewhere on the page. | Keyboard users would tab onto an unlabeled control; it is easy to find by accident. |
| Konami code | ↑ ↑ ↓ ↓ ← → ← → B A. | Familiar but long and awkward on laptops; the K-O-D sequence is shorter and also works. |
| Typed word | Typing a longer word such as `fredrik` anywhere. | Collides with search and other shortcuts and is easy to trigger while reading. |
| Footer or copyright clicks | Click the footer text several times. | Poor discoverability and nothing visual to hint at it. |
| Long press | Press and hold the logo for about two seconds. | Unreliable on touch devices and conflicts with text selection and context menus. |
| Query parameter | `?egg=1` or `#egg`. | Easy to share and discover; not really hidden. |
| Time-based | Reveal on a date such as a birthday or Christmas. | Already handled by the calendar layers; no birthday date is approved. |
| Console message | Print a hint in the browser console. | Fine as a complement, but invisible to most visitors. |
| Scroll end or idle | Reveal after reaching the bottom of the page or after idling for a while. | Surprising and can look like a bug. |

To change the triggers, edit `easterEggManifest` and, for a new kind of trigger, add a small pure function next to `egg-triggers.ts` with a unit test.
