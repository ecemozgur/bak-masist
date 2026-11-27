import io
import os
import re
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from app.config import EXPORTS_DIR, SERVER_EXCEL_BASE_DIR, EXCEL_TEMPLATE_PATH, now_tr
from app.models import MaintenanceLog
from app.services.s3_service import S3Service

_excel_lock = threading.RLock()

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
    {"no": "26", "name": "5S"},
    {"no": "27", "name": "QCC"}
]

class ExcelService:
    """
    Fabrika Sunucusundaki FR-PE-0657 formatındaki günlük Excel dosyalarını
    yöneten, otomatik gün oluşturan ve sesle girilen satırları anında işleyen servis.
    """

    @classmethod
    def get_month_folder(cls, dt: datetime = None) -> Path:
        if not dt:
            dt = now_tr()
        month_name = TURKISH_MONTHS.get(dt.month, f"{dt.month:02d}")
        month_dir = SERVER_EXCEL_BASE_DIR / month_name
        month_dir.mkdir(parents=True, exist_ok=True)
        return month_dir

    @classmethod
    def get_daily_filename(cls, dt: datetime = None) -> str:
        if not dt:
            dt = now_tr()
        day_name = TURKISH_DAYS.get(dt.weekday(), "GÜN")
        return f"{dt.day:02d}.{dt.month:02d}.{dt.year} {day_name}.xlsx"

    @classmethod
    def get_daily_excel_path(cls, dt: datetime = None) -> Path:
        month_dir = cls.get_month_folder(dt)
        return month_dir / cls.get_daily_filename(dt)

    @classmethod
    def get_s3_key(cls, dt: datetime = None) -> str:
        if not dt:
            dt = now_tr()
        return S3Service.build_key(cls.get_month_folder(dt).name, cls.get_daily_filename(dt))

    @classmethod
    def ensure_daily_excel_file(cls, dt: datetime = None) -> Path:
        """
        Bugünün Excel dosyası yoksa, S3'ten indirir veya önceki günden/şablondan
        tüm başlıklar, formüller ve kriterler korunarak temiz bir günlük dosya oluşturur.
        """
        if not dt:
            dt = now_tr()

        with _excel_lock:
            target_path = cls.get_daily_excel_path(dt)
            s3_enabled = S3Service.is_enabled()
            s3_key = cls.get_s3_key(dt) if s3_enabled else None

            if s3_enabled:
                if S3Service.download_file(s3_key, target_path):
                    return target_path
            elif target_path.exists():
                return target_path

            if not target_path.exists():
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
                    if EXCEL_TEMPLATE_PATH.exists():
                        template_src = EXCEL_TEMPLATE_PATH

                if not template_src or not template_src.exists():
                    raise FileNotFoundError(f"Şablon olarak kullanılabilecek bir Excel dosyası bulunamadı: {month_dir}")

                # Şablonu bugünün dosyası olarak kopyala
                shutil.copy2(str(template_src), str(target_path))

                # Yeni günün dosyasını açıp tarihleri güncelle ve veri satırlarını temizle
                wb = openpyxl.load_workbook(str(target_path))
                for unwanted in ("İŞ AKTARIM FORMU", "Chart1", "Chart2"):
                    if unwanted in wb.sheetnames:
                        wb.remove(wb[unwanted])
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

                        # Önceki günün verilerini temizle (sütun C (3) ile Z (26) arasındaki tüm veri satırları)
                        data_row_ranges = [range(5, 38), range(43, max(ws.max_row + 1, 76))]
                        for r_range in data_row_ranges:
                            for r in r_range:
                                if r in range(38, 43):
                                    continue
                                for col in range(3, 27):
                                    try:
                                        cell = ws.cell(r, col)
                                        if cell.value is not None and not str(cell.value).startswith("="):
                                            cell.value = None
                                    except Exception:
                                        pass

                # Kullanıcı talebi: Günlük raporda Chart1, Chart2 ve İŞ AKTARIM FORMU sayfaları yer almasın
                cls._remove_unwanted_sheets(wb)

                wb.save(str(target_path))
                wb.close()

            if s3_enabled and s3_key:
                S3Service.upload_file(target_path, s3_key)

            return target_path

    @classmethod
    def _remove_unwanted_sheets(cls, wb: openpyxl.Workbook) -> None:
        """Kullanıcı talebi doğrultusunda günlük rapordan Chart1, Chart2 ve İŞ AKTARIM FORMU sayfalarını temizler."""
        for sheetname in list(wb.sheetnames):
            u = sheetname.upper()
            if "CHART" in u or "AKTARIM" in u:
                try:
                    wb.remove(wb[sheetname])
                except Exception:
                    pass

    @classmethod
    def clean_daily_file_sheets(cls, file_path: Path) -> None:
        """Dosyadaki Chart ve İş Aktarım sayfalarını kaldırır ve günceller."""
        try:
            p = Path(file_path)
            if not p.exists():
                return
            wb = openpyxl.load_workbook(str(p))
            modified = False
            for sheetname in list(wb.sheetnames):
                u = sheetname.upper()
                if "CHART" in u or "AKTARIM" in u:
                    try:
                        wb.remove(wb[sheetname])
                        modified = True
                    except Exception:
                        pass
            if modified:
                wb.save(str(p))
            wb.close()
        except Exception as e:
            logger.warning(f"clean_daily_file_sheets uyarı: {e}")

    @classmethod
    def get_shift_by_time(cls, dt: Optional[datetime] = None) -> str:
        """
        Fabrika vardiya devir saatlerine (08:15, 16:15, 00:15) göre vardiya adını döner:
        08:15 - 16:15 -> "08.00-16.00" (1. Vardiya)
        16:15 - 00:15 -> "16.00-24.00" (2. Vardiya)
        00:15 - 08:15 -> "24.00 - 08.00" (3. Vardiya)
        """
        if dt is None:
            dt = now_tr()
        mins = dt.hour * 60 + dt.minute
        if 495 <= mins < 975:
            return "08.00-16.00"
        elif mins >= 975 or mins < 15:
            return "16.00-24.00"
        else:
            return "24.00 - 08.00"

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
            dt = now_tr()

        effective_shift = shift if shift else cls.get_shift_by_time(dt)

        with _excel_lock:
            file_path = cls.ensure_daily_excel_file(dt)
            wb = openpyxl.load_workbook(str(file_path))

            ws = cls._find_sheet(wb, effective_shift)

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

            if S3Service.is_enabled():
                S3Service.upload_file(file_path, cls.get_s3_key(dt))

            return {
                "success": True,
                "message": "Kayıt başarıyla server Excel'ine eklendi!",
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
            dt = now_tr()

        with _excel_lock:
            file_path = cls.get_daily_excel_path(dt)
            month_folder = cls.get_month_folder(dt).name
            day_name = TURKISH_DAYS.get(dt.weekday(), "")
            today_str = f"{dt.day:02d}.{dt.month:02d}.{dt.year} {day_name}"

            if S3Service.is_enabled():
                S3Service.download_file(cls.get_s3_key(dt), file_path)

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
                except Exception:
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
            report_date = now_tr().strftime("%Y-%m-%d")

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

        filename = f"Doruk_Ariza_Kayitlari_{report_date}_{now_tr().strftime('%H%M%S')}.xlsx"
        file_path = EXPORTS_DIR / filename
        wb.save(str(file_path))
        return str(file_path)

    @classmethod
    def _build_daily_handover_workbook(cls, date_str: str, tasks: list) -> Tuple[openpyxl.Workbook, str]:
        """
        Seçilen tek bir gün (günlük) için Vardiya İş Aktarım Formu (is_aktarım.xlsx düzeninde:
        A sütunu TARİH, B-D: 08:00-16:00, E-G: 16:00-24:00, H-J: 24:00-08:00) üretir.
        """
        clean_date = date_str
        try:
            if "-" in date_str:
                parts = date_str.strip().split()[0].split("-")
                if len(parts) == 3 and len(parts[0]) == 4:
                    clean_date = f"{parts[2]}.{parts[1]}.{parts[0]}"
        except Exception:
            clean_date = date_str

        # Görevleri vardiyalara göre grupla
        s1, s2, s3 = [], [], []
        for t in tasks:
            shift_text = (getattr(t, "shift", "") or "").replace(" ", "").replace(":", ".")
            if "08" in shift_text and "16" in shift_text:
                s1.append(t)
            elif "16" in shift_text and "24" in shift_text:
                s2.append(t)
            else:
                s3.append(t)

        def _format_task_desc(task_obj) -> str:
            desc = (getattr(task_obj, "task_description", "") or "").strip()
            notes = (getattr(task_obj, "notes", "") or "").strip()
            if notes:
                return f"{desc}\n(Not: {notes})"
            return desc

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "İŞ AKTARIM FORMU"
        ws.views.sheetView[0].showGridLines = True

        # Sütun genişlikleri (is_aktarım.xlsx ile birebir)
        col_widths = {
            "A": 8.0,
            "B": 36.0, "C": 16.0, "D": 28.0,
            "E": 36.0, "F": 16.0, "G": 28.0,
            "H": 36.0, "I": 16.0, "J": 28.0,
        }
        for col_letter, width in col_widths.items():
            ws.column_dimensions[col_letter].width = width

        thin = Side(border_style="thin", color="000000")
        medium = Side(border_style="medium", color="000000")
        cell_border = Border(left=thin, right=thin, top=thin, bottom=thin)
        header_border = Border(left=thin, right=thin, top=medium, bottom=medium)

        title_font = Font(name="Aptos Narrow", size=18, bold=True)
        meta_font = Font(name="Aptos Narrow", size=10, bold=False)
        shift_hdr_font = Font(name="Aptos Narrow", size=15, bold=True)
        sub_hdr_font = Font(name="Aptos Narrow", size=13, bold=True)
        date_font = Font(name="Aptos Narrow", size=24, bold=True)
        desc_font = Font(name="Aptos Narrow", size=12, bold=True)
        person_font = Font(name="Aptos Narrow", size=11, bold=True)
        status_font = Font(name="Aptos Narrow", size=11, bold=True)

        header_fill = PatternFill(start_color="F2F4F8", end_color="F2F4F8", fill_type="solid")

        # Üst Başlıklar (Satır 1 - 3)
        ws.row_dimensions[1].height = 24
        ws.row_dimensions[2].height = 12
        ws.row_dimensions[3].height = 18

        ws.merge_cells("A1:J1")
        ws["A1"] = "VARDİYA İŞ AKTARIM FORMU"
        ws["A1"].font = title_font
        ws["A1"].alignment = Alignment(horizontal="center", vertical="center")

        ws["A3"] = "Sayfa no: 1 / 1"
        ws["A3"].font = meta_font
        ws["C3"] = "Rev. 24.7.2023"
        ws["C3"].font = meta_font
        ws["E3"] = "Doküman no: FR-PE-0658"
        ws["E3"].font = meta_font
        ws["J3"] = "Otomotiv Parçaları San. ve Tic. A.Ş."
        ws["J3"].font = meta_font
        ws["J3"].alignment = Alignment(horizontal="right", vertical="center")

        # Tablo Başlıkları (Satır 4 - 5)
        ws.row_dimensions[4].height = 26
        ws.row_dimensions[5].height = 42

        ws.merge_cells("A4:A5")
        ws["A4"] = "TARİH"
        ws["A4"].font = shift_hdr_font
        ws["A4"].alignment = Alignment(horizontal="center", vertical="center")

        shift_headers = [
            ("B4:D4", "B4", "08:00-16:00 VARDİYASI", 2),
            ("E4:G4", "E4", "16:00-24:00 VARDİYASI", 5),
            ("H4:J4", "H4", "24:00-08:00 VARDİYASI", 8),
        ]
        for merge_range, top_cell, title, start_col in shift_headers:
            ws.merge_cells(merge_range)
            ws[top_cell] = title
            ws[top_cell].font = shift_hdr_font
            ws[top_cell].alignment = Alignment(horizontal="center", vertical="center")

            sub_titles = ["YAPILACAK İŞLER", "KİŞİ", "SON DURUM"]
            for offset, st in enumerate(sub_titles):
                c = ws.cell(5, start_col + offset, value=st)
                c.font = sub_hdr_font
                c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        for r in (4, 5):
            for c in range(1, 11):
                cell = ws.cell(r, c)
                cell.border = header_border
                cell.fill = header_fill

        # Günlük veri slotları (en az 4 slot; daha fazla görev varsa otomatik genişler)
        num_slots = max(4, len(s1), len(s2), len(s3))
        start_row = 6
        slot_start_rows = []

        for slot_idx in range(num_slots):
            r_top = start_row + slot_idx * 3
            r_bot = r_top + 2
            slot_start_rows.append(r_top)
            for rr in range(r_top, r_bot + 1):
                ws.row_dimensions[rr].height = 28

            for col_idx in range(2, 11):
                ws.merge_cells(start_row=r_top, start_column=col_idx, end_row=r_bot, end_column=col_idx)

        last_row = start_row + num_slots * 3 - 1

        # A sütunu: Günlük Tarih (Dikey / 90 derece)
        ws.merge_cells(start_row=start_row, start_column=1, end_row=last_row, end_column=1)
        date_cell = ws.cell(start_row, 1, value=clean_date)
        date_cell.font = date_font
        date_cell.alignment = Alignment(horizontal="center", vertical="center", text_rotation=90)

        # Görevleri ilgili vardiya sütunlarına yaz
        shift_groups = [
            (s1, 2),  # B, C, D
            (s2, 5),  # E, F, G
            (s3, 8),  # H, I, J
        ]
        for group_tasks, base_col in shift_groups:
            for idx, task_obj in enumerate(group_tasks):
                r_top = slot_start_rows[idx]
                status_val = getattr(task_obj, "status", "Devam Ediyor") or "Devam Ediyor"
                updated_by_val = (getattr(task_obj, "status_updated_by", "") or "").strip()
                full_status_val = f"{status_val}\n({updated_by_val})" if updated_by_val else status_val

                c_desc = ws.cell(r_top, base_col, value=_format_task_desc(task_obj))
                c_pers = ws.cell(r_top, base_col + 1, value=getattr(task_obj, "assigned_person", ""))
                c_stat = ws.cell(r_top, base_col + 2, value=full_status_val)

                c_desc.font = desc_font
                c_desc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

                c_pers.font = person_font
                c_pers.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

                c_stat.font = status_font
                c_stat.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        # Tüm veri hücrelerine kenarlık uygula
        for r in range(start_row, last_row + 1):
            for c in range(1, 11):
                ws.cell(r, c).border = cell_border

        export_filename = f"IS_AKTARIM_FORMU_{clean_date}.xlsx"
        return wb, export_filename

    @classmethod
    def export_handover_excel_bytes(cls, date_str: str, tasks: list) -> Tuple[bytes, str]:
        """
        Günlük Vardiya İş Aktarım Formunu sunucu diskine kaydetmeden doğrudan bellekten (bytes)
        kullanıcının cihazına indirilmek üzere üretir.
        """
        wb, export_filename = cls._build_daily_handover_workbook(date_str, tasks)
        buffer = io.BytesIO()
        wb.save(buffer)
        wb.close()
        buffer.seek(0)
        return buffer.getvalue(), export_filename

    @classmethod
    def export_handover_excel(cls, date_str: str, tasks: list) -> Path:
        """
        Vardiya İş Aktarım Formu için günlük Excel çıktısı üretir.
        """
        wb, export_filename = cls._build_daily_handover_workbook(date_str, tasks)
        out_path = EXPORTS_DIR / export_filename
        wb.save(str(out_path))
        wb.close()
        return out_path

    @classmethod
    def export_machine_schedule_excel_bytes(cls, machine: Any, rows: list) -> Tuple[bytes, str]:
        """
        FR-PE-0006 MAKİNA VE TEÇHİZAT ARIZA, BAKIM ÇİZELGESİ resmi denetim formatında
        (13 sütun A..M, satır 1..7 birebir başlık yerleşimi) Excel (.xlsx) üretir.
        """
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "FR-PE-0006"
        ws.views.sheetView[0].showGridLines = True
        ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True

        # Resmi 13 sütun (A..M) genişlikleri
        col_widths = {
            "A": 7.0,   # TARİH (A:B birleşik -> 14)
            "B": 7.0,
            "C": 14.0,  # ARIZA VE YAPILAN İŞİN TANIMI (C:D birleşik -> 28)
            "D": 14.0,
            "E": 19.0,  # YAPILAN İŞİN AÇIKLAMASI (E:F birleşik -> 38)
            "F": 19.0,
            "G": 11.0,  # DEĞİŞEN PARÇA (G:H birleşik -> 22)
            "H": 11.0,
            "I": 15.0,  # KALIP BASKI SAYISI
            "J": 16.0,  # ARIZA-KAIZEN BİLDİRİM NO
            "K": 16.0,  # KULLANILAN A/S.DAHİLİ
            "L": 18.0,  # İŞİ YAPAN
            "M": 14.0,  # ONAY
        }
        for col_letter, width in col_widths.items():
            ws.column_dimensions[col_letter].width = width

        thin = Side(border_style="thin", color="000000")
        medium = Side(border_style="medium", color="000000")
        cell_border = Border(left=thin, right=thin, top=thin, bottom=thin)
        hdr_top_border = Border(left=thin, right=thin, top=medium, bottom=None)
        hdr_bot_border = Border(left=thin, right=thin, top=None, bottom=medium)
        hdr_full_border = Border(left=thin, right=thin, top=medium, bottom=medium)

        title_font = Font(name="Calibri", size=14, bold=True)
        meta_font = Font(name="Calibri", size=10, bold=False)
        meta_bold_font = Font(name="Calibri", size=10, bold=True)
        tbl_hdr_font = Font(name="Calibri", size=9, bold=True)
        data_font = Font(name="Calibri", size=10, bold=False)

        # Satır 1: Ana Başlık (A1:M1)
        ws.row_dimensions[1].height = 26
        ws.merge_cells("A1:M1")
        ws["A1"] = "MAKİNA VE TEÇHİZAT ARIZA, BAKIM ÇİZELGESİ"
        ws["A1"].font = title_font
        ws["A1"].alignment = Alignment(horizontal="center", vertical="center")

        # Satır 2: Boş satır
        ws.row_dimensions[2].height = 10

        # Satır 3: Resmi Doküman Meta Bilgileri (A3, D3, F3, K3:M3)
        ws.row_dimensions[3].height = 20
        ws.merge_cells("A3:C3")
        ws["A3"] = "Sayfa no: 1 / 1"
        ws["A3"].font = meta_font
        ws["A3"].alignment = Alignment(horizontal="left", vertical="center")

        ws.merge_cells("D3:E3")
        ws["D3"] = "Rev.4.9.2020"
        ws["D3"].font = meta_font
        ws["D3"].alignment = Alignment(horizontal="left", vertical="center")

        ws.merge_cells("F3:J3")
        ws["F3"] = "Doküman no:FR-PE-0006"
        ws["F3"].font = meta_font
        ws["F3"].alignment = Alignment(horizontal="left", vertical="center")

        ws.merge_cells("K3:M3")
        ws["K3"] = "Otomotiv Parçaları San. ve Tic. A.Ş."
        ws["K3"].font = meta_bold_font
        ws["K3"].alignment = Alignment(horizontal="right", vertical="center")

        # Satır 4: Makine ve Teçhizat Adı (A4:M4)
        ws.row_dimensions[4].height = 22
        ws.merge_cells("A4:M4")
        machine_code = getattr(machine, "code", "") or ""
        machine_name = getattr(machine, "name", "") or ""
        machine_label = f"{machine_code} - {machine_name}".strip(" -")
        ws["A4"] = f"  Makine ve Teçhizat Adı: {machine_label}"
        ws["A4"].font = meta_bold_font
        ws["A4"].alignment = Alignment(horizontal="left", vertical="center")

        # Satır 5: Boş satır
        ws.row_dimensions[5].height = 10

        # Satır 6 & 7: Birebir 2 satırlı resmi tablo başlıkları
        ws.row_dimensions[6].height = 18
        ws.row_dimensions[7].height = 18

        # A6:B7 -> TARİH
        ws.merge_cells("A6:B7")
        ws["A6"] = "TARİH"

        # C6:D6 -> ARIZA VE YAPILAN, C7:D7 -> İŞİN TANIMI
        ws.merge_cells("C6:D6")
        ws["C6"] = "ARIZA VE YAPILAN"
        ws.merge_cells("C7:D7")
        ws["C7"] = "İŞİN TANIMI"

        # E6:F7 -> YAPILAN İŞİN AÇIKLAMASI
        ws.merge_cells("E6:F7")
        ws["E6"] = "YAPILAN İŞİN AÇIKLAMASI"

        # G6:H6 -> DEĞİŞEN , G7:H7 -> PARÇA
        ws.merge_cells("G6:H6")
        ws["G6"] = "DEĞİŞEN "
        ws.merge_cells("G7:H7")
        ws["G7"] = "PARÇA"

        # I6:I7 -> KALIP BASKI SAYISI
        ws.merge_cells("I6:I7")
        ws["I6"] = "KALIP BASKI SAYISI"

        # J6 -> ARIZA-KAIZEN, J7 -> BİLDİRİM NO
        ws["J6"] = "ARIZA-KAIZEN"
        ws["J7"] = "BİLDİRİM NO"

        # K6 -> KULLANILAN, K7 -> A/S.DAHİLİ
        ws["K6"] = "KULLANILAN"
        ws["K7"] = "A/S.DAHİLİ"

        # L6 -> İŞİ, L7 -> YAPAN
        ws["L6"] = "İŞİ"
        ws["L7"] = "YAPAN"

        # M6:M7 -> ONAY
        ws.merge_cells("M6:M7")
        ws["M6"] = "ONAY"

        for r in (6, 7):
            for c in range(1, 14):
                cell = ws.cell(r, c)
                cell.font = tbl_hdr_font
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                if c in (1, 2, 5, 6, 9, 13):
                    cell.border = hdr_full_border
                else:
                    cell.border = hdr_top_border if r == 6 else hdr_bot_border

        # Satır 8+: Veri Satırları (en az 20 satırlık resmi çizelge)
        total_rows = max(len(rows), 20)
        for i in range(total_rows):
            r_idx = 8 + i
            ws.row_dimensions[r_idx].height = 24
            ws.merge_cells(start_row=r_idx, start_column=1, end_row=r_idx, end_column=2)
            ws.merge_cells(start_row=r_idx, start_column=3, end_row=r_idx, end_column=4)
            ws.merge_cells(start_row=r_idx, start_column=5, end_row=r_idx, end_column=6)
            ws.merge_cells(start_row=r_idx, start_column=7, end_row=r_idx, end_column=8)

            row_obj = rows[i] if i < len(rows) else None
            col_values = [
                (1, getattr(row_obj, "date_str", "") if row_obj else "", "center"),
                (3, getattr(row_obj, "fault_work_title", "") if row_obj else "", "left"),
                (5, getattr(row_obj, "work_description", "") if row_obj else "", "left"),
                (7, getattr(row_obj, "replaced_part", "") if row_obj else "", "left"),
                (9, getattr(row_obj, "mold_shot_count", "") if row_obj else "", "center"),
                (10, getattr(row_obj, "notification_no", "") if row_obj else "", "center"),
                (11, getattr(row_obj, "used_material", "") if row_obj else "", "left"),
                (12, getattr(row_obj, "performed_by", "") if row_obj else "", "center"),
                (13, getattr(row_obj, "approved_by", "") if row_obj else "", "center"),
            ]
            for col_num, val, horiz in col_values:
                cell = ws.cell(r_idx, col_num, value=val or "")
                cell.font = data_font
                cell.alignment = Alignment(horizontal=horiz, vertical="center", wrap_text=True)

            for c in range(1, 14):
                ws.cell(r_idx, c).border = cell_border

        safe_code = re.sub(r"[^A-Za-z0-9_-]+", "_", machine_code).strip("_") or "MAKINE"
        export_filename = f"FR-PE-0006_{safe_code}.xlsx"

        buffer = io.BytesIO()
        wb.save(buffer)
        wb.close()
        buffer.seek(0)
        return buffer.getvalue(), export_filename

    PERIODIC_MONTHS = [
        "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL",
        "EKİM", "KASIM", "ARALIK", "OCAK", "ŞUBAT", "MART"
    ]

    DEFAULT_PERIODIC_ROWS = [
        {"no": 1, "parameter": "KOÇ KIZAK PARALELLİK KONTROLÜ (YIL/1 SERVİS YAPACAK)\n(PARALEL OLMALI MAX:0.05 KAÇIK OLMALI)", "period": "(YIL/1)", "input_type": "check"},
        {"no": 2, "parameter": "KAVRAMA GRUBU KONTROLÜ\n(AŞINMA OLMAMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 3, "parameter": "REGLAJ GRUBU KONTROLÜ\n( EYE MARK OLMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 4, "parameter": "YAĞ POMPASI VE YAĞLAMA SİSTEMİ KONTROLÜ\n(KAÇAK VE DEFORME OLMAMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 5, "parameter": "ELEKTRİK PANO -TESİSAT VE SENSÖR KONTROLÜ\n(GEVŞEME VE KOPMA OLMAMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 6, "parameter": "MOTOR KAYIŞLARININ KONTROLÜ\n(GEVŞEME ÇATLAK VE KOPMA OLMAMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 7, "parameter": "ŞANZIMAN YAĞ KONTROLÜ\n(TANK GÖSTERGE DOLU GÖSTERMELİ)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 8, "parameter": "YAĞ SEVİYESİ KONTROLÜ\n(TANK GÖSTERGE İŞARETLİ ARALIKTA OLMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 9, "parameter": "MAKINA GENEL ÇALIŞMA KONTROLÜ\n( ÇALIŞIYOR OLMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 10, "parameter": "AÇİL STOP VE IŞIK BARİYERİ KONTROLÜ\n(ÇALIŞMALI DEFORME GEVŞEME OLMAMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 11, "parameter": "YAĞ VE HAVA KAÇAK KONTROLÜ\n(KAÇAK OLMAMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 12, "parameter": "HAVA BASINÇ KONTROLÜ   ( 6 BAR OLMALI ÖLÇÜLEN DEĞER RAKAMSAL OLARAK YAZILMALI )", "period": "(YIL/4)", "input_type": "numeric"},
        {"no": 13, "parameter": "YAĞLAMA SİSTEMİ GERİ DÖNÜŞ FİLTRE KONTROLÜ (TIKALI OLMAMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 14, "parameter": "KAVRAMA HAVA BASINCI KONT.( 5-6 BAR ARASI OLMALI ÖLÇÜLEN DEĞER RAKAMSAL OLARAK YAZILMALI )", "period": "(YIL/4)", "input_type": "numeric"},
        {"no": 15, "parameter": "KLAMP HİD.BASINCI KONT.( 250 BAR OLMALI ÖLÇÜLEN DEĞER RAKAMSAL OLARAK YAZILMALI )", "period": "(YIL/4)", "input_type": "numeric"},
        {"no": 16, "parameter": "KLAMP HİD.TANK HAVA BASINCI KONT. (2.5 BAR OLMALI ÖLÇÜLEN DEĞER RAKAMSAL OLARAK YAZILMALI )", "period": "(YIL/4)", "input_type": "numeric"},
        {"no": 17, "parameter": "MAKINA GENEL TEMİZLİĞİ", "period": "(YIL/4)", "input_type": "check"},
        {"no": 18, "parameter": "BUTON KONTAKLARININ DEĞİŞİMİ", "period": "(YIL/1)", "input_type": "check"},
        {"no": 19, "parameter": "MOTOR KLEMENS BAĞLANTI KONTROLÜ\n(KLEMENS KUTUSUNU AÇ, GEVŞEK CİVATALARI SIK)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 20, "parameter": "KAVRAMA GRUP BAKIMI - SERVİS KONTROLÜ\n(BALATA VE BURÇ KONTROLÜ YAP. DİSK BALATA ARASI MESAFE MAX 1,5mm OLMALI)", "period": "(YIL/1)", "input_type": "check"},
        {"no": 21, "parameter": "PNÖMATİK SİSTEMİN VE YAĞLAYICILARIN KONTROLU\n(EYE-MARK KONTROLÜ)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 22, "parameter": "HİDROLİK SİGORTA DOLDURMA HAVA HATTI YAĞLAYICISI\n(YAĞ SEVİYESİ İŞARETLİ NOKTALAR ARASINDA OLMALI)", "period": "(YIL/4)", "input_type": "check"},
        {"no": 23, "parameter": "ENCODER KAYIŞININ KONTROL EDİLMESİ   (Gevşeme,Çatlak ve Kopma Olmamalı)", "period": "(YIL/4)", "input_type": "check"},
    ]

    @classmethod
    def build_default_periodic_sheet_data(cls) -> Dict[str, Any]:
        empty_months = {m: "" for m in cls.PERIODIC_MONTHS}
        rows = []
        for item in cls.DEFAULT_PERIODIC_ROWS:
            rows.append({
                "no": item["no"],
                "parameter": item["parameter"],
                "period": item["period"],
                "input_type": item["input_type"],
                "months": dict(empty_months),
                "notes": ""
            })
        return {
            "dates": dict(empty_months),
            "rows": rows,
            "performed_by": dict(empty_months),
            "approved_by": dict(empty_months),
        }

    @classmethod
    def export_periodic_sheet_excel_bytes(
        cls,
        machine: Any,
        sheet_data: Dict[str, Any],
        year: int = 2026,
        doc_no: str = "FR-PE-0446",
        revision: str = "Rev. 9.10.2026",
        title: Optional[str] = None
    ) -> Tuple[bytes, str]:
        """
        FR-PE-0446 PERİYODİK BAKIM KONTROL LİSTESİ resmi denetim formatında
        (20 sütun A..T, satır 1..32 birebir hücre yerleşimi) Excel (.xlsx) üretir.
        """
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "FR-PE-0446"
        ws.views.sheetView[0].showGridLines = True
        ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 1
        ws.sheet_properties.pageSetUpPr.fitToPage = True

        # Resmi 20 sütun (A..T) genişlikleri:
        # A=NO, B:E=KONTROL PARAMETRELERİ (4 sütun birleşik -> 48), F=PERİYOD, G..R=12 AY, S:T=AÇIKLAMALAR (2 sütun birleşik -> 24)
        ws.column_dimensions["A"].width = 5.5
        for col_letter in ("B", "C", "D", "E"):
            ws.column_dimensions[col_letter].width = 12.0
        ws.column_dimensions["F"].width = 9.5
        for col_idx in range(7, 19):  # G (7) .. R (18)
            ws.column_dimensions[get_column_letter(col_idx)].width = 8.5
        ws.column_dimensions["S"].width = 12.0
        ws.column_dimensions["T"].width = 12.0

        thin = Side(border_style="thin", color="000000")
        medium = Side(border_style="medium", color="000000")
        cell_border = Border(left=thin, right=thin, top=thin, bottom=thin)
        header_border = Border(left=thin, right=thin, top=medium, bottom=medium)

        title_font = Font(name="Calibri", size=14, bold=True)
        meta_font = Font(name="Calibri", size=10, bold=False)
        meta_bold = Font(name="Calibri", size=10, bold=True)
        hdr_font = Font(name="Calibri", size=9, bold=True)
        data_font = Font(name="Calibri", size=9, bold=False)
        check_font = Font(name="Calibri", size=11, bold=True, color="047857")
        fail_font = Font(name="Calibri", size=11, bold=True, color="DC2626")

        machine_code = getattr(machine, "code", "") or ""
        machine_name = getattr(machine, "name", "") or ""
        form_title = (title or f"{machine_code} {machine_name} PERİYODİK BAKIM KONTROL LİSTESİ").strip()

        # Satır 1: Ana Başlık (A1:T1)
        ws.row_dimensions[1].height = 26
        ws.merge_cells("A1:T1")
        ws["A1"] = form_title
        ws["A1"].font = title_font
        ws["A1"].alignment = Alignment(horizontal="center", vertical="center")

        # Satır 2: Boş satır
        ws.row_dimensions[2].height = 8

        # Satır 3: Resmi Meta Bilgiler (A3, D3, H3, Q3:T3 -> sağda Otomotiv Parçaları San. ve Tic. A.Ş.)
        ws.row_dimensions[3].height = 20
        ws.merge_cells("A3:C3")
        ws["A3"] = "Sayfa no: 1 / 1"
        ws["A3"].font = meta_font
        ws["A3"].alignment = Alignment(horizontal="left", vertical="center")

        ws.merge_cells("D3:G3")
        ws["D3"] = revision or "Rev. 9.10.2026"
        ws["D3"].font = meta_font
        ws["D3"].alignment = Alignment(horizontal="left", vertical="center")

        ws.merge_cells("H3:P3")
        ws["H3"] = f"Doküman no: {doc_no or 'FR-PE-0446'}"
        ws["H3"].font = meta_font
        ws["H3"].alignment = Alignment(horizontal="left", vertical="center")

        ws.merge_cells("Q3:T3")
        ws["Q3"] = "Otomotiv Parçaları San. ve Tic. A.Ş."
        ws["Q3"].font = meta_bold
        ws["Q3"].alignment = Alignment(horizontal="right", vertical="center")

        # Satır 4-5: Resmi Tablo Başlıkları
        ws.row_dimensions[4].height = 20
        ws.row_dimensions[5].height = 20

        ws.merge_cells("A4:A5")
        ws["A4"] = "NO:"
        ws.merge_cells("B4:E5")
        ws["B4"] = "KONTROL PARAMETRELERİ"
        ws.merge_cells("F4:F5")
        ws["F4"] = "PERİYOD"
        ws.merge_cells("G4:R4")
        ws["G4"] = "BAKIM YAPILAN AY VE HAFTALAR"
        ws.merge_cells("S4:T5")
        ws["S4"] = "AÇIKLAMALAR"

        for idx, m_name in enumerate(cls.PERIODIC_MONTHS, start=7):  # G (7) .. R (18)
            ws.cell(5, idx, value=m_name)

        for r in (4, 5):
            for c in range(1, 21):
                cell = ws.cell(r, c)
                cell.font = hdr_font
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                cell.border = header_border

        # Satır 6: BAKIM HAFTA VE TARİH (A6 boş, B6:F6 birleşik, G6..R6 aylar, S6:T6 birleşik)
        ws.row_dimensions[6].height = 22
        ws["A6"] = ""
        ws.merge_cells("B6:F6")
        ws["B6"] = "BAKIM HAFTA VE TARİH"
        ws["B6"].font = meta_bold
        ws["B6"].alignment = Alignment(horizontal="left", vertical="center")
        ws.merge_cells("S6:T6")

        dates_map = sheet_data.get("dates") or {}
        for idx, m_name in enumerate(cls.PERIODIC_MONTHS, start=7):
            c_cell = ws.cell(6, idx, value=str(dates_map.get(m_name, "") or ""))
            c_cell.font = data_font
            c_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        for c in range(1, 21):
            ws.cell(6, c).border = cell_border

        # Satır 7+: Parametre Satırları (1..23+)
        rows = sheet_data.get("rows") or []
        cur_row = 7
        for i, row_item in enumerate(rows, start=1):
            ws.row_dimensions[cur_row].height = 28
            ws.merge_cells(start_row=cur_row, start_column=2, end_row=cur_row, end_column=5)
            ws.merge_cells(start_row=cur_row, start_column=19, end_row=cur_row, end_column=20)

            no_cell = ws.cell(cur_row, 1, value=row_item.get("no", i))
            no_cell.font = meta_bold
            no_cell.alignment = Alignment(horizontal="center", vertical="center")

            p_cell = ws.cell(cur_row, 2, value=str(row_item.get("parameter", "") or ""))
            p_cell.font = data_font
            p_cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

            per_cell = ws.cell(cur_row, 6, value=str(row_item.get("period", "") or ""))
            per_cell.font = data_font
            per_cell.alignment = Alignment(horizontal="center", vertical="center")

            months_map = row_item.get("months") or {}
            for idx, m_name in enumerate(cls.PERIODIC_MONTHS, start=7):
                val = str(months_map.get(m_name, "") or "")
                m_cell = ws.cell(cur_row, idx, value=val)
                if val == "✓":
                    m_cell.font = check_font
                elif val == "✗":
                    m_cell.font = fail_font
                else:
                    m_cell.font = data_font
                m_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

            n_cell = ws.cell(cur_row, 19, value=str(row_item.get("notes", "") or ""))
            n_cell.font = data_font
            n_cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

            for c in range(1, 21):
                ws.cell(cur_row, c).border = cell_border
            cur_row += 1

        # KONTROLÜ YAPAN satırı (A:F birleşik, G..R aylar, S:T birleşik)
        ws.row_dimensions[cur_row].height = 24
        ws.merge_cells(start_row=cur_row, start_column=1, end_row=cur_row, end_column=6)
        ws.merge_cells(start_row=cur_row, start_column=19, end_row=cur_row, end_column=20)
        ws.cell(cur_row, 1, value="KONTROLÜ YAPAN ").font = meta_bold
        ws.cell(cur_row, 1).alignment = Alignment(horizontal="left", vertical="center")
        perf_map = sheet_data.get("performed_by") or {}
        for idx, m_name in enumerate(cls.PERIODIC_MONTHS, start=7):
            c_cell = ws.cell(cur_row, idx, value=str(perf_map.get(m_name, "") or ""))
            c_cell.font = data_font
            c_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        for c in range(1, 21):
            ws.cell(cur_row, c).border = cell_border
        cur_row += 1

        # ONAY satırı (A:F birleşik, G..R aylar, S:T birleşik)
        ws.row_dimensions[cur_row].height = 24
        ws.merge_cells(start_row=cur_row, start_column=1, end_row=cur_row, end_column=6)
        ws.merge_cells(start_row=cur_row, start_column=19, end_row=cur_row, end_column=20)
        ws.cell(cur_row, 1, value="ONAY").font = meta_bold
        ws.cell(cur_row, 1).alignment = Alignment(horizontal="left", vertical="center")
        appr_map = sheet_data.get("approved_by") or {}
        for idx, m_name in enumerate(cls.PERIODIC_MONTHS, start=7):
            c_cell = ws.cell(cur_row, idx, value=str(appr_map.get(m_name, "") or ""))
            c_cell.font = data_font
            c_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        for c in range(1, 21):
            ws.cell(cur_row, c).border = cell_border
        cur_row += 1

        # Dipnot (A:T birleşik)
        ws.row_dimensions[cur_row].height = 20
        ws.merge_cells(start_row=cur_row, start_column=1, end_row=cur_row, end_column=20)
        note_cell = ws.cell(
            cur_row, 1,
            value="NOT: KONTROL EDİLEN HER PAREMETRENİN KARŞINDAKİ KUTUCUĞA BAKIM YAPTIĞI AYA AİT HAFTA NUMARASI YAZILACAKTIR."
        )
        note_cell.font = Font(name="Calibri", size=9, bold=True)
        note_cell.alignment = Alignment(horizontal="left", vertical="center")

        safe_code = re.sub(r"[^A-Za-z0-9_-]+", "_", machine_code).strip("_") or "MAKINE"
        export_filename = f"FR-PE-0446_{safe_code}_{year}.xlsx"

        buffer = io.BytesIO()
        wb.save(buffer)
        wb.close()
        buffer.seek(0)
        return buffer.getvalue(), export_filename

