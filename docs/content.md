# Markdown content

Each Markdown file starts with YAML front matter delimited by `---`. Required fields are `title`, `description`, `locale`, `status`, and `type`. `status` is either `draft` or `published`. `locale` must appear in `content/site.json` under `supportedLocales`; an unavailable translation must not be listed there.

Type-specific required fields are: `page` (`title`, `description`), `profile` (`displayName`, `headline`, `summary`), `experience` (`role`, `organization`, `dates`, `highlights`), `project` (`title`, `summary`, `technologies`, `links`), and `service` or `skill` (`label`, `description`).

Run `dotnet run --project tools/Portfolio.Content.Validator -- --content content/content/pages` to validate the documents from the app repository. Invalid YAML, missing fields, unsupported locales, unknown statuses, empty published bodies, unsafe URL schemes, and unresolved internal links return a non-zero exit code with a file-specific message.

Markdown is rendered with raw HTML disabled and sanitized HTML. Only `http`, `https`, `mailto`, and `tel` URL schemes are permitted in rendered links. Other schemes are rejected by validation and removed during sanitization.
