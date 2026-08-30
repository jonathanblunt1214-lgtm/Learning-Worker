# Learning Worker

Private scheduling control for The Crucible's deterministic claim-extraction worker.

This repository contains no training documents, extracted source content, transport keys, credentials, or durable learning state. A dedicated Windows self-hosted GitHub Actions runner checks out the public `development` branch of The Crucible and processes the local repository-bound queue every ten minutes.

## Fixed operating boundary

- Project identity: `github:jonathanblunt1214-lgtm/The-Crucible`
- Local queue: `%LOCALAPPDATA%\The-Crucible\scientific-learning\sources\source-queue.json`
- Local store: `%LOCALAPPDATA%\The-Crucible\scientific-learning`
- Maximum sources per run: 25
- PDF pages per run: 20
- Candidate-count cutoff inside a bounded source window: none
- Learning classification after extraction: `Insufficient Evidence`
- Promotion, repository assimilation, and writes to The Crucible: prohibited

The workflow has a concurrency lock, a 20-minute job timeout, read-only repository permissions, and a manual kill-switch file at `%LOCALAPPDATA%\The-Crucible\scientific-learning\EXTRACTION-KILL`.

