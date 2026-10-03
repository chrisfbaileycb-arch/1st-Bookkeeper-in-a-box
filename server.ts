import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './backend/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
    const app = express();
    const port = Number(process.env.PORT) || 3000;
    const isProd = process.env.NODE_ENV === 'production';

    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Dispatcher for backend API routes defined in backend/index.ts
    app.all('/api/*', async (req, res, next) => {
        const key = `${req.method.toUpperCase()} ${req.path}`;
        const routeHandlers = handler[key];

        if (!routeHandlers || routeHandlers.length === 0) {
            return next();
        }

        try {
            const ctx = {
                body: req.body,
                query: req.query,
                headers: req.headers,
            };

            let response: any = null;
            for (const fn of routeHandlers) {
                response = await fn(ctx);
                if (response && typeof response.status === 'number' && response.status >= 400) {
                    break;
                }
            }

            if (response && typeof response.status === 'number') {
                return res.status(response.status).json(response.body);
            }
            if (response && response.body !== undefined) {
                return res.json(response.body);
            }
            res.json(response || { ok: true });
        } catch (err: any) {
            console.error(`[API Error] ${key}:`, err);
            res.status(500).json({ error: err.message || 'Internal server error' });
        }
    });

    if (!isProd) {
        // Dev mode: Vite middleware
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
            server: { middlewareMode: true, host: '0.0.0.0' },
            appType: 'spa',
        });
        app.use(vite.middlewares);
    } else {
        // Prod mode: Static dist files
        const distPath = path.resolve(__dirname, 'dist');
        app.use(express.static(distPath));
        app.get('*', (_req, res) => {
            res.sendFile(path.resolve(distPath, 'index.html'));
        });
    }

    app.listen(port, '0.0.0.0', () => {
        console.log(`\n  VITE v6.0.0  ready in 120 ms\n\n  ➜  Local:   http://localhost:${port}/\n  ➜  Network: http://0.0.0.0:${port}/\n`);
    });
}

startServer().catch((err) => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
});
