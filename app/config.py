import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
EXPORTS_DIR = BASE_DIR / "exports"
STATIC_DIR = BASE_DIR / "app" / "static"
TEMPLATES_DIR = BASE_DIR / "app" / "templates"

DATA_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'bakim_sistemi.db'}"

# Doruk Otomasyon Varsayılan Ayarları (Faz 2'de aktif edilecek; varsayılan olarak kapalı)
DORUK_ENABLED = os.getenv("DORUK_ENABLED", "false").lower() == "true"
DORUK_API_URL = os.getenv("DORUK_API_URL", "http://doruk-mes.local/api/v1")
DORUK_API_KEY = os.getenv("DORUK_API_KEY", "doruk_secret_token_123")
DORUK_AUTO_SYNC_INTERVAL_SEC = 60

# Fabrika Sunucusundaki Günlük Vardiya Excel Klasörü (FR-PE-0657)
SERVER_EXCEL_BASE_DIR = Path(os.getenv(
    "SERVER_EXCEL_BASE_DIR",
    r"C:\Users\ecem.sayar\Desktop\Doruk\97 Doruk Otomasyon Rapor\2026 VARDİYADA YAPILAN İŞLER VE İŞ AKTARIM FORMLARI"
))
