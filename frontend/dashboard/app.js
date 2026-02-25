// Configuración de API
const API_URL = `${window.location.protocol}//${window.location.hostname}:5000/api`;
let authToken = null;
let currentUser = null;

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

// Verificar autenticación
document.addEventListener('DOMContentLoaded', () => {
  authToken = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');

  if (!authToken || !userStr) {
    window.location.href = '/frontend/auth/login.html';
    return;
  }

  currentUser = JSON.parse(userStr);
  initializeApp();
});

function initializeApp() {
  setupNavigation();
  setupLogout();
  setupSearch();
  loadDashboardStats();
  setupButtons();
  updateUserInfo();
}

// Actualizar información del usuario
function updateUserInfo() {
  const avatarEl = document.querySelector('.avatar span');
  if (currentUser && avatarEl) {
    const initials = (currentUser.full_name || currentUser.username)
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    avatarEl.textContent = initials;
    avatarEl.title = `${currentUser.full_name || currentUser.username} (${getRoleDisplayName(currentUser.role)})`;
  }
}

// Configurar navegación
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');
  const topbarTitle = document.getElementById('topbar-title');
  const menuToggle = document.querySelector('.menu-toggle');
  const sidebar = document.querySelector('.sidebar');

  // Control de acceso basado en roles
  navItems.forEach((item) => {
    const sectionId = item.dataset.section;

    // Ocultar secciones según permisos
    if (sectionId === 'users' && !hasPermission('manage_users')) {
      item.style.display = 'none';
      return;
    }

    if (sectionId === 'routes' && !hasPermission('manage_routes')) {
      item.style.display = 'none';
      return;
    }

    if (sectionId === 'tickets' && !hasPermission('manage_tickets')) {
      item.style.display = 'none';
      return;
    }

    // Mostrar el elemento si tiene permisos
    item.style.display = 'flex';
  });

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const sectionId = item.dataset.section;

      navItems.forEach((btn) => btn.classList.remove('active'));
      item.classList.add('active');

      views.forEach((view) => {
        view.classList.toggle('active', view.id === sectionId);
      });

      const label = item.querySelector('span:last-child').textContent.trim();
      topbarTitle.textContent = label;

      sidebar.classList.remove('open');

      // Cargar datos según la sección
      if (sectionId === 'monitor') loadMonitoring();
      if (sectionId === 'routes') loadRoutes();
      if (sectionId === 'tickets') loadTickets();
      if (sectionId === 'users') loadUsers();
    });
  });

  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
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

  // Botón "Filtrar" en multas - Para todos
  const filterBtn = document.querySelector('.btn-outline');
  if (filterBtn && filterBtn.textContent.includes('Filtrar')) {
    filterBtn.addEventListener('click', () => {
      showFilterModal();
    });
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
      newUserForm.addEventListener('submit', handleNewUserSubmit);
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

async function loadDashboardStats() {
  try {
    const response = await fetch(`${API_URL}/dashboard/stats`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();

    // Actualizar números
    const cards = document.querySelectorAll('.summary-card .summary-number');
    if (cards[0]) cards[0].textContent = data.active_controllers;
    if (cards[1]) cards[1].textContent = data.off_zone;
    if (cards[2]) cards[2].textContent = data.today_tickets;
    if (cards[3]) cards[3].textContent = data.total_users;
  } catch (error) {
    console.error('Error cargando estadísticas:', error);
  }
}

// ============= MONITOREO =============

async function loadMonitoring() {
  try {
    const response = await fetch(`${API_URL}/monitoring`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    renderMonitoringList(data.monitoring);
  } catch (error) {
    console.error('Error cargando monitoreo:', error);
  }
}

function renderMonitoringList(monitoring) {
  const listContainer = document.querySelector('.controller-list');
  if (!listContainer) return;

  listContainer.innerHTML = monitoring.slice(0, 5).map(m => `
    <li>
      <div>
        <div class="controller-name">${m.user_name}</div>
        <div class="controller-zone">${m.route_name}</div>
      </div>
      <span class="badge badge-${m.status === 'active' ? 'success' : 'warning'}">
        ${m.status === 'active' ? 'En Ruta' : 'Fuera de Zona'}
      </span>
    </li>
  `).join('');
}

// ============= RUTAS =============

async function loadRoutes() {
  try {
    const response = await fetch(`${API_URL}/routes?per_page=100`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    window.routes = data.routes; // Store for details
    renderRoutesTable(data.routes);
  } catch (error) {
    console.error('Error cargando rutas:', error);
  }
}

function renderRoutesTable(routes) {
  const tbody = document.querySelector('#routes tbody');
  if (!tbody) return;

  const canManageRoutes = hasPermission('manage_routes');

  tbody.innerHTML = routes.map(route => `
    <tr>
      <td data-label="Nombre">${route.name}</td>
      <td data-label="Trayecto">${route.start_point} - ${route.end_point}</td>
      <td data-label="Distancia">${route.distance_km} km</td>
      <td data-label="Estado">
        <span class="badge badge-${route.status === 'active' ? 'success' : 'warning'}">
          ${route.status === 'active' ? 'Activa' : 'Inactiva'}
        </span>
      </td>
      <td data-label="Tiempo">${route.estimated_time} min</td>
      ${canManageRoutes ? `
      <td class="actions-cell" data-label="Acciones">
        <button class="btn-icon" onclick="editRoute(${route.id})">✏️</button>
        <button class="btn-icon" onclick="deleteRoute(${route.id})">🗑️</button>
      </td>
      ` : '<td></td>'}
    </tr>
  `).join('');
}

function showNewRouteModal() {
  const modal = document.getElementById('new-route-modal');
  modal.style.display = 'block';
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
  const routeData = {
    name: formData.get('route-name'),
    description: formData.get('route-description') || 'Ruta nueva creada',
    start_point: formData.get('start-point'),
    end_point: formData.get('end-point'),
    distance_km: parseFloat(formData.get('distance-km')),
    estimated_time: parseInt(formData.get('estimated-time')),
    status: 'active'
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
document.getElementById('route-details-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('route-details-modal')) {
    closeDetailsModal();
  }
});

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
    renderTicketsTable(data.tickets);
  } catch (error) {
    console.error('Error cargando multas:', error);
  }
}

function renderTicketsTable(tickets) {
  const tbody = document.querySelector('#tickets tbody');
  if (!tbody) return;

  const canManageTickets = hasPermission('manage_tickets');

  tbody.innerHTML = tickets.map(ticket => `
    <tr>
      <td data-label="ID">T-${String(ticket.id).padStart(3, '0')}</td>
      <td data-label="Controlador">${ticket.user_name}</td>
      <td data-label="Placa">${ticket.license_plate || 'N/A'}</td>
      <td data-label="Infracción">${ticket.violation_type}</td>
      <td data-label="Fecha">${new Date(ticket.timestamp).toLocaleString('es-ES')}</td>
      <td data-label="Estado">
        <span class="badge badge-${ticket.status === 'pending' ? 'warning' : 'success'}">
          ${ticket.status === 'pending' ? 'Pendiente' : 'Registrada'}
        </span>
      </td>
      ${canManageTickets ? `
      <td class="actions-cell" data-label="Acciones">
        <button class="btn-icon" onclick="editTicket(${ticket.id})">✏️</button>
        <button class="btn-icon" onclick="deleteTicket(${ticket.id})">🗑️</button>
      </td>
      ` : ''}
    </tr>
  `).join('');
}

// ============= USUARIOS =============

async function loadUsers() {
  // Solo cargar usuarios si tiene permisos
  if (!hasPermission('manage_users')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/users?per_page=100`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No autorizado');

    const data = await response.json();
    renderUsersTable(data.users);
  } catch (error) {
    console.error('Error cargando usuarios:', error);
  }
}

function renderUsersTable(users) {
  const tbody = document.querySelector('#users tbody');
  if (!tbody) return;

  const canManageUsers = hasPermission('manage_users');

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
        <button class="btn-icon" onclick="editUser(${user.id})">✏️</button>
        <button class="btn-icon" onclick="deleteUser(${user.id})">🗑️</button>
      </td>
      ` : ''}
    </tr>
  `).join('');
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

async function deleteUser(userId) {
  if (!confirm('¿Eliminar este usuario?')) return;

  try {
    const response = await fetch(`${API_URL}/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('No se pudo eliminar');

    alert('Usuario eliminado');
    loadUsers();
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

function editRoute(routeId) {
  alert('Función de edición en desarrollo');
}

function editUser(userId) {
  alert('Función de edición en desarrollo');
}
