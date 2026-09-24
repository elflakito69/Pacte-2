// Configuración de API
const apiHost = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
  ? '127.0.0.1'
  : window.location.hostname;
const apiProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
const API_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
  (!window.location.port || window.location.port === '5000')
  ? window.location.origin
  : `${apiProtocol}://${apiHost}:5000`;
const API_URL = `${API_BASE}/api`;
let authToken = null;
let currentUser = null;
let controllerMonitoringIntervalId = null;
let gpsWatchId = null;
let dashboardRefreshIntervalId = null;
let monitoringControllersSnapshot = [];
let selectedAssignRouteId = null;
let offZoneAlertsIntervalId = null;
let currentRoleFilter = 'all';
let currentEditingTicket = null;
let activePauseTimeoutId = null;
let usersCurrentPage = 1;
let usersTotalPages = 1;
let routesCurrentPage = 1;
let routesTotalPages = 1;
let selectedEditRouteId = null;

// Función para mostrar notificaciones
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  // Animación de entrada
  setTimeout(() => toast.classList.add('show'), 10);

  // Auto-remover después de 3 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 3000);
}

// Función para mostrar/ocultar loading
function setLoading(button, loading) {
  if (loading) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Cargando...';
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || 'Crear Usuario';
  }
}

// Funciones de permisos
function hasPermission(permission) {
  if (!currentUser) return false;

  const role = currentUser.role;

  switch (permission) {
    case 'admin':
      return role === 'admin';
    case 'supervisor':
      return role === 'admin' || role === 'supervisor';
    case 'user':
      return role === 'admin' || role === 'supervisor' || role === 'user';
    case 'manage_users':
      return role === 'admin';
    case 'manage_routes':
      return role === 'admin';
    case 'assign_routes':
      return role === 'admin' || role === 'supervisor';
    case 'manage_tickets':
      return role === 'admin' || role === 'supervisor';
    case 'view_all':
      return role === 'admin' || role === 'supervisor';
    default:
      return false;
  }
}

function getRoleDisplayName(role) {
  switch (role) {
    case 'admin': return 'Administrador';
    case 'supervisor': return 'Supervisor';
    case 'user': return 'Controlador';
    default: return 'Usuario';
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('es-EC', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function translateStatus(status) {
  const map = {
    pending: 'En revisión',
    paid: 'Revisado',
    disputed: 'En disputa',
    active: 'Activo',
    inactive: 'Inactivo',
    authorized: 'Autorizada',
    rejected: 'Rechazada',
    off_zone: 'Fuera de Zona',
    unread: 'No leída',
    read: 'Leída'
  };
  return map[status] || status;
}

function getTicketPhotoUrl(ticketId) {
  return `${API_URL}/tickets/${ticketId}/photo?token=${encodeURIComponent(authToken)}`;
}

// Verificar autenticación
document.addEventListener('DOMContentLoaded', async () => {
  authToken = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');

  if (!authToken || !userStr) {
    window.location.href = '/frontend/auth/login.html';
    return;
  }

  currentUser = JSON.parse(userStr);
  await initializeApp();
});

async function initializeApp() {
  await refreshCurrentUser();  // Actualiza currentUser con datos FRESCOS del servidor (incl. current_route_id)
  setupLogout();
  setupSearch();
  loadDashboard();
  setupButtons();
  applyRoleUI();             // <-- llama showSection('my-route') que hace visible el div del mapa
  if (currentUser && currentUser.role === 'user') {
    startControllerGPSTracking();
  }
  applyControllerTicketsUI();
  bindMobileTicketForm();
  updateUserInfo();

  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor' || currentUser.role === 'user')) {
    await ensureRoutesLoaded();
  }

  if (currentUser && currentUser.role === 'user') {
    // Pequeño delay para asegurar que el DOM esté completamente renderizado
    // antes de que Leaflet intente calcular las dimensiones del mapa
    setTimeout(() => loadMyRoute(), 300);
    startControllerMonitoring();
    checkMyAlerts();
    if (!offZoneAlertsIntervalId) {
      offZoneAlertsIntervalId = window.setInterval(checkMyAlerts, 20000);
    }
  }
}

function updateUserInfo() {
  if (!currentUser) return;
  const avatarEl = document.getElementById('sidebarAvatar') || document.getElementById('topbar-avatar');
  const nameEl = document.getElementById('sidebarUserName') || document.getElementById('topbar-username');
  const roleEl = document.getElementById('sidebarUserRole');

  if (avatarEl && currentUser.username) {
    avatarEl.textContent = currentUser.username.substring(0, 2).toUpperCase();
  }
  if (nameEl && currentUser.username) {
    nameEl.textContent = currentUser.username;
  }
  if (roleEl && currentUser.role) {
    const roles = { 'admin': 'Administrador', 'supervisor': 'Supervisor', 'user': 'Controlador' };
    roleEl.textContent = roles[currentUser.role] || currentUser.role;
  }
}

async function refreshCurrentUser() {
  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/frontend/auth/login.html';
      }
      return currentUser;
    }

    currentUser = await response.json();
    localStorage.setItem('user', JSON.stringify(currentUser));
    return currentUser;
  } catch (error) {
    console.error('Error refrescando usuario actual:', error);
    return currentUser;
  }
}

async function ensureRoutesLoaded() {
  if (Array.isArray(window.routes) && window.routes.length > 0) {
    return window.routes;
  }

  try {
    const response = await fetch(`${API_URL}/routes?per_page=100`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    window.routes = data.routes;
    return window.routes;
  } catch (error) {
    console.error('Error cargando catálogo de rutas:', error);
    window.routes = [];
    return window.routes;
  }
}

function applyRoleUI() {
  if (!currentUser) return;
  const role = currentUser.role;
  const sidebarMenu = document.getElementById('sidebar-menu');
  if (!sidebarMenu) return;
  let menuHTML = '';
  
  if (role === 'admin') {
    document.body.classList.add('role-' + role);
    menuHTML = `
      <div class="nav-category">PRINCIPAL</div>
      <a href="#" class="nav-item active" data-section="dashboard">Dashboard</a>
      <a href="#" class="nav-item" data-section="monitor">Radar de Monitoreo</a>
      <div class="nav-category">GESTIÓN DEL SISTEMA</div>
      <a href="#" class="nav-item" data-section="routes">Rutas</a>
      <a href="#" class="nav-item" data-section="tramos">Tramos de Apoyo</a>
      <a href="#" class="nav-item" data-section="users">Usuarios</a>
      <div class="nav-category">CONTROL OPERATIVO</div>
      <a href="#" class="nav-item" data-section="tickets">Historial de Multas</a>
      <a href="#" class="nav-item" data-section="pauses">Solicitudes de Pausas</a>
    `;
  } else if (role === 'supervisor') {
    document.body.classList.add('role-' + role);
    menuHTML = `
      <div class="nav-category">CENTRO DE COMANDO</div>
      <a href="#" class="nav-item active" data-section="dashboard">Dashboard</a>
      <a href="#" class="nav-item" data-section="monitor">Radar de Monitoreo</a>
      <div class="nav-category">GESTIÓN DEL SISTEMA</div>
      <a href="#" class="nav-item" data-section="routes">Rutas</a>
      <a href="#" class="nav-item" data-section="tramos">Tramos de Apoyo</a>
      <div class="nav-category">SUPERVISIÓN</div>
      <a href="#" class="nav-item" data-section="tickets">Revisión de Multas</a>
      <a href="#" class="nav-item" data-section="pauses">Aprobación de Pausas</a>
    `;
  } else if (role === 'user') {
    document.body.classList.add('role-user');
    menuHTML = `
      <div class="nav-category">OPERACIONES EN CALLE</div>
      <a href="#" class="nav-item active" data-section="my-route">Mi Ruta Asignada</a>
      <a href="#" class="nav-item" data-section="mobile-tickets">Registrar Multa</a>
      <a href="#" class="nav-item" data-section="mobile-pauses">Solicitar Pausa</a>
    `;
  }
  
  sidebarMenu.innerHTML = menuHTML;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      showSection(item.dataset.section);
    });
  });
  setupRoleWorkspaces(role);
}

function applyControllerTicketsUI() {
  if (!currentUser || currentUser.role !== 'user') return;

  const ticketsTable = document.getElementById('ticket-table-container');
  const subtitle = document.getElementById('tickets-subtitle');
  const btnShowTicketForm = document.getElementById('btn-show-ticket-form');
  const btnCancelTicketForm = document.getElementById('btn-cancel-ticket-form');
  const filterBtn = document.querySelector('.btn-outline');
  const downloadBtn = Array.from(document.querySelectorAll('.btn-primary')).find(
    btn => btn.textContent.includes('Descargar')
  );

  if (ticketsTable) ticketsTable.style.display = 'none';
  if (subtitle) subtitle.style.display = 'none';
  if (btnShowTicketForm) btnShowTicketForm.style.display = 'none';
  if (btnCancelTicketForm) btnCancelTicketForm.style.display = 'none';
  if (filterBtn) filterBtn.style.display = 'none';
  if (downloadBtn) downloadBtn.style.display = 'none';

  showTicketForm();
}

function bindMobileTicketForm() {
  const mobileTicketForm = document.getElementById('mobile-ticket-form');
  if (mobileTicketForm) {
    mobileTicketForm.onsubmit = handleMobileTicketSubmit;
  }
}

function startControllerGPSTracking() {
  if (!currentUser || currentUser.role !== 'user') return;
  if (!currentUser.current_route_id) return;
  if (!navigator.geolocation) return;

  sendControllerPosition();

  if (gpsWatchId) clearInterval(gpsWatchId);
  gpsWatchId = window.setInterval(sendControllerPosition, 30000);
}

function sendControllerPosition(forceStatus = 'active') {
  if (!currentUser || currentUser.role !== 'user') return;
  if (!currentUser.current_route_id) return;
  if (!navigator.geolocation) {
    showToast('Geolocalización no soportada', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const payload = {
          user_id: currentUser.id,
          route_id: currentUser.current_route_id,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          status: forceStatus
        };

        const response = await fetch(`${API_URL}/monitoring`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const monitoringStatus = document.getElementById('my-route-gps-status');
          if (monitoringStatus) {
            monitoringStatus.textContent = forceStatus === 'off_zone'
              ? 'Se reportó un desvío de ruta.'
              : `Último envío GPS: ${new Date().toLocaleTimeString('es-ES')}`;
          }
        }
      } catch (error) {
        console.error('Error GPS:', error);
      }
    },
    (error) => {
      console.error('Error GPS:', error);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

function showSection(sectionId) {
  const views = document.querySelectorAll('.view');
  const topbarTitle = document.getElementById('topbar-title');

  views.forEach((view) => {
    view.classList.toggle('active', view.id === sectionId);
  });

  const activeNav = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (activeNav && topbarTitle) {
    const cleanLabel = activeNav.textContent.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u26FF]/gu, '').trim();
    topbarTitle.textContent = cleanLabel;
  }

  if (window.innerWidth <= 960) {
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl && sidebarEl.classList.contains('sidebar-open')) {
      toggleSidebar();
    }
  }

  if (sectionId === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
  if (sectionId === 'monitor') {
    if (typeof loadMonitoring === 'function') loadMonitoring();
    setTimeout(() => {
      if (typeof initRadarMap === 'function') initRadarMap();
    }, 150);
  }
  if (sectionId === 'routes' && typeof loadRoutes === 'function') loadRoutes();
  
  if (sectionId === 'mobile-tickets') {
    showTicketForm();
    initMobileTicketExtras();
  }
  
  if (sectionId === 'tickets' && typeof loadTickets === 'function') {
    loadTickets();
  }
  
  if (sectionId === 'tramos' && typeof filterTramosTable === 'function') filterTramosTable();
  if (sectionId === 'users' && currentUser && currentUser.role === 'admin' && typeof loadUsers === 'function') loadUsers();
  if (sectionId === 'pauses' && typeof loadPauses === 'function') loadPauses();
  if (sectionId === 'my-route' && typeof loadMyRoute === 'function') loadMyRoute();

  updateDashboardLiveIndicator(sectionId);
}

function setupRoleWorkspaces(role) {
  if (role === 'user') {
    showSection('my-route');
  } else {
    showSection('dashboard');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('sidebar-open');
}

// Configurar logout
function setupLogout() {
  const logoutBtn = document.querySelector('.logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/frontend/auth/login.html';
    });
  }
}

// Configurar búsqueda global
function setupSearch() {
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const activeView = document.querySelector('.view.active');
      if (!activeView) return;

      const rows = activeView.querySelectorAll('tbody tr');
      rows.forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(term) ? '' : 'none';
      });
    });
  }
}

// Configurar botones principales
function setupButtons() {
  // Botón "Nueva Ruta" - Solo para admin y supervisor
  const newRouteBtn = document.querySelector('[class*="btn-primary"]');
  if (newRouteBtn && newRouteBtn.textContent.includes('Nueva Ruta')) {
    if (hasPermission('manage_routes')) {
      newRouteBtn.addEventListener('click', () => {
        showNewRouteModal();
      });
      newRouteBtn.style.display = 'inline-flex';
    } else {
      newRouteBtn.style.display = 'none';
    }
  }

  // Botón "Nuevo Usuario" - Solo para admin
  const newUserBtn = Array.from(document.querySelectorAll('.btn-primary')).find(
    btn => btn.textContent.includes('Nuevo Usuario')
  );
  if (newUserBtn) {
    if (hasPermission('manage_users')) {
      newUserBtn.addEventListener('click', () => {
        showNewUserModal();
      });
      newUserBtn.style.display = 'inline-flex';
    } else {
      newUserBtn.style.display = 'none';
    }
  }

  // Botón "Filtrar" en multas
  const filterBtn = document.querySelector('.btn-outline');
  if (filterBtn && filterBtn.textContent.includes('Filtrar')) {
    if (currentUser && currentUser.role === 'user') {
      filterBtn.style.display = 'none';
    } else {
      filterBtn.addEventListener('click', () => {
        showFilterModal();
      });
    }
  }

  // Botón "Descargar" en multas - Para admin y supervisor
  const downloadBtn = Array.from(document.querySelectorAll('.btn-primary')).find(
    btn => btn.textContent.includes('Descargar')
  );
  if (downloadBtn) {
    if (hasPermission('manage_tickets')) {
      downloadBtn.addEventListener('click', () => {
        downloadTicketsPDF();
      });
      downloadBtn.style.display = 'inline-flex';
    } else {
      downloadBtn.style.display = 'none';
    }
  }

  // Formulario nuevo usuario - Solo para admin
  const newUserForm = document.getElementById('new-user-form');
  if (newUserForm) {
    if (hasPermission('manage_users')) {
      if (!newUserForm.dataset.boundSubmitHandler) {
        newUserForm.addEventListener('submit', handleNewUserSubmit);
        newUserForm.dataset.boundSubmitHandler = 'true';
      }
    } else {
      // Ocultar el modal completamente si no tiene permisos
      const userModal = document.getElementById('new-user-modal');
      if (userModal) userModal.style.display = 'none';
    }
  }

  // Cerrar modales
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-close') || e.target.classList.contains('modal')) {
      closeUserModal();
      closeFilterModal();
      closeRouteModal();
    }
  });
}

// ============= DASHBOARD =============

function downloadTicketsPDF() {
  // Obtener filtros actuales (si hay)
  const filters = {}; // Por ahora vacío, se puede mejorar para usar filtros aplicados

  let url = `${API_URL}/tickets/pdf`;
  const params = new URLSearchParams();

  if (filters.date_from) params.append('date_from', filters.date_from);
  if (filters.date_to) params.append('date_to', filters.date_to);
  if (filters.controller) params.append('controller', filters.controller);
  if (filters.zone) params.append('zone', filters.zone);
  if (filters.status) params.append('status', filters.status);

  if (params.toString()) url += '?' + params.toString();

  // Descargar con fetch
  fetch(url, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  })
    .then(response => {
      if (!response.ok) throw new Error('Error en la descarga');
      return response.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'multas.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    })
    .catch(error => {
      console.error('Error descargando PDF:', error);
      showToast('Error al descargar el PDF: ' + error.message, 'error');
    });
}

async function loadDashboard() {
  try {
    await Promise.all([
      loadDashboardStats(),
      loadTicketsByZone(),
      loadRecentActivity()
    ]);

    if (!dashboardRefreshIntervalId) {
      dashboardRefreshIntervalId = window.setInterval(() => {
        loadDashboard();
      }, 30000);
    }

    const activeNav = document.querySelector('.nav-item.active');
    const activeSection = activeNav ? activeNav.dataset.section : 'dashboard';
    updateDashboardLiveIndicator(activeSection);
  } catch (error) {
    console.error('Error cargando dashboard:', error);
  }
}

async function loadDashboardStats() {
  try {
    const response = await fetch(`${API_URL}/dashboard/stats`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    const activeControllers = Number(data.active_controllers || 0);
    const offZone = Number(data.off_zone || 0);
    const offZoneUsers = (data && data.off_zone_users && data.off_zone_users.constructor === Array) ? data.off_zone_users : [];
    const totalTickets = Number(data.total_tickets || 0);
    const activePauses = Number(data.active_pauses || 0);

    const cards = document.querySelectorAll('.summary-card .summary-number');
    if (cards[0]) cards[0].textContent = activeControllers;
    if (cards[1]) cards[1].textContent = offZone;
    if (cards[2]) cards[2].textContent = totalTickets;
    if (cards[3]) cards[3].textContent = activePauses;

    if (cards[1]) {
      let usersEl = document.getElementById('off-zone-users');
      if (!usersEl) {
        usersEl = document.createElement('div');
        usersEl.id = 'off-zone-users';
        usersEl.className = 'summary-sub warning-text';
        cards[1].insertAdjacentElement('afterend', usersEl);
      }
      usersEl.textContent = offZoneUsers.length > 0
        ? offZoneUsers.join(', ')
        : 'Ningún controlador fuera de zona';
    }
  } catch (error) {
    console.error('Error cargando estadísticas:', error);
  }
}

async function loadTicketsByZone() {
  try {
    const response = await fetch(`${API_URL}/dashboard/tickets-by-zone`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    renderTicketsByZone(Array.isArray(data.items) ? data.items : []);
  } catch (error) {
    console.error('Error cargando multas por zona:', error);
    renderTicketsByZone([]);
  }
}

function renderTicketsByZone(items) {
  const container = document.getElementById('tickets-by-zone-list');
  if (!container) return;

  if (!items.length) {
     container.innerHTML = '<p class="muted" style="font-size:13px;">Sin multas registradas aún</p>';
    return;
  }

  const maxCount = Math.max(...items.map(item => Number(item.count || 0)), 1);

  container.innerHTML = items.map(item => {
    const count = Number(item.count || 0);
    const width = Math.max(6, Math.round((count / maxCount) * 100));
    return `
      <div class="bar-row">
        <span>${item.route_name || 'Sin ruta'}</span>
        <div class="bar"><div class="bar-fill" style="width:${width}%"></div></div>
        <span class="bar-value">${count}</span>
      </div>
    `;
  }).join('');
}

async function loadRecentActivity() {
  try {
    const response = await fetch(`${API_URL}/dashboard/recent-activity`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    renderRecentActivity(Array.isArray(data.items) ? data.items : []);
  } catch (error) {
    console.error('Error cargando actividad reciente:', error);
    renderRecentActivity([]);
  }
}

function renderRecentActivity(items) {
  const list = document.getElementById('recent-activity-list');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<li><span class="bullet"></span><div><div class="activity-title">Sin actividad reciente</div><div class="activity-sub">Aún no hay eventos registrados</div></div></li>';
    return;
  }

  list.innerHTML = items.map(item => {
    let iconHtml = '<span class="bullet"></span>';
    let gpsBadge = '';

    if (item.type === 'login') {
      iconHtml = '<i class="fa fa-sign-in" style="color: #0057a8; font-size: 15px; margin-top: 2px; flex-shrink: 0;" title="Inicio de sesión"></i>';
      if (item.has_coords || (item.latitude !== null && item.latitude !== undefined && item.latitude !== '')) {
        gpsBadge = ' <span style="display:inline-flex; align-items:center; gap:2px; font-size:11px; font-weight:600; color:#0a7c4e; background:rgba(10,124,78,0.1); padding:1px 6px; border-radius:4px; margin-left:6px;">📍 GPS</span>';
      } else {
        gpsBadge = ' <span style="font-size:11px; color:#8fa3c0; margin-left:6px;">(Sin GPS)</span>';
      }
    } else if (item.type === 'ticket') {
      iconHtml = '<span class="bullet" style="background:#c0392b;"></span>';
    } else if (item.type === 'pause') {
      iconHtml = '<span class="bullet" style="background:#e67e22;"></span>';
    } else if (item.type === 'alert') {
      iconHtml = '<span class="bullet" style="background:#e74c3c;"></span>';
    }

    return `
      <li ${clickAction}>
        ${iconHtml}
        <div>
          <div class="activity-title">${item.description || 'Evento del sistema'}${gpsBadge}</div>
          <div class="activity-sub">${item.user_name || 'Sistema'} · ${(() => { if (!item.timestamp) return 'hace un momento'; const diff = Math.floor((new Date() - new Date(item.timestamp.replace('Z','')+ 'Z')) / 1000); if (diff < 60) return diff + ' seg'; if (diff < 3600) return Math.floor(diff/60) + ' min'; if (diff < 86400) return Math.floor(diff/3600) + ' hrs'; return Math.floor(diff/86400) + ' das'; })()}</div>
        </div>
      </li>
    `;
  }).join('');
}

function updateDashboardLiveIndicator(sectionId = '') {
  const indicator = document.getElementById('dashboard-live-indicator');
  if (!indicator) return;
  indicator.style.display = sectionId === 'dashboard' ? 'inline-block' : 'none';
}

// ============= MONITOREO =============

async function loadMonitoring() {
  try {
    await ensureRoutesLoaded();

    const usersResponse = await fetch(`${API_URL}/users?per_page=100`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!usersResponse.ok) throw new Error('No autorizado');

    const usersData = await usersResponse.json();
    const controllers = (usersData.users || []).filter(user => user.role === 'user');

    const monitoringRecords = await Promise.all(
      controllers.map(async (controller) => {
        try {
          const response = await fetch(`${API_URL}/monitoring?user_id=${controller.id}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
          });

          if (!response.ok) {
            return { controller, monitoring: null };
          }

          const data = await response.json();
          const latest = Array.isArray(data.monitoring) && data.monitoring.length > 0 ? data.monitoring[0] : null;
          return { controller, monitoring: latest };
        } catch (_) {
          return { controller, monitoring: null };
        }
      })
    );

    monitoringControllersSnapshot = monitoringRecords.map(item => {
      const route = (window.routes || []).find(r => Number(r.id) === Number(item.controller.current_route_id));
      const status = item.monitoring ? item.monitoring.status : 'no_data';

      return {
        user_id: item.controller.id,
        user_name: item.controller.full_name || item.controller.username,
        route_name: route ? route.name : 'Sin ruta asignada',
        route_id: route ? route.id : null,
        status
      };
    });

    populateMonitoringFilters();
    applyMonitoringFilters();
      renderMonitoringAlertBanner(monitoringControllersSnapshot);
  } catch (error) {
    console.error('Error cargando monitoreo:', error);
  }
}

function populateMonitoringFilters() {
  const zoneSelect = document.getElementById('filter-zone');
  const stateSelect = document.getElementById('filter-state');
  if (!zoneSelect || !stateSelect) return;

  const currentZoneValue = zoneSelect.value;
  zoneSelect.innerHTML = '<option value="">Todas las zonas</option>' +
    (window.routes || []).map(route => `<option value="${route.id}">${route.name}</option>`).join('');
  zoneSelect.value = currentZoneValue;

  if (!zoneSelect.dataset.boundChange) {
    zoneSelect.addEventListener('change', applyMonitoringFilters);
    zoneSelect.dataset.boundChange = 'true';
  }

  if (!stateSelect.dataset.boundChange) {
    stateSelect.addEventListener('change', applyMonitoringFilters);
    stateSelect.dataset.boundChange = 'true';
  }
}

function applyMonitoringFilters() {
  const zoneValue = (document.getElementById('filter-zone') ? document.getElementById('filter-zone').value : null) || '';
  const stateValue = (document.getElementById('filter-state') ? document.getElementById('filter-state').value : null) || '';

  const filtered = monitoringControllersSnapshot.filter(item => {
    const matchesZone = !zoneValue || Number(item.route_id) === Number(zoneValue);
    const matchesState = !stateValue || item.status === stateValue;
    return matchesZone && matchesState;
  });

  renderMonitoringList(filtered);
    renderMonitoringAlertBanner(monitoringControllersSnapshot);
}

function renderMonitoringList(monitoring) {
  const listContainer = document.querySelector('.controller-list');
  if (!listContainer) return;

  if (!monitoring.length) {
    listContainer.innerHTML = '<li><div><div class="controller-name">Sin resultados</div><div class="controller-zone">No hay controladores para el filtro actual</div></div><span class="badge"> Sin datos</span></li>';
    return;
  }

  listContainer.innerHTML = monitoring.map(m => {
    const clickAction = `onclick="openMonitoringHistory(${m.user_id}, '${m.user_name}')" style="cursor:pointer; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'"`;
    
    let statusLabel = ' Sin datos';
    let statusClass = 'info';
    
    const isSinRuta = !m.route_id || String(m.route_id) === 'null' || String(m.route_id) === '0' || String(m.route_name).toLowerCase().includes('sin ruta');

    if (m.status === 'off_zone') {
      statusLabel = ' Fuera de Zona';
      statusClass = 'danger';
    } else if (m.status === 'active') {
      if (isSinRuta) {
        statusLabel = ' Sin ruta';
        statusClass = 'info';
      } else {
        statusLabel = ' En Ruta';
        statusClass = 'success';
      }
    } else {
      // no_data
      if (isSinRuta) {
        statusLabel = ' Sin datos';
        statusClass = 'info';
      }
    }

    return `
      <li ${clickAction}>
        <div>
          <div class="controller-name">${m.user_name}</div>
          <div class="controller-zone">${m.route_name}</div>
        </div>
        <span class="badge badge-${statusClass}">${statusLabel}</span>
      </li>
    `;
  }).join('');
}

function renderMonitoringAlertBanner(monitoring) {
  const side = document.querySelector('.monitor-side');
  if (!side) return;

  let banner = document.getElementById('off-zone-banner');
  const offZone = monitoring.find(item => item.status === 'off_zone');

  if (!offZone) {
    if (banner) banner.remove();
    return;
  }

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'off-zone-banner';
    banner.style.cssText = 'background:#dc2626;color:#fff;padding:14px 16px;border-radius:12px;font-weight:700;margin-bottom:14px;box-shadow:0 8px 20px rgba(220,38,38,.18);';
    side.insertBefore(banner, side.firstChild);
  }

  banner.textContent = `⚠️ ATENCIÓN: ${offZone.user_name} está fuera de su zona asignada`;
}

// ============= RUTAS =============

async function loadRoutes(page = 1) {
  try {
    const routesResponse = await fetch(`${API_URL}/routes?page=${page}&per_page=6`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!routesResponse.ok) throw new Error('No se pudieron cargar las rutas');

    const routesData = await routesResponse.json();
    const routes = routesData.routes || [];
    window.routes = routes;
    routesCurrentPage = Number(routesData.current_page || page);
    routesTotalPages = Number(routesData.pages || 1);
    updateRoutesPagination();

    let users = Array.isArray(window.users) ? window.users : [];
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor')) {
      const usersResponse = await fetch(`${API_URL}/users?per_page=100`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        users = usersData.users || [];
        window.users = users;
      }
    }

    renderRoutesTable(routes, users);
  } catch (error) {
    console.error('Error cargando rutas:', error);
  }
}

function updateRoutesPagination() {
  const pageLabel = document.getElementById('routes-page-label');
  const previousButton = document.getElementById('routes-page-previous');
  const nextButton = document.getElementById('routes-page-next');

  if (pageLabel) pageLabel.textContent = `Página ${routesCurrentPage} de ${routesTotalPages}`;
  if (previousButton) previousButton.disabled = routesCurrentPage <= 1;
  if (nextButton) nextButton.disabled = routesCurrentPage >= routesTotalPages;
}

function changeRoutesPage(page) {
  if (page < 1 || page > routesTotalPages || page === routesCurrentPage) return;
  loadRoutes(page);
}

function getOfficialRouteName(route) {
  const rawName = (route && route.name) ? route.name.trim() : '';
  const routeNumber = (route && route.id) ? `R${route.id}` : 'R1';

  if (!rawName) {
    return `${routeNumber} - Sector Principal`;
  }

  if (/^r\d+\s*-\s*/i.test(rawName)) {
    return rawName;
  }

  if (/mercado/i.test(rawName)) {
    return `${routeNumber} - Sector Mercado`;
  }

  if (/24\s+de\s+mayo/i.test(rawName)) {
    return `${routeNumber} - Av. 24 de Mayo`;
  }

  if (/centro|histórico|histórico/i.test(rawName)) {
    return `${routeNumber} - Centro Histórico`;
  }

  if (/^(ruta|zona)\b/i.test(rawName) || /norte|sur|este|oeste|norte\/sur|sur\/norte/i.test(rawName)) {
    return `${routeNumber} - Sector ${rawName.replace(/^(ruta|zona)\s*/i, '').trim() || 'Principal'}`;
  }

  return rawName;
}

function renderRoutesTable(routes, users = []) {
  const tbody = document.querySelector('#routes tbody');
  if (!tbody) return;

  const canManageRoutes = hasPermission('manage_routes');
  const canAssignRoutes = hasPermission('assign_routes');
  const controllers = users.filter(user => user.role === 'user');

  tbody.innerHTML = routes.map(route => `
    <tr>
      <td data-label="Nombre">${getOfficialRouteName(route)}</td>
      <td data-label="Trayecto">${route.start_point} → ${route.end_point}</td>
      <td data-label="Distancia">${route.distance_km} km</td>
      <td data-label="Estado">
        ${route.is_active === false 
          ? `<span class="badge badge-error" style="background:#dc2626;color:white;">Desactivado</span>` 
          : `<span class="badge badge-${route.status === 'active' ? 'success' : 'warning'}">
              ${translateStatus(route.status)}
             </span>`
        }
      </td>
      <td data-label="Circulando">${Number(route.minutos_circulando || 0)} min</td>
      <td data-label="Fuera de Ruta">${Number(route.minutos_fuera || 0)} min</td>
      <td data-label="Controlador Asignado">${renderAssignedControllerForRoute(route, controllers)}</td>
      ${canAssignRoutes || canManageRoutes ? `
      <td class="actions-cell" data-label="Acciones">
        ${canAssignRoutes ? `<button class="btn-icon" onclick="openAssignControllerModal(${route.id})" title="Asignar Controlador">👤</button>` : ''}
        ${(canManageRoutes || currentUser.role === 'supervisor') ? `<button class="btn-icon" onclick="editRouteModal(${route.id})" title="Editar ruta">✏️</button>` : ''}
        ${canManageRoutes ? `<button class="btn-icon" onclick="deleteRoute(${route.id})">🗑️</button>` : ''}
      </td>
      ` : '<td></td>'}
    </tr>
  `).join('');
}

function renderAssignedControllerForRoute(route, controllers) {
  const assigned = controllers.find(user =>
    Number(user.current_route_id) === Number(route.id) ||
    Number(user.current_route_id_2) === Number(route.id)
  );
  if (!assigned) {
    if (route.assigned_user_name) return route.assigned_user_name;
    return '<span class="badge badge-success">Disponible</span>';
  }
  const name = assigned.full_name || assigned.username;
  if (Array.isArray(assigned.assigned_tramos) && assigned.assigned_tramos.length > 0) {
    return `${name} (Tramos: ${assigned.assigned_tramos.join(', ')})`;
  }
  return name;
}

function editRouteModal(routeId) {
  if (!hasPermission('manage_routes') && currentUser.role !== 'supervisor') {
    showToast('No tienes permisos para editar rutas', 'error');
    return;
  }

  const routes = Array.isArray(window.routes) ? window.routes : [];
  const users = Array.isArray(window.users) ? window.users.filter(user => user.role === 'user') : [];
  const route = routes.find(item => Number(item.id) === Number(routeId));
  const modal = document.getElementById('edit-route-modal');
  if (!route || !modal) return;

  selectedEditRouteId = route.id;
  document.getElementById('edit-route-name').value = route.name || '';
  document.getElementById('edit-route-active').checked = route.is_active !== false;

  const primarySelect = document.getElementById('edit-route-controller-1');
  const secondarySelect = document.getElementById('edit-route-controller-2');
  const options = '<option value="">Sin controlador</option>' + users.map(user => `
    <option value="${user.id}">${user.full_name || user.username}</option>
  `).join('');
  primarySelect.innerHTML = options;
  secondarySelect.innerHTML = options;

  const primary = users.find(user => Number(user.current_route_id) === Number(route.id));
  const secondary = users.find(user => Number(user.current_route_id_2) === Number(route.id));
  if (primary) primarySelect.value = primary.id;
  if (secondary) secondarySelect.value = secondary.id;

  modal.style.display = 'flex';
}

function closeEditRouteModal() {
  const modal = document.getElementById('edit-route-modal');
  if (modal) modal.style.display = 'none';
  selectedEditRouteId = null;
}

async function saveRouteEdits(event) {
  if (event) event.preventDefault();
  if (!selectedEditRouteId) return;

  const primaryId = Number(document.getElementById('edit-route-controller-1').value) || null;
  const secondaryId = Number(document.getElementById('edit-route-controller-2').value) || null;
  try {
    const routeResponse = await fetch(`${API_URL}/routes/${selectedEditRouteId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: document.getElementById('edit-route-name').value,
        is_active: document.getElementById('edit-route-active').checked
      })
    });
    if (!routeResponse.ok) throw new Error('No se pudo actualizar la ruta');

    const primaryUser = users.find(user => Number(user.id) === primaryId);
    const secondaryUser = users.find(user => Number(user.id) === secondaryId);
    const assignments = [];
    
    // 1. Limpiar a los usuarios que tenian esta ruta asignada pero ya no
    const prevAssigned = users.filter(u => u.current_route_id === selectedEditRouteId || u.current_route_id_2 === selectedEditRouteId);
    for (const u of prevAssigned) {
      if (u.id !== primaryId && u.id !== secondaryId) {
        let new1 = u.current_route_id === selectedEditRouteId ? null : u.current_route_id;
        let new2 = u.current_route_id_2 === selectedEditRouteId ? null : u.current_route_id_2;
        assignments.push(fetch(`${API_URL}/users/${u.id}/route`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ route_id: new1, route_id_2: new2 })
        }));
      }
    }

    // 2. Asignar nuevos (o actualizar los que se quedaron)
    if (primaryId && primaryId === secondaryId) {
      assignments.push(fetch(`${API_URL}/users/${primaryId}/route`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_id: selectedEditRouteId, route_id_2: selectedEditRouteId })
      }));
    } else {
      if (primaryId) {
        let new2 = primaryUser && primaryUser.current_route_id_2 ? primaryUser.current_route_id_2 : null;
        if (new2 === selectedEditRouteId) new2 = null; // evita que tenga la misma en ambos si no fue intencional
        assignments.push(fetch(`${API_URL}/users/${primaryId}/route`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ route_id: selectedEditRouteId, route_id_2: new2 })
        }));
      }
      if (secondaryId) {
        let new1 = secondaryUser && secondaryUser.current_route_id ? secondaryUser.current_route_id : null;
        if (new1 === selectedEditRouteId) new1 = null;
        assignments.push(fetch(`${API_URL}/users/${secondaryId}/route`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ route_id: new1, route_id_2: selectedEditRouteId, tramos: (() => {
          const toggle = document.getElementById('toggle-tramos-apoyo');
          if (toggle && toggle.checked) {
            const checkboxes = document.querySelectorAll('.edit-tramo-checkbox:checked');
            return Array.from(checkboxes).map(cb => parseInt(cb.value));
          }
          return [];
        })() })
        }));
      }
    }
    
    const assignmentResponses = await Promise.all(assignments);
    if (assignmentResponses.some(response => !response.ok)) {
      throw new Error('No se pudo actualizar la asignación de controladores');
    }

    closeEditRouteModal();
    showToast('Ruta actualizada correctamente', 'success');
    await loadRoutes(routesCurrentPage);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function openAssignControllerModal(routeId) {
  const modal = document.getElementById('assign-controller-modal');
  const routeNameInput = document.getElementById('assign-route-name');
  const select = document.getElementById('assign-controller-select');
  if (!modal || !routeNameInput || !select) return;

  const routes = Array.isArray(window.routes) ? window.routes : [];
  const users = Array.isArray(window.users) ? window.users : [];
  const route = routes.find(r => Number(r.id) === Number(routeId));
  if (!route) return;

  const controllers = users.filter(user => user.role === 'user');
  const assigned = controllers.find(user => Number(user.current_route_id) === Number(route.id));

  routeNameInput.value = route.name;
  selectedAssignRouteId = route.id;

  select.innerHTML = '<option value="">Seleccione un controlador</option>' +
    controllers.map(controller => `
      <option value="${controller.id}" ${assigned && assigned.id === controller.id ? 'selected' : ''}>
        ${controller.full_name || controller.username}
      </option>
    `).join('');

  modal.style.display = 'flex';
}

function closeAssignControllerModal() {
  const modal = document.getElementById('assign-controller-modal');
  if (modal) modal.style.display = 'none';
  selectedAssignRouteId = null;
}

async function confirmAssignController(event) {
  event.preventDefault();

  const select = document.getElementById('assign-controller-select');
  if (!select || !selectedAssignRouteId) return;

  const controllerId = Number(select.value);
  if (!controllerId) {
    showToast('Seleccione un controlador', 'error');
    return;
  }

  const assignedController = (Array.isArray(window.users) ? window.users : [])
    .find(user => Number(user.id) === controllerId);

  let tramosSeleccionados = [];
  const toggle = document.getElementById('assign-tramos-toggle');
  if (toggle && toggle.checked) {
    const checkboxes = document.querySelectorAll('.tramo-checkbox:checked');
    tramosSeleccionados = Array.from(checkboxes).map(cb => parseInt(cb.value));
  }

  try {
    const response = await fetch(`${API_URL}/users/${controllerId}/route`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        route_id: selectedAssignRouteId,
        route_id_2: assignedController && assignedController.current_route_id_2
          ? assignedController.current_route_id_2
          : null,
        tramos: tramosSeleccionados
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'No se pudo asignar el controlador');
    }

    showToast('Controlador asignado correctamente', 'success');
    closeAssignControllerModal();
    await loadRoutes();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

let drawMap = null;
let drawnItems = null;

function initDrawRouteMap() {
  const mapDiv = document.getElementById('draw-route-map');
  if (!mapDiv) return;
  if (drawMap) {
    drawMap.remove();
    drawMap = null;
  }
  
  drawMap = L.map('draw-route-map').setView([-2.7397, -78.8486], 14); // Azogues
  L.tileLayer('https://c.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20
  }).addTo(drawMap);

  drawnItems = new L.FeatureGroup();
  drawMap.addLayer(drawnItems);

  const drawControl = new L.Control.Draw({
    draw: {
      polygon: true,
      polyline: true,
      rectangle: false,
      circle: false,
      marker: false,
      circlemarker: false
    },
    edit: {
      featureGroup: drawnItems
    }
  });
  drawMap.addControl(drawControl);

  drawMap.on(L.Draw.Event.CREATED, function (event) {
    const layer = event.layer;
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);
    
    const geojson = layer.toGeoJSON().geometry;
    document.getElementById('route-geometry').value = JSON.stringify(geojson);
    
    let distKm = 0;
    if (geojson.type === 'LineString' && window.turf) {
      distKm = turf.length(layer.toGeoJSON(), {units: 'kilometers'});
    } else if (geojson.type === 'Polygon' && window.turf) {
      // just a rough area or perimiter
      distKm = turf.length(turf.polygonToLine(layer.toGeoJSON()), {units: 'kilometers'});
    }
    const distInput = document.getElementById('distance-km');
    if (distInput) distInput.value = distKm.toFixed(2);
  });
  
  // Fix map size bug in modals
  setTimeout(() => drawMap.invalidateSize(), 300);
}

function showNewRouteModal() {
  const modal = document.getElementById('new-route-modal');
  modal.style.display = 'block';
  document.getElementById('route-geometry').value = '';
  initDrawRouteMap();
}

async function toggleDropdown(routeId) {
  // Close all other dropdowns
  document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
    if (menu.id !== `dropdown-${routeId}`) {
      menu.classList.remove('show');
    }
  });

  // Toggle current dropdown
  const menu = document.getElementById(`dropdown-${routeId}`);
  menu.classList.toggle('show');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
      menu.classList.remove('show');
    });
  }
});

function viewRouteDetails(routeId) {
  const route = window.routes.find(r => r.id === routeId);

  if (!route) {
    alert('Ruta no encontrada');
    return;
  }

  // Populate modal
  document.getElementById('route-details-title').textContent = `Detalles de ${route.name}`;
  document.getElementById('route-details-body').innerHTML = `
    <div class="detail-row">
      <span class="detail-label">Nombre:</span>
      <span class="detail-value">${route.name}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Descripción:</span>
      <span class="detail-value">${route.description || 'Sin descripción'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Punto Inicio:</span>
      <span class="detail-value">${route.start_point}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Punto Fin:</span>
      <span class="detail-value">${route.end_point}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Distancia:</span>
      <span class="detail-value">${route.distance_km} km</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Tiempo Estimado:</span>
      <span class="detail-value">${route.estimated_time} minutos</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Estado:</span>
      <span class="detail-value">${translateStatus(route.status)}</span>
    </div>
  `;

  // Show modal
  document.getElementById('route-details-modal').style.display = 'block';
}

function closeDetailsModal() {
  document.getElementById('route-details-modal').style.display = 'none';
}

function showNewUserModal() {
  const modal = document.getElementById('new-user-modal');
  modal.style.display = 'block';
}

function closeUserModal() {
  const modal = document.getElementById('new-user-modal');
  modal.style.display = 'none';
  document.getElementById('new-user-form').reset();
}

// Manejar envío del formulario de usuario
document.getElementById('new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const userData = {
    username: formData.get('username'),
    email: formData.get('email'),
    full_name: formData.get('full_name'),
    role: formData.get('role'),
    password: formData.get('password')
  };

  try {
    const response = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });

    if (!response.ok) throw new Error('No se pudo crear el usuario');

    alert('Usuario creado exitosamente');
    closeUserModal();
    loadUsers();
  } catch (error) {
    alert('Error: ' + error.message);
  }
});

// Cerrar modal al hacer clic fuera
document.getElementById('new-user-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('new-user-modal')) {
    closeUserModal();
  }
});

function showFilterModal() {
  const modal = document.getElementById('filter-tickets-modal');
  modal.style.display = 'block';
}

function closeFilterModal() {
  const modal = document.getElementById('filter-tickets-modal');
  modal.style.display = 'none';
  document.getElementById('filter-tickets-form').reset();
}

function clearFilters() {
  document.getElementById('filter-tickets-form').reset();
  loadTickets(); // Reload without filters
}

// Manejar envío del formulario de filtro
document.getElementById('filter-tickets-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const filters = {
    date_from: formData.get('date_from'),
    date_to: formData.get('date_to'),
    controller: formData.get('controller'),
    zone: formData.get('zone'),
    status: formData.get('status')
  };

  // Apply filters to loadTickets
  await loadTickets(filters);
  closeFilterModal();
});

// Cerrar modal al hacer clic fuera
document.getElementById('filter-tickets-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('filter-tickets-modal')) {
    closeFilterModal();
  }
});

async function downloadTickets() {
  try {
    const response = await fetch(`${API_URL}/tickets?per_page=1000`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    const tickets = data.tickets;

    // Convert to CSV
    const csvContent = [
      ['Multa', 'Controlador', 'Placa', 'Infracción', 'Fecha/Hora', 'Estado'],
      ...tickets.map(ticket => [
        ticket.id,
        ticket.user_name,
        ticket.plate,
        ticket.violation,
        ticket.date_time,
        ticket.status
      ])
    ].map(row => row.join(',')).join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'multas.csv';
    a.click();
    window.URL.revokeObjectURL(url);

    alert('Archivo descargado: multas.csv');
  } catch (error) {
    alert('Error al descargar: ' + error.message);
  }
}

function closeModal() {
  const modal = document.getElementById('new-route-modal');
  modal.style.display = 'none';
  document.getElementById('new-route-form').reset();
}

// Manejar envío del formulario
document.getElementById('new-route-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  
  const geometryRaw = formData.get('route-geometry');
  if (!geometryRaw) {
    alert('Debe dibujar la ruta en el mapa antes de guardar.');
    return;
  }

  const routeData = {
    name: formData.get('route-name'),
    description: formData.get('route-description') || 'Ruta nueva creada',
    start_point: formData.get('start-point'),
    end_point: formData.get('end-point'),
    distance_km: parseFloat(formData.get('distance-km')),
    estimated_time: 0,
    status: 'active',
    geometry: JSON.parse(geometryRaw)
  };

  try {
    const response = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(routeData)
    });

    if (!response.ok) throw new Error('No se pudo crear la ruta');

    alert('Ruta creada exitosamente');
    closeModal();
    loadRoutes();
  } catch (error) {
    alert('Error: ' + error.message);
  }
});

// Cerrar modal al hacer clic fuera
const routeDetailsModal = document.getElementById('route-details-modal');
if (routeDetailsModal) {
  routeDetailsModal.addEventListener('click', (e) => {
    if (e.target === routeDetailsModal) {
      closeDetailsModal();
    }
  });
}

async function createRoute(routeData) {
  try {
    const response = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(routeData)
    });

    if (!response.ok) throw new Error('No se pudo crear la ruta');

    alert('Ruta creada exitosamente');
    loadRoutes();
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

async function toggleDropdown(routeId) {
  // Close all other dropdowns
  document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
    if (menu.id !== `dropdown-${routeId}`) {
      menu.classList.remove('show');
    }
  });

  // Toggle current dropdown
  const menu = document.getElementById(`dropdown-${routeId}`);
  menu.classList.toggle('show');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
      menu.classList.remove('show');
    });
  }
});

function viewRouteDetails(routeId) {
  const route = window.routes.find(r => r.id === routeId);

  if (!route) {
    alert('Ruta no encontrada');
    return;
  }

  // Populate modal
  document.getElementById('route-details-title').textContent = `Detalles de ${route.name}`;
  document.getElementById('route-details-body').innerHTML = `
    <div class="detail-row">
      <span class="detail-label">Nombre:</span>
      <span class="detail-value">${route.name}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Descripción:</span>
      <span class="detail-value">${route.description || 'Sin descripción'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Punto Inicio:</span>
      <span class="detail-value">${route.start_point}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Punto Fin:</span>
      <span class="detail-value">${route.end_point}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Distancia:</span>
      <span class="detail-value">${route.distance_km} km</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Tiempo Estimado:</span>
      <span class="detail-value">${route.estimated_time} minutos</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Estado:</span>
      <span class="detail-value">${route.status === 'active' ? 'Activa' : 'Inactiva'}</span>
    </div>
  `;

  // Show modal
  document.getElementById('route-details-modal').style.display = 'block';
}

function closeDetailsModal() {
  document.getElementById('route-details-modal').style.display = 'none';
}

function editRoute(routeId) {
  alert('Función de editar próximamente disponible.');
}

// ============= MULTAS =============

async function loadTickets(filters = {}) {
  try {
    let url = `${API_URL}/tickets?per_page=100`;

    // Si el usuario no tiene permisos para ver todas las multas, filtrar solo las suyas
    if (!hasPermission('view_all')) {
      filters.controller = currentUser.id;
    }

    // Add filters to URL
    if (filters.date_from) url += `&date_from=${filters.date_from}`;
    if (filters.date_to) url += `&date_to=${filters.date_to}`;
    if (filters.controller) url += `&controller=${filters.controller}`;
    if (filters.zone) url += `&zone=${filters.zone}`;
    if (filters.status) url += `&status=${filters.status}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    window.tickets = data.tickets || [];
    renderTicketsTable(data.tickets);
  } catch (error) {
    console.error('Error cargando multas:', error);
  }
}

function renderTicketsTable(tickets) {
  const tbody = document.querySelector('#tickets tbody');
  if (!tbody) return;

  const canManageTickets = currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor');

  tbody.innerHTML = tickets.map(ticket => `
    <tr>
      <td data-label="ID">T-${(ticket.id < 100 ? '0' : '') + (ticket.id < 10 ? '0' : '') + ticket.id}</td>
      <td data-label="Controlador">${ticket.user_name}</td>
      <td data-label="Placa">${ticket.license_plate || 'N/A'}</td>
      <td data-label="Infracción">${ticket.violation_type}</td>
      <td data-label="Fecha">${formatDateTime(ticket.timestamp)}</td>
      <td data-label="Estado">
        <div class="ticket-status-wrap">
            ${canManageTickets ? `
              <button type="button" class="badge badge-${ticket.status === 'pending' ? 'warning' : ticket.status === 'paid' ? 'success' : 'info'}" onclick="toggleTicketStatusDropdown(${ticket.id})">
                ${translateStatus(ticket.status)}
              </button>
              <div class="ticket-status-dropdown" id="ticket-status-dropdown-${ticket.id}" style="display:none;">
                <button type="button" onclick="changeTicketStatus(${ticket.id}, 'pending')">En revisión</button>
                <button type="button" onclick="changeTicketStatus(${ticket.id}, 'paid')">Revisado</button>
                <button type="button" onclick="changeTicketStatus(${ticket.id}, 'disputed')">En disputa</button>
              </div>
            ` : `<span class="badge badge-${ticket.status === 'pending' ? 'warning' : ticket.status === 'paid' ? 'success' : 'info'}">${translateStatus(ticket.status)}</span>`}
        </div>
      </td>
      <td class="actions-cell" data-label="Acciones">
        <button class="btn-icon" onclick='viewTicketDetail(${JSON.stringify(ticket)})' title="Ver detalles">&#x1F4CB;</button>
        <!-- ${ticket.photo_path ? `<button class="btn-icon" onclick="downloadTicketFile(${ticket.id})" title="Abrir evidencia">&#x1F4CE;</button>` : ''} -->
        ${canManageTickets ? `
        <!-- <button class="btn-icon" onclick="openEditTicketModal(${ticket.id})">&#x270F;&#xFE0F;</button> -->
        <!-- <button class="btn-icon" onclick="deleteTicket(${ticket.id})">&#x1F5D1;&#xFE0F;</button> -->
        ${ticket.status === 'pending' ? `<button class="btn-icon" onclick="changeTicketStatus(${ticket.id}, 'paid')" title="Aprobar (Marcar como Revisado)" style="color: green; font-weight: bold; font-size: 16px;">&#x2714;&#xFE0F;</button>` : ''}
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function downloadTicketFile(ticketId) {
  const url = `${API_URL}/tickets/${ticketId}/pdf?token=${encodeURIComponent(authToken)}`;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.download = `multa_${ticketId}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function openEditTicketModal(ticketId) {
  const tickets = Array.isArray(window.tickets) ? window.tickets : [];
  const ticket = tickets.find(t => Number(t.id) === Number(ticketId));
  if (!ticket) {
    showToast('Multa no encontrada', 'error');
    return;
  }

  currentEditingTicket = ticket;
  const modal = document.getElementById('edit-ticket-modal');
  const statusSelect = document.getElementById('edit-ticket-status');
  const descriptionInput = document.getElementById('edit-ticket-description');
  if (!modal || !statusSelect || !descriptionInput) return;

  statusSelect.value = ticket.status;
  descriptionInput.value = ticket.description && !['na', 'n/a', ''].includes(String(ticket.description).trim().toLowerCase()) ? ticket.description : '';
  modal.style.display = 'flex';
}

function closeEditTicketModal() {
  const modal = document.getElementById('edit-ticket-modal');
  if (modal) modal.style.display = 'none';
  currentEditingTicket = null;
}

async function saveTicketEdit(event) {
  event.preventDefault();
  if (!currentEditingTicket) return;

  const status = (document.getElementById('edit-ticket-status') ? document.getElementById('edit-ticket-status').value : null);
  const description = (document.getElementById('edit-ticket-description') ? document.getElementById('edit-ticket-description').value : null) || '';

  try {
    const response = await fetch(`${API_URL}/tickets/${currentEditingTicket.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status, description })
    });

    if (!response.ok) throw new Error('No se pudo actualizar la multa');

    showToast('Multa actualizada correctamente', 'success');
    closeEditTicketModal();
    await loadTickets();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function deleteTicket(ticketId) {
  if (!confirm(`¿Estás seguro de eliminar la multa #${ticketId}? Esta acción no se puede deshacer.`)) return;

  try {
    const response = await fetch(`${API_URL}/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No se pudo eliminar la multa');

    showToast('Multa eliminada correctamente', 'success');
    await loadTickets();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function toggleTicketStatusDropdown(ticketId) {
  const dropdown = document.getElementById(`ticket-status-dropdown-${ticketId}`);
  if (!dropdown) return;

  document.querySelectorAll('.ticket-status-dropdown').forEach(el => {
    if (el !== dropdown) el.style.display = 'none';
  });

  dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

async function changeTicketStatus(ticketId, status) {
  try {
    const response = await fetch(`${API_URL}/tickets/${ticketId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    });

    if (!response.ok) throw new Error('No se pudo actualizar el estado');

    showToast('Estado actualizado correctamente', 'success');
    loadTickets();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============= USUARIOS =============

async function loadUsers(page = 1) {
  const canLoadUsers = currentUser && currentUser.role === 'admin';

  if (!canLoadUsers) {
    return;
  }

  try {
    await ensureRoutesLoaded();

    const response = await fetch(`${API_URL}/users?page=${page}&per_page=10`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    window.users = data.users || [];
    usersCurrentPage = Number(data.current_page || page);
    usersTotalPages = Number(data.pages || 1);
    updateUsersPagination();
    filterUsersByRole(currentRoleFilter, null);
  } catch (error) {
    console.error('Error cargando usuarios:', error);
  }
}

function updateUsersPagination() {
  const pageLabel = document.getElementById('users-page-label');
  const previousButton = document.getElementById('users-page-previous');
  const nextButton = document.getElementById('users-page-next');

  if (pageLabel) pageLabel.textContent = `Página ${usersCurrentPage} de ${usersTotalPages}`;
  if (previousButton) previousButton.disabled = usersCurrentPage <= 1;
  if (nextButton) nextButton.disabled = usersCurrentPage >= usersTotalPages;
}

function changeUsersPage(page) {
  if (page < 1 || page > usersTotalPages || page === usersCurrentPage) return;
  loadUsers(page);
}

function filterUsersByRole(role, btn) {
  currentRoleFilter = role;
  document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const users = Array.isArray(window.users) ? window.users : [];
  const filtered = role === 'all' ? users : users.filter(u => u.role === role);
  renderUsersTable(filtered);

  const subtitle = document.getElementById('users-subtitle');
  if (subtitle) {
    const label = role === 'all' ? 'Todo el personal' : role === 'admin' ? 'Administradores' : role === 'supervisor' ? 'Supervisores' : 'Controladores';
    subtitle.textContent = `${label}: ${filtered.length} usuario(s)`;
  }
}

function renderUsersTable(users) {
  const tbody = document.querySelector('#users tbody');
  if (!tbody) return;

  const canManageUsers = currentUser && currentUser.role === 'admin';
  const canAssignRoutes = currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor');
  const routes = Array.isArray(window.routes) ? window.routes : [];

  tbody.innerHTML = users.map(user => `
    <tr>
      <td data-label="Nombre">${user.full_name || user.username}</td>
      <td data-label="Email">${user.email}</td>
      <td data-label="Rol">
        <span class="badge badge-${user.role === 'admin' ? 'dark' : 'info'}">
          ${user.role === 'admin' ? 'Admin' : user.role === 'supervisor' ? 'Supervisor' : 'Usuario'}
        </span>
      </td>
      <td class="status-cell" data-label="Estado">
        <span class="status-dot ${user.is_active ? 'status-active' : 'status-inactive'}"></span>
        ${user.is_active ? 'Activo' : 'Inactivo'}
      </td>
      ${canManageUsers ? `
      <td class="actions-cell" data-label="Acciones">
        <button class="btn-icon" onclick="editUser(${user.id})">&#x270F;&#xFE0F;</button>
        <button class="btn-icon" onclick="toggleUserStatus(${user.id}, ${user.is_active ? 'true' : 'false'})" title="${user.is_active ? 'Desactivar usuario' : 'Activar usuario'}">${user.is_active ? '&#x274C;' : '&#x2714;&#xFE0F;'}</button>
      </td>
      ` : '<td data-label="Acciones">-</td>'}
    </tr>
  `).join('');
}

function renderAssignedRouteCell(user, routes, canAssignRoutes) {
  if (user.role !== 'user') {
    return '<span class="muted">No aplica</span>';
  }

  const currentRoute = routes.find(r => Number(r.id) === Number(user.current_route_id));
  if (currentRoute) {
    return `<span style="font-weight: 500; color: #1e2d42;">${currentRoute.name || `R${currentRoute.id} - Zona ${currentRoute.id}`}</span>`;
  } else {
    return '<span style="color: #64748b; font-style: italic;">Sin ruta asignada</span>';
  }
}

async function assignRouteToUser(userId, routeId) {
  try {
    const normalizedRouteId = routeId === '' ? null : Number(routeId);

    const response = await fetch(`${API_URL}/users/${userId}/route`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ route_id: normalizedRouteId })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'No se pudo asignar la ruta');
    }

    const result = await response.json();
    window.users = Array.isArray(window.users)
      ? window.users.map(user => user.id === userId ? result.user : user)
      : [result.user];

    if (currentUser && currentUser.id === userId) {
      currentUser.current_route_id = result.user.current_route_id;
      localStorage.setItem('user', JSON.stringify(currentUser));
    }

    showToast('Ruta asignada correctamente', 'success');
    renderUsersTable(window.users);
  } catch (error) {
    showToast(error.message, 'error');
    loadUsers();
  }
}

function showNewUserModal() {
  const modal = document.getElementById('new-user-modal');
  modal.style.display = 'flex';
}

function closeUserModal() {
  const modal = document.getElementById('new-user-modal');
  modal.style.display = 'none';
  document.getElementById('new-user-form').reset();
}

async function handleNewUserSubmit(e) {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.dataset.originalText = submitBtn.textContent;

  const formData = new FormData(e.target);
  const userData = {
    username: formData.get('username'),
    email: formData.get('email'),
    full_name: formData.get('full_name'),
    role: formData.get('role'),
    password: formData.get('password')
  };

  setLoading(submitBtn, true);

  try {
    const response = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });

    if (!response.ok) throw new Error('No se pudo crear el usuario');

    const result = await response.json();
    showToast('Usuario creado exitosamente', 'success');
    closeUserModal();
    loadUsers(); // Recargar la lista
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  } finally {
    setLoading(submitBtn, false);
  }
}

async function createUser(userData) {
  try {
    const response = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });

    if (!response.ok) throw new Error('No se pudo crear el usuario');

    alert('Usuario creado exitosamente');
    loadUsers();
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

async function toggleUserStatus(userId, currentStatus) {
  if (!hasPermission('manage_users')) {
    showToast('No tienes permisos para modificar usuarios', 'error');
    return;
  }

  const action = currentStatus ? 'desactivar' : 'activar';
  if (!confirm(`¿Confirmas ${action} este usuario?`)) return;

  try {
    const response = await fetch(`${API_URL}/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ is_active: !currentStatus })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'No se pudo cambiar el estado');
    }

    showToast(`Usuario ${currentStatus ? 'desactivado' : 'activado'} correctamente`, 'success');
    loadUsers(usersCurrentPage);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function editRoute(routeId) {
  editRouteModal(routeId);
}

function editUser(userId) {
  if (!hasPermission('manage_users')) {
    showToast('No tienes permisos para editar usuarios', 'error');
    return;
  }

  const users = Array.isArray(window.users) ? window.users : [];
  const user = users.find(u => u.id === userId);

  if (!user) {
    showToast('Usuario no encontrado', 'error');
    return;
  }

  const modal = document.getElementById('edit-user-modal');
  const form = document.getElementById('edit-user-form');
  if (!modal || !form) return;

  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-fullname').value = user.full_name || user.username || '';
  document.getElementById('edit-user-email').value = user.email || '';
  document.getElementById('edit-user-role').value = user.role || 'user';
  modal.style.display = 'flex';
}

function closeEditUserModal() {
  const modal = document.getElementById('edit-user-modal');
  const form = document.getElementById('edit-user-form');
  if (modal) modal.style.display = 'none';
  if (form) form.reset();
}

async function handleEditUserSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const userId = document.getElementById('edit-user-id').value;

  try {
    const response = await fetch(`${API_URL}/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: document.getElementById('edit-user-fullname').value,
      email: document.getElementById('edit-user-email').value,
      role: document.getElementById('edit-user-role').value,
      password: document.getElementById('edit-user-password').value
    ,
        tramos: document.getElementById('edit-user-tramos') ? JSON.parse(document.getElementById('edit-user-tramos').value || '[]') : undefined
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'No se pudo editar el usuario');
    }

    closeEditUserModal();
    showToast('Usuario actualizado correctamente', 'success');
    loadUsers(usersCurrentPage);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============= PAUSAS ACTIVAS =============
async function handleMobilePauseSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';

  try {
    const response = await fetch(`${API_URL}/pauses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pause_type: formData.get('pause_type'),
        start_time: new Date().toISOString()
      })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Error al solicitar pausa');
    }
    
    showToast('Pausa solicitada exitosamente', 'success');
    const statusDiv = document.getElementById('active-pause-status');
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.backgroundColor = 'var(--warning-bg)';
      statusDiv.style.color = 'var(--warning)';
      statusDiv.textContent = 'Estado: Pendiente de aprobación · Retorno en 10 minutos';
    }
    if (activePauseTimeoutId) window.clearTimeout(activePauseTimeoutId);
    activePauseTimeoutId = window.setTimeout(() => {
      const activeStatus = document.getElementById('active-pause-status');
      if (activeStatus) {
        activeStatus.textContent = 'Pausa finalizada. Retornando al trabajo.';
        activeStatus.style.backgroundColor = 'var(--success-bg)';
        activeStatus.style.color = 'var(--success)';
      }
      form.reset();
      startControllerMonitoring();
      activePauseTimeoutId = null;
    }, 600000);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

async function loadPauses() {
  const tableContainer = document.getElementById('pauses-table-container');
  const formContainer = document.getElementById('mobile-pause-form-container');
  const subtitle = document.getElementById('pauses-subtitle');

  if (currentUser && currentUser.role === 'user') {
    if (tableContainer) tableContainer.style.display = 'none';
    if (subtitle) subtitle.style.display = 'none';
    if (formContainer) formContainer.style.display = 'block';
    return;
  }

  // Vista administrativa
  if (tableContainer) tableContainer.style.display = 'block';
  if (subtitle) subtitle.style.display = 'block';
  if (formContainer) formContainer.style.display = 'none';

  if (!hasPermission('view_all')) return;
  try {
    const response = await fetch(`${API_URL}/pauses`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!response.ok) throw new Error('No se pudieron cargar las pausas');
    const pauses = await response.json();
    
    const pausesCountEl = document.getElementById('pauses-count');
    if (pausesCountEl) {
      const pendingCount = pauses.filter(p => p.status === 'pending').length;
      pausesCountEl.textContent = pendingCount;
    }

    const tbody = document.getElementById('pauses-tbody');
    if (!tbody) return;

    const canManagePauseStatus = currentUser && (currentUser.role === 'supervisor' || currentUser.role === 'admin');

    tbody.innerHTML = pauses.map(p => {
      const statusBadge = {
          pending: '<span class="badge" style="background:#fef3c7;color:#d97706;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">Pendiente</span>',
          authorized: '<span class="badge" style="background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">Autorizada</span>',
          rejected: '<span class="badge" style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">Rechazada</span>',
          finished: '<span class="badge" style="background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">Finalizada</span>'
        }[p.status] || p.status;

      const isRunning = p.status === 'authorized' && !p.end_time;
      let actions = '<span style="color:#94a3b8;font-size:12px;">---</span>'; 
        if (p.status === 'pending' && canManagePauseStatus) { 
            actions = `<button class="btn-icon" onclick="updatePauseStatus(${p.id}, 'authorized')" title="Aprobar" style="background:#10b981;border:none;color:white;padding:6px 10px;border-radius:6px;cursor:pointer;margin-right:4px;font-size:14px;">&#x2714;&#xFE0F;</button> 
                       <button class="btn-icon" onclick="updatePauseStatus(${p.id}, 'rejected')" title="Rechazar" style="background:#ef4444;border:none;color:white;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:14px;">&#x274C;</button>`; 
        } else if (isRunning && canManagePauseStatus) { 
            actions = `<button class="btn-icon" onclick="updatePauseStatus(${p.id}, 'finished')" title="Terminar Pausa" style="background:#3b82f6;border:none;color:white;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:bold;">Finalizar</button>`; 
        } 
         
        const pauseTypeLabel = p.pause_type === 'refrigerio' ? 'Refrigerio' : 'Baño';
      const timerCell = isRunning
        ? `<span class="pause-timer" data-pause-id="${p.id}" data-user-name="${p.user_name || '---'}" data-start-time="${p.start_time}" data-duration-minutes="${p.duration_minutes}">--:--</span>`
        : (p.status === 'pending' ? '<span style="color:#f59e0b;font-size:12px;font-weight:600;">En espera</span>' : '<span style="color:#94a3b8;">---</span>');
      return `
        <tr>
          <td data-label="Controlador">${p.user_name || '—'}</td>
          <td data-label="Tipo">${pauseTypeLabel}</td>
          <td data-label="Motivo">${p.reason || '—'}</td>
          <td data-label="Inicio">${formatDateTime(p.start_time)}</td>
          <td data-label="Fin">${p.end_time ? formatDateTime(p.end_time) : '<span style="color:#94a3b8;">En curso</span>'}</td>
          <td data-label="Restante">${timerCell}</td>
          <td data-label="Estado">${statusBadge}</td>
          <td class="actions-cell" data-label="Acciones">${actions}</td>
        </tr>`;
    }).join('');
  } catch (error) {
    console.error('Error loading pauses:', error);
  }
}

// Controla qué pausas ya dispararon la alerta de vencimiento para no repetir el toast
const pauseExpiredAlerted = new Set();

function updatePauseTimers() {
  const timerElements = document.querySelectorAll('.pause-timer');
  timerElements.forEach(el => {
    const pauseId = el.getAttribute('data-pause-id');
    const startTime = new Date(el.getAttribute('data-start-time'));
    const durationMinutes = parseInt(el.getAttribute('data-duration-minutes'), 10) || 0;
    const userName = el.getAttribute('data-user-name') || 'el controlador';
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
    const remainingMs = endTime.getTime() - Date.now();

    if (remainingMs <= 0) {
      el.textContent = '00:00';
      el.style.color = '#dc2626';
      el.style.fontWeight = '700';
      if (!pauseExpiredAlerted.has(pauseId)) {
        pauseExpiredAlerted.add(pauseId);
        showToast(`Alerta: Tiempo finalizado para ${userName}`, 'error');
      }
    } else {
      const totalSeconds = Math.floor(remainingMs / 1000);
      const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
      const seconds = (totalSeconds % 60).toString().padStart(2, '0');
      el.textContent = `${minutes}:${seconds}`;
      el.style.color = '';
      el.style.fontWeight = '';
    }
  });
}

// Cronómetro global de pausas activas: se actualiza cada segundo en todos los roles con vista de pausas
if (!window.__pauseTimerIntervalId) {
  window.__pauseTimerIntervalId = setInterval(updatePauseTimers, 1000);
}

async function updatePauseStatus(id, status) {
  try {
    const response = await fetch(`${API_URL}/pauses/${id}/status`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    });
    if (!response.ok) throw new Error('Error al actualizar pausa');
    showToast(`Pausa ${status === 'authorized' ? 'Autorizada' : 'Rechazada'}`);
    loadPauses();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ============= ALERTAS (POLLING) =============
async function pollAlerts() {
  if (!hasPermission('view_all')) return;
  try {
    const response = await fetch(`${API_URL}/alerts?unread=true`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (response.ok) {
      const alerts = await response.json();
      const offZoneAlerts = alerts.filter(alert => alert.type === 'fuera_de_ruta');
      renderAlerts(alerts);
      const badge = document.getElementById('notif-badge');
      if (badge) {
        if (offZoneAlerts.length > 0) {
          badge.textContent = offZoneAlerts.length;
          badge.style.display = 'flex';
          badge.style.background = '#dc2626';
        } else if (alerts.length > 0) {
          badge.textContent = alerts.length;
          badge.style.display = 'flex';
        }
      }
    }
  } catch (e) {
    console.error('Error polling alerts:', e);
  }
}

async function checkMyAlerts() {
  if (!currentUser || currentUser.role !== 'user') return;

  try {
    const response = await fetch(`${API_URL}/alerts/my`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) return;

    const alerts = await response.json();
    const offZoneAlert = Array.isArray(alerts) ? alerts.find(alert => alert.type === 'fuera_de_ruta') : null;

    if (offZoneAlert) {
      showOffZoneAlertModal(offZoneAlert);
    }
  } catch (error) {
    console.error('Error verificando alertas del controlador:', error);
  }
}

function showOffZoneAlertModal(alert) {
  let modal = document.getElementById('off-zone-alert-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'off-zone-alert-modal';
    modal.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); width:min(90%, 720px); min-height:110px; box-sizing:border-box; background:rgba(220,38,38,0.97); border:1px solid rgba(255,255,255,0.35); border-radius:16px; box-shadow:0 12px 30px rgba(0,0,0,0.28); display:flex; align-items:center; justify-content:space-between; gap:16px; z-index:99999; padding:16px 20px; text-align:left;';
    modal.innerHTML = `
      <div style="font-size:36px; line-height:1;">🚨</div>
      <div style="flex:1;">
        <h2 style="color:white; font-size:18px; margin:0 0 4px 0;">¡ALERTA: FUERA DE ZONA!</h2>
        <p style="color:rgba(255,255,255,0.9); font-size:14px; margin:0;">Regresa inmediatamente a tu ruta asignada.</p>
      </div>
      <button id="btn-accept-off-zone" style="background:white; color:#dc2626; border:none; padding:10px 16px; border-radius:8px; font-size:14px; font-weight:700; cursor:pointer; white-space:nowrap;">✅ Entendido</button>
    `;
    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';
  const btn = document.getElementById('btn-accept-off-zone');
  if (btn) {
    btn.onclick = () => acceptOffZoneAlert(alert.id);
  }
}

async function acceptOffZoneAlert(alertId) {
  try {
    const response = await fetch(`${API_URL}/alerts/${alertId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No se pudo aceptar la alerta');

    const statusModal = document.getElementById('off-zone-alert-modal');
    if (statusModal) statusModal.style.display = 'none';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await fetch(`${API_URL}/monitoring`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              user_id: currentUser.id,
              route_id: currentUser.current_route_id,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              status: 'active'
            })
          });
        } catch (e) {
          console.error('Error limpiando estado de monitoreo:', e);
        }
      },
      (error) => {
        console.error('Error obteniendo GPS para limpiar alerta:', error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );

    showToast('✅ Alerta aceptada. Sigue tu ruta asignada.', 'success');
    loadMyRoute();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderAlerts(alerts) {
  const badge = document.getElementById('notif-badge');
  const list = document.getElementById('notif-list');
  if (!badge || !list) return;

  if (alerts.length > 0) {
    badge.textContent = alerts.length;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  if (alerts.length === 0) {
    list.innerHTML = '<div style="padding: 15px; text-align: center; color: #666; font-size: 12px;">No tienes nuevas notificaciones</div>';
    return;
  }

  list.innerHTML = alerts.map(a => `
    <div class="notif-item unread" onclick="markAlertRead(${a.id})">
      <div class="notif-item-title">${a.type.replace('_', ' ').toUpperCase()}</div>
      <div class="notif-item-desc">${a.message}</div>
      <div class="notif-item-time">${new Date(a.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
    </div>
  `).join('');
}

async function markAlertRead(id) {
  try {
    await fetch(`${API_URL}/alerts/${id}/read`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    pollAlerts();
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const clearBtn = document.getElementById('clearNotifBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      try {
        const response = await fetch(`${API_URL}/alerts/mark-all-read`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.ok) {
          showToast('Todas marcadas como leídas', 'success');
          pollAlerts();
        }
      } catch (e) {
        console.error('Error marcando como leídas', e);
      }
    });
  }
  
  // Start polling every 10 seconds
  if (authToken) {
    pollAlerts();
    setInterval(pollAlerts, 10000);
  }
});

// ============= DETALLES DE MULTA =============
function viewTicketDetail(ticket) {
  const modal = document.getElementById('ticket-detail-modal');
  const body = document.getElementById('ticket-detail-body');
  if (!modal || !body) return;

  const hasLocation = ticket.latitude && ticket.longitude;
  const mapUrl = hasLocation ? `https://www.google.com/maps/search/?api=1&query=${ticket.latitude},${ticket.longitude}` : '#';
  const photoUrl = ticket.photo_path ? getTicketPhotoUrl(ticket.id) : '';
  const isPdf = Boolean(ticket.photo_path && String(ticket.photo_path).toLowerCase().endsWith('.pdf'));
  const normalizedDescription = String(ticket.description || '').trim().toLowerCase();
  const showNotes = ticket.description && !['na', 'n/a', ''].includes(normalizedDescription);

  body.innerHTML = `
    <div class="ticket-detail-grid">
      <div class="ticket-media">
        ${ticket.photo_path ? (
          isPdf
          ? `<div style="text-align:center; padding:20px;"><div style="font-size:48px; margin-bottom:12px;">📄</div><p style="color:#555; margin-bottom:0;">Evidencia en formato PDF</p></div>`
          : `<img src="${photoUrl}" style="width:100%; border-radius:8px; object-fit:cover; max-height:280px;" alt="Evidencia fotográfica" onerror="this.outerHTML='<div style='text-align:center; padding:20px; color:#aaa; background:#f8f9fa; border-radius:8px;'>Error: Imagen no disponible</div>';" />`
        ) : `<div style="text-align:center; padding:20px; color:#aaa;">Sin evidencia adjunta</div>`}
        ${hasLocation ? `
          <a href="${mapUrl}" target="_blank" class="ticket-map-link">
            📍 Ver Ubicación en Mapa (${ticket.latitude.toFixed(4)}, ${ticket.longitude.toFixed(4)})
          </a>
        ` : `<div style="text-align:center; font-size:12px; color:gray;">Ubicación GPS no disponible</div>`}
      </div>
      
      <div class="ticket-info-group">
        <h4>Datos de la Multa</h4>
        <div class="info-row">
          <span class="info-label">Infracción</span>
          <span class="info-val">${ticket.violation_type}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Placa</span>
          <span class="info-val">${ticket.license_plate || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Dirección</span>
          <span class="info-val">${ticket.address || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Tipo de vehículo</span>
          <span class="info-val">${ticket.vehicle_type || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Marca</span>
          <span class="info-val">${ticket.vehicle_make || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Modelo</span>
          <span class="info-val">${ticket.vehicle_model || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Color</span>
          <span class="info-val">${ticket.vehicle_color || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Monto</span>
          <span class="info-val">$${ticket.amount.toFixed(2)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Estado</span>
          <span class="info-val" style="color: ${ticket.status === 'pending' ? 'var(--warning)' : 'var(--success)'}; font-weight:700;">
            ${translateStatus(ticket.status)}
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">Controlador</span>
          <span class="info-val">${ticket.user_name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha</span>
          <span class="info-val">${formatDateTime(ticket.timestamp)}</span>
        </div>
        ${showNotes ? `
          <div class="info-row">
            <span class="info-label">Notas</span>
            <span class="info-val" style="font-size:12px; font-weight:400;">${ticket.description}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  
  modal.style.display = 'flex';
}

function closeTicketDetailModal() {
  const modal = document.getElementById('ticket-detail-modal');
  if (modal) modal.style.display = 'none';
}

// ============= MULTAS MOBILE-FRIENDLY =============
async function populateMobileRoutes() {
  const select = document.getElementById('mobile-route-select');
  if (!select) return;

  if (currentUser && currentUser.role === 'user') {
    if (!currentUser.current_route_id) {
      select.innerHTML = '<option value="">Sin ruta asignada — Contacta a tu supervisor</option>';
      select.disabled = true;
      return;
    }

    try {
      const resp = await fetch(`${API_URL}/routes?per_page=100`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await resp.json();
      const myRoute = (data.routes || []).find(r => r.id === currentUser.current_route_id);

      if (myRoute) {
        select.innerHTML = `<option value="${myRoute.id}" selected>${myRoute.name} — ${myRoute.start_point || ''}</option>`;
        select.disabled = true;
        select.title = 'Tu ruta ha sido asignada por tu supervisor';
      } else {
        select.innerHTML = `<option value="${currentUser.current_route_id}" selected>Ruta ${currentUser.current_route_id}</option>`;
        select.disabled = true;
      }
    } catch (e) {
      select.innerHTML = `<option value="${currentUser.current_route_id}" selected>Mi ruta asignada</option>`;
      select.disabled = true;
    }
    return;
  }

  try {
    const response = await fetch(`${API_URL}/routes?per_page=100`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (response.ok) {
      const data = await response.json();
      select.disabled = false;
      select.innerHTML = '<option value="">Seleccione una zona/ruta...</option>' +
        (data.routes || []).map(r => `<option value="${r.id}">${r.name} — ${r.start_point || ''}</option>`).join('');
    }
  } catch (e) {
    console.error('Error fetching routes for mobile form:', e);
  }
}

function showTicketForm() {
  if (currentUser && currentUser.role !== 'user') {
    return;
  }

  const tableContainer = document.getElementById('ticket-table-container');
  const formContainer = document.getElementById('ticket-form-container');
  const subtitle = document.getElementById('tickets-subtitle');
  const btnShow = document.getElementById('btn-show-ticket-form');
  const btnCancel = document.getElementById('btn-cancel-ticket-form');

  if (tableContainer) tableContainer.style.display = 'none';
  if (formContainer) formContainer.style.display = 'block';
  if (subtitle) subtitle.style.display = 'none';
  if (btnShow) btnShow.style.display = 'none';
  if (btnCancel) btnCancel.style.display = 'none';

  populateMobileRoutes();
  // Inicializar GPS y vista previa de foto
  setTimeout(initMobileTicketExtras, 150);
}

function hideTicketForm() {
  if (currentUser && currentUser.role === 'user') {
    return;
  }

  const tableContainer = document.getElementById('ticket-table-container');
  const formContainer = document.getElementById('ticket-form-container');
  const subtitle = document.getElementById('tickets-subtitle');
  const btnShow = document.getElementById('btn-show-ticket-form');

  if (tableContainer) tableContainer.style.display = 'block';
  if (formContainer) formContainer.style.display = 'none';
  if (subtitle) subtitle.style.display = 'block';
  if (btnShow) btnShow.style.display = currentUser && currentUser.role === 'user' ? 'none' : 'inline-flex';
}

// Inicializar vista previa de foto y GPS cuando la sección tickets se activa
function initMobileTicketExtras() {
  // Vista previa de la foto
  const photoInput = document.getElementById('ticket-photo');
  const photoPreview = document.getElementById('photo-preview');
  const pdfPreview = document.getElementById('pdf-preview');
  const photoUploadArea = document.getElementById('photo-upload-area');

  if (photoInput && photoPreview && !photoInput.dataset.boundPreview) {
    photoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const isPdf = (file.type && file.type.toLowerCase() === 'application/pdf') || file.name.toLowerCase().endsWith('.pdf');

        if (isPdf) {
          photoPreview.style.display = 'none';
          photoPreview.src = '';
          if (pdfPreview) {
            pdfPreview.style.display = 'block';
            pdfPreview.textContent = `📄 ${file.name}`;
          }
          if (photoUploadArea) {
            photoUploadArea.style.borderColor = '#0057a8';
            photoUploadArea.style.background = '#eef4ff';
          }
          return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
          photoPreview.src = ev.target.result;
          photoPreview.style.display = 'block';
          if (pdfPreview) {
            pdfPreview.style.display = 'none';
            pdfPreview.textContent = '';
          }
          if (photoUploadArea) {
            photoUploadArea.style.borderColor = '#0057a8';
            photoUploadArea.style.background = '#e8f4ff';
          }
        };
        reader.readAsDataURL(file);
      }
    });
    photoInput.dataset.boundPreview = 'true';
  }

  // GPS badge
  const gpsStatus = document.getElementById('gps-status');
  if (gpsStatus && navigator.geolocation) {
    gpsStatus.style.display = 'inline-flex';
    gpsStatus.textContent = '📍 Obteniendo ubicación GPS...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        gpsStatus.textContent = `✅ GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        gpsStatus.className = 'gps-badge';
        // Store coords globally for form submit
        window._mobileTicketGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {
        gpsStatus.textContent = '⚠️ GPS no disponible - se enviará sin coordenadas';
        gpsStatus.className = 'gps-badge error';
        window._mobileTicketGPS = null;
      },
      { timeout: 8000 }
    );
  }
}

async function handleMobileTicketSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  formData.append('user_id', currentUser.id);

  // FIX: los <select disabled> NO se incluyen en FormData — forzamos el route_id
  const routeSelect = document.getElementById('mobile-route-select');
  if (routeSelect && routeSelect.value) {
    formData.set('route_id', routeSelect.value);
  } else if (currentUser.current_route_id) {
    formData.set('route_id', currentUser.current_route_id);
  }

  // Adjuntar GPS si está disponible
  if (window._mobileTicketGPS) {
    formData.set('latitude', window._mobileTicketGPS.lat);
    formData.set('longitude', window._mobileTicketGPS.lng);
  }

  await sendTicketFormData(form, formData);
}

async function sendTicketFormData(form, formData) {
  const submitBtn = document.getElementById('mobile-submit-btn') || form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳</span> Enviando...';
  }

  try {
    const response = await fetch(`${API_URL}/tickets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
        // No Content-Type — browser sets it with boundary for FormData
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Error al enviar la multa');
    }

    // Mostrar pantalla de éxito
    const formWrapper = form;
    const successScreen = document.getElementById('ticket-success-screen');
    if (formWrapper && successScreen) {
      formWrapper.style.display = 'none';
      successScreen.style.display = 'flex';
    } else {
      showToast('Infraccion registrada exitosamente', 'success');
    }

    form.reset();
    // Reset photo preview
    const photoPreview = document.getElementById('photo-preview');
    if (photoPreview) { photoPreview.style.display = 'none'; photoPreview.src = ''; }
    const pdfPreview = document.getElementById('pdf-preview');
    if (pdfPreview) { pdfPreview.style.display = 'none'; pdfPreview.textContent = ''; }
    const photoUploadArea = document.getElementById('photo-upload-area');
    if (photoUploadArea) { photoUploadArea.style.borderColor = ''; photoUploadArea.style.background = ''; }

    // Si no es controlador exclusivo, volver a la tabla
    if (currentUser.role !== 'user') {
      hideTicketForm();
      loadTickets();
    }
  } catch (error) {
    showToast(error.message, 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>📨</span> Enviar Multa al Sistema';
    }
  }
}

function resetTicketForm() {
  const form = document.getElementById('mobile-ticket-form');
  const successScreen = document.getElementById('ticket-success-screen');
  if (form) form.style.display = '';
  if (successScreen) successScreen.style.display = 'none';
  const submitBtn = document.getElementById('mobile-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>📨</span> Enviar Multa al Sistema'; }
  const gpsStatus = document.getElementById('gps-status');
  if (gpsStatus) { gpsStatus.style.display = 'none'; }
  window._mobileTicketGPS = null;
  // Re-init GPS
  setTimeout(initMobileTicketExtras, 100);
}

function openFilterModal() {
  showFilterModal();
}


// Interceptar la carga de tickets para adaptar la vista al rol
const originalLoadTickets = loadTickets;
loadTickets = async function(filters = {}) {
  if (currentUser && currentUser.role === 'user') {
    // Para controlador, forzamos mostrar siempre el form y nunca la tabla
    applyControllerTicketsUI();
    showTicketForm();
    const formContainer = document.getElementById('ticket-form-container');
    const tableContainer = document.getElementById('ticket-table-container');
    if (formContainer) formContainer.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';
    initMobileTicketExtras();
    const btnCancel = document.getElementById('btn-cancel-ticket-form');
    if (btnCancel) btnCancel.style.display = 'none';
    return;
  } else {
    // Supervisor y admin no registran multas desde esta vista.
    const btnShow = document.getElementById('btn-show-ticket-form');
    if (btnShow) btnShow.style.display = 'none';

    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor')) {
      const formContainer = document.getElementById('ticket-form-container');
      if (formContainer) formContainer.style.display = 'none';
    }

    if (currentUser && currentUser.role === 'supervisor') {
      const formContainer = document.getElementById('ticket-form-container');
      if (formContainer) formContainer.style.display = 'none';
    }

    if (typeof originalLoadTickets === 'function') {
      await originalLoadTickets(filters);
    } else {
      // Re-implement if original was lost or undefined
      try {
        let url = `${API_URL}/tickets?per_page=100`;
        if (filters.date_from) url += `&date_from=${filters.date_from}`;
        if (filters.date_to) url += `&date_to=${filters.date_to}`;
        if (filters.controller) url += `&controller=${filters.controller}`;
        if (filters.zone) url += `&zone=${filters.zone}`;
        if (filters.status) url += `&status=${filters.status}`;

        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          renderTicketsTable(data.tickets);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }
};

// ═══ MI RUTA ASIGNADA — Controlador en campo ═══
let ctrlRouteMap = null;
let ctrlGpsWatchId = null;
let ctrlPlayerMarker = null;
let ctrlCoworkerMarkers = {};
let ctrlCoworkerSocket = null;
let ctrlSocketScriptPromise = null;

async function loadMyRoute() {
  // Referencias a los elementos del nuevo HTML
  const overlay   = document.getElementById('ctrl-no-route-overlay');
  const titleEl   = document.getElementById('ctrl-route-title');
  const streetsEl = document.getElementById('ctrl-route-streets');
  const distEl    = document.getElementById('ctrl-distance');
  const timeEl    = document.getElementById('ctrl-time');
  const offTimeEl = document.getElementById('ctrl-off-time');
  const badgeEl   = document.getElementById('ctrl-zone-badge');
  const dotEl     = document.getElementById('ctrl-status-dot');

  // Limpiar instancias anteriores del mapa y GPS
  if (ctrlRouteMap) { try { ctrlRouteMap.remove(); } catch (e) {} ctrlRouteMap = null; }
  if (ctrlGpsWatchId !== null) {
    navigator.geolocation.clearWatch(ctrlGpsWatchId);
    ctrlGpsWatchId = null;
  }
  ctrlPlayerMarker = null;
  for (var key in ctrlCoworkerMarkers) {
    if (ctrlCoworkerMarkers.hasOwnProperty(key)) {
      try { ctrlCoworkerMarkers[key].remove(); } catch (e) {}
    }
  }
  ctrlCoworkerMarkers = {};
  // setupControllerCoworkerSocket();

  // Estado inicial: cargando
  if (overlay) overlay.style.display = 'none';
  if (titleEl) titleEl.textContent = 'Cargando ruta...';
  _ctrlGpsStatus('Conectando con el servidor...', '#94a3b8');

  try {
    const resp = await fetch(`${API_URL}/users/me/route`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    // ─── SIN RUTA ASIGNADA ───
    if (resp.status === 404) {
      const errData = await resp.json().catch(() => ({}));
      const code = errData.code || '';
      if (overlay) overlay.style.display = 'flex';
      if (titleEl) titleEl.textContent = 'Sin Ruta Asignada';
      if (streetsEl) streetsEl.textContent = code === 'ROUTE_DELETED'
        ? 'Tu ruta fue eliminada. Contacta al supervisor.'
        : 'Solicita asignación a tu supervisor';
      _ctrlGpsStatus('Sin ruta asignada. GPS inactivo.', '#f59e0b');
      _ctrlZoneBadge(null, dotEl, badgeEl);
      return;
    }
    if (!resp.ok) throw new Error(`Error ${resp.status}`);
    const data = await resp.json();
    const route = data.route;
    const route2 = data.route_2;
    if (!route) throw new Error('Respuesta vacía del servidor');

    // ─── RUTA ENCONTRADA: llenar datos ───
    if (overlay)   overlay.style.display = 'none';
    if (titleEl)   titleEl.textContent = route.name || `Zona R${route.id}`;
    if (streetsEl) streetsEl.textContent = `${route.start_point || ''} → ${route.end_point || ''}`.trim();
    if (distEl)    distEl.textContent = route.distance_km ? `${route.distance_km} km` : '—';
    if (timeEl)    timeEl.textContent = `${Number(route.minutos_circulando || 0)} min`;
    if (offTimeEl) offTimeEl.textContent = `${Number(route.minutos_fuera || 0)} min`;

    // === BANNER DE TRAMOS DE APOYO ===
    const tramosContainer = document.getElementById('ctrl-tramos-banner');
    if (data.assigned_tramos && Array.isArray(data.assigned_tramos) && data.assigned_tramos.length > 0 && window.TRAMOS_CATALOG) {
      const nombresTramos = data.assigned_tramos.map(id => {
        const t = window.TRAMOS_CATALOG.find(x => Number(x.id) === Number(id));
        return t ? t.name : 'Tramo ' + id;
      });
      const bannerHTML = '<div id="ctrl-tramos-banner" style="background:rgba(245,158,11,0.15);border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin:8px 0;font-size:12px;color:#fbbf24;">' +
        '<div style="font-weight:600;margin-bottom:4px;">\u{1F4CC} ZONAS DE APOYO ASIGNADAS</div>' +
        '<div style="color:rgba(255,255,255,0.8);line-height:1.4;">' + nombresTramos.join(', ') + '</div>' +
        '</div>';
      
      if (tramosContainer) {
        tramosContainer.outerHTML = bannerHTML;
      } else {
        if (streetsEl) {
           streetsEl.insertAdjacentHTML('afterend', bannerHTML);
        }
      }
    } else {
      if (tramosContainer) tramosContainer.remove();
    }
    _ctrlZoneBadge(null, dotEl, badgeEl);
    _ctrlGpsStatus('Iniciando localización GPS...', '#94a3b8');

    // ─── INICIALIZAR MAPA ───
    await _initCtrlRouteMap(route, route2, data);
    // ─── ACTIVAR GPS EN TIEMPO REAL ───
    _startCtrlGpsWatch(route, route2, dotEl, badgeEl);

    // CRONÓMETRO EN TIEMPO REAL
    let segundosCirculando = Number(route.minutos_circulando || 0) * 60;
    let segundosFuera = Number(route.minutos_fuera || 0) * 60;
    
    const formatTime = (totalSeconds) => {
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      const hh = h < 10 ? '0' + h : h;
      const mm = m < 10 ? '0' + m : m;
      const ss = s < 10 ? '0' + s : s;
      return h === 0 ? `${mm}:${ss}` : `${hh}:${mm}:${ss}`;
    };

    if (window.ctrlLiveTimer) clearInterval(window.ctrlLiveTimer);
    
    window.ctrlLiveTimer = setInterval(() => {
      const isOffZone = badgeEl && badgeEl.textContent.includes('Fuera');
      segundosCirculando++;
      if (isOffZone) segundosFuera++;
      
      if (timeEl) timeEl.textContent = formatTime(segundosCirculando);
      if (offTimeEl) offTimeEl.textContent = formatTime(segundosFuera);
    }, 1000);

  } catch (e) {
    console.error('[MI RUTA]', e);
    if (overlay) overlay.style.display = 'flex';
    const overlayMessage = overlay && overlay.querySelector('div:last-child');
    if (overlayMessage) overlayMessage.textContent = 'Error de conexión. Presiona Actualizar.';
    if (titleEl) titleEl.textContent = 'Error de conexión';
    _ctrlGpsStatus('No se pudo conectar con el servidor.', '#dc2626');
  }
}

async function _initCtrlRouteMap(route, route2, data) {
  const mapEl = document.getElementById('ctrl-route-map');
  if (!mapEl) return;

  await new Promise(resolve => {
    if (mapEl.offsetWidth > 0) return resolve();
    const obs = new ResizeObserver(() => {
      if (mapEl.offsetWidth > 0) { obs.disconnect(); resolve(); }
    });
    obs.observe(mapEl);
    setTimeout(resolve, 1000); 
  });

  ctrlRouteMap = L.map('ctrl-route-map', {
    center: [-2.7393, -78.8467],
    zoom: 16,
    zoomControl: true,
    attributionControl: false,
    tap: true
  });
  
  L.tileLayer('https://c.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: 'abcd', maxZoom: 20
  }).addTo(ctrlRouteMap);

  try {
    const assignedId1 = 'R' + route.id;
    let bounds = null;

    // 1. CARGAR RUTAS COMPLETAS
    if (!window.routeGeoJSON) {
      const geojsonResp = await fetch('/frontend/assets/semertaz_routes.geojson');
      if (geojsonResp.ok) window.routeGeoJSON = await geojsonResp.json();
    }
    
    if (window.routeGeoJSON) {
      window.ctrlRoutesLayer = L.geoJSON(window.routeGeoJSON, {
        style: f => {
          const fId = String(f.properties.id || f.properties.ruta || '');
          let isMine = (fId === assignedId1);
          const originalColor = f.properties.stroke || '#00f2fe';
          return {
            color: isMine ? originalColor : '#000',
            weight: isMine ? 6 : 0,
            opacity: isMine ? 1 : 0,
            className: isMine ? 'ctrl-assigned-route-glow' : '',
            dashArray: isMine ? '10, 10' : null,
            lineCap: 'round', lineJoin: 'round'
          };
        },
        onEachFeature: (f, layer) => {
          const fId = String(f.properties.id || f.properties.ruta || '');
          if (fId === assignedId1) {
            try {
              const featureBounds = layer.getBounds();
              bounds = bounds ? bounds.extend(featureBounds) : featureBounds;
            } catch (e) {}
          }
        }
      }).addTo(ctrlRouteMap);
    }

    // 2. CARGAR TRAMOS DE APOYO
    if (!window.tramosGeoJSON) {
      const tramosResp = await fetch('/frontend/assets/semertaz_tramos.geojson');
      if (tramosResp.ok) window.tramosGeoJSON = await tramosResp.json();
    }

    if (window.tramosGeoJSON && data.assigned_tramos && data.assigned_tramos.length > 0) {
      const assignedTramosStr = data.assigned_tramos.map(String);
      
      window.ctrlTramosLayer = L.geoJSON(window.tramosGeoJSON, {
        style: f => {
          const tId = String(f.properties.id || '');
          const isMine = assignedTramosStr.includes(tId);
          const originalColor = f.properties.stroke || '#FFA000';
          return {
            color: isMine ? originalColor : '#000',
            weight: isMine ? 6 : 0,
            opacity: isMine ? 1 : 0,
            className: isMine ? 'ctrl-assigned-route-glow' : '',
            dashArray: isMine ? '10, 10' : null,
            lineCap: 'round', lineJoin: 'round'
          };
        },
        onEachFeature: (f, layer) => {
          const tId = String(f.properties.id || '');
          if (assignedTramosStr.includes(tId)) {
            try {
              const featureBounds = layer.getBounds();
              bounds = bounds ? bounds.extend(featureBounds) : featureBounds;
            } catch (e) {}
            
            layer.bindTooltip(f.properties.description || f.properties.name || 'Tramo' , {
              permanent: false,
              direction: 'center'
            });
          }
        }
      }).addTo(ctrlRouteMap);
    }

    
    // Toggle Logic for Controller
    const toggleBtn = document.getElementById('ctrl-radar-layer-toggle');
    const lblRutas = document.getElementById('ctrl-label-rutas');
    const lblTramos = document.getElementById('ctrl-label-tramos');
    
    if (toggleBtn) {
      if (window.ctrlTramosLayer && ctrlRouteMap.hasLayer(window.ctrlTramosLayer)) {
         ctrlRouteMap.removeLayer(window.ctrlTramosLayer);
      }
      
      toggleBtn.addEventListener('change', (e) => {
        if (e.target.checked) {
          if (window.ctrlRoutesLayer && ctrlRouteMap.hasLayer(window.ctrlRoutesLayer)) {
            ctrlRouteMap.removeLayer(window.ctrlRoutesLayer);
          }
          if (window.ctrlTramosLayer) window.ctrlTramosLayer.addTo(ctrlRouteMap);
          if (lblRutas) lblRutas.style.color = '#64748b';
          if (lblTramos) lblTramos.style.color = '#38bdf8';
        } else {
          if (window.ctrlTramosLayer && ctrlRouteMap.hasLayer(window.ctrlTramosLayer)) {
            ctrlRouteMap.removeLayer(window.ctrlTramosLayer);
          }
          if (window.ctrlRoutesLayer) window.ctrlRoutesLayer.addTo(ctrlRouteMap);
          if (lblRutas) lblRutas.style.color = '#38bdf8';
          if (lblTramos) lblTramos.style.color = '#64748b';
        }
      });
    }

    if (bounds && bounds.isValid()) {
      ctrlRouteMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
    }
  } catch (e) {
    console.warn('[CTRL MAP] GeoJSON error:', e);
  }
}

function _startCtrlGpsWatch(route, route2, dotEl, badgeEl) {
  if (!navigator.geolocation) {
    _ctrlGpsStatus('GPS no disponible en este dispositivo.', '#dc2626');
    return;
  }

  const myIcon = L.divIcon({
    className: '',
    html: `<div style="width:20px;height:20px;border-radius:50%;background:#1a85d4;border:3px solid #fff;box-shadow:0 0 0 5px rgba(26,133,212,0.35);"></div>`,
    iconSize: [20, 20], iconAnchor: [10, 10]
  });

  ctrlGpsWatchId = navigator.geolocation.watchPosition(
    async pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (ctrlRouteMap) {
        if (!ctrlPlayerMarker) {
          ctrlPlayerMarker = L.marker([lat, lng], { icon: myIcon, zIndexOffset: 1000 })
            .bindPopup(`<b>Tu posición</b><br>±${Math.round(accuracy)}m`)
            .addTo(ctrlRouteMap);
        } else {
          ctrlPlayerMarker.setLatLng([lat, lng]);
        }
        ctrlRouteMap.panTo([lat, lng], { animate: true });
      }
      let inZone = null;
      if (window.turf) {
        const assignedId1 = 'R' + route.id;
        const assignedId2 = route2 ? 'R' + route2.id : null;
        try {
          if (!window.routeGeoJSON) {
            const geojsonResp = await fetch('/frontend/assets/semertaz_routes.geojson');
            if (geojsonResp.ok) {
              window.routeGeoJSON = await geojsonResp.json();
            }
          }
          if (window.routeGeoJSON) {
            const gj = window.routeGeoJSON;
            const point = turf.point([lng, lat]);
            const features = gj.features.filter(f => {
              const featureId = String(f.properties.id || f.properties.ruta || '');
              return featureId === assignedId1 || featureId === assignedId2;
            });
            if (features.length > 0) {
              inZone = features.some(f => {
                try {
                  if (f.geometry.type === 'Polygon') return turf.booleanPointInPolygon(point, f);
                  if (f.geometry.type === 'LineString') return turf.pointToLineDistance(point, f, { units: 'meters' }) < 80;
                } catch (e) { return false; }
                return false;
              });
            }
          }
        } catch (e) {}
      }
      _ctrlZoneBadge(inZone, dotEl, badgeEl);
      _ctrlGpsStatus(`GPS activo · ±${Math.round(accuracy)}m · ${new Date().toLocaleTimeString('es-EC')}`, '#10b981');
      try {
        await fetch(`${API_URL}/monitoring`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: currentUser.id,
            route_id: currentUser.current_route_id,
            latitude: lat, longitude: lng,
            status: inZone === false ? 'off_zone' : 'active'
          })
        });
      } catch (e) { console.warn('[GPS PING]', e); }
    },
    err => {
      if (err.code === 1) {
        showToast('Error: El GPS requiere conexión segura (HTTPS)', 'error');
      }
      _ctrlGpsStatus('No se pudo obtener la ubicación.', '#f59e0b');
      _ctrlZoneBadge(null, dotEl, badgeEl);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 }
  );
}

function _ctrlGpsStatus(msg, color = '#64748b') {
  const el = document.getElementById('my-route-gps-status');
  if (el) el.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>${msg}`;
}

function _ctrlZoneBadge(inZone, dotEl, badgeEl) {
  const topbar = document.querySelector('.topbar');
  if (inZone === false) {
    if (topbar) {
      topbar.style.backgroundColor = '#dc2626';
      topbar.style.color = '#fff';
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } else if (topbar) {
    topbar.style.removeProperty('background-color');
    topbar.style.removeProperty('color');
  }
  if (!badgeEl) return;
  if (inZone === null) {
    badgeEl.style.background = '#475569'; badgeEl.textContent = '⏳ Sin GPS';
    if (dotEl) { dotEl.style.background = '#94a3b8'; dotEl.style.boxShadow = 'none'; }
  } else if (inZone) {
    badgeEl.style.background = '#059669'; badgeEl.textContent = '✅ En Zona';
    if (dotEl) { dotEl.style.background = '#10b981'; dotEl.style.boxShadow = '0 0 0 4px rgba(16,185,129,0.3)'; }
  } else {
    badgeEl.style.background = '#dc2626'; badgeEl.textContent = '🚨 Fuera de Zona';
    if (dotEl) { dotEl.style.background = '#ef4444'; dotEl.style.boxShadow = '0 0 0 4px rgba(239,68,68,0.3)'; }
  }
}

function startControllerMonitoring() {
  if (!currentUser || currentUser.role !== 'user' || controllerMonitoringIntervalId) {
    return;
  }

  sendControllerMonitoringPing();
  controllerMonitoringIntervalId = window.setInterval(() => {
    sendControllerMonitoringPing('active');
  }, 60000);
}

function sendControllerMonitoringPing(forceStatus = 'active') {
  if (!currentUser || currentUser.role !== 'user') {
    return;
  }

  if (!currentUser.current_route_id) {
    const monitoringStatus = document.getElementById('my-route-gps-status');
    if (monitoringStatus) {
      monitoringStatus.textContent = 'Monitoreo GPS detenido: no existe una ruta asignada.';
    }
    return;
  }

  if (!navigator.geolocation) {
    showToast('Este dispositivo no soporta geolocalización', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const payload = {
          user_id: currentUser.id,
          route_id: currentUser.current_route_id,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          status: forceStatus
        };

        const response = await fetch(`${API_URL}/monitoring`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'No se pudo registrar el monitoreo');
        }

        const monitoringStatus = document.getElementById('my-route-gps-status');
        if (monitoringStatus) {
          monitoringStatus.textContent = forceStatus === 'off_zone'
            ? 'Se reportó un desvío de ruta para pruebas de auditoría.'
            : `Último envío GPS: ${new Date().toLocaleTimeString('es-ES')}`;
        }

        if (forceStatus === 'off_zone') {
          showToast('Desvío de ruta simulado y reportado al backend', 'success');
        }
      } catch (error) {
        console.error('Error enviando monitoreo GPS:', error);
        showToast(error.message, 'error');
      }
    },
    (error) => {
      console.error('Error obteniendo GPS:', error);
      const monitoringStatus = document.getElementById('my-route-gps-status');
      if (monitoringStatus) {
        monitoringStatus.textContent = 'No se pudo obtener la ubicación GPS del dispositivo.';
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    }
  );
}

async function simulateOffZone() {
  if (!currentUser || !currentUser.current_route_id) {
    showToast('No tienes ruta asignada para simular desvío', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/monitoring`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: currentUser.id,
        route_id: currentUser.current_route_id,
        latitude: -2.750000,
        longitude: -78.850000,
        status: 'off_zone'
      })
    });

    if (!response.ok) {
      throw new Error('No se pudo enviar la alerta de desvío');
    }

    const monitoringStatus = document.getElementById('my-route-gps-status');
    if (monitoringStatus) {
      monitoringStatus.textContent = 'Se reportó un desvío de ruta para pruebas de auditoría.';
    }

    showToast('🚨 Alerta de desvío enviada al supervisor', 'error');
  } catch (error) {
    showToast(error.message || 'Error de conexión', 'error');
  }
}

function simulateOffRouteMonitoring() {
  simulateOffZone();
}


let tramosCurrentPage = 1;
const tramosPerPage = 15;
let tramosFiltered = [];

function initTramosView() {
  const catalog = window.TRAMOS_CATALOG || [];
  tramosFiltered = [...catalog];
  tramosCurrentPage = 1;
  renderTramosTable();
}

function filterTramosTable() {
  const query = (document.getElementById('catalog-tramos-search').value || '').toLowerCase();
  const catalog = window.TRAMOS_CATALOG || [];
  if (!query) {
    tramosFiltered = [...catalog];
  } else {
    tramosFiltered = catalog.filter(t => 
      String(t.id).includes(query) || 
      (t.description && t.description.toLowerCase().includes(query)) ||
      (t.calle && t.calle.toLowerCase().includes(query)) ||
      String(t.route_id).includes(query)
    );
  }
  tramosCurrentPage = 1;
  renderTramosTable();
}

function renderTramosTable() {
  const tbody = document.getElementById('tramos-tbody');
  const pagination = document.getElementById('tramos-pagination');
  if (!tbody || !pagination) return;

  const total = tramosFiltered.length;
  const totalPages = Math.ceil(total / tramosPerPage) || 1;
  if (tramosCurrentPage > totalPages) tramosCurrentPage = totalPages;

  const start = (tramosCurrentPage - 1) * tramosPerPage;
  const end = start + tramosPerPage;
  const currentTramos = tramosFiltered.slice(start, end);

  tbody.innerHTML = currentTramos.length === 0 
    ? '<tr><td colspan="3" style="text-align: center; color: #64748b;">No se encontraron tramos</td></tr>'
    : currentTramos.map(t => `
        <tr>
          <td><strong style="color: #0f172a;">${t.id}</strong></td>
          <td>${t.description || t.calle || '-'}</td>
          <td><span class="badge" style="background: #e2e8f0; color: #0f172a;">Ruta ${t.route_id || 'Otras'}</span></td>
        </tr>
      `).join('');

  // Render pagination
  let pagHtml = '';
  for (let i = 1; i <= totalPages; i++) {
    // Only show a few pages around current to avoid overflow
    if (i === 1 || i === totalPages || (i >= tramosCurrentPage - 2 && i <= tramosCurrentPage + 2)) {
      const active = i === tramosCurrentPage ? 'background: #0f172a; color: white;' : 'background: #f1f5f9; color: #334155;';
      pagHtml += `<button onclick="tramosCurrentPage=${i}; renderTramosTable()" style="border:none; border-radius: 4px; padding: 6px 12px; cursor:pointer; ${active}">${i}</button>`;
    } else if (i === tramosCurrentPage - 3 || i === tramosCurrentPage + 3) {
      pagHtml += `<span style="padding: 6px;">...</span>`;
    }
  }
  pagination.innerHTML = pagHtml;
}

window.filterTramosTable = filterTramosTable;


function toggleControllerTramosSheet() {
  const sheet = document.getElementById('controller-tramos-sheet');
  if (!sheet) return;
  if (sheet.style.bottom === '0px') {
    sheet.style.bottom = '-100%';
  } else {
    sheet.style.bottom = '0px';
  }
}

function renderControllerTramosSheet(data) {
  const btn = document.getElementById('btn-show-tramos-sheet');
  const list = document.getElementById('controller-tramos-list');
  if (!btn || !list) return;

  const asignados = data.assigned_tramos || [];
  if (asignados.length === 0) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'flex';

  const catalog = window.TRAMOS_CATALOG || [];
  let html = '';
  
  const tramosData = asignados.map(id => catalog.find(t => Number(t.id) === Number(id))).filter(Boolean);
  
  const grouped = {};
  tramosData.forEach(t => {
    const rid = t.route_id || 'Otras';
    if (!grouped[rid]) grouped[rid] = [];
    grouped[rid].push(t);
  });

  for (const rid of Object.keys(grouped).sort((a,b)=>Number(a)-Number(b))) {
    html += `<div style="margin-bottom: 12px;">
      <div style="font-weight: 700; font-size: 13px; color: #0057a8; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 8px;">Ruta ${rid}</div>`;
    
    html += grouped[rid].map(t => `
      <div style="font-size: 13px; color: #334155; margin-bottom: 6px; display: flex; gap: 8px;">
        <span style="font-weight: 700; color: #0f172a; min-width: 35px;">T${t.id}:</span>
        <span>${t.description || t.calle || ''}</span>
      </div>
    `).join('');
    html += `</div>`;
  }

  list.innerHTML = html;
}

window.toggleControllerTramosSheet = toggleControllerTramosSheet;


let selectedTramosUserId = null;

function openAssignTramosModal(userId) {
  const modal = document.getElementById('assign-tramos-modal');
  const userSelect = document.getElementById('assign-tramos-user-select');
  const container = document.getElementById('tramos-modal-list');
  const searchInput = document.getElementById('search-tramos-modal');
  
  if (!modal || !userSelect || !container) return;

  const users = Array.isArray(window.users) ? window.users : [];
  const controllers = users.filter(u => u.role === 'user');

  // Populate select
  userSelect.innerHTML = '<option value="">-- Seleccione un Controlador --</option>' +
    controllers.map(u => `<option value="${u.id}">${u.full_name || u.username}</option>`).join('');

  if (userId) {
    userSelect.value = userId;
    selectedTramosUserId = userId;
    const user = controllers.find(u => Number(u.id) === Number(userId));
    if (user) renderTramosInModal(user);
  } else {
    selectedTramosUserId = null;
    userSelect.value = '';
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">Seleccione un controlador arriba para ver sus tramos asignados.</div>';
  }

  if (searchInput) searchInput.value = '';
  modal.style.display = 'flex';
}

window.onTramosUserSelected = function(val) {
  const userId = val ? Number(val) : null;
  selectedTramosUserId = userId;
  const container = document.getElementById('tramos-modal-list');
  
  if (!userId) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">Seleccione un controlador arriba para ver sus tramos asignados.</div>';
    return;
  }
  
  const users = Array.isArray(window.users) ? window.users : [];
  const user = users.find(u => Number(u.id) === Number(userId));
  if (user) renderTramosInModal(user);
};

function closeAssignTramosModal() {
  const modal = document.getElementById('assign-tramos-modal');
  if (modal) modal.style.display = 'none';
  selectedTramosUserId = null;
}

function renderTramosInModal(userObj, filterText = '') {
  const container = document.getElementById('tramos-modal-list');
  if (!container) return;

  const catalog = window.TRAMOS_CATALOG || [];
  let filtered = catalog;
  if (filterText) {
    const q = filterText.toLowerCase();
    filtered = catalog.filter(t => 
      String(t.id).includes(q) || 
      (t.description && t.description.toLowerCase().includes(q)) ||
      (t.calle && t.calle.toLowerCase().includes(q)) ||
      String(t.route_id).includes(q)
    );
  }

  let asignados = [];
  try {
    const raw = userObj && userObj.assigned_tramos ? userObj.assigned_tramos : [];
    asignados = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch(e) {}
  if (!Array.isArray(asignados)) asignados = [];

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">No se encontraron tramos.</div>';
    return;
  }

  const grouped = {};
  filtered.forEach(t => {
    const rid = t.route_id || 'Otras';
    if (!grouped[rid]) grouped[rid] = [];
    grouped[rid].push(t);
  });

  let html = '';
  for (const rid of Object.keys(grouped).sort((a,b)=>Number(a)-Number(b))) {
    const isMainRoute = userObj && (Number(userObj.current_route_id) === Number(rid) || Number(userObj.current_route_id_2) === Number(rid));
    const bgColor = isMainRoute ? '#e0f2fe' : '#f8fafc';
    html += `<div style="background: ${bgColor}; padding: 8px 12px; font-weight: bold; font-size: 13px; color: #0f172a; border-bottom: 1px solid #cbd5e1; position: sticky; top: 0; z-index: 10;">
      Ruta ${rid} ${isMainRoute ? '(Asignada a este Controlador)' : ''}
    </div>`;
    
    html += grouped[rid].map(t => {
      const isChecked = asignados.includes(t.id) || asignados.includes(String(t.id)) || asignados.includes(Number(t.id));
      return `
      <label style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background 0.2s;">
        <input type="checkbox" class="modal-tramo-checkbox" value="${t.id}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; accent-color: #0f172a; width: 16px; height: 16px;">
        <div style="font-size: 13px; color: #334155; line-height: 1.4;">
          <strong style="color: #0f172a;">T${t.id}:</strong> ${t.description || t.calle || ''}
        </div>
      </label>`;
    }).join('');
  }
  container.innerHTML = html;
}

function filterTramosInModal() {
  const input = document.getElementById('search-tramos-modal');
  const user = (window.users || []).find(u => Number(u.id) === Number(selectedTramosUserId));
  if (user && input) {
    renderTramosInModal(user, input.value);
  }
}

async function confirmAssignTramos(event) {
  event.preventDefault();
  if (!selectedTramosUserId) return;

  const user = (window.users || []).find(u => Number(u.id) === Number(selectedTramosUserId));
  if (!user) return;

  const checkboxes = document.querySelectorAll('.modal-tramo-checkbox:checked');
  const tramosSeleccionados = Array.from(checkboxes).map(cb => parseInt(cb.value));

  try {
    const response = await fetch(`${API_URL}/users/${selectedTramosUserId}/route`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        route_id: user.current_route_id || null,
        route_id_2: user.current_route_id_2 || null,
        tramos: tramosSeleccionados
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'No se pudo guardar la asignación');
    }

    showToast('Tramos asignados correctamente', 'success');
    closeAssignTramosModal();
    loadRoutes(); // Recargar rutas y usuarios
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

window.openAssignTramosModal = openAssignTramosModal;
window.closeAssignTramosModal = closeAssignTramosModal;
window.filterTramosInModal = filterTramosInModal;

window.openTicketsForZone = async function(routeId) {
  document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
  const targetNav = document.querySelector(`.nav-item[data-section='tickets']`);
  if (targetNav) targetNav.classList.add('active');
  showSection('tickets');
  
  // Set the date filter to today
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  if (typeof loadTickets === 'function') {
    const filters = {
      zone: routeId,
      date_from: dateStr,
      date_to: dateStr
    };
    await loadTickets(filters);
  }
};


window.openMonitoringHistory = async function(userId, userName) {
  const modal = document.getElementById('monitoring-history-modal');
  const tbody = document.getElementById('monitoring-history-tbody');
  const nameEl = document.getElementById('history-controller-name');
  
  nameEl.innerHTML = "Cargando datos de " + userName + "...";
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Cargando...</td></tr>';
  modal.style.display = 'flex';
  
  try {
    // 1. Fetch Monitoring
    const resMon = await fetch(`${API_URL}/monitoring?user_id=${userId}&per_page=100`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const dataMon = resMon.ok ? await resMon.json() : { monitoring: [] };
    const items = dataMon.monitoring || [];
    
    // 2. Fetch User Stats
    const resUser = await fetch(`${API_URL}/users/${userId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const user = resUser.ok ? await resUser.json() : null;
    
    // 3. Fetch Today's Tickets
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    
    const resTix = await fetch(`${API_URL}/tickets?controller=${userId}&date_from=${dateStr}&date_to=${dateStr}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const dataTix = resTix.ok ? await resTix.json() : { total: 0 };
    const totalTickets = dataTix.total || 0;
    
    // Calculations
    let minTranscurridos = 0;
    if (user && user.shift_start) {
       const startD = new Date(user.shift_start + (user.shift_start.endsWith('Z') ? '' : 'Z'));
       minTranscurridos = Math.max(0, Math.floor((new Date() - startD) / 60000));
    }
    
    let minFuera = 0;
    if (user) {
        let totalOffSecs = user.off_route_seconds || 0;
        if (user.last_ping_status === 'off_zone' && user.last_ping_time) {
            const lastPing = new Date(user.last_ping_time + (user.last_ping_time.endsWith('Z') ? '' : 'Z'));
            totalOffSecs += Math.max(0, Math.floor((new Date() - lastPing) / 1000));
        }
        minFuera = Math.floor(totalOffSecs / 60);
    }
    
    let headerHTML = `
      <div style="margin-bottom: 25px;">
        <h3 style="margin:0 0 15px 0; font-size: 24px; color:#0f172a;">Registro Diario: ${userName}</h3>
        
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 25px;">
          <div style="background:#f1f5f9; padding:20px; border-radius:12px; border: 1px solid #e2e8f0; text-align:center; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="color:#64748b; font-size:13px; font-weight:700; letter-spacing:0.5px; margin-bottom:5px;">EN TURNO</div>
            <div style="color:#0f172a; font-weight:800; font-size:26px;">${minTranscurridos} <span style="font-size:16px; font-weight:600; color:#475569;">min</span></div>
          </div>
          
          <div style="background:#fef2f2; padding:20px; border-radius:12px; border: 1px solid #fecaca; text-align:center; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="color:#ef4444; font-size:13px; font-weight:700; letter-spacing:0.5px; margin-bottom:5px;">FUERA DE ZONA</div>
            <div style="color:#991b1b; font-weight:800; font-size:26px;">${minFuera} <span style="font-size:16px; font-weight:600; color:#ef4444;">min</span></div>
          </div>
          
          <div style="background:#f0fdfa; padding:20px; border-radius:12px; border: 1px solid #ccfbf1; text-align:center; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="color:#0d9488; font-size:13px; font-weight:700; letter-spacing:0.5px; margin-bottom:5px;">MULTAS REALIZADAS</div>
            <div style="color:#115e59; font-weight:800; font-size:26px;">${totalTickets}</div>
          </div>
        </div>

        <div style="font-size: 15px; color: #334155; background: #f8fafc; padding: 15px 20px; border-radius: 8px; border-left: 4px solid #0284c7;">
          <div style="margin-bottom: 8px;">
            <strong style="color: #0f172a;">Ruta Asignada Principal:</strong> 
            <span style="font-weight:500; margin-left:5px;">${user && user.current_route_id ? 'Ruta ' + user.current_route_id : '<span style="color:#94a3b8; font-style:italic;">Ninguna asignada</span>'}</span>
          </div>
          <div>
            <strong style="color: #0f172a;">Tramos de Apoyo Activos:</strong> 
            <span style="font-weight:500; margin-left:5px;">${user && user.assigned_tramos && user.assigned_tramos.length > 0 ? user.assigned_tramos.join(', ') : '<span style="color:#94a3b8; font-style:italic;">Ninguno</span>'}</span>
          </div>
        </div>
      </div>
      <h4 style="font-size: 16px; color:#0f172a; margin-bottom:10px; padding-bottom:5px; border-bottom: 2px solid #e2e8f0;">Registro GPS Detallado</h4>
    `;
    
    const wrapper = document.getElementById('history-controller-name-wrapper');
    if (wrapper) {
      wrapper.innerHTML = `
        <h4 id="history-controller-name" style="display:none;"></h4>
        ${headerHTML}
      `;
    }
    
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No hay registros hoy.</td></tr>';
      return;
    }
    
    tbody.innerHTML = items.map(m => {
      const time = new Date(m.timestamp).toLocaleTimeString();
      let statusLabel = 'Sin datos';
      if (m.status === 'off_zone') statusLabel = 'Fuera de Zona';
      else if (m.status === 'active') statusLabel = 'En Ruta';
      else if (m.status) statusLabel = m.status;
      
      return `
        <tr>
          <td>${time}</td>
          <td><span class="badge ${m.status === 'off_zone' ? 'badge-danger' : (m.status === 'active' ? 'badge-success' : 'badge-info')}">${statusLabel}</span></td>
          <td>Ruta ${m.route_id || '-'}</td>
        </tr>
      `;
    }).join('');
    
  } catch (err) {
    nameEl.innerHTML = "Error";
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">No se pudo cargar el historial.</td></tr>';
  }
};


window.navigateFromCard = function(section) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const targetNav = document.querySelector(`.nav-item[data-section='${section}']`);
  if (targetNav) targetNav.classList.add('active');
  showSection(section);
};
