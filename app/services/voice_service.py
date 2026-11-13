import re
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.schemas import VoiceParseResponse

class VoiceService:
    """
    Bakım personelinin sesli konuşmasını analiz edip
    FR-PE-0657 Fabrika Vardiya Formu (Excel) sütunlarına
    ve veritabanı formatına dönüştüren ayrıştırıcı servis.
    """

    CRITERIA_MAP = {
        "1": ("MAKİNA BAKIM", ["makina bakım", "makine bakım", "periyodik bakım", "temizlik", "filtre", "fan", "yağlama", "yağ değişim", "kaset filtre"]),
        "2": ("KALIP BAKIM", ["kalıp bakım", "kalıp temizli", "kalıp toplan", "kalıp revizyon", "kalıbı toplandı", "t3 rev", "t6 rev", "kalıp p bakım"]),
        "3": ("ELEKTRİK ARIZA", ["elektrik", "lamba", "aydınlatma", "led", "kablo", "sigorta", "termik", "kontaktör", "pano", "sürücü", "invertör", "plc", "fotosel", "sensör", "motor", "tepe lambası", "kumanda"]),
        "4": ("MEKANİK ARIZA", ["mekanik", "hortum", "valf", "hava kaçağı", "pompa", "basınç", "piston", "keçe", "silindir", "pnömatik", "rulman", "kayış", "dişli", "zincir", "kaplin", "civata", "bilye", "clamp", "kopan cıvata", "diafram"]),
        "5": ("KALIP ARIZA", ["kalıp arıza", "kalıp darbe", "çapak", "itici pim", "ezilme", "mastar", "kalıpta darbe"]),
        "6": ("KAİZEN", ["kaizen", "iyileştirme", "modifikasyon", "hava üfle", "geliştirme"]),
        "7": ("POKOYOKE", ["pokoyoke", "poka yoke", "hata önleyici"]),
        "8": ("YRD.TES. KONTROL", ["yardımcı tesis", "kompresör", "kazan", "genel kontrol", "kimyasal", "buhar", "su tesisat", "chiller"]),
        "9": ("IK DESTEK", ["ik destek", "insan kaynakları"]),
        "10": ("MAKER DESTEK", ["maker destek", "maker"]),
        "11": ("ÜRETİM DESTEK", ["üretim destek", "üretim desteği"]),
        "12": ("PC DESTEK", ["pc destek", "bilgisayar", "barkod", "yazıcı", "ekran"]),
        "13": ("QA DESTEK", ["qa destek", "kalite destek", "kalite kontrol"]),
        "14": ("AYAR", ["ayar yapıldı", "setleme", "kalibrasyon", "kalibre", "jig ayar", "sentil", "ayar"]),
        "15": ("EĞİTİM", ["eğitim", "seminer", "kurs"]),
        "16": ("TOPLANTI", ["toplantı", "vardiya toplantı", "5s toplantı"]),
        "17": ("KYT", ["kyt", "iş güvenliği tehlike", "risk değerlendirme"]),
        "18": ("GENCHI-GENBUTSU-GENİN", ["genchi", "genbutsu", "genin", "yerinde inceleme"]),
        "19": ("HAT KURULUMU", ["hat kurulum", "kurulum", "montaj hattı", "yeni hat"]),
        "20": ("PROJE HAZIRLIK", ["proje hazırlık", "yeni proje", "proje çalışması"]),
        "21": ("ÜRÜN TASARIMI", ["ürün tasarım", "cad", "teknik resim"]),
        "22": ("TPM", ["tpm", "tpm kapatıldı", "tpm bakım"]),
        "23": ("KAYIT(RAPORLAMA)", ["raporlama", "kayıt", "rapor hazırla", "veri girişi"]),
        "24": ("KALIP AYAR", ["kalıp ayar", "kalıp bağlama", "dandori", "kalıp sökme", "kalıp takma"]),
        "25": ("DIŞ GÖREV", ["dış görev", "tedarikçi", "lazere gidildi", "taşeron", "servise gidildi", "dışarı gidildi"]),
        "26": ("QCC", ["qcc", "kalite çemberi", "kalite kontrol çemberi"])
    }

    @classmethod
    def get_current_shift(cls) -> str:
        hour = datetime.now().hour
        if 8 <= hour < 16:
            return "08.00-16.00"
        elif 16 <= hour < 24:
            return "16.00-24.00"
        else:
            return "24.00 - 08.00"

    @classmethod
    def parse_speech_transcript(cls, transcript: str, known_machines: List[str] = None) -> VoiceParseResponse:
        """
        Operatörün konuşma dökümünü Hat Numarası, Makine Kodu, Kriter (1-26),
        Süre ve Yapılan İşlem olarak ayrıştırır.
        """
        text = transcript.strip()
        text_lower = text.lower()

        # 1. Bina Tespiti (A BİNASI, B BİNASI, C BİNASI, BÜTÜN BİNALAR, HİÇBİRİ)
        detected_building = "HİÇBİRİ"
        if re.search(r'\b(bütün\s*binalar|tüm\s*binalar|a-b-c|a\s*b\s*c|her\s*üç\s*bina)\b', text_lower):
            detected_building = "BÜTÜN BİNALAR"
        elif re.search(r'\b(a\s*binası|a\s*binasi|a\s*blok|a\s*plant)\b', text_lower):
            detected_building = "A BİNASI"
        elif re.search(r'\b(b\s*binası|b\s*binasi|b\s*blok|b\s*plant)\b', text_lower):
            detected_building = "B BİNASI"
        elif re.search(r'\b(c\s*binası|c\s*binasi|c\s*blok|c\s*plant)\b', text_lower):
            detected_building = "C BİNASI"

        # 2. Hat Numarası Tespiti (örn: "Hat 1", "Hat 2", "Hat 14", "1404 hattı", "1203 hattı", "1407 hattı")
        detected_line = None
        line_match = re.search(r'\b(?:hat\s*no\s*|hat\s*numarası\s*|hat\s*)([a-z0-9\-_]+)\b|\b([0-9]{3,5})\s*(?:hattı|hatı)\b', text_lower)
        if line_match:
            raw_line = (line_match.group(1) or line_match.group(2)).upper()
            detected_line = raw_line if raw_line.startswith("HAT") else f"HAT {raw_line}"

        # 3. Makine Kodu Tespiti (örn: AS1404, WET0015, PRES-01, CNC-02, RL1002, TMT1201, KAT1115, RBT58)
        machine_match = re.search(r'\b(as\s*\d{4}|wet\s*\d{4}|rl\s*\d{4}|cot\s*\d{4}|kat\s*\d{4}|tmt\s*\d{4}|rbt\s*\d{2}|pres[-\s]?\d+|cnc[-\s]?\d+)\b', text_lower)
        detected_machine = None
        if machine_match:
            raw_mach = machine_match.group(1).upper().replace(" ", "")
            detected_machine = raw_mach

        # Birleşik Hat & Makine metni
        parts = []
        if detected_building != "HİÇBİRİ":
            parts.append(detected_building)
        if detected_line:
            parts.append(detected_line)
        if detected_machine:
            parts.append(detected_machine)
        combined_line_machine = " - ".join(parts) if parts else (detected_line or detected_machine or "-")

        # 2. Harcanan Süre Tespiti (dakika cinsinden)
        time_spent = 0
        min_match = re.search(r'(\d+)\s*(dakika|dk)', text_lower)
        hour_match = re.search(r'(\d+)\s*(saat|sa)', text_lower)
        half_hour = re.search(r'(yarım|bucuk|buçuk)\s*saat', text_lower)

        if min_match:
            time_spent += int(min_match.group(1))
        if hour_match:
            time_spent += int(hour_match.group(1)) * 60
        if half_hour and not min_match and not hour_match:
            time_spent += 30

        # Sayı kelimeleri (otuz dakika, kırk beş dakika vb.)
        turkish_numbers = {
            "on": 10, "on beş": 15, "onbes": 15, "yirmi": 20, "yirmi beş": 25,
            "otuz": 30, "kırk": 40, "kırk beş": 45, "elli": 50, "altmış": 60,
            "yetmiş": 70, "seksen": 80, "doksan": 90, "yüz": 100, "yüz yirmi": 120
        }
        if time_spent == 0:
            for word, val in turkish_numbers.items():
                if f"{word} dakika" in text_lower or f"{word} dk" in text_lower:
                    time_spent = val
                    break

        if time_spent == 0:
            time_spent = 30  # Varsayılan 30 dk

        # 3. Kriter No & Kriter Adı Tespiti
        detected_criterion_no = "4"
        detected_criterion_name = "MEKANİK ARIZA"
        matched_criterion = False

        # Açık kriter numarası söylenmiş mi? (örn: "kriter 3", "kriter 16", "kriter no 4", "kriter 1")
        crit_num_match = re.search(r'\bkriter\s*(?:no\s*)?(\d{1,2})\b', text_lower)
        if crit_num_match:
            c_num = crit_num_match.group(1)
            if c_num in cls.CRITERIA_MAP:
                detected_criterion_no = c_num
                detected_criterion_name = cls.CRITERIA_MAP[c_num][0]
                matched_criterion = True

        # Anahtar kelimelerden kriter tespiti (örn: "elektrik arıza", "kalıp bakım", "tpm", "genchi genbutsu")
        if not matched_criterion:
            for crit_no, (crit_name, keywords) in cls.CRITERIA_MAP.items():
                if any(kw in text_lower for kw in keywords):
                    detected_criterion_no = crit_no
                    detected_criterion_name = crit_name
                    matched_criterion = True
                    break

        # 4. Yapılan İşlem Metnini Formatlama (Büyük Harflerle FR-PE-0657 tarzında)
        # Operatörün cümlesini temizleyip kurumsal iş formatına getiriyoruz
        cleaned_job = text.upper()
        # "DAKİKA DURDU", "DAKİKA SÜRDÜ" vb. kuyruklarını temizleyebilir veya koruyabiliriz
        
        # 5. Klasik Bakım Detayları (Geriye Uyumluluk İçin)
        parts_found = []
        common_parts = [
            "hortum", "valf", "sigorta", "piston", "rulman", "keçe", "filtre", "sensör",
            "kablo", "lamba", "clamp", "civata", "switch", "kayış"
        ]
        for p in common_parts:
            if p in text_lower:
                parts_found.append(p.upper())

        parts_str = ", ".join(set(parts_found)) if parts_found else "-"

        confidence = 0.90 if matched_criterion else 0.75

        return VoiceParseResponse(
            machine_code=detected_machine,
            line_no=detected_line,
            building=detected_building,
            area_line=combined_line_machine,
            job_description=cleaned_job,
            criterion_no=detected_criterion_no,
            criterion_name=detected_criterion_name,
            time_spent_minutes=time_spent,
            operator_name=None,  # Frontend aktif kullanıcıyı ekler
            shift=cls.get_current_shift(),
            failure_description=cleaned_job,
            action_taken=cleaned_job,
            downtime_minutes=time_spent,
            parts_replaced=parts_str,
            maintenance_type=f"{detected_criterion_no} - {detected_criterion_name}",
            confidence=confidence,
            raw_text=text
        )
