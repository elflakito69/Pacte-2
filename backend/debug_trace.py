import traceback
import sys

try:
    import app
    print("Import success")
except Exception:
    traceback.print_exc(file=sys.stdout)
