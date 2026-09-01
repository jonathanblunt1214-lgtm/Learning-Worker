# Learning Worker

Private scheduling control for The Crucible's deterministic claim-extraction worker.

This repository contains no committed plaintext training documents, extracted source content, transport keys, credentials, or durable learning state. Every ten minutes its ephemeral GitHub-hosted worker pulls only oversight-approved ciphertext from the separate private vetted-custody store. Crucible cannot publish to that store. The worker verifies the independent oversight signature and exact ciphertext hash before temporary decryption, then destroys runner plaintext and persists only authenticated encrypted state.

## Fixed operating boundary

- Project identity: `github:jonathanblunt1214-lgtm/The-Crucible`
- Hosted custody: private release assets encrypted before upload; plaintext exists only in the ephemeral job workspace and is discarded with the runner
- Maximum sources per run: 25
- Maximum active documents per run: 9
- PDF pages per document: adaptive 70-page normal mode, 35-page fallback mode
- Candidate-count cutoff inside a bounded source window: none
- Learning classification after extraction: `Insufficient Evidence`
- Promotion, repository assimilation, and writes to The Crucible: prohibited
- Extraction requires a signed independent-oversight approval bound to the exact source content hash; unvetted sources remain inhibited.

The workflow has a concurrency lock and a 20-minute job timeout. Adaptive throughput state is retained only inside the authenticated encrypted state asset. A prior timed-out workflow immediately selects 35 pages; two consecutive completed runs longer than 15 minutes also select 35. Three consecutive runs of 10 minutes or less restore 70 pages. Its token can update only this private worker repository's encrypted release-state asset. It cannot write to The Crucible.
