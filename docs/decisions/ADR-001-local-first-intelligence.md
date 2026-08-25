# ADR-001: Local-First Intelligence and Paid-AI Escalation

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

SaltBox may discover and analyze very large numbers of businesses. Using a paid frontier model for each prospecting, analysis, scoring, or generation step would create unnecessary per-request cost, constrain scale, and couple core workflows to a vendor's availability, pricing, and product lifecycle.

Most early-funnel work does not require frontier-model reasoning. DNS and HTTP checks, website measurements, parsing, metadata extraction, deterministic scoring, state transitions, template rendering, and many outreach operations can be performed by ordinary software. Tasks that materially benefit from language understanding can often run on owned or self-hosted compute.

SaltBox needs a clear policy that prevents paid inference from silently becoming the default while still allowing higher-quality escalation when commercial value or customer needs justify it.

## Decision

SaltBox will prioritize tasks in this order:

1. Deterministic software
2. Lightweight local inference
3. Stronger local inference
4. Explicitly authorized paid inference

SaltBox will attempt to solve each task at the lowest reasonable level. Paid inference will be disabled by default and may be used only after a separate policy decision considers the task, prior attempts, confidence, expected economic value, prospect lifecycle state, customer status, and allowed inference budget.

Local/self-hosted inference will be treated as a first-class provider. Paid APIs will be optional adapters behind SaltBox-owned capability abstractions. Development workspaces and orchestration tools may assist experimentation but will not become hard production dependencies.

Future model-assisted operations should prefer minimal inputs, schema-validated structured outputs, caching where freshness allows, and batch processing after deterministic filtering. The production system must degrade gracefully when local or paid inference is unavailable.

This ADR establishes architectural direction only. It does not select a model, provider, inference runtime, framework, package manager, database, or implementation approach, and it does not authorize installing or building AI infrastructure now.

## Consequences

### Positive

- Extremely low marginal AI cost for high-volume early-funnel work
- Reduced vendor and pricing dependency
- Better scalability and resilience
- More predictable and testable behavior
- Easier offline and local development
- Explicit control over when commercial value justifies paid inference

### Tradeoffs

- Local compute and hardware requirements
- Model acquisition, lifecycle, and operational management
- Potentially lower quality on difficult tasks
- Additional routing and policy logic
- Confidence calibration, validation, fallback, and retry requirements
- Capacity planning for queued local workloads

## Status

Accepted.
