# SEMERTAZ - Sistema de Monitoreo y Control

Sistema completo de gestión y monitoreo de controladores de tránsito con dashboard interactivo, gestión de rutas, multas y usuarios.

## Estructura del Proyecto

```
Pacte 2/
├── backend/                       # Backend Flask (API)
│   ├── app.py                    # Aplicación principal
│   ├── models.py                 # Modelos de base de datos
│   ├── config.py                 # Configuración
│   ├── requirements.txt           # Dependencias Python
│   ├── .env.example              # Variables de entorno
│   ├── run.bat                   # Script para iniciar (Windows)
│   └── semertaz.db               # Base de datos SQLite (se crea al iniciar)
│
├── frontend/                      # Frontend (HTML/CSS/JS)
│   ├── index.html                # Redirección a login
│   ├── auth/
│   │   └── login.html            # Página de login
│   └── dashboard/
│       ├── index.html            # Panel principal
│       ├── app.js                # Lógica del panel
│       └── styles.css            # Estilos
│
└── README.md                      # Este archivo

```

## Instalación y Configuración

### Requisitos
- Python 3.7+
- Node.js (solo para el servidor HTTP local)

### Pasos de Instalación

#### 1. Backend (Python Flask)

```bash
# Ir a la carpeta del backend
cd backend

# Instalar dependencias
pip install -r requirements.txt

# En Windows, ejecutar:
run.bat

# O en Linux/Mac:
python app.py
```

El backend estará disponible en `http://localhost:5000`

#### 2. Frontend (HTTP Server)

```bash
# En la carpeta raíz del proyecto
npx http-server -p 8000

# Abre automáticamente en: http://localhost:8000/frontend/
```

O accede directamente a:
- **Login:** http://localhost:8000/frontend/auth/login.html
- **Dashboard:** http://localhost:8000/frontend/dashboard/index.html

## Credenciales de Prueba

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| admin | 123456 | Administrador |
| supervisor1 | 123456 | Supervisor |
| controller1 | 123456 | Controlador |
| controller2 | 123456 | Controlador |

## Funcionalidades Implementadas

### 🏠 Dashboard
- Estadísticas en tiempo real
- Controladores activos
- Multas registradas
- Monitoreo de zonas
- Actividad reciente

### 📍 Monitoreo
- Vista de controladores activos
- Ubicación en tiempo real
- Estado de controladores
- Filtros por zona y estado
- Alertas de fuera de zona

### 🛣️ Gestión de Rutas
- CRUD completo de rutas
- Crear nuevas rutas
- Editar rutas existentes
- Eliminar rutas
- Búsqueda y filtrado

### 📄 Gestión de Multas
- Registro de multas
- Búsqueda por placa
- Filtros por estado
- Descarga de reportes
- Historial completo

### 👥 Gestión de Usuarios
- CRUD de usuarios
- Crear nuevos usuarios
- Editar perfiles
- Activar/desactivar usuarios
- Asignación de roles

### 🔐 Autenticación
- Login seguro con JWT
- Protección de endpoints
- Cierre de sesión
- Control de acceso por rol

## Endpoints de API

### Autenticación
```
POST   /api/auth/login              - Iniciar sesión
POST   /api/auth/register           - Registro de usuario
GET    /api/auth/me                 - Obtener usuario actual
```

### Usuarios
```
GET    /api/users                   - Listar usuarios
GET    /api/users/<id>              - Obtener usuario
POST   /api/users                   - Crear usuario
PUT    /api/users/<id>              - Actualizar usuario
DELETE /api/users/<id>              - Eliminar usuario
```

### Rutas
```
GET    /api/routes                  - Listar rutas
GET    /api/routes/<id>             - Obtener ruta
POST   /api/routes                  - Crear ruta
PUT    /api/routes/<id>             - Actualizar ruta
DELETE /api/routes/<id>             - Eliminar ruta
```

### Monitoreo
```
GET    /api/monitoring              - Listar monitoreo
POST   /api/monitoring              - Crear registro
GET    /api/monitoring/off-zone     - Controladores fuera de zona
```

### Multas
```
GET    /api/tickets                 - Listar multas
GET    /api/tickets/<id>            - Obtener multa
POST   /api/tickets                 - Crear multa
PUT    /api/tickets/<id>            - Actualizar multa
```

### Dashboard
```
GET    /api/dashboard/stats         - Estadísticas del dashboard
```

## Variables de Entorno

Crea un archivo `.env` en la carpeta `backend`:

```env
FLASK_ENV=development
FLASK_APP=app.py
SECRET_KEY=tu_clave_secreta_aqui_muy_larga_y_aleatoria
JWT_SECRET_KEY=tu_clave_jwt_secreta_aqui
DATABASE_URL=sqlite:///semertaz.db
```

## Estructura de Base de Datos

### Tabla: users
- id (PK)
- username (único)
- email (único)
- password_hash
- full_name
- role (admin, supervisor, user)
- is_active
- created_at, updated_at

### Tabla: routes
- id (PK)
- name
- description
- start_point
- end_point
- distance_km
- estimated_time
- status
- created_at, updated_at

### Tabla: monitoring
- id (PK)
- user_id (FK)
- route_id (FK)
- latitude, longitude
- status
- timestamp

### Tabla: tickets
- id (PK)
- user_id (FK)
- route_id (FK)
- violation_type
- description
- amount
- license_plate
- status
- timestamp

## Características de Seguridad

✓ Contraseñas hasheadas con Werkzeug
✓ Tokens JWT para autenticación
✓ CORS configurado
✓ Validación de datos
✓ Control de acceso

## Desarrollo

Para extender las funcionalidades:

1. **Agregar nuevos modelos** → Editar `models.py`
2. **Crear nuevos endpoints** → Editar `app.py`
3. **Actualizar frontend** → Editar `semertaz-panel/app.js`

## Troubleshooting

### "Database is locked"
Cierra todas las instancias de la aplicación y borra `semertaz.db`

### "Cannot POST /api/users"
Asegúrate de enviar el header: `Authorization: Bearer <token>`

### "CORS error"
Verifica que el backend esté corriendo en `http://localhost:5000`

## Próximas Mejoras

- [ ] Integración con Google Maps
- [ ] Reportes en PDF
- [ ] Notificaciones en tiempo real
- [ ] Sistema de permisos más granular
- [ ] Backup automático
- [ ] Estadísticas avanzadas

## Soporte

Para reportar bugs o sugerencias, contacta al equipo de desarrollo.

---

**Versión:** 1.0.0  
**Última actualización:** 2025-12-11
