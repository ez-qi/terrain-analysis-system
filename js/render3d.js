// Three.js 三维 WebGL 渲染管线与标注渲染模块

let scene3d;
let camera3d;
let renderer3d;
let controls3d;
let terrainMesh;
let terrainSidesGroup;
let labelGroup;
let bannerTimer;
let satelliteTexture;
let lastMinHeight = 0;
let lastMaxHeight = 0;

function initThree() {
    const container = document.getElementById('threeCanvas');

    scene3d = new THREE.Scene();
    scene3d.background = new THREE.Color(0x0b0f19);

    camera3d = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
    camera3d.position.set(0, 900, 1200);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene3d.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.85);
    directionalLight.position.set(1000, 1200, 700);
    scene3d.add(directionalLight);

    const grid = new THREE.GridHelper(5000, 50, 0x334155, 0x1e293b);
    grid.position.y = -1;
    scene3d.add(grid);

    terrainSidesGroup = new THREE.Group();
    scene3d.add(terrainSidesGroup);

    renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer3d.setPixelRatio(window.devicePixelRatio);
    renderer3d.setSize(container.clientWidth, container.clientHeight);
    renderer3d.domElement.style.display = 'block';
    container.appendChild(renderer3d.domElement);

    controls3d = new THREE.OrbitControls(camera3d, renderer3d.domElement);
    controls3d.enableDamping = true;
    controls3d.target.set(0, 0, 0);
    controls3d.update();

    window.addEventListener('resize', onWindowResize);

    const data = new Uint8Array([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255]);
    satelliteTexture = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
    satelliteTexture.needsUpdate = true;

    animate();
}

function onWindowResize() {
    const container = document.getElementById('threeCanvas');
    if (!renderer3d || !camera3d) return;
    camera3d.aspect = container.clientWidth / container.clientHeight;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    if (terrainMesh && terrainMesh.material && terrainMesh.material.uniforms && terrainMesh.material.uniforms.uTime) {
        terrainMesh.material.uniforms.uTime.value += 0.01;
    }
    if (controls3d) controls3d.update();
    if (renderer3d) renderer3d.render(scene3d, camera3d);
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
    if (terrainMesh) {
        if (terrainMesh.geometry) terrainMesh.geometry.dispose();
        if (terrainMesh.material) terrainMesh.material.dispose();
        scene3d.remove(terrainMesh);
        terrainMesh = null;
    }
    disposeGroup(terrainSidesGroup);
    if (labelGroup) {
        disposeGroup(labelGroup);
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
            uSatelliteTex: { value: satelliteTexture },
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

        terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
        terrainMesh.receiveShadow = true;
        terrainMesh.castShadow = false;
        scene3d.add(terrainMesh);

        if (textureMode === 'satellite') {
            loadSatelliteTexture(terrainMaterial);
        }

        lastMinHeight = minH;
        lastMaxHeight = maxH;

        if (terrainSidesGroup) {
            disposeGroup(terrainSidesGroup);
        }
        terrainSidesGroup = new THREE.Group();
        scene3d.add(terrainSidesGroup);
        buildTerrainSidesAndBottom(positions, gridSize, size, minH, maxH);

        renderContourLabels(minH, maxH, contourSpacing, exaggeration);

        const center = new THREE.Vector3(0, (minH + maxH) / 2, 0);
        controls3d.target.copy(center);
        controls3d.update();

        document.getElementById('measureName').innerText = activeName;
        document.getElementById('measureCoord').innerText = `${activeLon.toFixed(4)}, ${activeLat.toFixed(4)}`;

        setTimeout(() => {
            const loadingEl = document.getElementById('loading');
            if (loadingEl) loadingEl.style.display = 'none';
        }, 300);
    }).catch((error) => {
        showBanner(`❌ 地形生成失败：${error.message}`, true);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
    });
}

function onCanvasClick(event) {
    if (!terrainMesh || !renderer3d) return;

    const rect = renderer3d.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera3d);
    const intersects = raycaster.intersectObject(terrainMesh, true);
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
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => {
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
        loadingTitle.innerText = '🛰️ 拉取天地图卫星影像...';
        loadingText.innerText = '请稍候，正在获取当前选区的真实遥感贴图。';
    }

    const zoom = 12;
    const staticUrl = `https://api.tianditu.gov.cn/staticimage?center=${activeLon},${activeLat}&width=1024&height=1024&zoom=${zoom}&layers=img_c&tk=${TDT_TK}`;

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
            showBanner('天地图卫星贴图加载失败，已自动回退程序化渲染。', true);
            if (loadingEl) loadingEl.style.display = 'none';
        }
    );
}

function toggleWireframe() {
    if (terrainMesh && terrainMesh.material) {
        terrainMesh.material.wireframe = document.getElementById('showWireframe').checked;
    }
}

function toggleAutoSpacing() {
    const enabled = document.getElementById('autoContourSpacing').checked;
    document.getElementById('manualContourGroup').style.display = enabled ? 'none' : 'block';
    if (terrainMesh && terrainMesh.material && terrainMesh.material.uniforms) {
        const size = parseFloat(document.getElementById('meshSize').value);
        const exaggeration = parseFloat(document.getElementById('exaggeration').value);
        terrainMesh.material.uniforms.uContourSpacing.value = computeContourSpacing(size, exaggeration);
    }
}

function toggleLabels() {
    if (terrainMesh) {
        const spacing = computeContourSpacing(parseFloat(document.getElementById('meshSize').value), parseFloat(document.getElementById('exaggeration').value));
        renderContourLabels(lastMinHeight, lastMaxHeight, spacing, parseFloat(document.getElementById('exaggeration').value));
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
        terrainSidesGroup.add(wallMesh);
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
    terrainSidesGroup.add(bottomMesh);
}

function renderContourLabels(minH, maxH, spacing, exaggeration) {
    if (!labelGroup) {
        labelGroup = new THREE.Group();
        scene3d.add(labelGroup);
    }

    if (labelGroup.children.length > 0) {
        disposeGroup(labelGroup);
    }

    if (!document.getElementById('showLabels').checked) return;

    const startH = Math.ceil(minH / spacing) * spacing;
    let addedCount = 0;
    const stepRatio = Math.max(1, Math.floor(((maxH - startH) / spacing) / 8));
    const offsetVal = parseFloat(document.getElementById('labelOffset').value);

    for (let h = startH; h < maxH; h += spacing * stepRatio) {
        if (addedCount > 12) break;
        const targetHeight = h * exaggeration;

        if (terrainMesh) {
            const pos = terrainMesh.geometry.attributes.position.array;
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
                labelGroup.add(sprite);
                addedCount++;
            }
        }
    }
}
