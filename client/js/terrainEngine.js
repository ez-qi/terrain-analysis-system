// 三维空间高程数据解算与插值引擎模块

let elevationGridSize = 10;

async function fetchRealElevation(centerLat, centerLon) {
    const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
    const size = elevationGridSize;

    // 优先调用后端 DEM 服务
    try {
        const response = await fetch(
            `/api/dem/elevation?lat=${centerLat}&lon=${centerLon}&size=${meshPhysicalSize}&resolution=${size}`
        );
        if (!response.ok) throw new Error('后端 DEM 请求异常');

        const data = await response.json();
        if (data.elevation && data.elevation.length > 0) {
            return data.elevation;
        }
    } catch (err) {
        console.warn('本地 DEM 服务不可用，回退到 Open-Meteo:', err.message);
    }

    // 回退方案：从 Open-Meteo 免费 API 获取高程
    return await fetchOpenMeteoFallback(centerLat, centerLon);
}

/**
 * 回退方案：从 Open-Meteo 免费 API 获取高程
 */
async function fetchOpenMeteoFallback(centerLat, centerLon) {
    const size = elevationGridSize;
    const lats = [];
    const lons = [];
    const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
    const halfRange = (meshPhysicalSize / 2400) * 0.05;

    for (let i = 0; i < size; i++) {
        const lat = (centerLat + halfRange) - (i / (size - 1)) * (halfRange * 2);
        for (let j = 0; j < size; j++) {
            const lon = (centerLon - halfRange) + (j / (size - 1)) * (halfRange * 2);
            lats.push(lat.toFixed(5));
            lons.push(lon.toFixed(5));
        }
    }

    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Open-Meteo 高程请求异常');
        const data = await response.json();
        return data.elevation || null;
    } catch (err) {
        console.warn('Open-Meteo 也失败了，回退程序化噪波:', err.message);
        return null;
    }
}

function interpolateHeight(u, v, grid) {
    const size = elevationGridSize;
    if (!grid || grid.length !== size * size) return 0;

    const rowVal = v * (size - 1);
    const colVal = u * (size - 1);

    const r0 = Math.floor(rowVal);
    const c0 = Math.floor(colVal);
    const r1 = Math.min(size - 1, r0 + 1);
    const c1 = Math.min(size - 1, c0 + 1);

    const fr = rowVal - r0;
    const fc = colVal - c0;

    const h00 = grid[r0 * size + c0];
    const h01 = grid[r0 * size + c1];
    const h10 = grid[r1 * size + c0];
    const h11 = grid[r1 * size + c1];

    if (h00 === undefined || h01 === undefined || h10 === undefined || h11 === undefined) return 0;

    const hTop = h00 * (1.0 - fc) + h01 * fc;
    const hBottom = h10 * (1.0 - fc) + h11 * fc;
    return hTop * (1.0 - fr) + hBottom * fr;
}

function hash(x, y) {
    let h = Math.sin(x * 12.1 + y * 37.7) * 437.54;
    return h - Math.floor(h);
}

function noise(x, y) {
    let ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    let ux = fx * fx * (3.0 - 2.0 * fx), uy = fy * fy * (3.0 - 2.0 * fy);
    let a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a * (1.0 - ux) * (1.0 - uy) + b * ux * (1.0 - uy) + c * (1.0 - ux) * uy + d * ux * uy;
}

function fbm(x, y) {
    let value = 0.0, amplitude = 0.5, frequency = 1.0;
    for (let i = 0; i < 4; i++) {
        value += amplitude * noise(x * frequency, y * frequency);
        frequency *= 2.0; amplitude *= 0.5;
    }
    return value;
}

// ESM 导出 — 供 main.js 的 generate3DTerrain 调用
window.fetchRealElevation = fetchRealElevation;
window.fetchOpenMeteoFallback = fetchOpenMeteoFallback;
window.interpolateHeight = interpolateHeight;
window.fbm = fbm;
window.noise = noise;
window.hash = hash;
