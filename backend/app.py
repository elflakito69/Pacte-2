import os

# Flask 2.3 depreca FLASK_ENV; lo retiramos para evitar advertencias en runtime.
os.environ.pop('FLASK_ENV', None)

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, decode_token
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash
from config import config
from models import db, User, Route, Monitoring, Ticket, ActivePause, Alert
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta, timezone
import logging
import sys
import json
import tempfile
from uuid import uuid4
from sqlalchemy import func, inspect, text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
EC_TZ = timezone(timedelta(hours=-5))

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
TICKETS_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'tickets')
os.makedirs(TICKETS_UPLOAD_FOLDER, exist_ok=True)
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
import io


def format_time_ago(value):
    if not value:
        return 'hace un momento'
    
    from datetime import timezone, timedelta, datetime
    ec_tz = timezone(timedelta(hours=-5))
    now = datetime.now(ec_tz)
    
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except:
            return 'hace un momento'
            
    if getattr(value, 'tzinfo', None) is None:
        value = value.replace(tzinfo=ec_tz)
        
    delta = now - value
    seconds = int(delta.total_seconds())

    if seconds < 60:
        return f"hace {max(0, seconds)} s"
    if seconds < 3600:
        return f"hace {seconds // 60} min"
    if seconds < 86400:
        return f"hace {seconds // 3600} h"
    return f"hace {seconds // 86400} d"


def ensure_alerts_schema():
    inspector = inspect(db.engine)
    if 'alerts' not in inspector.get_table_names():
        return

    columns = {column['name'] for column in inspector.get_columns('alerts')}
    if 'notified_controller' not in columns:
        db.session.execute(text('ALTER TABLE alerts ADD COLUMN notified_controller BOOLEAN DEFAULT 0'))
        db.session.commit()

# Crear aplicación
app = Flask(__name__)

# Configuración
env = os.getenv('APP_ENV', os.getenv('FLASK_ENV', 'development'))
if env == 'development':
    app.config['DEBUG'] = True
app.config.from_object(config[env])

# Inicializar extensiones
db.init_app(app)
jwt = JWTManager(app)
CORS(app)
socketio_async_mode = 'threading' if sys.version_info >= (3, 13) else 'eventlet'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=socketio_async_mode)

# Servir archivos del frontend
frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
ROUTES_GEOJSON_PATH = os.path.join(frontend_dir, 'assets', 'semertaz_routes.geojson')

@app.route('/')
def index():
    return send_from_directory(frontend_dir, 'index.html')

@app.route('/frontend/<path:filename>')
def serve_frontend(filename):
    return send_from_directory(frontend_dir, filename)

@app.route('/api/routes/geojson', methods=['POST'])
@jwt_required()
def save_routes_geojson():
    """Persistir las geometrías dibujadas por un administrador con respaldo."""
    if not get_admin_user():
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden editar rutas.'}), 403

    geojson = request.get_json(silent=True)
    if not isinstance(geojson, dict) or geojson.get('type') != 'FeatureCollection':
        return jsonify({'message': 'Se esperaba una FeatureCollection GeoJSON válida'}), 400

    features = geojson.get('features')
    if not isinstance(features, list):
        return jsonify({'message': 'El GeoJSON debe contener una lista de features'}), 400

    for feature in features:
        geometry = feature.get('geometry') if isinstance(feature, dict) else None
        if not isinstance(geometry, dict) or geometry.get('type') not in ('LineString', 'Polygon'):
            return jsonify({'message': 'Solo se permiten geometrías LineString y Polygon'}), 400

    if not os.path.isfile(ROUTES_GEOJSON_PATH):
        return jsonify({'message': 'No existe el archivo GeoJSON de rutas'}), 500

    backup_path = ROUTES_GEOJSON_PATH + '.bak'
    try:
        with open(ROUTES_GEOJSON_PATH, 'rb') as source:
            original = source.read()
        with open(backup_path, 'wb') as backup:
            backup.write(original)

        fd, temp_path = tempfile.mkstemp(prefix='semertaz_routes_', suffix='.geojson', dir=os.path.dirname(ROUTES_GEOJSON_PATH))
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as target:
                json.dump(geojson, target, ensure_ascii=True, indent=2)
                target.write('\n')
            os.replace(temp_path, ROUTES_GEOJSON_PATH)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    except (OSError, TypeError, ValueError) as error:
        logger.exception('Error guardando GeoJSON: %s', error)
        return jsonify({'message': 'No se pudo guardar el GeoJSON'}), 500

    return jsonify({'message': 'GeoJSON actualizado', 'backup': os.path.basename(backup_path)}), 200

# ============= AUTENTICACIÓN =============

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Endpoint de login"""
    try:
        data = request.get_json(silent=True) or {}

        if not data.get('username') or not data.get('password'):
            return jsonify({'message': 'Credenciales incompletas'}), 400

        user = User.query.filter_by(username=data['username']).first()

        if not user or not user.check_password(data['password']):
            return jsonify({'message': 'Credenciales inválidas'}), 401

        if not user.is_active:
            return jsonify({'message': 'Usuario inactivo'}), 401

        # Registrar auditoría de inicio de sesión para TODOS los roles
        raw_lat = data.get('latitude')
        raw_lon = data.get('longitude')
        try:
            lat = float(raw_lat) if raw_lat is not None else None
            lon = float(raw_lon) if raw_lon is not None else None
        except (ValueError, TypeError):
            lat, lon = None, None

        role_name = 'Controlador' if user.role == 'user' else ('Supervisor' if user.role == 'supervisor' else 'Administrador')
        login_alert = Alert(
            user_id=user.id,
            type='login_info',
            message=f'Inicio de sesión de {role_name}',
            latitude=lat,
            longitude=lon,
            status='unread'
        )
        db.session.add(login_alert)
        db.session.commit()

        access_token = create_access_token(identity=str(user.id))
        return jsonify({
            'message': 'Login exitoso',
            'access_token': access_token,
            'user': user.to_dict()
        }), 200
    except Exception as e:
        logger.exception(f"Error en login: {str(e)}")
        return jsonify({'message': 'Error interno del servidor'}), 500

@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Obtener usuario actual"""
    user_id = int(get_jwt_identity())
    user = db.session.get(User, user_id)
    
    if not user:
        return jsonify({'message': 'Usuario no encontrado'}), 404
    
    return jsonify(user.to_dict()), 200

# ============= USUARIOS =============

def get_admin_user():
    current_user = db.session.get(User, int(get_jwt_identity()))
    if not current_user or current_user.role != 'admin':
        return None
    return current_user

@app.route('/api/users', methods=['GET'])
@jwt_required()
def get_users():
    """Obtener todos los usuarios"""
    current_user = db.session.get(User, int(get_jwt_identity()))
    if not current_user or current_user.role not in ['admin', 'supervisor']:
        return jsonify({'message': 'Acceso denegado.'}), 403

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    search = request.args.get('search', '', type=str)
    
    query = User.query
    
    if search:
        query = query.filter(
            (User.username.ilike(f'%{search}%')) |
            (User.full_name.ilike(f'%{search}%')) |
            (User.email.ilike(f'%{search}%'))
        )
    
    paginated = query.paginate(page=page, per_page=per_page)
    
    return jsonify({
        'users': [user.to_dict() for user in paginated.items],
        'total': paginated.total,
        'pages': paginated.pages,
        'current_page': page
    }), 200

@app.route('/api/users', methods=['POST'])
@jwt_required()
def create_user():
    """Crear un nuevo usuario"""
    if not get_admin_user():
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden gestionar usuarios.'}), 403

    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Datos incompletos'}), 400
    
    # Verificar si el usuario ya existe
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'message': 'Nombre de usuario ya existe'}), 400
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'message': 'Email ya registrado'}), 400
    
    user = User(
        username=data['username'],
        email=data['email'],
        full_name=data.get('full_name', ''),
        role=data.get('role', 'user')
    )
    user.set_password(data['password'])
    
    db.session.add(user)
    db.session.commit()
    
    return jsonify({
        'message': 'Usuario creado exitosamente',
        'user': user.to_dict()
    }), 201

@app.route('/api/users/<int:user_id>', methods=['GET'])
@jwt_required()
def get_user(user_id):
    """Obtener un usuario específico"""
    if not get_admin_user():
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden gestionar usuarios.'}), 403

    user = db.session.get(User, user_id)
    
    return jsonify(user.to_dict()), 200

@app.route('/api/users/<int:user_id>', methods=['PUT'])
@jwt_required()
def update_user(user_id):
    """Actualizar usuario"""
    if not get_admin_user():
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden gestionar usuarios.'}), 403

    user = db.session.get(User, user_id)
    
    if not user:
        return jsonify({'message': 'Usuario no encontrado'}), 404
    
    data = request.get_json()

    if not isinstance(data, dict):
        return jsonify({'message': 'Datos inválidos'}), 400
    if data.get('role') not in (None, 'admin', 'supervisor', 'user'):
        return jsonify({'message': 'Rol inválido'}), 400
    if data.get('email') and User.query.filter(User.email == data['email'], User.id != user_id).first():
        return jsonify({'message': 'Email ya registrado'}), 409
    if data.get('password') and len(data['password']) < 6:
        return jsonify({'message': 'La contraseña debe tener al menos 6 caracteres'}), 400
    
    user.full_name = data.get('full_name', user.full_name)
    user.email = data.get('email', user.email)
    user.role = data.get('role', user.role)
    user.is_active = data.get('is_active', user.is_active)
    if 'tramos' in data:
        import json
        user.assigned_tramos = json.dumps(data['tramos'])
    
    if 'password' in data and data['password']:
        user.set_password(data['password'])
    
    db.session.commit()
    
    return jsonify({
        'message': 'Usuario actualizado',
        'user': user.to_dict()
    }), 200

@app.route('/api/users/<int:user_id>/route', methods=['PUT'])
@jwt_required()
def assign_user_route(user_id):
    """Asignar una ruta actual a un controlador"""
    current_user = db.session.get(User, int(get_jwt_identity()))
    if not current_user or current_user.role not in ['admin', 'supervisor']:
        return jsonify({'message': 'Acceso denegado. Solo administradores o supervisores pueden gestionar rutas.'}), 403


    user = db.session.get(User, user_id)

    if not user:
        return jsonify({'message': 'Usuario no encontrado'}), 404

    data = request.get_json() or {}
    route_id = data.get('route_id')
    route_id_2 = data.get('route_id_2')
    tramos = data.get('tramos', [])

    route = None
    route_2 = None
    if route_id not in ('', None):
        route = db.session.get(Route, route_id)
        if not route:
            return jsonify({'message': 'Ruta principal no encontrada'}), 404
    if route_id_2 not in ('', None):
        route_2 = db.session.get(Route, route_id_2)
        if not route_2:
            return jsonify({'message': 'Ruta secundaria no encontrada'}), 404
    if route_id and route_id_2 and int(route_id) == int(route_id_2):
        return jsonify({'message': 'Las rutas principal y secundaria deben ser diferentes'}), 400

    user.current_route_id = int(route_id) if route_id not in ('', None) else None
    user.current_route_id_2 = int(route_id_2) if route_id_2 not in ('', None) else None
    # Si se envian tramos, guardarlos. Si no, y AMBAS rutas son None, purgar tramos automaticamente
    if tramos:
        user.assigned_tramos = json.dumps(tramos)
    elif route_id in ('', None) and route_id_2 in ('', None):
        # Purga automatica: sin rutas = sin tramos de apoyo
        user.assigned_tramos = None
    else:
        # Mantener tramos existentes si no se enviaron nuevos pero tiene ruta
        if not tramos:
            user.assigned_tramos = None

    if route_id not in ('', None) or route_id_2 not in ('', None):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        user.shift_start = now
        user.off_route_seconds = 0
        user.last_ping_time = now
        user.last_ping_status = 'active'

    db.session.commit()

    return jsonify({
        'message': 'Ruta asignada correctamente',
        'user': user.to_dict()
    }), 200

@app.route('/api/users/me/route', methods=['GET'])
@jwt_required()
def get_my_route():
    current_user_id = get_jwt_identity()
    user = db.session.get(User, current_user_id)
    if not user or (not user.current_route_id and not user.current_route_id_2):
        return jsonify({'message': 'Sin ruta asignada', 'code': 'NO_ROUTE'}), 404

    route = db.session.get(Route, user.current_route_id) if user.current_route_id else None
    route_2 = db.session.get(Route, user.current_route_id_2) if user.current_route_id_2 else None
    
    if not route and not route_2:
        return jsonify({'message': 'La ruta asignada ya no existe. Solicita reasignación.', 'code': 'ROUTE_DELETED'}), 404

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    circulating_seconds = 0
    if user.shift_start:
        circulating_seconds = max(0, int((now - user.shift_start).total_seconds()))

    route_data = None
    if route:
        route_data = route.to_dict()
        route_data['minutos_circulando'] = circulating_seconds // 60
        route_data['minutos_fuera'] = int(_get_real_off_route_seconds(user) / 60)
    elif route_2:
        # Si es SOLO secundario, mandamos route_2 como route principal para que la UI no colapse
        route_data = route_2.to_dict()
        route_data['minutos_circulando'] = circulating_seconds // 60
        route_data['minutos_fuera'] = int(_get_real_off_route_seconds(user) / 60)
        route_2 = None # Ya lo mandamos como principal

    route_2_data = None
    if route_2:
        route_2_data = route_2.to_dict()
        route_2_data['minutos_circulando'] = circulating_seconds // 60
        route_2_data['minutos_fuera'] = int(_get_real_off_route_seconds(user) / 60)

    # Incluir tramos de apoyo asignados
    tramos_list = []
    if user.assigned_tramos:
        try:
            tramos_list = json.loads(user.assigned_tramos) if isinstance(user.assigned_tramos, str) else user.assigned_tramos
        except (json.JSONDecodeError, TypeError):
            tramos_list = []

    return jsonify({'route': route_data, 'route_2': route_2_data, 'assigned_tramos': tramos_list}), 200

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@jwt_required()
def delete_user(user_id):
    """Eliminar usuario"""
    if not get_admin_user():
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden gestionar usuarios.'}), 403

    user = db.session.get(User, user_id)
    
    if not user:
        return jsonify({'message': 'Usuario no encontrado'}), 404
    
    db.session.delete(user)
    db.session.commit()
    
    return jsonify({'message': 'Usuario eliminado'}), 200

# ============= RUTAS =============

def _get_real_off_route_seconds(user):
    from datetime import datetime
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    total = user.off_route_seconds or 0
    if user.last_ping_status == 'off_zone' and user.last_ping_time:
        pending = max(0, int((now - user.last_ping_time).total_seconds()))
        total += pending
    return total

@app.route('/api/routes', methods=['GET'])
@jwt_required()
def get_routes():
    """Obtener todas las rutas"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 6, type=int)
    search = request.args.get('search', '', type=str)
    status = request.args.get('status', '', type=str)
    
    query = Route.query
    
    if search:
        query = query.filter(
            (Route.name.ilike(f'%{search}%')) |
            (Route.description.ilike(f'%{search}%'))
        )
    
    if status:
        query = query.filter_by(status=status)
    
    paginated = query.paginate(page=page, per_page=per_page)
    
    routes = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for route in paginated.items:
        route_data = route.to_dict()
        assigned_user = User.query.filter(
            (User.current_route_id == route.id) |
            (User.current_route_id_2 == route.id)
        ).first()
        if assigned_user:
            circulating_seconds = 0
            if assigned_user.shift_start:
                circulating_seconds = max(0, int((now - assigned_user.shift_start).total_seconds()))
            route_data['minutos_circulando'] = circulating_seconds // 60
            route_data['minutos_fuera'] = int(_get_real_off_route_seconds(assigned_user) / 60)
            route_data['assigned_user_name'] = assigned_user.full_name or assigned_user.username
            route_data['assigned_user_id'] = assigned_user.id
        else:
            route_data['minutos_circulando'] = 0
            route_data['minutos_fuera'] = 0
        routes.append(route_data)

    return jsonify({
        'routes': routes,
        'total': paginated.total,
        'pages': paginated.pages,
        'current_page': page
    }), 200

@app.route('/api/routes', methods=['POST'])
@jwt_required()
def create_route():
    """Crear nueva ruta"""
    data = request.get_json()
    
    if not all(k in data for k in ('name', 'start_point', 'end_point', 'distance_km')):
        logger.warning("Intento de crear ruta con datos incompletos")
        return jsonify({'message': 'Datos incompletos'}), 400
    
    try:
        if Route.query.filter_by(name=data['name']).first():
            return jsonify({'message': 'La ruta ya existe'}), 409

        route = Route(
            name=data['name'],
            description=data.get('description', ''),
            start_point=data['start_point'],
            end_point=data['end_point'],
            distance_km=data['distance_km'],
            estimated_time=data.get('estimated_time', 0),
            status=data.get('status', 'active')
        )
        
        db.session.add(route)
        db.session.commit()
        
        # INYECTAR LA NUEVA RUTA EN EL ARCHIVO GEOJSON (SI TIENE GEOMETRY)
        if 'geometry' in data:
            import os, json, shutil
            geojson_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'assets', 'semertaz_routes.geojson'))
            backup_path = geojson_path + '.bak'
            try:
                if os.path.exists(geojson_path):
                    shutil.copy(geojson_path, backup_path) # Copia de seguridad
                    with open(geojson_path, 'r', encoding='utf-8') as f:
                        gj = json.load(f)
                    
                    new_feature = {
                        "type": "Feature",
                        "properties": {
                            "id": f"R{route.id}",
                            "nombre": route.name,
                            "stroke": "#00f2fe"
                        },
                        "geometry": data['geometry']
                    }
                    gj.setdefault('features', []).append(new_feature)
                    
                    with open(geojson_path, 'w', encoding='utf-8') as f:
                        json.dump(gj, f, indent=2)
            except Exception as geo_err:
                logger.error(f"Error inyectando en geojson: {geo_err}")
                
        logger.info(f"Ruta creada: {route.name}")
        return jsonify({
            'message': 'Ruta creada exitosamente',
            'route': route.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error creando ruta: {str(e)}")
        return jsonify({'message': 'Error interno del servidor'}), 500


@app.route('/api/routes/<int:route_id>', methods=['PUT'])
@jwt_required()
def update_route(route_id):
    """Actualizar ruta"""
    current_user = db.session.get(User, int(get_jwt_identity()))
    if not current_user or current_user.role not in ['admin', 'supervisor']:
        return jsonify({'message': 'Acceso denegado. Solo administradores o supervisores pueden editar rutas.'}), 403

    route = db.session.get(Route, route_id)
    
    if not route:
        return jsonify({'message': 'Ruta no encontrada'}), 404
    
    data = request.get_json()
    
    route.name = data.get('name', route.name)
    route.description = data.get('description', route.description)
    route.start_point = data.get('start_point', route.start_point)
    route.end_point = data.get('end_point', route.end_point)
    route.distance_km = data.get('distance_km', route.distance_km)
    route.estimated_time = data.get('estimated_time', route.estimated_time)
    route.status = data.get('status', route.status)
    if 'is_active' in data:
        route.is_active = bool(data['is_active'])
    
    db.session.commit()
    
    logger.info(f"Ruta actualizada: {route.name}")
    return jsonify({
        'message': 'Ruta actualizada',
        'route': route.to_dict()
    }), 200

@app.route('/api/routes/<int:route_id>', methods=['DELETE'])
@jwt_required()
def delete_route(route_id):
    """Eliminar ruta"""
    if not get_admin_user():
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden gestionar rutas.'}), 403
    route = db.session.get(Route, route_id)
    
    if not route:
        return jsonify({'message': 'Ruta no encontrada'}), 404
    
    db.session.delete(route)
    db.session.commit()
    
    logger.info(f"Ruta eliminada: {route.name}")
    return jsonify({'message': 'Ruta eliminada'}), 200

# ============= MONITOREO EN TIEMPO REAL =============

@socketio.on('controller_location')
def handle_controller_location(data):
    """Recibe la ubicación del controlador y la difunde a los clientes conectados."""
    try:
        user_id = data.get('user_id')
        route_id = data.get('route_id')
        latitude = data.get('latitude')
        longitude = data.get('longitude')

        monitoring = Monitoring(
            user_id=user_id,
            route_id=route_id,
            latitude=latitude,
            longitude=longitude,
            status=data.get('status', 'active')
        )
        db.session.add(monitoring)
        db.session.commit()

        user = db.session.get(User, user_id)
        emit('live_update', {
            'user_id': user_id,
            'user_name': user.full_name if user else f'Controller {user_id}',
            'route_id': route_id,
            'latitude': latitude,
            'longitude': longitude,
            'status': data.get('status', 'active'),
            'timestamp': datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        })
    except Exception as e:
        logger.exception(f"Error WebSocket: {str(e)}")
        db.session.rollback()

@app.route('/api/monitoring/live', methods=['GET'])
@jwt_required()
def get_live_positions():
    """Retorna la última posición conocida de cada controlador activo."""
    subq = db.session.query(
        Monitoring.user_id,
        func.max(Monitoring.timestamp).label('max_ts')
    ).group_by(Monitoring.user_id).subquery()

    latest = db.session.query(Monitoring).join(
        subq,
        (Monitoring.user_id == subq.c.user_id) & (Monitoring.timestamp == subq.c.max_ts)
    ).all()

    result = []
    for m in latest:
        user = db.session.get(User, m.user_id)
        if user and user.role == 'user' and user.is_active:
            result.append({
                'user_id': m.user_id,
                'user_name': user.full_name or user.username,
                'route_id': m.route_id,
                'current_route_id': user.current_route_id,
                'assigned_tramos': user.assigned_tramos,
                'latitude': m.latitude,
                'longitude': m.longitude,
                'status': m.status,
                'timestamp': m.timestamp.isoformat()
            })

    return jsonify({'controllers': result}), 200

@app.route('/api/monitoring', methods=['GET'])
@jwt_required()
def get_monitoring():
    """Obtener datos de monitoreo"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    status = request.args.get('status', '', type=str)
    user_id = request.args.get('user_id', type=int)
    
    query = Monitoring.query.order_by(Monitoring.timestamp.desc())

    if user_id:
        query = query.filter(Monitoring.user_id == user_id)
        latest = query.first()
        monitoring_items = [latest.to_dict()] if latest else []
        return jsonify({
            'monitoring': monitoring_items,
            'total': len(monitoring_items),
            'pages': 1,
            'current_page': 1
        }), 200
    
    if status:
        query = query.filter_by(status=status)
    
    paginated = query.paginate(page=page, per_page=per_page)
    
    return jsonify({
        'monitoring': [m.to_dict() for m in paginated.items],
        'total': paginated.total,
        'pages': paginated.pages,
        'current_page': page
    }), 200

@app.route('/api/monitoring', methods=['POST'])
@jwt_required()
def create_monitoring():
    """Crear registro de monitoreo"""
    try:
        data = request.get_json()
        
        if not all(k in data for k in ('user_id', 'route_id', 'latitude', 'longitude')):
            return jsonify({'message': 'Datos incompletos'}), 400

        user = db.session.get(User, data['user_id'])
        if not user:
            return jsonify({'message': 'Usuario no encontrado'}), 404

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if user.last_ping_time and user.last_ping_status == 'off_zone':
            elapsed_seconds = max(0, int((now - user.last_ping_time).total_seconds()))
            user.off_route_seconds = (user.off_route_seconds or 0) + elapsed_seconds
        user.last_ping_time = now
        user.last_ping_status = data.get('status', 'active')
        
        monitoring = Monitoring(
            user_id=data['user_id'],
            route_id=data['route_id'],
            latitude=data['latitude'],
            longitude=data['longitude'],
            status=data.get('status', 'active')
        )
        
        db.session.add(monitoring)

        if data.get('status') == 'off_zone':
            alert = Alert(
                user_id=data['user_id'],
                type='fuera_de_ruta',
                message='El controlador se ha desviado de su ruta asignada',
                notified_controller=False
            )
            db.session.add(alert)

        db.session.commit()

        socketio.emit('live_update', {
            'user_id': data['user_id'],
            'user_name': user.full_name if user else f'Controller {data["user_id"]}',
            'route_id': data['route_id'],
            'latitude': data['latitude'],
            'longitude': data['longitude'],
            'status': data.get('status', 'active'),
            'timestamp': datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        })
        
        return jsonify({
            'message': 'Monitoreo registrado',
            'monitoring': monitoring.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Error interno del servidor'}), 500

@app.route('/api/monitoring/off-zone', methods=['GET'])
@jwt_required()
def get_off_zone_monitoring():
    """Obtener controladores fuera de zona"""
    monitoring = Monitoring.query.filter_by(status='off_zone').all()
    
    return jsonify({
        'count': len(monitoring),
        'monitoring': [m.to_dict() for m in monitoring]
    }), 200

# ============= MULTAS =============

@app.route('/api/tickets', methods=['GET'])
@jwt_required()
def get_tickets():
    """Obtener todas las multas"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    status = request.args.get('status', '', type=str)
    search = request.args.get('search', '', type=str)
    
    query = Ticket.query.order_by(Ticket.timestamp.desc())
    
    if status:
        query = query.filter_by(status=status)
    
    if search:
        query = query.filter(
            (Ticket.license_plate.ilike(f'%{search}%')) |
            (Ticket.violation_type.ilike(f'%{search}%'))
        )
    
    paginated = query.paginate(page=page, per_page=per_page)
    
    return jsonify({
        'tickets': [ticket.to_dict() for ticket in paginated.items],
        'total': paginated.total,
        'pages': paginated.pages,
        'current_page': page
    }), 200

@app.route('/api/tickets', methods=['POST'])
@jwt_required()
def create_ticket():
    """Crear nueva multa"""
    try:
        # Soporte para application/json o multipart/form-data
        if request.is_json:
            data = request.get_json()
        else:
            data = request.form
            
        if 'amount' not in data: data = dict(data); data['amount'] = 0.0
        print('TICKET PAYLOAD:', data)
        if not all(k in data for k in ('user_id', 'route_id', 'violation_type')):
            return jsonify({'message': 'Datos incompletos'}), 400
            
        photo_path = None
        if 'photo' in request.files:
            file = request.files['photo']
            if file and file.filename != '':
                original_name = secure_filename(file.filename)
                _, ext = os.path.splitext(original_name)
                normalized_ext = ext.lower() if ext else ''

                if normalized_ext not in ('.jpg', '.jpeg', '.png', '.webp', '.pdf'):
                    return jsonify({'message': 'Formato de archivo no permitido'}), 400

                filename = f"{uuid4().hex}{normalized_ext}"
                file_path = os.path.join(TICKETS_UPLOAD_FOLDER, filename)
                file.save(file_path)
                photo_path = f"uploads/tickets/{filename}"
                
        ticket = Ticket(
            user_id=data['user_id'],
            route_id=data['route_id'],
            violation_type=data['violation_type'],
            description=data.get('description', ''),
            amount=data['amount'],
            license_plate=data.get('license_plate', ''),
            address=data.get('address', ''),
            vehicle_color=data.get('vehicle_color', ''),
            vehicle_type=data.get('vehicle_type', ''),
            vehicle_make=data.get('vehicle_make', ''),
            vehicle_model=data.get('vehicle_model', ''),
            latitude=data.get('latitude'),
            longitude=data.get('longitude'),
            photo_path=photo_path,
            status=data.get('status', 'pending')
        )
        
        db.session.add(ticket)
        db.session.commit()
        
        return jsonify({
            'message': 'Multa registrada exitosamente',
            'ticket': ticket.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'Error interno del servidor'}), 500

@app.route('/api/uploads/tickets/<filename>')
def uploaded_ticket_file(filename):
    return send_from_directory(TICKETS_UPLOAD_FOLDER, filename)

@app.route('/api/tickets/<int:ticket_id>/photo', methods=['GET'])
def get_ticket_photo(ticket_id):
    token = request.args.get('token')
    if not token:
        return jsonify({'message': 'Token requerido'}), 401

    try:
        decode_token(token)
    except Exception:
        return jsonify({'message': 'Token inválido'}), 401

    ticket = db.session.get(Ticket, ticket_id)

    if not ticket or not ticket.photo_path:
        return jsonify({'message': 'Foto no encontrada'}), 404

    abs_path = os.path.join(os.path.dirname(__file__), ticket.photo_path)
    if not os.path.exists(abs_path):
        return jsonify({'message': 'Archivo no encontrado en el servidor'}), 404

    ext = os.path.splitext(abs_path)[1].lower()
    mimetype = 'application/pdf' if ext == '.pdf' else 'image/jpeg'
    return send_file(abs_path, as_attachment=False, mimetype=mimetype)

@app.route('/api/tickets/<int:ticket_id>', methods=['PUT'])
@jwt_required()
def update_ticket(ticket_id):
    """Actualizar multa"""
    current_user = db.session.get(User, int(get_jwt_identity()))
    if not current_user or current_user.role != 'admin':
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden borrar multas'}), 403

    ticket = db.session.get(Ticket, ticket_id)
    
    if not ticket:
        return jsonify({'message': 'Multa no encontrada'}), 404
    
    data = request.get_json()
    
    ticket.status = data.get('status', ticket.status)
    ticket.description = data.get('description', ticket.description)
    
    db.session.commit()
    
    return jsonify({
        'message': 'Multa actualizada',
        'ticket': ticket.to_dict()
    }), 200

@app.route('/api/tickets/<int:ticket_id>', methods=['DELETE'])
@jwt_required()
def delete_ticket(ticket_id):
    current_user = db.session.get(User, int(get_jwt_identity()))
    if not current_user or current_user.role != 'admin':
        return jsonify({'message': 'Acceso denegado. Solo administradores pueden borrar multas'}), 403

    ticket = db.session.get(Ticket, ticket_id)
    if not ticket:
        return jsonify({'message': 'Multa no encontrada'}), 404

    if ticket.photo_path:
        abs_path = os.path.join(os.path.dirname(__file__), ticket.photo_path)
        if not os.path.exists(abs_path):
            abs_path = os.path.join(os.path.dirname(__file__), *ticket.photo_path.split('/'))
        if os.path.exists(abs_path):
            os.remove(abs_path)

    db.session.delete(ticket)
    db.session.commit()

    return jsonify({'message': 'Multa eliminada'}), 200


from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.units import inch

@app.route('/api/tickets/<int:ticket_id>/pdf', methods=['GET'])
def download_single_ticket_pdf(ticket_id):
    token = request.args.get('token')
    if token:
        try:
            decode_token(token)
        except:
            return jsonify({'message': 'Token invalido'}), 401
            
    ticket = db.session.get(Ticket, ticket_id)
    if not ticket:
        return jsonify({'message': 'Multa no encontrada'}), 404
        
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle', parent=styles['Heading1'], fontSize=16, alignment=1, spaceAfter=14, textColor=colors.HexColor("#0f172a")
    )
    normal_style = styles['Normal']
    normal_style.fontSize = 11
    normal_style.spaceAfter = 8
    
    elements = []
    
    # Logo
    logo_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'assets', 'azogues_logo.png')
    if os.path.exists(logo_path):
        img = Image(logo_path, width=2*inch, height=1*inch)
        img.hAlign = 'CENTER'
        elements.append(img)
        elements.append(Spacer(1, 0.2*inch))
        
    # Title
    elements.append(Paragraph("REPORTE OFICIAL DE MULTA - SEMERTAZ", title_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # Ticket Data
    user_name = ticket.user.full_name or ticket.user.username if ticket.user else 'Desconocido'
    route_name = ticket.route.name if ticket.route else 'No asignada'
    status_text = 'Pagada' if ticket.status == 'paid' else 'Pendiente'
    
    data = [
        ["ID de Multa:", f"T-{ticket.id:03d}"],
        ["Fecha y Hora:", ticket.timestamp.strftime('%Y-%m-%d %H:%M:%S')],
        ["Controlador:", user_name],
        ["Zona / Ruta:", route_name],
        ["Placa del Vehculo:", ticket.plate],
        ["Motivo de Infraccin:", ticket.reason],
        ["Monto a Pagar:", f"${ticket.amount:.2f}"],
        ["Estado:", status_text]
    ]
    
    table = Table(data, colWidths=[2*inch, 4*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor("#f1f5f9")),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor("#334155")),
        ('ALIGN', (0,0), (0,-1), 'RIGHT'),
        ('ALIGN', (1,0), (1,-1), 'LEFT'),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('FONTNAME', (1,0), (1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 11),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 1, colors.HexColor("#cbd5e1"))
    ]))
    
    elements.append(table)
    elements.append(Spacer(1, 0.4*inch))
    
    # Photo if exists
    if ticket.photo_filename:
        photo_path = os.path.join(TICKETS_UPLOAD_FOLDER, ticket.photo_filename)
        if os.path.exists(photo_path):
            elements.append(Paragraph("Evidencia Fotogrfica:", styles['Heading3']))
            elements.append(Spacer(1, 0.1*inch))
            try:
                # Add image, keeping aspect ratio max width 5 inch
                img_ev = Image(photo_path, width=5*inch, height=4*inch, kind='proportional')
                img_ev.hAlign = 'CENTER'
                elements.append(img_ev)
            except Exception as e:
                logger.error(f"Error cargando foto en PDF: {e}")
                
    doc.build(elements)
    buffer.seek(0)
    
    return send_file(buffer, download_name=f"multa_SEMERTAZ_{ticket.id:03d}.pdf", mimetype='application/pdf', as_attachment=True)

@app.route('/api/tickets/pdf', methods=['GET'])
@jwt_required()
def download_tickets_pdf():
    """Descargar multas en PDF"""
    # Obtener filtros de query params
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    controller = request.args.get('controller')
    zone = request.args.get('zone')
    status = request.args.get('status')
    
    query = Ticket.query.order_by(Ticket.timestamp.desc())
    
    if date_from:
        query = query.filter(Ticket.timestamp >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.filter(Ticket.timestamp <= datetime.fromisoformat(date_to))
    if controller:
        query = query.filter(Ticket.user_id == controller)
    if zone:
        query = query.filter(Ticket.route_id == zone)
    if status:
        query = query.filter(Ticket.status == status)
    
    tickets = query.all()
    
    # Crear PDF
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    elements = []
    
    # Título
    title = Paragraph("Reporte de Multas - SEMERTAZ", styles['Title'])
    elements.append(title)
    elements.append(Paragraph(" ", styles['Normal']))
    
    # Datos
    data = [['ID', 'Controlador', 'Placa', 'Infracción', 'Monto', 'Estado', 'Fecha']]
    for ticket in tickets:
        user_name = ticket.user.full_name or ticket.user.username if ticket.user else 'Desconocido'
        data.append([
            f"T-{ticket.id:03d}",
            user_name,
            ticket.license_plate or 'N/A',
            ticket.violation_type,
            f"${ticket.amount:.2f}",
            ticket.status.capitalize(),
            ticket.timestamp.strftime('%Y-%m-%d %H:%M')
        ])
    
    table = Table(data)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), '#4a90e2'),
        ('TEXTCOLOR', (0, 0), (-1, 0), 'white'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), '#f0f0f0'),
        ('GRID', (0, 0), (-1, -1), 1, 'black')
    ]))
    
    elements.append(table)
    
    doc.build(elements)
    buffer.seek(0)
    
    return send_file(buffer, as_attachment=True, download_name='multas.pdf', mimetype='application/pdf')

# ============= PAUSAS ACTIVAS =============

@app.route('/api/pauses', methods=['POST'])
@jwt_required()
def request_pause():
    """Solicitar pausa activa"""
    data = request.get_json() or {}
    user_id = int(get_jwt_identity())
    pause_type = data.get('pause_type', 'emergencia')
    now = datetime.now(EC_TZ)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    daily_pause_count = ActivePause.query.filter(
        ActivePause.user_id == user_id,
        ActivePause.start_time >= day_start,
        ActivePause.start_time < day_end
    ).count()

    if daily_pause_count >= 3:
        return jsonify({'message': 'Límite de 3 pausas diarias alcanzado'}), 400

    emergencia_count = ActivePause.query.filter(
        ActivePause.user_id == user_id,
        ActivePause.pause_type == 'emergencia',
        ActivePause.start_time >= day_start,
        ActivePause.start_time < day_end
    ).count()
    refrigerio_count = ActivePause.query.filter(
        ActivePause.user_id == user_id,
        ActivePause.pause_type == 'refrigerio',
        ActivePause.start_time >= day_start,
        ActivePause.start_time < day_end
    ).count()

    if pause_type == 'emergencia' and emergencia_count >= 2:
        return jsonify({'message': 'Límite de 2 pausas de emergencia diarias alcanzado'}), 400
    if pause_type == 'refrigerio' and refrigerio_count >= 1:
        return jsonify({'message': 'Límite de 1 pausa de refrigerio diaria alcanzado'}), 400

    duration_minutes = 15 if pause_type == 'refrigerio' else 5

    pause = ActivePause(
        user_id=user_id,
        reason=data.get('reason', 'Descanso regular'),
        pause_type=pause_type,
        duration_minutes=duration_minutes
    )
    db.session.add(pause)
    
    # Crear alerta para supervisor
    alert = Alert(
        user_id=user_id,
        type='pausa_solicitada',
        message=f"El controlador ha solicitado una pausa: {pause.reason}"
    )
    db.session.add(alert)
    db.session.commit()
    
    return jsonify({'message': 'Pausa solicitada', 'pause': pause.to_dict()}), 201

@app.route('/api/pauses/my_active', methods=['GET'])
@jwt_required()
def get_my_active_pause():
    user_id = int(get_jwt_identity())
    pause = ActivePause.query.filter(
        ActivePause.user_id == user_id,
        ActivePause.status.in_(['pending', 'authorized', 'rejected'])
    ).order_by(ActivePause.id.desc()).first()
    
    if not pause:
        return jsonify(None), 200
        
    return jsonify(pause.to_dict()), 200

@app.route('/api/pauses', methods=['GET'])
@jwt_required()
def get_pauses():
    pauses = ActivePause.query.order_by(ActivePause.start_time.desc()).all()
    return jsonify([p.to_dict() for p in pauses]), 200

@app.route('/api/pauses/<int:pause_id>/status', methods=['PUT'])
@jwt_required()
def update_pause_status(pause_id):
    pause = db.session.get(ActivePause, pause_id)
    if not pause:
        return jsonify({'message': 'No encontrado'}), 404
    
    data = request.get_json()
    new_status = data.get('status')
    
    from datetime import timezone, timedelta, datetime
    ec_tz = timezone(timedelta(hours=-5))
    
    if new_status == 'authorized' and pause.status == 'pending':
        pause.start_time = datetime.now(ec_tz)
        pause.status = 'authorized'
    elif new_status == 'rejected' and pause.status == 'pending':
        pause.end_time = datetime.now(ec_tz)
        pause.status = 'rejected'
    elif new_status == 'finished' and pause.status == 'authorized':
        pause.end_time = datetime.now(ec_tz)
        pause.status = 'finished'
        
    db.session.commit()
    return jsonify(pause.to_dict()), 200

# ============= ALERTAS =============

@app.route('/api/alerts', methods=['GET'])
@jwt_required()
def get_alerts():
    unread_only = request.args.get('unread', 'true').lower() == 'true'
    query = Alert.query
    if unread_only:
        query = query.filter_by(status='unread')
    alerts = query.order_by(Alert.timestamp.desc()).all()
    return jsonify([a.to_dict() for a in alerts]), 200

@app.route('/api/alerts/<int:alert_id>/read', methods=['PUT'])
@jwt_required()
def mark_alert_read(alert_id):
    alert = db.session.get(Alert, alert_id)
    if alert:
        alert.status = 'read'
        db.session.commit()
    return jsonify({'message': 'Ok'}), 200

# ============= REPORTES =============

@app.route('/api/reports/summary', methods=['GET'])
@jwt_required()
def get_reports_summary():
    total_tickets = Ticket.query.count()
    total_pauses = ActivePause.query.count()
    return jsonify({
        'total_tickets': total_tickets,
        'total_pauses': total_pauses
    }), 200

# ============= DASHBOARD =============

@app.route('/api/dashboard/stats', methods=['GET'])
@jwt_required()
def get_dashboard_stats():
    active_controllers = User.query.filter(
        (User.current_route_id.isnot(None)) | (User.current_route_id_2.isnot(None))
    ).count()

    off_zone_users_query = User.query.filter(
        ((User.current_route_id.isnot(None)) | (User.current_route_id_2.isnot(None))),
        User.last_ping_status == 'off_zone'
    ).all()
    
    off_zone_users = []
    for u in off_zone_users_query:
        off_zone_users.append(u.full_name or u.username)
    
    off_zone = len(off_zone_users)
    total_tickets = Ticket.query.count()
    active_pauses = ActivePause.query.filter_by(status='pending').count()
    
    return jsonify({
        'active_controllers': active_controllers,
        'off_zone': off_zone,
        'off_zone_users': off_zone_users,
        'total_tickets': total_tickets,
        'active_pauses': active_pauses
    }), 200


@app.route('/api/dashboard/tickets-by-zone', methods=['GET'])
@jwt_required()
def get_tickets_by_zone():
    rows = (
        db.session.query(
            Route.id.label('route_id'),
            Route.name.label('route_name'),
            Ticket.address.label('tramo'),
            func.count(Ticket.id).label('count')
        )
        .join(Ticket, Ticket.route_id == Route.id)
        .group_by(Route.id, Route.name, Ticket.address)
        .order_by(func.count(Ticket.id).desc(), Route.name.asc())
        .all()
    )

    return jsonify({
        'items': [
            {
                'route_id': row.route_id,
                'route_name': row.route_name,
                'tramo': row.tramo if row.tramo else 'Sin tramo',
                'count': int(row.count)
            }
            for row in rows
        ]
    }), 200

@app.route('/api/dashboard/recent-activity', methods=['GET'])
@jwt_required()
def get_recent_activity():
    activities = []

    recent_tickets = Ticket.query.order_by(Ticket.timestamp.desc()).limit(5).all()
    for ticket in recent_tickets:
        activities.append({
            'timestamp': ticket.timestamp.isoformat() if ticket.timestamp else None,
            'type': 'ticket',
            'description': f"Multa registrada: {ticket.violation_type}",
            'user_name': ticket.user.full_name if ticket.user else 'Sistema'
        })

    recent_pauses = ActivePause.query.order_by(ActivePause.start_time.desc()).limit(5).all()
    for pause in recent_pauses:
        activities.append({
            'timestamp': pause.start_time.isoformat() if pause.start_time else None,
            'type': 'pause',
            'description': f"Pausa {pause.status}: {pause.reason or 'Sin motivo'}",
            'user_name': pause.user.full_name if pause.user else 'Sistema'
        })

    recent_alerts = Alert.query.order_by(Alert.timestamp.desc()).limit(10).all()
    for alert in recent_alerts:
        if alert.type == 'login_info':
            activities.append({
                'timestamp': alert.timestamp.isoformat() if alert.timestamp else None,
                'type': 'login',
                'description': alert.message or 'Inicio de sesión del controlador',
                'user_name': alert.user.full_name if alert.user else 'Sistema',
                'has_coords': alert.latitude is not None and alert.longitude is not None,
                'latitude': alert.latitude,
                'longitude': alert.longitude
            })
        else:
            activities.append({
                'timestamp': alert.timestamp.isoformat() if alert.timestamp else None,
                'type': 'alert',
                'description': alert.message or f"Alerta: {alert.type}",
                'user_name': alert.user.full_name if alert.user else 'Sistema'
            })

    def _get_ts(item):
        ts = item['timestamp']
        return ts or ''

    activities.sort(key=_get_ts, reverse=True)
    top_five = activities[:5]

    return jsonify({
        'items': [
            {
                'type': item['type'],
                'description': item['description'],
                'user_name': item['user_name'],
                'time_ago': format_time_ago(item['timestamp']),
                'has_coords': item.get('has_coords', False),
                'latitude': item.get('latitude'),
                'longitude': item.get('longitude')
            }
            for item in top_five
        ]
    }), 200


@app.route('/api/alerts/my', methods=['GET'])
@jwt_required()
def get_my_alerts():
    user_id = int(get_jwt_identity())
    alerts = Alert.query.filter_by(user_id=user_id, type='fuera_de_ruta', status='unread').order_by(Alert.timestamp.desc()).all()
    return jsonify([a.to_dict() for a in alerts]), 200


@app.route('/api/alerts/<int:alert_id>', methods=['DELETE'])
@jwt_required()
def delete_alert(alert_id):
    alert = db.session.get(Alert, alert_id)
    if not alert:
        return jsonify({'message': 'Alerta no encontrada'}), 404

    user_id = alert.user_id
    db.session.delete(alert)

    latest_monitoring = Monitoring.query.filter_by(user_id=user_id).order_by(Monitoring.timestamp.desc()).first()
    if latest_monitoring:
        latest_monitoring.status = 'active'

    db.session.commit()
    return jsonify({'message': 'Alerta eliminada'}), 200


@app.route('/api/alerts/mark-all-read', methods=['POST'])
@jwt_required()
def mark_all_alerts_read():
    Alert.query.filter_by(status='unread').update({'status': 'read'})
    db.session.commit()
    return jsonify({'message': 'Todas las alertas marcadas como leídas'}), 200

# ============= INICIALIZAR BASE DE DATOS =============

@app.cli.command()
def init_db():
    """Inicializar la base de datos"""
    db.create_all()
    print('Base de datos inicializada')

@app.cli.command()
def seed_db():
    """Llenar la base de datos con datos de prueba"""
    # Crear usuarios
    users = [
        User(username='admin', email='admin@semertaz.com', full_name='Administrador', role='admin'),
        User(username='supervisor1', email='supervisor@semertaz.com', full_name='Supervisor 1', role='supervisor'),
        User(username='controller1', email='controller1@semertaz.com', full_name='Controlador 1', role='user'),
        User(username='controller2', email='controller2@semertaz.com', full_name='Controlador 2', role='user'),
    ]
    
    for user in users:
        user.set_password('123456')
        db.session.add(user)
    
    db.session.commit()
    
    # Crear rutas
    routes = [
        Route(
            name='Ruta Centro',
            description='Ruta por el centro de la ciudad',
            start_point='Plaza Mayor',
            end_point='Estación Central',
            distance_km=15.5,
            estimated_time=45,
            status='active'
        ),
        Route(
            name='Ruta Norte',
            description='Ruta por el norte',
            start_point='Terminal Norte',
            end_point='Aeropuerto',
            distance_km=22.0,
            estimated_time=60,
            status='active'
        ),
        Route(
            name='Ruta Sur',
            description='Ruta por el sur',
            start_point='Terminal Sur',
            end_point='Puerto',
            distance_km=18.5,
            estimated_time=50,
            status='active'
        ),
    ]
    
    for route in routes:
        db.session.add(route)
    
    db.session.commit()
    
    print('Base de datos poblada con datos de prueba')

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Ruta no encontrada'}), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return jsonify({'message': 'Error interno del servidor'}), 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        ensure_alerts_schema()

    # Flask 2.3 ignora FLASK_ENV y emite warning; forzamos arranque limpio.
    os.environ.pop('FLASK_ENV', None)
    debug_mode = bool(app.config.get('DEBUG', False))
    socketio.run(
        app,
        debug=debug_mode,
        use_reloader=False,
        port=5000,
        host='0.0.0.0',
        ssl_context='adhoc',
        allow_unsafe_werkzeug=True
    )
