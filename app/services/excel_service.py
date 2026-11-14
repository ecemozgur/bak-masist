import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from app.config import EXPORTS_DIR, SERVER_EXCEL_BASE_DIR
from app.models import MaintenanceLog

TURKISH_MONTHS = {
    1: '01-OCAK', 2: '02-ŞUBAT', 3: '03-MART', 4: '04-NİSAN',
    5: '05-MAYIS', 6: '06-HAZİRAN', 7: '07-TEMMUZ', 8: '08-AĞUSTOS',
    9: '09-EYLÜL', 10: '10-EKİM', 11: '11-KASIM', 12: '12-ARALIK'
}

TURKISH_DAYS = {
    0: 'PAZARTESİ', 1: 'SALI', 2: 'ÇARŞAMBA', 3: 'PERŞEMBE',
    4: 'CUMA', 5: 'CUMARTESİ', 6: 'PAZAR'
}

CRITERIA_CATALOG = [
    {"no": "1", "name": "MAKİNA BAKIM"},
    {"no": "2", "name": "KALIP BAKIM"},
    {"no": "3", "name": "ELEKTRİK ARIZA"},
    {"no": "4", "name": "MEKANİK ARIZA"},
    {"no": "5", "name": "KALIP ARIZA"},
    {"no": "6", "name": "KAİZEN"},
    {"no": "7", "name": "POKOYOKE"},
    {"no": "8", "name": "YRD.TES. KONTROL"},
    {"no": "9", "name": "IK DESTEK"},
    {"no": "10", "name": "MAKER DESTEK"},
    {"no": "11", "name": "ÜRETİM DESTEK"},
    {"no": "12", "name": "PC DESTEK"},
    {"no": "13", "name": "QA DESTEK"},
    {"no": "14", "name": "AYAR"},
    {"no": "15", "name": "EĞİTİM"},
    {"no": "16", "name": "TOPLANTI"},
    {"no": "17", "name": "KYT"},
    {"no": "18", "name": "GENCHI-GENBUTSU-GENİN"},
    {"no": "19", "name": "HAT KURULUMU"},
    {"no": "20", "name": "PROJE HAZIRLIK"},
    {"no": "21", "name": "ÜRÜN TASARIMI"},
    {"no": "22", "name": "TPM"},
    {"no": "23", "name": "KAYIT(RAPORLAMA)"},
    {"no": "24", "name": "KALIP AYAR"},
    {"no": "25", "name": "DIŞ GÖREV"},
    {"no": "26", "name": "QCC"}
]

class ExcelService:
    """
    Fabrika Sunucusundaki FR-PE-0657 formatındaki günlük Excel dosyalarını
    yöneten, otomatik gün oluşturan ve sesle girilen satırları anında işleyen servis.
    """

    @classmethod
    def get_month_folder(cls, dt: datetime = None) -> Path:
        if not dt:
            dt = datetime.now()
        month_name = TURKISH_MONTHS.get(dt.month, f"{dt.month:02d}")
        month_dir = SERVER_EXCEL_BASE_DIR / month_name
        month_dir.mkdir(parents=True, exist_ok=True)
        return month_dir

    @classmethod
    def get_daily_filename(cls, dt: datetime = None) -> str:
        if not dt:
            dt = datetime.now()
        day_name = TURKISH_DAYS.get(dt.weekday(), "GÜN")
        return f"{dt.day:02d}.{dt.month:02d}.{dt.year} {day_name}.xlsx"

    @classmethod
    def get_daily_excel_path(cls, dt: datetime = None) -> Path:
        month_dir = cls.get_month_folder(dt)
        return month_dir / cls.get_daily_filename(dt)

    @classmethod
    def ensure_daily_excel_file(cls, dt: datetime = None) -> Path:
        """
        Bugünün Excel dosyası yoksa, önceki günden veya şablondan
        tüm başlıklar, formüller ve kriterler korunarak temiz bir günlük dosya oluşturur.
        """
        if not dt:
            dt = datetime.now()
        
        target_path = cls.get_daily_excel_path(dt)
        if target_path.exists():
            return target_path

        month_dir = cls.get_month_folder(dt)
        day_str = f"{dt.day:02d}.{dt.month:02d}.{dt.year} {TURKISH_DAYS.get(dt.weekday(), '')}"

        # Şablon olarak kullanılabilecek mevcut bir dosya bul
        candidate_files = sorted(
            [f for f in month_dir.glob("*.xlsx") if not f.name.startswith("~$")],
            key=lambda f: f.stat().st_mtime,
            reverse=True
        )

        template_src = None
        if candidate_files:
            template_src = candidate_files[0]
        else:
            # Üst klasördeki FR-PE-0658 veya önceki aylardan ara
            for prev_month in SERVER_EXCEL_BASE_DIR.glob("*"):
                if prev_month.is_dir():
                    prev_files = sorted(
                        [f for f in prev_month.glob("*.xlsx") if not f.name.startswith("~$")],
                        key=lambda f: f.stat().st_mtime,
                        reverse=True
                    )
                    if prev_files:
                        template_src = prev_files[0]
                        break

        if not template_src or not template_src.exists():
            raise FileNotFoundError(f"Şablon olarak kullanılabilecek bir Excel dosyası bulunamadı: {month_dir}")

        # Şablonu bugünün dosyası olarak kopyala
        shutil.copy2(str(template_src), str(target_path))

        # Yeni günün dosyasını açıp tarihleri güncelle ve veri satırlarını temizle
        wb = openpyxl.load_workbook(str(target_path))
        shift_sheet_keywords = ["08.00-16.00", "16.00-24.00", "24.00 - 08.00", "PAZAR"]

        for sheetname in wb.sheetnames:
            clean_name = sheetname.strip()
            if any(k in clean_name for k in shift_sheet_keywords):
                ws = wb[sheetname]
                if not hasattr(ws, 'cell'):
                    continue

                # Tarih hücresini güncelle (A5 ve varsa sayfa 2'de A43)
                try:
                    ws.cell(5, 1).value = day_str
                except Exception:
                    pass
                try:
                    if ws.max_row >= 43 and ws.cell(43, 1).value:
                        ws.cell(43, 1).value = day_str
                except Exception:
                    pass

                # Başlıktaki 'BÖLGE' ibaresini 'HAT NO / MAKİNE' olarak güncelle
                try:
                    if ws.cell(4, 3).value and "BÖLGE" in str(ws.cell(4, 3).value).upper():
                        ws.cell(4, 3).value = "HAT NO / MAKİNE"
                    if ws.max_row >= 42 and ws.cell(42, 3).value and "BÖLGE" in str(ws.cell(42, 3).value).upper():
                        ws.cell(42, 3).value = "HAT NO / MAKİNE"
                except Exception:
                    pass

                # Önceki günün verilerini temizle (sütun C ve D kapsayan birleşik hücreler)
                all_ranges = [m for m in ws.merged_cells.ranges if m.min_col <= 3 <= m.max_col]
                for m in all_ranges:
                    r = m.min_row
                    # Başlık satırlarını atla
                    if r < 5 or r in [38, 39, 40, 41, 42]:
                        continue
                    try:
                        ws.cell(r, 3).value = None   # Bölge
                        ws.cell(r, 4).value = None   # İşlem
                        ws.cell(r, 24).value = None  # Kriter No
                        ws.cell(r, 25).value = None  # Harcanan Süre
                        ws.cell(r, 26).value = None  # İşi Yapan
                    except Exception:
                        pass

        wb.save(str(target_path))
        wb.close()
        return target_path

    @classmethod
    def _find_sheet(cls, wb: openpyxl.Workbook, shift_str: str) -> Any:
        """Vardiya metnine göre en uygun sayfayı bulur."""
        clean_shift = (shift_str or "").replace(":", ".").replace(" ", "")
        
        for name in wb.sheetnames:
            c = name.strip()
            if "08" in clean_shift and "16" in clean_shift and "08.00-16.00" in c:
                return wb[name]
            if "16" in clean_shift and "24" in clean_shift and "16.00-24.00" in c:
                return wb[name]
            if "24" in clean_shift and "08" in clean_shift and "24.00" in c:
                return wb[name]

        # Varsayılan olarak ilk uygun çalışma sayfasını ver
        for name in wb.sheetnames:
            if "08.00-16.00" in name:
                return wb[name]
        return wb.active

    @classmethod
    def append_to_server_excel(
        cls,
        area_line: str,
        job_description: str,
        criterion_no: str,
        time_spent_minutes: int,
        operator_name: str,
        shift: Optional[str] = None,
        dt: Optional[datetime] = None,
        include_timestamp: bool = True
    ) -> Dict[str, Any]:
        """
        Operatörün onayladığı satırı sunucudaki gün Excel'ine yazar.
        """
        if not dt:
            dt = datetime.now()

        file_path = cls.ensure_daily_excel_file(dt)
        wb = openpyxl.load_workbook(str(file_path))

        ws = cls._find_sheet(wb, shift or "08.00-16.00")

        # C sütununu kapsayan birleşik hücre aralıklarını tara ve ilk boş slotu bul
        c_ranges = sorted(
            [m for m in ws.merged_cells.ranges if m.min_col <= 3 <= m.max_col and m.min_row >= 5 and m.min_row not in [38, 39, 40, 41, 42]],
            key=lambda m: m.min_row
        )

        target_row = None
        for m in c_ranges:
            r = m.min_row
            val_c = ws.cell(r, 3).value
            val_d = ws.cell(r, 4).value
            if (val_c is None or str(val_c).strip() == "") and (val_d is None or str(val_d).strip() == ""):
                target_row = r
                break

        # Eğer hazır boş slot kalmadıysa, sayfanın sonuna yeni bir çift satır ekle
        if target_row is None:
            max_r = ws.max_row + 1
            if max_r % 2 == 0:
                max_r += 1
            target_row = max_r
            # Birleştirmeleri yap
            ws.merge_cells(start_row=target_row, start_column=3, end_row=target_row+1, end_column=3)
            ws.merge_cells(start_row=target_row, start_column=4, end_row=target_row+1, end_column=23)
            ws.merge_cells(start_row=target_row, start_column=24, end_row=target_row+1, end_column=24)
            ws.merge_cells(start_row=target_row, start_column=25, end_row=target_row+1, end_column=25)
            ws.merge_cells(start_row=target_row, start_column=26, end_row=target_row+1, end_column=26)

        # Başlıktaki 'BÖLGE' ibaresini 'HAT NO / MAKİNE' olarak güncelle
        try:
            if ws.cell(4, 3).value and "BÖLGE" in str(ws.cell(4, 3).value).upper():
                ws.cell(4, 3).value = "HAT NO / MAKİNE"
            if ws.max_row >= 42 and ws.cell(42, 3).value and "BÖLGE" in str(ws.cell(42, 3).value).upper():
                ws.cell(42, 3).value = "HAT NO / MAKİNE"
        except Exception:
            pass

        # Açıklama metnine saat damgası ekle
        timestamp_str = dt.strftime("%H:%M")
        full_job_desc = f"[{timestamp_str}] {job_description.strip()}" if include_timestamp else job_description.strip()

        # Değerleri yaz
        ws.cell(target_row, 3).value = area_line.strip().upper()
        ws.cell(target_row, 4).value = full_job_desc
        ws.cell(target_row, 24).value = str(criterion_no).strip()
        ws.cell(target_row, 25).value = int(time_spent_minutes)
        ws.cell(target_row, 26).value = operator_name.strip().upper()

        wb.save(str(file_path))
        wb.close()

        return {
            "success": True,
            "message": f"Kayıt başarıyla server Excel'ine eklendi!",
            "file_path": str(file_path),
            "file_name": file_path.name,
            "sheet_name": ws.title,
            "row": target_row,
            "timestamp": dt.strftime("%d.%m.%Y %H:%M")
        }

    @classmethod
    def get_today_status(cls, dt: datetime = None) -> Dict[str, Any]:
        """Bugünkü Excel dosyasının durumunu ve girilen işleri listeler."""
        if not dt:
            dt = datetime.now()

        file_path = cls.get_daily_excel_path(dt)
        month_folder = cls.get_month_folder(dt).name
        day_name = TURKISH_DAYS.get(dt.weekday(), "")
        today_str = f"{dt.day:02d}.{dt.month:02d}.{dt.year} {day_name}"

        records = []
        if file_path.exists():
            try:
                wb = openpyxl.load_workbook(str(file_path), data_only=True)
                for sheetname in wb.sheetnames:
                    if not any(k in sheetname for k in ["08.00", "16.00", "24.00"]):
                        continue
                    ws = wb[sheetname]
                    if not hasattr(ws, 'merged_cells'):
                        continue
                    
                    c_ranges = sorted(
                        [m for m in ws.merged_cells.ranges if m.min_col <= 3 <= m.max_col and m.min_row >= 5 and m.min_row not in [38, 39, 40, 41, 42]],
                        key=lambda m: m.min_row
                    )
                    for m in c_ranges:
                        r = m.min_row
                        area = ws.cell(r, 3).value
                        desc = ws.cell(r, 4).value
                        crit = ws.cell(r, 24).value
                        dur = ws.cell(r, 25).value
                        worker = ws.cell(r, 26).value
                        if area or desc:
                            match = re.search(r"\[(\d{1,2}):(\d{2})\]", str(desc or ""))
                            time_str = f"{int(match.group(1)):02d}:{int(match.group(2)):02d}" if match else None
                            records.append({
                                "sheet": sheetname.strip(),
                                "row": r,
                                "area": str(area or "-"),
                                "description": str(desc or "-"),
                                "criterion_no": str(crit or "-"),
                                "time_spent": dur or 0,
                                "operator": str(worker or "-"),
                                "time_str": time_str
                            })
                wb.close()
            except Exception as e:
                pass

        return {
            "file_path": str(file_path),
            "file_name": file_path.name,
            "file_exists": file_path.exists(),
            "month_folder": month_folder,
            "today_date_str": today_str,
            "records": records
        }

    @classmethod
    def export_shift_report(cls, logs: List[MaintenanceLog], report_date: str = None) -> str:
        """Eski sistem dışa aktarım desteği (gerekirse doğrudan indirmek için)."""
        if not report_date:
            report_date = datetime.now().strftime("%Y-%m-%d")

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f"Doruk Arıza {report_date}"[:31]
        ws.views.sheetView[0].showGridLines = True

        header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        title_font = Font(name="Calibri", size=16, bold=True, color="1F4E78")
        regular_font = Font(name="Calibri", size=10)
        thin_side = Side(border_style="thin", color="D9D9D9")
        box_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

        ws.merge_cells("A1:H1")
        ws["A1"] = "DORUK ARIZA KAYITLARI RAPORU"
        ws["A1"].font = title_font
        ws["A1"].alignment = Alignment(horizontal="center", vertical="center")

        headers = ["Sıra", "Tarih/Vardiya", "Bölge / Makine", "Yapılan İşlem", "Kriter No", "Süre (dk)", "İşi Yapan", "Doruk Durumu"]
        for col_idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=3, column=col_idx, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = box_border

        for idx, log in enumerate(logs, start=1):
            row_idx = 3 + idx
            m_text = f"{log.machine.code} - {log.machine.name}" if log.machine else "Bilinmiyor"
            u_text = log.user.full_name if log.user else "Saha Girişi"
            row_data = [idx, f"{log.date_str} {log.shift}", m_text, log.action_taken, "4", log.downtime_minutes, u_text, "Kayıtlı"]
            for col_idx, val in enumerate(row_data, start=1):
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.font = regular_font
                cell.border = box_border

        filename = f"Doruk_Ariza_Kayitlari_{report_date}_{datetime.now().strftime('%H%M%S')}.xlsx"
        file_path = EXPORTS_DIR / filename
        wb.save(str(file_path))
        return str(file_path)
