import { GoogleGenerativeAI } from "@google/generative-ai";
import { Op } from "sequelize";
import { Brand } from "./models/index.js";
import { searchImages } from "./services/shutterstock.js";

const geminiApiKey = process.env.GEMINI_API_KEY;
const useGemini = Boolean(geminiApiKey);

// Gemini 2.0 Flash is the latest and fastest model available
const MODEL_FLASH = "gemini-2.0-flash"; 

const genAI = useGemini ? new GoogleGenerativeAI(geminiApiKey) : null;

/**
 * getModel uses Gemini 2.0 Flash for all tasks as requested.
 */
function getModel(systemInstruction) {
  if (!genAI) {
    throw new Error(
      "Gemini client is not initialised. Set GEMINI_API_KEY in .env"
    );
  }
  return genAI.getGenerativeModel({
    model: MODEL_FLASH,
    systemInstruction,
  });
}

export async function generateClaudeHtml(prompt) {
  const systemInstruction = `You are an HTML content generator. Generate only valid HTML fragments.`;
  const model = getModel(systemInstruction);
  const result = await model.generateContent("Generate HTML content for a page based on this prompt: " + prompt);
  const response = await result.response;
  return response.text();
}

export async function analyzeBrand(sourceUrl, file = null) {
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
      console.warn("[analyzeBrand] Puppeteer capture failed:", err.message);
    }
  }

  const inputSection = sourceUrl ? "Source Type URL: " + sourceUrl : "Source Type: Uploaded file";
  const prompt = `You are a Brand Intelligence AI. Analyze brand from screenshot and metadata and return valid JSON.`;

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

  const colors = brandData.colors || [];
  brandData.color_palette = {
    primary:   colors[0] || null,
    secondary: colors[1] || null,
    tertiary:  colors[2] || null,
    others:    colors.slice(3),
  };

  const slug = brandData.brand_name.toLowerCase().trim().replace(/\s+/g, "-");
  const whereClause = sourceUrl ? { [Op.or]: [{ url: sourceUrl }, { slug }] } : { slug };
  let brand = await Brand.findOne({ where: whereClause });
  const logo = brandData.logo && brandData.logo.main_logo ? brandData.logo.main_logo : null;

  if (brand) {
    await brand.update({ name: brandData.brand_name, slug, logo, url: sourceUrl || brand.url, raw_data: JSON.stringify(brandData) });
  } else {
    brand = await Brand.create({ name: brandData.brand_name, slug, logo, url: sourceUrl, raw_data: JSON.stringify(brandData) });
  }

  brandData.id = brand.id;
  brandData.slug = slug;
  return brandData;
}

export async function generateBannerContent(brandData, brief) {
  const prompt = `You are a travel marketing copywriter specializing in homepage banner ads. Generate 3 banners in valid JSON.`;
  const model = getModel("You are a marketing copywriter that returns only valid JSON.");
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const parsed = JSON.parse(response.text().replace(/```json|```/g, "").trim());

  const bannersWithImages = await Promise.all(
    parsed.banners.map(async (banner) => {
      const images = await searchImages(banner.image_query);
      return { ...banner, images };
    })
  );

  return { banners: bannersWithImages };
}

export async function updateBrandFromBrief(rawData, brief) {
  const prompt = `You are a brand assistant interpreting updates...`;
  const model = getModel("You are a brand assistant that returns only valid JSON.");
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const parsed = JSON.parse(response.text().replace(/```json|```/g, "").trim());
  
  const resultData = {};
  if (parsed.update_banner) {
    const b = parsed.banner || {};
    resultData.banner = { 
      header: b.header || rawData.banner?.header || null,
      sub_header: b.sub_header || rawData.banner?.sub_header || null,
      image: rawData.banner?.image || null 
    };
    if (b.update_image && b.image_query) {
      const images = await searchImages(b.image_query);
      resultData.banner.image = images[0] || null;
    }
  }
  if (parsed.update_colors) {
    const c = parsed.color_palette || {};
    resultData.color_palette = {
      primary: c.primary || rawData.color_palette?.primary || null,
      secondary: c.secondary || rawData.color_palette?.secondary || null,
      tertiary: c.tertiary || rawData.color_palette?.tertiary || null,
      others: rawData.color_palette?.others || [],
    };
  }
  return resultData;
}

export async function analyzeTravlrCompatibility(brandData) {
  const prompt = `Analyse partnership potential for Travlr.com based on the brand data provided and return valid JSON.`;
  const model = getModel("You are a travel industry partnership strategist that returns only valid JSON.");
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return JSON.parse(response.text().replace(/```json|```/g, "").trim());
}
