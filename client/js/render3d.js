// Three.js 三维 WebGL 渲染管线与标准覆盖模式

// 共享变量挂在 window 上，方便其他 ESM 模块访问
window.scene3d = undefined;
window.camera3d = undefined;
window.renderer3d = undefined;
window.controls3d = undefined;
window.terrainMesh = undefined;
window.terrainSidesGroup = undefined;
window.labelGroup = undefined;
window.bannerTimer = undefined;
window.satelliteTexture = undefined;
window.lastMinHeight = 0;
window.lastMaxHeight = 0;
window.isFirstRender = false;

function initThree() {
    const container = document.getElementById('threeCanvas');

    window.scene3d = new THREE.Scene();
    window.scene3d.background = new THREE.Color(0x0b0f19);

    window.camera3d = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
    window.camera3d.position.set(0, 900, 1200);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    window.scene3d.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.85);
    directionalLight.position.set(1000, 1200, 700);
    window.scene3d.add(directionalLight);

    const grid = new THREE.GridHelper(5000, 50, 0x334155, 0x1e293b);
    grid.position.y = -1;
    window.scene3d.add(grid);

    window.terrainSidesGroup = new THREE.Group();
    window.scene3d.add(window.terrainSidesGroup);

    window.renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    window.renderer3d.setPixelRatio(window.devicePixelRatio);
    window.renderer3d.setSize(container.clientWidth, container.clientHeight);
    window.renderer3d.domElement.style.display = 'block';
    container.appendChild(window.renderer3d.domElement);

    window.controls3d = new THREE.OrbitControls(window.camera3d, window.renderer3d.domElement);
    window.controls3d.enableDamping = true;
    window.controls3d.target.set(0, 0, 0);
    window.controls3d.update();

    window.addEventListener('resize', onWindowResize);

    const data = new Uint8Array([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255]);
    window.satelliteTexture = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
    window.satelliteTexture.needsUpdate = true;

    animate();
}

function onWindowResize() {
    const container = document.getElementById('threeCanvas');
    if (!window.renderer3d || !window.camera3d) return;
    window.camera3d.aspect = container.clientWidth / container.clientHeight;
    window.camera3d.updateProjectionMatrix();
    window.renderer3d.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    if (window.terrainMesh && window.terrainMesh.material && window.terrainMesh.material.uniforms && window.terrainMesh.material.uniforms.uTime) {
        window.terrainMesh.material.uniforms.uTime.value += 0.01;
    }
    if (window.controls3d) window.controls3d.update();
    if (window.renderer3d) window.renderer3d.render(window.scene3d, window.camera3d);
}

function disposeGroup(group) {
    while (group && group.children.length > 0) {
        const child = group.children[0];
        if (child.geometry) {
            child.geometry.dispose();
        }
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(mat => mat.dispose());
            } else {
                child.material.dispose();
            }
        }
        group.remove(child);
    }
}

function disposeTerrain() {
    if (window.terrainMesh) {
        if (window.terrainMesh.geometry) window.terrainMesh.geometry.dispose();
        if (window.terrainMesh.material) window.terrainMesh.material.dispose();
        window.scene3d.remove(window.terrainMesh);
        window.terrainMesh = null;
    }
    // 清理降雨粒子系统
    cleanupRainSystem();

    disposeGroup(window.terrainSidesGroup);
    if (window.labelGroup) {
        disposeGroup(window.labelGroup);
    }
}

function computeContourSpacing(size, exaggeration) {
    if (document.getElementById('autoContourSpacing').checked) {
        return Math.max(15, size / 10) * exaggeration;
    }
    return parseFloat(document.getElementById('contourSpacing').value) * exaggeration;
}

function generate3DTerrain() {
    const gridSize = parseInt(document.getElementById('gridSize').value, 10);
    const size = parseFloat(document.getElementById('meshSize').value);
    const exaggeration = parseFloat(document.getElementById('exaggeration').value);
    const textureMode = document.getElementById('textureMode').value;
    const contourColor = new THREE.Color(document.getElementById('contourColor').value);
    const waterHeight = parseFloat(document.getElementById('waterHeight').value) * exaggeration;
    const contourSpacing = computeContourSpacing(size, exaggeration);

    // 同步UI：滑块显示缩放后的实际米数，自动模式附带标注
    try {
        const displaySpacing = contourSpacing / exaggeration;
        const contourInput = document.getElementById('contourSpacing');
        const contourValEl = document.getElementById('contourSpacingVal');
        const isAuto = document.getElementById('autoContourSpacing')?.checked;
        if (contourInput) contourInput.value = displaySpacing;
        if (contourValEl) contourValEl.innerText = `${displaySpacing.toFixed(0)} 米 ${isAuto ? ' (自动适配)' : ''}`;
    } catch (e) {
        // 忽略DOM访问错误（非浏览器环境或测试时）
        console.warn('无法回写等高线UI', e);
    }

    showBanner('正在生成3D地形...', false);

    fetchRealElevation(activeLat, activeLon).then((elevationGrid) => {
        disposeTerrain();

        const geometry = new THREE.PlaneGeometry(size, size, gridSize, gridSize);
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position.array;
        let minH = Infinity;
        let maxH = -Infinity;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            const u = (x / size) + 0.5;
            const v = (z / size) + 0.5;
            let height = 0;

            if (elevationGrid) {
                height += interpolateHeight(u, v, elevationGrid) * exaggeration;
            }
            height += fbm(u * 5.0, v * 5.0) * 180.0 * exaggeration;
            positions[i + 1] = height;
            minH = Math.min(minH, height);
            maxH = Math.max(maxH, height);
        }

        geometry.computeVertexNormals();

        const uniforms = {
            uShowContours: { value: 1.0 },
            uContourSpacing: { value: contourSpacing },
            uContourColor: { value: contourColor },
            uContourLineWidth: { value: parseFloat(document.getElementById('contourLineWidth').value) },
            uTextureMode: { value: textureMode === 'satellite' ? 1.0 : 0.0 },
            uSatelliteTex: { value: window.satelliteTexture },
            uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
            uWaterHeight: { value: waterHeight },
            uTime: { value: 0.0 }
        };

        const terrainMaterial = new THREE.ShaderMaterial({
            vertexShader: terrainVertexShader,
            fragmentShader: terrainFragmentShader,
            uniforms,
            side: THREE.DoubleSide
        });

        window.terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
        window.terrainMesh.receiveShadow = true;
        window.terrainMesh.castShadow = false;
        window.scene3d.add(window.terrainMesh);

        if (textureMode === 'satellite') {
            loadSatelliteTexture(terrainMaterial);
        }

        window.lastMinHeight = minH;
        window.lastMaxHeight = maxH;

        if (window.terrainSidesGroup) {
            // 清理降雨粒子系统
            cleanupRainSystem();

            disposeGroup(window.terrainSidesGroup);
        }
        window.terrainSidesGroup = new THREE.Group();
        window.scene3d.add(window.terrainSidesGroup);
        buildTerrainSidesAndBottom(positions, gridSize, size, minH, maxH);

        renderContourLabels(minH, maxH, contourSpacing, exaggeration);

        const center = new THREE.Vector3(0, (minH + maxH) / 2, 0);
        window.controls3d.target.copy(center);
        window.controls3d.update();

        document.getElementById('measureName').innerText = activeName;
        document.getElementById('measureCoord').innerText = `${activeLon.toFixed(4)}, ${activeLat.toFixed(4)}`;

        setTimeout(() => {
            const loadingEl = document.getElementById('loading');
            if (loadingEl) loadingEl.style.display = 'none';
        }, 300);
    }).catch((error) => {
        showBanner(`地形生成失败：${error.message}`, true);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
    });
}

function onCanvasClick(event) {
    if (!window.terrainMesh || !window.renderer3d) return;

    const rect = window.renderer3d.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, window.camera3d);
    const intersects = raycaster.intersectObject(window.terrainMesh, true);
    if (intersects.length > 0) {
        const point = intersects[0].point;
        document.getElementById('measureHeight').innerText = `${point.y.toFixed(1)} 米`;
    }
}

function showBanner(message, persistent = false) {
    const banner = document.getElementById('notification-banner');
    if (!banner) return;
    banner.innerText = message;
    banner.style.display = 'block';
    if (!persistent) {
        clearTimeout(window.bannerTimer);
        window.bannerTimer = setTimeout(() => {
            banner.style.display = 'none';
        }, 4000);
    }
}

function loadSatelliteTexture(material) {
    if (!material || !material.uniforms) return;

    const loadingEl = document.getElementById('loading');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingText = document.getElementById('loadingText');
    if (loadingEl) {
        loadingEl.style.display = 'flex';
        loadingTitle.innerText = '正在拉取天地图卫星影像...';
        loadingText.innerText = '稍等，正在获取当前选区真实遥感贴图';
    }

    const zoom = 12;
    const staticUrl = `/api/tiles/static?lon=${activeLon}&lat=${activeLat}&zoom=${zoom}`;

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
        staticUrl,
        (texture) => {
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.minFilter = THREE.LinearMipMapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.needsUpdate = true;

            if (material.uniforms.uSatelliteTex) {
                material.uniforms.uSatelliteTex.value = texture;
            }
            if (material.uniforms.uTextureMode) {
                material.uniforms.uTextureMode.value = 1.0;
            }
            material.needsUpdate = true;

            if (loadingEl) loadingEl.style.display = 'none';
        },
        undefined,
        (err) => {
            console.warn('卫星纹理加载失败', err);
            if (material.uniforms && material.uniforms.uTextureMode) {
                material.uniforms.uTextureMode.value = 0.0;
                material.needsUpdate = true;
            }
            showBanner('天地图卫星贴图加载失败，已自动回退程序生成纹理', true);
            if (loadingEl) loadingEl.style.display = 'none';
        }
    );
}

function toggleWireframe() {
    if (window.terrainMesh && window.terrainMesh.material) {
        window.terrainMesh.material.wireframe = document.getElementById('showWireframe').checked;
    }
}

function toggleAutoSpacing() {
    const enabled = document.getElementById('autoContourSpacing').checked;
    const manualGroup = document.getElementById('manualContourGroup');
    const contourInput = document.getElementById('contourSpacing');

    // 当自动模式开启时，保留滑块可见但禁用输入，视觉降低不透明度
    if (manualGroup) manualGroup.style.opacity = enabled ? '0.5' : '1.0';
    if (contourInput) contourInput.disabled = enabled;

    // 同步滑块显示与文字（滑块显示未缩放米数）
    try {
        const size = parseFloat(document.getElementById('meshSize').value);
        const exaggeration = parseFloat(document.getElementById('exaggeration').value);
        const spacingEx = computeContourSpacing(size, exaggeration); // 已包含缩放
        const display = spacingEx / (exaggeration || 1);
        if (contourInput) contourInput.value = display;
        const contourValEl = document.getElementById('contourSpacingVal');
        if (contourValEl) contourValEl.innerText = `${display.toFixed(0)} 米 ${enabled ? ' (自动适配)' : ''}`;

        if (window.terrainMesh && window.terrainMesh.material && window.terrainMesh.material.uniforms) {
            window.terrainMesh.material.uniforms.uContourSpacing.value = spacingEx;
        }
    } catch (e) {
        console.warn('toggleAutoSpacing 同步失败', e);
    }
}

function toggleLabels() {
    if (window.terrainMesh) {
        const spacing = computeContourSpacing(parseFloat(document.getElementById('meshSize').value), parseFloat(document.getElementById('exaggeration').value));
        renderContourLabels(window.lastMinHeight, window.lastMaxHeight, spacing, parseFloat(document.getElementById('exaggeration').value));
    }
}

function buildTerrainSidesAndBottom(positions, gridSize, size, minH, maxH) {
    const baseHeight = Math.min(-150, minH - 250);

    const northPoints = [];
    const southPoints = [];
    const westPoints = [];
    const eastPoints = [];

    function getVertexFromPlane(r, c) {
        const idx = r * (gridSize + 1) + c;
        return new THREE.Vector3(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
    }

    for (let c = 0; c <= gridSize; c++) northPoints.push(getVertexFromPlane(0, c));
    for (let c = 0; c <= gridSize; c++) southPoints.push(getVertexFromPlane(gridSize, c));
    for (let r = 0; r <= gridSize; r++) westPoints.push(getVertexFromPlane(r, 0));
    for (let r = 0; r <= gridSize; r++) eastPoints.push(getVertexFromPlane(r, gridSize));

    function createWallSegment(borderPoints, reverseWinding) {
        const wallGeo = new THREE.BufferGeometry();
        const verts = [];
        const indices = [];

        for (let i = 0; i < borderPoints.length; i++) {
            const pt = borderPoints[i];
            verts.push(pt.x, pt.y, pt.z);
            verts.push(pt.x, baseHeight, pt.z);
        }

        for (let i = 0; i < borderPoints.length - 1; i++) {
            const t0 = 2 * i;
            const b0 = 2 * i + 1;
            const t1 = 2 * (i + 1);
            const b1 = 2 * (i + 1) + 1;

            if (reverseWinding) {
                indices.push(t0, t1, b0);
                indices.push(b0, t1, b1);
            } else {
                indices.push(t0, b0, t1);
                indices.push(b0, b1, t1);
            }
        }

        wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        wallGeo.setIndex(indices);
        wallGeo.computeVertexNormals();

        const sideMat = new THREE.MeshBasicMaterial({ color: 0x3e2f25, side: THREE.DoubleSide });
        const wallMesh = new THREE.Mesh(wallGeo, sideMat);
        window.terrainSidesGroup.add(wallMesh);
    }

    createWallSegment(northPoints, false);
    createWallSegment(southPoints, true);
    createWallSegment(westPoints, false);
    createWallSegment(eastPoints, true);

    const bottomGeo = new THREE.PlaneGeometry(size, size);
    bottomGeo.rotateX(Math.PI / 2);
    const bottomMat = new THREE.MeshBasicMaterial({
        color: 0x1a120b,
        side: THREE.DoubleSide
    });
    const bottomMesh = new THREE.Mesh(bottomGeo, bottomMat);
    bottomMesh.position.y = baseHeight;
    window.terrainSidesGroup.add(bottomMesh);
}

function renderContourLabels(minH, maxH, spacing, exaggeration) {
    if (!window.labelGroup) {
        window.labelGroup = new THREE.Group();
        window.scene3d.add(window.labelGroup);
    }

    if (window.labelGroup.children.length > 0) {
        disposeGroup(window.labelGroup);
    }

    if (!document.getElementById('showLabels').checked) return;

    const startH = Math.ceil(minH / spacing) * spacing;
    let addedCount = 0;
    const stepRatio = Math.max(1, Math.floor(((maxH - startH) / spacing) / 8));
    const offsetVal = parseFloat(document.getElementById('labelOffset').value);

    for (let h = startH; h < maxH; h += spacing * stepRatio) {
        if (addedCount > 12) break;
        const targetHeight = h * exaggeration;

        if (window.terrainMesh) {
            const pos = window.terrainMesh.geometry.attributes.position.array;
            let bestIdx = -1;
            let minDiff = Infinity;
            for (let idx = 0; idx < pos.length / 3; idx++) {
                const vy = pos[idx * 3 + 1];
                const diff = Math.abs(vy - targetHeight);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestIdx = idx;
                }
            }

            if (bestIdx !== -1 && minDiff < 40) {
                const labelCanvas = document.createElement('canvas');
                labelCanvas.width = 128;
                labelCanvas.height = 64;
                const ctx = labelCanvas.getContext('2d');
                ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                ctx.fillRect(0, 0, 128, 64);
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 3;
                ctx.strokeRect(0, 0, 128, 64);
                ctx.fillStyle = '#10b981';
                ctx.font = 'bold 24px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(h.toFixed(0) + 'm', 64, 32);

                const texture = new THREE.CanvasTexture(labelCanvas);
                const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: true });
                const sprite = new THREE.Sprite(spriteMat);
                const sizeVal = parseFloat(document.getElementById('meshSize').value);
                const scaleFactor = sizeVal / 2400;
                sprite.scale.set(130 * scaleFactor, 65 * scaleFactor, 1);

                sprite.userData = { baseY: pos[bestIdx * 3 + 1] };
                sprite.position.set(pos[bestIdx * 3], pos[bestIdx * 3 + 1] + offsetVal * exaggeration, pos[bestIdx * 3 + 2]);
                window.labelGroup.add(sprite);
                addedCount++;
            }
        }
    }
}

// 实时更新等高间距：value为滑块上的米数（未乘缩放），finalize=true代表拖拽结束需要重建文字标注
function updateContourSpacing(value, finalize = false) {
    try {
        const isAuto = document.getElementById('autoContourSpacing')?.checked;
        if (isAuto) return; // 自动模式由generate3DTerrain控制

        const val = parseFloat(value);
        if (isNaN(val)) return;

        const exaggeration = parseFloat(document.getElementById('exaggeration').value) || 1.0;
        const spacingEx = val * exaggeration; // 着色器使用的缩放高度单位

        // 更新着色器uniform（即时生效）
        if (window.terrainMesh && window.terrainMesh.material && window.terrainMesh.material.uniforms && window.terrainMesh.material.uniforms.uContourSpacing) {
            window.terrainMesh.material.uniforms.uContourSpacing.value = spacingEx;
        }

        // 更新UI显示文字
        const contourValEl = document.getElementById('contourSpacingVal');
        if (contourValEl) contourValEl.innerText = val.toFixed(0) + ' 米';

        // 如果用户完成拖拽（或需要立刻重建标注），则重新渲染文字标签而不重建地形
        if (finalize) {
            renderContourLabels(window.lastMinHeight, window.lastMaxHeight, spacingEx, exaggeration);
        }
    } catch (e) {
        console.warn('updateContourSpacing 失败', e);
    }
}

// ESM 导出 — 供其他模块调用
window.initThree = initThree;
window.onCanvasClick = onCanvasClick;
window.showBanner = showBanner;
window.toggleWireframe = toggleWireframe;
window.toggleAutoSpacing = toggleAutoSpacing;
window.toggleLabels = toggleLabels;
window.buildTerrainSidesAndBottom = buildTerrainSidesAndBottom;
window.renderContourLabels = renderContourLabels;
window.updateContourSpacing = updateContourSpacing;