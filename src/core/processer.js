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
    
    try {
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const html = await response.text();

        
        if (html.includes('Checking your browser') || html.includes('id="challenge-form"') || html.includes("Just a moment...")) {
            throw new PuppeteerRequiredError(`Puppeteer required for ${url}`);
        }

        
        return html;
    } catch (error) {
        
        
        if (!browser) {
            throw error;
        }

        
        if (error instanceof PuppeteerRequiredError) {
            parentPort?.postMessage(`[INFO] Puppeteer required for ${url}. Switching to Puppeteer.`);
        } else {
            parentPort?.postMessage(`[WARN] Initial fetch for ${url} failed, falling back to Puppeteer. Error: ${error.message}`);
        }
        
        
        return await getHtmlWithPuppeteer(browser, url);
    }
    
}

export function generateId(text) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function extractLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set(); 
    const ignoreExtensions = [
      
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico',
      
      '.mp4', '.webm', 'avi', '.mov', '.mkv', '.mp3', '.wav', '.ogg',
      
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar',
      
      '.css', '.js'
    ];
  
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
  
      try {
        const absoluteUrl = new URL(href, baseUrl);
        
        
        if (absoluteUrl.origin !== baseUrl) {
          return;
        }
  
        
        if (ignoreExtensions.some(ext => absoluteUrl.pathname.toLowerCase().endsWith(ext))) {
          return;
        }
  
        
        links.add(absoluteUrl.origin + absoluteUrl.pathname);
      } catch (e) {
        
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
        
        root.find("script, style, noscript, iframe, form, header, footer, aside").remove();
        root.contents().each((i, el) => traverse(el));
    }

    const totalWords = countWords(result);
    if (totalWords < 200) throw new Error("Article less than 200 words");

    const lang = $("html").attr("lang");
    if (!lang?.startsWith("en")) throw new Error("Not an English article");

    
    const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || null;
    const image = $('meta[property="og:image"]').attr('content') || null;
    const author = $('meta[name="author"]').attr('content') || null;
    const publishedDate = $('meta[property="article:published_time"]').attr('content') || $('time').attr('datetime') || null;
    

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
