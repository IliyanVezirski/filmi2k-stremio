const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const BASE_URL = 'https://www.filmi2k.com';
const cache = new NodeCache({ stdTTL: 3600 });
const imdbCache = new NodeCache({ stdTTL: 86400 * 7 }); // 7 days for IMDb mappings
const slugByImdb = {}; // reverse map: tt ID → filmi2k slug

const CATEGORIES = {
    'filmi2k-ekshan': { name: 'Екшън', path: '/category/filmi-ekshan/' },
    'filmi2k-komediya': { name: 'Комедия', path: '/category/komediya-filmi/' },
    'filmi2k-fantastika': { name: 'Фантастика', path: '/category/filmi-fantastika/' },
    'filmi2k-ujasi': { name: 'Ужаси', path: '/category/filmi-ujasi/' },
    'filmi2k-priklyuchenski': { name: 'Приключенски', path: '/category/filmi-priklyuchenski1/' },
    'filmi2k-drama': { name: 'Драма', path: '/category/filmi-drama/' },
    'filmi2k-trilar': { name: 'Трилър', path: '/category/filmi-trilar/' },
    'filmi2k-animatsiya': { name: 'Анимация', path: '/category/filmi-animatsiya/' },
    'filmi2k-western': { name: 'Уестърн', path: '/category/filmi-western/' },
    'filmi2k-voenni': { name: 'Военни', path: '/category/filmi-voenni/' },
    'filmi2k-indiiski': { name: 'Индийски', path: '/category/indiiski-filmi/' },
    'filmi2k-top-imdb': { name: 'Топ IMDb', path: '/tag/top-250-imdb-filmi/' },
    'filmi2k-dokumentalni': { name: 'Документални', path: '/category/nauchno-populyarni-filmi/' },
    'filmi2k-seriali': { name: 'Сериали', path: '/onlayn-seriali/' },
    'filmi2k-newest': { name: 'Най-нови', path: '/' },
};

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'bg,en-US;q=0.7,en;q=0.3',
    'Referer': BASE_URL,
};

const VERBOSE = process.env.HTTP_DEBUG === '1';
let PROXY_URL = process.env.PROXY_URL || null;

if (!PROXY_URL) {
    if (VERBOSE) console.log(`[PROXY] Using default proxy (Jina.ai)`);
}

if (VERBOSE) {
    console.log(`[PROXY] VERBOSE mode enabled`);
    console.log(`[PROXY] PROXY_URL from env: ${PROXY_URL || 'NULL - using default'}`);
}

const PROXY_BASE = 'https://api.allorigins.win/get?url=';

async function fetchUrl(url, options = {}) {
    const { headers = HEADERS, timeout = 15000, ...rest } = options;
    const useProxy = url.includes('filmi2k.com') && !url.includes('wp-json');
    if (useProxy) {
        if (VERBOSE) console.log(`[PROXY] Fetching via proxy: ${url}`);
        const proxyFullUrl = `${PROXY_BASE}${encodeURIComponent(url)}`;
        if (VERBOSE) console.log(`[PROXY] Full proxy URL: ${proxyFullUrl}`);
        const res = await axios.get(proxyFullUrl, { headers, timeout, ...rest });
        const data = typeof res.data === 'string' ? res.data : res.data.contents;
        return data;
    }
    if (VERBOSE) console.log(`[HTTP] Direct fetch: ${url}`);
    const res = await axios.get(url, { headers, timeout, ...rest });
    return res.data;
}

if (VERBOSE) {
    axios.interceptors.request.use((cfg) => {
        try {
            const m = (cfg.method || 'GET').toUpperCase();
            const u = cfg.url || '';
            console.log(`[HTTP] ${m} ${u}`);
        } catch {}
        return cfg;
    });
}
axios.interceptors.response.use(
    (res) => res,
    (err) => {
        try {
            const r = err && err.response;
            if (r) {
                const u = r.config && r.config.url ? r.config.url : '';
                console.error(`[HTTP] ${r.status} ${u}`);
                const h = r.headers || {};
                const info = { server: h.server, 'cf-ray': h['cf-ray'], 'content-type': h['content-type'] };
                console.error(`[HTTP] ${JSON.stringify(info)}`);
            } else if (err && err.message) {
                console.error(`[HTTP] ${err.message}`);
            }
        } catch {}
        return Promise.reject(err);
    }
);

// ─── Helpers ─────────────────────────────────────────────

function slugFromUrl(url) {
    return url.replace(BASE_URL, '').replace(/^\/|\/$/g, '');
}

async function resolveWpTermId(type, slug) {
    const cacheKey = `wp_term_${type}_${slug}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached || null;

    try {
        const url = `${BASE_URL}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&per_page=1`;
        const data = await fetchUrl(url, { timeout: 10000 });
        const id = data?.[0]?.id || null;
        cache.set(cacheKey, id || 0, 86400);
        return id;
    } catch {
        return null;
    }
}

function mapWpPosts(posts) {
    return (posts || []).map((p) => {
        const title = decodeHtml(p?.title?.rendered || '').trim();
        const slug = slugFromHref(p?.link || '');
        const yearMatch = title.match(/\((\d{4})\)/);
        return {
            title,
            slug,
            year: yearMatch ? parseInt(yearMatch[1]) : undefined,
        };
    }).filter((p) => p.title && p.slug);
}

async function fetchCatalogFromWpApi(catalogId, page) {
    const category = CATEGORIES[catalogId];
    if (!category) return [];

    const qs = [
        'per_page=20',
        `page=${page}`,
        '_fields=link,title.rendered',
    ];

    if (category.path === '/') {
        // newest, no extra filters
    } else if (category.path.includes('/category/')) {
        const id = await resolveWpTermId('categories', pathSlug(category.path));
        if (!id) return [];
        qs.push(`categories=${id}`);
    } else if (category.path.includes('/tag/')) {
        const id = await resolveWpTermId('tags', pathSlug(category.path));
        if (!id) return [];
        qs.push(`tags=${id}`);
    } else {
        const slug = pathSlug(category.path);
        const catId = await resolveWpTermId('categories', slug);
        const tagId = !catId ? await resolveWpTermId('tags', slug) : null;
        if (catId) qs.push(`categories=${catId}`);
        else if (tagId) qs.push(`tags=${tagId}`);
        else return [];
    }

    try {
        const url = `${BASE_URL}/wp-json/wp/v2/posts?${qs.join('&')}`;
        const data = await fetchUrl(url, { timeout: 12000 });
        return mapWpPosts(data);
    } catch {
        return [];
    }
}

async function searchFromWpApi(query) {
    try {
        const url = `${BASE_URL}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=20&_fields=link,title.rendered`;
        const data = await fetchUrl(url, { timeout: 12000 });
        return mapWpPosts(data);
    } catch {
        return [];
    }
}

function parseTitle(fullTitle) {
    const yearMatch = fullTitle.match(/\((\d{4})\)/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const slashIdx = fullTitle.indexOf(' / ');
    let en = slashIdx > 0 ? fullTitle.substring(0, slashIdx).trim() : fullTitle;
    en = en.replace(/\s*\(\d{4}\)\s*/, '').replace(/\s*BG Audio\s*/i, '').trim();
    return { en, year };
}

function decodeHtml(text) {
    return cheerio.load(`<div>${text || ''}</div>`)('div').text().trim();
}

function pathSlug(path) {
    return String(path || '').replace(/^\/+|\/+$/g, '').split('/').pop() || '';
}

function slugFromHref(href) {
    try {
        const u = new URL(href);
        return u.pathname.replace(/^\/+|\/+$/g, '');
    } catch {
        return slugFromUrl(href);
    }
}

async function fetchPage(url) {
    try {
        const data = await fetchUrl(url);
        return data;
    } catch (e) {
        console.error(`[Fetch] ${url}: ${e.message}`);
        return null;
    }
}

// ─── Cinemeta IMDb lookup ────────────────────────────────

async function resolveImdbId(title, year, slug) {
    const cacheKey = `imdb_${slug}`;
    const cached = imdbCache.get(cacheKey);
    if (cached) {
        slugByImdb[cached.id || cached] = slug;
        return cached;
    }

    try {
        const parsed = parseTitle(title);
        const query = encodeURIComponent(parsed.en);
        const url = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${query}.json`;
        const res = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': HEADERS['User-Agent'] } });
        const metas = res.data.metas || [];

        const y = String(parsed.year || year);
        // Exact match by name + year
        let match = metas.find(m =>
            m.name && m.name.toLowerCase() === parsed.en.toLowerCase() && m.releaseInfo === y
        );
        // Fuzzy: same year
        if (!match) match = metas.find(m => m.releaseInfo === y);
        // Fallback: first result
        if (!match && metas.length > 0) match = metas[0];

        if (match && match.id) {
            imdbCache.set(cacheKey, { id: match.id, poster: match.poster || '' });
            slugByImdb[match.id] = slug;
            return { id: match.id, poster: match.poster || '' };
        }
    } catch (e) {
        console.error(`[Cinemeta] ${title}: ${e.message}`);
    }
    return null;
}

// ─── Catalog ─────────────────────────────────────────────

async function scrapeCatalog(catalogId, skip = 0) {
    const category = CATEGORIES[catalogId];
    if (!category) return [];

    const page = Math.floor(skip / 20) + 1;
    const cacheKey = `cat_${catalogId}_p${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const rawMovies = [];

    // Try WP API first (works without proxy)
    const wpMovies = await fetchCatalogFromWpApi(catalogId, page);
    if (wpMovies.length > 0) {
        rawMovies.push(...wpMovies);
        console.log(`[Catalog] ${catalogId}: using WP API (${wpMovies.length} items)`);
    }

    // Fallback to HTML scraping if WP API returns nothing
    if (rawMovies.length === 0) {
        let url = BASE_URL + category.path;
        if (page > 1) url += `page/${page}/`;
        
        const html = await fetchPage(url);
        if (html) {
            const $ = cheerio.load(html);
            $('article, .video-item, .post, .item-video, div[id^="post-"]').each((i, el) => {
                const $el = $(el);
                const $link = $el.find('a').first();
                const href = $link.attr('href');
                if (!href || !href.includes('filmi2k.com/')) return;
                const title = $el.find('.entry-title, h2, h3, .title').first().text().trim() || $link.attr('title') || $link.text().trim();
                if (!title) return;
                const slug = slugFromUrl(href);
                const yearMatch = title.match(/\((\d{4})\)/);
                rawMovies.push({ title, slug, year: yearMatch ? parseInt(yearMatch[1]) : undefined });
            });
            if (rawMovies.length > 0) {
                console.log(`[Catalog] ${catalogId}: using HTML fallback (${rawMovies.length} items)`);
            }
        }
    }

    if (rawMovies.length === 0) return [];

    // Resolve IMDb IDs in parallel (batches of 5)
    const metas = [];
    for (let i = 0; i < rawMovies.length; i += 5) {
        const batch = rawMovies.slice(i, i + 5);
        const results = await Promise.all(batch.map(async (m) => {
            const result = await resolveImdbId(m.title, m.year, m.slug);
            if (result) {
                const imdbId = result.id || result;
                const poster = result.poster || '';
                return {
                    id: imdbId,
                    type: 'movie',
                    name: m.title,
                    poster: poster,
                };
            }
            return null;
        }));
        results.forEach(r => { if (r) metas.push(r); });
    }

    console.log(`[Catalog] ${catalogId}: ${metas.length}/${rawMovies.length} resolved to IMDb IDs`);
    cache.set(cacheKey, metas);
    return metas;
}

// ─── Search ──────────────────────────────────────────────

async function searchMovies(query) {
    const cacheKey = `search_${query}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const rawMovies = [];

    const wpMovies = await searchFromWpApi(query);
    if (wpMovies.length > 0) {
        rawMovies.push(...wpMovies);
        console.log(`[Search] using WP API (${wpMovies.length} items)`);
    }

    if (rawMovies.length === 0) {
        const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
        const html = await fetchPage(url);

        if (html) {
            const $ = cheerio.load(html);

            $('article, .video-item, .post, div[id^="post-"]').each((i, el) => {
                const $el = $(el);
                const $link = $el.find('a').first();
                const href = $link.attr('href');
                if (!href || !href.includes('filmi2k.com/')) return;
                const title = $el.find('.entry-title, h2, h3, .title').first().text().trim() || $link.attr('title') || $link.text().trim();
                if (!title) return;
                const slug = slugFromUrl(href);
                const yearMatch = title.match(/\((\d{4})\)/);
                rawMovies.push({ title, slug, year: yearMatch ? parseInt(yearMatch[1]) : undefined });
            });

            if (rawMovies.length === 0) {
                $('a[href*="filmi2k.com/"]').each((i, el) => {
                    const href = $(el).attr('href');
                    if (!href || href === BASE_URL + '/' || href.includes('/category/') || href.includes('/tag/') || href.includes('/page/') || href.includes('#') || href.includes('?s=')) return;
                    if (!href.match(/filmi2k\.com\/[\w-]+-\d{4}/)) return;
                    const title = $(el).text().trim();
                    if (!title || title.length < 3) return;
                    const slug = slugFromUrl(href);
                    if (rawMovies.find(m => m.slug === slug)) return;
                    const yearMatch = title.match(/\((\d{4})\)/);
                    rawMovies.push({ title, slug, year: yearMatch ? parseInt(yearMatch[1]) : undefined });
                });
            }
        }
    }

    if (rawMovies.length === 0) return [];

    for (let i = 0; i < rawMovies.length; i += 5) {
        const batch = rawMovies.slice(i, i + 5);
        const results = await Promise.all(batch.map(async (m) => {
            const result = await resolveImdbId(m.title, m.year, m.slug);
            if (result) {
                const imdbId = result.id || result;
                const poster = result.poster || '';
                return { id: imdbId, type: 'movie', name: m.title, poster: poster };
            }
            return null;
        }));
        results.forEach(r => { if (r) metas.push(r); });
    }

    cache.set(cacheKey, metas);
    return metas;
}

// ─── Streams ─────────────────────────────────────────────

async function scrapeStreams(imdbId) {
    const cacheKey = `streams_${imdbId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // Find the filmi2k slug for this IMDb ID
    let slug = slugByImdb[imdbId];

    // If no cached mapping, search filmi2k by Cinemeta title
    if (!slug) {
        try {
            const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`, { timeout: 8000, headers: { 'User-Agent': HEADERS['User-Agent'] } });
            const meta = metaRes.data.meta;
            if (meta && meta.name) {
                const searchHtml = await fetchPage(`${BASE_URL}/?s=${encodeURIComponent(meta.name)}`);
                if (searchHtml) {
                    const $ = cheerio.load(searchHtml);
                    $('a[href*="filmi2k.com/"]').each((i, el) => {
                        if (slug) return;
                        const href = $(el).attr('href');
                        if (!href || href.includes('/category/') || href.includes('/tag/')) return;
                        const title = $(el).text().trim();
                        if (!title) return;
                        const yearMatch = title.match(/\((\d{4})\)/);
                        const year = yearMatch ? parseInt(yearMatch[1]) : null;
                        if (meta.releaseInfo && year && String(year) === String(meta.releaseInfo).substring(0, 4)) {
                            slug = slugFromUrl(href);
                            slugByImdb[imdbId] = slug;
                        }
                    });
                }
            }
        } catch (e) {
            console.error(`[Stream] Cinemeta lookup for ${imdbId}: ${e.message}`);
        }
    }

    if (!slug) {
        console.log(`[Stream] No filmi2k slug found for ${imdbId}`);
        return [];
    }

    const url = `${BASE_URL}/${slug}/`;
    const html = await fetchPage(url);
    if (!html) return [];

    const $ = cheerio.load(html);
    const streams = [];
    const embedUrls = new Set();

    // Extract embed URLs from embedCode variable
    $('script').each((i, el) => {
        const sc = $(el).html();
        if (!sc) return;

        const embedCodeMatch = sc.match(/embedCode\s*=\s*['"](.+?)['"]\s*;/);
        if (embedCodeMatch) {
            const srcMatch = embedCodeMatch[1].match(/src=\\?["']([^"'\\]+)/);
            if (srcMatch) {
                let src = srcMatch[1];
                if (src.startsWith('//')) src = 'https:' + src;
                embedUrls.add(src);
            }
        }

        const patterns = sc.match(/https?:\/\/[^"'\s\\]+\/(?:embed|e|player)\/[^"'\s\\]+/g);
        if (patterns) patterns.forEach(u => embedUrls.add(u.replace(/\\/g, '')));
    });

    $('iframe').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (src && !src.includes('google') && !src.includes('facebook') && !src.includes('ads')) {
            embedUrls.add(src.startsWith('//') ? 'https:' + src : src);
        }
    });

    // Resolve embeds
    for (const embedSrc of embedUrls) {
        try {
            const resolved = await resolveEmbed(embedSrc);
            streams.push(...resolved);
        } catch (e) {
            console.error(`[Stream] Resolve ${embedSrc}: ${e.message}`);
        }
    }

    if (streams.length === 0 && embedUrls.size > 0) {
        for (const embedSrc of embedUrls) {
            streams.push({ name: 'Filmi2K', title: `${getEmbedName(embedSrc)} - Плейър`, externalUrl: embedSrc });
        }
    }

    if (streams.length === 0) {
        streams.push({ name: 'Filmi2K', title: 'Отвори във браузър', externalUrl: url });
    }

    console.log(`[Stream] ${imdbId} → ${slug}: ${streams.length} streams`);
    cache.set(cacheKey, streams);
    return streams;
}

// ─── Embed resolver ──────────────────────────────────────

async function resolveEmbed(embedUrl) {
    const streams = [];
    try {
        const res = await axios.get(embedUrl, {
            headers: { ...HEADERS, 'Referer': BASE_URL + '/' },
            timeout: 15000,
            maxRedirects: 5,
        });
        const html = res.data;
        const hostName = getEmbedName(embedUrl);

        // Unpack packed JS
        const packedMatch = html.match(/}\('(.+)',(\d+),(\d+),'(.+?)'\.split\('\|'\)/s);
        if (packedMatch) {
            try {
                const [, p, a, c, k] = packedMatch;
                const unpacked = unpackJs(p, parseInt(a), parseInt(c), k.split('|'));
                if (unpacked) {
                    const isHD = unpacked.includes('"HD"') || unpacked.includes("'HD'");
                    const m3u8s = unpacked.match(/https?:\/\/[^"'\s\\,\)]+\.m3u8[^"'\s\\,\)]*/g);
                    if (m3u8s) {
                        const seen = new Set();
                        m3u8s.forEach(u => {
                            const clean = u.replace(/\\/g, '');
                            if (!seen.has(clean)) {
                                seen.add(clean);
                                streams.push({
                                    name: 'Filmi2K',
                                    title: `${hostName}${isHD ? ' HD' : ''} (HLS)`,
                                    url: clean,
                                    behaviorHints: {
                                        notWebReady: true,
                                        proxyHeaders: { request: { 'Referer': embedUrl, 'Origin': new URL(embedUrl).origin } },
                                    },
                                });
                            }
                        });
                    }
                    const mp4s = unpacked.match(/https?:\/\/[^"'\s\\,\)]+\.mp4[^"'\s\\,\)]*/g);
                    if (mp4s) {
                        const seen = new Set();
                        mp4s.forEach(u => {
                            const clean = u.replace(/\\/g, '');
                            if (!seen.has(clean)) {
                                seen.add(clean);
                                streams.push({
                                    name: 'Filmi2K',
                                    title: `${hostName} (MP4)`,
                                    url: clean,
                                    behaviorHints: {
                                        notWebReady: true,
                                        proxyHeaders: { request: { 'Referer': embedUrl, 'Origin': new URL(embedUrl).origin } },
                                    },
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.error(`[Embed] Unpack error: ${e.message}`);
            }
        }

        // Direct URLs fallback
        if (streams.length === 0) {
            const m3u8 = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g);
            if (m3u8) m3u8.forEach(u => {
                streams.push({ name: 'Filmi2K', title: `${hostName} (HLS)`, url: u.replace(/\\/g, ''), behaviorHints: { notWebReady: true, proxyHeaders: { request: { 'Referer': embedUrl, 'Origin': new URL(embedUrl).origin } } } });
            });
        }
    } catch (e) {
        console.error(`[Embed] ${embedUrl}: ${e.message}`);
    }
    return streams;
}

// ─── Utilities ───────────────────────────────────────────

function getEmbedName(url) {
    try {
        const h = new URL(url).hostname.replace('www.', '');
        return h.split('.')[0].charAt(0).toUpperCase() + h.split('.')[0].slice(1);
    } catch { return 'Stream'; }
}

function unpackJs(p, a, c, k) {
    try {
        const base36 = (n) => {
            const ch = '0123456789abcdefghijklmnopqrstuvwxyz';
            if (n < 36) return ch[n];
            return base36(Math.floor(n / 36)) + ch[n % 36];
        };
        while (c--) {
            if (k[c]) p = p.replace(new RegExp('\\b' + (a <= 36 ? base36(c) : c.toString(a)) + '\\b', 'g'), k[c]);
        }
        return p;
    } catch { return null; }
}

module.exports = {
    CATEGORIES,
    scrapeCatalog,
    scrapeStreams,
    searchMovies,
};
