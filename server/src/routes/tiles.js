import { Router } from 'express';

const router = Router();

// GET /api/tiles/:z/:x/:y — 由 Task 3 实现
router.get('/:z/:x/:y', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// GET /api/tiles/static — 由 Task 3 实现
router.get('/static', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
