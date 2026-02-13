const { addonBuilder } = require('stremio-addon-sdk');
const { CATEGORIES, scrapeCatalog, scrapeStreams, searchMovies } = require('./scraper');

function getManifest(config) {
    const selectedCats = config && config.categories ? config.categories : Object.keys(CATEGORIES);

    return {
        id: 'org.filmi2k.stremio',
        version: '2.0.0',
        name: 'Filmi2K',
        description: 'Stremio addon за Filmi2K.com - Български филми онлайн',
        logo: 'https://www.filmi2k.com/wp-content/uploads/2020/01/filmi2k-logo.png',
        resources: ['catalog', 'stream'],
        types: ['movie'],
        idPrefixes: ['tt'],
        catalogs: selectedCats
            .filter(id => CATEGORIES[id])
            .map(id => ({
                type: 'movie',
                id: id,
                name: `Filmi2K - ${CATEGORIES[id].name}`,
                extra: [
                    { name: 'skip', isRequired: false },
                    { name: 'search', isRequired: false },
                ],
            })),
        behaviorHints: {
            adult: false,
            p2p: false,
            configurable: true,
            configurationRequired: false,
        },
    };
}

function buildAddon(config) {
    const manifest = getManifest(config);
    const builder = new addonBuilder(manifest);

    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[Catalog] type=${type}, id=${id}, skip=${extra.skip || 0}, search=${extra.search || ''}`);
        try {
            if (extra.search) {
                return { metas: await searchMovies(extra.search) };
            }
            return { metas: await scrapeCatalog(id, parseInt(extra.skip) || 0) };
        } catch (error) {
            console.error(`[Catalog] Error:`, error.message);
            return { metas: [] };
        }
    });

    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[Stream] type=${type}, id=${id}`);
        try {
            if (!id.startsWith('tt')) return { streams: [] };
            return { streams: await scrapeStreams(id) };
        } catch (error) {
            console.error(`[Stream] Error:`, error.message);
            return { streams: [] };
        }
    });

    return builder;
}

module.exports = { buildAddon, getManifest, CATEGORIES };
