# DS024 — HDC/VSA Retrieval Backend

## Purpose
Defines the HDC/VSA associative retrieval backend
used by one or more KB plugins, typically
`kb-balanced`.

## Architectural Position

HDC/VSA is no longer a user-visible profile or mode.
It is a retrieval backend behind a `kb-plugin`.

## Dependencies

- DS023 — KB plugins
