/**
 * Versioned mapping from SaltBox canonical categories to Overture Place
 * Categories taxonomy codes (official CSV in the OvertureMaps/schema repo).
 * A candidate matches when its primary category is any listed code; child
 * codes are enumerated explicitly rather than inferred from the taxonomy at
 * runtime so behavior is deterministic and reviewable.
 */
export const OVERTURE_CATEGORY_MAPPING_VERSION = "overture-category-mapping-v1";

export interface OvertureCategoryMapping {
  saltboxCategory: string;
  categoryCodes: readonly string[];
  description: string;
}

export const OVERTURE_CATEGORY_MAPPINGS: Readonly<Record<string, OvertureCategoryMapping>> = {
  roofing: {
    saltboxCategory: "roofing",
    categoryCodes: ["roofing", "ceiling_and_roofing_repair_and_service"],
    description: "Roofing contractors",
  },
  plumbing: {
    saltboxCategory: "plumbing",
    categoryCodes: ["plumbing"],
    description: "Plumbing contractors",
  },
  electrician: {
    saltboxCategory: "electrical",
    categoryCodes: ["electrician"],
    description: "Electrical contractors",
  },
  hvac: {
    saltboxCategory: "hvac",
    categoryCodes: ["hvac_services"],
    description: "Heating and cooling contractors",
  },
  landscaping: {
    saltboxCategory: "landscaping",
    categoryCodes: ["landscaping", "lawn_service", "gardener", "landscape_architect"],
    description: "Landscaping services",
  },
  painting: {
    saltboxCategory: "painting",
    categoryCodes: ["painting"],
    description: "Painting contractors",
  },
  concrete: {
    saltboxCategory: "concrete",
    categoryCodes: ["masonry_concrete"],
    description: "Masonry and concrete contractors",
  },
  flooring: {
    saltboxCategory: "flooring",
    categoryCodes: ["flooring_contractors"],
    description: "Flooring contractors",
  },
  remodeling: {
    saltboxCategory: "remodeling",
    categoryCodes: ["altering_and_remodeling_contractor", "kitchen_remodeling", "bathroom_remodeling"],
    description: "Remodeling contractors",
  },
  pest_control: {
    saltboxCategory: "pest_control",
    categoryCodes: ["pest_control_service"],
    description: "Pest-control services",
  },
  tree_service: {
    saltboxCategory: "tree_service",
    categoryCodes: ["tree_services"],
    description: "Tree services",
  },
  restaurant: {
    saltboxCategory: "restaurant",
    categoryCodes: ["restaurant"],
    description: "Restaurants",
  },
  coffee: {
    saltboxCategory: "restaurant",
    categoryCodes: ["cafe", "coffee_shop"],
    description: "Cafes and coffee shops",
  },
  bakery: {
    saltboxCategory: "bakery",
    categoryCodes: ["bakery"],
    description: "Bakeries",
  },
  auto_repair: {
    saltboxCategory: "auto_repair",
    categoryCodes: ["automotive_repair"],
    description: "Automotive repair shops",
  },
  dentist: {
    saltboxCategory: "dental",
    categoryCodes: ["dentist", "general_dentistry"],
    description: "Dental practices",
  },
};

export function getOvertureCategoryMapping(category: string): OvertureCategoryMapping | undefined {
  return OVERTURE_CATEGORY_MAPPINGS[category];
}

export function supportedOvertureCategories(): string[] {
  return Object.keys(OVERTURE_CATEGORY_MAPPINGS).sort();
}
