import os, glob
from datetime import datetime
from pathlib import Path
import openpyxl

BASE_DIR = Path(r"C:\Users\ecem.sayar\Desktop\Doruk\97 Doruk Otomasyon Rapor\2026 KEYPET DÖKÜMANLARI")
print("Base dir exists:", BASE_DIR.exists())

date_test = datetime(2026, 11, 6)
month_folder = "11 KASIM"
month_path = BASE_DIR / month_folder
print("Month path exists:", month_path.exists())

matching_files = list(month_path.glob(f"*{date_test.day:02d}*.*"))
print("Matching files for 06.11:", matching_files)
