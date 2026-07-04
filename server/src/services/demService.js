import { readFile, readdir } from 'fs/promises';
import { resolve, extname } from 'path';
import { config } from '../config/index.js';
import { MemoryLRU } from './cache.js';

// DEM 结果缓存（容量 50 条，单条约 128KB）
const demCache = new MemoryLRU(50);
const cacheStats = { hits: 0, misses: 0 };

/**
 * 量化坐标到 4 位小数，构造缓存 key
 */
function buildCacheKey(centerLat, centerLon, sizeMeters, gridResolution) {
  return `${centerLat.toFixed(4)},${centerLon.toFixed(4)},${sizeMeters},${gridResolution}`;
}

// 延迟加载 geotiff.js（ESM 兼容）
let geotiffModule;
async function getGeotiff() {
  if (!geotiffModule) geotiffModule = await import('geotiff');
  return geotiffModule;
}

/**
 * 双线性插值
 */
function bilinearInterpolate(data, width, height, u, v) {
  const col = u * (width - 1);
  const row = v * (height - 1);
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(width - 1, c0 + 1);
  const r1 = Math.min(height - 1, r0 + 1);
  const fc = col - c0;
  const fr = row - r0;

  const h00 = data[r0 * width + c0];
  const h01 = data[r0 * width + c1];
  const h10 = data[r1 * width + c0];
  const h11 = data[r1 * width + c1];

  if (h00 === undefined || h01 === undefined || h10 === undefined || h11 === undefined) return 0;
  const top = h00 * (1 - fc) + h01 * fc;
  const bottom = h10 * (1 - fc) + h11 * fc;
  return top * (1 - fr) + bottom * fr;
}

/**
 * 扫描 data/dem 目录，找到包含指定经纬度的 GeoTIFF 文件
 * 返回 { filepath, data, width, height, bbox }
 */
async function findDemFile(lat, lon) {
  const dir = config.demDataDir;
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const tifFiles = files.filter(f => extname(f).toLowerCase() === '.tif');
  if (tifFiles.length === 0) return null;

  const { fromBlob } = await getGeotiff();

  for (const file of tifFiles) {
    const filepath = resolve(dir, file);
    let buffer;
    try {
      buffer = await readFile(filepath);
    } catch {
      continue;
    }

    const tiff = await fromBlob(new Blob([buffer]));
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]

    // 检查目标点是否在范围内（假设 EPSG:4326 WGS84）
    if (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) {
      const width = image.getWidth();
      const height = image.getHeight();
      const raster = await image.readRasters();
      const data = raster[0];
      return { filepath, data, width, height, bbox };
    }
  }
  return null;
}

/**
 * 获取指定区域的高程网格
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} sizeMeters - 地形物理尺寸（米）
 * @param {number} gridResolution - 网格分辨率（每边点数）
 * @returns {{ elevation: number[], metadata: { min, max, mean, source } } | null}
 */
export async function getElevationGrid(centerLat, centerLon, sizeMeters, gridResolution) {
  const key = buildCacheKey(centerLat, centerLon, sizeMeters, gridResolution);

  const cached = demCache.get(key);
  if (cached !== undefined) {
    cacheStats.hits++;
    return cached;
  }
  cacheStats.misses++;

  const demFile = await findDemFile(centerLat, centerLon);
  if (!demFile) {
    demCache.set(key, null);
    return null;
  }

  const { data, width, height, bbox } = demFile;
  const halfDeg = (sizeMeters / 2400) * 0.05;
  const latMin = centerLat - halfDeg;
  const latMax = centerLat + halfDeg;
  const lonMin = centerLon - halfDeg;
  const lonMax = centerLon + halfDeg;

  const elevation = new Float32Array(gridResolution * gridResolution);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (let i = 0; i < gridResolution; i++) {
    for (let j = 0; j < gridResolution; j++) {
      const u = j / (gridResolution - 1);
      const v = i / (gridResolution - 1);
      const lon = lonMin + u * (lonMax - lonMin);
      const lat = latMin + v * (latMax - latMin);

      // 将地理坐标映射到 DEM 像素坐标
      const pu = (lon - bbox[0]) / (bbox[2] - bbox[0]);
      const pv = (lat - bbox[1]) / (bbox[3] - bbox[1]);

      let h = bilinearInterpolate(data, width, height, pu, pv);
      if (!isFinite(h)) h = 0;
      elevation[i * gridResolution + j] = h;
      if (h < min) min = h;
      if (h > max) max = h;
      sum += h;
    }
  }

  const result = {
    elevation: Array.from(elevation),
    metadata: {
      min: Math.round(min),
      max: Math.round(max),
      mean: Math.round(sum / elevation.length),
      source: demFile.filepath.split('\\').pop().split('/').pop()
    }
  };

  demCache.set(key, result);
  return result;
}

// 供测试用：暴露缓存命中/未命中计数
export function __cacheStats() {
  return { hits: cacheStats.hits, misses: cacheStats.misses };
}
