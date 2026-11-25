import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  fetchSmartSuggestBundle,
  fetchYouTubeShortsForQuery,
  handleShortsRequest,
} from './lib/shortsService.ts';

const PORT = Number(process.env.PORT) || 3000;

// Pre-warm all default topics in background so category switches respond instantly
async function prewarmDefaultTopics() {
  const warmupQueries = [
    { q: 'viral funny #shorts', label: 'comedy' },
    { q: 'tech gadgets #shorts', label: 'tech' },
    { q: 'science facts #shorts', label: 'science facts' },
    { q: 'music #shorts', label: 'music' },
    { q: 'comedy #shorts', label: 'comedy' },
    { q: 'tech #shorts', label: 'tech' },
    { q: 'fitness #shorts', label: 'fitness' },
    { q: 'gaming #shorts', label: 'gaming' },
    { q: 'cooking recipe #shorts', label: 'cooking recipe' },
  ];

  await Promise.allSettled(
    warmupQueries.map(({ q, label }) => fetchYouTubeShortsForQuery(q, label))
  );
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/suggest', async (req, res) => {
    const rawQ = typeof req.query.q === 'string' ? req.query.q : '';
    const bundle = await fetchSmartSuggestBundle(rawQ);
    res.json(bundle);
  });

  app.get('/api/shorts', async (req, res) => {
    const payload = await handleShortsRequest({
      rawTopic: req.query.topic,
      rawPage: req.query.page,
      rawExclude: req.query.exclude,
      rawLikedTopics: req.query.likedTopics,
    });
    res.json(payload);
  });

  app.post('/api/shorts', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = await handleShortsRequest({
      rawTopic: body.topic,
      rawPage: body.page,
      rawExclude: body.exclude,
      rawLikedTopics: body.likedTopics,
    });
    res.json(payload);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ShortFlow server listening on http://0.0.0.0:${PORT}`);
    void prewarmDefaultTopics();
  });
}

startServer();
