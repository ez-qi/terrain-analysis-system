import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import proxyRouter from './routes/proxy.js';
import demRouter from './routes/dem.js';
import tilesRouter from './routes/tiles.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 健康检查
app.get('/api/health', (_req, res) => res.json({ status: 'ok', port: config.port }));

// 路由
app.use('/api/proxy', proxyRouter);
app.use('/api/dem', demRouter);
app.use('/api/tiles', tilesRouter);

// 错误处理
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`✅ 后端服务运行在 http://localhost:${config.port}`);
});
