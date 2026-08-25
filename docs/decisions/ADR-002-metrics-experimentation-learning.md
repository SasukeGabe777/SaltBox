# ADR-002 — Metrics, Experimentation & Continuous Learning

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

SaltBox is intended to operate a high-volume acquisition and fulfillment system. Activity counts such as businesses scraped, emails found, demos generated, messages sent, opens, or raw replies can describe operations, but they do not establish whether SaltBox is creating economic value. Optimizing those proxy metrics in isolation can increase cost, harm deliverability, attract low-value customers, or hide unprofitable growth.

Initial targeting, scoring, demo, outreach, timing, offer, and pricing decisions will necessarily begin as human hypotheses. If SaltBox stores only final scores and aggregate totals, it will be unable to determine which inputs or strategies caused profitable outcomes. It must preserve structured observations, decision provenance, experiment exposure, costs, and downstream outcomes so those hypotheses can be tested and refined.

## Decision

SaltBox will treat data collection, outcome measurement, experimentation, and continuous model or rule refinement as first-class architectural requirements.

SaltBox should become progressively better at answering:

```text
Which businesses should we target?
Which businesses should we ignore?
Which businesses deserve a demo?
What type of demo should they receive?
What message should they receive?
When should they receive it?
What offer should they receive?
How much should SaltBox spend acquiring them?
What is the probability they become profitable customers?
```

These decisions should eventually be driven by observed SaltBox outcomes rather than permanent human guesses. SaltBox's own statistically meaningful conversion and profitability data should eventually outrank generic benchmarks and intuition.

### Optimization objective

SaltBox will not treat activity as its ultimate objective. Operational and funnel metrics remain necessary, but optimization should increasingly move toward economic outcomes as sufficient data becomes available.

Long-term north-star candidates are:

```text
Expected Profit Per Prospect

Net Profit Per 1,000 Businesses Discovered
```

Their exact accounting definitions will be established later. Revenue alone is insufficient because acquisition and fulfillment costs matter; profit takes precedence over gross activity and gross revenue.

### Expected Prospect Value

SaltBox should eventually estimate:

```text
Expected Prospect Value
=
P(conversion)
×
Expected Revenue
×
Expected Gross Margin
-
Expected Acquisition Cost
```

This concept should inform whether SaltBox enriches more data, generates a demo, sends or follows up on outreach, invokes stronger local inference, permits paid inference, or requests human attention. It is an architectural decision criterion, not a formula implemented by this ADR.

### Learning records

SaltBox should preserve independently inspectable source observations and prospect features, not only derived values such as a final lead score. Features and provenance should be versionable where practical. Important automated decisions should record their value, time, reason, rules or model version, input-feature version, confidence where applicable, and experiment exposure. Outcomes should connect delivery, engagement, sales, customer, cost, revenue, and retention events back to the prospect and strategy that produced them.

Raw observations often cannot be reconstructed, while derived scores can be recalculated. SaltBox should retain the source, collection time, field, confidence, and freshness needed to distinguish recent evidence from stale data, subject to privacy, retention, and compliance requirements.

### Experimentation and causal integrity

Meaningful strategy changes should eventually be measurable through controlled experiments where practical. Important experiments must preserve control groups, deterministic and reproducible assignment, eligibility rules, exposure records, primary metrics, guardrail metrics, and versioned strategy inputs. Retries must not silently move a prospect between variants.

SaltBox should begin with simple controlled experiments. Adaptive techniques such as multi-armed bandits, contextual bandits, or adaptive allocation may be evaluated only after volume and measurement quality justify them. Exploration should continue carefully so SaltBox can detect changing conditions and false-negative targeting rules.

### Continuous learning

The foundational feedback loop is:

```text
DISCOVER
    ↓
MEASURE FEATURES
    ↓
SCORE
    ↓
ACT
    ↓
OBSERVE OUTCOME
    ↓
MEASURE
    ↓
LEARN
    ↓
REFINE STRATEGY
    ↓
DISCOVER
```

Rejected prospects remain useful learning data. Where feasible and safe, carefully controlled exploration samples may test whether rejection rules are too aggressive or features are incorrectly weighted without undermining targeting quality, consent, brand safety, or deliverability.

## Relationship to ADR-001

[ADR-001](ADR-001-local-first-intelligence.md) asks:

> What is the cheapest sufficient intelligence required for this task?

ADR-002 asks:

> Is performing this task economically worthwhile, and did it produce value?

Together they establish a central SaltBox pattern:

```text
VALUE-AWARE DECISION
        ↓
CHEAPEST SUFFICIENT METHOD
        ↓
ACTION
        ↓
MEASURE RESULT
        ↓
LEARN
        ↓
BETTER VALUE ESTIMATE
```

ADR-002 supplies the outcomes and expected-value estimates that should govern ADR-001's inference budgets and paid-AI escalation. ADR-001 constrains the cost of producing actions whose value ADR-002 measures.

## Consequences

### Positive

- Targeting and spending can improve using first-party economic outcomes.
- Decisions remain explainable and reproducible across rule or model versions.
- Experiments can distinguish causal improvements from coincidental changes.
- Cost, revenue, margin, and lifetime-value signals can replace misleading activity optimization.
- Rejected prospects and failed strategies can still improve future decisions.
- Deliverability, customer experience, and brand-health guardrails can constrain optimization.

### Tradeoffs

- Event definitions, attribution, feature provenance, and versioning require discipline.
- Long sales cycles and sparse conversions delay statistically reliable conclusions.
- Control groups and exploration may withhold a currently preferred strategy from some eligible prospects.
- Privacy, retention, and compliance requirements constrain which raw observations can be preserved.
- Causal claims require careful experiment design and resistance to premature conclusions.
- Economic metrics require consistent cost and revenue definitions.

## Scope

This ADR establishes architectural direction only. It does not create database schemas, analytics infrastructure, tracking scripts, dashboards, experimentation software, event queues, machine-learning models, accounting logic, or third-party analytics integrations. It does not select a database, analytics vendor, framework, package manager, runtime, model, or ML library.

## Status

Accepted.
