# Utilizar imagen oficial de Python
FROM python:3.11-slim

# Establecer directorio de trabajo
WORKDIR /app

# Instalar dependencias del sistema requeridas para psycopg2 y utilidades
RUN apt-get update && apt-get install -y \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# Copiar archivos de requerimientos
COPY requirements.txt .

# Instalar dependencias de Python
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el resto de la aplicación (backend y frontend)
COPY . .

# Exponer el puerto de Flask
EXPOSE 5000

# Comando para ejecutar la aplicación (en producción se usaría gunicorn)
CMD ["python", "backend/app.py"]
