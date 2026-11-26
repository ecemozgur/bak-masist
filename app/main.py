import json
import re
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
    DORUK_ENABLED, SESSION_COOKIE_NAME, SESSION_TTL_DAYS, now_tr
)
from app.database import get_db, engine, Base
from app.models import User, Machine, MachineSubfolder, MachineMaintenanceRow, MachineTcfRecord, MachinePeriodicSheet, MaintenanceLog, ChatMessage, DorukSyncLog, HandoverTask, PeriodicCheck
from app.schemas import (
    UserLogin, UserCreate, UserUpdate, UserResponse, MachineResponse, MachineCreate,
    MachineSubfolderCreate, MachineSubfolderResponse,
    MachineMaintenanceRowCreate, MachineMaintenanceRowUpdate, MachineMaintenanceRowResponse,
    MachinePeriodicCheckCreate, MachinePeriodicCheckResponse,
    MachineTcfRecordCreate, MachineTcfRecordResponse,
    MachinePeriodicSheetSave,
    MaintenanceLogCreate, MaintenanceLogResponse,
    VoiceParseRequest, VoiceParseResponse,
    ChatQueryRequest, ChatQueryResponse, DorukPullRequest,
    ServerExcelAppendRequest, ServerExcelAppendResponse, ServerExcelStatusResponse,
    DorukAppendRequest, DorukAppendResponse, DorukRowsResponse,
    HandoverTaskCreate, HandoverTaskUpdateStatus, HandoverTaskResponse
)
from app.services.init_db import init_database
from app.services.voice_service import VoiceService
from app.services.excel_service import ExcelService, CRITERIA_CATALOG
from app.services.doruk_service import DorukService
from app.services.chatbot_service import ChatbotService
from app.services.auth_service import (
    hash_pin, verify_pin, is_pin_hashed, validate_password_strength, create_session_token,
    check_rate_limit, record_failed_attempt, clear_failed_attempts,
    get_current_user, require_admin, require_manager_or_admin, is_admin_role
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
    app_js_path = STATIC_DIR / "js" / "app.js"
    app_version = int(app_js_path.stat().st_mtime) if app_js_path.exists() else int(now_tr().timestamp())
    response = templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "criteria_list": CRITERIA_CATALOG,
            "doruk_enabled": DORUK_ENABLED,
            "app_version": app_version,
        }
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
    login_identifier = creds.username.strip()
    if not login_identifier or not creds.pin_code:
        raise HTTPException(status_code=400, detail="Kullanıcı ve şifre zorunludur.")

    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip, login_identifier)

    # Kullanıcı sicil no (username) VEYA ad soyad (full_name) ile giriş yapabilir
    user = db.query(User).filter(
        (func.lower(User.username) == login_identifier.lower()) |
        (func.lower(User.full_name) == login_identifier.lower())
    ).first()
    if not user or not user.is_active or not verify_pin(creds.pin_code, user.pin_code):
        record_failed_attempt(client_ip, login_identifier)
        raise HTTPException(status_code=401, detail="Kullanıcı veya şifre hatalı!")

    clear_failed_attempts(client_ip, login_identifier)

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

def generate_unique_username(full_name: str, db: Session) -> str:
    """
    Sicil no girilmediğinde personelin adından otomatik ve benzersiz
    bir kullanıcı adı/sicil üretir (örn: ahmet.yilmaz).
    """
    clean_name = full_name.lower().strip()
    tr_map = str.maketrans("çğıöşü", "cgiosu")
    clean_name = clean_name.translate(tr_map)
    parts = [re.sub(r'[^a-z0-9]', '', p) for p in clean_name.split() if p]
    if len(parts) >= 2:
        base = f"{parts[0]}.{parts[-1]}"
    elif len(parts) == 1:
        base = parts[0]
    else:
        base = "personel"

    candidate = base
    counter = 1
    while db.query(User).filter(func.lower(User.username) == candidate.lower()).first():
        counter += 1
        candidate = f"{base}{counter}"
    return candidate

@app.post("/api/admin/users", response_model=UserResponse)
def admin_create_user(
    data: UserCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    sicil_no = (data.username or "").strip()
    full_name = data.full_name.strip()
    if not full_name or not data.pin_code.strip():
        raise HTTPException(status_code=400, detail="Ad soyad ve şifre zorunludur.")

    validate_password_strength(data.pin_code.strip())

    if sicil_no:
        existing = db.query(User).filter(func.lower(User.username) == sicil_no.lower()).first()
        if existing:
            raise HTTPException(status_code=400, detail="Bu sicil numarası zaten kayıtlı!")
    else:
        # Sicil no belirtilmediyse otomatik benzersiz kullanıcı adı/sicil üret
        sicil_no = generate_unique_username(full_name, db)

    role = data.role.upper().strip()
    if role == "YÖNETİCİ":
        role = "YONETICI"
    if role not in ("TEKNISYEN", "YONETICI", "ADMIN"):
        role = "TEKNISYEN"

    user = User(
        username=sicil_no,
        full_name=full_name,
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

    if data.username is not None and data.username.strip():
        new_username = data.username.strip()
        existing = db.query(User).filter(func.lower(User.username) == new_username.lower(), User.id != user.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Bu sicil numarası başka bir personelde kayıtlı!")
        user.username = new_username

    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.department is not None:
        user.department = data.department.strip()
    if data.role is not None:
        new_role = data.role.upper().strip()
        if new_role == "YÖNETİCİ":
            new_role = "YONETICI"
        if new_role in ("TEKNISYEN", "YONETICI", "ADMIN"):
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

    db.commit()
    db.refresh(user)
    return user

@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı!")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Kendi aktif hesabınızı silemezsiniz.")

    # Geçmiş bakım, sohbet ve periyodik kontrol kayıtlarının silinmemesi için user_id bağını boşa çıkar
    db.query(MaintenanceLog).filter(MaintenanceLog.user_id == user.id).update({MaintenanceLog.user_id: None})
    db.query(ChatMessage).filter(ChatMessage.user_id == user.id).update({ChatMessage.user_id: None})
    db.query(PeriodicCheck).filter(PeriodicCheck.user_id == user.id).update({PeriodicCheck.user_id: None})

    db.delete(user)
    db.commit()
    return {"status": "ok", "message": "Kullanıcı tamamen silindi."}

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
    _manager: User = Depends(require_manager_or_admin),
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

def _find_machine_by_code(db: Session, machine_code: str) -> Optional[Machine]:
    raw = (machine_code or "").strip()
    if not raw:
        return None
    machine = db.query(Machine).filter(Machine.code == raw).first()
    if machine:
        return machine
    return db.query(Machine).filter(func.upper(Machine.code) == raw.upper()).first()

@app.get("/api/machines/{machine_code}/folder")
def get_machine_folder(
    machine_code: str,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Belirli bir makinenin dijital klasörü:
    Künyesi, alt klasörleri, geçmiş arızaları, değişen parçalar, duruş istatistikleri ve Doruk kayıtları.
    """
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    
    logs = db.query(MaintenanceLog).filter(
        MaintenanceLog.machine_id == machine.id
    ).order_by(MaintenanceLog.id.desc()).all()

    subfolders = db.query(MachineSubfolder).filter(
        MachineSubfolder.machine_id == machine.id
    ).order_by(MachineSubfolder.id.desc()).all()

    maintenance_rows = db.query(MachineMaintenanceRow).filter(
        MachineMaintenanceRow.machine_id == machine.id
    ).order_by(MachineMaintenanceRow.id.asc()).all()

    periodic_count = 0
    latest_periodic = db.query(MachinePeriodicSheet).filter(
        MachinePeriodicSheet.machine_id == machine.id
    ).order_by(MachinePeriodicSheet.year.desc()).first()
    if latest_periodic and latest_periodic.sheet_json:
        try:
            pdata = json.loads(latest_periodic.sheet_json)
            for prow in pdata.get("rows", []):
                for v in (prow.get("months") or {}).values():
                    if str(v or "").strip():
                        periodic_count += 1
        except Exception:
            pass

    tcf_count = db.query(MachineTcfRecord).filter(
        MachineTcfRecord.machine_id == machine.id
    ).count()

    formatted_subfolders = [
        {
            "id": sf.id,
            "folder_name": sf.folder_name,
            "description": sf.description or "",
            "created_by": sf.created_by or "-",
            "created_at": sf.created_at.strftime("%d.%m.%Y %H:%M") if sf.created_at else "-"
        }
        for sf in subfolders
    ]

    formatted_maintenance_rows = [
        {
            "id": r.id,
            "machine_id": r.machine_id,
            "date_str": r.date_str or "",
            "fault_work_title": r.fault_work_title or "",
            "work_description": r.work_description or "",
            "replaced_part": r.replaced_part or "",
            "mold_shot_count": r.mold_shot_count or "",
            "notification_no": r.notification_no or "",
            "used_material": r.used_material or "",
            "performed_by": r.performed_by or "",
            "approved_by": r.approved_by or "",
            "created_by": r.created_by or "-",
            "created_at": r.created_at.strftime("%d.%m.%Y %H:%M") if r.created_at else "-"
        }
        for r in maintenance_rows
    ]

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
        "subfolders": formatted_subfolders,
        "maintenance_rows": formatted_maintenance_rows,
        "maintenance_rows_count": len(formatted_maintenance_rows),
        "periodic_count": periodic_count,
        "tcf_count": tcf_count,
        "total_interventions": len(formatted_logs),
        "history": formatted_logs
    }

@app.post("/api/machines/{machine_code}/subfolders", response_model=MachineSubfolderResponse)
def create_machine_subfolder(
    machine_code: str,
    data: MachineSubfolderCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: Session = Depends(get_db)
):
    """Yönetici (YONETICI) veya Admin tarafından makine dijital dosyasına yeni klasör ekler."""
    machine = db.query(Machine).filter(Machine.code == machine_code.upper()).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    folder_name = (data.folder_name or "").strip()
    if not folder_name:
        raise HTTPException(status_code=400, detail="Klasör adı zorunludur.")

    subfolder = MachineSubfolder(
        machine_id=machine.id,
        folder_name=folder_name,
        description=(data.description or "").strip() or None,
        created_by=current_user.full_name
    )
    db.add(subfolder)
    db.commit()
    db.refresh(subfolder)
    return subfolder

@app.delete("/api/machines/{machine_code}/subfolders/{folder_id}")
def delete_machine_subfolder(
    machine_code: str,
    folder_id: int,
    _manager: User = Depends(require_manager_or_admin),
    db: Session = Depends(get_db)
):
    """Makine dijital dosyasındaki alt klasörü siler."""
    machine = db.query(Machine).filter(Machine.code == machine_code.upper()).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    subfolder = db.query(MachineSubfolder).filter(
        MachineSubfolder.id == folder_id,
        MachineSubfolder.machine_id == machine.id
    ).first()
    if not subfolder:
        raise HTTPException(status_code=404, detail="Klasör bulunamadı!")
    db.delete(subfolder)
    db.commit()
    return {"status": "ok"}

@app.get("/api/machines/{machine_code}/maintenance-rows/export")
def export_machine_maintenance_schedule(
    machine_code: str,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0006 Makina ve Teçhizat Arıza, Bakım Çizelgesini Excel (.xlsx) olarak indirir."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    rows = db.query(MachineMaintenanceRow).filter(
        MachineMaintenanceRow.machine_id == machine.id
    ).order_by(MachineMaintenanceRow.id.asc()).all()

    excel_bytes, filename = ExcelService.export_machine_schedule_excel_bytes(machine, rows)
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/machines/{machine_code}/maintenance-rows", response_model=List[MachineMaintenanceRowResponse])
def get_machine_maintenance_rows(
    machine_code: str,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0006 Makina ve Teçhizat Arıza, Bakım Çizelgesi satırlarını listeler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    return db.query(MachineMaintenanceRow).filter(
        MachineMaintenanceRow.machine_id == machine.id
    ).order_by(MachineMaintenanceRow.id.asc()).all()

@app.post("/api/machines/{machine_code}/maintenance-rows", response_model=MachineMaintenanceRowResponse)
def create_machine_maintenance_row(
    machine_code: str,
    data: MachineMaintenanceRowCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0006 Makina ve Teçhizat Arıza, Bakım Çizelgesine yeni satır ekler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")

    date_val = (data.date_str or "").strip() or now_tr().strftime("%d.%m.%Y")
    row = MachineMaintenanceRow(
        machine_id=machine.id,
        date_str=date_val,
        fault_work_title=(data.fault_work_title or "").strip(),
        work_description=(data.work_description or "").strip(),
        replaced_part=(data.replaced_part or "").strip(),
        mold_shot_count=(data.mold_shot_count or "").strip(),
        notification_no=(data.notification_no or "").strip(),
        used_material=(data.used_material or "").strip(),
        performed_by=(data.performed_by or "").strip() or current_user.full_name,
        approved_by=(data.approved_by or "").strip(),
        created_by=current_user.full_name
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

@app.put("/api/machines/{machine_code}/maintenance-rows/{row_id}", response_model=MachineMaintenanceRowResponse)
def update_machine_maintenance_row(
    machine_code: str,
    row_id: int,
    data: MachineMaintenanceRowUpdate,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0006 Makina ve Teçhizat Arıza, Bakım Çizelgesindeki bir satırı günceller."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    row = db.query(MachineMaintenanceRow).filter(
        MachineMaintenanceRow.id == row_id,
        MachineMaintenanceRow.machine_id == machine.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Çizelge satırı bulunamadı!")

    for field in (
        "date_str", "fault_work_title", "work_description", "replaced_part",
        "mold_shot_count", "notification_no", "used_material", "performed_by", "approved_by"
    ):
        val = getattr(data, field)
        if val is not None:
            setattr(row, field, val.strip())

    db.commit()
    db.refresh(row)
    return row

@app.delete("/api/machines/{machine_code}/maintenance-rows/{row_id}")
def delete_machine_maintenance_row(
    machine_code: str,
    row_id: int,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0006 Makina ve Teçhizat Arıza, Bakım Çizelgesinden bir satırı siler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    row = db.query(MachineMaintenanceRow).filter(
        MachineMaintenanceRow.id == row_id,
        MachineMaintenanceRow.machine_id == machine.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Çizelge satırı bulunamadı!")
    db.delete(row)
    db.commit()
    return {"status": "ok"}

@app.get("/api/machines/{machine_code}/periodic-checks", response_model=List[MachinePeriodicCheckResponse])
def get_machine_periodic_checks(
    machine_code: str,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Belirli makinenin periyodik kontrol kayıtlarını listeler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    return db.query(PeriodicCheck).filter(
        PeriodicCheck.machine_id == machine.id
    ).order_by(PeriodicCheck.id.desc()).all()

@app.post("/api/machines/{machine_code}/periodic-checks", response_model=MachinePeriodicCheckResponse)
def create_machine_periodic_check(
    machine_code: str,
    data: MachinePeriodicCheckCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Makineye yeni periyodik kontrol kaydı ekler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    rec = PeriodicCheck(
        machine_id=machine.id,
        machine_code=machine.code,
        line_name=machine.line,
        building=machine.department,
        user_id=current_user.id,
        operator_name=(data.operator_name or "").strip() or current_user.full_name,
        date_str=(data.date_str or "").strip() or now_tr().strftime("%d.%m.%Y"),
        check_type=(data.check_type or "GÜNLÜK").strip().upper(),
        status=(data.status or "UYGUN").strip().upper(),
        notes=(data.notes or "").strip()
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec

@app.delete("/api/machines/{machine_code}/periodic-checks/{check_id}")
def delete_machine_periodic_check(
    machine_code: str,
    check_id: int,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Makinenin periyodik kontrol kaydını siler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    rec = db.query(PeriodicCheck).filter(
        PeriodicCheck.id == check_id,
        PeriodicCheck.machine_id == machine.id
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Periyodik kontrol kaydı bulunamadı!")
    db.delete(rec)
    db.commit()
    return {"status": "ok"}

@app.get("/api/machines/{machine_code}/tcf", response_model=List[MachineTcfRecordResponse])
def get_machine_tcf_records(
    machine_code: str,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Makineye ait TCF kayıtlarını listeler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    return db.query(MachineTcfRecord).filter(
        MachineTcfRecord.machine_id == machine.id
    ).order_by(MachineTcfRecord.id.desc()).all()

@app.post("/api/machines/{machine_code}/tcf", response_model=MachineTcfRecordResponse)
def create_machine_tcf_record(
    machine_code: str,
    data: MachineTcfRecordCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Makineye yeni TCF kaydı ekler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Başlık zorunludur.")
    rec = MachineTcfRecord(
        machine_id=machine.id,
        doc_no=(data.doc_no or "").strip(),
        title=title,
        revision=(data.revision or "").strip(),
        notes=(data.notes or "").strip(),
        created_by=current_user.full_name
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec

@app.delete("/api/machines/{machine_code}/tcf/{record_id}")
def delete_machine_tcf_record(
    machine_code: str,
    record_id: int,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Makine TCF kaydını siler."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")
    rec = db.query(MachineTcfRecord).filter(
        MachineTcfRecord.id == record_id,
        MachineTcfRecord.machine_id == machine.id
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="TCF kaydı bulunamadı!")
    db.delete(rec)
    db.commit()
    return {"status": "ok"}

@app.get("/api/machines/{machine_code}/periodic-sheet")
def get_machine_periodic_sheet(
    machine_code: str,
    year: Optional[int] = None,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0446 Periyodik Bakım Kontrol Listesini (yıllık 12 ay matrisi) getirir; yoksa 23 standart parametreyle oluşturur."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")

    target_year = year or now_tr().year
    sheet = db.query(MachinePeriodicSheet).filter(
        MachinePeriodicSheet.machine_id == machine.id,
        MachinePeriodicSheet.year == target_year
    ).first()

    if sheet and sheet.sheet_json:
        try:
            data = json.loads(sheet.sheet_json)
        except Exception:
            data = ExcelService.build_default_periodic_sheet_data()
        return {
            "machine_code": machine.code,
            "machine_name": machine.name,
            "year": sheet.year,
            "doc_no": sheet.doc_no or "FR-PE-0446",
            "revision": sheet.revision or "Rev. 9.10.2026",
            "title": sheet.title or f"{machine.code} {machine.name} PERİYODİK BAKIM KONTROL LİSTESİ",
            "months": ExcelService.PERIODIC_MONTHS,
            "dates": data.get("dates", {}),
            "rows": data.get("rows", []),
            "performed_by": data.get("performed_by", {}),
            "approved_by": data.get("approved_by", {}),
            "updated_by": sheet.updated_by,
            "updated_at": sheet.updated_at.strftime("%d.%m.%Y %H:%M") if sheet.updated_at else None
        }

    default_data = ExcelService.build_default_periodic_sheet_data()
    return {
        "machine_code": machine.code,
        "machine_name": machine.name,
        "year": target_year,
        "doc_no": "FR-PE-0446",
        "revision": "Rev. 9.10.2026",
        "title": f"{machine.code} {machine.name} PERİYODİK BAKIM KONTROL LİSTESİ",
        "months": ExcelService.PERIODIC_MONTHS,
        "dates": default_data["dates"],
        "rows": default_data["rows"],
        "performed_by": default_data["performed_by"],
        "approved_by": default_data["approved_by"],
        "updated_by": None,
        "updated_at": None
    }

@app.put("/api/machines/{machine_code}/periodic-sheet")
def save_machine_periodic_sheet(
    machine_code: str,
    payload: MachinePeriodicSheetSave,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0446 Periyodik Bakım Kontrol Listesini kaydeder."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")

    target_year = payload.year or now_tr().year
    sheet = db.query(MachinePeriodicSheet).filter(
        MachinePeriodicSheet.machine_id == machine.id,
        MachinePeriodicSheet.year == target_year
    ).first()

    sheet_dict = {
        "dates": payload.dates or {},
        "rows": payload.rows or [],
        "performed_by": payload.performed_by or {},
        "approved_by": payload.approved_by or {},
    }
    serialized = json.dumps(sheet_dict, ensure_ascii=False)
    default_title = f"{machine.code} {machine.name} PERİYODİK BAKIM KONTROL LİSTESİ"

    if not sheet:
        sheet = MachinePeriodicSheet(
            machine_id=machine.id,
            year=target_year,
            doc_no=(payload.doc_no or "FR-PE-0446").strip(),
            revision=(payload.revision or "Rev. 9.10.2026").strip(),
            title=(payload.title or default_title).strip(),
            sheet_json=serialized,
            updated_by=current_user.full_name,
            updated_at=now_tr()
        )
        db.add(sheet)
    else:
        sheet.doc_no = (payload.doc_no or sheet.doc_no or "FR-PE-0446").strip()
        sheet.revision = (payload.revision or sheet.revision or "Rev. 9.10.2026").strip()
        sheet.title = (payload.title or sheet.title or default_title).strip()
        sheet.sheet_json = serialized
        sheet.updated_by = current_user.full_name
        sheet.updated_at = now_tr()

    db.commit()
    db.refresh(sheet)
    return {
        "status": "ok",
        "year": sheet.year,
        "updated_by": sheet.updated_by,
        "updated_at": sheet.updated_at.strftime("%d.%m.%Y %H:%M") if sheet.updated_at else None
    }

@app.get("/api/machines/{machine_code}/periodic-sheet/export")
def export_machine_periodic_sheet(
    machine_code: str,
    year: Optional[int] = None,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """FR-PE-0446 Periyodik Bakım Kontrol Listesini Excel (.xlsx) olarak indirir."""
    machine = _find_machine_by_code(db, machine_code)
    if not machine:
        raise HTTPException(status_code=404, detail="Makine bulunamadı!")

    target_year = year or now_tr().year
    sheet = db.query(MachinePeriodicSheet).filter(
        MachinePeriodicSheet.machine_id == machine.id,
        MachinePeriodicSheet.year == target_year
    ).first()

    if sheet and sheet.sheet_json:
        try:
            sheet_data = json.loads(sheet.sheet_json)
        except Exception:
            sheet_data = ExcelService.build_default_periodic_sheet_data()
        doc_no = sheet.doc_no or "FR-PE-0446"
        revision = sheet.revision or "Rev. 9.10.2026"
        title = sheet.title or f"{machine.code} {machine.name} PERİYODİK BAKIM KONTROL LİSTESİ"
    else:
        sheet_data = ExcelService.build_default_periodic_sheet_data()
        doc_no = "FR-PE-0446"
        revision = "Rev. 9.10.2026"
        title = f"{machine.code} {machine.name} PERİYODİK BAKIM KONTROL LİSTESİ"

    excel_bytes, filename = ExcelService.export_periodic_sheet_excel_bytes(
        machine=machine,
        sheet_data=sheet_data,
        year=target_year,
        doc_no=doc_no,
        revision=revision,
        title=title
    )
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

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
        date_str=data.date_str or now_tr().strftime("%Y-%m-%d"),
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
        
        now = now_tr()
        if data.client_time and ":" in data.client_time:
            try:
                hh_str, mm_str = data.client_time.strip().split(":")[:2]
                now = now.replace(hour=int(hh_str), minute=int(mm_str))
            except Exception:
                pass

        if entry_dt:
            entry_dt = entry_dt.replace(hour=now.hour, minute=now.minute, second=now.second)
        else:
            entry_dt = now

        # Kullanıcı elle vardiya seçmediyse, kesme saatlerine göre (08:15, 16:15, 00:15) doğru sayfaya yaz
        if not getattr(data, "shift_manually_selected", False):
            effective_shift = ExcelService.get_shift_by_time(entry_dt)
        else:
            effective_shift = data.shift or ExcelService.get_shift_by_time(entry_dt)

        # 1. Server Excel'ine yaz
        excel_res = ExcelService.append_to_server_excel(
            area_line=data.area_line,
            job_description=data.job_description,
            criterion_no=data.criterion_no,
            time_spent_minutes=data.time_spent_minutes,
            operator_name=data.operator_name,
            shift=effective_shift,
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
            shift=effective_shift,
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
    else:
        # İndirilen günlük rapordan Chart ve İş Aktarım Formu sayfalarını temizle
        ExcelService.clean_daily_file_sheets(file_path)
    
    return FileResponse(
        str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=file_path.name
    )

# ================= VARDİYA İŞ AKTARIM FORMU (FR-PE-0658) API =================

@app.get("/api/handover/tasks", response_model=List[HandoverTaskResponse])
def get_handover_tasks(
    date_str: Optional[str] = None,
    shift: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user)
):
    """Belirtilen gün veya vardiyadaki iş aktarım görevlerini getirir."""
    q = db.query(HandoverTask)
    if date_str:
        q = q.filter(HandoverTask.date_str == date_str)
    if shift:
        q = q.filter(HandoverTask.shift == shift)
    return q.order_by(HandoverTask.id.desc()).all()

@app.post("/api/handover/add", response_model=HandoverTaskResponse)
def add_handover_task(
    data: HandoverTaskCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user)
):
    """Yeni iş aktarım görevi ekler."""
    task = HandoverTask(
        date_str=data.date_str,
        shift=data.shift,
        task_description=data.task_description.strip(),
        assigned_person=data.assigned_person.strip().upper(),
        status=data.status or "Devam Ediyor",
        status_updated_by=data.status_updated_by.strip().upper() if data.status_updated_by and data.status_updated_by.strip() else None,
        notes=data.notes.strip() if data.notes else None
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task

@app.put("/api/handover/{task_id}/status", response_model=HandoverTaskResponse)
def update_handover_status(
    task_id: int,
    data: HandoverTaskUpdateStatus,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user)
):
    """İş aktarım görevinin son durumunu ve durumu değiştiren kişiyi günceller."""
    task = db.query(HandoverTask).filter(HandoverTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="İş aktarım görevi bulunamadı.")
    updater_name = (data.updated_by or "").strip().upper()
    if not updater_name:
        raise HTTPException(status_code=400, detail="Son durumu değiştiren kişinin ismi zorunludur.")
    task.status = data.status
    task.status_updated_by = updater_name
    db.commit()
    db.refresh(task)
    return task

@app.delete("/api/handover/{task_id}")
def delete_handover_task(
    task_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user)
):
    """İş aktarım görevini siler."""
    task = db.query(HandoverTask).filter(HandoverTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="İş aktarım görevi bulunamadı.")
    db.delete(task)
    db.commit()
    return {"success": True, "message": "Görev başarıyla silindi."}

@app.get("/api/handover/export")
def export_handover_excel_file(
    date_str: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user)
):
    """Seçilen günün Vardiya İş Aktarım Formunu sunucuya kaydetmeden doğrudan cihaza (.xlsx) indirir."""
    target_date = now_tr().strftime("%Y-%m-%d")
    if date_str:
        cleaned = date_str.strip().split()[0]
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                target_date = datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
                break
            except ValueError:
                pass

    tasks = db.query(HandoverTask).filter(HandoverTask.date_str == target_date).order_by(HandoverTask.id.asc()).all()
    excel_bytes, filename = ExcelService.export_handover_excel_bytes(target_date, tasks)
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
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
        logger.error(f"Doruk satırı ekleme hatası: {e}") # pyright: ignore[reportUndefinedVariable]
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
    target_date = date_str or now_tr().strftime("%Y-%m-%d")
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
