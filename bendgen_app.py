"""Entry point for PyInstaller builds."""
import webbrowser
import threading
from bendgen.app import app

def open_browser():
    webbrowser.open("http://localhost:5050")

if __name__ == "__main__":
    print("BendGen - Bend Program Generator for Langmuir BendControl")
    print("Open http://localhost:5050 in your browser")
    print("Press Ctrl+C to stop.")
    threading.Timer(1.5, open_browser).start()
    app.run(host="0.0.0.0", port=5050, debug=False)
