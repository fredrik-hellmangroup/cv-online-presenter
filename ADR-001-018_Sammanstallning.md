# Arkitekturbeslut – ADR-001 till ADR-018

**Projekt:** Konsultportfolio  
**Dokumenttyp:** Beslutssammanställning  
**Datum:** 28 oktober 2026

Sammanställning av fastställda arkitekturbeslut för en publik, IIS-hostad .NET-konsultportfolio med privat Markdown-CV, dynamisk presentation och modulära upplevelser.

## Översikt

| ADR | Område | Valt alternativ |
|---|---|---|
| ADR-001 | Portfolio-first | B – Portfolio-first med dokumentvy |
| ADR-002 | Content Intelligence | C – Automatisk klassificering med valfria metadata |
| ADR-003 | Frontend och rendering | B – Balanced Hybrid |
| ADR-004 | Theme & Easter Egg Engine | B – Modulär Experience Architecture |
| ADR-005 | Content Delivery & Deployment | B – Runtime Content |
| ADR-006 | Design System & Visual Architecture | B – Tailwind + egna Blazor-komponenter; Scandinavian Editorial |
| ADR-007 | Navigation & Discovery | C – Hybrid Navigation + Command Palette |
| ADR-008 | Professional Identity & Dynamic SEO | C – Hybrid Identity |
| ADR-009 | Observability, Analytics & Privacy | B – OpenTelemetry + Privacy-first Analytics |
| ADR-010 | Testing & Quality Gates | B – Risk-Based Quality Gates |
| ADR-011 | Security Architecture | B – Defense in Depth, Solo Maintainer |
| ADR-012 | Performance, Caching & Scalability | B – Immutable ContentSnapshot + Multi-Level Caching |
| ADR-013 | Content Validation & Publishing | B – Automated Validation + Manual Publishing (utan AI) |
| ADR-014 | Internationalization & Accessibility | B – Multilingual-ready med tillgängliga språk |
| ADR-015 | Solution Architecture | B – Modular Monolith |
| ADR-016 | Developer Experience & Repo Standards | B – Developer-first Open Source Repository |
| ADR-017 | Licensing, Branding & Reusability | A – Personal Open Source Showcase |
| ADR-018 | Requirements Baseline & Delivery | B – Vertical Slice Delivery |

## Beslut i detalj

### ADR-001: Portfolio-first

**Valt alternativ:** B – Portfolio-first med dokumentvy

**Beslut**

Startsidan är en visuellt tydlig konsultportfolio. Komplett och trogen Markdown-dokumentvy finns som alternativ.

**Tekniska konsekvenser och avgränsningar**

Besökaren får en effektiv introduktion och kan fördjupa sig i fullständigt CV. Inget innehåll får utelämnas i dokumentvyn.

### ADR-002: Content Intelligence

**Valt alternativ:** C – Automatisk klassificering med valfria metadata

**Beslut**

Markdig AST och deterministiska C#-regler identifierar sektioner och presentationsmönster. Valfri metadata kan styra mappning; okända sektioner får generisk fallback.

**Tekniska konsekvenser och avgränsningar**

Markdown-strukturen får variera. Ingen runtime-AI, inga obligatoriska hårdkodade CV-rubriker. Specialiserad layout kräver tillräckligt säker klassificering.

### ADR-003: Frontend och rendering

**Valt alternativ:** B – Balanced Hybrid

**Beslut**

Blazor Web App med Static SSR som huvudmodell. TypeScript driver webbläsarinteraktioner, animationer, Mermaid och Experience Engine. Selektiv Blazor-interaktivitet endast när motiverad.

**Tekniska konsekvenser och avgränsningar**

Innehåll ska vara läsbart utan JavaScript. Undvik permanent SignalR-förbindelse eller full WASM för trivial interaktion.

### ADR-004: Theme & Easter Egg Engine

**Valt alternativ:** B – Modulär Experience Architecture

**Beslut**

Separata Theme Engine och Easter Egg Engine, gemensam orkestrering, deklarativa manifest, kalenderregler, temalager och tydliga modulkontrakt.

**Tekniska konsekvenser och avgränsningar**

Permanenta easter eggs finns året runt. Högtider och födelsedag styr visuella lager. Respektera reduced motion, prestandabudget och felisolering.

### ADR-005: Content Delivery & Deployment

**Valt alternativ:** B – Runtime Content

**Beslut**

Publikt applikationsrepo och privat CV-repo. Versionssatta app- och CV-releaser med separat CI/CD, filbaserat runtime-content på IIS, validering, caching och rollback.

**Tekniska konsekvenser och avgränsningar**

CV kan uppdateras utan ombyggnad och omstart av appen. Privat innehåll utanför webbroot. Skyddad deployment utan produktionshemligheter i publika CI-jobb.

### ADR-006: Design System & Visual Architecture

**Valt alternativ:** B – Tailwind + egna Blazor-komponenter; Scandinavian Editorial

**Beslut**

Tailwind CSS, semantiska design tokens, egen Razor-komponentuppsättning, komponentnära CSS och separat Markdown-typografi. Ljus, typografiskt driven Scandinavian Editorial som huvudidentitet.

**Tekniska konsekvenser och avgränsningar**

Inget tungt generellt Blazor UI-bibliotek som bas. Högtidsteman får ändra tokens/effekter utan att bryta struktur eller tillgänglighet.

### ADR-007: Navigation & Discovery

**Valt alternativ:** C – Hybrid Navigation + Command Palette

**Beslut**

Scrollbaserad editorial-startsida och serverrenderade detaljroutes, fullständig CV-vy, global Command Palette, CV-sökning och stabila deep links.

**Tekniska konsekvenser och avgränsningar**

Innehållsbaserade routes får endast skapas när det finns tillräcklig struktur och stabil identitet. Vanliga länkar och browser history måste fungera.

### ADR-008: Professional Identity & Dynamic SEO

**Valt alternativ:** C – Hybrid Identity

**Beslut**

Privat identitetsmanifest äger stabil identitet, kontakt och profilbild; Markdown äger erfarenhet och kompetens. SEO, JSON-LD, sitemap och sociala previews skapas från versionerad innehållsmodell.

**Tekniska konsekvenser och avgränsningar**

En sammanhängande snapshot ger konsekventa sidtitlar, metadata och innehåll. SEO får inte hitta på meritinformation.

### ADR-009: Observability, Analytics & Privacy

**Valt alternativ:** B – OpenTelemetry + Privacy-first Analytics

**Beslut**

Strukturerad .NET-loggning, health checks, OpenTelemetry metrics/traces, utbytbar backend och separat, integritetsvänlig aggregerad besöksanalys.

**Tekniska konsekvenser och avgränsningar**

Ingen tung observability-stack som krav i MVP. Separera drifttelemetri och analys; analysera integritet, samtycke och retention för vald lösning.

### ADR-010: Testing & Quality Gates

**Valt alternativ:** B – Risk-Based Quality Gates

**Beslut**

Separata Application CI, Content CI och Deployment Verification; xUnit, Vitest, Playwright, Markdown-fixtures, Mermaid-, säkerhets-, tillgänglighets- och visuella regressionstester.

**Tekniska konsekvenser och avgränsningar**

Blockera säkerhetskritiska och funktionellt kritiska fel; hantera mindre avvikelser som varningar. CV-ändring kräver inte generell ombyggnad av applikation.

### ADR-011: Security Architecture

**Valt alternativ:** B – Defense in Depth, Solo Maintainer

**Beslut**

Publikt och forkbart kodrepo med ensam maintainer. Separera CI från privat content och produktions-CD. Sanera Markdown, säkra Mermaid, implementera CSP, begränsa IIS-rättigheter och verifiera artifacts.

**Tekniska konsekvenser och avgränsningar**

Avancerad extern bidragsgivarprocess behövs inte; publicering är inte liktydigt med skrivrätt. Opålitliga fork-PR-workflows begränsas. Ingen publik adminyta.

### ADR-012: Performance, Caching & Scalability

**Valt alternativ:** B – Immutable ContentSnapshot + Multi-Level Caching

**Beslut**

Förberäknad immutable modell för portfolio, dokument, sökindex och SEO. Atomärt snapshot-byte; versionsbaserade assets, selektiv Output Cache och lazy loading.

**Tekniska konsekvenser och avgränsningar**

Varje request använder en och samma snapshot. Inga externa cacheberoenden i MVP. Äldre versionsresurser hålls åtkomliga vid övergång.

### ADR-013: Content Validation & Publishing

**Valt alternativ:** B – Automated Validation + Manual Publishing (utan AI)

**Beslut**

AI skapar Markdown utanför systemet. Privat Content CI gör deterministisk validering, AST-/textdiff och privat preview; publicering sker manuellt via vald verifierad release.

**Tekniska konsekvenser och avgränsningar**

Ingen LLM eller AI-assisterad review i app, CI eller publiceringsflöde. Manuell godkännandeåtgärd skiljs från commit.

### ADR-014: Internationalization & Accessibility

**Valt alternativ:** B – Multilingual-ready med tillgängliga språk

**Beslut**

Stöd för svenska och engelska via separata Markdown-filer och lokaliserade resurser. Endast språk med publicerad CV-fil exponeras. WCAG 2.2 AA som mål.

**Tekniska konsekvenser och avgränsningar**

Enbart svenskt CV ger bara svenska; enbart engelskt ger bara engelska. Språkväljare döljs vid ett språk. Ingen automatisk översättning eller tomma språk-URL:er.

### ADR-015: Solution Architecture

**Valt alternativ:** B – Modular Monolith

**Beslut**

Separata .NET-projekt: Web, Content, Experience, Publishing, Infrastructure och Contracts; separat TypeScript-build. En IIS-hostad applikation.

**Tekniska konsekvenser och avgränsningar**

Kärnlogiken är oberoende av Blazor/IIS. Kontrakt och dependency injection vid verkliga gränser. Ingen CQRS/microservices som standard.

### ADR-016: Developer Experience & Repo Standards

**Valt alternativ:** B – Developer-first Open Source Repository

**Beslut**

Reproducerbar setup, exempel-CV, utvecklingsskript, central NuGet-hantering, låsta npm-beroenden, automatiska tester, ADR-dokumentation och oberoende publik CI.

**Tekniska konsekvenser och avgränsningar**

Andra ska kunna klona/forka och köra exempel-CV utan privata filer. Detta är teknisk tillgänglighet, inte krav på en generisk produktplattform.

### ADR-017: Licensing, Branding & Reusability

**Valt alternativ:** A – Personal Open Source Showcase

**Beslut**

Webbplatsen är främst konsultens egen portfolio och tekniska showcase. Koden är publik och forkbar, men inget generellt portfolio-framework, branding-editor eller multi-tenant-system prioriteras.

**Tekniska konsekvenser och avgränsningar**

ADR-016:s reproducerbarhet behålls; krav på generell konfigurationsprodukt och återanvändbar onboarding prioriteras bort. Slutligt licensval återstår.

### ADR-018: Requirements Baseline & Delivery

**Valt alternativ:** B – Vertical Slice Delivery

**Beslut**

Implementera kompletta testbara vertikala leveranser med P0-baseline. Första produktionsversionen omfattar portfolio, Markdown/Mermaid, sökning, grundteman, minst ett easter egg och fungerande IIS-flöde.

**Tekniska konsekvenser och avgränsningar**

Bygg inte samtliga visuella experiment före release. Varje slice går från innehåll och kod till tester och fungerande leverans.

## Tvärgående principer

- CV är innehåll, inte applikationskod. Markdown och tillhörande assets publiceras genom ett separat privat flöde.
- All klassificering och all publiceringsvalidering är deterministisk. AI används endast utanför lösningen för att författa Markdown.
- Portfolio-first får inte innebära informationsförlust. Dokumentvyn ska återge allt tillåtet och publicerat innehåll.
- Säkerhetsgränser gäller även för ensam maintainer: publik CI ska inte nå privat CV eller produktionsdeployment.
- Applikations- och innehållsreleaser ska kunna återställas separat; en HTTP-request ska använda en konsekvent ContentSnapshot.
- Teman och easter eggs får aldrig försämra läsbarhet, tillgänglighet eller driftsäkerhet.

## Preciseringar mellan besluten

- **ADR-002 och ADR-013:** Automatisk betyder regelbaserad och deterministisk analys, inte LLM-integration.
- **ADR-014:** Svenska och engelska stöds arkitektoniskt, men bara språk med faktisk CV-fil exponeras. Vid en språkversion döljs språkväljaren; utan CV-fil stoppas publicering.
- **ADR-016 och ADR-017:** Publik, forkbar och lättbyggd källkod kvarstår. Ett generellt portfolio-framework, branding-editor eller multi-tenant-system är inte projektmål.
- **ADR-011:** Defense in Depth kvarstår, med förenklad granskningsprocess eftersom en person underhåller repot. Externa fork-PR-workflows ska begränsas.
- **ADR-005 och ADR-012:** Runtime-content ska valideras före atomär aktivering, och tillgångar ska ha versionsbaserade URL:er.
- **ADR-013:** Manuell publicering av verifierad release, efter automatisk validering, structural diff och privat preview. Ingen AI-assisterad granskning.
- **ADR-017:** Licensval (t.ex. MIT eller Apache 2.0) diskuterades men är inte slutligt fastställt.

## Öppna frågor inför implementation

- Exakt domän, IIS/Windows Server-version, nätverksåtkomst och vald säker deploymentkanal.
- Slutlig open source-licens och rättighetshantering av personliga bilder och varumärken.
- Vilka kalenderhändelser och permanenta easter eggs som ingår i v1.0 utöver jul/nyår och minst ett permanent easter egg.
- Konkreta Markdown-extensions, kompatibilitetsversioner och policy för rå HTML, externa bilder och SVG.
- Mätbara prestandabudgetar, analytics-leverantör och integritetsbedömning.
- Exakt content-manifest, versionsidentifiering, rollback-fönster och publiceringsgodkännande.
