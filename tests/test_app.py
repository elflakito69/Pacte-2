import sys
import os
import pytest

# Asegurar que el backend esté en el path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../backend')))

from app import app, db
from models import User

@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    
    with app.test_client() as client:
        with app.app_context():
            db.create_all()
            # Crear un usuario de prueba integral
            admin = User(username='admin_test', role='admin', full_name='Admin Test')
            admin.set_password('12345')
            db.session.add(admin)
            db.session.commit()
            
        yield client

def test_login_integration(client):
    """Prueba integral de login de un usuario"""
    res = client.post('/api/auth/login', json={
        'username': 'admin_test',
        'password': '12345'
    })
    assert res.status_code == 200
    data = res.get_json()
    assert 'token' in data
    assert data['user']['role'] == 'admin'

def test_login_failure(client):
    """Prueba unitaria de fallo de login"""
    res = client.post('/api/auth/login', json={
        'username': 'admin_test',
        'password': 'wrong'
    })
    assert res.status_code == 401
