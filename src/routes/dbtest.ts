import { Router } from 'express';
import { testConnection } from '../lib/db';

const router = Router();

router.get('/dbtest', async (_req, res) => {
  const result = await testConnection();
  res.json(result);
});

export default router;
