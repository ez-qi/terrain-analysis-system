import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..'); // server/ → project root

dotenv.config({ path: resolve(root, '.env') });

export const config = {
  root,
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
  tdtTk: process.env.TDT_TK || '',
  port: parseInt(process.env.PORT || '3001'),
  demDataDir: resolve(root, 'server/data/dem'),
  tileCacheDir: resolve(root, 'server/cache/tiles'),
};
