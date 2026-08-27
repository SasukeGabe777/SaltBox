/**
 * Deterministic copy library for the local-service template family
 * (demo-copy-v1). No AI. Every phrase is a generic marketing transformation
 * with slots for OBSERVED facts only ({name}, {city}, {state}, {category
 * label}). Nothing here may assert verifiable facts SaltBox does not have:
 * no years in business, licenses, certifications, insurance, awards,
 * warranties, guarantees, review counts, ratings, financing, emergency or
 * 24/7 availability, pricing ("free"), or manufacturer partnerships.
 */

export interface HeroCopy {
  /** Headline variants; one is chosen deterministically per business. */
  headlines: readonly string[];
  subheadline: string;
}

export interface ServiceCopyItem {
  title: string;
  description: string;
}

export interface CategoryCopy {
  /** Deterministic theme key consumed by the renderer. */
  themeKey: string;
  hero: HeroCopy;
  /** Typical category services, clearly disclosed as demo presentation. */
  services: readonly ServiceCopyItem[];
  aboutBody: string;
}

/** Slots use {name}, {city}, {state}, {label} (category label), {region}. */
export const LOCAL_SERVICE_COPY: Readonly<Record<string, CategoryCopy>> = {
  roofing: {
    themeKey: "slate",
    hero: {
      headlines: [
        "Roofing Solutions Built for {region} Homes",
        "A Solid Roof Over Every {region} Home",
        "{region} Roofing, Done Right",
      ],
      subheadline: "Get a straightforward estimate for your roofing project and clear answers before any work begins.",
    },
    services: [
      { title: "Roof Repair", description: "Targeted fixes for leaks, damaged shingles, and worn flashing." },
      { title: "Roof Replacement", description: "Full replacement planning with clear scope and material options." },
      { title: "Roof Inspection", description: "A structured look at the current condition of your roof." },
      { title: "Storm Damage Assessments", description: "An assessment of wind and hail impact after severe weather." },
      { title: "Gutters & Drainage", description: "Keeping water moving off the roof and away from the foundation." },
      { title: "Maintenance", description: "Seasonal upkeep that helps small issues stay small." },
    ],
    aboutBody:
      "{name} is a {labelLower} company based in {region}. This page shows how a modern website can present the business clearly: what it does, where it works, and exactly how to reach it.",
  },
  plumbing: {
    themeKey: "ocean",
    hero: {
      headlines: [
        "Plumbing Help for {region} Homes",
        "Clear, Careful Plumbing Work in {region}",
        "{region} Plumbing, Handled Properly",
      ],
      subheadline: "Request an estimate and get clear answers about your plumbing project before any work begins.",
    },
    services: [
      { title: "Leak Repair", description: "Finding and fixing leaks before they become damage." },
      { title: "Drain Cleaning", description: "Clearing slow or blocked drains throughout the home." },
      { title: "Water Heaters", description: "Repair and replacement planning for water heating." },
      { title: "Fixture Installation", description: "Faucets, toilets, and fixtures installed cleanly." },
      { title: "Pipe Work", description: "Repairs and updates to supply and drain lines." },
      { title: "Inspections", description: "A structured look at the plumbing behind your walls." },
    ],
    aboutBody:
      "{name} is a {labelLower} company based in {region}. This page shows how a modern website can present the business clearly: what it does, where it works, and exactly how to reach it.",
  },
  hvac: {
    themeKey: "ember",
    hero: {
      headlines: [
        "Comfortable Homes Across {region}",
        "Heating & Cooling for {region} Homes",
        "{region} Comfort, All Year",
      ],
      subheadline: "Request an estimate for heating, cooling, or ventilation work and get clear answers first.",
    },
    services: [
      { title: "Heating Service", description: "Furnace and heating system repair and upkeep." },
      { title: "Air Conditioning", description: "Cooling system service and replacement planning." },
      { title: "System Replacement", description: "Right-sized equipment with a clear scope of work." },
      { title: "Ventilation", description: "Air movement and ductwork that supports comfort." },
      { title: "Thermostats", description: "Modern controls installed and configured properly." },
      { title: "Seasonal Tune-Ups", description: "Preparing your system before summer and winter." },
    ],
    aboutBody:
      "{name} is a {labelLower} company based in {region}. This page shows how a modern website can present the business clearly: what it does, where it works, and exactly how to reach it.",
  },
  landscaping: {
    themeKey: "meadow",
    hero: {
      headlines: [
        "Outdoor Spaces That Fit {region}",
        "Landscaping for {region} Homes",
        "{region} Yards, Thoughtfully Kept",
      ],
      subheadline: "Request an estimate for your yard or landscape project and get clear answers before work begins.",
    },
    services: [
      { title: "Landscape Design", description: "Practical plans that fit your property and climate." },
      { title: "Lawn Care", description: "Regular mowing, edging, and seasonal treatment." },
      { title: "Planting & Beds", description: "Trees, shrubs, and beds installed with care." },
      { title: "Irrigation", description: "Watering systems that keep landscapes healthy." },
      { title: "Hardscaping", description: "Paths, patios, and edges that frame the yard." },
      { title: "Seasonal Cleanup", description: "Spring and fall resets that keep things tidy." },
    ],
    aboutBody:
      "{name} is a {labelLower} company based in {region}. This page shows how a modern website can present the business clearly: what it does, where it works, and exactly how to reach it.",
  },
  electrical: {
    themeKey: "amber",
    hero: {
      headlines: [
        "Electrical Work for {region} Homes",
        "Safe, Clear Electrical Service in {region}",
        "{region} Electrical, Done Carefully",
      ],
      subheadline: "Request an estimate for your electrical project and get clear answers before any work begins.",
    },
    services: [
      { title: "Repairs & Troubleshooting", description: "Tracking down faults and fixing them properly." },
      { title: "Panels & Upgrades", description: "Service panels and capacity planned for your home." },
      { title: "Lighting", description: "Interior and exterior lighting installed cleanly." },
      { title: "Outlets & Switches", description: "Additions and replacements throughout the home." },
      { title: "EV & Equipment Circuits", description: "Dedicated circuits for chargers and equipment." },
      { title: "Safety Checks", description: "A structured inspection of the system behind your walls." },
    ],
    aboutBody:
      "{name} is a {labelLower} company based in {region}. This page shows how a modern website can present the business clearly: what it does, where it works, and exactly how to reach it.",
  },
};

/** Generic local-service copy for supported categories without a bespoke entry. */
export const GENERIC_LOCAL_SERVICE_COPY: CategoryCopy = {
  themeKey: "slate",
  hero: {
    headlines: [
      "{label} for {region} Homes",
      "{label} in {region}, Done Right",
      "Clear, Careful {label} in {region}",
    ],
    subheadline: "Request an estimate for your project and get clear answers before any work begins.",
  },
  services: [
    { title: "Project Estimates", description: "A clear written scope before any work begins." },
    { title: "Repairs", description: "Focused fixes that address the actual problem." },
    { title: "Installations", description: "New work planned and completed cleanly." },
    { title: "Maintenance", description: "Regular upkeep that helps small issues stay small." },
  ],
  aboutBody:
    "{name} is a {labelLower} company based in {region}. This page shows how a modern website can present the business clearly: what it does, where it works, and exactly how to reach it.",
};

/** Trust points are intentionally claim-free: they describe how the demo site communicates. */
export const TRUST_POINTS: readonly { title: string; description: string }[] = [
  {
    title: "Clear Communication",
    description: "One obvious way to request an estimate, and contact details that are easy to find on every screen.",
  },
  {
    title: "Local Focus",
    description: "A site built around where the business actually works, not a generic national landing page.",
  },
  {
    title: "Straightforward Process",
    description: "Describe the project, get a response, and know what happens next — no guesswork.",
  },
];

export const CTA_LABELS = {
  quote: "Get a Quote",
  call: "Call Now",
  contact: "Contact Us",
} as const;

