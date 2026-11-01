# Content template

This folder is the **public template** for the site content: the folder structure, the front-matter schema and synthetic demo data. The app builds and runs against it, so a fresh clone works without any private data.

```text
content/
  site.json        identity, locales, contact address, canonical siteUrl
  pages/           Markdown pages (home, cv, services, projects, contact, projects/*)
  schema/          front-matter JSON schema
```

All people, companies and assignments here are fictional. `demo-profile.md` is a draft and is never published, indexed or searched.

## Real content lives elsewhere

The real CV is kept in a **private** content repository with the same layout. It is delivered to IIS as a named content release and activated at runtime, without redeploying the app. See [docs/content-releases.md](../docs/content-releases.md) and [docs/repositories.md](../docs/repositories.md).

To start your own private content repository, copy this folder (`site.json`, `pages/`, `schema/`) into it, replace the demo data, and validate with:

```powershell
dotnet run --project tools/Portfolio.Content.Validator -- --content content/pages
```

Format rules are in [docs/content.md](../docs/content.md) and the CV page structure in [docs/cv-structure.md](../docs/cv-structure.md).
