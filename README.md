# SaltBox

SaltBox is intended to become an end-to-end autonomous website sales and fulfillment platform. It will discover businesses that lack an effective website, evaluate each opportunity, generate a personalized demo for qualified prospects, conduct outreach, and support the resulting customer relationship through production and ongoing service.

The goal is high automation with clear operator visibility. Important decisions, unusual cases, failures, and sensitive conversations must remain inspectable and capable of human escalation.

> [!IMPORTANT]
> The original SaltBox marketing prototype has been imported and preserved under `reference/marketing-prototype/`. It serves as the approved visual and interaction reference. The production implementation under `apps/website/` has not yet been selected or built.

## Intelligence policy

**SaltBox must be deterministic-first, local-AI-first, and paid-AI-last.** It should always use the lowest reasonable intelligence level for a task:

```text
LEVEL 0 — DETERMINISTIC SOFTWARE
        ↓
LEVEL 1 — LIGHTWEIGHT LOCAL MODEL
        ↓
LEVEL 2 — STRONGER LOCAL MODEL
        ↓
LEVEL 3 — PAID FRONTIER MODEL
```

Ordinary software, parsers, crawlers, browser automation, structured metadata, analytics, rules, and scoring systems should perform work that does not materially benefit from an LLM. Local/self-hosted models are the first AI option when language understanding or generation is useful. Paid frontier inference is an explicitly authorized escalation for cases where expected economic value, customer intent, or quality requirements justify its cost; it must never silently become the default.

Two explicit architectural goals follow:

> SaltBox should be capable of discovering, analyzing, scoring, and rejecting 10,000 businesses with $0 in third-party LLM API charges.

> SaltBox should be capable of generating large batches of personalized demo websites using owned/self-hosted compute without requiring paid LLM inference.

This is not a claim that SaltBox has no operating costs. Hosting, domains, email, data providers, proxies, storage, electricity, and compliance-safe data acquisition may cost money. The goal is to avoid unnecessary per-request AI API charges at scale.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the future Model Router, inference budgets, structured-output rules, graceful degradation, and domain-specific design. The accepted decision is recorded in [ADR-001: Local-First Intelligence and Paid-AI Escalation](docs/decisions/ADR-001-local-first-intelligence.md).

## Learning and economic optimization

SaltBox must be designed as a learning system. Structured prospect features, strategy decisions, experiment exposures, costs, and observed outcomes should eventually improve discovery, qualification, scoring, demo selection, personalization, outreach, timing, pricing, conversion, acquisition cost, and profitability.

The objective is not maximum activity. Businesses scraped, demos generated, emails sent, opens, and raw replies are operational or intermediate metrics. Long-term optimization should move toward:

```text
Expected Profit Per Prospect

Net Profit Per 1,000 Businesses Discovered
```

SaltBox should measure before optimizing, preserve explainability and experiment integrity, and prefer profit over revenue and revenue over activity. Its own statistically meaningful outcomes should eventually outrank permanent human assumptions or generic benchmarks.

[ADR-002: Metrics, Experimentation & Continuous Learning](docs/decisions/ADR-002-metrics-experimentation-learning.md) defines the accepted learning-system decision. It complements ADR-001: expected value determines whether an action is worth taking, and local-first routing determines the cheapest sufficient way to perform it.

## Autonomous pipeline

```text
Business Discovery
        ↓
Public Data Enrichment
        ↓
Website Analysis
        ↓
Lead Scoring
        ↓
Qualified Prospect
        ↓
Demo Website Generation
        ↓
Demo Deployment
        ↓
Personalized Outreach
        ↓
Engagement Tracking
        ↓
AI Sales / Support
        ↓
Customer Conversion
        ↓
Full Website Production
        ↓
Approval
        ↓
Deployment / Ongoing Service
```

At maturity, SaltBox should track discovery and enrichment, analysis and scoring, demo generation and hosting, outreach delivery and engagement, conversations and conversion status, customer approval, billing, domains, deployment, and ongoing website management.

## Repository structure

```text
saltbox/
├── apps/
│   ├── website/          # Future production marketing website
│   ├── admin/            # Future operator dashboard
│   └── demo-sites/       # Future demo-site delivery surface
├── services/
│   ├── prospecting/
│   ├── website-analysis/
│   ├── lead-scoring/
│   ├── demo-generator/
│   ├── outreach/
│   ├── support/
│   └── learning/         # Future metrics, experiments, and learning domain
├── packages/
│   ├── database/
│   ├── ai/
│   ├── email/
│   ├── types/
│   └── shared/
├── assets/
│   └── brand/
├── reference/
│   └── marketing-prototype/ # Approved visual and interaction reference
├── docs/
├── scripts/
├── .env.example
├── .gitignore
├── .editorconfig
└── README.md
```

These folders describe product domains and intended ownership, not a commitment to separate deployments. In particular, `services/` does not imply a microservice architecture.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the proposed system boundaries, lifecycle, and operating principles.

## Development principles

1. Preserve the existing SaltBox website design when it is imported.
2. Do not rewrite working code solely to satisfy architectural preferences.
3. Refactor incrementally, guided by concrete needs.
4. Keep business logic separate from UI where practical.
5. Strongly type shared contracts once the project's language and framework are known.
6. Never expose secrets client-side or commit credentials.
7. Prefer boring, reliable infrastructure over unnecessary complexity.
8. Build for autonomous execution while maintaining operator visibility.
9. Make external automated actions observable and recoverable.
10. Avoid premature microservices; domain folders need not be independently deployed.
11. Solve tasks with deterministic software before introducing AI.
12. Treat local/self-hosted inference as a first-class capability and paid inference as an explicit escalation.
13. Prefer small, schema-validated outputs and minimal context over freeform generation.
14. Measure actual outcomes before optimizing behavior.
15. Preserve raw observations, provenance, decision versions, and explainability where practical.
16. Protect control groups and deterministic experiment assignments.
17. Prefer economic value and profit over activity metrics.
18. Treat targeting and strategy rules as hypotheses that must keep learning from evidence.

## Current development status

This is a framework-neutral repository foundation. There are deliberately no dependencies, package-manager workspace files, build commands, or application implementations yet. After the existing website project arrives, its framework, package manager, directory expectations, and deployment model should be inspected before choosing how it fits into this structure.

Copy `.env.example` to an appropriate local environment file only after the application defines its required configuration. Never place real secrets in `.env.example`.
