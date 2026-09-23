/**
 * Customer-facing copy library for the local-service family (demo-copy-v3).
 *
 * v2 copy described the demo ("What This Site Gets Right", "From their
 * current site", "This page shows how a modern website can present the
 * business"). v3 is written AS the business, TO its customers — the site a
 * homeowner would actually use — while keeping every hard rule of v1/v2:
 * no AI, slots filled only with OBSERVED facts, and no claims SaltBox cannot
 * support (licenses, insurance, tenure, reviews, ratings, warranties,
 * guarantees, financing, pricing/"free", emergency/24-7/same-day, awards,
 * superlatives, "trusted"/"expert", ownership, partnerships). The claims
 * guard still scans every generated field.
 *
 * Demo status is disclosed once, in the footer, instead of as badges and
 * notes scattered through the page.
 */

export interface HeroCopyV3 {
  /** Headline variants; one is chosen deterministically per business. */
  headlines: readonly string[];
  /** Used when fewer than two services were found on the business's site. */
  subheadline: string;
}

export interface CategoryCopyV3 {
  themeKey: string;
  hero: HeroCopyV3;
  /** Typical services, used only to top up a site with fewer than 3 found. */
  typicalServices: readonly string[];
  /** Plural noun for the people this trade serves. */
  audience: string;
}

/** Slots: {name}, {city}, {state}, {region}, {label}, {labelLower}. */
export const LOCAL_SERVICE_COPY_V3: Readonly<Record<string, CategoryCopyV3>> = {
  roofing: {
    themeKey: "slate",
    hero: {
      headlines: [
        "Roofing Solutions Built for {region} Homes",
        "A Solid Roof Over Every {region} Home",
        "{region} Roofing, Done Right",
      ],
      subheadline: "Repairs, replacements, and inspections for homes across {region}. Tell us about your roof and get a clear estimate.",
    },
    typicalServices: ["Roof Repair", "Roof Replacement", "Roof Inspections", "Gutters"],
    audience: "homeowners",
  },
  plumbing: {
    themeKey: "ocean",
    hero: {
      headlines: [
        "Plumbing Help for {region} Homes",
        "Clear, Careful Plumbing Work in {region}",
        "{region} Plumbing, Handled Properly",
      ],
      subheadline: "Leaks, drains, water heaters, and fixtures for homes across {region}. Tell us what's going on and get a clear estimate.",
    },
    typicalServices: ["Leak Repair", "Drain Cleaning", "Water Heaters", "Fixture Installation"],
    audience: "homeowners",
  },
  hvac: {
    themeKey: "ember",
    hero: {
      headlines: [
        "Comfortable Homes Across {region}",
        "Heating & Cooling for {region} Homes",
        "{region} Comfort, All Year",
      ],
      subheadline: "Heating, cooling, and ventilation for homes across {region}. Tell us what you need and get a clear estimate.",
    },
    typicalServices: ["Heating", "Air Conditioning", "Heat Pumps", "Ductwork"],
    audience: "homeowners",
  },
  landscaping: {
    themeKey: "meadow",
    hero: {
      headlines: [
        "Outdoor Spaces That Fit {region}",
        "Landscaping for {region} Homes",
        "{region} Yards, Thoughtfully Kept",
      ],
      subheadline: "Lawn care, planting, and outdoor projects across {region}. Tell us about your yard and get a clear estimate.",
    },
    typicalServices: ["Landscape Design", "Lawn Care", "Irrigation", "Hardscaping"],
    audience: "homeowners",
  },
  electrical: {
    themeKey: "amber",
    hero: {
      headlines: [
        "Electrical Work for {region} Homes",
        "Safe, Clear Electrical Service in {region}",
        "{region} Electrical, Done Carefully",
      ],
      subheadline: "Repairs, upgrades, and lighting for homes across {region}. Tell us about your project and get a clear estimate.",
    },
    typicalServices: ["Panel Upgrades", "Lighting", "Wiring", "Outlets & Switches"],
    audience: "homeowners",
  },
};

export const GENERIC_LOCAL_SERVICE_COPY_V3: CategoryCopyV3 = {
  themeKey: "slate",
  hero: {
    headlines: ["{label} for {region} Homes", "{label} in {region}, Done Right", "Clear, Careful {label} in {region}"],
    subheadline: "Projects big and small for homes across {region}. Tell us what you need and get a clear estimate.",
  },
  typicalServices: ["Project Estimates", "Repairs", "Installations", "Maintenance"],
  audience: "homeowners",
};

/**
 * Homeowner-facing descriptions keyed by canonical service name (the names
 * brand intelligence normalizes site text to). Generic and claim-free.
 */
export const SERVICE_DESCRIPTIONS_V3: Readonly<Record<string, string>> = {
  // Roofing
  "Roof Replacement": "When repairs no longer make sense, we plan a full replacement, with materials, scope, and timeline laid out before work begins.",
  "Roof Repair": "Leaks, missing shingles, and worn flashing fixed at the source, so small problems don't turn into big ones.",
  "Metal Roofing": "Metal roofing for homes and outbuildings, with styles, colors, and trade-offs explained in plain terms.",
  "Commercial Roofing": "Roofing work for commercial buildings, scoped around your property and your schedule.",
  "Residential Roofing": "Roofing for homes of every size, from a single repair to a complete new roof.",
  "Flat Roofing": "Flat and low-slope roof work, with drainage and materials planned for how these roofs actually wear.",
  "Tile Roofing": "Tile roof repair and installation, handled with the care these roofs need.",
  "Shingle Roofing": "Asphalt shingle roofs installed and repaired, with color and style options to fit your home.",
  Solar: "Solar planned alongside your roof, so the panels and the roofing work together.",
  Gutters: "Gutters and downspouts that move water off the roof and away from your foundation.",
  "Roof Inspections": "A careful look at your roof's condition, with clear notes on what needs attention now and what can wait.",
  "Storm Damage": "After hail or high winds, we check for damage and walk you through what needs repair.",
  Siding: "Siding repair and replacement that protects your home and refreshes how it looks.",
  Skylights: "Skylight installation and repair, sealed to bring in light without letting in water.",
  // Plumbing
  "Water Heaters": "Water heater repair and replacement, including tankless options, so the hot water keeps flowing.",
  "Drain Cleaning": "Slow or clogged drains cleared throughout the house, from kitchen and bath to main lines.",
  "Leak Repair": "Leaks found and fixed before they damage floors, walls, or ceilings.",
  "Pipe Repair": "Pipe repairs and repiping for aging or damaged supply and drain lines.",
  "Sewer Service": "Sewer line service that keeps wastewater flowing away from your home.",
  "Fixture Installation": "Faucets, toilets, sinks, and showers installed cleanly and correctly.",
  "Water Softeners": "Water softener installation to help with hard water around the house.",
  // HVAC
  Heating: "Furnace and heating repair and service to keep your home warm through the winter.",
  "Air Conditioning": "AC repair, service, and replacement for a comfortable summer.",
  "Heat Pumps": "Heat pump installation and service, for heating and cooling in one system.",
  Ductwork: "Ductwork repair and installation so air gets where it needs to go.",
  Thermostats: "Modern thermostats installed and set up around your schedule.",
  "Indoor Air Quality": "Filtration and air-quality options for cleaner air inside your home.",
  // Landscaping
  "Lawn Care": "Mowing, edging, and seasonal care that keeps your lawn looking sharp.",
  "Landscape Design": "Landscape plans built around your yard, your climate, and how you use the space.",
  Irrigation: "Sprinkler and irrigation systems that water the right amount in the right places.",
  Hardscaping: "Patios, paths, and pavers that give your yard structure and places to gather.",
  "Tree & Shrub Care": "Pruning and care that keeps trees and shrubs healthy and in shape.",
  "Sod Installation": "New sod installed for an even, green lawn from day one.",
  // Electrical
  "Panel Upgrades": "Electrical panel upgrades that give your home the capacity it needs.",
  Lighting: "Indoor and outdoor lighting installed to brighten rooms, walkways, and entries.",
  "EV Chargers": "Home EV charger installation, with the right circuit for your vehicle.",
  Wiring: "Wiring repairs and rewiring for older homes, remodels, and additions.",
  Generators: "Generator hookups so your home is ready when the power goes out.",
  "Outlets & Switches": "New outlets, switches, and GFCI upgrades throughout the home.",
  // Generic top-up items
  "Project Estimates": "A clear written scope and estimate before any work begins.",
  Repairs: "Focused repairs that fix the actual problem.",
  Installations: "New work planned and installed cleanly.",
  Maintenance: "Regular upkeep that keeps small issues small.",
};

/**
 * Generic descriptions for a service name with no curated entry. They never
 * echo the name: site text can contain words the claims guard bans in
 * generated copy ("24/7", "emergency"), and a description must not amplify it.
 */
const FALLBACK_DESCRIPTIONS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /replace/i, description: "Full replacement planned with a clear scope before work begins." },
  { pattern: /repair|fix/i, description: "Repairs that address the actual problem, explained before work starts." },
  { pattern: /inspect|assess/i, description: "A careful look at the current condition, with clear notes on what needs attention." },
  { pattern: /install/i, description: "New installations planned around your home and completed cleanly." },
  { pattern: /maint|tune|clean/i, description: "Regular upkeep that keeps small issues small." },
  { pattern: /commercial/i, description: "Work scoped for commercial properties and schedules." },
  { pattern: /residential|home/i, description: "Work planned for homes of every size." },
];

/** Last resort for a service name with no curated description. */
export function fallbackServiceDescription(name: string): string {
  for (const { pattern, description } of FALLBACK_DESCRIPTIONS) if (pattern.test(name)) return description;
  return "Tell us what you need and we'll walk you through the options.";
}

/**
 * Canonical names that describe WHO is served rather than WHAT is done.
 * They sort last and never lead the hero subheadline.
 */
export const AUDIENCE_SERVICE_NAMES: ReadonlySet<string> = new Set(["Residential Roofing", "Commercial Roofing"]);

export const CTA_LABELS_V3 = {
  quote: "Get a Quote",
  call: "Call Now",
  contact: "Contact Us",
} as const;
