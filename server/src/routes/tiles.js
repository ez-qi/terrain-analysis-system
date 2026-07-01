import { Router } from 'express';
import { config } from '../config/index.js';

const router = Router();

/**
 * GET /api/tiles/:z/:x/:y
 * 代理天地图卫星瓦片（隐藏 Token）
 */
router.get('/:z/:x/:y', async (req, res, next) => {
  try {
    const { z, x, y } = req.params;
    const url = `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&tk=${config.tdtTk}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`天地图瓦片错误: ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
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

    const response = await fetch(url);
    if (!response.ok) throw new Error(`天地图静态图错误: ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

export default router;
