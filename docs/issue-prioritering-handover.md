# Handover: öppna issues och prioriterad implementation

**Datum:** 2026-10-29  
**Repo:** [cv-online-presenter](https://github.com/fredrik-hellmangroup/cv-online-presenter)

## Statusuppdatering 2026-10-30

GitHub-status kontrollerad: #25–#27 och #29–#32 är stängda efter mergad app-PR #33 och content-PR #2. #28 är enda kvarvarande kodissue; #7 och #8 väntar på staging, och #11 är öppen som tracker. För #28 finns nu separata Theme/Easter Egg Engines, manifest, jul-/nyårslager och Tailwind-bygge på arbetsgren. Lokal verifiering: 5/5 klienttest, 16/16 .NET-test och 58 passerade/20 avsiktligt hoppade Playwright-test i Chromium, Firefox och WebKit. Stagingstatus är fortfarande 0 Environments, 0 self-hosted runners och 0 repository variables. Oregistrerade källdokument i app-repots rot har bevarats och ingår inte i kodändringen.

## Omfattning

Genomgången hittade 11 öppna issues: #7, #8, #11 och #25–#32. Issue #11 är en samlande tracker för PRD-arbetet; dess kvarvarande arbete motsvaras redan av #7, #8 och #25–#32. Implementera alltså de tio konkreta uppföljningarna och stäng trackern sist.

## Föreslagen körordning

| Steg | Issue | Prioritet | Skäl och beroenden |
| --- | --- | --- | --- |
| 1 | [#25 – Align server rendering with ADR-003](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/25) | P0 / beslut först | Bestäm och dokumentera om appen ska gå över till Blazor Static SSR enligt ADR-003, eller om en uttrycklig ägargodkänd avstämning ska ändra ADR/PRD. Detta påverkar sidrendering och detaljvyer i #27. |
| 2 | [#32 – Enforce module boundaries](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/32) | P0 / grund | Ge behållna projekt tydliga ansvar, lägg till automatiska beroenderegler och ersätt/ta bort `Class1`-platshållare. Gör verkliga kontrakt synliga innan fler moduler byggs. |
| 3 | [#29 – Add application quality gates](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/29) | P0 / grund | Lägg testprojekt och CI-grindar för parser, validering/sanering, routes och kritiska flöden tidigt så kommande vertikala ändringar skyddas. |
| 4 | [#31 – Publish owner-approved CV content](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/31) | P0 / innehåll | Granska och publicera godkända fakta i content-repot, bevara proveniens, och uppdatera submodulepekaren. Säkerställ att inga extra kontaktuppgifter eller länkar följer med. Kan göras parallellt med steg 2–3. |
| 5 | [#26 – Classified snapshots and runtime activation](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/26) | P0 / innehållsplattform | Implementera deterministisk Markdig AST-klassificering, validerade immutable snapshots, atomär aktivering samt samstämmig identitet/SEO. Detta är bas för publicerat innehåll och discovery. |
| 6 | [#27 – Full CV view and discovery](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/27) | P0 / produkt | Bygg komplett dokumentvy, sökning, Command Palette, stabila detaljrutter och deep links. Indexera endast publicerat och validerat innehåll. Bygger på #25 och innehållsmodellen i #26; använd godkänt innehåll från #31. |
| 7 | [#28 – Modular theme and easter-egg engines](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/28) | P1 / upplevelse | Separera motorer med manifest, regler och lager; verifiera kontrast och reduced motion. Kan utvecklas parallellt med #26–#27 när gränserna från #32 finns. |
| 8 | [#30 – OpenTelemetry metrics and traces](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/30) | P1 / drift | Lägg till utbytbar OpenTelemetry-export och releasekorrelerad telemetri utan persondata. Besöksanalys förblir separat och avstängd. Görs efter att huvudflödena stabiliserats och före release. |
| 9 | [#7 – IIS release and health check](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/7) | P1 / staging | Pipeline och PR #19 är redan mergade. Slutför miljökonfiguration och staging-verifiering när target, URL, runner, IIS och .NET 10 Hosting Bundle finns. |
| 10 | [#8 – Rollback runbook and release notes](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/8) | P1 / staging | Runbook och lokalt artifact smoke check är klara. Kör live rollback på staging efter #7, med två releaser och godkänd HTTPS health URL. |
| 11 | [#11 – PRD implementation tracker](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/11) | Avslut | Uppdatera status och stäng när #7, #8 och #25–#32 är klara, inklusive dokumenterade undantag och verifiering. |

## Beroendekarta

```text
#25 rendering decision ─────────────┐
#32 module boundaries ──┬─> #28     ├─> #27 full CV and discovery
#29 test gates ─────────┴─> #26 ────┘
#31 approved content ────────────────┘

#30 observability ──> release readiness
#7 staging setup ──> #8 live rollback ──> #11 tracker close
```

Fundamenten #29 och #32, innehållsgranskningen #31 samt renderingbeslutet #25 kan startas i separata arbetsströmmar. Håll #27 efter beslutet i #25 och den validerade snapshotmodellen i #26.

## Kända beslut och blockerare

- Owner-beslut i #11: app- och content-repon är publika; svenska (`sv-SE`) är enda godkända första locale; befintliga CV-fakta är godkända för publicering. Ytterligare kontaktuppgifter och länkar kräver separat godkännande.
- Standard canonical URL är `https://hellmangroup.se`. Hostingprovidern ansvarar för IIS/TLS. Analytics och strukturerad data hålls avstängda tills de godkänts; `logo.svg` är fortfarande en releaseförutsättning.
- #25 behöver uttryckligt beslut om dokumenterad arkitekturkonflikt innan valet implementeras.
- #31 kräver verifiering av fakta och proveniens samt granskad content-commit innan appens submodulepekare uppdateras.
- #7 väntar på staging Environment-värden (`IIS_STAGING_ROOT`, `IIS_STAGING_SITE`, `IIS_STAGING_APP_POOL`, `IIS_STAGING_HEALTH_URL`), aktiveringsvariabel, self-hosted runner märkt `iis-staging`, nätverks-/sitebehörighet och .NET 10 Hosting Bundle.
- #8 kan inte avslutas med enbart lokalt test; den kräver staging från #7, minst två versionsmärkta releaser och genomförd health check/rollback.

## Nästa session

1. Kontrollera att den här planen fortfarande matchar öppna issue-statusar.
2. Starta med #25, #32 och #29; parallellt granska fakta och källor för #31.
3. Dokumentera beslut/blockerare direkt i respektive issue och låt varje kodsteg uppfylla issue-kriterierna.
4. Samordna staginguppgifter med hosting-/repoägaren; stäng inte #7 eller #8 förrän deras live-kriterier är verifierade.
5. Uppdatera #11 och stäng den efter att alla konkreta uppföljningar är klara.

## Öppna issues, fullständig lista

- [#7 – Automatisera versionsmärkt IIS-release med health check](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/7)
- [#8 – Dokumentera rollback, runbook och release notes](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/8)
- [#11 – Implementera PRD för konsultportfolio (tracker)](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/11)
- [#25 – Align server rendering with ADR-003](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/25)
- [#26 – Implement classified content snapshots and runtime activation](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/26)
- [#27 – Deliver full CV document view and discovery](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/27)
- [#28 – Implement modular theme and easter-egg engines](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/28)
- [#29 – Add application unit and integration quality gates](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/29)
- [#30 – Add OpenTelemetry metrics and traces](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/30)
- [#31 – Publish owner-approved CV content](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/31)
- [#32 – Enforce module boundaries and replace placeholders](https://github.com/fredrik-hellmangroup/cv-online-presenter/issues/32)
