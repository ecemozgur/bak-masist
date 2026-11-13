from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

class UserLogin(BaseModel):
    username: str
    pin_code: Optional[str] = "1234"

class UserCreate(BaseModel):
    username: str
    full_name: str
    role: str = "TEKNISYEN"
    department: str = "Mekanik Bakım"
    pin_code: str = "1234"

class UserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    department: str
    is_active: bool

    class Config:
        from_attributes = True

class MachineBase(BaseModel):
    code: str
    name: str
    department: str = "Üretim Hattı 1"
    line: str = "Hat-A"
    model: Optional[str] = None
    serial_no: Optional[str] = None
    status: str = "CALISIYOR"

class MachineCreate(MachineBase):
    pass

class MachineResponse(MachineBase):
    id: int
    total_downtime_minutes: int
    created_at: datetime
    log_count: Optional[int] = 0

    class Config:
        from_attributes = True

class MaintenanceLogBase(BaseModel):
    machine_code: str
    date_str: Optional[str] = None
    shift: Optional[str] = "1. Vardiya (08:00 - 16:00)"
    failure_description: str
    action_taken: str
    root_cause: Optional[str] = None
    parts_replaced: Optional[str] = "-"
    downtime_minutes: int = 0
    maintenance_type: Optional[str] = "Arızi Bakım"
    source: Optional[str] = "SESLI_MOBIL"
    raw_voice_transcript: Optional[str] = None

class MaintenanceLogCreate(MaintenanceLogBase):
    user_id: Optional[int] = None
    sync_to_doruk_immediately: bool = True

class MaintenanceLogResponse(BaseModel):
    id: int
    machine_id: int
    machine_code: str
    machine_name: str
    user_name: Optional[str] = None
    date_str: str
    shift: str
    failure_description: str
    action_taken: str
    root_cause: Optional[str] = None
    parts_replaced: str
    downtime_minutes: int
    maintenance_type: str
    source: str
    is_doruk_synced: bool
    doruk_record_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class VoiceParseRequest(BaseModel):
    transcript: str

class VoiceParseResponse(BaseModel):
    machine_code: Optional[str] = None
    line_no: Optional[str] = None
    building: Optional[str] = "HİÇBİRİ"  # A BİNASI, B BİNASI, C BİNASI, BÜTÜN BİNALAR, HİÇBİRİ
    area_line: Optional[str] = "GENEL"
    job_description: str
    criterion_no: str = "4"
    criterion_name: str = "MEKANİK ARIZA"
    time_spent_minutes: int = 30
    operator_name: Optional[str] = None
    shift: Optional[str] = None
    failure_description: str
    action_taken: str
    downtime_minutes: int
    parts_replaced: str
    maintenance_type: str
    confidence: float
    raw_text: str

class ServerExcelAppendRequest(BaseModel):
    building: Optional[str] = "HİÇBİRİ"
    line_no: Optional[str] = None
    machine_code: Optional[str] = None
    area_line: str
    job_description: str
    criterion_no: str
    time_spent_minutes: int
    operator_name: str
    shift: Optional[str] = None
    date_str: Optional[str] = None
    include_timestamp: bool = True
    sync_to_doruk: bool = True
    user_id: Optional[int] = None

class ServerExcelAppendResponse(BaseModel):
    success: bool
    message: str
    file_path: str
    file_name: str
    sheet_name: str
    row: int
    timestamp: str
    doruk_synced: bool = False
    doruk_record_id: Optional[str] = None

class ServerExcelStatusResponse(BaseModel):
    file_path: str
    file_name: str
    file_exists: bool
    month_folder: str
    today_date_str: str
    records: List[dict] = []

class DorukPushRequest(BaseModel):
    log_id: int

class DorukPullRequest(BaseModel):
    machine_code: Optional[str] = None
    days_back: int = 7

class DorukAppendRequest(BaseModel):
    machine_code: str
    job_description: str                      # "Açıklama" (son sütun - yapılan iş)
    technician_name: str                      # "Bilgi Giren" (bilgiyi giren teknisyen)
    time_spent_minutes: int = 15
    criterion_no: str = "4"
    criterion_name: Optional[str] = "MEKANİK ARIZA"
    station: Optional[str] = "-"
    project_code: Optional[str] = "COMMON"
    project_name: Optional[str] = "-"
    operator_name: Optional[str] = "-"
    root_cause: Optional[str] = "-"
    improvement_suggestion: Optional[str] = "-"
    shift: Optional[str] = "08.00-16.00"
    date_str: Optional[str] = None
    user_id: Optional[int] = None

class DorukAppendResponse(BaseModel):
    success: bool
    message: str
    file_name: str
    file_path: str
    row: int
    record_id: str
    date_str: str

class DorukRowModel(BaseModel):
    row_num: int
    id: Optional[str] = None
    mid: Optional[str] = None
    machine: str
    stop_code: Optional[str] = "1"
    stop_name: Optional[str] = "EKIPMAN ARIZA"
    duration_str: Optional[str] = None
    duration_min: Optional[float] = 0.0
    station: Optional[str] = None
    project_code: Optional[str] = None
    project_name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    shift: Optional[str] = None
    operator: Optional[str] = None
    technician: Optional[str] = None
    root_cause: Optional[str] = None
    fault_code: Optional[str] = None
    fault_name: Optional[str] = None
    note: Optional[str] = None
    action: Optional[str] = None              # "Açıklama"
    entered_by: Optional[str] = None          # "Bilgi Giren"

class DorukRowsResponse(BaseModel):
    date_str: str
    file_name: str
    file_path: str
    file_exists: bool
    total_records: int
    records: List[DorukRowModel] = []

class ChatQueryRequest(BaseModel):
    query: str
    machine_code: Optional[str] = None
    user_id: Optional[int] = None

class ChatQueryResponse(BaseModel):
    answer: str
    machine_code: Optional[str] = None
    referenced_logs: List[dict] = []
