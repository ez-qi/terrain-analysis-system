// Leaflet 二维选区交互控制模块

function initLeafletMap() {
    map2d = L.map('leafletMap', {
        zoomControl: false,
        attributionControl: false
    }).setView([activeLat, activeLon], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map2d);

    marker2d = L.marker([activeLat, activeLon]).addTo(map2d);
    drawSelectionBox(activeLat, activeLon);

    map2d.on('click', function(e) {
        activeLon = parseFloat(e.latlng.lng.toFixed(4));
        activeLat = parseFloat(e.latlng.lat.toFixed(4));
        marker2d.setLatLng(e.latlng);
        drawSelectionBox(activeLat, activeLon);
        
        document.getElementById('mapLon').innerText = activeLon.toFixed(4);
        document.getElementById('mapLat').innerText = activeLat.toFixed(4);
        activeName = "自定义选区";
        
        generate3DTerrain(); // 主控制器回调，触发重绘
    });
}

function drawSelectionBox(lat, lon) {
    if (selectionRect) {
        map2d.removeLayer(selectionRect);
    }
    const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
    const mapDelta = (meshPhysicalSize / 2400) * 0.05;
    
    const bounds = [
        [lat - mapDelta, lon - mapDelta],
        [lat + mapDelta, lon + mapDelta]
    ];
    selectionRect = L.rectangle(bounds, {color: "#e94560", weight: 1.5, fillOpacity: 0.1}).addTo(map2d);
    map2d.panTo([lat, lon]);
}
