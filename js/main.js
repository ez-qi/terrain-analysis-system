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

window.onload = () => {
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
