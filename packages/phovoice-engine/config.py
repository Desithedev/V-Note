"""PhoVoice Engine Configuration for V-Note."""
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Models directory: check env PHOVOICE_MODELS_DIR, then local models
MODELS_DIR = os.environ.get("PHOVOICE_MODELS_DIR") or os.path.join(BASE_DIR, "models")

# Vocabulary directory
VOCAB_DIR = os.environ.get("PHOVOICE_VOCAB_DIR") or os.path.join(BASE_DIR, "vocabulary")

# Data & cache directory
DATA_DIR = os.environ.get("PHOVOICE_DATA_DIR") or os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "phovoice.db")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Server Defaults
HOST = os.environ.get("PHOVOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("PHOVOICE_PORT", "18765"))
DEFAULT_MODEL = os.environ.get("PHOVOICE_DEFAULT_MODEL", "68M")
