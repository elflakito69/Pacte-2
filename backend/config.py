import os
from datetime import timedelta
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
LOCAL_SQLITE_PATH = (BASE_DIR / 'instance' / 'semertaz.db').as_posix()
LOCAL_SQLITE_URI = f'sqlite:///{LOCAL_SQLITE_PATH}'
RAW_DATABASE_URL = os.getenv('DATABASE_URL')


def resolve_database_url():
    if not RAW_DATABASE_URL or RAW_DATABASE_URL == 'sqlite:///semertaz.db':
        return LOCAL_SQLITE_URI
    return RAW_DATABASE_URL

class Config:
    """Configuración base"""
    SQLALCHEMY_DATABASE_URI = resolve_database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'jwt-secret-key-change-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=24)

class DevelopmentConfig(Config):
    """Configuración para desarrollo"""
    DEBUG = True
    TESTING = False

class ProductionConfig(Config):
    """Configuración para producción"""
    DEBUG = False
    TESTING = False

class TestingConfig(Config):
    """Configuración para testing"""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'

config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}
