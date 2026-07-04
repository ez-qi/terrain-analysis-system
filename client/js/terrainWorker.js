// client/js/terrainWorker.js
// 纯数学 Worker：接收高程数据 + 参数，输出几何体 TypedArray。
// 禁止引用 THREE.* —— 只做数学计算。

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

function interpolateHeight(u, v, grid, gridSize) {
    if (!grid || grid.length !== gridSize * gridSize) return 0;
    const rowVal = v * (gridSize - 1);
    const colVal = u * (gridSize - 1);
    const r0 = Math.floor(rowVal);
    const c0 = Math.floor(colVal);
    const r1 = Math.min(gridSize - 1, r0 + 1);
    const c1 = Math.min(gridSize - 1, c0 + 1);
    const fr = rowVal - r0;
    const fc = colVal - c0;
    const h00 = grid[r0 * gridSize + c0];
    const h01 = grid[r0 * gridSize + c1];
    const h10 = grid[r1 * gridSize + c0];
    const h11 = grid[r1 * gridSize + c1];
    if (h00 === undefined || h01 === undefined || h10 === undefined || h11 === undefined) return 0;
    const hTop = h00 * (1.0 - fc) + h01 * fc;
    const hBottom = h10 * (1.0 - fc) + h11 * fc;
    return hTop * (1.0 - fr) + hBottom * fr;
}

/**
 * 构建地形几何体数据（等价于原 THREE.PlaneGeometry + 修改 positions + computeVertexNormals）。
 * 坐标系：原 THREE.PlaneGeometry(size,size,gridSize,gridSize) rotateX(-PI/2) 后：
 *   x ∈ [-size/2, size/2], y=height(上), z ∈ [-size/2, size/2]
 * 顶点排列：gridSize+1 行 × gridSize+1 列，逐行（z 从 +size/2 到 -size/2）逐列（x 从 -size/2 到 +size/2）。
 */
function buildGeometry(elevationGrid, gridSize, size, exaggeration, activeLat, activeLon) {
    const segs = gridSize;
    const vertsPerSide = segs + 1;
    const vertexCount = vertsPerSide * vertsPerSide;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const normals = new Float32Array(vertexCount * 3);
    const indices = new Uint16Array(segs * segs * 6);

    let minHeight = Infinity;
    let maxHeight = -Infinity;

    // 推断 elevationGrid 的实际边长（与原 main.js 一致，interpolateHeight 用 sqrt(len)）
    const elevGridSize = elevationGrid ? (Math.sqrt(elevationGrid.length) | 0) : gridSize;

    // 生成顶点
    for (let r = 0; r < vertsPerSide; r++) {
        for (let c = 0; c < vertsPerSide; c++) {
            const i = r * vertsPerSide + c;
            const u = c / segs;
            const v = r / segs;
            const x = (u - 0.5) * size;
            const z = (v - 0.5) * size;

            let height = 0.0;
            if (elevationGrid) {
                height = interpolateHeight(u, v, elevationGrid, elevGridSize);
                // 与原 main.js 一致：detailIntensity 调制
                const detailIntensity = Math.min(1.0, height / 1000.0);
                height += fbm(u * 15.0 + activeLon, v * 15.0 + activeLat) * 35.0 * detailIntensity;
            } else {
                const macroBase = fbm(u * 3.0 + activeLon * 2.3, v * 3.0 + activeLat * 1.7) * 600.0;
                const microDetail = fbm(u * 12.0 - activeLon, v * 12.0 - activeLat) * 45.0;
                height = Math.max(5.0, macroBase + microDetail);
            }

            positions[i * 3] = x;
            positions[i * 3 + 1] = height * exaggeration;
            positions[i * 3 + 2] = z;
            uvs[i * 2] = u;
            uvs[i * 2 + 1] = v;

            // min/max 记录原始 height（未乘 exaggeration），与原 main.js 一致
            if (height < minHeight) minHeight = height;
            if (height > maxHeight) maxHeight = height;
        }
    }

    // 生成索引（每个格子 2 个三角形）
    let idx = 0;
    for (let r = 0; r < segs; r++) {
        for (let c = 0; c < segs; c++) {
            const a = r * vertsPerSide + c;
            const b = r * vertsPerSide + c + 1;
            const cc = (r + 1) * vertsPerSide + c;
            const d = (r + 1) * vertsPerSide + c + 1;
            // 与 THREE.PlaneGeometry rotateX(-PI/2) 后的绕序保持一致（双面渲染，绕序影响不大）
            indices[idx++] = a;
            indices[idx++] = cc;
            indices[idx++] = b;
            indices[idx++] = b;
            indices[idx++] = cc;
            indices[idx++] = d;
        }
    }

    // 计算法线（等价 computeVertexNormals，逐面累加到顶点后归一化）
    for (let i = 0; i < normals.length; i++) normals[i] = 0;
    for (let f = 0; f < indices.length; f += 3) {
        const ia = indices[f], ib = indices[f + 1], ic = indices[f + 2];
        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
        const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        normals[ia * 3] += nx; normals[ia * 3 + 1] += ny; normals[ia * 3 + 2] += nz;
        normals[ib * 3] += nx; normals[ib * 3 + 1] += ny; normals[ib * 3 + 2] += nz;
        normals[ic * 3] += nx; normals[ic * 3 + 1] += ny; normals[ic * 3 + 2] += nz;
    }
    for (let i = 0; i < normals.length; i += 3) {
        const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        normals[i] = nx / len;
        normals[i + 1] = ny / len;
        normals[i + 2] = nz / len;
    }

    return { positions, normals, uvs, indices, minHeight, maxHeight };
}

self.onmessage = (e) => {
    const { type, elevation, gridSize, size, exaggeration, activeLat, activeLon } = e.data;
    if (type !== 'build') return;
    try {
        const result = buildGeometry(elevation, gridSize, size, exaggeration, activeLat, activeLon);
        self.postMessage(result, [
            result.positions.buffer,
            result.normals.buffer,
            result.uvs.buffer,
            result.indices.buffer
        ]);
    } catch (err) {
        self.postMessage({ error: err.message });
    }
};
