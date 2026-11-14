# 🏭 Akıllı Fabrika Bakım & Doruk MES Raporlama Sistemi

Bu uygulama, fabrika bakım personeli için geliştirilmiş; **sesle günlük bakım raporu doldurma**, **Doruk Otomasyon (ProManage / MES) çift yönlü entegrasyonu**, **makine bazlı arıza hafızası** ve **yapay zeka bakım chatbotu** içeren mobil uyumlu bir PWA (Progressive Web App) sistemidir.

---

## 🚀 Öne Çıkan Özellikler

1. **📱 Mobil & PC Erişimi (PWA):**
   - Fabrikadaki bakım personeli cep telefonlarından (Android / iPhone) veya ofisteki bilgisayarlarından tek bir arayüzden sisteme erişebilir.
   - PWA olarak ana ekrana eklenebilir, yerel uygulama gibi çalışır.

2. **🎙️ Sesle Günlük Rapor Doldurma (FR-PE-0657 Server Excel Entegre):**
   - Operatör mikrofona basarak konuşur (örn: *"C Plant AS1404 pnömatik valf hortumu patlamıştı yeni hortum taktık 45 dakika sürdü mekanik arıza"*).
   - Sistem konuşmadan **Çalışılan Bölgeyi** (C PLANT AS1404), **Yapılan İşlemi**, **Kriter Numarasını** (4 - MEKANİK ARIZA), **Harcanan Süreyi** (45 dk) ve **Operatör Adını** ayıklar.
   - Ekranda birebir Excel satırı simülasyonu oluşur; operatör okuyabilir, **"Sesli Dinle (TTS)"** butonuyla dinleyebilir ve istediği kutuyu düzeltebilir.
   - Onaylandığında iş yeri sunucusundaki günün Excel dosyasına (`.../11-KASIM/11.11.2026 ÇARŞAMBA.xlsx`) anlık saat damgasıyla doğrudan yeni satır olarak yazılır.

3. **🔄 Doruk Otomasyon (MES) Çift Yönlü Entegrasyon:**
   - **Uygulamadan Doruk'a (Push):** Uygulamada çözülen bir arıza kaydedildiğinde Doruk MES sistemine arıza kapatma kaydı otomatik iletilir.
   - **Doruk'tan Uygulamaya (Pull):** Operatör veya bakımcı makine başındaki Doruk terminalinden giriş yaptığında, arkaplan senkronizasyonu kayıtları bu uygulamadaki ilgili makinenin klasörüne otomatik çeker.

4. **📁 Makine Bazlı Dijital Klasörler:**
   - Her makine (PRES-01, CNC-02, vb.) için ayrı bir dijital klasör tutulur.
   - Makinenin kronolojik tüm arıza geçmişi, duruş süreleri ve müdahaleler tek ekranda incelenebilir.

5. **🤖 Bakımcı Yapay Zeka Chatbotu (Akıllı Asistan):**
   - Bakımcı sahada bir arıza ile karşılaştığında (örn: *"Pres 1 hidrolik basınç düştü ne yapmalıyım?"* veya *"CNC-01'de en son hangi parça değişti?"*) chat ekranına yazar.
   - Chatbot, makinenin geçmiş arıza kayıtlarını ve çözümlerini tarayarak nokta atışı tavsiye ve çözüm adımları sunar.

6. **📊 Profesyonel Excel Çıktısı (.xlsx):**
   - Fabrikanın günlük faaliyet formatına tam uyumlu, başlıkları, tablo stilleri ve alt toplam formülü (`=SUM`) içeren Excel raporu tek tıkla indirilebilir.

---

## 🛠️ Hızlı Başlatma

### 1. Tek Tıkla Başlatma (Windows)
Proje kök dizinindeki `start.bat` dosyasına çift tıklayın.

### 2. Konsoldan Başlatma
```powershell
cd C:\Users\ecem.sayar\.gemini\antigravity\scratch\bakim-asistani
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- **Bilgisayardan Erişim:** `http://localhost:8000`
- **Fabrika İçi Telefondan Erişim:** `http://<BILGISAYAR_IP_ADRESI>:8000`
- **Canlı Bulut Ortamı (AWS Lightsail):** `https://18.156.97.64.sslip.io`

---

## 📂 Proje Dizin Yapısı

```
bakim-asistani/
├── .venv/                      # Python sanal ortamı
├── app/
│   ├── main.py                 # FastAPI ana sunucu ve API uç noktaları
│   ├── config.py               # Yapılandırma ve Doruk ayarları
│   ├── database.py             # SQLite / PostgreSQL veritabanı bağlantısı
│   ├── models.py               # Veritabanı tabloları (User, Machine, MaintenanceLog, DorukSyncLog, ChatMessage)
│   ├── schemas.py              # Pydantic veri modelleri
│   ├── services/
│   │   ├── voice_service.py    # Ses dökümünden alan ayıklayıcı (NLP)
│   │   ├── excel_service.py    # Profesyonel Excel rapor üretici (openpyxl)
│   │   ├── doruk_service.py    # Doruk MES çift yönlü entegrasyon servisi
│   │   ├── chatbot_service.py  # Makine hafızalı AI bakım asistanı
│   │   └── init_db.py          # Başlangıç fabrika ve makine verileri
│   ├── static/
│   │   ├── manifest.json       # Mobil PWA manifest dosyası
│   │   ├── sw.js               # Service worker
│   │   └── js/app.js           # Mobil & masaüstü reaktif arayüz mantığı
│   └── templates/
│       └── index.html          # Mobil öncelikli duyarlı ana arayüz
├── exports/                    # Üretilen Excel raporları
├── start.bat                   # Hızlı başlatıcı dosya
└── README.md
```
