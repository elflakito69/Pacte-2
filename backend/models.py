from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timezone, timedelta
import json

db = SQLAlchemy()
EC_TZ = timezone(timedelta(hours=-5))

class User(db.Model):
    """Modelo de Usuario"""
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    full_name = db.Column(db.String(120), nullable=True)
    role = db.Column(db.String(20), default='user')  # admin, supervisor, user
    is_active = db.Column(db.Boolean, default=True)
    current_route_id = db.Column(db.Integer, db.ForeignKey('routes.id'), nullable=True)
    current_route_id_2 = db.Column(db.Integer, db.ForeignKey('routes.id'), nullable=True)
    assigned_tramos = db.Column(db.Text, nullable=True)  # JSON string, ej: "[1, 2, 3]"
    shift_start = db.Column(db.DateTime, nullable=True)
    off_route_seconds = db.Column(db.Integer, default=0)
    last_ping_time = db.Column(db.DateTime, nullable=True)
    last_ping_status = db.Column(db.String(20), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ), onupdate=lambda: datetime.now(EC_TZ))
    
    # Relaciones
    monitoring = db.relationship('Monitoring', backref='user', lazy=True, cascade='all, delete-orphan')
    tickets = db.relationship('Ticket', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        """Hash la contraseña"""
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256')
    
    def check_password(self, password):
        """Verifica la contraseña"""
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        """Convierte el usuario a diccionario"""
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'full_name': self.full_name,
            'role': self.role,
            'is_active': self.is_active,
            'current_route_id': self.current_route_id,
            'current_route_id_2': self.current_route_id_2,
            'assigned_tramos': json.loads(self.assigned_tramos) if self.assigned_tramos else [],
            'created_at': self.created_at.isoformat()
        }

class Route(db.Model):
    """Modelo de Ruta"""
    __tablename__ = 'routes'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    start_point = db.Column(db.String(120), nullable=False)
    end_point = db.Column(db.String(120), nullable=False)
    distance_km = db.Column(db.Float, nullable=False)
    estimated_time = db.Column(db.Integer, nullable=False)  # minutos
    status = db.Column(db.String(20), default='active')  # active, inactive, maintenance
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ), onupdate=lambda: datetime.now(EC_TZ))
    
    # Relaciones
    monitoring = db.relationship('Monitoring', backref='route', lazy=True, cascade='all, delete-orphan')
    tickets = db.relationship('Ticket', backref='route', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        """Convierte la ruta a diccionario"""
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'start_point': self.start_point,
            'end_point': self.end_point,
            'distance_km': self.distance_km,
            'estimated_time': self.estimated_time,
            'status': self.status,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat()
        }

class Monitoring(db.Model):
    """Modelo de Monitoreo de Controladores"""
    __tablename__ = 'monitoring'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    route_id = db.Column(db.Integer, db.ForeignKey('routes.id'), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(20), default='active')  # active, inactive, off_zone
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ))
    
    def to_dict(self):
        """Convierte el monitoreo a diccionario"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.full_name if self.user else 'Unknown',
            'route_id': self.route_id,
            'route_name': self.route.name if self.route else 'Unknown',
            'latitude': self.latitude,
            'longitude': self.longitude,
            'status': self.status,
            'timestamp': self.timestamp.isoformat()
        }

class Ticket(db.Model):
    """Modelo de Multa"""
    __tablename__ = 'tickets'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    route_id = db.Column(db.Integer, db.ForeignKey('routes.id'), nullable=False)
    violation_type = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    amount = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, paid, disputed
    license_plate = db.Column(db.String(20), nullable=True)
    address = db.Column(db.String(255), nullable=True)
    vehicle_color = db.Column(db.String(50), nullable=True)
    vehicle_type = db.Column(db.String(50), nullable=True)
    vehicle_make = db.Column(db.String(80), nullable=True)
    vehicle_model = db.Column(db.String(80), nullable=True)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    photo_path = db.Column(db.String(255), nullable=True)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ))
    
    def to_dict(self):
        """Convierte la multa a diccionario"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.full_name if self.user else 'Unknown',
            'route_id': self.route_id,
            'route_name': self.route.name if self.route else 'Unknown',
            'violation_type': self.violation_type,
            'description': self.description,
            'amount': self.amount,
            'status': self.status,
            'license_plate': self.license_plate,
            'address': self.address,
            'vehicle_color': self.vehicle_color,
            'vehicle_type': self.vehicle_type,
            'vehicle_make': self.vehicle_make,
            'vehicle_model': self.vehicle_model,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'photo_path': self.photo_path,
            'timestamp': self.timestamp.isoformat()
        }

class ActivePause(db.Model):
    """Modelo de Pausa Activa"""
    __tablename__ = 'active_pauses'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    start_time = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ))
    end_time = db.Column(db.DateTime, nullable=True)
    reason = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(20), default='pending')  # pending, authorized, rejected
    pause_type = db.Column(db.String(20), default='emergencia')  # emergencia, refrigerio
    duration_minutes = db.Column(db.Integer, default=5)
    
    # Relación
    user = db.relationship('User', backref=db.backref('active_pauses', lazy=True, cascade='all, delete-orphan'))
    
    def to_dict(self):
        """Convierte la pausa activa a diccionario"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.full_name if self.user else 'Unknown',
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'reason': self.reason,
            'status': self.status,
            'pause_type': self.pause_type,
            'duration_minutes': self.duration_minutes
        }

class Alert(db.Model):
    """Modelo de Alertas para Supervisores"""
    __tablename__ = 'alerts'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    type = db.Column(db.String(50), nullable=False)  # fuera_de_ruta, inactividad, pausa_no_autorizada, login_info
    message = db.Column(db.Text, nullable=True)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    status = db.Column(db.String(20), default='unread')  # unread, read
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(EC_TZ))
    notified_controller = db.Column(db.Boolean, default=False)
    
    # Relación
    user = db.relationship('User', backref=db.backref('alerts', lazy=True, cascade='all, delete-orphan'))
    
    def to_dict(self):
        """Convierte la alerta a diccionario"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.full_name if self.user else 'Unknown',
            'type': self.type,
            'message': self.message,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'status': self.status,
            'notified_controller': self.notified_controller,
            'timestamp': self.timestamp.isoformat()
        }
