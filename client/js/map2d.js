// Leaflet 二维选区交互控制模块

function initLeafletMap() {
    window.map2d = L.map('leafletMap', {
        zoomControl: false,
        attributionControl: false
    }).setView([window.activeLat, window.activeLon], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.map2d);

    window.marker2d = L.marker([window.activeLat, window.activeLon]).addTo(window.map2d);
    drawSelectionBox(window.activeLat, window.activeLon);

    window.map2d.on('click', function(e) {
        window.activeLon = parseFloat(e.latlng.lng.toFixed(4));
        window.activeLat = parseFloat(e.latlng.lat.toFixed(4));
        window.marker2d.setLatLng(e.latlng);
        drawSelectionBox(window.activeLat, window.activeLon);
        
        document.getElementById('mapLon').innerText = window.activeLon.toFixed(4);
        document.getElementById('mapLat').innerText = window.activeLat.toFixed(4);
        window.activeName = "自定义选区";
        
        window.generate3DTerrain(); // 主控制器回调，触发重绘
    });
}

function drawSelectionBox(lat, lon) {
    if (window.selectionRect) {
        window.map2d.removeLayer(window.selectionRect);
    }
    const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
    const mapDelta = (meshPhysicalSize / 2400) * 0.05;
    
    const bounds = [
        [lat - mapDelta, lon - mapDelta],
        [lat + mapDelta, lon + mapDelta]
    ];
    window.selectionRect = L.rectangle(bounds, {color: "#e94560", weight: 1.5, fillOpacity: 0.1}).addTo(window.map2d);
    window.map2d.panTo([lat, lon]);
}

// ESM 导出 — 供其他模块调用
window.initLeafletMap = initLeafletMap;
window.drawSelectionBox = drawSelectionBox;
