import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health';
import dbtestRouter from './routes/dbtest';

const app = express();
app.use(cors());
app.use(express.json());

// Montar routers bajo /api
app.use('/api', healthRouter);
app.use('/api', dbtestRouter);

// 404 controlado
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
