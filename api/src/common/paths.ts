import { existsSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Where uploaded files live. On Railway, point UPLOAD_DIR at a mounted Volume
 * (e.g. /data/uploads); the container's own disk is wiped on every deploy.
 */
export const UPLOAD_ROOT = resolve(process.env.UPLOAD_DIR || join(__dirname, '..', '..', 'uploads'));

/** Built frontend (web/dist). Served by the API in production so one service hosts everything. */
export const WEB_DIST = resolve(process.env.WEB_DIST || join(__dirname, '..', '..', '..', 'web', 'dist'));
export const hasWebBuild = () => existsSync(join(WEB_DIST, 'index.html'));
