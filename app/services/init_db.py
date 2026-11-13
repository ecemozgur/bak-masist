from datetime import datetime, timedelta
from app.database import engine, Base, SessionLocal
from app.models import User, Machine, MaintenanceLog

def init_database():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Kullanıcılar var mı?
    if db.query(User).count() == 0:
        users = [
            User(username="bakimci1", full_name="Ahmet Yılmaz", role="TEKNISYEN", department="Mekanik Bakım", pin_code="1234"),
            User(username="bakimci2", full_name="Mehmet Demir", role="TEKNISYEN", department="Elektrik Bakım", pin_code="1234"),
            User(username="amir", full_name="Ali Kaya", role="AMIR", department="Bakım Onarım Şefliği", pin_code="9999"),
        ]
        db.add_all(users)
        db.commit()

    # Makineler var mı?
    if db.query(Machine).count() == 0:
        machines = [
            Machine(code="PRES-01", name="160 Ton Hidrolik Pres", department="Pres Hattı", line="Hat-1", model="H-160T", status="CALISIYOR", total_downtime_minutes=140),
            Machine(code="PRES-02", name="250 Ton Eksantrik Pres", department="Pres Hattı", line="Hat-1", model="E-250T", status="CALISIYOR", total_downtime_minutes=95),
            Machine(code="CNC-01", name="5 Eksen Dik İşleme CNC", department="Talaşlı İmalat", line="Hat-2", model="DMG-5X", status="CALISIYOR", total_downtime_minutes=60),
            Machine(code="CNC-02", name="Torna CNC Tezgahı", department="Talaşlı İmalat", line="Hat-2", model="Mazak-T20", status="CALISIYOR", total_downtime_minutes=45),
            Machine(code="ENJ-04", name="Plastik Enjeksiyon Makinesi", department="Kalıphane", line="Hat-3", model="Krauss-350", status="CALISIYOR", total_downtime_minutes=110),
            Machine(code="ROBOT-01", name="Kaynak Robotu", department="Gövde Kaynak", line="Hat-4", model="KUKA-KR16", status="CALISIYOR", total_downtime_minutes=30),
            Machine(code="KOMPRESOR-A", name="Vidalı Hava Kompresörü", department="Yardımcı Tesisler", line="Tesis-1", model="Atlas-Copco-GA45", status="CALISIYOR", total_downtime_minutes=20)
        ]
        db.add_all(machines)
        db.commit()

        # Geçmiş örnek arıza kayıtları ekle
        m1 = db.query(Machine).filter(Machine.code == "PRES-01").first()
        m2 = db.query(Machine).filter(Machine.code == "PRES-02").first()
        m3 = db.query(Machine).filter(Machine.code == "CNC-01").first()
        u1 = db.query(User).filter(User.username == "bakimci1").first()
        u2 = db.query(User).filter(User.username == "bakimci2").first()

        today = datetime.now()
        logs = [
            MaintenanceLog(
                machine_id=m1.id,
                user_id=u1.id,
                date_str=(today - timedelta(days=2)).strftime("%Y-%m-%d"),
                shift="1. Vardiya (08:00 - 16:00)",
                failure_description="Hidrolik ana dağıtıcı hortumunda çatlak ve yoğun yağ sızıntısı.",
                action_taken="Basınç hattı tahliye edildi, R2 tipi yeni hidrolik hortum monte edildi, hidrolik yağı tamamlandı.",
                parts_replaced="3/4 R2 Hidrolik Hortum, O-ring Conta",
                downtime_minutes=50,
                maintenance_type="Arızi Bakım (Hidrolik)",
                source="SESLI_MOBIL",
                doruk_record_id="DRK-8921",
                is_doruk_synced=True,
                raw_voice_transcript="Pres birde hidrolik hortum çatlamıştı yağı boşaltıp yeni hortum taktık elli dakika durdu"
            ),
            MaintenanceLog(
                machine_id=m2.id,
                user_id=u2.id,
                date_str=(today - timedelta(days=1)).strftime("%Y-%m-%d"),
                shift="2. Vardiya (16:00 - 24:00)",
                failure_description="Kavrama balatası aşırı ısınma ve kaçırma yapıyordu.",
                action_taken="Hava basıncı ayarlandı, balata boşluğu sentil çakısıyla kalibre edildi, aşınan yaylar yenilendi.",
                parts_replaced="Balata Baskı Yayları",
                downtime_minutes=40,
                maintenance_type="Arızi Bakım (Mekanik)",
                source="DORUK_SYNC",
                doruk_record_id="DRK-9044",
                is_doruk_synced=True
            ),
            MaintenanceLog(
                machine_id=m3.id,
                user_id=u1.id,
                date_str=today.strftime("%Y-%m-%d"),
                shift="1. Vardiya (08:00 - 16:00)",
                failure_description="Spindle soğutma sıvısı debi düşük alarmı (Alarm 402).",
                action_taken="Talaş filtresi söküldü, tortular tazyikli hava ile temizlendi, sirkülasyon pompası test edildi.",
                parts_replaced="Hassas Filtre Elemanı",
                downtime_minutes=35,
                maintenance_type="Arızi Bakım (Mekanik)",
                source="SESLI_MOBIL",
                doruk_record_id="DRK-9150",
                is_doruk_synced=True,
                raw_voice_transcript="Cnc birde soğutma sıvısı alarm verdi filtreyi temizledik otuz beş dakika durdu"
            )
        ]
        db.add_all(logs)
        db.commit()

    db.close()

if __name__ == "__main__":
    init_database()
