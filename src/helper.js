import Anthropic from "@anthropic-ai/sdk";
import { Op } from "sequelize";
import { Brand } from "./models/index.js";
import { searchImages } from "./services/shutterstock.js";

const claudeApiKey = process.env.CLAUDE_API_KEY;
const claudeModel = process.env.CLAUDE_MODEL || "claude-opus-4-6";
const useClaude = Boolean(claudeApiKey);
const anthropic = useClaude ? new Anthropic({ apiKey: claudeApiKey }) : null;

function getClient() {
  if (!anthropic) {
    throw new Error(
      "Anthropic client is not initialised. Set CLAUDE_API_KEY or ANTHROPIC_API_KEY."
    );
  }
  return anthropic;
}

export async function generateClaudeHtml(prompt) {
  const anthropicInstruction = `You are an HTML content generator. When creating content with images, always use valid image URLs from free stock photo services like:
- https://via.placeholder.com/600x400 (for placeholders)
- https://source.unsplash.com/600x400?random (for random images)
- https://picsum.photos/600/400 (for random images)

For every image tag, provide a complete img element with src and alt attributes. Example: <img src="https://via.placeholder.com/600x400" alt="description">

Generate only the HTML content for the main section of the page, such as paragraphs, images, lists, headings, etc. Do not include <html>, <head>, <body>, <header>, or <footer> tags. Output only valid HTML fragments.`;

  const response = await anthropic.messages.create({
    model: claudeModel,
    max_tokens: 1000,
    system: anthropicInstruction,
    messages: [
      { role: "user", content: "Generate HTML content for a page based on this prompt: " + prompt }
    ],
  });

  return response.content[0].text;
}

export async function analyzeBrand(sourceUrl, file = null) {
  // file: { data: Buffer, mimeType: string } - image or PDF

  // Ensure URL has a protocol
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    sourceUrl = "https://" + sourceUrl;
  }

  // Capture screenshot + meta via Puppeteer when a URL is given and no file uploaded
  let pageMeta = null;
  if (sourceUrl && !file) {
    try {
      const { captureWebsite } = await import("./services/puppeteer.js");
      const captured = await captureWebsite(sourceUrl);
      file = captured;
      pageMeta = captured.meta;
    } catch (err) {
      console.warn("[analyzeBrand] Puppeteer capture failed, falling back to URL-only:", err.message);
    }
  }

  const fileMimeType = file ? file.mimeType : "unknown";
  const inputSection = sourceUrl
    ? "Source Type URL: " + sourceUrl
    : "Source Type: Uploaded file (" + fileMimeType + ")";

  const scrapedColors = pageMeta && pageMeta.scraped_colors ? pageMeta.scraped_colors : null;
  const colorSection = scrapedColors
    ? `========================
SCRAPED COLORS (extracted from live DOM)
========================
Primary button color:   ${scrapedColors.primary   || "not found"}
Secondary button color: ${scrapedColors.secondary || "not found"}
Accent / tertiary:      ${scrapedColors.tertiary  || "not found"}
Surface colors (dark/light): ${(scrapedColors.others || []).join(", ") || "not found"}

`
    : "";

  const metaSection = pageMeta
    ? `========================
PAGE METADATA (scraped from live site)
========================
Title: ${pageMeta.title || ""}
Description: ${pageMeta.description || ""}
OG Title: ${pageMeta.og_title || ""}
OG Image: ${pageMeta.og_image || ""}
Favicon URL: ${pageMeta.favicon || ""}
Header Logo URL: ${pageMeta.main_logo || ""}
Invert Logo URL: ${pageMeta.invert_logo || ""}

${colorSection}`
    : "";

  const prompt = `You are a Brand Intelligence AI.

Analyze a brand based on a website screenshot and metadata.

========================
INPUT
========================
${inputSection}

${metaSection}========================
OUTPUT (STRICT JSON)
========================
{
  "brand_name": "",
  "tagline": "",
  "description": "",
  "logo": {
    "favicon": "",
    "main_logo": "",
    "invert_logo": ""
  },
  "colors": [],
  "core_value": [],
  "tone": [],
  "aesthetics": [],
  "target": {
    "countries": [],
    "destinations_focus": []
  },
  "industry_context": [],
  "narrative": ""
}

========================
INSTRUCTIONS
========================
- Use the screenshot image and page metadata as primary signals
- Keep answers short, clear, and non-generic
- Colors must be in hex code
- For the colors array and color_palette, use these roles:
  * colors[0] / primary:   most used button / CTA color
  * colors[1] / secondary: second button or brand color
  * colors[2] / tertiary:  accent color (links, badges, highlights)
  * colors[3+] / others:   dark and light surface colors (backgrounds, cards, panels)
- If SCRAPED COLORS has values, use them as the source of truth for each role
- If SCRAPED COLORS is mostly "not found" or null (e.g. Framer/Webflow/React sites with CSS-in-JS), extract colors visually from the screenshot — identify the dominant brand color from buttons, CTAs, links, and hero sections
- Core value: Fundamental beliefs that drive the brand's message and purpose.
- Tone examples: professional, playful, luxury, friendly
- Aesthetics examples: explorer, luxury, innovator, caregiver
- Get target audience by listing countries based on destination targeted from website / image
- Industry context: classifies the brand's business sector to ensure industry-specific terminology and context in the generated copy.
- Always return valid JSON only

========================
LOGO & FAVICON RESOLUTION
========================
Use the scraped URLs from PAGE METADATA directly — do not guess or construct paths:

favicon:    Use "Favicon URL" from PAGE METADATA as-is
main_logo:  Use "Header Logo URL" from PAGE METADATA as-is; if empty, fall back to "OG Image" if it looks like a logo, otherwise use favicon
invert_logo: Use "Invert Logo URL" from PAGE METADATA as-is; if empty, return null

========================
NARRATIVE INSTRUCTIONS
========================
Write the narrative with a strong travel intent lens:
- Frame the brand's purpose around the desire to explore, discover, or experience the world
- Connect core values to how they enable or inspire travel journeys (e.g. freedom, adventure, comfort, discovery, connection)
- Reference the destinations_focus or target countries to ground the narrative in specific travel contexts
- Use evocative, aspirational language that makes the reader feel the pull of a journey
- 2-3 sentences maximum; punchy and inspiring, not generic
- Example style: "Airbnb unlocks a world where every destination feels like home — connecting adventurous souls with authentic local experiences across 190+ countries. Built for travelers who seek belonging over sightseeing."

========================
GOAL
========================
Return a clean, usable brand persona for travel-focused UI personalization and marketing`;

  // Build message content - screenshot/file block first, then prompt
  const userContent = [];

  if (file) {
    const base64Data = file.data.toString("base64");
    if (file.mimeType === "application/pdf") {
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64Data },
      });
    } else {
      // image/*
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: file.mimeType, data: base64Data },
      });
    }
  }

  userContent.push({ type: "text", text: prompt });

  const msg = await getClient().messages.create({
    model: claudeModel,
    max_tokens: 20000,
    temperature: 1,
    system: "You are a Brand Intelligence AI that returns only valid JSON.",
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("No text content in brand analysis response");
  }

  const rawJson = textBlock.text.replace(/```json|```/g, "").trim();

  const brandData = JSON.parse(rawJson);

  // Build structured color palette from colors array
  const colors = brandData.colors || [];
  brandData.color_palette = {
    primary:   colors[0] || null,
    secondary: colors[1] || null,
    tertiary:  colors[2] || null,
    others:    colors.slice(3),
  };

  const slug = brandData.brand_name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  // Match by URL or slug — prevents duplicate slug when same domain is submitted
  // with different URL formats (http vs https, www vs non-www, trailing slash, etc.)
  const whereClause = sourceUrl
    ? { [Op.or]: [{ url: sourceUrl }, { slug }] }
    : { slug };

  let brand = await Brand.findOne({ where: whereClause });

  const logo = brandData.logo && brandData.logo.main_logo ? brandData.logo.main_logo : null;
  const enrichedJson = JSON.stringify(brandData);

  if (brand) {
    await brand.update({
      name: brandData.brand_name,
      slug,
      logo,
      url: sourceUrl || brand.url,
      raw_data: enrichedJson,
    });
  } else {
    brand = await Brand.create({
      name: brandData.brand_name,
      slug,
      logo,
      url: sourceUrl,
      raw_data: enrichedJson,
    });
  }

  brandData.id = brand.id;
  brandData.slug = slug;

  return brandData;
}

export async function generateBannerContent(brandData, brief) {
  const briefText = brief || "";
  const briefSection = briefText
    ? "========================\nCAMPAIGN BRIEF\n========================\n" + briefText + "\n\n"
    : "";

  const toneStr = (brandData.tone || []).join(", ") || "professional";
  const aestheticsStr = (brandData.aesthetics || []).join(", ") || "modern";
  const briefInstruction = briefText
    ? "- Prioritize the campaign brief direction when shaping tone, message, and imagery\n"
    : "";

  const destinationsStr = (brandData.target && brandData.target.destinations_focus || []).join(", ");
  const countriesStr = (brandData.target && brandData.target.countries || []).join(", ");

  const prompt = `You are a travel marketing copywriter specializing in homepage banner ads.

Given the brand data below, generate 3 different homepage banner variations with a strong travel intent.

Each banner must include:
1. A short, punchy header with travel intent
2. A supporting sub-header that deepens the travel desire
3. A Shutterstock image search query that captures the destination or journey mood

========================
BRAND DATA
========================
${JSON.stringify(brandData, null, 2)}

${briefSection}========================
OUTPUT (STRICT JSON)
========================
{
  "banners": [
    {
      "header": "",
      "sub_header": "",
      "image_query": ""
    }
  ]
}

========================
INSTRUCTIONS
========================
- header: Short, aspirational travel statement (max 8 words) — evoke wanderlust, adventure, discovery, or escape. Use action words like "Explore", "Discover", "Escape to", "Journey to", "Experience"
- sub_header: Reinforces the header with a destination-specific or experience-driven line (max 20 words) — mention specific destinations (${destinationsStr || "global destinations"}), journeys, or unique experiences the brand enables
- image_query: Shutterstock search phrase — follow these rules:
  * If the banner theme involves a specific character name (cartoon, anime, fictional character), artist name, celebrity, movie title, TV show, or game title: use that name as the primary keyword followed by 1-2 descriptive words (e.g. "Spider-Man action pose", "Mickey Mouse cheerful")
  * Otherwise: use destination or travel scene keywords aligned with the brand's target regions (${destinationsStr || countriesStr || "travel landscape"}) and tone (${toneStr}) — e.g. "Bali rice terraces aerial sunrise", "Santorini cliffside sunset luxury", "Tokyo street night neon travel"
- Each of the 3 banners must have a distinctly different angle: e.g. one adventure-focused, one luxury-focused, one cultural/local-focused
- Match the brand's tone (${toneStr}) and aesthetics (${aestheticsStr})
${briefInstruction}- Always return valid JSON only`;

  const msg = await getClient().messages.create({
    model: claudeModel,
    max_tokens: 1024,
    temperature: 1,
    system: "You are a marketing copywriter that returns only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("No text content in banner generation response");
  }

  const rawJson = textBlock.text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(rawJson);

  // Fetch images for each banner
  const bannersWithImages = await Promise.all(
    parsed.banners.map(async (banner) => {
      const images = await searchImages(banner.image_query);
      return {
        header: banner.header,
        sub_header: banner.sub_header,
        image_query: banner.image_query,
        images,
      };
    })
  );

  return {
    banners: bannersWithImages,
  };
}

/**
 * Interprets a free-text brief and applies updates to banner and/or color_palette.
 * Claude decides what changed; only affected fields are returned.
 *
 * Returns { banner?, color_palette? }
 */
export async function updateBrandFromBrief(rawData, brief) {
  const currentBanner = rawData.banner || {};
  const currentPalette = rawData.color_palette || {};
  const toneStr = (rawData.tone || []).join(", ") || "professional";
  const aestheticsStr = (rawData.aesthetics || []).join(", ") || "modern";

  const prompt = `You are a brand assistant that interprets update commands and returns structured changes.

========================
BRAND CONTEXT
========================
Brand: ${rawData.brand_name || ""}
Tone: ${toneStr}
Aesthetics: ${aestheticsStr}
Tagline: ${rawData.tagline || ""}

========================
CURRENT STATE
========================
Banner header: ${currentBanner.header || ""}
Banner sub-header: ${currentBanner.sub_header || ""}
Color primary: ${currentPalette.primary || ""}
Color secondary: ${currentPalette.secondary || ""}
Color tertiary: ${currentPalette.tertiary || ""}

========================
USER BRIEF
========================
${brief}

========================
OUTPUT (STRICT JSON)
========================
{
  "update_banner": false,
  "banner": {
    "header": "",
    "sub_header": "",
    "update_image": false,
    "image_query": ""
  },
  "update_colors": false,
  "color_palette": {
    "primary": "",
    "secondary": "",
    "tertiary": ""
  }
}

========================
INSTRUCTIONS
========================
- Read the brief and detect intent: banner copy change, banner image change, color change, or any combination
- update_banner: true if the brief asks to change header, sub-header, or banner image/visual
- banner.header / banner.sub_header: new values if changed, otherwise repeat current values
- banner.update_image: true only if brief mentions visuals, image, background, scene, photo, or new mood
- banner.image_query: 3-6 Shutterstock keyword phrase only when update_image is true
- update_colors: true if the brief mentions button color, primary color, brand color, or any hex code or color name
- color_palette: only include primary/secondary/tertiary that are explicitly changed; use empty string "" for unchanged ones
- Always return valid JSON only`;

  const msg = await getClient().messages.create({
    model: claudeModel,
    max_tokens: 512,
    temperature: 1,
    system: "You are a brand assistant that returns only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text content in brand update response");

  const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, "").trim());
  const result = {};

  // ── Banner ──────────────────────────────────────────────────────────────
  if (parsed.update_banner) {
    const b = parsed.banner || {};
    result.banner = {
      header:     b.header     || currentBanner.header     || null,
      sub_header: b.sub_header || currentBanner.sub_header || null,
      image:      currentBanner.image || null,
    };

    if (b.update_image && b.image_query) {
      const images = await searchImages(b.image_query);
      result.banner.image_query = b.image_query;
      result.banner.image = images[0] || null;
    }
  }

  // ── Color palette ────────────────────────────────────────────────────────
  if (parsed.update_colors) {
    const c = parsed.color_palette || {};
    result.color_palette = {
      primary:   c.primary   || currentPalette.primary   || null,
      secondary: c.secondary || currentPalette.secondary || null,
      tertiary:  c.tertiary  || currentPalette.tertiary  || null,
      others:    currentPalette.others || [],
    };
  }

  return result;
}

/**
 * Analyses a brand's compatibility and partnership potential with Travlr.com.
 * Returns a structured JSON report with opportunity scoring, campaign ideas, etc.
 */
export async function analyzeTravlrCompatibility(brandData) {
  const prompt = `You are a travel industry partnership strategist at Travlr.com — a leading online travel agency (OTA) platform that sells flights, hotels, tours, experiences, and travel packages globally.

Analyse the brand below and produce a detailed compatibility and opportunity report for a potential Travlr.com partnership.

========================
BRAND DATA
========================
${JSON.stringify(brandData, null, 2)}

========================
OUTPUT (STRICT JSON)
========================
{
  "compatibility_score": 0,
  "compatibility_label": "",
  "travel_relevance": "",
  "summary": "",
  "strengths": [],
  "challenges": [],
  "audience_overlap": {
    "score": 0,
    "description": "",
    "shared_segments": []
  },
  "partnership_types": [
    {
      "type": "",
      "description": "",
      "potential": ""
    }
  ],
  "campaign_ideas": [
    {
      "title": "",
      "concept": "",
      "format": "",
      "target_audience": "",
      "expected_outcome": ""
    }
  ],
  "destination_opportunities": [],
  "revenue_models": [],
  "quick_wins": [],
  "long_term_plays": [],
  "risk_factors": [],
  "recommendation": ""
}

========================
INSTRUCTIONS
========================
compatibility_score: integer 0-100 reflecting how well this brand aligns with Travlr.com's travel marketplace
compatibility_label: one of "Ideal Partner", "Strong Fit", "Moderate Fit", "Niche Fit", "Low Fit"
travel_relevance: one of "Core Travel", "Travel Adjacent", "Lifestyle & Travel", "Non-Travel with Travel Potential", "Non-Travel"
summary: 2-3 sentence executive summary of the brand's partnership potential with Travlr.com

strengths: list of reasons why this brand is a good fit (e.g. aligned audience, destination focus, brand values)
challenges: list of friction points or risks in the partnership

audience_overlap.score: integer 0-100
audience_overlap.description: explain how the brand's audience maps to Travlr.com's travel bookers
audience_overlap.shared_segments: list of traveler types both brands reach (e.g. "luxury travelers", "solo backpackers", "family holidaymakers")

partnership_types: 2-4 partnership models (e.g. Co-branded campaign, Affiliate integration, Exclusive travel packages, Loyalty program tie-in, Sponsored content)
  - type: short name
  - description: how it would work
  - potential: "High" | "Medium" | "Low"

campaign_ideas: 3 specific, creative campaign concepts
  - title: campaign name
  - concept: what the campaign does
  - format: channel/format (e.g. "Social media + email", "OOH + digital", "Influencer + landing page")
  - target_audience: who it targets
  - expected_outcome: measurable goal (e.g. "15% uplift in bookings", "brand awareness in SEA market")

destination_opportunities: list of specific destinations or regions where the partnership makes most sense, based on the brand's target market

revenue_models: list of monetisation approaches (e.g. "Commission on bookings", "Co-funded media spend", "White-label travel packages")

quick_wins: 2-3 things that can be activated immediately
long_term_plays: 2-3 strategic initiatives for 12+ months

risk_factors: brand safety, audience mismatch, or market risks to be aware of

recommendation: one clear action sentence — what Travlr.com should do next with this brand

- Be specific to this brand — avoid generic statements
- Ground campaign ideas in the brand's actual tone, aesthetics, and target audience
- Always return valid JSON only`;

  const msg = await getClient().messages.create({
    model: claudeModel,
    max_tokens: 4096,
    temperature: 1,
    system: "You are a travel industry partnership strategist that returns only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text content in compatibility analysis response");

  return JSON.parse(textBlock.text.replace(/```json|```/g, "").trim());
}
