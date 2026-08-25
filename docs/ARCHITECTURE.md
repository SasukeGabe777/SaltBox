# SaltBox Architecture

## Status and intent

This document proposes domain boundaries and system behavior without selecting implementation technologies. The existing SaltBox marketing website is pending import, so framework, language, package manager, database, queue, hosting, and deployment decisions remain open.

The architecture should support an autonomous pipeline while preserving human oversight. Automation owns routine execution; operators need enough context to understand decisions, intervene safely, and recover failed work.

## Core intelligence philosophy

**SaltBox must be deterministic-first, local-AI-first, and paid-AI-last.** The mere fact that an LLM can perform a task is not a reason to use one. Every capability should attempt to operate at the lowest reasonable level:

```text
LEVEL 0 — DETERMINISTIC SOFTWARE
        ↓
LEVEL 1 — LIGHTWEIGHT LOCAL MODEL
        ↓
LEVEL 2 — STRONGER LOCAL MODEL
        ↓
LEVEL 3 — PAID FRONTIER MODEL
```

### Level 0 — Deterministic software

Use ordinary software, parsers, crawlers, browser automation, regular expressions, structured metadata, analytics, and deterministic rules whenever practical. Domain and DNS checks, HTTP and HTTPS status, Lighthouse measurements, responsive-design signals, broken links, load performance, metadata and contact extraction, schema and technology detection, copyright year, missing calls to action or contact forms, business-category filters, lead-score calculations, funnel state, templated messages, and rendering from structured content should normally require zero LLM calls.

### Level 1 — Lightweight local model

Use a small self-hosted model when natural-language understanding or generation materially improves the result. Candidate tasks include classifying business descriptions, cleaning extracted facts, producing a very short personalized field, selecting a demo style, summarizing obvious weaknesses, and extracting fields from messy unstructured text.

### Level 2 — Stronger local model

Use a more capable local or self-hosted model only when the lightweight model is insufficient. Appropriate tasks may include nuanced critique, higher-quality demo copy, difficult extraction, synthesizing several pieces of business context, interpreting unusual businesses, and more personalized content.

### Level 3 — Paid frontier model

Paid inference is an optional escalation, never a foundational dependency. It may be used only when policy explicitly permits it and one or more of the following is true:

- Expected economic value justifies the cost.
- Local inference has repeatedly failed.
- A lead has demonstrated meaningful intent.
- A human explicitly requests escalation.
- A premium-quality customer-facing result is required.

Likely cases include qualified replies, active sales conversations, unusual customer requests, high-value opportunities, complex production work, and difficult support conversations. A low-confidence local result alone does not authorize paid inference.

### Economic goals

> SaltBox should be capable of discovering, analyzing, scoring, and rejecting 10,000 businesses with $0 in third-party LLM API charges.

> SaltBox should be capable of generating large batches of personalized demo websites using owned/self-hosted compute without requiring paid LLM inference.

These goals concern unnecessary per-request AI API costs, not total operating cost. Hosting, domains, email infrastructure, data providers, proxies, storage, electricity, CAPTCHA handling, and compliance-safe data acquisition services may still have unavoidable costs.

The governing decision is recorded in [ADR-001: Local-First Intelligence and Paid-AI Escalation](decisions/ADR-001-local-first-intelligence.md).

## Future Model Router

SaltBox should eventually own a Model Router that selects the least expensive capable execution path. This is a conceptual boundary, not a current implementation:

```text
SaltBox Task
      ↓
Can deterministic software solve it?
      │
 YES ─┴─→ execute without AI
      │
      NO
      ↓
LIGHT LOCAL MODEL
      │
Successful?
      │
 YES ─┴─→ continue
      │
      NO
      ↓
STRONG LOCAL MODEL
      │
Successful?
      │
 YES ─┴─→ continue
      │
      NO
      ↓
Is paid escalation allowed
and economically justified?
      │
      ├── NO → flag / queue / graceful fallback
      └── YES
             ↓
        PAID MODEL
```

Routing policy should eventually consider task type, required intelligence level, confidence, latency, local-model availability, hardware availability, estimated token count, estimated dollar cost, prospect value, lead lifecycle state, customer status, previous attempts, and whether paid escalation is enabled. Paid fallback must default to disabled and require a separate policy authorization.

### Confidence-based escalation

Local-model results should return or be associated with a calibrated confidence signal and validation result. High-confidence valid output may continue; low-confidence output may move from the fast local tier to the stronger local tier. Failure at the stronger tier should queue, flag, or use a deterministic fallback unless paid escalation is separately authorized. Confidence is evidence for routing, not spending authority.

### Inference budget

Each prospect or customer may eventually have an allowed inference budget. Exact values remain intentionally undefined, but permitted spending should rise only with expected economic value:

```text
DISCOVERED BUSINESS  → AI budget: $0
QUALIFIED PROSPECT   → AI budget: $0
DEMO VIEWED          → AI budget: extremely small
REPLIED              → AI budget: increased
INTERESTED           → AI budget: higher
CUSTOMER             → AI budget: based on purchased service
```

The governing principle is: **AI spending should increase only as expected economic value increases.** Budget policy should cover cumulative attempts, not only the price of an individual call.

## Efficient inference design

### Structured outputs over freeform generation

Whenever practical, models should return small, schema-defined data rather than large prose blocks. Prefer:

```json
{
  "businessType": "roofing",
  "primaryIssue": "poor_mobile_layout",
  "recommendedTemplate": "contractor-modern",
  "confidence": 0.93
}
```

instead of an essay beginning with “After reviewing this roofing business...” Structured outputs reduce prompt and response size, inference cost, and ambiguity while improving validation, retries, model replacement, and deterministic downstream behavior. Model output must eventually be schema validated. Invalid output should be retryable within policy limits or should fall back safely.

### Minimal context

Never send more context than necessary. Entire websites, complete HTML documents, giant crawl results, full conversation histories, and massive scraped datasets should not automatically enter a model prompt. Reduce input deterministically first:

```text
WEBSITE
  ↓
Crawler
  ↓
Parser
  ↓
Relevant facts extracted
  ↓
Structured website report
  ↓
Small AI request
```

This replaces the expensive and unreliable pattern of sending raw website HTML directly into a huge prompt. The same principle applies to conversations and enrichment data: select the minimum facts required for the task.

### Result caching

Appropriate valid inference results should be reused when the same inputs and model configuration recur. A future cache key may include task, input hash, model, model version, prompt version, and schema version. Cache policy must account for privacy, retention, and freshness; stale customer-facing or time-sensitive information must not be reused merely to save compute.

### Batch processing and deterministic reduction

Low-priority inference should be queueable and batchable. Deterministic filtering should shrink the candidate set before any model runs:

```text
1,000 businesses discovered
            ↓ deterministic filtering
300 candidates
            ↓ deterministic analysis
100 qualified prospects
            ↓ batch lightweight inference
70 demo candidates
```

SaltBox should not invoke a model independently on thousands of businesses when ordinary analysis can eliminate most of them first.

### Graceful degradation

SaltBox must continue its core operations when AI is unavailable. If local inference is offline, prospecting, crawling, deterministic website analysis, lead scoring, and CRM state management should continue. AI-dependent tasks may remain queued or use documented fallbacks. If paid providers are disabled or unavailable, the system must not collapse.

### Development AI workspaces

Odysseus, local AI workspaces, model playgrounds, development agents, and similar orchestration tools may be useful for experimentation and development. They must not become hard production dependencies. Production systems should communicate with inference capabilities through SaltBox-owned abstractions so the product does not inherit the lifecycle or architecture of a third-party AI workspace.

## Metrics, experimentation, and continuous learning

SaltBox must be designed as a learning system. Data collection, outcome measurement, experimentation, and continuous refinement of rules or models are first-class architectural requirements. The governing decision is recorded in [ADR-002: Metrics, Experimentation & Continuous Learning](decisions/ADR-002-metrics-experimentation-learning.md).

Every meaningful prospect interaction should eventually produce structured, attributable outcome data that can improve discovery, qualification, lead scoring, demo selection, personalization, outreach strategy, timing, pricing, conversion, acquisition cost, and profitability.

The objective is not to maximize activity. SaltBox should ultimately optimize for **expected economic value and profit per prospect** and, at the system level, **net profit per 1,000 businesses discovered**.

### Optimization hierarchy

Counts such as businesses scraped, emails found, demos generated, emails sent, email opens, and raw replies are useful operational signals, but they are not the ultimate objective. Outcome quality progresses toward economics:

```text
DELIVERY
    ↓
DEMO VISIT
    ↓
MEANINGFUL ENGAGEMENT
    ↓
POSITIVE RESPONSE
    ↓
SALES INTENT
    ↓
PURCHASE
    ↓
REVENUE
    ↓
GROSS PROFIT
    ↓
CUSTOMER LIFETIME VALUE
```

The optimization target should move increasingly toward revenue and profit as sufficient reliable data accumulates. Long-term north-star candidates are:

```text
Expected Profit Per Prospect

Net Profit Per 1,000 Businesses Discovered
```

Their exact accounting definitions remain deferred. They are more valuable targets than email volume, demo count, open rate, or raw reply rate.

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

This does not prescribe a mathematical implementation. Expected value should eventually inform whether to generate a demo, enrich more data, send outreach, follow up, invoke stronger local inference, permit paid inference, or request human attention. It directly controls the inference-budget concept in ADR-001: expensive intelligence is justified only when the expected value of the action supports it.

### Initial prospect dimensions

An initial conceptual targeting framework should preserve four independently inspectable dimensions. They are categories of evidence, not permanent formulas and not an excuse to hide reasoning inside one opaque score.

#### Need

How badly does the company appear to need SaltBox? Potential signals include:

```text
no website
broken website
poor mobile usability
poor performance
outdated design
missing CTA
broken forms
poor navigation
missing HTTPS
very thin site
poor accessibility
poor SEO fundamentals
```

#### Value

How economically attractive could this customer be? Potential signals include:

```text
industry
estimated customer/job value
business size
number of locations
service category
commercial vs consumer work
advertising activity
market served
potential SaltBox package value
```

#### Activity

Is the business alive and actively acquiring customers? Potential signals include:

```text
recent reviews
review velocity
recent social activity
current opening hours
recent photos
recent posts
job listings
active advertising
new services
new locations
recent business updates
```

#### Reachability

Can SaltBox realistically reach a decision maker? Potential signals include:

```text
valid email
owner/founder identity
decision-maker contact
phone
contact form
social messaging availability
email confidence
delivery likelihood
```

### Trigger events

SaltBox may eventually detect events that create a strong “why now?” signal: a new business, location, incorporation, owner, rebrand, service, market, or social presence; rapid review growth; increased advertising; hiring; or expansion. Trigger detection is future functionality, and event evidence should retain source and time because its value decays.

### Feature storage, raw observations, and provenance

SaltBox should retain useful structured features rather than only a final lead score. A conceptual feature record may include:

```text
industry
location
business age estimate
review count
review rating
review velocity
social activity
advertising indicators
website exists
website performance
mobile quality
SEO score
accessibility score
HTTPS
broken links
CTA quality
contact-form presence
technology stack
website-age indicators
email availability
owner availability
phone availability
lead source
```

Storing only `leadScore = 84` makes future learning and explanation difficult. SaltBox should retain the score and the versioned inputs that produced it. Derived values can often be recalculated; raw observations often cannot. Prefer retaining:

```text
review_count = 137
reviews_last_90_days = 18
website_performance = 31
mobile_pass = false
```

alongside derived values such as:

```text
activity_score = 82
website_need_score = 91
```

Where practical, every observed field should retain source, `collected_at`, field identity, confidence, and freshness. Historical snapshots or feature versions should allow later analysis to reproduce what SaltBox knew when a decision was made. Privacy, consent, retention, and data-use requirements still constrain what may be stored.

### Decision logging and versioning

Meaningful automated decisions should be explicit and attributable. Examples include:

```text
qualified = true
demo_generated = true
template_selected = contractor-modern-02
outreach_variant = email-A
followup_enabled = true
paid_ai_allowed = false
```

Each decision should eventually record its type, value, timestamp, rules or model version, input-feature version, reason, confidence where applicable, and experiment exposure where applicable. Important systems should use identifiable versions such as:

```text
lead-score-v1
lead-score-v2
qualification-rules-v3
demo-selector-v4
conversion-model-v2
```

A historical action should ideally be reproducible from the recorded observations, strategy version, and configuration that authorized it. This extends the auditability requirements without replacing the authoritative CRM state machine.

### Outcome model

Outcome names remain conceptual until a database schema is designed.

#### Outreach outcomes

```text
queued
sent
delivered
bounced
blocked
complaint
unsubscribe
```

#### Demo outcomes

```text
demo visited
first visit time
repeat visit
engaged visit
CTA clicked
contact initiated
```

Email opens may be recorded where permitted, but SaltBox must not rely heavily on them as a primary success metric. Opens can be incomplete, blocked, or inflated and are weaker than meaningful on-site, reply, sales, and purchase outcomes.

#### Sales outcomes

```text
reply
positive reply
negative reply
question
pricing interest
sales conversation
won
lost
```

#### Customer outcomes

```text
purchase
package purchased
revenue
refund
production completion
deployment
subscription start
subscription cancellation
retention
customer lifetime value
```

### Measurable funnel

The CRM lifecycle remains the authoritative workflow state. Analytics should derive a consistent measurable funnel from state transitions and outcome events:

```text
DISCOVERED
    ↓
ENRICHED
    ↓
ANALYZED
    ↓
QUALIFIED
    ↓
DEMO GENERATED
    ↓
OUTREACH DELIVERED
    ↓
DEMO VIEWED
    ↓
RESPONDED
    ↓
POSITIVE RESPONSE
    ↓
PURCHASED
    ↓
ACTIVE CUSTOMER
```

SaltBox should eventually calculate transitions between every stage. Every transition should be filterable by prospect features and strategy variables so aggregate changes can be explained rather than merely observed.

### Cohort analysis

Results should eventually be analyzable by industry, city, state, lead source, website condition, review count, review velocity, business size, lead-score band, demo template, outreach variant, offer, price, campaign, send day, and send time.

This should make it possible to answer questions such as:

- Which industries produce the most revenue per 1,000 prospects?
- Do businesses with recent reviews convert better?
- Which lead-score ranges actually produce customers?
- Which demo template performs best for roofers?
- Which source produces the lowest acquisition cost?
- Which prospects reply often but rarely purchase?
- Which prospects reply less often but have much higher revenue?

### Metrics hierarchy

#### Operational metrics

Businesses discovered, crawl success rate, analysis throughput, demo-generation throughput, queue depth, email delivery, and system failures help operate SaltBox.

#### Funnel metrics

Qualification rate, demo-generation rate, demo-view rate, reply rate, positive-reply rate, and conversion rate help explain movement through the acquisition system.

#### Economic metrics

Revenue per prospect, revenue per demo, revenue per delivered email, customer acquisition cost, gross margin, profit per prospect, profit per 1,000 discovered businesses, customer lifetime value, and LTV:CAC should eventually carry the greatest weight in optimization.

### Future Experimentation Engine

Meaningful changes to targeting rules, lead thresholds, demo templates, hero layouts, CTA text, outreach subjects and bodies, personalization style, send timing, follow-up cadence, pricing, and offers should be experimentally measurable where practical.

A future experiment definition should include:

```text
experiment id
hypothesis
control
variant(s)
start time
end time
eligibility rules
exposure assignment
primary metric
guardrail metrics
sample size
result
status
```

#### Control groups and causal integrity

SaltBox must preserve control groups for important experiments. Changing targeting, email content, demo design, and pricing simultaneously makes it impossible to identify what caused a change in conversions. Prefer controlled experiments in which the causal variable is identifiable, and do not silently alter eligible populations, assignments, or success definitions after an experiment begins.

#### Deterministic assignment

Experiment assignment should be deterministic and reproducible where practical. A prospect must not switch between A and B because a job was retried. A future assignment could derive from `hash(prospect_id + experiment_id)` or an equivalent stable method. This supports idempotency while keeping allocation auditable.

#### Primary and guardrail metrics

Every experiment should define a primary outcome and guardrails. An outreach variation that increases replies while also increasing spam complaints, unsubscribes, negative replies, bounce rate, or brand damage is not necessarily an improvement. Experiment evaluation must consider both intended gain and unacceptable side effects.

#### Exploration and exploitation

Simple controlled experiments should come first. Once SaltBox has meaningful volume and trustworthy measurement, multi-armed bandits, contextual bandits, or adaptive allocation may be evaluated to balance exploration of new approaches with exploitation of current high performers. SaltBox should never completely stop learning, but adaptive methods must not be introduced before their complexity is justified.

### Learning flywheel

The foundational SaltBox feedback loop is:

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

Rejected prospects are learning data too. SaltBox should preserve enough information to ask whether rejection rules were correct, whether rejected groups contained valuable prospects, whether filtering is too aggressive, and whether some features are incorrectly weighted. Where feasible, carefully bounded exploration samples may help detect false negatives without undermining targeting quality, deliverability, consent, or brand safety.

Public benchmarks and established sales or marketing principles may provide initial heuristics. After sufficient evidence accumulates, SaltBox's own measured conversion and profitability data should outrank generic assumptions. An industry with a high reply rate but low purchase value may be less attractive than one with fewer replies, stronger conversion, and higher contract value.

### Learning principles

- **Measure before optimizing:** do not optimize behavior without measuring its actual effect.
- **Revenue beats activity:** high activity does not imply a healthy acquisition system.
- **Profit beats revenue:** the channel with the most gross revenue may not create the most value after costs.
- **Preserve explainability:** SaltBox should be able to explain why a prospect was prioritized.
- **Preserve experiment integrity:** do not silently alter experimental populations, assignments, or metrics.
- **Learn continuously:** no targeting rule is permanently correct merely because it worked initially.
- **Evidence over assumption:** statistically meaningful SaltBox outcomes should eventually outrank intuition.

### Relationship to local-first intelligence

ADR-001 asks, “What is the cheapest sufficient intelligence required for this task?” ADR-002 asks, “Is performing this task economically worthwhile, and did it produce value?” Together they define a central architectural pattern:

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

## System domains

### Prospecting

Find businesses that have no website or an outdated, low-quality, or ineffective website. Gather publicly available business information and retain its source, retrieval time, and applicable usage constraints. Discovery and enrichment should remain distinct operations so records can be refreshed without rediscovering a business.

### Website Analysis

Assess whether a business website is missing, outdated, broken, poorly optimized, difficult to use, or otherwise a strong replacement opportunity. Analysis should preserve its inputs, result, reasoning, version, and confidence so later decisions are explainable and reproducible.

The analysis pipeline should prioritize deterministic collection and measurement. Possible signals include:

- Domain existence and DNS resolution
- HTTPS availability, HTTP errors, redirects, and mixed content
- Mobile responsiveness and viewport configuration
- Lighthouse performance, accessibility, and SEO measurements
- Core Web Vitals where reliable field or lab data is available
- Broken links, missing images, and dead JavaScript
- Contact forms, calls to action, phone numbers, and email addresses
- Metadata, schema markup, and social links
- Image optimization and approximate page count
- Copyright year and technology fingerprints
- Navigation quality and basic visual or design-age signals

These signals should be collected deterministically wherever possible and assembled into a structured website report. AI may add qualitative judgment only when it improves a decision that deterministic evidence cannot resolve; raw sites or complete crawl outputs should not be sent to a model by default.

### Lead Scoring

Estimate website need, potential customer value, conversion likelihood, online-presence quality, category fit, contactability, and expected acquisition cost. The score should support an explicit accept or reject decision with recorded reasons. Thresholds and scoring versions should be auditable and adjustable without rewriting historical results.

The first scoring implementation should be primarily deterministic. Signals such as a missing or broken website, non-mobile layout, very poor performance, a valuable service category, evidence that the business is active, and valid contact information can add to a score. Final weights are intentionally undefined.

Human-defined weights may be used initially, provided their inputs and reasoning remain inspectable:

```text
feature signals
      ↓
rules / weighted score
      ↓
qualification
```

As SaltBox accumulates outcomes, scoring may become data-driven by relating prospect features to demo views, replies, conversions, and revenue. Traditional statistical or machine-learning methods should be considered before assuming an LLM is necessary.

```text
prospect features
      ↓
actual outcomes
      ↓
statistical learning
      ↓
predicted conversion/value
```

Potential future techniques include logistic regression, decision trees, gradient boosting, and calibrated probability models. SaltBox should favor methods that are cheap, fast, measurable, easy to validate, and interpretable where practical. No technique or library is selected by this architecture.

### Demo Generator

Generate personalized website concepts for qualified prospects and prepare them for deployment at unique URLs. Generation should be repeatable, versioned, cost-aware, and separated from production customer delivery. A demo is a sales artifact and must not be mistaken for an approved production website.

The default workflow should not ask AI to generate an entire application or codebase for every prospect. Prefer composition from known-good assets:

```text
Reusable SaltBox Design System
              +
Industry Templates
              +
Reusable Components
              +
Structured Business Data
              +
Small AI-Generated Content
              ↓
     Personalized Demo
```

A future demo payload might resemble:

```json
{
  "template": "contractor-modern-02",
  "businessName": "Example Roofing",
  "headline": "Roofing Built to Last",
  "services": [
    "Roof Replacement",
    "Roof Repair",
    "Storm Damage"
  ],
  "city": "Ogden",
  "tone": "professional"
}
```

SaltBox should render that structure through reusable, tested components. This yields nearly zero marginal inference cost, faster generation, fewer broken demos, consistent quality, easier quality assurance, simpler deployment, and controlled experimentation. AI-generated custom layouts or code may later exist as a higher-tier capability, but not as the default prospecting path.

### Outreach

Create personalized initial messages and follow-up sequences, send them through approved channels, and record delivery and engagement events. Outreach must enforce consent, suppression, rate-limit, and deduplication rules before any external action. Opens should be tracked only where permitted; clicks, demo views, replies, and conversion signals should be correlated to the correct prospect.

Outreach should not require an LLM to compose every message from scratch. Prefer a proven, reviewed template combined with structured business data and one or two personalized fields. A model might generate only a validated observation such as `your current site is difficult to use on mobile`. This reduces inference, hallucination, inconsistent tone, compliance risk, and unpredictable messages.

Email infrastructure should eventually expose delivery rate, bounce rate, hard-bounce rate, complaint rate, unsubscribe rate, domain-reputation indicators, and provider-level delivery performance. Targeting and experimentation must treat deliverability as a guardrail. SaltBox should prefer fewer highly relevant contacts over indiscriminate mass outreach.

### CRM / Lead State

Maintain the authoritative record for every company through the SaltBox funnel. The CRM state should coordinate asynchronous work while business facts, events, messages, costs, and generated artifacts remain separately inspectable. State transitions should be validated and attributed rather than inferred from unrelated booleans.

### Admin Dashboard

Give operators complete visibility into the autonomous system. The dashboard should present funnel health, pending and failed work, escalations, cost and model usage, outreach performance, and customer status. It should permit controlled retries and overrides with an audit trail.

### Customer Support

Handle normal inbound prospect and customer conversations, retain context, and escalate when confidence or policy requires it. Automated responses should respect communication preferences and make their supporting context visible to an operator.

### Production Website Generation

Turn an accepted demo or approved concept into a maintainable production website. Production work should support revisions, customer approval, content and asset provenance, deployment, domains, and ongoing management. Approval must be explicit and recorded.

### Billing

Manage checkout, invoices, subscriptions, service plans, payment state, and provider events. Billing operations require strict idempotency and reconciliation. Sensitive payment details should remain with the selected payment provider rather than SaltBox wherever practical.

### Observability

Provide structured logging and visibility into failures, retries, queue state, model usage, email delivery, customer events, external-provider behavior, and overall system health. Correlation identifiers should connect a prospect, workflow run, provider request, and resulting events without leaking secrets or unnecessary personal data.

Every AI operation should eventually record appropriate metadata: task type, provider, model, local-versus-paid classification, duration, input and output token estimates, estimated cost, prompt version, schema version, success or failure, retry count, and escalation reason. Logs must avoid unnecessary sensitive customer or business information, and observability records must not expose prompts, content, or credentials merely for convenience.

### Learning Engine

The future Learning Engine is a conceptual SaltBox domain, not necessarily a microservice. Its responsibilities may eventually include:

```text
metric aggregation
cohort analysis
experiment evaluation
feature effectiveness
lead-model training
conversion prediction
profit prediction
strategy recommendations
exploration management
```

Initially this may be no more than SQL, statistics, analytics, and human-reviewed experiments. It should become more sophisticated only when data volume, measurement quality, and demonstrated value justify the complexity. It must consume versioned features, decisions, exposures, outcomes, and cost data without becoming the authoritative source for CRM lifecycle state.

## Initial lead lifecycle

The initial lifecycle is a proposal for the authoritative prospect state machine, not a database schema:

```text
discovered
    ↓
enriched
    ↓
analyzed ───────────────→ rejected
    ↓
qualified
    ↓
demo_queued
    ↓
demo_generating
    ↓
demo_ready
    ↓
outreach_queued
    ↓
contacted
    ↓
demo_viewed
    ↓
responded
    ↓
interested
    ↓
sales_conversation ─────→ lost
    ↓
won
    ↓
customer
    ↓
production
    ↓
review
    ↓
deployed
    ↓
active
```

Real workflows will not always be linear. A response can arrive before a tracked demo view, a prospect can be rejected after deeper analysis, and an active customer may return to production for revisions. Transition rules should therefore define allowed paths, terminal or resumable states, required evidence, and operator override behavior. Engagement events such as email delivery, clicks, and views may be modeled as append-only events while the lifecycle retains one clear current state.

## Autonomous system principles

### Idempotency

Automated jobs must be safe to retry. An idempotency strategy should prevent duplicate outreach, unnecessary duplicate websites, double charges, and conflicting records. External actions should use stable operation keys where providers support them, and SaltBox should record the outcome before scheduling dependent work.

### State machine

Every prospect should have an explicit lifecycle state. Transitions should validate prerequisites, record the actor and reason, and emit events for downstream work. Loosely related boolean fields should not substitute for the state machine.

### Auditability

Every significant automated action should eventually answer:

- What happened?
- When did it happen?
- Why did it happen?
- Which person, model, rule, or system made the decision?
- Which input data and configuration versions were used?
- What did the action cost, and what was its outcome?

Audit records should be append-oriented and should avoid storing secrets or unnecessary sensitive content.

### Human escalation

Automation should handle normal cases. The system should surface angry prospects, legal or compliance requests, unusual pricing requests, high-value opportunities, automation failures, and ambiguous customer instructions. Escalated work should include relevant context, urgency, recommended next steps, and a safe way for automation to pause until resolved.

Human and paid-AI escalation should follow commercial intent rather than prospecting volume:

```text
MASS PROSPECTING
      ↓
Deterministic + local AI
      ↓
Prospect shows intent
      ↓
Higher-quality local AI allowed
      ↓
Strong commercial intent
      ↓
Paid frontier AI MAY be justified
      ↓
High-value or unusual situation
      ↓
Human escalation if necessary
```

Human intervention should remain minimal but available. Neither progression through the funnel nor a low model-confidence score automatically authorizes paid inference or removes the need for human review in exceptional cases.

### Cost awareness

Cost events should eventually be attributable by prospect, customer, campaign, task, provider, model, and service. Tracked expenses may include AI inference, enrichment, scraping or data acquisition, proxies, email sending, image generation, hosting or deployment, and storage. The system should distinguish actual, estimated, and allocated costs and retain the applicable currency and pricing version.

An operator should eventually be able to inspect a customer and answer:

```text
Total acquisition cost: $X
Revenue: $Y
Gross contribution: $Z
```

SaltBox should attribute approximate enrichment, scraping or data-acquisition, AI analysis, website generation, email infrastructure, and hosting costs to each prospect. Aggregated cost should eventually answer: “How much did acquiring this customer cost SaltBox?” Cost events should capture provider, operation, units, currency, and pricing version when available.

Each prospect should eventually have an acquisition-cost ledger containing applicable data-acquisition, enrichment, proxy, local-compute estimate, paid-inference, email, image-generation, hosting, storage, and human-intervention costs. Joined to customer outcomes, this should support Prospect Acquisition Cost, Customer Acquisition Cost, profit, ROI, and the inference-budget decisions described by ADR-001. Accounting rules and allocation methodology remain deferred.

### Rate limits and resilience

Every external integration must eventually support rate limiting and bounded retry with backoff and jitter. Permanent failures should not retry indefinitely. Queue visibility, dead-letter handling, circuit breaking where appropriate, and operator-driven replay should make failures observable and recoverable.

### Provider abstraction

Core SaltBox business logic should not be deeply coupled to one AI, email, scraping/data, hosting, or payment provider. Internal interfaces should express business capabilities and normalize only what SaltBox needs, while provider adapters retain provider-specific features and errors. Abstractions should be introduced when integrations are selected, not invented prematurely.

For intelligence work, application logic should request capabilities such as:

```text
generateStructuredData()
classifyBusiness()
summarizeWebsite()
generateCopy()
reasonAboutProspect()
respondToCustomer()
```

Those capabilities should route through SaltBox-owned interfaces and the future Model Router. Provider-specific calls must not be scattered through core application logic or assume OpenAI, Anthropic, Google, Ollama, llama.cpp, vLLM, or any other provider. Local/self-hosted inference is a first-class provider; paid API integrations are optional adapters. The abstraction should preserve necessary provider-specific diagnostics without leaking vendor concepts into business policy.

### Privacy and security

Collect only data needed for legitimate SaltBox workflows, track its source, restrict access, and define retention and deletion behavior. Secrets belong in server-side configuration or a secret manager and must never be embedded in browser bundles, generated demos, logs, or source control. External actions should respect applicable communication, privacy, and data-use requirements.

## Admin dashboard vision

The eventual dashboard should expose the complete funnel, economic outcomes, and experiment context. It should help operators understand **why** performance changed rather than merely display totals. A representative summary might be:

```text
Businesses discovered:     12,418
Qualified prospects:        2,103
Demos generated:              687
Outreach delivered:            621
Demo views:                    184
Responses:                      31
Positive responses:             18
Customers:                      12

Revenue:                        $X
Gross profit:                   $Y
Customer acquisition cost:     $Z
Revenue / 1,000 discovered:     $A
Profit / 1,000 discovered:      $B
```

Funnel and economic results should eventually be filterable by industry, market, campaign, source, lead-score band, demo template, outreach variant, experiment, and time period. Filters should apply consistently to stage counts, transition rates, costs, revenue, and profit so operators can compare like with like.

Operators should be able to inspect any prospect and see:

- Business information and source provenance
- Existing website and captured evidence
- Website analysis and lead score
- Why the lead was accepted or rejected
- Generated demo and deployment history
- All outreach and engagement history
- Conversation history and AI actions
- Errors, retries, and pending work
- Estimated acquisition cost
- Current customer and production status
- Feature and source-data versions used for decisions
- Rule, model, template, outreach, and offer versions
- Experiment eligibility, assignment, and exposure
- Revenue, gross profit, retention, and lifetime-value outcomes where applicable

Dashboard mutations—including retries, overrides, suppressions, approvals, and state changes—should use the same audited workflows as automation rather than bypassing them.

## Development philosophy

1. Preserve the existing SaltBox website design when imported.
2. Do not rewrite working code solely to satisfy architectural preferences.
3. Refactor incrementally.
4. Keep business logic separate from UI where practical.
5. Strongly type shared contracts once the project's language and framework are known.
6. Never expose secrets client-side.
7. Prefer boring, reliable infrastructure over unnecessary complexity.
8. Build for autonomous execution while maintaining operator visibility.
9. External automated actions must be observable and recoverable.
10. Avoid premature microservices. The `/services` directories describe domains, not necessarily independently deployed services.
11. Use deterministic software before local inference, and local inference before paid inference.
12. Keep paid AI explicitly disabled unless policy authorizes an economically justified escalation.
13. Prefer minimal context and schema-validated structured outputs over freeform generation.

## Deferred decisions

The following choices should be made only after inspecting the existing website and validating operational requirements:

- Frontend and backend frameworks
- Language and runtime versions
- Package manager and monorepo/workspace tooling
- Database, schema, and migration tooling
- Queue and background-job infrastructure
- AI models, local inference runtimes, and paid AI providers
- Analytics storage, metrics definitions, experiment infrastructure, and learning-model tooling
- Email, data, hosting, authentication, and billing providers
- Deployment topology and CI/CD system
- Shared contract and package boundaries

No Model Router, inference service, queue, scraper, analyzer, lead scorer, demo generator, outreach integration, AI workspace, analytics platform, tracking system, Experimentation Engine, Learning Engine implementation, reporting job, dashboard, or accounting system is implemented by this document. Those decisions remain deferred until the existing website is inspected and concrete requirements are known.
