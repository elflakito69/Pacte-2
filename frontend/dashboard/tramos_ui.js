// Lógica de UI para Tramos (Buscador Inteligente en Modal de Usuario)

let selectedTramos = [];

function initTramosUI() {
  const searchInput = document.getElementById('tramos-search');
  const suggestionsBox = document.getElementById('tramos-suggestions');
  
  if (!searchInput) return;

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (query.length < 2) {
      suggestionsBox.style.display = 'none';
      return;
    }

    // Excluir calles de la ruta principal del usuario
    const currentRouteId = window.currentEditingUser ? window.currentEditingUser.current_route_id : null;

    let results = [];
    for (const t of window.TRAMOS_CATALOG) {
      if (Number(t.route_id) === Number(currentRouteId)) continue;
      
      const tName = t.calle || t.name || '';
      if (tName.toLowerCase().includes(query)) {
        if (!selectedTramos.find(st => st.id === t.id)) {
          results.push({ id: t.id, name: tName, routeId: t.route_id });
        }
      }
    }

    if (results.length > 0) {
      suggestionsBox.innerHTML = results.map(r => {
        const color = window.ROUTE_COLORS[r.routeId] || '#cbd5e1';
        return `
          <div class="tramo-suggestion-item" data-id="${r.id}" data-name="${r.name}" data-route="${r.routeId}" 
               style="padding: 10px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 13px; color: #1e293b;">${r.name}</span>
            <span style="background: ${color}; color: white; border-radius: 20px; padding: 2px 8px; font-size: 11px; font-weight: 600;">Ruta ${r.routeId}</span>
          </div>
        `;
      }).join('');
      suggestionsBox.style.display = 'block';

      document.querySelectorAll('.tramo-suggestion-item').forEach(item => {
        item.addEventListener('click', function() {
          addTramoToCart({
            id: this.dataset.id,
            name: this.dataset.name,
            routeId: this.dataset.route
          });
          searchInput.value = '';
          suggestionsBox.style.display = 'none';
        });
      });
    } else {
      suggestionsBox.innerHTML = '<div style="padding: 10px; font-size: 13px; color: #64748b;">No se encontraron calles.</div>';
      suggestionsBox.style.display = 'block';
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target !== searchInput && e.target !== suggestionsBox) {
      suggestionsBox.style.display = 'none';
    }
  });
}

function addTramoToCart(tramo) {
  selectedTramos.push(tramo);
  renderTramosCart();
}

function removeTramoFromCart(tramoId) {
  selectedTramos = selectedTramos.filter(t => t.id !== tramoId);
  renderTramosCart();
}

function renderTramosCart() {
  const cart = document.getElementById('tramos-cart');
  const hiddenInput = document.getElementById('edit-route-tramos');
  
  if (selectedTramos.length === 0) {
    cart.innerHTML = '<span style="color: #94a3b8; font-size: 12px; font-style: italic;">Sin tramos adicionales. Usa el buscador arriba.</span>';
    hiddenInput.value = '[]';
    return;
  }

  cart.innerHTML = selectedTramos.map(t => {
    const color = window.ROUTE_COLORS[t.routeId] || '#cbd5e1';
    return `
      <div style="background: ${color}; color: white; border-radius: 6px; padding: 4px 10px; font-size: 12px; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <span style="font-weight: 600;">R${t.routeId}:</span> ${t.name}
        <span onclick="removeTramoFromCart('${t.id}')" style="cursor: pointer; background: rgba(0,0,0,0.2); border-radius: 50%; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; margin-left: 4px;">✖</span>
      </div>
    `;
  }).join('');
  
  if(hiddenInput) hiddenInput.value = JSON.stringify(selectedTramos.map(t => t.id));
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initTramosUI, 1000);
});

function hookLoadTramosIntoRouteModal(userId) {
  selectedTramos = [];
  const user = window.users ? window.users.find(u => Number(u.id) === Number(userId)) : null;

  window.currentEditingUser = user;
  selectedTramos = [];
  try {
    const ids = (user && Array.isArray(user.assigned_tramos)) ? user.assigned_tramos : [];
    for (const t of window.TRAMOS_CATALOG) {
      if (ids.includes(t.id) || ids.includes(String(t.id)) || ids.includes(Number(t.id))) {
        selectedTramos.push({ id: t.id, name: t.calle || t.name || '', routeId: t.route_id });
      }
    }
  } catch (e) {
    console.error("Error cargando tramos", e);
  }
  renderTramosCart();
}
