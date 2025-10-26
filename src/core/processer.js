import * as cheerio from 'cheerio';
import crypto from "crypto";
import { fetch } from 'undici';
import { parentPort } from 'worker_threads';
import { fileLog, fileErrorLog } from '../logger/index.js';

export class PuppeteerRequiredError extends Error {
    constructor(message) { super(message); this.name = 'PuppeteerRequiredError'; }
}

async function getHtmlWithPuppeteer(browser, url) {
    let page = null;
    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        return await page.content();
    } finally {
        if (page) {
            await page.close();
        }
    }
}

export async function getHtmlPage(browser, url) {
    // --- START: Hybrid Crawling Strategy ---
    try {
        // Step 1: Try with a lightweight fetch first
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const html = await response.text();

        // Step 2: Check for signs of Cloudflare. If found, throw a specific error.
        if (html.includes('Checking your browser') || html.includes('id="challenge-form"') || html.includes("Just a moment...")) {
            throw new PuppeteerRequiredError(`Puppeteer required for ${url}`);
        }

        // If no challenge, return the lightweight result
        return html;
    } catch (error) {
        // If we don't have a browser instance, we can't proceed with Puppeteer.
        // Re-throw the error so the fetch worker can handle it (e.g., by marking the job as 'requires_puppeteer').
        if (!browser) {
            throw error;
        }

        // If we are in a worker that HAS a browser, any fetch-related error should trigger a fallback to Puppeteer.
        if (error instanceof PuppeteerRequiredError) {
            parentPort?.postMessage(`[INFO] Puppeteer required for ${url}. Switching to Puppeteer.`);
        } else {
            parentPort?.postMessage(`[WARN] Initial fetch for ${url} failed, falling back to Puppeteer. Error: ${error.message}`);
        }
        
        // Proceed with Puppeteer.
        return await getHtmlWithPuppeteer(browser, url);
    }
    // --- END: Hybrid Crawling Strategy ---
}

export function generateId(text) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function extractLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set(); // Use a Set to avoid duplicates from the same page
    const ignoreExtensions = [
      // images
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico',
      // video/audio
      '.mp4', '.webm', 'avi', '.mov', '.mkv', '.mp3', '.wav', '.ogg',
      // documents
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar',
      // code/styles
      '.css', '.js'
    ];
  
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
  
      try {
        const absoluteUrl = new URL(href, baseUrl);
        
        // 1. Check if it belongs to the same origin
        if (absoluteUrl.origin !== baseUrl) {
          return;
        }
  
        // 2. Filter out media/script files
        if (ignoreExtensions.some(ext => absoluteUrl.pathname.toLowerCase().endsWith(ext))) {
          return;
        }
  
        // 3. Add the cleaned URL (without fragment)
        links.add(absoluteUrl.origin + absoluteUrl.pathname);
      } catch (e) {
        // Ignore invalid URLs
      }
    });
  
    return Array.from(links);
}

export function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

export function keepOnlyEnglish(text) {
    return text.replace(/[^\x00-\x7F]/g, "").trim();
}

export async function htmlProcesser(html, paths) {
    const $ = cheerio.load(html);

    let result = "";

    function traverse(node) {
        if (node.type === "text") {
            let text = $(node).text().trim();
            if (text) {
                text = keepOnlyEnglish(text);
                if (text) {
                    result += text + " ";
                }
            }
        }

        if (node.type === "tag") {
            if (node.name === "img") {
                const src = $(node).attr("src") || $(node).attr("data-src");
                if (src) {
                    result += src + " ";
                }
            } else {
                // الاقتراح: تجاهل محتوى figcaption لمنع إضافة اسم ناشر الصورة
                if (node.name !== 'figcaption') {
                    $(node).contents().each((i, child) => traverse(child));
                }
            }
        }
    }

    if (!Array.isArray(paths)) {
        paths = [paths];
    }

    for (const path of paths) {
        const root = $(path);
        // التحسين: قم بإزالة العناصر غير المرغوب فيها من داخل العنصر المستهدف فقط
        root.find("script, style, noscript, iframe, form, header, footer, aside").remove();
        root.contents().each((i, el) => traverse(el));
    }

    const totalWords = countWords(result);
    if (totalWords < 200) throw new Error("Article less than 200 words");

    const lang = $("html").attr("lang");
    if (!lang?.startsWith("en")) throw new Error("Not an English article");

    // --- START: Extract More Data ---
    const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || null;
    const image = $('meta[property="og:image"]').attr('content') || null;
    const author = $('meta[name="author"]').attr('content') || null;
    const publishedDate = $('meta[property="article:published_time"]').attr('content') || $('time').attr('datetime') || null;
    // --- END: Extract More Data ---

    const article = {
        contents: result.trim(),
        title: keepOnlyEnglish($("title").first().text()),
        lang,
        description: description ? keepOnlyEnglish(description) : null,
        image,
        author,
        publishedDate: publishedDate ? new Date(publishedDate) : null
    };

    return article;
}