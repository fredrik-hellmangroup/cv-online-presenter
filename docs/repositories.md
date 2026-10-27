# Repository boundaries and version linkage

| Repository | Responsibility | License | Validation |
| --- | --- | --- | --- |
| [`cv-online-presenter`](https://github.com/fredrik-hellmangroup/cv-online-presenter) | .NET application, TypeScript client, web publishing and deployment | MIT | `Quality gates` workflow |
| [`cv-online-presenter-content`](https://github.com/fredrik-hellmangroup/cv-online-presenter-content) | Markdown pages, locale configuration, content schema and synthetic draft example | MIT | `Content validation` workflow |

The app pins content as a Git submodule. Its gitlink stores the exact content commit used for each app revision; changing content creates a content PR and then an app PR that updates the pointer. `npm run build:metadata` writes both commits and the build ID to `build-metadata.json`, which is included in the published web assets. `git clone --recurse-submodules` reproduces that pair. Neither CI workflow depends on the other repository's workflow result.

The content repository starts with Swedish as its single supported template locale, no contact address, and no canonical domain. These settings keep the starter content non-personal until approved values are supplied. The example profile remains draft-only and explicitly synthetic.
