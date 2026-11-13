import sys
from app.database import SessionLocal
from app.models import Machine

LAYOUT_MACHINES = [
    # ================= A BİNASI (ASSEMBLY PLANT / MONTAJ) =================
    # HAT 1: AS3001 Montaj Hattı
    {"building": "A BİNASI", "line": "HAT 1 (AS3001 MONTAJ)", "code": "AS3001-1", "name": "AS3001 Montaj İstasyonu 1", "model": "Assembly Line Station 1"},
    {"building": "A BİNASI", "line": "HAT 1 (AS3001 MONTAJ)", "code": "AS3001-2", "name": "AS3001 Montaj İstasyonu 2", "model": "Assembly Line Station 2"},
    {"building": "A BİNASI", "line": "HAT 1 (AS3001 MONTAJ)", "code": "AS3001-3", "name": "AS3001 Montaj İstasyonu 3", "model": "Assembly Line Station 3"},
    {"building": "A BİNASI", "line": "HAT 1 (AS3001 MONTAJ)", "code": "AS3001-TAB", "name": "Table Assy Montaj Masası", "model": "Table Assy Jig"},
    
    # HAT 2: AS3101 Montaj Hattı
    {"building": "A BİNASI", "line": "HAT 2 (AS3101 MONTAJ)", "code": "AS3101", "name": "AS3101 Montaj İstasyonu", "model": "Station AS3101"},
    {"building": "A BİNASI", "line": "HAT 2 (AS3101 MONTAJ)", "code": "AS3101-NP", "name": "Nut Press (Somun Presi)", "model": "Nut Press System"},
    {"building": "A BİNASI", "line": "HAT 2 (AS3101 MONTAJ)", "code": "AS3101-GT", "name": "Garnish Table (Garnitür Masası)", "model": "Garnish Jig Stand"},
    
    # HAT 3: AS3201 Montaj Hattı
    {"building": "A BİNASI", "line": "HAT 3 (AS3201 MONTAJ)", "code": "AS3201", "name": "AS3201 Montaj İstasyonu", "model": "Station AS3201"},
    {"building": "A BİNASI", "line": "HAT 3 (AS3201 MONTAJ)", "code": "AS3201-SA", "name": "Seal Assy Table (Conta Montaj)", "model": "Seal Jig Stand"},
    {"building": "A BİNASI", "line": "HAT 3 (AS3201 MONTAJ)", "code": "AS3201-PP", "name": "Press Pump (Pres Pompası)", "model": "Hydraulic Press Pump"},
    
    # HAT 4: AS3301 Montaj Hattı
    {"building": "A BİNASI", "line": "HAT 4 (AS3301 MONTAJ)", "code": "AS3301", "name": "AS3301 Montaj İstasyonu", "model": "Station AS3301"},
    {"building": "A BİNASI", "line": "HAT 4 (AS3301 MONTAJ)", "code": "AS3301-KK", "name": "Kilit Kapatma İstasyonu", "model": "Lock Closer Jig"},
    {"building": "A BİNASI", "line": "HAT 4 (AS3301 MONTAJ)", "code": "AS3301-YS", "name": "Yay Sarma & Roller", "model": "Spring Winder Roller"},
    
    # HAT 5: AS3401 Montaj Hattı
    {"building": "A BİNASI", "line": "HAT 5 (AS3401 MONTAJ)", "code": "AS3401-1", "name": "AS3401 Montaj İstasyonu 1", "model": "Station AS3401-1"},
    {"building": "A BİNASI", "line": "HAT 5 (AS3401 MONTAJ)", "code": "AS3401-2", "name": "AS3401 Montaj İstasyonu 2", "model": "Station AS3401-2"},
    {"building": "A BİNASI", "line": "HAT 5 (AS3401 MONTAJ)", "code": "AS3401-3", "name": "AS3401 Montaj İstasyonu 3", "model": "Station AS3401-3"},

    # HAT 6: AS4401 / 7401 / 9401 / 10401 Hatları
    {"building": "A BİNASI", "line": "HAT 6 (AS4401 / 7401 / 9401)", "code": "AS4401", "name": "AS4401 Özel Montaj İstasyonu", "model": "Station AS4401"},
    {"building": "A BİNASI", "line": "HAT 6 (AS4401 / 7401 / 9401)", "code": "AS7401", "name": "AS7401 Montaj Hattı", "model": "Station AS7401"},
    {"building": "A BİNASI", "line": "HAT 6 (AS4401 / 7401 / 9401)", "code": "AS9401", "name": "AS9401 Montaj Hattı", "model": "Station AS9401"},
    {"building": "A BİNASI", "line": "HAT 6 (AS4401 / 7401 / 9401)", "code": "AS10401-1", "name": "AS10401 Montaj İstasyonu 1", "model": "Station AS10401-1"},
    {"building": "A BİNASI", "line": "HAT 6 (AS4401 / 7401 / 9401)", "code": "AS10401-2", "name": "AS10401 Montaj İstasyonu 2", "model": "Station AS10401-2"},

    # DOOR LOCK (Kilit Montaj ve Test Hattı)
    {"building": "A BİNASI", "line": "DOOR LOCK HATTI (KİLİT)", "code": "DL-TESTER", "name": "DL (Door Lock) Test Cihazı", "model": "Functional Tester"},
    {"building": "A BİNASI", "line": "DOOR LOCK HATTI (KİLİT)", "code": "DL-KONTROL", "name": "DL Kontrol ve Takumi İstasyonu", "model": "Takumi Inspection Station"},
    {"building": "A BİNASI", "line": "DOOR LOCK HATTI (KİLİT)", "code": "NEW-TESTER", "name": "Door Lock Yeni Test Cihazı", "model": "Advanced DL Tester"},
    {"building": "A BİNASI", "line": "DOOR LOCK HATTI (KİLİT)", "code": "PFL-CIHAZ", "name": "PFL Cihazı & Etiketleme", "model": "PFL Device Tester"},
    {"building": "A BİNASI", "line": "DOOR LOCK HATTI (KİLİT)", "code": "DL-TK", "name": "Terminal Kesme Makinesi", "model": "Wire Cutting Machine"},
    {"building": "A BİNASI", "line": "DOOR LOCK HATTI (KİLİT)", "code": "DL-GP", "name": "Gress Pompası ve Yağlama Masası", "model": "Grease Pump System"},

    # ATÖLYE & YARDIMCI TESİSLER (Downstairs)
    {"building": "A BİNASI", "line": "YARDIMCI TESİSLER & ATÖLYE", "code": "KOMPRESOR-A", "name": "Vidalı Hava Kompresörü", "model": "Atlas Copco GA45"},
    {"building": "A BİNASI", "line": "YARDIMCI TESİSLER & ATÖLYE", "code": "AS-BAKIM", "name": "Bakım & Kaizen Atölyesi", "model": "Maintenance Workshop"},
    {"building": "A BİNASI", "line": "YARDIMCI TESİSLER & ATÖLYE", "code": "AS-TASARIM", "name": "Tasarım Merkezi Prototip Alanı", "model": "Design Workshop"},

    # ================= B BİNASI (PLASTICS PLANT / ENJEKSİYON) =================
    # PT Serisi Plastik Enjeksiyon
    {"building": "B BİNASI", "line": "PLASTİK ENJEKSİYON (PT SERİSİ)", "code": "PT2101", "name": "Plastik Enjeksiyon Makinesi 01", "model": "KraussMaffei 350T"},
    {"building": "B BİNASI", "line": "PLASTİK ENJEKSİYON (PT SERİSİ)", "code": "PT2102", "name": "Plastik Enjeksiyon Makinesi 02", "model": "KraussMaffei 350T"},
    {"building": "B BİNASI", "line": "PLASTİK ENJEKSİYON (PT SERİSİ)", "code": "PT2103", "name": "Plastik Enjeksiyon Makinesi 03", "model": "KraussMaffei 450T"},
    {"building": "B BİNASI", "line": "PLASTİK ENJEKSİYON (PT SERİSİ)", "code": "PT2104", "name": "Plastik Enjeksiyon Makinesi 04", "model": "Engel 500T"},
    {"building": "B BİNASI", "line": "PLASTİK ENJEKSİYON (PT SERİSİ)", "code": "PT-KALIP", "name": "Plastik Kalıp Bakım İstasyonu", "model": "Mold Maintenance Station"},

    # L66x Enjeksiyon Hatları
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L660", "name": "L660 Plastik Pres & Kalıp Hattı", "model": "Line L660"},
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L661", "name": "L661 Plastik Pres & Kalıp Hattı", "model": "Line L661"},
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L662", "name": "L662 Plastik Pres & Kalıp Hattı", "model": "Line L662"},
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L663", "name": "L663 Plastik Pres & Kalıp Hattı", "model": "Line L663"},
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L664", "name": "L664 Plastik Pres & Kalıp Hattı", "model": "Line L664"},
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L665", "name": "L665 Plastik Pres & Kalıp Hattı", "model": "Line L665"},
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L666", "name": "L666 Plastik Pres & Kalıp Hattı", "model": "Line L666"},
    {"building": "B BİNASI", "line": "L66x ENJEKSİYON & PRES HATTI", "code": "L667", "name": "L667 Plastik Pres & Kalıp Hattı", "model": "Line L667"},

    # C ve Z Serisi Kalıplar / Presler
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C750", "name": "C750 Kalıp / Pres İstasyonu", "model": "Station C750"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C760", "name": "C760 Kalıp / Pres İstasyonu", "model": "Station C760"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C770", "name": "C770 Kalıp / Pres İstasyonu", "model": "Station C770"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C780", "name": "C780 Kalıp / Pres İstasyonu", "model": "Station C780"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C790", "name": "C790 Kalıp / Pres İstasyonu", "model": "Station C790"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C800", "name": "C800 Kalıp / Pres İstasyonu", "model": "Station C800"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C810", "name": "C810 Kalıp / Pres İstasyonu", "model": "Station C810"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C820", "name": "C820 Kalıp / Pres İstasyonu", "model": "Station C820"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C830", "name": "C830 Kalıp / Pres İstasyonu", "model": "Station C830"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "C840", "name": "C840 Kalıp / Pres İstasyonu", "model": "Station C840"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "Z810", "name": "Z810 Kalıp / Pres İstasyonu", "model": "Station Z810"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "Z811", "name": "Z811 Kalıp / Pres İstasyonu", "model": "Station Z811"},
    {"building": "B BİNASI", "line": "C & Z SERİSİ KALIPLAR / PRESLER", "code": "Z815", "name": "Z815 Kalıp / Pres İstasyonu", "model": "Station Z815"},

    # AS24xx Montaj Hatları (Grup 1)
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 1", "code": "AS2402", "name": "AS2402 Plastik Montaj İstasyonu", "model": "Station AS2402"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 1", "code": "AS2405", "name": "AS2405 Plastik Montaj İstasyonu", "model": "Station AS2405"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 1", "code": "AS2407", "name": "AS2407 Plastik Montaj İstasyonu", "model": "Station AS2407"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 1", "code": "AS2409", "name": "AS2409 Plastik Montaj İstasyonu", "model": "Station AS2409"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 1", "code": "AS2410", "name": "AS2410 Plastik Montaj İstasyonu", "model": "Station AS2410"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 1", "code": "AS2412", "name": "AS2412 Plastik Montaj İstasyonu", "model": "Station AS2412"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 1", "code": "AS2413", "name": "AS2413 Plastik Montaj İstasyonu", "model": "Station AS2413"},

    # AS24xx Montaj Hatları (Grup 2)
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2414", "name": "AS2414 Plastik Montaj İstasyonu", "model": "Station AS2414"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2415", "name": "AS2415 Plastik Montaj İstasyonu", "model": "Station AS2415"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2416", "name": "AS2416 Plastik Montaj İstasyonu", "model": "Station AS2416"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2416-1", "name": "AS2416-1 Montaj İstasyonu", "model": "Station AS2416-1"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2417", "name": "AS2417 Plastik Montaj İstasyonu", "model": "Station AS2417"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2418", "name": "AS2418 Plastik Montaj İstasyonu", "model": "Station AS2418"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2419", "name": "AS2419 Plastik Montaj İstasyonu", "model": "Station AS2419"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 2", "code": "AS2420", "name": "AS2420 Plastik Montaj İstasyonu", "model": "Station AS2420"},

    # AS24xx Montaj Hatları (Grup 3)
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2421", "name": "AS2421 Plastik Montaj İstasyonu", "model": "Station AS2421"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2422", "name": "AS2422 Plastik Montaj İstasyonu", "model": "Station AS2422"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2423", "name": "AS2423 Plastik Montaj İstasyonu", "model": "Station AS2423"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2424", "name": "AS2424 Plastik Montaj İstasyonu", "model": "Station AS2424"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2425", "name": "AS2425 Plastik Montaj İstasyonu", "model": "Station AS2425"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2426", "name": "AS2426 Plastik Montaj İstasyonu", "model": "Station AS2426"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2427", "name": "AS2427 Plastik Montaj İstasyonu", "model": "Station AS2427"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2428", "name": "AS2428 Plastik Montaj İstasyonu", "model": "Station AS2428"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2431", "name": "AS2431 Plastik Montaj İstasyonu", "model": "Station AS2431"},
    {"building": "B BİNASI", "line": "AS24xx MONTAJ HATTI 3", "code": "AS2432", "name": "AS2432 Plastik Montaj İstasyonu", "model": "Station AS2432"},

    # Boyahane & Test
    {"building": "B BİNASI", "line": "BOYAHANE & TEST HATTI", "code": "QC-PAINT", "name": "QC Paint Test Room Test Masası", "model": "Paint Test System"},
    {"building": "B BİNASI", "line": "BOYAHANE & TEST HATTI", "code": "PAINT-ROBOT", "name": "Boyahane Robot Paneli", "model": "Robot Controller Panel"},
    {"building": "B BİNASI", "line": "BOYAHANE & TEST HATTI", "code": "JIG-FIRIN", "name": "Jig Fırını & Tiner Temizlik", "model": "Curing Oven System"},

    # Gaz Kontrol & Hammadde
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "GAS-3501", "name": "GAS CONT 3501 Gaz Kontrol Ünitesi", "model": "Gas Controller Unit"},
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "GAS-3502", "name": "GAS CONT 3502 Gaz Kontrol Ünitesi", "model": "Gas Controller Unit"},
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "GAS-3507", "name": "GAS CONT 3507 Gaz Kontrol Ünitesi", "model": "Gas Controller Unit"},
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "GAS-3508", "name": "GAS CONT 3508 Gaz Kontrol Ünitesi", "model": "Gas Controller Unit"},
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "GAS-35011", "name": "GAS CONT 350 11 Gaz Kontrol Ünitesi", "model": "Gas Controller Unit"},
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "RESIN-DRY", "name": "Hammadde Kurutucu (Dryer) & Silo", "model": "Resin Dryer Silo"},
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "RESIN-MIX", "name": "Hammadde Mikser & Oktabin", "model": "Mixer & Octabin Station"},
    {"building": "B BİNASI", "line": "GAZ KONTROL & HAMMADDE", "code": "BREAKER-SYS", "name": "Plastik Kırıcı (Breaker) İstasyonu", "model": "Plastic Breaker Unit"},

    # ================= C BİNASI (METAL PLANT / PRES & KAYNAK) =================
    # Rollforming (Rulo) Hatları
    {"building": "C BİNASI", "line": "ROLLFORMING (RULO) HATLARI", "code": "RL1001", "name": "RL1001 Rollforming (Rulo Hattı 1)", "model": "Rollforming Line 1"},
    {"building": "C BİNASI", "line": "ROLLFORMING (RULO) HATLARI", "code": "RL1002", "name": "RL1002 Rollforming (Rulo Hattı 2)", "model": "Rollforming Line 2"},
    {"building": "C BİNASI", "line": "ROLLFORMING (RULO) HATLARI", "code": "RL1003", "name": "RL1003 Rollforming (Rulo Hattı 3)", "model": "Rollforming Line 3"},

    # AS14xx Otomatik Presli Montaj Hatları
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1301", "name": "AS1301 Metal Montaj Pres Hattı", "model": "Station AS1301"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1401", "name": "AS1401 Otomatik Montaj Hattı (Masa 1)", "model": "Station AS1401-M1"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1402", "name": "AS1402 Otomatik Montaj Hattı (Masa 2)", "model": "Station AS1402-M2"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1403", "name": "AS1403 Otomatik Montaj Hattı (Masa 3)", "model": "Station AS1403-M3"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1404", "name": "AS1404 Otomatik Montaj Hattı (Masa 4)", "model": "Station AS1404-M4"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1405", "name": "AS1405 Metal Montaj Hattı", "model": "Station AS1405"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1406", "name": "AS1406 Metal Montaj Hattı", "model": "Station AS1406"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1407", "name": "AS1407 Otomatik Perçinleme & Montaj", "model": "Rivet & Assembly Station"},
    {"building": "C BİNASI", "line": "AS14xx OTOMATİK MONTAJ HATLARI", "code": "AS1408", "name": "AS1408 Otomatik Perçinleme & Montaj", "model": "Rivet & Assembly Station"},

    # Robotik Kaynak Hücreleri (WE Serisi)
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1201", "name": "WE1201 Robotik Kaynak Hücresi", "model": "KUKA Welding Cell 1"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1202", "name": "WE1202 Robotik Kaynak Hücresi", "model": "KUKA Welding Cell 2"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1203", "name": "WE1203 Robotik Kaynak Hücresi", "model": "Fanuc Welding Cell 3"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1204", "name": "WE1204 Robotik Kaynak Hücresi", "model": "Fanuc Welding Cell 4"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1205", "name": "WE1205 Robotik Kaynak Hücresi", "model": "Yaskawa Welding Cell 5"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1206", "name": "WE1206 Robotik Kaynak Hücresi", "model": "Yaskawa Welding Cell 6"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1207", "name": "WE1207 Robotik Kaynak Hücresi", "model": "KUKA Welding Cell 7"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1208", "name": "WE1208 Robotik Kaynak Hücresi", "model": "KUKA Welding Cell 8"},
    {"building": "C BİNASI", "line": "ROBOTİK KAYNAK HATLARI (WE SERİSİ)", "code": "WE1209", "name": "WE1209 Robotik Kaynak Hücresi", "model": "KUKA Welding Cell 9"},

    # Pres ve Kalıp Deneme Hatları
    {"building": "C BİNASI", "line": "PRES VE KALIP DENEME HATLARI", "code": "PR1001", "name": "PR1001 Mekanik Pres", "model": "Mechanical Press 1"},
    {"building": "C BİNASI", "line": "PRES VE KALIP DENEME HATLARI", "code": "PRES-01", "name": "160 Ton Hidrolik Pres 1", "model": "H-160T Hydraulic"},
    {"building": "C BİNASI", "line": "PRES VE KALIP DENEME HATLARI", "code": "PRES-02", "name": "250 Ton Eksantrik Pres 2", "model": "E-250T Eccentric"},
    {"building": "C BİNASI", "line": "PRES VE KALIP DENEME HATLARI", "code": "DIE-PRESS", "name": "Die Press 1 Hidrolik Ünitesi", "model": "Die Press Hydraulic Unit"},
    {"building": "C BİNASI", "line": "PRES VE KALIP DENEME HATLARI", "code": "SUB-PRESS", "name": "Alt Pres (SubPress) İstasyonu", "model": "Sub Press Station"},
    {"building": "C BİNASI", "line": "PRES VE KALIP DENEME HATLARI", "code": "ONE-SHOT", "name": "OneShoot Kalıp Deneme Presi", "model": "OneShot Trial Press"},

    # Manuel & Özel Kaynak Hatları
    {"building": "C BİNASI", "line": "MANUEL & ÖZEL KAYNAK HATLARI", "code": "CORNER-WELD", "name": "Corner Welding (Köşe Kaynak)", "model": "Corner Welding Rig"},
    {"building": "C BİNASI", "line": "MANUEL & ÖZEL KAYNAK HATLARI", "code": "BRKT-WELD", "name": "Bracket Welding (Braket Kaynak)", "model": "Bracket Welding Station"},
    {"building": "C BİNASI", "line": "MANUEL & ÖZEL KAYNAK HATLARI", "code": "SPOT-WELD", "name": "Spot Welding (Punto Kaynak)", "model": "Spot Welding Machine"},
    {"building": "C BİNASI", "line": "MANUEL & ÖZEL KAYNAK HATLARI", "code": "OTO-SPOT", "name": "Otomatik Spot Kaynak İstasyonu", "model": "Auto Spot Welder"},

    # C Kalıphane ve Talaşlı İmalat Atölyesi
    {"building": "C BİNASI", "line": "C KALIPHANE & MEKANİK ATÖLYE", "code": "TORNA-01", "name": "Torna Tezgahı", "model": "Universal Lathe"},
    {"building": "C BİNASI", "line": "C KALIPHANE & MEKANİK ATÖLYE", "code": "FREZE-01", "name": "Üniversal Freze Tezgahı", "model": "Milling Machine"},
    {"building": "C BİNASI", "line": "C KALIPHANE & MEKANİK ATÖLYE", "code": "TASLAMA-01", "name": "Düzlem Taşlama Tezgahı", "model": "Surface Grinder"},
    {"building": "C BİNASI", "line": "C KALIPHANE & MEKANİK ATÖLYE", "code": "TESTERE-01", "name": "Açılı / Şerit Profil Testeresi", "model": "Band Saw Machine"},
    {"building": "C BİNASI", "line": "C KALIPHANE & MEKANİK ATÖLYE", "code": "KALIP-BAKIM-1", "name": "Kalıp Bakım Masası 1", "model": "Die Maintenance Bench 1"},
    {"building": "C BİNASI", "line": "C KALIPHANE & MEKANİK ATÖLYE", "code": "KALIP-BAKIM-2", "name": "Kalıp Bakım Masası 2", "model": "Die Maintenance Bench 2"},
]

def seed_machines():
    db = SessionLocal()
    added_count = 0
    updated_count = 0

    for item in LAYOUT_MACHINES:
        code = item["code"].upper().strip()
        existing = db.query(Machine).filter(Machine.code == code).first()
        if existing:
            existing.department = item["building"]
            existing.line = item["line"]
            existing.name = item["name"]
            existing.model = item["model"]
            updated_count += 1
        else:
            m = Machine(
                code=code,
                name=item["name"],
                department=item["building"],
                line=item["line"],
                model=item["model"],
                status="CALISIYOR",
                total_downtime_minutes=0
            )
            db.add(m)
            added_count += 1

    db.commit()
    total = db.query(Machine).count()
    db.close()
    print(f"Seeding completed! Added: {added_count}, Updated: {updated_count}, Total in DB: {total}")

if __name__ == "__main__":
    seed_machines()
