from datetime import datetime
from typing import List, Optional
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import (
    STATIC_DIR, TEMPLATES_DIR, EXPORTS_DIR, SERVER_EXCEL_BASE_DIR,
    DORUK_ENABLED, SESSION_COOKIE_NAME, SESSION_TTL_DAYS
)
from app.database import get_db, engine, Base
from app.models import User, Machine, MaintenanceLog, ChatMessage, DorukSyncLog
from app.schemas import (
    UserLogin, UserCreate, UserUpdate, UserResponse, MachineResponse, MachineCreate,
    MaintenanceLogCreate, MaintenanceLogResponse,
    VoiceParseRequest, VoiceParseResponse,
    ChatQueryRequest, ChatQueryResponse, DorukPullRequest,
    ServerExcelAppendRequest, ServerExcelAppendResponse, ServerExcelStatusResponse,
    DorukAppendRequest, DorukAppendResponse, DorukRowsResponse
)
from app.services.init_db import init_database
from app.services.voice_service import VoiceService
from app.services.excel_service import ExcelService, CRITERIA_CATALOG
from app.services.doruk_service import DorukService
from app.services.chatbot_service import ChatbotService
from app.services.auth_service import (
    hash_pin, verify_pin, is_pin_hashed, validate_password_strength, create_session_token,
    check_rate_limit, record_failed_attempt, clear_failed_attempts,
    get_current_user, require_admin, is_admin_role
)

# Veritabanı tablolarını ve ilk verileri hazırla
init_database()

app = FastAPI(
    title="Akıllı Fabrika Bakım & Doruk MES Entegrasyon Sistemi",
    description="Fabrika bakım personeli için sesli günlük raporlama, Doruk MES çift yönlü entegrasyon ve akıllı arıza asistanı.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# ----------------- SAYFA ROTALARI (PWA / Mobil & Masaüstü) -----------------

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    response = templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"criteria_list": CRITERIA_CATALOG, "doruk_enabled": DORUK_ENABLED}
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.get("/manifest.json")
async def serve_manifest():
    return FileResponse(STATIC_DIR / "manifest.json", media_type="application/manifest+json")

@app.get("/sw.js")
async def serve_sw():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")

# ----------------- KULLANICI / AUTH API -----------------

@app.post("/api/auth/login", response_model=UserResponse)
def login(creds: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    sicil_no = creds.username.strip()
    if not sicil_no or not creds.pin_code:
        raise HTTPException(status_code=400, detail="Sicil numarası ve PIN kodu zorunludur.")

    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip, sicil_no)

    user = db.query(User).filter(func.lower(User.username) == sicil_no.lower()).first()
    if not user or not user.is_active or not verify_pin(creds.pin_code, user.pin_code):
        record_failed_attempt(client_ip, sicil_no)
        raise HTTPException(status_code=401, detail="Sicil numarası veya PIN kodu hatalı!")

    clear_failed_attempts(client_ip, sicil_no)

    # Eski düz metin PIN varsa girişte hash'e yükselt
    if not is_pin_hashed(user.pin_code):
        user.pin_code = hash_pin(creds.pin_code)
        db.commit()
        db.refresh(user)

    ttl_days = SESSION_TTL_DAYS if creds.remember_me else 1
    token = create_session_token(user.id, user.role, ttl_days=ttl_days)
    is_https = (
        request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto", "").lower() == "https"
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=is_https,
        max_age=ttl_days * 86400 if creds.remember_me else None,
        path="/",
    )
    return user

@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "ok"}

@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.get("/api/auth/users", response_model=List[UserResponse])
def get_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if is_admin_role(current_user.role):
        return db.query(User).order_by(User.id.asc()).all()
    return db.query(User).filter(User.is_active == True).order_by(User.id.asc()).all()

# ----------------- ADMIN KULLANICI YÖNETİMİ -----------------

@app.post("/api/admin/users", response_model=UserResponse)
def admin_create_user(
    data: UserCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    sicil_no = data.username.strip()
    if not sicil_no or not data.full_name.strip() or not data.pin_code.strip():
        raise HTTPException(status_code=400, detail="Sicil no, ad soyad ve şifre zorunludur.")

    validate_password_strength(data.pin_code.strip())

    existing = db.query(User).filter(func.lower(User.username) == sicil_no.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Bu sicil numarası zaten kayıtlı!")

    role = data.role.upper().strip()
    if role not in ("TEKNISYEN", "ADMIN"):
        role = "TEKNISYEN"

    user = User(
        username=sicil_no,
        full_name=data.full_name.strip(),
        role=role,
        department=data.department.strip() or "Mekanik Bakım",
        pin_code=hash_pin(data.pin_code.strip()),
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@app.patch("/api/admin/users/{user_id}", response_model=UserResponse)
def admin_update_user(
    user_id: int,
    data: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı!")

    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.department is not None:
        user.department = data.department.strip()
    if data.role is not None:
        new_role = data.role.upper().strip()
        if new_role in ("TEKNISYEN", "ADMIN"):
            if user.id == admin.id and new_role != "ADMIN":
                raise HTTPException(status_code=400, detail="Kendi yönetici yetkinizi kaldıramazsınız.")
            user.role = new_role
    if data.is_active is not None:
        if user.id == admin.id and not data.is_active:
            raise HTTPException(status_code=400, detail="Kendi hesabınızı pasife alamazsınız.")
        user.is_active = data.is_active
    if data.pin_code is not None and data.pin_code.strip():
        clean_pw = data.pin_code.strip()
        validate_password_strength(clean_pw)
        user.pin_code = hash_pin(clean_pw)

    db.commit()
    db.refresh(user)
    return user

# ----------------- MAKİNE YÖNETİMİ & DİJİTAL KLASÖRLER -----------------

@app.get("/api/machines", response_model=List[MachineResponse])
def get_machines(
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    machines = db.query(Machine).all()
    result = []
    for m in machines:
        log_cnt = db.query(MaintenanceLog).filter(MaintenanceLog.machine_id == m.id).count()
        m_dict = {
            "id": m.id,
            "code": m.code,
            "name": m.name,
            "department": m.department,
            "line": m.line,
            "model": m.model,
            "serial_no": m.serial_no,
            "status": m.status,
            "total_downtime_minutes": m.total_downtime_minutes,
            "created_at": m.created_at,
            "log_count": log_cnt
        }
        result.append(MachineResponse(**m_dict))
    return result

@app.post("/api/machines", response_model=MachineResponse)
def create_machine(
    data: MachineCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    existing = db.query(Machine).filter(Machine.code == data.code.upper()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Bu makine kodu zaten kayıtlı!")
    machine = Machine(
        code=data.code.upper(),
        name=data.name,
        department=data.department,
        line=data.line,
        model=data.model,
        serial_no=data.serial_no,
        status=data.status
    )
    db.add(machine)
    db.commit()
    db.refresh(machine)
    return machine

@app.get("/api/machines/{machine_code}/folder")
def get_machine_folder(
    machine_code: str,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Belirli bir makinenin dijital klasörü:
    Künyesi, geçmiş arızaları, değişen parçalar, duruş istatistikleri ve Doruk kayıtları.
    """
    machine = db.query(Machine).filter(Machine.code == machine_code.upper()).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    
    logs = db.query(MaintenanceLog).filter(
        MaintenanceLog.machine_id == machine.id
    ).order_by(MaintenanceLog.id.desc()).all()

    formatted_logs = []
    for l in logs:
        formatted_logs.append({
            "id": l.id,
            "date": l.date_str,
            "shift": l.shift,
            "failure": l.failure_description,
            "action": l.action_taken,
            "parts": l.parts_replaced,
            "downtime": l.downtime_minutes,
            "type": l.maintenance_type,
            "source": l.source,
            "doruk_id": l.doruk_record_id,
            "is_doruk_synced": l.is_doruk_synced,
            "user": l.user.full_name if l.user else "Bilinmiyor"
        })

    return {
        "machine": {
            "id": machine.id,
            "code": machine.code,
            "name": machine.name,
            "department": machine.department,
            "line": machine.line,
            "model": machine.model,
            "status": machine.status,
            "total_downtime": machine.total_downtime_minutes
        },
        "total_interventions": len(formatted_logs),
        "history": formatted_logs
    }

# ----------------- SESLİ RAPOR AYRIŞTIRMA (STT & NLP) -----------------

@app.post("/api/voice/parse", response_model=VoiceParseResponse)
def parse_voice(
    data: VoiceParseRequest,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Mikrofondan gelen konuşma dökümünü analiz edip form alanlarını doldurur.
    """
    known_machines = [m.code for m in db.query(Machine).all()]
    return VoiceService.parse_speech_transcript(data.transcript, known_machines)

# ----------------- BAKIM RAPORU KAYDI & LİSTELEME -----------------

@app.get("/api/logs", response_model=List[MaintenanceLogResponse])
def get_logs(
    machine_code: Optional[str] = None,
    date_str: Optional[str] = None,
    limit: int = 50,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(MaintenanceLog)
    if machine_code:
        query = query.join(Machine).filter(Machine.code == machine_code.upper())
    if date_str:
        query = query.filter(MaintenanceLog.date_str == date_str)
    
    logs = query.order_by(MaintenanceLog.id.desc()).limit(limit).all()
    results = []
    for l in logs:
        results.append(MaintenanceLogResponse(
            id=l.id,
            machine_id=l.machine_id,
            machine_code=l.machine.code if l.machine else "-",
            machine_name=l.machine.name if l.machine else "-",
            user_name=l.user.full_name if l.user else "Saha Girişi",
            date_str=l.date_str,
            shift=l.shift,
            failure_description=l.failure_description,
            action_taken=l.action_taken,
            root_cause=l.root_cause,
            parts_replaced=l.parts_replaced or "-",
            downtime_minutes=l.downtime_minutes or 0,
            maintenance_type=l.maintenance_type,
            source=l.source,
            is_doruk_synced=l.is_doruk_synced,
            doruk_record_id=l.doruk_record_id,
            created_at=l.created_at
        ))
    return results

@app.post("/api/logs", response_model=MaintenanceLogResponse)
def create_log(
    data: MaintenanceLogCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Bakımcının sesle doldurup okuyup onayladığı kaydı veritabanına ekler.
    İstenirse anında Doruk MES sistemine otomatik iletir.
    """
    # Makineyi bul veya oluştur
    clean_code = data.machine_code.upper().strip()
    machine = db.query(Machine).filter(Machine.code == clean_code).first()
    if not machine:
        machine = Machine(
            code=clean_code,
            name=f"Makine {clean_code}",
            status="CALISIYOR"
        )
        db.add(machine)
        db.commit()
        db.refresh(machine)

    log = MaintenanceLog(
        machine_id=machine.id,
        user_id=current_user.id,
        date_str=data.date_str or datetime.now().strftime("%Y-%m-%d"),
        shift=data.shift or "1. Vardiya (08:00 - 16:00)",
        failure_description=data.failure_description,
        action_taken=data.action_taken,
        root_cause=data.root_cause,
        parts_replaced=data.parts_replaced or "-",
        downtime_minutes=data.downtime_minutes,
        maintenance_type=data.maintenance_type or "Arızi Bakım",
        source=data.source or "SESLI_MOBIL",
        raw_voice_transcript=data.raw_voice_transcript,
        is_doruk_synced=False
    )
    db.add(log)
    
    # Makinenin toplam duruş süresini güncelle
    machine.total_downtime_minutes = (machine.total_downtime_minutes or 0) + data.downtime_minutes
    db.commit()
    db.refresh(log)

    # Otomatik Doruk Otomasyon Senkronizasyonu (yalnızca DORUK_ENABLED=true ise)
    if DORUK_ENABLED and data.sync_to_doruk_immediately:
        DorukService.push_log_to_doruk(db, log)

    return MaintenanceLogResponse(
        id=log.id,
        machine_id=machine.id,
        machine_code=machine.code,
        machine_name=machine.name,
        user_name=log.user.full_name if log.user else "Saha Girişi",
        date_str=log.date_str,
        shift=log.shift,
        failure_description=log.failure_description,
        action_taken=log.action_taken,
        root_cause=log.root_cause,
        parts_replaced=log.parts_replaced,
        downtime_minutes=log.downtime_minutes,
        maintenance_type=log.maintenance_type,
        source=log.source,
        is_doruk_synced=log.is_doruk_synced,
        doruk_record_id=log.doruk_record_id,
        created_at=log.created_at
    )

# ----------------- EXCEL ÇIKTISI & SUNUCU EXCEL İŞLEMLERİ -----------------

@app.get("/api/criteria")
def get_criteria_list(_user: User = Depends(get_current_user)):
    """FR-PE-0657 Kriter kataloğunu (1-26, 5S) döner."""
    return CRITERIA_CATALOG

@app.get("/api/server-excel/status", response_model=ServerExcelStatusResponse)
def get_server_excel_status(
    date_str: Optional[str] = None,
    _user: User = Depends(get_current_user)
):
    """İş yeri sunucusundaki seçili veya bugünkü Excel dosyasının durumunu ve satırlarını döner."""
    dt = None
    if date_str:
        cleaned = date_str.strip().split()[0]
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                dt = datetime.strptime(cleaned, fmt)
                break
            except ValueError:
                pass
    status = ExcelService.get_today_status(dt)
    return ServerExcelStatusResponse(**status)

@app.post("/api/server-excel/append", response_model=ServerExcelAppendResponse)
def append_to_server_excel(
    data: ServerExcelAppendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Operatörün sesle doldurup okuyup onayladığı satırı iş yeri sunucusundaki gün Excel'ine kaydeder.
    Aynı zamanda yerel veri tabanına ve istenirse Doruk MES'e de işler.
    """
    try:
        # Tarih belirleme: elle girilen tarih varsa o günün dosyasını kullan, yoksa bugün
        entry_dt = None
        if data.date_str:
            cleaned = data.date_str.strip().split()[0]
            for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
                try:
                    entry_dt = datetime.strptime(cleaned, fmt)
                    break
                except ValueError:
                    pass
        
        now = datetime.now()
        if entry_dt:
            entry_dt = entry_dt.replace(hour=now.hour, minute=now.minute, second=now.second)
        else:
            entry_dt = now

        # 1. Server Excel'ine yaz
        excel_res = ExcelService.append_to_server_excel(
            area_line=data.area_line,
            job_description=data.job_description,
            criterion_no=data.criterion_no,
            time_spent_minutes=data.time_spent_minutes,
            operator_name=data.operator_name,
            shift=data.shift,
            dt=entry_dt,
            include_timestamp=data.include_timestamp
        )

        # 2. Yerel veritabanına da eş zamanlı kaydet
        clean_code = data.area_line.upper().strip()
        machine = db.query(Machine).filter(Machine.code == clean_code).first()
        if not machine:
            machine = Machine(
                code=clean_code,
                name=f"Bina/Hat/Makine {clean_code}",
                status="CALISIYOR"
            )
            db.add(machine)
            db.commit()
            db.refresh(machine)

        log = MaintenanceLog(
            machine_id=machine.id,
            user_id=current_user.id,
            date_str=entry_dt.strftime("%Y-%m-%d"),
            shift=data.shift or "08.00-16.00",
            failure_description=data.job_description,
            action_taken=data.job_description,
            downtime_minutes=data.time_spent_minutes,
            maintenance_type=f"Kriter {data.criterion_no}",
            source="SESLI_SERVER_EXCEL",
            raw_voice_transcript=data.job_description,
            is_doruk_synced=False
        )
        db.add(log)
        machine.total_downtime_minutes = (machine.total_downtime_minutes or 0) + data.time_spent_minutes
        db.commit()
        db.refresh(log)

        # 3. İstenirse Doruk senkronizasyonu (yalnızca DORUK_ENABLED=true ise)
        doruk_synced = False
        doruk_id = None
        if DORUK_ENABLED and data.sync_to_doruk:
            push_res = DorukService.push_log_to_doruk(db, log)
            doruk_synced = log.is_doruk_synced
            doruk_id = log.doruk_record_id

        return ServerExcelAppendResponse(
            success=True,
            message="Kayıt iş yeri sunucusundaki gün Excel'ine başarıyla yazıldı!",
            file_path=excel_res["file_path"],
            file_name=excel_res["file_name"],
            sheet_name=excel_res["sheet_name"],
            row=excel_res["row"],
            timestamp=excel_res["timestamp"],
            doruk_synced=doruk_synced,
            doruk_record_id=doruk_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel'e kayıt sırasında hata oluştu: {str(e)}")

@app.get("/api/server-excel/download")
def download_today_server_excel(
    date_str: Optional[str] = None,
    _user: User = Depends(get_current_user)
):
    """İş yeri sunucusundaki seçili veya bugünün güncel Excel dosyasını indirir."""
    dt = None
    if date_str:
        cleaned = date_str.strip().split()[0]
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                dt = datetime.strptime(cleaned, fmt)
                break
            except ValueError:
                pass
    status = ExcelService.get_today_status(dt)
    file_path = Path(status["file_path"])
    if not file_path.exists():
        file_path = ExcelService.ensure_daily_excel_file(dt)
    
    return FileResponse(
        str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=file_path.name
    )

@app.get("/api/excel/export")
def export_excel(
    report_date: Optional[str] = None,
    machine_code: Optional[str] = None,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(MaintenanceLog)
    if report_date:
        query = query.filter(MaintenanceLog.date_str == report_date)
    if machine_code:
        query = query.join(Machine).filter(Machine.code == machine_code.upper())
    
    logs = query.order_by(MaintenanceLog.id.asc()).all()

    file_path = ExcelService.export_shift_report(logs, report_date)
    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=Path(file_path).name
    )

# ----------------- DORUK OTOMASYON ENTEGRASYONU -----------------

def _ensure_doruk_enabled():
    if not DORUK_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Doruk MES entegrasyonu şu an devre dışı (Faz 2'de aktif edilecek)."
        )

@app.post("/api/doruk/append", response_model=DorukAppendResponse)
def append_to_doruk(data: DorukAppendRequest, db: Session = Depends(get_db)):
    """
    Bakımcının girdiği işi resmi 26 sütunlu Doruk formatında doğrudan kaydeder.
    Son sütunlar: Açıklama (yapılan iş) ve Bilgi Giren (teknisyen).
    """
    _ensure_doruk_enabled()
    try:
        res = DorukService.append_doruk_row(data, db)
        return res
    except Exception as e:
        logger.error(f"Doruk satırı ekleme hatası: {e}")
        raise HTTPException(status_code=500, detail=f"Doruk Keypet dosyasına yazılamadı: {str(e)}")

@app.get("/api/doruk/rows", response_model=DorukRowsResponse)
def get_doruk_rows(date_str: Optional[str] = None, db: Session = Depends(get_db)):
    """Seçilen tarihe ait tüm Doruk satırlarını okur ve listeler."""
    _ensure_doruk_enabled()
    return DorukService.get_doruk_rows(db, date_str)

@app.get("/api/doruk/export")
def export_doruk_excel(date_str: Optional[str] = None, db: Session = Depends(get_db)):
    """Seçilen tarihteki Doruk Keypet dosyasını bilgisayara Excel formatında indirir."""
    _ensure_doruk_enabled()
    target_date = date_str or datetime.now().strftime("%Y-%m-%d")
    file_path = DorukService.export_doruk_file(db, target_date)
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=404, detail="Doruk dosyası oluşturulamadı veya bulunamadı!")
    
    return FileResponse(
        str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=Path(file_path).name
    )

@app.post("/api/doruk/push/{log_id}")
def push_to_doruk(log_id: int, db: Session = Depends(get_db)):
    """Seçilen arıza kaydını Doruk MES sistemine zorla gönderir."""
    _ensure_doruk_enabled()
    log = db.query(MaintenanceLog).filter(MaintenanceLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı!")
    return DorukService.push_log_to_doruk(db, log)

@app.post("/api/doruk/pull")
def pull_from_doruk(data: DorukPullRequest, db: Session = Depends(get_db)):
    """Doruk sistemine makine başında girilen kayıtları uygulamaya çeker."""
    _ensure_doruk_enabled()
    records = DorukService.pull_logs_from_doruk(db, data.machine_code)
    return {
        "status": "success",
        "message": f"{len(records)} adet kayıt Doruk'tan makine klasörlerine aktarıldı.",
        "records": records
    }

@app.get("/api/doruk/sync-logs")
def get_doruk_sync_logs(db: Session = Depends(get_db)):
    """Son Doruk senkronizasyon hareketlerini listeler."""
    _ensure_doruk_enabled()
    return db.query(DorukSyncLog).order_by(DorukSyncLog.id.desc()).limit(20).all()

# ----------------- BAKIMCI YAPAY ZEKA CHATBOT -----------------

@app.post("/api/chat", response_model=ChatQueryResponse)
def chat_with_bot(
    data: ChatQueryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Bakım teknisyeninin arıza sorularına geçmiş makine verilerini tarayarak yanıt üretir.
    """
    res = ChatbotService.answer_query(
        db=db,
        query=data.query,
        machine_code=data.machine_code,
        user_id=current_user.id
    )
    return ChatQueryResponse(
        answer=res["answer"],
        machine_code=res.get("machine_code"),
        referenced_logs=res.get("referenced_logs", [])
    )
