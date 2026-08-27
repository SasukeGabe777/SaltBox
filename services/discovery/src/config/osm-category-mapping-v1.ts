export const OSM_CATEGORY_MAPPING_VERSION = "osm-category-mapping-v1";

export interface OsmCategoryMapping {
  saltboxCategory: string;
  tagKey: "amenity" | "craft" | "shop";
  tagValue: string;
  description: string;
}

export const OSM_CATEGORY_MAPPINGS: Readonly<Record<string, OsmCategoryMapping>> = {
  roofing: { saltboxCategory: "roofing", tagKey: "craft", tagValue: "roofer", description: "Roofing contractors" },
  plumbing: { saltboxCategory: "plumbing", tagKey: "craft", tagValue: "plumber", description: "Plumbing contractors" },
  electrician: { saltboxCategory: "electrical", tagKey: "craft", tagValue: "electrician", description: "Electrical contractors" },
  hvac: { saltboxCategory: "hvac", tagKey: "craft", tagValue: "hvac", description: "Heating and cooling contractors" },
  landscaping: { saltboxCategory: "landscaping", tagKey: "craft", tagValue: "landscaper", description: "Landscaping services" },
  restaurant: { saltboxCategory: "restaurant", tagKey: "amenity", tagValue: "restaurant", description: "Restaurants" },
  coffee: { saltboxCategory: "restaurant", tagKey: "amenity", tagValue: "cafe", description: "Cafes and coffee shops" },
  bakery: { saltboxCategory: "bakery", tagKey: "shop", tagValue: "bakery", description: "Bakeries" },
  auto_repair: { saltboxCategory: "auto_repair", tagKey: "shop", tagValue: "car_repair", description: "Automotive repair shops" },
  dentist: { saltboxCategory: "dental", tagKey: "amenity", tagValue: "dentist", description: "Dental practices" },
};

export function getOsmCategoryMapping(category: string): OsmCategoryMapping | undefined {
  return OSM_CATEGORY_MAPPINGS[category];
}

export function supportedDiscoveryCategories(): string[] {
  return Object.keys(OSM_CATEGORY_MAPPINGS).sort();
}
