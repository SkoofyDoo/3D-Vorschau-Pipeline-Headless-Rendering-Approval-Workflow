router.post('/render-to-view', async (req, res) => {
    let browser;
    try {
        // Timeouts
        req.setTimeout(5 * 60 * 1000);
        res.setTimeout(5 * 60 * 1000);

        const folder = (req.body.folder || '').trim();
        if (!folder)
            return res.status(400).json({ ok: false, error: 'Ordner fehlt' });

        // Render-Parameter
        const size = req.body.size || 1024;
        const fov = req.body.fov || 35;
        const format = (req.body.format || 'png').toLowerCase();
        const quality = req.body.quality || 0.92;
        const limit = req.body.limit || 12;

        const PUBLIC_BASE = process.env.PUBLIC_BASE;

        // WebDAV
        const client = getWebdavClient();

        // Pfade zu den Dateien
        const cidRoot = `/${folder}`.replace(/\/+/g, '/');
        const objPath = '/RAW/baked_mesh.obj';
        const pngPath = '/RAW/baked_mesh_tex0.png';
        const viewPath = `/VIEW_${folder}`.replace(/\/+/g, '/');

        // Überprüfen der Existentz des Ordners und der benötigten Dateien
        await client.stat('/RAW/').catch(() => {
            throw new Error(`RAW not found: ${'/RAW/'}`);
        });
        await client.stat(objPath).catch(() => {
            throw new Error(`OBJ not found: ${objPath}`);
        });
        await client.stat(pngPath).catch(() => {
            throw new Error(`PNG not found: ${pngPath}`);
        });

        // Wenn kein VIEW-Ordner, dann erstellen
        if (!(await client.exists(viewPath))) {
            try {
                await client.createDirectory(viewPath);
            } catch {}
        }

        const modelUrl = `${PUBLIC_BASE}/dav${encodeURI(objPath)}`;
        const textureUrl = `${PUBLIC_BASE}/dav${encodeURI(pngPath)}`;

        // ---- Render Preview mit Puppeteer ----
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ],
            defaultViewport: { width: size, height: size },
        });

        // Neue Seite öffnen
        const page = await browser.newPage();

        // Debugging-Ausgaben der Seite in die Konsole leiten
        page.on('console', (m) =>
            console.log('[renderer]', m.type(), m.text())
        );
        page.on('pageerror', (e) => console.error('[renderer pageerror]', e));
        page.on('requestfailed', (r) =>
            console.error('[renderer failed]', r.url(), r.failure()?.errorText)
        );

        await page.goto(`${PUBLIC_BASE}/renderer/renderer.html`, {
            waitUntil: 'networkidle0',
        });
        await page.waitForFunction(
            () => typeof window.renderPreviewsStream === 'function'
        );

        const saved = [];
        let counter = 0;
        // Frames speichern und in Nextcloud VIEW-Ordner ablegen
        await page.exposeFunction('__pushFrame', async ({ name, dataUrl }) => {
            if (counter >= limit) return;
            const ext = format === 'png' ? 'png' : 'jpg';
            const fileName =
                name && name.trim()
                    ? name
                    : `frame_${Date.now()}_${counter++}.${ext}`;
            const safe = fileName.replace(/[^a-z0-9_\-\.]/gi, '_');
            const b64 = dataUrl.split(',')[1];
            const buffer = Buffer.from(b64, 'base64');
            await client.putFileContents(`/VIEW/${safe}`, buffer, {
                overwrite: false,
            });
            saved.push(safe);
        });

        const total = await page.evaluate(
            (p) => window.renderPreviewsStream(p, '__pushFrame'),
            { modelUrl, textureUrl, size, fov, format, quality }
        );

        res.json({ ok: true, total, files: saved });
    } catch (error) {
        console.error('render-to-view error:', error);
        res.status(500).json({ ok: false, error: error.message });
    } finally {
        try {
            await browser?.close();
        } catch {}
    }
});
