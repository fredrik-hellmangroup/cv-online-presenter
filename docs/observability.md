# Operational telemetry

The Web host records request counts, duration and spans by route template and status code. It does not record query strings, visitor identity, IP address, user-agent, raw paths, contact details or activation tokens. Error logs and spans carry the build ID plus app/content revisions from `build-metadata.json`, making release regressions traceable without visitor analytics.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to use an OTLP-compatible collector; without it, no external exporter is enabled. The backend can be changed by collector configuration. Keep collector credentials in the hosting environment, not this repository. Visitor analytics and structured data remain separate and disabled until explicitly approved.
