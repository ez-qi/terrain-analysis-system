import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { resolve } from 'path';
import { config } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import proxyRouter from './routes/proxy.js';
import demRouter from './routes/dem.js';
import tilesRouter from './routes/tiles.js';

const app = express();

// gzip/deflate 压缩响应（>1kb 自动压缩，PNG 等已压缩内容自动跳过）
app.use(compression());

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 健康检查
app.get('/api/health', (_req, res) => res.json({ status: 'ok', port: config.port }));

// 路由
app.use('/api/proxy', proxyRouter);
app.use('/api/dem', demRouter);
app.use('/api/tiles', tilesRouter);

// 静态文件：服务前端构建产物 client/dist（生产模式）
const distDir = resolve(config.root, 'client/dist');
app.use(express.static(distDir));
// SPA 根路径回退到 index.html
app.get('/', (_req, res) => res.sendFile(resolve(distDir, 'index.html')));

// 错误处理
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`✅ 后端服务运行在 http://localhost:${config.port}`);
});
