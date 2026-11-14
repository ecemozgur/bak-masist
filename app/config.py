import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
EXPORTS_DIR = Path(os.getenv(
    "EXPORTS_DIR",
    str(DATA_DIR / "exports" if os.getenv("DATA_DIR") else BASE_DIR / "exports")
))
STATIC_DIR = BASE_DIR / "app" / "static"
TEMPLATES_DIR = BASE_DIR / "app" / "templates"

DATA_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

_raw_db_url = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'bakim_sistemi.db'}")
if _raw_db_url.startswith("postgres://"):
    _raw_db_url = _raw_db_url.replace("postgres://", "postgresql://", 1)
DATABASE_URL = _raw_db_url

# Doruk Otomasyon Varsayılan Ayarları (Faz 2'de aktif edilecek; varsayılan olarak kapalı)
DORUK_ENABLED = os.getenv("DORUK_ENABLED", "false").lower() == "true"
DORUK_API_URL = os.getenv("DORUK_API_URL", "http://doruk-mes.local/api/v1")
DORUK_API_KEY = os.getenv("DORUK_API_KEY", "doruk_secret_token_123")
DORUK_AUTO_SYNC_INTERVAL_SEC = 60

# Oturum & Kimlik Doğrulama Ayarları
AUTH_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "bakim-asistani-dev-secret-change-in-prod")
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "30"))
SESSION_COOKIE_NAME = "bakim_session"

# Fabrika Sunucusundaki Günlük Vardiya Excel Klasörü (FR-PE-0657)
_default_server_excel_dir = (
    r"C:\Users\ecem.sayar\Desktop\Doruk\97 Doruk Otomasyon Rapor\2026 VARDİYADA YAPILAN İŞLER VE İŞ AKTARIM FORMLARI"
    if os.name == "nt"
    else str(DATA_DIR / "server_excel")
)
SERVER_EXCEL_BASE_DIR = Path(os.getenv("SERVER_EXCEL_BASE_DIR", _default_server_excel_dir))
SERVER_EXCEL_BASE_DIR.mkdir(parents=True, exist_ok=True)
