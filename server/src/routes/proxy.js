import { Router } from 'express';

const router = Router();

// POST /api/proxy/ai — 由 Task 2 实现
router.post('/ai', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
