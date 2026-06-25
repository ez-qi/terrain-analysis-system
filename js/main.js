// 系统核心 Orchestrator 驱动控制器

let map2d;
let marker2d;
let selectionRect;
let raycaster;
let mouse;
let activeLat = 36.2500;
let activeLon = 117.1000;
let activeName = '泰山';

function selectPreset(lon, lat, name) {
    activeLon = lon;
    activeLat = lat;
    activeName = name;
    
    document.getElementById('mapLon').innerText = lon.toFixed(4);
    document.getElementById('mapLat').innerText = lat.toFixed(4);
    marker2d.setLatLng([lat, lon]);
    drawSelectionBox(lat, lon);
    
    generate3DTerrain();
}

function updateLabelOffset(value) {
    document.getElementById('labelOffsetVal').innerText = value + " 米";
    if (labelGroup && terrainMesh) {
        const exaggeration = parseFloat(document.getElementById('exaggeration').value);
        labelGroup.children.forEach(sprite => {
            if (sprite.userData && sprite.userData.baseY !== undefined) {
                sprite.position.y = sprite.userData.baseY + parseFloat(value) * exaggeration;
            }
        });
    }
}

function updateWaterPlane(height) {
    const exaggeration = parseFloat(document.getElementById('exaggeration').value);
    document.getElementById('waterHeightVal').innerText = parseFloat(height).toFixed(0) + " 米";

    if (terrainMesh && terrainMesh.material.uniforms && terrainMesh.material.uniforms.uWaterHeight) {
        terrainMesh.material.uniforms.uWaterHeight.value = height * exaggeration;
    }
}

function updateSunDirection(azimuth) {
    document.getElementById('lightAzimuthVal').innerText = azimuth + "°";
    if (terrainMesh) {
        const phi = (90 - 45) * Math.PI / 180;
        const theta = azimuth * Math.PI / 180;
        const sunVector = new THREE.Vector3(
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi),
            Math.sin(phi) * Math.cos(theta)
        ).normalize();
        terrainMesh.material.uniforms.uSunDirection.value.copy(sunVector);
    }
}

function updateContourWidth(width) {
    document.getElementById('contourLineWidthVal').innerText = width + " 像素";
    if (terrainMesh) {
        terrainMesh.material.uniforms.uContourLineWidth.value = parseFloat(width);
    }
}

// ==========================================
// 【核心修复 1】：将卫星图加载封装为 Promise，且加入动态清晰度(Zoom)补偿
// ==========================================
function loadSatelliteTexture(material) {
    return new Promise((resolve) => {
        const loadingEl = document.getElementById('loading');
        loadingEl.style.display = 'flex';
        document.getElementById('loadingTitle').innerText = "🛰️ 拉取卫星影像";
        document.getElementById('loadingText').innerText = "正在向天地图拉取高清无偏移遥感贴图...";

        const tdtTk = getTdtTk();
        
        // 【智能清晰度补偿】：根据网格物理大小，动态调节天地图缩放层级。面积越小，索要的清晰度越高。
        const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
        let optimalZoom = 13; // 默认 2400m
        if (meshPhysicalSize <= 1200) optimalZoom = 15;
        else if (meshPhysicalSize <= 2000) optimalZoom = 14;
        else if (meshPhysicalSize <= 3500) optimalZoom = 13;
        else optimalZoom = 12;

        const staticUrl = `https://api.tianditu.gov.cn/staticimage?center=${activeLon},${activeLat}&width=1024&height=1024&zoom=${optimalZoom}&layers=img_c&tk=${tdtTk}`;

        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        loader.load(
            staticUrl,
            function(texture) {
                material.uniforms.uSatelliteTex.value = texture;
                material.uniforms.uTextureMode.value = 1.0;
                material.needsUpdate = true;
                resolve(true); // 加载成功，允许放行
            },
            undefined,
            function(err) {
                console.warn(err);
                showBanner("天地图获取失败，本地已自动降级为「智能高程分色渲染」", true);
                document.getElementById('textureMode').value = 'procedural';
                material.uniforms.uTextureMode.value = 0.0;
                resolve(false); // 加载失败，允许放行
            }
        );
    });
}

// ==========================================
// 【核心修复 2】：使用 async/await 彻底解决模型白模闪烁问题
// ==========================================
async function generate3DTerrain() {
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'flex';
    document.getElementById('loadingTitle').innerText = "🌐 空间检索中...";
    document.getElementById('loadingText').innerText = `正在向高程库拉取坐标 [${activeLon.toFixed(3)}, ${activeLat.toFixed(4)}] 的真实 DEM 矩阵...`;

    // 1. 获取高程
    fetchedElevationGrid = await fetchRealElevation(activeLat, activeLon);

    const gridSize = parseInt(document.getElementById('gridSize').value);
    const exaggeration = parseFloat(document.getElementById('exaggeration').value);
    const contourColor = document.getElementById('contourColor').value;
    const textureMode = document.getElementById('textureMode').value;
    const size = parseFloat(document.getElementById('meshSize').value); 
    const contourLineWidth = parseFloat(document.getElementById('contourLineWidth').value);

    // 清理旧资源
    if (terrainMesh) {
        scene3d.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        terrainMesh.material.dispose();
    }
    if (terrainSidesGroup) {
        scene3d.remove(terrainSidesGroup);
        terrainSidesGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        });
    }
    terrainSidesGroup = new THREE.Group();
    scene3d.add(terrainSidesGroup);

    // 构建新网格
    const geometry = new THREE.PlaneGeometry(size, size, gridSize, gridSize);
    geometry.rotateX(-Math.PI / 2); 

    const positions = geometry.attributes.position.array;
    const count = positions.length / 3;

    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let i = 0; i < count; i++) {
        const xCoord = positions[i * 3];
        const zCoord = positions[i * 3 + 2];
        const u = (xCoord + size / 2) / size;
        const v = (zCoord + size / 2) / size;

        let height = 0.0;
        if (fetchedElevationGrid) {
            height = interpolateHeight(u, v, fetchedElevationGrid);
            const detailIntensity = Math.min(1.0, height / 1000.0);
            height += fbm(u * 15.0 + activeLon, v * 15.0 + activeLat) * 35.0 * detailIntensity;
        } else {
            const macroBase = fbm(u * 3.0 + activeLon * 2.3, v * 3.0 + activeLat * 1.7) * 600.0;
            const microDetail = fbm(u * 12.0 - activeLon, v * 12.0 - activeLat) * 45.0;
            height = Math.max(5.0, macroBase + microDetail);
        }

        positions[i * 3 + 1] = height * exaggeration;

        if (height < minHeight) minHeight = height;
        if (height > maxHeight) maxHeight = height;
    }

    geometry.computeVertexNormals();

    let spacing = parseFloat(document.getElementById('contourSpacing').value);
    const isAuto = document.getElementById('autoContourSpacing').checked;
    if (isAuto) {
        const heightDiff = maxHeight - minHeight;
        let autoSpacing = Math.max(5.0, heightDiff / 25.0);
        if (autoSpacing > 15.0) autoSpacing = Math.ceil(autoSpacing / 10.0) * 10.0;
        else autoSpacing = Math.ceil(autoSpacing / 5.0) * 5.0;
        
        spacing = autoSpacing;
        document.getElementById('contourSpacing').value = spacing;
        document.getElementById('contourSpacingVal').innerText = `${spacing.toFixed(0)} 米 (自适应)`;
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

    const terrainMaterial = new THREE.ShaderMaterial({
        vertexShader: terrainVertexShader,
        fragmentShader: terrainFragmentShader,
        uniforms: {
            uShowContours: { value: 1.0 },
            uContourSpacing: { value: spacing * exaggeration },
            uContourColor: { value: new THREE.Color(contourColor) },
            uContourLineWidth: { value: contourLineWidth },
            uTextureMode: { value: 0.0 }, // 默认先用着色渲染
            uSatelliteTex: { value: new THREE.Texture() },
            uSunDirection: { value: sunVector },
            uWaterHeight: { value: initialWaterHeight },
            uTime: { value: 0.0 }
        },
        extensions: { derivatives: true } 
    });

    terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    terrainMesh.material.wireframe = document.getElementById('showWireframe').checked;
    scene3d.add(terrainMesh);

    buildTerrainSidesAndBottom(positions, gridSize, size, minHeight * exaggeration, maxHeight * exaggeration);
    renderContourLabels(minHeight, maxHeight, spacing, exaggeration);

    const waterHeightSlider = document.getElementById('waterHeight');
    waterHeightSlider.max = Math.ceil(maxHeight);
    updateWaterPlane(parseFloat(waterHeightSlider.value));

    // UI Panel 数据展示
    document.getElementById('measureName').innerText = activeName;
    document.getElementById('measureStyle').innerText = fetchedElevationGrid ? "SRTM 真实世界高程" : "智能地理分形 (降级重构)";
    document.getElementById('measureCoord').innerText = `${activeLon.toFixed(4)}, ${activeLat.toFixed(4)}`;
    document.getElementById('measureHeight').innerText = `${minHeight.toFixed(0)} - ${maxHeight.toFixed(0)} 米`;

    camera3d.position.set(size * 0.9, size * 0.9, size * 0.9);
    controls3d.target.set(0, (minHeight + maxHeight) * 0.5 * exaggeration, 0);
    controls3d.update();

    // ==========================================
    // 强制等待：如果需要卫星贴图，必须等它下载完成再关闭 Loading 遮罩！
    // ==========================================
    if (textureMode === 'satellite') {
        await loadSatelliteTexture(terrainMaterial);
    }

    loadingEl.style.display = 'none'; // 此时图片已经 100% 准备好，关闭遮罩
    isFirstRender = false;

    if (fetchedElevationGrid) {
        showBanner(`🎉 地形生成成功！范围：${(size/1000).toFixed(1)}公里，最大高差：${(maxHeight - minHeight).toFixed(0)}米`);
    } else {
        showBanner(`⚠️ 高程库连接超时，已自适应降级本地地理空间噪波渲染。`);
    }
}

window.onload = async () => {
    await loadLocalConfig(); 
    initLeafletMap();
    initThree();
    
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    const threeDiv = document.getElementById('threeCanvas');
    threeDiv.addEventListener('click', onCanvasClick);

    document.getElementById('generateBtn').addEventListener('click', generate3DTerrain);
    
    document.getElementById('aiGenerateBtn').addEventListener('click', () => {
        const prompt = document.getElementById('aiPrompt').value;
        if (prompt.trim() === '') { alert("请输入地名！"); return; }
        callLLMToAnalyzeRegion(prompt);
    });

    document.getElementById('exaggeration').addEventListener('input', (e) => {
        document.getElementById('exaggerationVal').innerText = e.target.value;
    });
    
    document.getElementById('gridSize').addEventListener('input', (e) => {
        document.getElementById('gridSizeVal').innerText = e.target.value;
    });

    document.getElementById('meshSize').addEventListener('input', (e) => {
        document.getElementById('meshSizeVal').innerText = e.target.value + " 米";
        drawSelectionBox(activeLat, activeLon);
    });
    
    document.getElementById('contourSpacing').addEventListener('input', (e) => {
        document.getElementById('contourSpacingVal').innerText = e.target.value + " 米";
        if (terrainMesh && !document.getElementById('autoContourSpacing').checked) {
            const exaggeration = parseFloat(document.getElementById('exaggeration').value);
            terrainMesh.material.uniforms.uContourSpacing.value = parseFloat(e.target.value) * exaggeration;
        }
    });
    
    document.getElementById('contourColor').addEventListener('change', (e) => {
        if (terrainMesh) {
            terrainMesh.material.uniforms.uContourColor.value.set(e.target.value);
        }
    });

    document.getElementById('textureMode').addEventListener('change', () => {
        generate3DTerrain();
    });

    generate3DTerrain();
};
