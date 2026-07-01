import { Router } from 'express';

const router = Router();

// GET /api/dem/elevation — 由 Task 6 实现
router.get('/elevation', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
