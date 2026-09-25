# Learning Worker — Crucible / Nexus Learning Integration Plan

Learning-Worker is the scheduled deterministic claim-extraction worker in The Crucible's learning subsystem. It is not a general AI trainer and cannot promote knowledge.

## Fixed boundary

- consumes only oversight-approved encrypted delivery;
- verifies exact hashes and independent oversight signatures;
- extracts bounded candidate evidence;
- persists authenticated encrypted worker state;
- publishes only candidate-only oversight exports;
- treats extracted learning material as Insufficient Evidence;
- cannot write trusted Crucible learning state or authorize promotion.

## Operational relationship

The worker participates in Crucible's learning system, while Nexus consumes the resulting verified capabilities indirectly through The Crucible. Nexus does not bypass the worker, custody, or oversight boundaries.

## Plan

1. Keep source intake bounded and content-addressed.
2. Verify oversight signature and exact ciphertext hash before decryption.
3. Extract candidates without promotion.
4. Preserve exact source, worker, and vetted-state lineage.
5. Publish only candidate-only oversight snapshots through the existing export path.
6. Let independent oversight authenticate, validate, merge, re-encrypt, sign, and publish vetted delivery.
7. Verify restart, duplicate, changed-source, blocked-source, and zero-progress failure behavior.
8. Demonstrate a real candidate through the full Crucible scientific-learning gates before declaring learning operational.