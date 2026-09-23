let map;
let currentDrawingId = null;
let currentPolyline = null;
const drawnTramos = {}; // Almacena el layer de leaflet por ID
const geoJsonData = {}; // Almacena las coordenadas guardadas

// Iniciar Mapa
map = L.map('map').setView([-2.74, -78.84], 16); // Azogues coordinates
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  attribution: 'SEMERTAZ GIS'
}).addTo(map);

// Inicializar control de dibujo (solo líneas)
const drawControl = new L.Control.Draw({
  draw: {
    polyline: {
      shapeOptions: { color: '#3b82f6', weight: 5, opacity: 0.8 },
      metric: true
    },
    polygon: false, circle: false, rectangle: false, marker: false, circlemarker: false
  },
  edit: false // Desactivamos edit normal porque lo manejaremos por código
});
map.addControl(drawControl);

// Renderizar lista
function renderList() {
  const container = document.getElementById('tramos-list');
  container.innerHTML = window.TRAMOS_CATALOG.map(t => {
    const isDrawn = !!geoJsonData[t.id];
    return `
      <div class="tramo-card" id="card-${t.id}">
        <div class="tramo-title">${t.calle || t.name}</div>
        <span class="tramo-route">Ruta ${t.route_id}</span>
        <span class="status-badge ${isDrawn ? 'status-done' : 'status-pending'}" id="badge-${t.id}">
          ${isDrawn ? 'DIBUJADO' : 'PENDIENTE'}
        </span>
        <button class="btn btn-draw ${isDrawn ? 'drawn' : ''}" id="btn-${t.id}" onclick="activateDraw(${t.id})">
          ${isDrawn ? '✏️ Redibujar' : '📍 Dibujar Línea'}
        </button>
      </div>
    `;
  }).join('');
}

// Activar herramienta de dibujo para un ID específico
function activateDraw(id) {
  currentDrawingId = id;
  
  // Si ya existía, lo borramos del mapa
  if (drawnTramos[id]) {
    map.removeLayer(drawnTramos[id]);
    delete drawnTramos[id];
    delete geoJsonData[id];
  }

  // Visual feedback
  document.querySelectorAll('.tramo-card').forEach(c => c.style.borderColor = '#e2e8f0');
  document.getElementById(`card-${id}`).style.borderColor = '#3b82f6';

  // Simular clic en el botón de línea de Leaflet Draw
  new L.Draw.Polyline(map, drawControl.options.draw.polyline).enable();
}

// Evento cuando se termina de dibujar
map.on(L.Draw.Event.CREATED, function (e) {
  if (!currentDrawingId) return;
  
  const layer = e.layer;
  map.addLayer(layer);
  
  drawnTramos[currentDrawingId] = layer;
  
  // Obtener color si existe
  const tInfo = window.TRAMOS_CATALOG.find(t => t.id === currentDrawingId);
  const color = window.ROUTE_COLORS ? (window.ROUTE_COLORS[tInfo.route_id] || '#333') : '#3b82f6';
  layer.setStyle({ color: color, weight: 6 });

  // Guardar coordenadas
  geoJsonData[currentDrawingId] = layer.toGeoJSON().geometry.coordinates;

  // Actualizar UI
  document.getElementById(`badge-${currentDrawingId}`).className = 'status-badge status-done';
  document.getElementById(`badge-${currentDrawingId}`).textContent = 'DIBUJADO';
  const btn = document.getElementById(`btn-${currentDrawingId}`);
  btn.className = 'btn btn-draw drawn';
  btn.textContent = '✏️ Redibujar';

  currentDrawingId = null;
});

function exportGeoJSON() {
  const exportObj = {};
  for (const [id, coords] of Object.entries(geoJsonData)) {
    exportObj[id] = coords;
  }
  
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "tramos_geo.json");
  document.body.appendChild(downloadAnchorNode); // required for firefox
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  
  alert('Archivo descargado. Cópialo a la carpeta frontend/dashboard/ para que el mapa lo lea.');
}

// Iniciar
setTimeout(renderList, 500);
