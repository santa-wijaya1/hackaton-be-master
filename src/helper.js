import { GoogleGenerativeAI } from "@google/generative-ai";
import { Op } from "sequelize";
import { Brand } from "./models/index.js";
import { searchImages } from "./services/shutterstock.js";

const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const useGemini = Boolean(geminiApiKey);

const genAI = useGemini ? new GoogleGenerativeAI(geminiApiKey) : null;

function getModel(systemInstruction) {
  if (!genAI) {
    throw new Error(
      "Gemini client is not initialised. Set GEMINI_API_KEY in .env"
    );
  }
  return genAI.getGenerativeModel({
    model: geminiModel,
    systemInstruction,
  });
}

export async function generateClaudeHtml(prompt) {
  const systemInstruction = `You are an HTML content generator. When creating content with images, always use valid image URLs from free stock photo services like:
- https://via.placeholder.com/600x400 (for placeholders)
- https://source.unsplash.com/600x400?random (for random images)
- https://picsum.photos/600/400 (for random images)

For every image tag, provide a complete img element with src and alt attributes. Example: <img src="https://via.placeholder.com/600x400" alt="description">

Generate only the HTML content for the main section of the page, such as paragraphs, images, lists, headings, etc. Do not include <html>, <head>, <body>, <header>, or <footer> tags. Output only valid HTML fragments.`;

  const model = getModel(systemInstruction);
  const result = await model.generateContent("Generate HTML content for a page based on this prompt: " + prompt);
  const response = await result.response;
  return response.text();
}

export async function analyzeBrand(sourceUrl, file = null) {
  // Ensure URL has a protocol
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    sourceUrl = "https://" + sourceUrl;
  }

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

  const model = getModel("You are a Brand Intelligence AI that returns only valid JSON.");
  
  const contentParts = [];
  if (file) {
    contentParts.push({
      inlineData: {
        data: file.data.toString("base64"),
        mimeType: file.mimeType,
      },
    });
  }
  contentParts.push({ text: prompt });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: contentParts }],
  });
  
  const response = await result.response;
  const rawJson = response.text().replace(/```json|```/g, "").trim();
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
- header: Short, aspirational travel statement (max 8 words)
- sub_header: Reinforces the header with a destination-specific or experience-driven line (max 20 words)
- image_query: Shutterstock search phrase
- Always return valid JSON only`;

  const model = getModel("You are a marketing copywriter that returns only valid JSON.");
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const rawJson = response.text().replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(rawJson);

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

  return { banners: bannersWithImages };
}

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
- Always return valid JSON only`;

  const model = getModel("You are a brand assistant that returns only valid JSON.");
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const parsed = JSON.parse(response.text().replace(/```json|```/g, "").trim());
  
  const resultData = {};

  if (parsed.update_banner) {
    const b = parsed.banner || {};
    resultData.banner = {
      header:     b.header     || currentBanner.header     || null,
      sub_header: b.sub_header || currentBanner.sub_header || null,
      image:      currentBanner.image || null,
    };

    if (b.update_image && b.image_query) {
      const images = await searchImages(b.image_query);
      resultData.banner.image_query = b.image_query;
      resultData.banner.image = images[0] || null;
    }
  }

  if (parsed.update_colors) {
    const c = parsed.color_palette || {};
    resultData.color_palette = {
      primary:   c.primary   || currentPalette.primary   || null,
      secondary: c.secondary || currentPalette.secondary || null,
      tertiary:  c.tertiary  || currentPalette.tertiary  || null,
      others:    currentPalette.others || [],
    };
  }

  return resultData;
}

export async function analyzeTravlrCompatibility(brandData) {
  const prompt = `Analyse the brand below and produce a detailed compatibility and opportunity report for a potential Travlr.com partnership.

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
- Always return valid JSON only`;

  const model = getModel("You are a travel industry partnership strategist that returns only valid JSON.");
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return JSON.parse(response.text().replace(/```json|```/g, "").trim());
}
