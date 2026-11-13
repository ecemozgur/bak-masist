import os
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, List, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import httpx
from sqlalchemy.orm import Session

from app.config import DORUK_API_URL, DORUK_API_KEY
from app.models import MaintenanceLog, Machine, DorukSyncLog, User

logger = logging.getLogger("DorukService")

DORUK_KEYPET_BASE_DIR = Path(
    os.getenv(
        "DORUK_KEYPET_BASE_DIR",
        r"C:\Users\ecem.sayar\Desktop\Doruk\97 Doruk Otomasyon Rapor\2026 KEYPET DÖKÜMANLARI"
    )
)

MONTH_FOLDERS = {
    1: "01-OCAK",
    2: "02-ŞUBAT",
    3: "03- MART",
    4: "04- NİSAN",
    5: "05-MAYIS",
    6: "06- HAZIRAN",
    7: "07 - TEMMUZ",
    8: "08-AGUSTOS",
    9: "09 -EYLÜL",
    10: "10 EKİM",
    11: "11 KASIM",
    12: "12 ARALIK"
}

TURKISH_DAYS = ["PAZAR", "PAZARTESİ", "SALI", "ÇARŞAMBA", "PERŞEMBE", "CUMA", "CUMARTESİ"]

DORUK_HEADERS = [
    "RefNo", "", "MID", "Makine", "Duruş Kodu", "Duruş Adı", "Süre", "Dk",
    "İstasyon", "Proje Kodu", "Proje Adı", "Başlangıç Zamanı", "Bitiş Zamanı",
    "Vardiya", "Operatör", "Yetkili Operatör", "Bitiş Sayacı", "Teknisyen",
    "Kök Neden", "İyileştirme Önerisi", "Kaizen", "Arıza Kodu", "Arıza Adı",
    "Not", "Açıklama", "Bilgi Giren"
]

class DorukService:
    """
    Doruk Otomasyon (ProManage / MES / Keypet) Entegrasyon ve Raporlama Servisi.
    1. Uygulamadan Doruk 26 sütunlu resmi formatına satır kaydetme (Açıklama ve Bilgi Giren sütunlarıyla).
    2. Tarih seçerek o güne ait Doruk satırlarını listeleme.
    3. Seçilen tarihteki Doruk Keypet dosyasını bilgisayara Excel formatında indirme.
    """

    @classmethod
    def get_month_folder(cls, dt: datetime) -> Path:
        folder_name = MONTH_FOLDERS.get(dt.month, f"{dt.month:02d} AY")
        target_dir = DORUK_KEYPET_BASE_DIR / folder_name
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir

    @classmethod
    def find_keypet_file_for_date(cls, dt: datetime) -> Optional[Path]:
        """Belirli bir güne ait mevcut Keypet dosyasını bulur."""
        try:
            month_dir = cls.get_month_folder(dt)
            if not month_dir.exists():
                return None

            day_str = f"{dt.day:02d}"
            month_str = f"{dt.month:02d}"
            needle1 = f"{day_str}.{month_str}"
            needle2 = f"{day_str}"

            matches = []
            for f in month_dir.iterdir():
                if f.is_file() and not f.name.startswith("~$") and f.suffix.lower() in [".xlsx", ".xls"]:
                    if needle1 in f.name:
                        return f
                    elif needle2 in f.name:
                        matches.append(f)

            if matches:
                return matches[0]
        except Exception as e:
            logger.warning(f"Keypet dosyası arama hatası: {e}")
        return None

    @classmethod
    def create_empty_doruk_file(cls, dt: datetime, shift_label: str = "08:00-16:00 VARDİYASI") -> Path:
        """Belirtilen gün için resmi 26 sütunlu boş Doruk Excel şablonu oluşturur."""
        month_dir = cls.get_month_folder(dt)
        day_name = TURKISH_DAYS[dt.weekday() % 7]
        file_name = f"{dt.day:02d}.{dt.month:02d}.{dt.year} VARDİYALAR.xlsx"
        file_path = month_dir / file_name

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Sheet1"

        # Başlık Fontları ve Stilleri
        header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        shift_font = Font(name="Calibri", size=11, bold=True, color="1E3A8A")
        thin_border = Border(
            left=Side(style="thin", color="CCCCCC"),
            right=Side(style="thin", color="CCCCCC"),
            top=Side(style="thin", color="CCCCCC"),
            bottom=Side(style="thin", color="CCCCCC")
        )

        # Satır 3: Vardiya ve Tarih Başlığı
        shift_text = f"{shift_label} {dt.strftime('%d.%m.%Y')} {day_name}"
        ws.cell(row=3, column=1, value=shift_text).font = shift_font

        # Satır 4: 26 Kolon Başlıkları
        for col_idx, h in enumerate(DORUK_HEADERS, start=1):
            cell = ws.cell(row=4, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border

        wb.save(file_path)
        return file_path

    @classmethod
    def append_doruk_row(cls, data: Any, db: Session) -> Dict[str, Any]:
        """
        Bakımcının girdiği işi resmi 26 sütunlu Doruk formatında kaydeder.
        Son sütunlar: Açıklama (yapılan iş) ve Bilgi Giren (teknisyen).
        """
        # 1. Tarih ve Zaman Hesaplama
        entry_dt = datetime.now()
        if data.date_str:
            try:
                for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
                    entry_dt = datetime.strptime(data.date_str.strip().split()[0], fmt)
                    break
            except Exception:
                entry_dt = datetime.now()

        now = datetime.now()
        entry_dt = entry_dt.replace(hour=now.hour, minute=now.minute, second=now.second)

        # 2. Keypet Dosyasını Bul veya Oluştur
        file_path = cls.find_keypet_file_for_date(entry_dt)
        if not file_path or not file_path.exists():
            file_path = cls.create_empty_doruk_file(entry_dt, shift_label=f"{data.shift or '08:00-16:00'} VARDİYASI")

        # 3. Vardiya No Belirleme (1: 24-08, 2: 08-16, 3: 16-24)
        shift_str = str(data.shift or "").upper()
        if "16" in shift_str and "24" in shift_str:
            vardiya_no = "3"
        elif "24" in shift_str or "00" in shift_str or "08:00 -" in shift_str:
            vardiya_no = "1"
        else:
            vardiya_no = "2"

        # 4. Süre ve Zamanlar
        duration_min = float(data.time_spent_minutes or 15)
        hrs = int(duration_min // 60)
        mins = int(duration_min % 60)
        duration_str = f"{hrs:02d}:{mins:02d}:00"

        end_time_str = entry_dt.strftime("%Y-%m-%d %H:%M:%S")
        start_time_str = (entry_dt - timedelta(minutes=duration_min)).strftime("%Y-%m-%d %H:%M:%S")

        # 5. ID ve MID
        record_id = str(15370000 + int(datetime.now().timestamp() % 100000))
        machine_code = data.machine_code.strip().upper()
        mid = "358"
        station = data.station or data.machine_code or "-"
        project_code = data.project_code or "COMMON"
        project_name = data.project_name or "-"
        technician_name = (data.technician_name or "BAKIMCI").strip().upper()
        operator_name = (data.operator_name or technician_name).strip().upper()
        job_description = data.job_description.strip().upper()
        criterion_no = str(data.criterion_no or "4")
        criterion_name = str(data.criterion_name or "MEKANİK ARIZA").upper()
        root_cause = (data.root_cause or "-").strip().upper()

        # 6. Excel'e Satır Olarak Ekle
        wb = openpyxl.load_workbook(file_path)
        ws = wb.active

        target_row = ws.max_row + 1
        # Eğer başlık yoksa 5. satırdan başla
        if target_row < 5:
            target_row = 5

        row_data = [
            None,                       # 1: RefNo
            record_id,                  # 2: ID
            mid,                        # 3: MID
            machine_code,               # 4: Makine
            1,                          # 5: Duruş Kodu
            "EKIPMAN ARIZA",            # 6: Duruş Adı
            duration_str,               # 7: Süre
            duration_min,               # 8: Dk
            station,                    # 9: İstasyon
            project_code,               # 10: Proje Kodu
            project_name,               # 11: Proje Adı
            start_time_str,             # 12: Başlangıç Zamanı
            end_time_str,               # 13: Bitiş Zamanı
            vardiya_no,                 # 14: Vardiya
            operator_name,              # 15: Operatör
            None,                       # 16: Yetkili Operatör
            None,                       # 17: Bitiş Sayacı
            technician_name,            # 18: Teknisyen
            root_cause,                 # 19: Kök Neden
            data.improvement_suggestion or None, # 20: İyileştirme Önerisi
            None,                       # 21: Kaizen
            criterion_no,               # 22: Arıza Kodu
            criterion_name,             # 23: Arıza Adı
            station,                    # 24: Not
            job_description,            # 25: Açıklama (yapılan iş!)
            technician_name             # 26: Bilgi Giren (teknisyen!)
        ]

        regular_font = Font(name="Calibri", size=9)
        bold_font = Font(name="Calibri", size=9, bold=True)
        thin_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0")
        )

        for col_idx, val in enumerate(row_data, start=1):
            cell = ws.cell(row=target_row, column=col_idx, value=val)
            cell.font = bold_font if col_idx in [4, 8, 25, 26] else regular_font
            cell.border = thin_border
            if col_idx in [2, 3, 5, 8, 14, 22]:
                cell.alignment = Alignment(horizontal="center")

        wb.save(file_path)

        # 7. Yerel Veritabanına ve Senkronizasyon Kaydına Ekle
        machine = db.query(Machine).filter(Machine.code == machine_code).first()
        if not machine:
            machine = Machine(code=machine_code, name=f"Makine {machine_code}", status="CALISIYOR")
            db.add(machine)
            db.commit()
            db.refresh(machine)

        log = MaintenanceLog(
            machine_id=machine.id,
            user_id=data.user_id,
            date_str=entry_dt.strftime("%Y-%m-%d"),
            shift=data.shift or "08.00-16.00",
            failure_description=job_description,
            action_taken=job_description,
            downtime_minutes=int(duration_min),
            maintenance_type=f"Kriter {criterion_no} ({criterion_name})",
            source="DORUK_KEYPET_DIRECT",
            doruk_record_id=record_id,
            is_doruk_synced=True,
            doruk_sync_time=datetime.utcnow()
        )
        db.add(log)
        machine.total_downtime_minutes = (machine.total_downtime_minutes or 0) + int(duration_min)

        sync_log = DorukSyncLog(
            direction="PUSH_TO_DORUK",
            machine_code=machine_code,
            status="SUCCESS",
            payload=json.dumps({"record_id": record_id, "action": job_description}, ensure_ascii=False),
            response_message=f"Keypet Dosyasına Yazıldı: {file_path.name} (Satır: {target_row})"
        )
        db.add(sync_log)
        db.commit()

        return {
            "success": True,
            "message": f"Kayıt başarıyla Doruk Keypet satırına işlendi! (ID: {record_id})",
            "file_name": file_path.name,
            "file_path": str(file_path),
            "row": target_row,
            "record_id": record_id,
            "date_str": entry_dt.strftime("%Y-%m-%d")
        }

    @classmethod
    def get_doruk_rows(cls, db: Session, date_str: Optional[str] = None) -> Dict[str, Any]:
        """
        Seçilen tarihe ait tüm Doruk satırlarını okur ve listeler.
        """
        if not date_str:
            target_dt = datetime.now()
        else:
            try:
                cleaned = date_str.strip().split()[0]
                target_dt = datetime.strptime(cleaned, "%Y-%m-%d")
            except Exception:
                target_dt = datetime.now()

        file_path = cls.find_keypet_file_for_date(target_dt)
        records = []
        file_name = file_path.name if file_path else f"{target_dt.strftime('%d.%m.%Y')} Dosyası Henüz Yok"
        file_exists = file_path is not None and file_path.exists()

        if file_exists:
            try:
                wb = openpyxl.load_workbook(file_path, data_only=True)
                ws = wb.active
                current_shift = "08:00-16:00"

                for r in range(1, ws.max_row + 1):
                    c1 = ws.cell(r, 1).value
                    c2 = ws.cell(r, 2).value
                    c4 = ws.cell(r, 4).value

                    # Vardiya başlığı kontrolü
                    txt = str(c1 or '') + ' ' + str(c2 or '')
                    if "VARDİYAS" in txt.upper() or "VARDIYAS" in txt.upper():
                        current_shift = txt.strip()
                        continue
                    if c1 == "RefNo" or not c4 or str(c4) == "Makine":
                        continue

                    records.append({
                        "row_num": r,
                        "id": str(ws.cell(r, 2).value or ""),
                        "mid": str(ws.cell(r, 3).value or ""),
                        "machine": str(c4),
                        "stop_code": str(ws.cell(r, 5).value or "1"),
                        "stop_name": str(ws.cell(r, 6).value or "EKIPMAN ARIZA"),
                        "duration_str": str(ws.cell(r, 7).value or ""),
                        "duration_min": float(ws.cell(r, 8).value or 0) if ws.cell(r, 8).value else 0.0,
                        "station": str(ws.cell(r, 9).value or "-"),
                        "project_code": str(ws.cell(r, 10).value or "-"),
                        "project_name": str(ws.cell(r, 11).value or "-"),
                        "start_time": str(ws.cell(r, 12).value or ""),
                        "end_time": str(ws.cell(r, 13).value or ""),
                        "shift": current_shift,
                        "operator": str(ws.cell(r, 15).value or "-"),
                        "technician": str(ws.cell(r, 18).value or "-"),
                        "root_cause": str(ws.cell(r, 19).value or "-"),
                        "fault_code": str(ws.cell(r, 22).value or ""),
                        "fault_name": str(ws.cell(r, 23).value or ""),
                        "note": str(ws.cell(r, 24).value or ""),
                        "action": str(ws.cell(r, 25).value or "-"),     # Açıklama
                        "entered_by": str(ws.cell(r, 26).value or "-")  # Bilgi Giren
                    })
            except Exception as e:
                logger.error(f"Doruk satırları okunurken hata: {e}")

        # Ayrıca veritabanında bu tarihe kayıtlı Doruk loglarını da ekle (eğer dosyada henüz yoksa)
        db_logs = db.query(MaintenanceLog).filter(
            MaintenanceLog.date_str == target_dt.strftime("%Y-%m-%d"),
            MaintenanceLog.is_doruk_synced == True
        ).all()

        existing_ids = {r["id"] for r in records if r["id"]}
        for log in db_logs:
            rec_id = log.doruk_record_id or f"APP-{log.id}"
            if rec_id not in existing_ids:
                u_name = log.user.full_name if log.user else "Bakımcı"
                records.append({
                    "row_num": len(records) + 1,
                    "id": rec_id,
                    "mid": "358",
                    "machine": log.machine.code if log.machine else "GENEL",
                    "stop_code": "1",
                    "stop_name": "EKIPMAN ARIZA",
                    "duration_str": f"00:{log.downtime_minutes:02d}:00",
                    "duration_min": float(log.downtime_minutes),
                    "station": log.machine.line if log.machine else "-",
                    "project_code": "COMMON",
                    "project_name": log.machine.name if log.machine else "-",
                    "start_time": f"{log.date_str} 08:00:00",
                    "end_time": f"{log.date_str} 08:{log.downtime_minutes:02d}:00",
                    "shift": log.shift,
                    "operator": u_name,
                    "technician": u_name,
                    "root_cause": log.root_cause or "-",
                    "fault_code": "4",
                    "fault_name": log.maintenance_type or "MEKANİK ARIZA",
                    "note": "-",
                    "action": log.action_taken or log.failure_description,
                    "entered_by": u_name
                })

        return {
            "date_str": target_dt.strftime("%Y-%m-%d"),
            "file_name": file_name,
            "file_path": str(file_path) if file_path else "",
            "file_exists": file_exists,
            "total_records": len(records),
            "records": records
        }

    @classmethod
    def export_doruk_file(cls, db: Session, date_str: str) -> Optional[Path]:
        """
        Seçilen tarihe ait 26 sütunlu Doruk Keypet dosyasını bilgisayara indirilmek üzere hazırlar.
        """
        try:
            target_dt = datetime.strptime(date_str.strip().split()[0], "%Y-%m-%d")
        except Exception:
            target_dt = datetime.now()

        file_path = cls.find_keypet_file_for_date(target_dt)
        if file_path and file_path.exists():
            return file_path

        # Dosya masaüstünde yoksa, yerel veritabanındaki kayıtlarla resmi şablonu oluşturup sunar
        new_file = cls.create_empty_doruk_file(target_dt)
        wb = openpyxl.load_workbook(new_file)
        ws = wb.active

        db_logs = db.query(MaintenanceLog).filter(
            MaintenanceLog.date_str == target_dt.strftime("%Y-%m-%d")
        ).all()

        current_row = 5
        regular_font = Font(name="Calibri", size=9)
        bold_font = Font(name="Calibri", size=9, bold=True)
        thin_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0")
        )

        for l in db_logs:
            m_code = l.machine.code if l.machine else "GENEL"
            u_name = l.user.full_name if l.user else "Bakımcı"
            row_data = [
                None,
                str(15370000 + l.id),
                "358",
                m_code,
                1,
                "EKIPMAN ARIZA",
                f"00:{l.downtime_minutes:02d}:00",
                float(l.downtime_minutes),
                l.machine.line if l.machine else "-",
                "COMMON",
                l.machine.name if l.machine else "-",
                f"{l.date_str} 08:00:00",
                f"{l.date_str} 08:{l.downtime_minutes:02d}:00",
                "2",
                u_name,
                None,
                None,
                u_name,
                l.root_cause or "-",
                None,
                None,
                "4",
                l.maintenance_type or "MEKANİK ARIZA",
                "-",
                l.action_taken or l.failure_description,
                u_name
            ]
            for col_idx, val in enumerate(row_data, start=1):
                cell = ws.cell(row=current_row, column=col_idx, value=val)
                cell.font = bold_font if col_idx in [4, 8, 25, 26] else regular_font
                cell.border = thin_border
            current_row += 1

        wb.save(new_file)
        return new_file

    @classmethod
    def push_log_to_doruk(cls, db: Session, log: MaintenanceLog) -> Dict[str, Any]:
        """Log nesnesini Doruk formatına dönüştürüp Keypet dosyasına ekler."""
        class MockData:
            def __init__(self, log):
                self.machine_code = log.machine.code if log.machine else "GENEL"
                self.job_description = log.action_taken or log.failure_description
                self.technician_name = log.user.full_name if log.user else "Bakımcı"
                self.time_spent_minutes = log.downtime_minutes
                self.criterion_no = "4"
                self.criterion_name = log.maintenance_type or "MEKANİK ARIZA"
                self.station = log.machine.line if log.machine else "-"
                self.project_code = "COMMON"
                self.project_name = log.machine.name if log.machine else "-"
                self.operator_name = self.technician_name
                self.root_cause = log.root_cause or "-"
                self.improvement_suggestion = "-"
                self.shift = log.shift
                self.date_str = log.date_str
                self.user_id = log.user_id

        data = MockData(log)
        return cls.append_doruk_row(data, db)

    @classmethod
    def pull_logs_from_doruk(cls, db: Session, target_machine_code: Optional[str] = None) -> List[Dict[str, Any]]:
        """Mevcut Doruk dosyasından kayıtları çekip yerel makine klasörlerine aktarır."""
        res = cls.get_doruk_rows(db, datetime.now().strftime("%Y-%m-%d"))
        pulled = []
        for r in res.get("records", []):
            if r.get("action") and r["action"] != "-":
                pulled.append(r)
        return pulled
