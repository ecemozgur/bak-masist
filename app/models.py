from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Float
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    full_name = Column(String(100), nullable=False)
    role = Column(String(20), default="TEKNISYEN")  # TEKNISYEN, ADMIN
    department = Column(String(50), default="Mekanik Bakım")  # Mekanik, Elektrik, Otomasyon
    pin_code = Column(String(255), nullable=False, default="1234")  # Hashlenmiş PIN kodu
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    logs = relationship("MaintenanceLog", back_populates="user")
    chats = relationship("ChatMessage", back_populates="user")

class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, index=True, nullable=False)  # örn: CNC-01, PRES-02
    name = Column(String(100), nullable=False)
    department = Column(String(50), default="Üretim Hattı 1")
    line = Column(String(50), default="Hat-A")
    model = Column(String(100), nullable=True)
    serial_no = Column(String(100), nullable=True)
    status = Column(String(20), default="CALISIYOR")  # CALISIYOR, ARIZALI, BAKIMDA
    total_downtime_minutes = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    logs = relationship("MaintenanceLog", back_populates="machine", cascade="all, delete-orphan")
    chats = relationship("ChatMessage", back_populates="machine")

class MaintenanceLog(Base):
    __tablename__ = "maintenance_logs"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    date_str = Column(String(20), nullable=False)  # YYYY-MM-DD
    shift = Column(String(20), default="1. Vardiya (08:00 - 16:00)")
    
    failure_description = Column(Text, nullable=False)  # Arıza Tanımı
    action_taken = Column(Text, nullable=False)          # Yapılan Müdahale / Çözüm
    root_cause = Column(Text, nullable=True)             # Kök Neden (varsa)
    parts_replaced = Column(String(255), default="-")    # Değiştirilen Parça(lar)
    downtime_minutes = Column(Integer, default=0)        # Duruş Süresi (dakika)
    
    maintenance_type = Column(String(50), default="Arızi Bakım")  # Arızi Bakım, Periyodik Bakım, Kestirimci Bakım
    source = Column(String(30), default="SESLI_MOBIL")   # SESLI_MOBIL, MANUEL_WEB, DORUK_SYNC
    
    # Doruk Otomasyon Entegrasyon Alanları
    doruk_record_id = Column(String(100), nullable=True) # Doruk MES tarafındaki ID
    is_doruk_synced = Column(Boolean, default=False)
    doruk_sync_time = Column(DateTime, nullable=True)
    
    raw_voice_transcript = Column(Text, nullable=True)   # Bakımcının sesinden dökülen ham metin
    created_at = Column(DateTime, default=datetime.utcnow)

    machine = relationship("Machine", back_populates="logs")
    user = relationship("User", back_populates="logs")

class DorukSyncLog(Base):
    __tablename__ = "doruk_sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    direction = Column(String(20), nullable=False)  # PUSH_TO_DORUK, PULL_FROM_DORUK
    machine_code = Column(String(50), nullable=True)
    status = Column(String(20), default="SUCCESS")  # SUCCESS, FAILED, PENDING
    payload = Column(Text, nullable=True)
    response_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)
    sender = Column(String(20), nullable=False)  # USER, ASSISTANT
    message = Column(Text, nullable=False)
    context_used = Column(Text, nullable=True)   # Chatbotun geçmişten bulup kullandığı arıza referansları
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="chats")
    machine = relationship("Machine", back_populates="chats")

class PeriodicCheck(Base):
    __tablename__ = "periodic_checks"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)
    machine_code = Column(String(50), nullable=True)
    line_name = Column(String(100), nullable=True)
    building = Column(String(50), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    operator_name = Column(String(100), nullable=True)
    date_str = Column(String(20), nullable=False)
    shift = Column(String(30), default="08.00-16.00")
    check_type = Column(String(50), default="GÜNLÜK")  # GÜNLÜK, HAFTALIK, AYLIK
    status = Column(String(20), default="UYGUN")        # UYGUN, UYGUN DEĞİL
    items_json = Column(Text, nullable=True)            # JSON list of check results
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    machine = relationship("Machine", backref="periodic_checks")
    user = relationship("User", backref="periodic_checks")
