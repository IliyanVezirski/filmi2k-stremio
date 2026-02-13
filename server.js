const express = require('express');
const { buildAddon, getManifest, CATEGORIES } = require('./addon');
const { getRouter } = require('stremio-addon-sdk');

const app = express();
const PORT = process.env.PORT || 7000;

// ─── Config HTML page ────────────────────────────────────

function getConfigPage(baseUrl) {
    const cats = Object.entries(CATEGORIES);
    const checkboxes = cats.map(([id, cat]) => `
        <label class="cat-item">
            <input type="checkbox" name="categories" value="${id}" checked>
            <span class="checkmark"></span>
            <span class="cat-name">${cat.name}</span>
        </label>`).join('');

    return `<!DOCTYPE html>
<html lang="bg">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Filmi2K - Stremio Addon Configuration</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            color: #fff;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 40px;
            max-width: 600px;
            width: 100%;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        .logo {
            text-align: center;
            margin-bottom: 24px;
        }
        .logo h1 {
            font-size: 28px;
            background: linear-gradient(90deg, #e040fb, #536dfe);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .logo p {
            color: #aaa;
            margin-top: 8px;
            font-size: 14px;
        }
        h2 {
            font-size: 18px;
            margin-bottom: 16px;
            color: #e0e0e0;
        }
        .categories {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 24px;
        }
        .cat-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .cat-item:hover { background: rgba(255,255,255,0.12); }
        .cat-item input { display: none; }
        .checkmark {
            width: 20px; height: 20px;
            border: 2px solid #666;
            border-radius: 4px;
            position: relative;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .cat-item input:checked + .checkmark {
            background: #7c4dff;
            border-color: #7c4dff;
        }
        .cat-item input:checked + .checkmark::after {
            content: '';
            position: absolute;
            left: 5px; top: 1px;
            width: 6px; height: 11px;
            border: solid #fff;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        .cat-name { font-size: 14px; }
        .buttons {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
        }
        .btn-small {
            padding: 6px 14px;
            border: 1px solid rgba(255,255,255,0.2);
            background: transparent;
            color: #aaa;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }
        .btn-small:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .btn-install {
            display: block;
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #7c4dff, #536dfe);
            color: #fff;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn-install:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 20px rgba(124,77,255,0.4);
        }
        .url-box {
            margin-top: 16px;
            padding: 12px;
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            color: #90caf9;
            display: none;
        }
        .show-url { display: block; }
        .footer {
            text-align: center;
            margin-top: 20px;
            color: #666;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <h1>🎬 Filmi2K</h1>
            <p>Stremio Addon - Български филми онлайн</p>
        </div>

        <h2>Избери категории:</h2>
        <div class="buttons">
            <button class="btn-small" onclick="toggleAll(true)">Избери всички</button>
            <button class="btn-small" onclick="toggleAll(false)">Премахни всички</button>
        </div>
        <div class="categories">${checkboxes}</div>

        <button class="btn-install" onclick="install()">Инсталирай в Stremio</button>
        <button class="btn-small" style="margin-top:10px;width:100%;text-align:center" onclick="showUrl()">Покажи URL</button>
        <div class="url-box" id="urlBox"></div>

        <div class="footer">
            Filmi2K Stremio Addon v2.0.0 | Постери и метаданни от Cinemeta
        </div>
    </div>

    <script>
        const BASE = window.location.origin;

        function getConfig() {
            const checked = [...document.querySelectorAll('input[name="categories"]:checked')].map(c => c.value);
            return encodeURIComponent(JSON.stringify({ categories: checked }));
        }

        function getAddonUrl() {
            return BASE + '/' + getConfig() + '/manifest.json';
        }

        function install() {
            const checked = document.querySelectorAll('input[name="categories"]:checked');
            if (checked.length === 0) {
                alert('Избери поне една категория!');
                return;
            }
            window.location.href = 'stremio://' + getAddonUrl().replace(/^https?:\\/\\//, '');
        }

        function showUrl() {
            const box = document.getElementById('urlBox');
            box.textContent = getAddonUrl();
            box.classList.toggle('show-url');
        }

        function toggleAll(state) {
            document.querySelectorAll('input[name="categories"]').forEach(c => c.checked = state);
        }
    </script>
</body>
</html>`;
}

// ─── Routes ──────────────────────────────────────────────

// Config page
app.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'text/html');
    res.send(getConfigPage(baseUrl));
});

app.get('/configure', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'text/html');
    res.send(getConfigPage(baseUrl));
});

// No-config addon routes (all categories)
app.get('/manifest.json', (req, res) => {
    const manifest = getManifest(null);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.json(manifest);
});

app.get('/catalog/:type/:id.json', (req, res, next) => {
    const addon = buildAddon(null);
    const router = getRouter(addon.getInterface());
    router(req, res, next);
});

app.get('/stream/:type/:id.json', (req, res, next) => {
    const addon = buildAddon(null);
    const router = getRouter(addon.getInterface());
    router(req, res, next);
});

// Config-based addon routes
function isConfigParam(param) {
    const decoded = decodeURIComponent(param);
    return decoded.startsWith('{') || decoded.startsWith('%7B');
}

app.get('/:config/manifest.json', (req, res, next) => {
    if (!isConfigParam(req.params.config)) return next();
    try {
        const config = JSON.parse(decodeURIComponent(req.params.config));
        const manifest = getManifest(config);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.json(manifest);
    } catch (e) {
        res.status(400).json({ error: 'Invalid config' });
    }
});

app.use('/:config', (req, res, next) => {
    if (!isConfigParam(req.params.config)) return next();
    try {
        const config = JSON.parse(decodeURIComponent(req.params.config));
        const addon = buildAddon(config);
        const router = getRouter(addon.getInterface());
        router(req, res, next);
    } catch (e) {
        next(e);
    }
});

// ─── Start ───────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║           Filmi2K Stremio Addon v2.0             ║
║                                                  ║
║  Config:   http://localhost:${PORT}/               ║
║  Manifest: http://localhost:${PORT}/manifest.json  ║
║                                                  ║
║  За Beamup: npx stremio-addon-beamup             ║
╚══════════════════════════════════════════════════╝
    `);
});
