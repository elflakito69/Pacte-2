@echo off
echo ============================================
echo  SEMERTAZ Backend Setup
echo ============================================
echo.

REM Verificar si Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no está instalado o no está en PATH
    echo Descargue Python desde https://www.python.org/
    pause
    exit /b 1
)

echo [1/4] Instalando dependencias...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias
    pause
    exit /b 1
)

echo.
echo [2/4] Inicializando base de datos...
python -c "from app import app, db; app.app_context().push(); db.create_all(); print('Base de datos creada')"
if errorlevel 1 (
    echo ERROR: No se pudo crear la base de datos
    pause
    exit /b 1
)

echo.
echo [3/4] Poblando base de datos con datos de prueba...
python -c "from app import app, db, User, Route; app.app_context().push(); users = [User(username='admin', email='admin@semertaz.com', full_name='Administrador', role='admin'), User(username='supervisor1', email='supervisor@semertaz.com', full_name='Supervisor 1', role='supervisor'), User(username='controller1', email='controller1@semertaz.com', full_name='Controlador 1', role='user'), User(username='controller2', email='controller2@semertaz.com', full_name='Controlador 2', role='user')]; [user.set_password('123456') for user in users]; [db.session.add(user) for user in users]; routes = [Route(name='Ruta Centro', description='Ruta por el centro', start_point='Plaza Mayor', end_point='Estación Central', distance_km=15.5, estimated_time=45, status='active'), Route(name='Ruta Norte', description='Ruta por el norte', start_point='Terminal Norte', end_point='Aeropuerto', distance_km=22.0, estimated_time=60, status='active'), Route(name='Ruta Sur', description='Ruta por el sur', start_point='Terminal Sur', end_point='Puerto', distance_km=18.5, estimated_time=50, status='active')]; [db.session.add(route) for route in routes]; db.session.commit(); print('Datos de prueba cargados')"
if errorlevel 1 (
    echo ERROR: No se pudieron cargar los datos de prueba
    pause
    exit /b 1
)

echo.
echo [4/4] Iniciando servidor...
echo.
echo ============================================
echo  ✓ Setup completado
echo ============================================
echo.
echo Servidor iniciado en http://localhost:5000
echo Interface web: http://localhost:8000
echo.
echo Credenciales de prueba:
echo   Usuario: admin
echo   Contraseña: 123456
echo.
echo Presione CTRL+C para detener el servidor
echo ============================================
echo.

python app.py
pause
