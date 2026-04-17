/**
 * Captures a screenshot and scrapes brand assets (favicon, logos) from a URL.
 * Returns { data: Buffer, mimeType, meta: { title, description, favicon, main_logo, invert_logo, og_image } }
 */
export async function captureWebsite(url) {
  const { default: puppeteer } = await import("puppeteer");

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "C:\\Users\\HP\\.cache\\puppeteer\\chrome\\win64-146.0.7680.153\\chrome-win64\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    // Extra wait for JS-rendered pages (Framer, Next.js, React SPAs)
    await new Promise((r) => setTimeout(r, 4000));

    const meta = await page.evaluate(() => {
      // ── Helpers ──────────────────────────────────────────────────────────

      function getMeta(name) {
        const el =
          document.querySelector('meta[name="' + name + '"]') ||
          document.querySelector('meta[property="og:' + name + '"]') ||
          document.querySelector('meta[property="' + name + '"]');
        return el ? el.getAttribute("content") : null;
      }

      function absUrl(href) {
        if (!href) return null;
        try { return new URL(href, location.href).href; } catch { return null; }
      }

      /**
       * Extract a usable logo URL from any element type:
       *  1. <img>              — src / data-src
       *  2. <svg>              — serialize to data URI; or follow <use href> to external file
       *  3. <object> / <embed> — data / src attribute
       *  4. any element        — CSS background-image url()
       */
      function logoUrl(el) {
        if (!el) return null;
        const tag = el.tagName.toUpperCase();

        // 1. img
        if (tag === "IMG") {
          return absUrl(
            el.src ||
            el.getAttribute("data-src") ||
            el.getAttribute("data-lazy-src") ||
            el.getAttribute("data-original")
          );
        }

        // 2. inline svg
        if (tag === "SVG") {
          // Follow <use> to an external sprite file
          const useEl = el.querySelector("use");
          if (useEl) {
            const href =
              useEl.getAttribute("href") ||
              useEl.getAttribute("xlink:href");
            if (href && !href.startsWith("#")) return absUrl(href.split("#")[0]);
          }
          // Serialize to data URI
          try {
            const svgStr = new XMLSerializer().serializeToString(el);
            const encoded = new TextEncoder().encode(svgStr);
            const binary = Array.from(encoded).map((b) => String.fromCharCode(b)).join("");
            return "data:image/svg+xml;base64," + btoa(binary);
          } catch { return null; }
        }

        // 3. object / embed
        if (tag === "OBJECT") return absUrl(el.getAttribute("data"));
        if (tag === "EMBED")  return absUrl(el.getAttribute("src"));

        // 4. CSS background-image (handles divs/spans/anchors used as logo containers)
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== "none") {
          const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (m) return absUrl(m[1]);
        }

        // 5. child svg inside a wrapper element
        const childSvg = el.querySelector("svg");
        if (childSvg) return logoUrl(childSvg);

        // 6. child img inside a wrapper element
        const childImg = el.querySelector("img");
        if (childImg) return logoUrl(childImg);

        return null;
      }

      // ── Favicon ──────────────────────────────────────────────────────────

      const faviconEl =
        document.querySelector("link[rel~='icon'][href*='.svg']") ||
        document.querySelector("link[rel~='icon'][href*='.png']") ||
        document.querySelector("link[rel~='icon']") ||
        document.querySelector("link[rel='shortcut icon']");
      const favicon = faviconEl ? absUrl(faviconEl.href) : absUrl("/favicon.ico");

      // ── Header / navbar logo ─────────────────────────────────────────────
      // Selectors cover: <img>, inline <svg>, CSS background, <object>/<embed>

      const logoSelectors = [
        // img in logo wrapper
        "header [class*='logo'] img",
        "header [id*='logo'] img",
        "nav [class*='logo'] img",
        "nav [id*='logo'] img",
        "[class*='navbar'] [class*='logo'] img",
        "[class*='header'] [class*='logo'] img",
        // inline svg in logo wrapper
        "header [class*='logo'] svg",
        "header [id*='logo'] svg",
        "nav [class*='logo'] svg",
        "nav [id*='logo'] svg",
        // the wrapper element itself (CSS bg-image or contains svg/img child)
        "header [class*='logo']",
        "header [id*='logo']",
        "nav [class*='logo']",
        "nav [id*='logo']",
        // standalone svg with logo class/id
        "header svg[class*='logo' i]",
        "header svg[id*='logo' i]",
        "nav svg[class*='logo' i]",
        // first linked img in header/nav
        "header a img:first-of-type",
        "nav a img:first-of-type",
        // img alt/src hints
        "header img[alt*='logo' i]",
        "header img[src*='logo' i]",
        "header img[src*='.svg']",
        // object/embed svg
        "header object[type='image/svg+xml']",
        "header embed[type='image/svg+xml']",
        // Framer / Webflow / SPA: first svg inside a header or nav anchor (no class hints)
        "header a svg",
        "nav a svg",
        "header > a svg",
        // fallback: any logo-named img on page
        "img[class*='logo' i]",
        "img[id*='logo' i]",
      ];

      let main_logo = null;
      for (const sel of logoSelectors) {
        const el = document.querySelector(sel);
        const src = logoUrl(el);
        if (src) { main_logo = src; break; }
      }

      // ── Invert / white logo ──────────────────────────────────────────────

      const invertSelectors = [
        // header explicit invert classes - img
        "header [class*='logo-white'] img",
        "header [class*='logo-light'] img",
        "header [class*='logo-invert'] img",
        "header [class*='white-logo'] img",
        "header img[src*='logo-white' i]",
        "header img[src*='logo-light' i]",
        "header img[src*='logo-inverted' i]",
        "header img[src*='white-logo' i]",
        "header img[alt*='white' i]",
        // header invert - svg
        "header [class*='logo-white'] svg",
        "header [class*='logo-light'] svg",
        "header [class*='logo-invert'] svg",
        // footer logo (commonly white/inverted)
        "footer [class*='logo'] img",
        "footer [id*='logo'] img",
        "footer [class*='logo'] svg",
        "footer [id*='logo'] svg",
        "footer [class*='logo']",
        "footer a img:first-of-type",
        "footer img[src*='logo' i]",
        "footer img[src*='.svg']",
        "footer img[alt*='logo' i]",
        "footer object[type='image/svg+xml']",
        // footer explicit invert
        "footer [class*='logo-white'] img",
        "footer [class*='logo-light'] img",
        "footer img[src*='logo-white' i]",
        "footer img[src*='logo-light' i]",
        "footer img[src*='white-logo' i]",
        // any element with invert/white keywords
        "img[src*='logo-white' i]",
        "img[src*='logo-light' i]",
        "img[src*='logo-inverted' i]",
        "img[src*='logo_white' i]",
        "img[src*='logo_light' i]",
        "img[src*='white-logo' i]",
        "img[src*='white_logo' i]",
        "img[class*='logo-white' i]",
        "img[class*='logo-light' i]",
        "img[class*='logo-invert' i]",
        "img[alt*='logo white' i]",
        "img[alt*='white logo' i]",
        // picture dark-mode source
        "picture source[media*='dark'] + img",
      ];

      let invert_logo = null;
      for (const sel of invertSelectors) {
        const el = document.querySelector(sel);
        const src = logoUrl(el);
        if (src && src !== main_logo) { invert_logo = src; break; }
      }

      // ── Color extraction ─────────────────────────────────────────────────

      function toHex(color) {
        if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return null;
        // Already hex
        if (/^#[0-9a-f]{3,8}$/i.test(color.trim())) {
          const h = color.trim();
          // Expand shorthand #abc -> #aabbcc
          if (h.length === 4) {
            return ("#" + h[1]+h[1]+h[2]+h[2]+h[3]+h[3]).toUpperCase();
          }
          return h.toUpperCase();
        }
        const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return null;
        return "#" + [m[1], m[2], m[3]]
          .map((v) => parseInt(v).toString(16).padStart(2, "0"))
          .join("").toUpperCase();
      }


      // Browser-default colors that appear even without brand styling
      const BROWSER_DEFAULTS = new Set(["#0000EE", "#551A8B", "#0000FF", "#800080"]);

      const luminance = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
      };
      const isGeneric = (hex) => {
        if (!hex) return true;
        if (BROWSER_DEFAULTS.has(hex)) return true;
        const lum = luminance(hex);
        return lum > 0.85 || lum < 0.02; // near-white or near-black
      };

      // ── Collect all non-generic colors from the page ─────────────────────
      // Covers Framer, Webflow, Next.js, and any CSS-in-JS / dynamic style system
      // by scanning: computed styles, inline styles, and injected <style> text

      const colorFreq = {}; // hex -> { count, roles: Set }

      function recordColor(hex, role) {
        if (!hex || isGeneric(hex)) return;
        if (!colorFreq[hex]) colorFreq[hex] = { count: 0, roles: new Set() };
        colorFreq[hex].count++;
        if (role) colorFreq[hex].roles.add(role);
      }

      // 1. Scan ALL visible elements for computed bg, fg, border colors
      const allEls = Array.from(document.querySelectorAll("*")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });

      // Extract first hex from a CSS gradient string
      function gradientHex(val) {
        if (!val || !val.includes("gradient")) return null;
        const m = val.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
        return m ? toHex(m[0]) : null;
      }

      for (const el of allEls) {
        const cs = window.getComputedStyle(el);
        const tag = el.tagName.toUpperCase();
        const cls = (el.className || "").toString().toLowerCase();
        const isBtn = tag === "BUTTON" || el.getAttribute("role") === "button" ||
          cls.includes("btn") || cls.includes("button") || cls.includes("cta");
        const isLink = tag === "A";
        const isNav = tag === "HEADER" || tag === "NAV" || tag === "FOOTER";

        const bg = toHex(cs.backgroundColor);
        const fg = toHex(cs.color);
        const border = toHex(cs.borderColor);
        // Gradient background (Framer, modern SPAs often use linear-gradient on CTAs)
        const bgImg = cs.backgroundImage;
        const gradColor = gradientHex(bgImg);

        if (bg) recordColor(bg, isBtn ? "button-bg" : isNav ? "surface" : null);
        if (gradColor) recordColor(gradColor, isBtn ? "button-bg" : null);
        if (fg && isBtn) recordColor(fg, "button-fg");
        if (fg && isLink && !isBtn) recordColor(fg, "link");
        if (border && isBtn) recordColor(border, "button-border");
      }

      // 2. Scan all <style> tags + injected CSSStyleSheet rules (covers Framer / CSS-in-JS)
      const allStyleText = (() => {
        const parts = Array.from(document.querySelectorAll("style"))
          .map((s) => s.textContent || "");
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules || []) {
              if (rule.cssText) parts.push(rule.cssText);
            }
          } catch { /* cross-origin stylesheet — skip */ }
        }
        return parts.join("\n");
      })();

      // Extract all hex values from style text and count occurrences
      const hexMatches = allStyleText.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g);
      for (const m of hexMatches) {
        const hex = toHex(m[0]);
        if (hex) recordColor(hex, null);
      }

      // CSS variable hints
      const cssVarColorKeywords = [
        "primary", "secondary", "accent", "brand", "cta",
        "button", "action", "highlight", "interactive",
      ];
      const cssVarColors = {};
      const cssVarMatches = allStyleText.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g);
      for (const m of cssVarMatches) {
        const prop = m[1].toLowerCase();
        const hex = toHex(m[2]);
        if (!hex || isGeneric(hex)) continue;
        for (const kw of cssVarColorKeywords) {
          if (prop.includes(kw) && !cssVarColors[kw]) cssVarColors[kw] = hex;
        }
      }

      // 3. Also read :root computed CSS custom properties
      const rootStyle = window.getComputedStyle(document.documentElement);
      for (let i = 0; i < rootStyle.length; i++) {
        const prop = rootStyle[i];
        if (!prop.startsWith("--")) continue;
        const val = rootStyle.getPropertyValue(prop).trim();
        const hex = toHex(val);
        if (!hex || isGeneric(hex)) continue;
        recordColor(hex, null);
        for (const kw of cssVarColorKeywords) {
          if (prop.toLowerCase().includes(kw) && !cssVarColors[kw]) cssVarColors[kw] = hex;
        }
      }

      // ── Resolve primary / secondary / tertiary / others from collected data ─

      const isDark = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 < 128;
      };

      // Button colors by frequency
      const buttonBgColors = Object.entries(colorFreq)
        .filter(([, v]) => v.roles.has("button-bg"))
        .sort((a, b) => b[1].count - a[1].count)
        .map(([hex]) => hex);

      // Link / accent colors by frequency
      const linkColors = Object.entries(colorFreq)
        .filter(([, v]) => v.roles.has("link"))
        .sort((a, b) => b[1].count - a[1].count)
        .map(([hex]) => hex);

      // Surface colors by frequency
      const surfaceColorList = Object.entries(colorFreq)
        .filter(([, v]) => v.roles.has("surface"))
        .sort((a, b) => b[1].count - a[1].count)
        .map(([hex]) => hex);

      // Primary: most used button bg → CSS var → most frequent link/accent color
      const primary =
        buttonBgColors[0] ||
        cssVarColors["primary"] ||
        cssVarColors["cta"] ||
        cssVarColors["brand"] ||
        cssVarColors["action"] ||
        linkColors[0] ||
        null;

      // Secondary: second button bg → CSS var fallback
      const secondary =
        buttonBgColors[1] ||
        cssVarColors["secondary"] ||
        linkColors.find((h) => h !== primary) ||
        null;

      // Tertiary: accent / link color → CSS var fallback
      const tertiary =
        cssVarColors["accent"] ||
        cssVarColors["highlight"] ||
        cssVarColors["interactive"] ||
        linkColors.find((h) => h !== primary && h !== secondary) ||
        null;

      // Others: dark and light surfaces
      const usedSet = new Set([primary, secondary, tertiary].filter(Boolean));
      const availSurfaces = surfaceColorList.filter((h) => !usedSet.has(h));
      const darks  = availSurfaces.filter(isDark).slice(0, 2);
      const lights = availSurfaces.filter((h) => !isDark(h)).slice(0, 2);
      const others = [...darks, ...lights];

      const scraped_colors = { primary, secondary, tertiary, others };

      return {
        title:         document.title || null,
        description:   getMeta("description") || null,
        og_title:      getMeta("title") || null,
        og_image:      absUrl(getMeta("image")) || null,
        favicon,
        main_logo,
        invert_logo,
        scraped_colors,
      };
    });

    const data = await page.screenshot({ fullPage: false, type: "jpeg", quality: 85 });

    return {
      data,
      mimeType: "image/jpeg",
      meta,
    };
  } finally {
    await browser.close();
  }
}
