from app import app
print('Starting server on port 8000...')
app.run(host='0.0.0.0', port=8000, debug=True)