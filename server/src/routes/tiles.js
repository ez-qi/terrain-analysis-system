import { Router } from 'express';
import { config } from '../config/index.js';
import { tileCache } from '../services/tileCache.js';

const router = Router();

/**
 * GET /api/tiles/:z/:x/:y
 * 代理天地图卫星瓦片（隐藏 Token），带磁盘缓存
 */
router.get('/:z/:x/:y', async (req, res, next) => {
  try {
    const z = parseInt(req.params.z, 10);
    const x = parseInt(req.params.x, 10);
    const y = parseInt(req.params.y, 10);

    // 检查缓存
    const cached = await tileCache.get(z, x, y);
    if (cached) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cached);
    }

    const url = `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&tk=${config.tdtTk}`;

    const response = await fetch(url, {
      headers: {
        'Referer': req.headers.referer || 'http://localhost:3000',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
      }
    });
    if (!response.ok) throw new Error(`天地图瓦片错误: ${response.status}`);

    const buffer = await response.arrayBuffer();
    const buf = Buffer.from(buffer);

    // 写入缓存
    await tileCache.set(z, x, y, buf);

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tiles/static?lon=...&lat=...&zoom=...
 * 代理天地图静态地图 API（用于 3D 卫星纹理）
 */
router.get('/static', async (req, res, next) => {
  try {
    const { lon, lat, zoom = 13 } = req.query;
    if (!lon || !lat) {
      return res.status(400).json({ error: '缺少 lon/lat 参数' });
    }

    const url = `https://api.tianditu.gov.cn/staticimage?center=${lon},${lat}&width=1024&height=1024&zoom=${zoom}&layers=img_c&tk=${config.tdtTk}`;

    const response = await fetch(url, {
      headers: {
        'Referer': req.headers.referer || 'http://localhost:3000',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
      }
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`天地图静态图错误: ${response.status} — ${errorText}`);
    }

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

export default router;
