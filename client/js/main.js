// 系统核心 Orchestrator 驱动控制器（ESM 入口）

// 导入所有模块
import './config.js';
import './shaders.js';
import './terrainEngine.js';
import './map2d.js';
import './render3d.js';
import './aiAgent.js';
import './rainSystem.js';

// 共享变量声明 — 通过 window.* 跨模块共享（不使用 let+window 双绑定）
window.map2d = undefined;
window.marker2d = undefined;
window.selectionRect = undefined;
window.raycaster = undefined;
window.mouse = undefined;
// 共享原始类型直接挂在 window 上（其他模块通过 window.* 读取）
window.activeLat = 36.2500;
window.activeLon = 117.1000;
window.activeName = '泰北';
window.fetchedElevationGrid = null;

function selectPreset(lon, lat, name) {
    window.activeLon = lon;
    window.activeLat = lat;
    window.activeName = name;

    document.getElementById('mapLon').innerText = lon.toFixed(4);
    document.getElementById('mapLat').innerText = lat.toFixed(4);
    window.marker2d.setLatLng([lat, lon]);
    window.drawSelectionBox(lat, lon);

    generate3DTerrain();
}

function updateLabelOffset(value) {
    document.getElementById('labelOffsetVal').innerText = value + " 米";
    if (window.labelGroup && window.terrainMesh) {
        const exaggeration = parseFloat(document.getElementById('exaggeration').value);
        window.labelGroup.children.forEach(sprite => {
            if (sprite.userData && sprite.userData.baseY !== undefined) {
                sprite.position.y = sprite.userData.baseY + parseFloat(value) * exaggeration;
            }
        });
    }
}

function updateWaterPlane(height) {
    const exaggeration = parseFloat(document.getElementById('exaggeration').value);
    document.getElementById('waterHeightVal').innerText = parseFloat(height).toFixed(0) + " 米";

    if (window.terrainMesh && window.terrainMesh.material.uniforms && window.terrainMesh.material.uniforms.uWaterHeight) {
        window.terrainMesh.material.uniforms.uWaterHeight.value = height * exaggeration;
    }
}

function updateSunDirection(azimuth) {
    document.getElementById('lightAzimuthVal').innerText = azimuth + "°";
    if (window.terrainMesh) {
        const phi = (90 - 45) * Math.PI / 180;
        const theta = azimuth * Math.PI / 180;
        const sunVector = new THREE.Vector3(
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi),
            Math.sin(phi) * Math.cos(theta)
        ).normalize();
        window.terrainMesh.material.uniforms.uSunDirection.value.copy(sunVector);
    }
}

function updateContourWidth(width) {
    document.getElementById('contourLineWidthVal').innerText = width + " 像素";
    if (window.terrainMesh) {
        window.terrainMesh.material.uniforms.uContourLineWidth.value = parseFloat(width);
    }
}

// ==========================================
// 核心优化1：将卫星图片加载封装进Promise，同时增加动态清晰度(缩放等级)补偿
// ==========================================
function loadSatelliteTexture(material) {
    return new Promise((resolve) => {
        const loadingEl = document.getElementById('loading');
        loadingEl.style.display = 'flex';
        document.getElementById('loadingTitle').innerText = "正在拉取卫星影像";
        document.getElementById('loadingText').innerText = "正在向天地图获取高清无偏移遥感贴图...";

        const tdtTk = window.getTdtTk();        // 智能清晰度补偿：根据网格物理尺寸，动态调整天地图缩放层级。区域范围越小，需要的清晰度越高
        const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
        let optimalZoom = 13; // 默认 2400m
        if (meshPhysicalSize <= 1200) optimalZoom = 15;
        else if (meshPhysicalSize <= 2000) optimalZoom = 14;
        else if (meshPhysicalSize <= 3500) optimalZoom = 13;
        else optimalZoom = 12;

        // 通过后端代理获取天地图卫星影像（隐藏 Token）
        const staticUrl = `/api/tiles/static?lon=${window.activeLon}&lat=${window.activeLat}&zoom=${optimalZoom}`;

        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        loader.load(
            staticUrl,
            function (texture) {
                material.uniforms.uSatelliteTex.value = texture;
                material.uniforms.uTextureMode.value = 1.0;
                material.needsUpdate = true;
                resolve(true); // 加载成功，允许关闭加载遮罩
            },
            undefined,
            function (err) {
                console.warn(err);
                window.showBanner("天地图资源获取失败，本地已自动降级为智能高程分层纹理", true);
                document.getElementById('textureMode').value = 'procedural';
                material.uniforms.uTextureMode.value = 0.0;
                resolve(false); // 加载失败，允许关闭加载遮罩
            }
        );
    });
}

// ==========================================
// 核心优化2：使用 async/await 彻底解决模型白屏卡顿问题
// ==========================================
async function generate3DTerrain() {
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'flex';
    document.getElementById('loadingTitle').innerText = "空间地形解析中...";
    document.getElementById('loadingText').innerText = `正在向高程库获取坐标 [${window.activeLon.toFixed(3)}, ${window.activeLat.toFixed(4)}] 的真实DEM网格...`;

    // 1. 获取高程数据
    window.fetchedElevationGrid = await fetchRealElevation(window.activeLat, window.activeLon);

    const gridSize = parseInt(document.getElementById('gridSize').value);
    const exaggeration = parseFloat(document.getElementById('exaggeration').value);
    const contourColor = document.getElementById('contourColor').value;
    const textureMode = document.getElementById('textureMode').value;
    const size = parseFloat(document.getElementById('meshSize').value);
    const contourLineWidth = parseFloat(document.getElementById('contourLineWidth').value);

    // 清理旧资源
    if (window.terrainMesh) {
        window.scene3d.remove(window.terrainMesh);
        window.terrainMesh.geometry.dispose();
        window.terrainMesh.material.dispose();
    }
    if (window.terrainSidesGroup) {
        window.scene3d.remove(window.terrainSidesGroup);
        window.terrainSidesGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        });
    }
    window.terrainSidesGroup = new THREE.Group();
    window.scene3d.add(window.terrainSidesGroup);

    // 通过 WebWorker 异步构建几何体数据（失败回退主线程同步）
    const geomData = await buildTerrainGeometryAsync(
        window.fetchedElevationGrid, gridSize, size, exaggeration,
        window.activeLat, window.activeLon
    );

    const { positions, normals, uvs, indices, minHeight, maxHeight } = geomData;

    // 组装 Three.js BufferGeometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    let spacing = parseFloat(document.getElementById('contourSpacing').value);
    const isAuto = document.getElementById('autoContourSpacing').checked;

    if (isAuto) {
        const heightDiff = maxHeight - minHeight;
        let autoSpacing = Math.max(5.0, heightDiff / 25.0);
        if (autoSpacing > 15.0) autoSpacing = Math.ceil(autoSpacing / 10.0) * 10.0;
        else autoSpacing = Math.ceil(autoSpacing / 5.0) * 5.0;

        spacing = autoSpacing;
        document.getElementById('contourSpacing').value = spacing;
        document.getElementById('contourSpacingVal').innerText = `${spacing.toFixed(0)} 米(自动适配)`;
    }

    const azimuthVal = parseFloat(document.getElementById('lightAzimuth').value);
    const phi = (90 - 45) * Math.PI / 180;
    const theta = azimuthVal * Math.PI / 180;
    const sunVector = new THREE.Vector3(
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.cos(theta)
    ).normalize();

    const initialWaterHeight = parseFloat(document.getElementById('waterHeight').value) * exaggeration;

    let textureModeEnum = 0.0;
    if (textureMode === 'satellite') textureModeEnum = 1.0;
    else if (textureMode === 'riskMap') textureModeEnum = 2.0;

    const terrainMaterial = new THREE.ShaderMaterial({
        vertexShader: window.terrainVertexShader,
        fragmentShader: window.terrainFragmentShader,
        uniforms: {
            uShowContours: { value: 1.0 },
            uContourSpacing: { value: spacing * exaggeration },
            uContourColor: { value: new THREE.Color(contourColor) },
            uContourLineWidth: { value: contourLineWidth },
            uTextureMode: { value: textureModeEnum },
            uSatelliteTex: { value: new THREE.Texture() },
            uSunDirection: { value: sunVector },
            uWaterHeight: { value: initialWaterHeight },
            uPrecipitation: { value: parseFloat(document.getElementById('precipitation')?.value || 0) },
            uBaseVeg: { value: 0.7 },
            uTime: { value: 0.0 }
        },
        extensions: { derivatives: true }
    });

    window.terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    window.terrainMesh.material.wireframe = document.getElementById('showWireframe').checked;
    window.scene3d.add(window.terrainMesh);

    buildTerrainSidesAndBottom(positions, gridSize, size, minHeight * exaggeration, maxHeight * exaggeration);
    renderContourLabels(minHeight, maxHeight, spacing, exaggeration);

    const waterHeightSlider = document.getElementById('waterHeight');
    waterHeightSlider.max = Math.ceil((maxHeight - minHeight) * 0.5 + minHeight);
    updateWaterPlane(parseFloat(waterHeightSlider.value));

    // UI面板数据展示
    document.getElementById('measureName').innerText = window.activeName;
    document.getElementById('measureStyle').innerText = window.fetchedElevationGrid ? "SRTM 真实全球高程" : "智能地形生成 (本地重建)";
    document.getElementById('measureCoord').innerText = `${window.activeLon.toFixed(4)}, ${window.activeLat.toFixed(4)}`;
    document.getElementById('measureHeight').innerText = `${minHeight.toFixed(0)} - ${maxHeight.toFixed(0)} 米`;

    window.camera3d.position.set(size * 0.9, size * 0.9, size * 0.9);
    window.controls3d.target.set(0, (minHeight + maxHeight) * 0.5 * exaggeration, 0);
    window.controls3d.update();

    // ==========================================
    // 强制等待：如果需要卫星贴图，必须等待下载完成再关闭Loading遮罩
    // ==========================================
    if (textureMode === 'satellite') {
        await loadSatelliteTexture(terrainMaterial);
    }

    // 重建降雨粒子系统
    setupRainParticles();

    // 恢复暂停时的水位状态
    if (window.rainPlaying) {
        window.rainSystemInstance?.setOpacity(1.0);
    }

    loadingEl.style.display = 'none'; // 此时资源全部就绪，关闭加载遮罩
    window.isFirstRender = false;

    if (window.fetchedElevationGrid) {
        window.showBanner(`地形生成成功！范围：${(size / 1000).toFixed(1)}千米，最大高差：${(maxHeight - minHeight).toFixed(0)}米`);
    } else {
        window.showBanner(`高程接口超时，已自动适配本地程序化地形噪声渲染`);
    }
}

window.onload = async () => {
    window.initLeafletMap();
    window.initThree();
    window.initRainSystem();

    window.raycaster = new THREE.Raycaster();
    window.mouse = new THREE.Vector2();
    const threeDiv = document.getElementById('threeCanvas');
    threeDiv.addEventListener('click', window.onCanvasClick);

    document.getElementById('generateBtn').addEventListener('click', generate3DTerrain);

    document.getElementById('aiGenerateBtn').addEventListener('click', () => {
        const prompt = document.getElementById('aiPrompt').value;
        if (prompt.trim() === '') { alert("请输入地名！"); return; }
        window.callLLMToAnalyzeRegion(prompt);
    });

    // 降雨预设按钮事件 (通过 onclick 已处理，但需要确保播放时预设更新也对水位产生影响)
    document.getElementById('exaggeration').addEventListener('input', (e) => {
        document.getElementById('exaggerationVal').innerText = e.target.value;
    });

    document.getElementById('gridSize').addEventListener('input', (e) => {
        document.getElementById('gridSizeVal').innerText = e.target.value;
    });

    document.getElementById('meshSize').addEventListener('input', (e) => {
        document.getElementById('meshSizeVal').innerText = e.target.value + " 米";
        window.drawSelectionBox(window.activeLat, window.activeLon);
    });

    document.getElementById('contourSpacing').addEventListener('input', (e) => {
        document.getElementById('contourSpacingVal').innerText = e.target.value + " 米";
        if (window.terrainMesh && !document.getElementById('autoContourSpacing').checked) {
            const exaggeration = parseFloat(document.getElementById('exaggeration').value);
            window.terrainMesh.material.uniforms.uContourSpacing.value = parseFloat(e.target.value) * exaggeration;
        }
    });

    document.getElementById('contourColor').addEventListener('change', (e) => {
        if (window.terrainMesh) {
            window.terrainMesh.material.uniforms.uContourColor.value.set(e.target.value);
        }
    });

    document.getElementById('textureMode').addEventListener('change', () => {
        generate3DTerrain();
    });

    const precipitationSlider = document.getElementById('precipitation');
    if (precipitationSlider) {
        precipitationSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            const precipValEl = document.getElementById('precipVal');
            if (precipValEl) precipValEl.innerText = val + " mm";
            if (window.terrainMesh && window.terrainMesh.material.uniforms && window.terrainMesh.material.uniforms.uPrecipitation) {
                window.terrainMesh.material.uniforms.uPrecipitation.value = parseFloat(val);
            }
        });
    }

    const aiEcoBtn = document.getElementById('aiEcoBtn');
    if (aiEcoBtn) {
        aiEcoBtn.addEventListener('click', async () => {
            try {
                aiEcoBtn.innerText = "AI地形深度分析中...";
                const ecoData = await window.fetchEcoDisasterAnalysis(window.activeName);

                const ecoClimateEl = document.getElementById('ecoClimate');
                const ecoSoilEl = document.getElementById('ecoSoil');
                const ecoVegBaseEl = document.getElementById('ecoVegBase');
                const ecoResultPanel = document.getElementById('ecoResultPanel');

                if (ecoClimateEl) ecoClimateEl.innerText = ecoData.climate || "N/A";
                if (ecoSoilEl) ecoSoilEl.innerText = ecoData.soil || "N/A";
                if (ecoVegBaseEl) ecoVegBaseEl.innerText = ecoData.baseVegCoverage != null ? ecoData.baseVegCoverage : "N/A";
                if (ecoResultPanel) ecoResultPanel.classList.remove('hidden');

                if (window.terrainMesh && window.terrainMesh.material.uniforms && window.terrainMesh.material.uBaseVeg) {
                    window.terrainMesh.material.uniforms.uBaseVeg.value = parseFloat(ecoData.baseVegCoverage) || 0.7;
                }

                document.getElementById('textureMode').value = 'riskMap';
                generate3DTerrain();
            } catch (e) {
                console.error(e);
                alert("AI推演失败，请重试");
            } finally {
                aiEcoBtn.innerText = "一键AI生态要素提取与灾害推演";
            }
        });
    }

    // === 可拖拽分隔条：调整侧栏宽度 ===
    const resizer = document.getElementById('sidebarResizer');
    const sidebar = document.getElementById('sidebar');
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const delta = e.clientX - startX;
        const min = parseInt(getComputedStyle(sidebar).minWidth, 10) || 280;
        const max = parseInt(getComputedStyle(sidebar).maxWidth, 10) || 800;
        const newWidth = Math.min(max, Math.max(min, startWidth + delta));
        sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    // 双击恢复默认宽度
    resizer.addEventListener('dblclick', () => {
        sidebar.style.width = '420px';
    });

    generate3DTerrain();
};

// 显式挂载 HTML onclick 回调到 window（ESM 兼容）
// 以下函数定义在当前模块中，直接导出
window.selectPreset = selectPreset;
window.updateWaterPlane = updateWaterPlane;
window.updateSunDirection = updateSunDirection;
window.updateContourWidth = updateContourWidth;
window.updateLabelOffset = updateLabelOffset;
window.generate3DTerrain = generate3DTerrain;

// 以下函数在 HTML inline script 或各模块中已挂载到 window
// toggleMenu / toggleWireframe / toggleAutoSpacing / toggleLabels / applyRainPreset
// setRainTimeSpeed / toggleRainPlay / resetRainSimulation / onRainTimeSliderChange
// 它们由各自定义文件通过 window.xxx = xxx 导出，无需重复导出