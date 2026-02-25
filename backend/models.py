from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

db = SQLAlchemy()

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relaciones
    monitoring = db.relationship('Monitoring', backref='user', lazy=True, cascade='all, delete-orphan')
    tickets = db.relationship('Ticket', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        """Hash la contraseña"""
        self.password_hash = generate_password_hash(password)
    
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
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
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
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
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
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
            'timestamp': self.timestamp.isoformat()
        }
