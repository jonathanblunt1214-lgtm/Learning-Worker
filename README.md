# Learning Worker

Private scheduling control for The Crucible's deterministic claim-extraction worker.

This repository contains no plaintext training documents, extracted source content, transport keys, credentials, or durable learning state. A GitHub-hosted Windows runner checks out the public `development` branch of The Crucible and processes client-side authenticated encrypted source/state release assets every ten minutes. The AES-256-GCM key is stored only as a GitHub Actions secret and a local Windows DPAPI recovery copy.

## Fixed operating boundary

- Project identity: `github:jonathanblunt1214-lgtm/The-Crucible`
- Hosted custody: private release assets encrypted before upload; plaintext exists only in the ephemeral job workspace and is discarded with the runner
- Maximum sources per run: 25
- Maximum active documents per run: 9
- PDF pages per document: adaptive 70-page normal mode, 35-page fallback mode
- Candidate-count cutoff inside a bounded source window: none
- Learning classification after extraction: `Insufficient Evidence`
- Promotion, repository assimilation, and writes to The Crucible: prohibited

The workflow has a concurrency lock and a 20-minute job timeout. Adaptive throughput state is retained only inside the authenticated encrypted state asset. A prior timed-out workflow immediately selects 35 pages; two consecutive completed runs longer than 15 minutes also select 35. Three consecutive runs of 10 minutes or less restore 70 pages. Its token can update only this private worker repository's encrypted release-state asset. It cannot write to The Crucible.
