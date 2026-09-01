import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { api } from './api/routes.js';
import { getDb } from './db/database.js';
import { startScheduler, stopScheduler } from './core/scheduler.js';
import { resumeInterruptedScans, stopResumeLoop } from './core/resume.js';
import { enqueueAllMissingThumbnails } from './db/daos.js';
import { startThumbnailWorker, stopThumbnailWorker } from './media/thumbnailWorker.js';
import { logger } from './db/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  getDb();
  enqueueAllMissingThumbnails();
  startThumbnailWorker();

  app.use('/api', api);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const frontendDist = process.env.FRONTEND_DIST ?? path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  return app;
}

export function startServer(port: number = PORT): Server {
  const app = createApp();
  startScheduler();
  const server = app.listen(port, () => {
    console.log(`MediaManager backend listening on http://localhost:${port}`);
    logger.info('app', `Backend gestartet, hört auf Port ${port}.`);
    // Unterbrochene Scans erst fortsetzen, wenn der Server vollständig läuft –
    // so blockiert die Wiederaufnahme den Neustart nicht.
    resumeInterruptedScans();
  });
  server.on('close', () => {
    stopScheduler();
    stopResumeLoop();
    stopThumbnailWorker();
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer();
}