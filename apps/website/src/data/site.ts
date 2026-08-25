export interface NavigationItem {
  label: string;
  href: `#${string}`;
}

export type ServiceIcon = "brand" | "website" | "care";

export interface Service {
  title: string;
  description: string;
  icon: ServiceIcon;
}

export type ProcessVisual = "chat" | "brand" | "build" | "launch" | "care";

export interface ProcessStep {
  label: string;
  headingLines: readonly [string, string];
  description: string;
  url: string;
  status: string;
  visual: ProcessVisual;
}

export interface DemoBusiness {
  name: string;
  brand: string;
  url: string;
  eyebrow: string;
  headingLines: readonly [string, string];
  description: string;
  button: string;
  proof: string;
  glow: string;
  theme: Readonly<Record<`--s-${string}`, string>>;
}

export type ReviewStatus = "business-source-review-required";

export interface PricingFeature {
  label: string;
  detail?: string;
  tooltip: string;
  claimReview?: ReviewStatus;
}

export interface PricingPlan {
  number: string;
  name: string;
  subtitle: string;
  price: string;
  priceSuffix?: string;
  lead?: string;
  featured?: boolean;
  features: readonly PricingFeature[];
  action: string;
}

export interface PortfolioProject {
  name: string;
  category: string;
  url: string;
  displayUrl: string;
  description: string;
  background: string;
}

export const navigationItems = [
  { label: "Services", href: "#services" },
  { label: "Packages", href: "#packages" },
  { label: "How it works", href: "#story" },
  { label: "Our work", href: "#work" },
  { label: "About", href: "#about" },
] as const satisfies readonly NavigationItem[];

export const services = [
  {
    title: "Branding",
    description:
      "A logo, colors, and type that make you look established — and unmistakably you, everywhere people find you.",
    icon: "brand",
  },
  {
    title: "Websites & stores",
    description:
      "Fast, modern sites that look right on every screen, built to get found on Google and turn visitors into customers.",
    icon: "website",
  },
  {
    title: "Care & hosting",
    description:
      "We don't disappear at launch. Optional monthly care keeps your photos, prices, and content fresh.",
    icon: "care",
  },
] as const satisfies readonly Service[];

export const processSteps = [
  {
    label: "Chat",
    headingLines: ["We start", "with a chat."],
    description:
      "A free, no-pressure call to learn your business, your customers, and what you actually need. No jargon.",
    url: "messages",
    status: "STEP 1",
    visual: "chat",
  },
  {
    label: "Brand",
    headingLines: ["We shape", "your brand."],
    description:
      "A logo, colors, and type that make you look established — and unmistakably you, everywhere people find you.",
    url: "brand-kit",
    status: "STEP 2",
    visual: "brand",
  },
  {
    label: "Build",
    headingLines: ["We build", "the site."],
    description:
      "A fast, modern site that looks right on every screen, written and structured so Google can actually find you.",
    url: "wireframe",
    status: "STEP 3",
    visual: "build",
  },
  {
    label: "Launch",
    headingLines: ["We put it", "live."],
    description:
      "We connect your domain, get you on Google, and flip the switch. You're open for business online.",
    url: "birchandbean.co",
    status: "LIVE",
    visual: "launch",
  },
  {
    label: "Look after",
    headingLines: ["We look", "after it."],
    description:
      "Optional monthly care keeps photos, prices, and content fresh — plus hosting and backups — so it never goes stale.",
    url: "care · birchandbean.co",
    status: "CARE",
    visual: "care",
  },
] as const satisfies readonly ProcessStep[];

export const demoBusinesses = [
  {
    name: "Birch & Bean",
    brand: "Birch & Bean",
    url: "birchandbean.co",
    eyebrow: "Neighborhood roastery",
    headingLines: ["Mornings,", "sorted."],
    description: "Single-origin beans and fresh pastries, every morning.",
    button: "See the menu",
    proof: "Open daily",
    glow: "rgba(42,224,138,.5)",
    theme: {
      "--s-bg": "#FBF6EC",
      "--s-ink": "#2A2018",
      "--s-accent": "#1FA86B",
      "--s-accent-ink": "#04150C",
      "--s-muted": "#6b5d4d",
      "--s-star": "#C9892E",
      "--s-img": "linear-gradient(120deg,#3E2A18,#9C6B3E 60%,#E4C79A)",
    },
  },
  {
    name: "Ironside Barber Co.",
    brand: "Ironside",
    url: "ironsidebarber.co",
    eyebrow: "Cuts & straight-razor shaves",
    headingLines: ["Sharp looks.", "No fuss."],
    description: "Walk-ins welcome. Classic cuts and hot-towel shaves.",
    button: "Book a chair",
    proof: "1,200+ cuts",
    glow: "rgba(233,178,76,.4)",
    theme: {
      "--s-bg": "#15161A",
      "--s-ink": "#EFEAE2",
      "--s-accent": "#E0A23C",
      "--s-accent-ink": "#1A1206",
      "--s-muted": "#A39C90",
      "--s-star": "#E0A23C",
      "--s-img": "linear-gradient(120deg,#2A2C33,#4A4E59 60%,#9AA0AD)",
    },
  },
  {
    name: "Fern & Stone",
    brand: "Fern & Stone",
    url: "fernandstone.shop",
    eyebrow: "Plant shop & studio",
    headingLines: ["Bring the", "outside in."],
    description: "Houseplants, handmade pots, and care tips that actually work.",
    button: "Shop plants",
    proof: "Local favorite",
    glow: "rgba(120,180,120,.42)",
    theme: {
      "--s-bg": "#EEF1E7",
      "--s-ink": "#222B1F",
      "--s-accent": "#C0653F",
      "--s-accent-ink": "#FFF7F2",
      "--s-muted": "#6f7567",
      "--s-star": "#C0653F",
      "--s-img": "linear-gradient(120deg,#3C5A39,#76A36B 60%,#CFE0BE)",
    },
  },
] as const satisfies readonly DemoBusiness[];

// Presentation data copied from the approved prototype. Pricing requires business
// review before launch and must not be treated as authoritative product logic.
export const pricingPlans = [
  {
    number: "01",
    name: "Starter",
    subtitle: "Get found online.",
    price: "$900",
    priceSuffix: "to start",
    features: [
      {
        label: "4-page website",
        detail: "Home, About, Services & Contact",
        tooltip: "75% of people judge a business's credibility from its website alone.",
        claimReview: "business-source-review-required",
      },
      {
        label: "Custom logo (600×600) + brand colors",
        tooltip:
          "A signature color can lift brand recognition by up to 80% — most people know Starbucks from its green alone.",
        claimReview: "business-source-review-required",
      },
      {
        label: "Web & mobile responsive",
        tooltip: "Around two-thirds of all searches now happen on a phone.",
        claimReview: "business-source-review-required",
      },
      {
        label: "Email & phone integration",
        detail: "contact form + tap-to-call",
        tooltip: "76% of people who search locally contact or visit a business within 24 hours.",
        claimReview: "business-source-review-required",
      },
      {
        label: "Google Analytics + Business Profile",
        tooltip:
          "Nearly half of all Google searches are local — a Business Profile gets you found on Search and Maps.",
        claimReview: "business-source-review-required",
      },
    ],
    action: "Choose Starter",
  },
  {
    number: "02",
    name: "Standard",
    subtitle: "Bring in more customers.",
    price: "$2,400",
    priceSuffix: "to start",
    lead: "Everything in Starter, plus:",
    featured: true,
    features: [
      {
        label: "+3 site pages (7 total)",
        tooltip: "Every page is a new doorway from Google — more pages, more ways to be found.",
      },
      {
        label: "Logo Suite — 4 logo variations",
        tooltip: "Favicon, social, print, dark backgrounds — a version that looks sharp everywhere.",
      },
      {
        label: "Brand style guide",
        tooltip: "Consistent branding makes a business look more established and trustworthy.",
      },
      {
        label: "Photo / work gallery",
        tooltip: "Visitors spend about 6 seconds on your main image — strong photos sell harder than words.",
        claimReview: "business-source-review-required",
      },
      {
        label: "Set up online booking or small shop",
        detail: "up to 15 items",
        tooltip: "Let customers act the moment they're ready — not only during business hours.",
      },
      {
        label: "Local SEO",
        tooltip: "“Near me” searches have surged — local SEO helps you be the one they find first.",
        claimReview: "business-source-review-required",
      },
      {
        label: "3 free months of small updates",
        tooltip: "Fresh content keeps you visible; further updates run through the care plan.",
      },
    ],
    action: "Choose Standard",
  },
  {
    number: "03",
    name: "Custom",
    subtitle: "Built exactly how you want.",
    price: "Let's talk",
    lead: "Everything in Standard, plus:",
    features: [
      {
        label: "Unlimited pages",
        tooltip: "Room for every service, location, and story you want to tell.",
      },
      {
        label: "Fully custom design",
        tooltip: "94% of first impressions are design-related — a one-of-a-kind look makes yours unforgettable.",
        claimReview: "business-source-review-required",
      },
      {
        label: "Full online store",
        tooltip: "Sell anything, in any quantity, with a checkout built around your products.",
      },
      {
        label: "Custom features",
        detail: "booking, memberships, integrations",
        tooltip: "Connect the tools you already use and automate the busywork.",
      },
      {
        label: "Advanced SEO + analytics",
        tooltip: "Go beyond the basics to track what's working and climb the rankings.",
      },
      {
        label: "Priority updates included",
        tooltip: "Front-of-line changes whenever your business shifts.",
      },
    ],
    action: "Start a conversation",
  },
] as const satisfies readonly PricingPlan[];

export const portfolioProjects = [
  {
    name: "Comet Painting",
    category: "Custom build · Service",
    url: "https://cometpaintingutah.netlify.app/",
    displayUrl: "cometpaintingutah.netlify.app",
    description:
      "A clean, trust-first site for a Utah painting & drywall crew — gallery, before/after sliders, and a free-estimate form.",
    background: "linear-gradient(135deg,#2C335A,#16192C)",
  },
  {
    name: "iRaveBabe",
    category: "Online store · Apparel",
    url: "https://www.iravebabe.com",
    displayUrl: "iravebabe.com",
    description: "A bold festival-apparel storefront with a high-energy look that matches the rave scene it serves.",
    background: "linear-gradient(135deg,#EF6140,#C0397E 55%,#5B2EA6)",
  },
  {
    name: "Everly Keepsakes",
    category: "Online store · Gifts",
    url: "https://everlykeepsakes.com/",
    displayUrl: "everlykeepsakes.com",
    description:
      "A warm shop for personalized gifts and engraved keepsakes, built around weddings and milestones.",
    background: "linear-gradient(135deg,#8FD9B4,#5FA77E 60%,#3C7A57)",
  },
  {
    name: "SLC TCG",
    category: "Store & events · Trading cards",
    url: "https://slctcg.com/",
    displayUrl: "slctcg.com",
    description:
      "An events hub and online store for Utah's trading-card community — show calendar, vendor sign-ups, and a shop.",
    background: "linear-gradient(135deg,#2563EB,#7C3AED 55%,#DB2777)",
  },
  {
    name: "MCTeams",
    category: "Custom build · Gaming",
    url: "https://www.mcteams.com",
    displayUrl: "mcteams.com",
    description: "A high-energy landing page and community hub for a competitive Minecraft server.",
    background: "linear-gradient(135deg,#4F46E5,#7C3AED 55%,#0F172A)",
  },
  {
    name: "Must Be Nuts",
    category: "Online store · Food",
    url: "https://mustbenuts.com/",
    displayUrl: "mustbenuts.com",
    description: "A playful storefront for small-batch gourmet peanut butter loaded with real mix-ins.",
    background: "linear-gradient(135deg,#C8822E,#8A5520 55%,#4A2E12)",
  },
] as const satisfies readonly PortfolioProject[];
