from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash
from config import config
from models import db, User, Route, Monitoring, Ticket
from datetime import datetime, timedelta
import os
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
import io

# Crear aplicación
app = Flask(__name__)

# Configuración
env = os.getenv('FLASK_ENV', 'development')
if env == 'development':
    app.config['DEBUG'] = True
app.config.from_object(config[env])

# Inicializar extensiones
db.init_app(app)
jwt = JWTManager(app)
CORS(app)

# Servir archivos del frontend
frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')

@app.route('/')
def index():
    return send_from_directory(frontend_dir, 'index.html')

@app.route('/frontend/<path:filename>')
def serve_frontend(filename):
    return send_from_directory(frontend_dir, filename)

# ============= AUTENTICACIÓN =============

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Endpoint de login"""
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'message': 'Credenciales incompletas'}), 400
    
    user = User.query.filter_by(username=data['username']).first()
    
    if not user or not user.check_password(data['password']):
        return jsonify({'message': 'Credenciales inválidas'}), 401
    
    if not user.is_active:
        return jsonify({'message': 'Usuario inactivo'}), 401
    
    access_token = create_access_token(identity=user.id)
    return jsonify({
        'message': 'Login exitoso',
        'access_token': access_token,
        'user': user.to_dict()
    }), 200

@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Obtener usuario actual"""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    
    if not user:
        return jsonify({'message': 'Usuario no encontrado'}), 404
    
    return jsonify(user.to_dict()), 200

# ============= USUARIOS =============

@app.route('/api/users', methods=['GET'])
@jwt_required()
def get_users():
    """Obtener todos los usuarios"""
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
    user = User.query.get(user_id)
    
    return jsonify(user.to_dict()), 200

@app.route('/api/users/<int:user_id>', methods=['PUT'])
@jwt_required()
def update_user(user_id):
    """Actualizar usuario"""
    user = User.query.get(user_id)
    
    if not user:
        return jsonify({'message': 'Usuario no encontrado'}), 404
    
    data = request.get_json()
    
    user.full_name = data.get('full_name', user.full_name)
    user.email = data.get('email', user.email)
    user.role = data.get('role', user.role)
    user.is_active = data.get('is_active', user.is_active)
    
    if 'password' in data and data['password']:
        user.set_password(data['password'])
    
    db.session.commit()
    
    return jsonify({
        'message': 'Usuario actualizado',
        'user': user.to_dict()
    }), 200

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@jwt_required()
def delete_user(user_id):
    """Eliminar usuario"""
    user = User.query.get(user_id)
    
    if not user:
        return jsonify({'message': 'Usuario no encontrado'}), 404
    
    db.session.delete(user)
    db.session.commit()
    
    return jsonify({'message': 'Usuario eliminado'}), 200

# ============= RUTAS =============

@app.route('/api/routes', methods=['GET'])
@jwt_required()
def get_routes():
    """Obtener todas las rutas"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
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
    
    return jsonify({
        'routes': [route.to_dict() for route in paginated.items],
        'total': paginated.total,
        'pages': paginated.pages,
        'current_page': page
    }), 200

@app.route('/api/routes', methods=['POST'])
@jwt_required()
def create_route():
    """Crear nueva ruta"""
    data = request.get_json()
    
    if not all(k in data for k in ('name', 'start_point', 'end_point', 'distance_km', 'estimated_time')):
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
            estimated_time=data['estimated_time'],
            status=data.get('status', 'active')
        )
        
        db.session.add(route)
        db.session.commit()
        
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
    route = Route.query.get(route_id)
    
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
    route = Route.query.get(route_id)
    
    if not route:
        return jsonify({'message': 'Ruta no encontrada'}), 404
    
    db.session.delete(route)
    db.session.commit()
    
    logger.info(f"Ruta eliminada: {route.name}")
    return jsonify({'message': 'Ruta eliminada'}), 200

# ============= MONITOREO =============

@app.route('/api/monitoring', methods=['GET'])
@jwt_required()
def get_monitoring():
    """Obtener datos de monitoreo"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    status = request.args.get('status', '', type=str)
    
    query = Monitoring.query.order_by(Monitoring.timestamp.desc())
    
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
        
        monitoring = Monitoring(
            user_id=data['user_id'],
            route_id=data['route_id'],
            latitude=data['latitude'],
            longitude=data['longitude'],
            status=data.get('status', 'active')
        )
        
        db.session.add(monitoring)
        db.session.commit()
        
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
        data = request.get_json()
        
        if not all(k in data for k in ('user_id', 'route_id', 'violation_type', 'amount')):
            return jsonify({'message': 'Datos incompletos'}), 400
        
        ticket = Ticket(
            user_id=data['user_id'],
            route_id=data['route_id'],
            violation_type=data['violation_type'],
            description=data.get('description', ''),
            amount=data['amount'],
            license_plate=data.get('license_plate', ''),
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

@app.route('/api/tickets/<int:ticket_id>', methods=['PUT'])
@jwt_required()
def update_ticket(ticket_id):
    """Actualizar multa"""
    ticket = Ticket.query.get(ticket_id)
    
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
        data.append([
            f"T-{ticket.id:03d}",
            ticket.user_name,
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

# ============= DASHBOARD =============

@app.route('/api/dashboard/stats', methods=['GET'])
@jwt_required()
def get_dashboard_stats():
    """Obtener estadísticas del dashboard"""
    active_controllers = Monitoring.query.filter_by(status='active').count()
    off_zone = Monitoring.query.filter_by(status='off_zone').count()
    total_tickets = Ticket.query.count()
    today_tickets = Ticket.query.filter(
        Ticket.timestamp >= datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    ).count()
    active_routes = Route.query.filter_by(status='active').count()
    total_users = User.query.filter_by(is_active=True).count()
    
    return jsonify({
        'active_controllers': active_controllers,
        'off_zone': off_zone,
        'total_tickets': total_tickets,
        'today_tickets': today_tickets,
        'active_routes': active_routes,
        'total_users': total_users
    }), 200

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
    app.run(debug=True, port=5000, host='0.0.0.0')
