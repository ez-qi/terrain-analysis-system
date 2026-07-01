import { Router } from 'express';
import { getElevationGrid } from '../services/demService.js';

const router = Router();

/**
 * GET /api/dem/elevation?lat=...&lon=...&size=2400&resolution=128
 * 返回指定区域的高程网格数据
 */
router.get('/elevation', async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const size = parseInt(req.query.size || '2400', 10);
    const resolution = parseInt(req.query.resolution || '128', 10);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: '无效的 lat/lon 参数' });
    }
    if (resolution < 2 || resolution > 512) {
      return res.status(400).json({ error: 'resolution 应在 2-512 之间' });
    }

    const result = await getElevationGrid(lat, lon, size, resolution);
    if (!result) {
      return res.json({ elevation: null, metadata: { source: 'not_found' } });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
