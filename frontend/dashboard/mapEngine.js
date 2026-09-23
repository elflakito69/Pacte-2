/**
 * SEMERTAZ — mapEngine.js
 * Motor principal del mapa radar de Azogues
 * GAD Municipal Azogues
 */

// ============================================================
// CONFIGURACIÓN GLOBAL DEL MAPA
// ============================================================
const AZOGUES_CENTER = [-78.8467, -2.7393];
const MAP_ZOOM = 15;
const MAP_MIN_ZOOM = 13;
const MAP_MAX_ZOOM = 19;
// Tile: CARTO Dark All — mapa oscuro profesional original
const TILE_URL_DARK = 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://carto.com/">CARTO</a> | SEMERTAZ — GAD Municipal Azogues';
let semertazMap = null;
let controllerMarkers = {};
let routeLayers = {};
let routeGeoJSON = null;
let tramoGeoJSON = null;
let tramosLayer = null;
let liveInterval = null;
let routeDrawnItems = null;

// ============================================================
// OFFSET = 0: OSM Standard coincide exactamente con geojson.io Standard
// Las rutas fueron trazadas sobre OSM Standard → alineación perfecta sin corrección
// ============================================================
const ROUTE_OFFSET_LNG = 0;
const ROUTE_OFFSET_LAT = 0;

// ============================================================
// INICIALIZACIÓN DEL MAPA
// ============================================================
function initRadarMap() {
  if (semertazMap) {
    semertazMap.remove();
    semertazMap = null;
  }

  semertazMap = L.map('semertaz-map', {
    center: [AZOGUES_CENTER[1], AZOGUES_CENTER[0]],
    zoom: MAP_ZOOM,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    zoomControl: false, scrollWheelZoom: false,
    preferCanvas: true,
    attributionControl: true
  });

  // Tile CARTO Dark All — mapa oscuro profesional
  L.tileLayer(TILE_URL_DARK, {
    
    attribution: TILE_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 22,
    maxNativeZoom: 19,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  }).addTo(semertazMap);

  L.control.zoom({ position: 'bottomright' }).addTo(semertazMap);
  setupRouteDrawing();


  initMapClickReset();
  loadRoutesLayer().then(() => {
    startLiveTracking();
  });

  console.log('[SEMERTAZ RADAR] Mapa iniciado sobre Azogues ✅');
}

function setupRouteDrawing() {
  if (!currentUser || currentUser.role !== 'admin' || !L.Control.Draw) return;

  routeDrawnItems = new L.FeatureGroup();
  semertazMap.addLayer(routeDrawnItems);
  const drawControl = new L.Control.Draw({
    position: 'topright',
    edit: { featureGroup: routeDrawnItems },
    draw: {
      polyline: { shapeOptions: { color: '#f59e0b', weight: 4 } },
      polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#f59e0b' } },
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false
    }
  });
  semertazMap.addControl(drawControl);

  semertazMap.on(L.Draw.Event.CREATED, event => {
    routeDrawnItems.addLayer(event.layer);
    saveDrawnRoutes();
  });
  semertazMap.on(L.Draw.Event.EDITED, saveDrawnRoutes);
  semertazMap.on(L.Draw.Event.DELETED, saveDrawnRoutes);
}

async function saveDrawnRoutes() {
  if (!currentUser || currentUser.role !== 'admin' || !routeGeoJSON || !routeDrawnItems) return;

  const existingFeatures = routeGeoJSON.features.filter(feature => feature.properties && feature.properties.id);
  const maxId = existingFeatures.reduce((highest, feature) => {
    const value = parseInt(String(feature.properties.id).replace('R', ''), 10);
    return Number.isFinite(value) && value > highest ? value : highest;
  }, 0);
  const drawnFeatures = routeDrawnItems.toGeoJSON().features;
  drawnFeatures.forEach((feature, index) => {
    feature.properties = feature.properties || {};
    if (!feature.properties.id) feature.properties.id = 'R' + (maxId + index + 1);
    if (!feature.properties.nombre) feature.properties.nombre = 'Ruta dibujada ' + feature.properties.id;
    feature.properties.stroke = feature.properties.stroke || '#f59e0b';
  });

  try {
    const response = await fetch(API_URL + '/routes/geojson', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'FeatureCollection', features: existingFeatures.concat(drawnFeatures) })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'No se pudo guardar la ruta');
    }
    routeGeoJSON.features = existingFeatures.concat(drawnFeatures);
    routeDrawnItems.clearLayers();
    showToast('Ruta guardada con respaldo GeoJSON', 'success');
    await loadRoutesLayer();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============================================================
// CAPA DE RUTAS R1–R18 (GeoJSON)
// ============================================================
// ============================================================
// CORRECCIÓN DE COORDENADAS — Aplica offset de centrado
// ============================================================
function applyCoordinateOffset(geojson) {
  if (!geojson || !geojson.features) return geojson;
  const lngOffset = Number.isFinite(window._calLng) ? window._calLng : ROUTE_OFFSET_LNG;
  const latOffset = Number.isFinite(window._calLat) ? window._calLat : ROUTE_OFFSET_LAT;
  const offsetCoords = (coords) => {
    if (!Array.isArray(coords)) return coords;
    // Detectar si es un punto [lng, lat] o un array de puntos
    if (typeof coords[0] === 'number') {
      return [coords[0] + lngOffset, coords[1] + latOffset];
    }
    return coords.map(offsetCoords);
  };
  return {
    ...geojson,
    features: geojson.features.map(feature => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: offsetCoords(feature.geometry.coordinates)
      }
    }))
  };
}

async function loadRoutesLayer() {
  try {
    const resp = await fetch('/frontend/assets/semertaz_routes.geojson');
    const rawGeoJSON = await resp.json();
    rawGeoJSON._raw = JSON.parse(JSON.stringify(rawGeoJSON)); // Guardar copia sin offset
    routeGeoJSON = applyCoordinateOffset(rawGeoJSON);
    const getRouteColor = feature => feature.properties.stroke || feature.properties.color || '#1a85d4';
    const routeTooltipShown = {};
    const routesResponse = await fetch(`${API_URL}/routes?per_page=100`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const routesData = routesResponse.ok ? await routesResponse.json() : { routes: [] };
    const activeRoutes = {};
    (routesData.routes || []).forEach(route => {
      activeRoutes['R' + route.id] = route.is_active !== false;
      activeRoutes[String(route.id)] = route.is_active !== false;
    });

    // LIMPIAR CAPAS EXISTENTES ANTES DE REDIBUJAR
    if (window.currentGeoJsonLayer) {
      semertazMap.removeLayer(window.currentGeoJsonLayer);
    }
    Object.values(routeLayers).forEach(lg => { if (lg.clearLayers) lg.clearLayers(); });

    window.currentGeoJsonLayer = L.geoJSON(routeGeoJSON, {
      style: feature => ({
        fillColor: activeRoutes[String(feature.properties.id || feature.properties.ruta)] === false ? '#333' : getRouteColor(feature),
        fillOpacity: 0,
        color: activeRoutes[String(feature.properties.id || feature.properties.ruta)] === false ? '#333' : getRouteColor(feature),
        weight: 4,
        dashArray: '10, 12',
        opacity: activeRoutes[String(feature.properties.id || feature.properties.ruta)] === false ? 0.35 : 1,
        
        
      }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const routeId = p.id || p.ruta;
        const routeName = p.nombre || p.name || routeId;
        const routeColor = getRouteColor(feature);
        if (!routeLayers[routeId]) routeLayers[routeId] = L.featureGroup().addTo(semertazMap);
        routeLayers[routeId].addLayer(layer);

        if (!routeTooltipShown[routeId]) {
          layer.bindTooltip(
            `<span style="background:rgba(15,23,42,0.8);color:${routeColor};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;font-family:sans-serif;">${routeId}</span>`,
            { permanent: true, direction: 'center', className: 'transparent-tooltip' }
          );
          routeTooltipShown[routeId] = true;
        }

        layer.bindPopup(
          `<div style="background:#0f172a;color:#fff;padding:12px;border-radius:8px;border:1px solid ${routeColor};min-width:140px;font-family:Inter,sans-serif;">
            <div style="color:${routeColor};font-weight:700;font-size:14px;margin-bottom:4px;">${routeId}</div>
            <div style="color:rgba(255,255,255,0.7);font-size:12px;">${routeName}</div>
          </div>`,
          { className: 'semertaz-popup' }
        );

        layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.02, weight: 4.2, opacity: 1 }));
        layer.on('mouseout', () => layer.setStyle({ fillOpacity: 0, weight: 4,
        dashArray: '10, 12', opacity: 1,  }));
        layer.on('click', () => focusRoute(routeId));
      }
    }).addTo(semertazMap);

    
    await loadTramosLayer();
    if (window.currentGeoJsonLayer && tramosLayer && semertazMap) {
      const overlayMaps = {
        "Rutas Principales": window.currentGeoJsonLayer,
        "Tramos de Apoyo": tramosLayer
      };
      if (window.radarLayerControl) {
        semertazMap.removeControl(window.radarLayerControl);
      }
      window.radarLayerControl = L.control.layers(null, overlayMaps, { collapsed: false, position: 'topright' }).addTo(semertazMap);
    }

    populateHUDRouteFilter();
    console.log('[SEMERTAZ RADAR] 18 zonas cargadas ✅');
  } catch (e) {
    console.error('[SEMERTAZ RADAR] Error cargando GeoJSON:', e);
  }
}

// ============================================================
// RASTREO EN VIVO (Polling REST — compatible sin WebSocket)
// ============================================================
function startLiveTracking() {
  fetchAndRenderControllers();
  if (liveInterval) clearInterval(liveInterval);
  liveInterval = setInterval(fetchAndRenderControllers, 15000);
}

async function fetchAndRenderControllers() {
  try {
    const resp = await fetch(`${API_URL}/monitoring/live`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    updateRadarMarkers(data.controllers || []);
    updateHUDStats(data.controllers || []);
    updateControllersList(data.controllers || []);
    
    // Recargar rutas por si alguna fue activada/desactivada recientemente
    if (typeof loadRoutesLayer === 'function') {
      await loadRoutesLayer();
    }
  } catch (e) {
    console.warn('[SEMERTAZ RADAR] Sin datos de posicion:', e);
  }
}

// ============================================================
// GEOFENCING — Verifica si el controlador está en su zona
// ============================================================
function isControllerInZone(lat, lng, routeId) {
  if (!lat || !lng || lat === 0 || lng === 0) return null;
  if (!routeGeoJSON || !window.turf) return true;
  const point = turf.point([lng, lat]);
  const routeFeatures = routeGeoJSON.features.filter(f => {
    const featureRouteId = f.properties.id || f.properties.ruta;
    return featureRouteId === routeId || featureRouteId === `R${routeId}`;
  });
  if (routeFeatures.length === 0) return true;

  return routeFeatures.some(feature => {
    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
      return turf.booleanPointInPolygon(point, feature);
    }
    if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
      return turf.pointToLineDistance(point, feature, { units: 'meters' }) < 80;
    }
    return false;
  });
}

// ============================================================
// RENDERIZADO DE MARCADORES
// ============================================================
function updateRadarMarkers(controllers) {
  const activeIds = new Set();

  controllers.forEach(ctrl => {
    activeIds.add(ctrl.user_id);

    const inZone = isControllerInZone(ctrl.latitude, ctrl.longitude, ctrl.current_route_id, ctrl.assigned_tramos);
    const status = inZone === null ? 'no-signal' : inZone ? 'on' : 'off';
    const statusLabel = inZone === null ? '⚠️ SIN SEÑAL' : inZone ? '✅ EN RUTA' : '🚨 FUERA DE ZONA';
    const markerWrapperClass = inZone === null ? 'no-signal' : inZone ? 'on-zone' : 'off-zone';

    const shortName = (ctrl.user_name || 'CTRL').split(' ')[0];
    const markerIcon = L.divIcon({
      className: 'custom-radar-marker',
      html: `
        <div class="marker-wrapper ${markerWrapperClass}">
          <div class="marker-label">${shortName}</div>
          <div class="marker-dot"></div>
          <div class="marker-halo"></div>
        </div>`,
      iconSize: [60, 40],
      iconAnchor: [30, 30]
    });

    const routeName = ctrl.route_id ? `Zona R${ctrl.current_route_id || ctrl.route_id}` : 'Sin zona';
    let tramosText = '';
    if (ctrl.assigned_tramos && window.TRAMOS_CATALOG) {
      try {
        const parsedTramos = typeof ctrl.assigned_tramos === 'string' ? JSON.parse(ctrl.assigned_tramos) : ctrl.assigned_tramos;
        if (Array.isArray(parsedTramos) && parsedTramos.length > 0) {
          const nombresTramos = parsedTramos.map(id => {
            const t = window.TRAMOS_CATALOG.find(x => Number(x.id) === Number(id));
            return t ? t.name : `Tramo ${id}`;
          });
          tramosText = `<div class="popup-route" style="color:#f59e0b;font-size:11px;margin-top:4px;white-space:normal;line-height:1.2;">📌 Apoyo:<br>${nombresTramos.join(', ')}</div>`;
        }
      } catch(e){}
    }
    
    const popupContent = `
      <div class="controller-popup">
        <div class="popup-name">👤 ${ctrl.user_name}</div>
        <div class="popup-route">📍 ${routeName}</div>
        ${tramosText}
        <div class="popup-status-${status}">${statusLabel}</div>
        <div style="color:rgba(255,255,255,0.4);font-size:10px;margin-top:4px;">
          ${new Date(ctrl.timestamp).toLocaleTimeString('es-EC')}
        </div>
      </div>`;

    if (controllerMarkers[ctrl.user_id]) {
      const marker = controllerMarkers[ctrl.user_id];
      if (inZone !== null) marker.setLatLng([ctrl.latitude, ctrl.longitude]);
      marker.setIcon(markerIcon).bindPopup(popupContent);
    } else {
      if (inZone === null) return;
      const marker = L.marker([ctrl.latitude, ctrl.longitude], { icon: markerIcon })
        .bindPopup(popupContent)
        .addTo(semertazMap);
      controllerMarkers[ctrl.user_id] = marker;
    }
  });

  Object.keys(controllerMarkers).forEach(id => {
    if (!activeIds.has(parseInt(id))) {
      semertazMap.removeLayer(controllerMarkers[id]);
      delete controllerMarkers[id];
    }
  });
}

// ============================================================
// ACTUALIZACIÓN DEL PANEL HUD
// ============================================================
function updateHUDStats(controllers) {
  const total = controllers.length;
  const statuses = controllers.map(c => isControllerInZone(c.latitude, c.longitude, c.current_route_id));
  const onRoute = statuses.filter(status => status === true).length;
  const offRoute = statuses.filter(status => status === false).length;
  const elTotal = document.getElementById('hud-total');
  const elOn = document.getElementById('hud-on-route');
  const elOff = document.getElementById('hud-off-route');
  const elTime = document.getElementById('hud-last-update');

  if (elTotal) elTotal.textContent = total;
  if (elOn) elOn.textContent = onRoute;
  if (elOff) elOff.textContent = offRoute;
  if (elTime) elTime.textContent = new Date().toLocaleTimeString('es-EC');
}

// ============================================================
// LISTA LATERAL DE CONTROLADORES
// ============================================================
function updateControllersList(controllers) {
  const list = document.getElementById('radar-ctrl-items');
  if (!list) return;

  if (controllers.length === 0) {
    list.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:11px;text-align:center;padding:10px;">Sin controladores reportando posición</div>';
    return;
  }

  list.innerHTML = controllers.map(ctrl => {
    const inZone = isControllerInZone(ctrl.latitude, ctrl.longitude, ctrl.current_route_id, ctrl.assigned_tramos);
    const routeFeature = routeGeoJSON && routeGeoJSON.features.find(f => {
      const featureRouteId = f.properties.id || f.properties.ruta;
      return featureRouteId === ctrl.current_route_id || featureRouteId === `R${ctrl.current_route_id}`;
    });
    const routeName = routeFeature ? routeFeature.properties.nombre || routeFeature.properties.name || `R${ctrl.current_route_id}` : `R${ctrl.current_route_id || '?'}`;
    const dotClass = inZone === null ? 'no-signal' : inZone ? 'on' : 'off';
    const statusText = inZone === null ? '<span style="color:rgba(255,255,255,0.4);">⏳ Sin GPS</span>' : inZone ? 'En Ruta' : 'Fuera de Zona';
    let tramoBadge = '';
    if (ctrl.assigned_tramos && window.TRAMOS_CATALOG) {
      try {
        const parsed = typeof ctrl.assigned_tramos === 'string' ? JSON.parse(ctrl.assigned_tramos) : ctrl.assigned_tramos;
        if (Array.isArray(parsed) && parsed.length > 0) {
          tramoBadge = '<div style="color:#f59e0b;font-size:9px;margin-top:2px;">\u{1F4CC} Apoyo activo (' + parsed.length + ' tramos)</div>';
        }
      } catch(e){}
    }
    return `
      <div class="ctrl-list-item" onclick="focusController(${ctrl.user_id})">
        <div class="ctrl-dot ${dotClass}"${inZone === null ? ' style="background:rgba(255,255,255,0.4);"' : ''}></div>
        <div class="ctrl-info">
          <div class="ctrl-name">${ctrl.user_name}</div>
          <div class="ctrl-route">${routeName} · ${statusText}</div>
          ${tramoBadge}
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// UTILIDADES DEL MAPA
// ============================================================
let currentFocusedRoute = null;

function updateRoutesVisibility() {
  if (!window.currentGeoJsonLayer) return;
  window.currentGeoJsonLayer.eachLayer(layer => {
    const rId = String(layer.feature.properties.id || layer.feature.properties.ruta || '');
    if (currentFocusedRoute === null || currentFocusedRoute === 'all' || rId === currentFocusedRoute) {
      layer.setStyle({ opacity: 1, fillOpacity: 0.1 });
    } else {
      layer.setStyle({ opacity: 0.15, fillOpacity: 0 });
    }
  });
}

function focusRoute(routeId) {
  currentFocusedRoute = String(routeId);
  const layer = routeLayers[routeId];
  if (layer && semertazMap && layer.getBounds) {
    semertazMap.flyToBounds(layer.getBounds(), { padding: [40, 40], duration: 1.5 });
  }
  updateRoutesVisibility();
}

// Escuchar click en el mapa para resetear el foco
function initMapClickReset() {
  if (semertazMap) {
    semertazMap.on('click', () => {
      if (currentFocusedRoute !== null && currentFocusedRoute !== 'all') {
        currentFocusedRoute = null;
        updateRoutesVisibility();
        const sel = document.getElementById('hud-route-sel');
        if (sel) sel.value = 'all';
      }
    });
  }
}

function focusController(userId) {
  const marker = controllerMarkers[userId];
  if (marker && semertazMap) {
    semertazMap.setView(marker.getLatLng(), 17);
    marker.openPopup();
  }
}

function populateHUDRouteFilter() {
  const sel = document.getElementById('hud-route-sel');
  if (!sel || !routeGeoJSON) return;

  const routes = new Map();
  routeGeoJSON.features.forEach(f => {
    const p = f.properties;
    const routeId = p.id || p.ruta;
    if (!routes.has(routeId)) routes.set(routeId, f);
  });

  sel.innerHTML = '<option value="all">— Todas las rutas —</option>' +
    Array.from(routes, ([routeId, feature]) => {
      const p = feature.properties;
      const routeName = p.nombre || p.name || '';
      const displayText = routeName && !routeName.startsWith(routeId)
        ? `${routeId} · ${routeName}`
        : routeName || routeId;
      return `<option value="${routeId}">${displayText}</option>`;
    }).join('');

  Object.assign(sel.style, {
    background: 'rgba(10, 20, 40, 0.95)',
    color: '#c8d8ee',
    border: '1px solid rgba(26, 133, 212, 0.4)',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '12px',
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    outline: 'none',
    width: '100%',
    appearance: 'none',
    WebkitAppearance: 'none'
  });

  sel.onchange = () => {
    const val = sel.value;
    if (val === 'all') {
      semertazMap.flyTo([AZOGUES_CENTER[1], AZOGUES_CENTER[0]], MAP_ZOOM, { duration: 1.5 });
    } else {
      focusRoute(val);
    }
  };
}

// ============================================================
// CALIBRADOR VISUAL DE OFFSET — Herramienta de alineación
// Permite ajustar el desplazamiento de rutas en tiempo real
// sin modificar el archivo GeoJSON
// ============================================================
function _buildOffsetCalibrator() {
  const existingPanel = document.getElementById('offset-calibrator');
  if (existingPanel) existingPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'offset-calibrator';
  panel.style.cssText = `
    position:absolute; bottom:80px; right:16px; z-index:9999;
    background:rgba(10,20,40,0.96); border:1px solid rgba(26,133,212,0.5);
    border-radius:12px; padding:14px; font-family:Inter,sans-serif;
    color:#c8d8ee; font-size:12px; min-width:200px;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);
  `;
  const step = 0.0001; // Paso de ajuste: ~10 metros
  let lngOff = Number.isFinite(window._calLng) ? window._calLng : ROUTE_OFFSET_LNG;
  let latOff = Number.isFinite(window._calLat) ? window._calLat : ROUTE_OFFSET_LAT;

  function updateDisplay() {
    document.getElementById('cal-lng-val').textContent = lngOff.toFixed(5);
    document.getElementById('cal-lat-val').textContent = latOff.toFixed(5);
  }

  async function applyAndReload(dLng, dLat) {
    lngOff = parseFloat((lngOff + dLng).toFixed(5));
    latOff = parseFloat((latOff + dLat).toFixed(5));
    updateDisplay();

    // Recalcular offset global temporalmente
    window._calLng = lngOff;
    window._calLat = latOff;

    // Limpiar capas de rutas y recargar con nuevo offset
    Object.values(routeLayers).forEach(lg => { if (lg.clearLayers) lg.clearLayers(); });
    routeLayers = {};
    if (routeGeoJSON) {
      const raw = JSON.parse(JSON.stringify(routeGeoJSON._raw || routeGeoJSON));
      const shifted = {
        ...raw,
        features: raw.features.map(f => ({
          ...f,
          geometry: {
            ...f.geometry,
            coordinates: _shiftCoords(f.geometry.coordinates, lngOff, latOff)
          }
        }))
      };
      routeGeoJSON = shifted;
      await loadRoutesLayer();
    }
  }

  panel.innerHTML = `
    <div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;
                color:#1a85d4;margin-bottom:10px;border-bottom:1px solid rgba(26,133,212,0.2);padding-bottom:6px;">
      🧭 Calibrador de Rutas
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;text-align:center;margin-bottom:10px;">
      <div></div>
      <button id="cal-n" style="padding:8px;background:rgba(26,133,212,0.2);border:1px solid rgba(26,133,212,0.4);
        border-radius:6px;color:#fff;cursor:pointer;font-size:16px;">↑</button>
      <div></div>
      <button id="cal-w" style="padding:8px;background:rgba(26,133,212,0.2);border:1px solid rgba(26,133,212,0.4);
        border-radius:6px;color:#fff;cursor:pointer;font-size:16px;">←</button>
      <button style="padding:8px;background:rgba(26,133,212,0.05);border:1px solid rgba(26,133,212,0.2);
        border-radius:6px;color:#475569;font-size:10px;">●</button>
      <button id="cal-e" style="padding:8px;background:rgba(26,133,212,0.2);border:1px solid rgba(26,133,212,0.4);
        border-radius:6px;color:#fff;cursor:pointer;font-size:16px;">→</button>
      <div></div>
      <button id="cal-s" style="padding:8px;background:rgba(26,133,212,0.2);border:1px solid rgba(26,133,212,0.4);
        border-radius:6px;color:#fff;cursor:pointer;font-size:16px;">↓</button>
      <div></div>
    </div>
    <div style="background:rgba(0,0,0,0.3);border-radius:6px;padding:8px;font-size:11px;margin-bottom:8px;">
      <div>LNG: <span id="cal-lng-val" style="color:#fbbf24;font-weight:700;">${lngOff.toFixed(5)}</span></div>
      <div>LAT: <span id="cal-lat-val" style="color:#fbbf24;font-weight:700;">${latOff.toFixed(5)}</span></div>
    </div>
    <div style="font-size:10px;color:rgba(255,255,255,0.4);text-align:center;">
      Cada clic ≈ 10 metros
    </div>
  `;
  const mapElement = document.getElementById('semertaz-map');
  mapElement.parentElement.style.position = 'relative';
  mapElement.parentElement.appendChild(panel);
  document.getElementById('cal-n').onclick = () => applyAndReload(0, +step);
  document.getElementById('cal-s').onclick = () => applyAndReload(0, -step);
  document.getElementById('cal-e').onclick = () => applyAndReload(+step, 0);
  document.getElementById('cal-w').onclick = () => applyAndReload(-step, 0);
}

function _shiftCoords(coords, dLng, dLat) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === 'number') return [coords[0] + dLng, coords[1] + dLat];
  return coords.map(c => _shiftCoords(c, dLng, dLat));
}


async function loadTramosLayer() {
  if (tramosLayer) return; // Ya est cargado y cacheado
  try {

    const resp = await fetch('/frontend/assets/semertaz_tramos.geojson');
    const rawGeoJSON = await resp.json();
    tramoGeoJSON = applyCoordinateOffset(rawGeoJSON);

    tramosLayer = L.geoJSON(tramoGeoJSON, {
      style: (feature) => {
        const routeId = feature.properties.route_id;
        const color = feature.properties.stroke || '#0284c7'; // Hereda color
        return {
          color: color,
          weight: 4,
          opacity: 0.8,
          dashArray: '10, 10'
        };
      },
      onEachFeature: (feature, layer) => {
        const tId = feature.properties.id;
        const desc = feature.properties.description || feature.properties.calle || '';
        const rId = feature.properties.route_id || '?';
        layer.bindTooltip(`<b>Tramo ${tId} (Ruta ${rId})</b><br>${desc}`, { className: 'radar-tooltip', sticky: true });
      }
    });

  } catch (err) {
    console.error('Error al cargar capa de tramos:', err);
  }
}
