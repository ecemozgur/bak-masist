// ================= AKILLI BAKIM & DORUK MES UYGULAMASI =================

let currentUser = null;
let appInitialized = false;

let allMachines = [];
let criteriaList = [];
let isRecording = false;
let speechRecognizer = null;
let recordedTranscript = "";

// Sayfa Yüklendiğinde
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // Oturum kontrolü yap; giriş yapılmışsa uygulamayı başlat
  checkAuthAndInit();

  // Service Worker Temizleme (Önbellek sorunlarını önlemek için)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const reg of registrations) {
        reg.unregister();
      }
    });
  }
});

function startAppAfterAuth() {
  if (!appInitialized) {
    appInitialized = true;
    initDateAndShift();
    initSpeechRecognition();
    initDescSpeechRecognition();
  }
  loadCriteria();
  loadUsers();
  loadMachines();
  loadRecentLogs();
  loadServerExcelStatus();
  loadHandoverTasks();
  if (document.getElementById("tab-doruk-sync")) {
    loadDorukSyncLogs();
  }
}

// ----------------- TARİH & VARDİYA AYARLARI -----------------
const TURKISH_DAYS_ARRAY = ["PAZAR", "PAZARTESİ", "SALI", "ÇARŞAMBA", "PERŞEMBE", "CUMA", "CUMARTESİ"];

function formatDateToIso(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function initDateAndShift() {
  const now = new Date();
  setFormDate(now);

  // Vardiya Otomatik Seçimi
  const hour = now.getHours();
  let defaultShift = "08.00-16.00";
  if (hour >= 16 && hour < 24) {
    defaultShift = "16.00-24.00";
  } else if (hour >= 0 && hour < 8) {
    defaultShift = "24.00 - 08.00";
  }

  const shiftSelect = document.getElementById("formShift");
  if (shiftSelect) {
    shiftSelect.value = defaultShift;
  }

  const opNameInput = document.getElementById("formOperatorName");
  if (opNameInput && !opNameInput.value && currentUser) {
    opNameInput.value = currentUser.full_name;
  }

  // İş Aktarım Formu alanlarını hazırla
  const handoverDateInput = document.getElementById("handoverDateFilter");
  if (handoverDateInput && !handoverDateInput.value) {
    handoverDateInput.value = formatDateToIso(now);
  }
  const handoverPersonInput = document.getElementById("handoverPerson");
  if (handoverPersonInput && !handoverPersonInput.value && currentUser) {
    handoverPersonInput.value = currentUser.full_name;
  }

  // Yapılan İşler & Excel Rapor sekmesi alanlarını hazırla
  const exportDateInput = document.getElementById("excelFilterDate");
  if (exportDateInput && !exportDateInput.value) {
    exportDateInput.value = formatDateToIso(now);
  }

  // Doruk Otomasyon sekmesi alanlarını hazırla
  const dorukDateEl = document.getElementById("dorukFilterDate");
  if (dorukDateEl && !dorukDateEl.value) {
    dorukDateEl.value = formatDateToIso(now);
  }

  const dorukTechEl = document.getElementById("dorukFormTechnician");
  if (dorukTechEl && !dorukTechEl.value && currentUser) {
    dorukTechEl.value = currentUser.full_name;
  }

  if (document.getElementById("tab-doruk-sync")) {
    loadDorukRows(formatDateToIso(now));
  }

  updatePreviewRow();
}

function setFormDate(dateObj) {
  const dateInput = document.getElementById("formDateInput");
  const dayNameEl = document.getElementById("formDateDayName");
  const previewColA = document.getElementById("previewColA");

  const iso = formatDateToIso(dateObj);
  if (dateInput) dateInput.value = iso;

  const dayName = TURKISH_DAYS_ARRAY[dateObj.getDay()];
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const yyyy = dateObj.getFullYear();

  if (dayNameEl) dayNameEl.innerText = dayName ? `(${dayName})` : "";
  if (previewColA) previewColA.innerText = `${dd}.${mm}.${yyyy}`;
}

function setTodayDate() {
  const now = new Date();
  setFormDate(now);
  updatePreviewRow();
  const dateInput = document.getElementById("formDateInput");
  if (dateInput) loadServerExcelStatus(dateInput.value);
}

function onDateChanged() {
  const dateInput = document.getElementById("formDateInput");
  if (!dateInput || !dateInput.value) return;

  const parts = dateInput.value.split("-");
  if (parts.length === 3) {
    const selectedDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const dayName = TURKISH_DAYS_ARRAY[selectedDate.getDay()];
    const dd = String(parts[2]).padStart(2, '0');
    const mm = String(parts[1]).padStart(2, '0');
    const yyyy = parts[0];

    const dayNameEl = document.getElementById("formDateDayName");
    const previewColA = document.getElementById("previewColA");
    if (dayNameEl) dayNameEl.innerText = dayName ? `(${dayName})` : "";
    if (previewColA) previewColA.innerText = `${dd}.${mm}.${yyyy}`;
  }

  updatePreviewRow();
  loadServerExcelStatus(dateInput.value);
}

// ----------------- KRİTER LİSTESİ YÜKLEME -----------------
async function loadCriteria() {
  try {
    const res = await fetch("/api/criteria");
    if (!res.ok) return;
    const fetched = await res.json();
    if (Array.isArray(fetched) && fetched.length > 0) {
      criteriaList = fetched;
      const select = document.getElementById("formCriterionSelect");
      if (!select) return;
      const currentVal = select.value || "4";

      select.innerHTML = criteriaList.map(c => `
        <option value="${c.no}" ${c.no === currentVal ? "selected" : ""}>
          ${c.no} - ${c.name}
        </option>
      `).join("");
      select.value = currentVal;
      updatePreviewRow();
    }
  } catch (e) {
    console.warn("Kriterler dinamik API'den yenilenemedi, HTML şablonu kullanılıyor:", e);
  }
}

function onCriterionChange() {
  updatePreviewRow();
}

function openCriteriaModal() {
  const modal = document.getElementById("criteriaModal");
  if (modal) {
    modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
  }
}

function closeCriteriaModal() {
  const modal = document.getElementById("criteriaModal");
  if (modal) modal.classList.add("hidden");
}

function selectCriterionFromModal(criterionNo) {
  const select = document.getElementById("formCriterionSelect");
  if (select) {
    select.value = String(criterionNo);
    updatePreviewRow();
  }
  closeCriteriaModal();
}

// ----------------- TAB DEĞİŞİMİ -----------------
function switchTab(tabId) {
  // Tab içeriklerini gizle/göster
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.remove("hidden");

  // Desktop tab stilleri
  document.querySelectorAll(".nav-tab").forEach(el => {
    el.classList.remove("border-blue-500", "text-blue-400");
    el.classList.add("border-transparent", "text-slate-400");
  });
  const activeDTab = document.getElementById(`dtab-${tabId}`);
  if (activeDTab) {
    activeDTab.classList.remove("border-transparent", "text-slate-400");
    activeDTab.classList.add("border-blue-500", "text-blue-400");
  }

  // Mobile tab stilleri
  ["voice-report", "handover", "machines", "doruk-sync", "chatbot", "excel-export"].forEach(id => {
    const mTab = document.getElementById(`mtab-${id}`);
    if (mTab) {
      if (id === tabId) {
        mTab.classList.add("text-blue-600");
        mTab.classList.remove("text-slate-400");
      } else {
        mTab.classList.remove("text-blue-600");
        mTab.classList.add("text-slate-400");
      }
    }
  });

  if (tabId === "excel-export") {
    onDoneJobsDateChanged();
  }

  if (tabId === "handover") {
    loadHandoverTasks();
  }

  if (window.lucide) lucide.createIcons();
}

// ----------------- SESLİ DİKTE MODALI (MİKROFON PENCERESİ) -----------------
let modalSpeechRecognizer = null;
let isModalRecording = false;
let voiceModalOpenedAt = 0;

function openVoiceDictationModal(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const modal = document.getElementById("voiceDictationModal");
  if (!modal) return;

  voiceModalOpenedAt = Date.now();
  const currentDesc = document.getElementById("formJobDescription")?.value?.trim() || "";
  const output = document.getElementById("modalDictationOutput");
  if (output) output.value = currentDesc;

  const alertBox = document.getElementById("modalMicAlert");
  if (alertBox) {
    alertBox.innerText = "";
    alertBox.classList.add("hidden");
  }

  updateModalDictationUI(false);
  modal.classList.remove("hidden");
}

function handleVoiceModalBackdropClick(e) {
  // Modal açıldıktan hemen sonraki ilk 400ms içindeki kazara tetiklenmeleri önle
  if (Date.now() - voiceModalOpenedAt < 400) return;
  if (e && e.target && e.target.id === "voiceDictationModal") {
    closeVoiceDictationModal();
  }
}

function closeVoiceDictationModal() {
  stopModalDictation();
  const modal = document.getElementById("voiceDictationModal");
  if (modal) modal.classList.add("hidden");
}

function appendToModalText(sampleText) {
  const output = document.getElementById("modalDictationOutput");
  if (!output) return;
  const current = output.value.trim();
  output.value = current ? `${current} ${sampleText}` : sampleText;
}

let dorukSpeechTarget = null;
let handoverSpeechTarget = null;

function openVoiceDictationModalForDoruk() {
  dorukSpeechTarget = document.getElementById("dorukFormDescription");
  handoverSpeechTarget = null;
  openVoiceDictationModal();
  const output = document.getElementById("modalDictationOutput");
  if (output && dorukSpeechTarget) {
    output.value = dorukSpeechTarget.value || "";
  }
}

function openVoiceDictationForHandover() {
  handoverSpeechTarget = document.getElementById("handoverTaskDesc");
  dorukSpeechTarget = null;
  openVoiceDictationModal();
  const output = document.getElementById("modalDictationOutput");
  if (output && handoverSpeechTarget) {
    output.value = handoverSpeechTarget.value || "";
  }
}

function applyModalDictationToForm() {
  const output = document.getElementById("modalDictationOutput");
  if (handoverSpeechTarget && output) {
    handoverSpeechTarget.value = output.value.trim();
    handoverSpeechTarget = null;
  } else if (dorukSpeechTarget && output) {
    dorukSpeechTarget.value = output.value.trim().toUpperCase();
    dorukSpeechTarget = null;
  } else {
    const formDesc = document.getElementById("formJobDescription");
    if (output && formDesc) {
      formDesc.value = output.value.trim().toUpperCase();
      updatePreviewRow();
    }
  }
  closeVoiceDictationModal();
}

function getSpeechRecognitionClass() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function activateWindowsDictation() {
  const output = document.getElementById("modalDictationOutput");
  if (output) {
    output.focus();
    output.setSelectionRange(output.value.length, output.value.length);
  }
  const alertBox = document.getElementById("modalMicAlert");
  if (alertBox) {
    alertBox.innerHTML = "💡 <b>KUTU SEÇİLDİ!</b> Şimdi klavyenizden <b>Windows Tuşu + H</b> (Win+H) tuşlarına basıp konuşmaya başlayabilirsiniz. Windows söylediklerinizi bu kutunun içine doğrudan yazacaktır.";
    alertBox.className = "p-3 rounded-xl text-xs bg-blue-50 border border-blue-200 text-blue-800 font-medium leading-relaxed block animate-pulse";
    alertBox.classList.remove("hidden");
  }
}

async function toggleModalDictation() {
  const alertBox = document.getElementById("modalMicAlert");

  if (isModalRecording) {
    stopModalDictation();
    return;
  }

  const SpeechRecognition = getSpeechRecognitionClass();
  if (!SpeechRecognition) {
    if (alertBox) {
      alertBox.innerHTML = "⚠️ <b>Tarayıcı Web Speech Desteği Kapalı:</b><br>Lütfen <b>Google Chrome</b> veya <b>Microsoft Edge</b> kullanınız.<br><br>👉 <b>Hemen Kullanmak İçin:</b> Aşağıdaki <b>[Win+H ile Sesli Yaz]</b> butonuna tıklayıp klavyenizden <b>Windows Tuşu + H</b> tuşlarına basarak Windows'un kendi sesli yazmasını kullanabilirsiniz.";
      alertBox.className = "p-3 rounded-xl text-xs bg-amber-50 border border-amber-200 text-amber-900 font-medium leading-relaxed block";
      alertBox.classList.remove("hidden");
    }
    activateWindowsDictation();
    return;
  }

  // Anında dinleme görseline geç
  updateModalDictationUI(true);
  if (alertBox) {
    alertBox.innerHTML = "";
    alertBox.classList.add("hidden");
  }

  try {
    if (modalSpeechRecognizer) {
      try { modalSpeechRecognizer.abort(); } catch (e) {}
    }

    modalSpeechRecognizer = new SpeechRecognition();
    modalSpeechRecognizer.continuous = true;
    modalSpeechRecognizer.interimResults = true;
    modalSpeechRecognizer.lang = "tr-TR";

    const output = document.getElementById("modalDictationOutput");
    const baseText = output ? output.value.trim() : "";

    modalSpeechRecognizer.onstart = () => {
      isModalRecording = true;
      updateModalDictationUI(true);
    };

    modalSpeechRecognizer.onresult = (event) => {
      let speechParts = "";
      for (let i = 0; i < event.results.length; ++i) {
        speechParts += event.results[i][0].transcript + " ";
      }
      if (output && speechParts.trim()) {
        const full = (baseText ? baseText + " " : "") + speechParts.trim();
        output.value = full.toUpperCase();
      }
    };

    modalSpeechRecognizer.onerror = (event) => {
      console.warn("Modal speech recognition error:", event.error);
      const alertBox = document.getElementById("modalMicAlert");
      stopModalDictation();

      if (!alertBox) return;

      if (event.error === "no-speech") {
        const sub = document.getElementById("modalMicSubStatus");
        if (sub) sub.innerText = "⚠️ Ses algılanamadı, lütfen mikrofona doğru konuşun...";
        return;
      }

      let errorHtml = "";
      if (event.error === "not-allowed" || event.error === "permission-denied") {
        errorHtml = "❌ <b>MİKROFON İZNİ GEREKİYOR:</b><br>Tarayıcı mikrofon iznini engellemiş veya sormuş olabilir.<br>👉 Adres çubuğundaki (URL solundaki) <b>Kilit</b> veya <b>Site Ayarları</b> simgesine tıklayıp <b>Mikrofon</b> iznini <b>İzin Ver</b> yapınız.<br><br>💡 Alternatif: <b>Win + H</b> tuşlarıyla Windows sesli yazmayı kullanabilirsiniz.";
      } else if (event.error === "network") {
        errorHtml = "⚠️ <b>ŞİRKET AĞI / PROXY ENGELİ:</b><br>Chrome Google ses sunucusuna bağlanamadı (Şirket güvenlik duvarı engelliyor olabilir).<br><br>👉 <b>Çok Kolay Çözüm:</b> Kutunun içine tıklayıp klavyenizden <b>Windows Tuşu + H</b> (Win+H) tuşlarına basarak doğrudan Windows'un dahili Türkçe sesli diktesini kullanabilirsiniz.";
      } else if (event.error === "audio-capture") {
        errorHtml = "⚠️ <b>MİKROFON DONANIMI ALGILANAMADI:</b><br>Bu bilgisayara bağlı bir mikrofon veya kulaklık bulunamadı.<br>Kulaklık takabilir veya aşağıdaki hazır kalıp butonlarını kullanabilirsiniz.";
      } else {
        errorHtml = `⚠️ <b>Ses Tanıma Bilgisi (${event.error}):</b><br>Aşağıdaki hazır cümle kalıplarını tıklayarak veya klavyeden <b>Win + H</b> ile sesli yazabilirsiniz.`;
      }

      alertBox.innerHTML = errorHtml;
      alertBox.className = "p-3 rounded-xl text-xs bg-amber-50 border border-amber-200 text-amber-900 font-medium leading-relaxed block";
      alertBox.classList.remove("hidden");
    };

    modalSpeechRecognizer.onend = () => {
      if (isModalRecording) {
        stopModalDictation();
      }
    };

    modalSpeechRecognizer.start();
  } catch (err) {
    console.error("Modal speech start error:", err);
    stopModalDictation();
    if (alertBox) {
      alertBox.innerHTML = `⚠️ <b>Sesli Dikte Durumu:</b> ${err.message || err}<br>👉 Klavyenizden <b>Windows Tuşu + H</b> (Win+H) tuşlarına basarak konuşabilirsiniz.`;
      alertBox.className = "p-3 rounded-xl text-xs bg-amber-50 border border-amber-200 text-amber-900 font-medium leading-relaxed block";
      alertBox.classList.remove("hidden");
    }
  }
}

function stopModalDictation() {
  isModalRecording = false;
  updateModalDictationUI(false);
  if (modalSpeechRecognizer) {
    try { modalSpeechRecognizer.stop(); } catch (e) {}
  }
}

function updateModalDictationUI(recording) {
  const btn = document.getElementById("modalMicBtn");
  const status = document.getElementById("modalMicStatus");
  const subStatus = document.getElementById("modalMicSubStatus");

  if (recording) {
    if (btn) {
      btn.classList.remove("bg-blue-600", "hover:bg-blue-700");
      btn.classList.add("bg-rose-600", "hover:bg-rose-700", "recording-pulse");
    }
    if (status) {
      status.innerText = "🔴 Dinleniyor... Konuşun";
      status.classList.add("text-rose-600");
    }
    if (subStatus) subStatus.innerText = "Durdurmak için mikrofona tekrar basın";
  } else {
    if (btn) {
      btn.classList.remove("bg-rose-600", "hover:bg-rose-700", "recording-pulse");
      btn.classList.add("bg-blue-600", "hover:bg-blue-700");
    }
    if (status) {
      status.innerText = "Mikrofona Basarak Konuşmaya Başlayın";
      status.classList.remove("text-rose-600");
    }
    if (subStatus) subStatus.innerText = "Konuşmanız bitince durdurmak için tekrar basın";
  }
}


// ----------------- SERVER EXCEL'İNE SATIR KAYDETME -----------------
async function submitServerExcelLog(event) {
  event.preventDefault();

  const building = document.getElementById("formBuilding")?.value || "HİÇBİRİ";
  const lineNo = document.getElementById("formLineNo").value.trim().toUpperCase();
  const machineCode = document.getElementById("formMachineCode").value.trim().toUpperCase();
  const jobDesc = document.getElementById("formJobDescription").value.trim().toUpperCase();
  const critNo = document.getElementById("formCriterionSelect").value;
  const timeSpent = parseInt(document.getElementById("formTimeSpent").value) || 0;
  const operatorName = document.getElementById("formOperatorName").value.trim().toUpperCase();
  const shift = document.getElementById("formShift").value;
  const includeTs = document.getElementById("includeTimestampCheck").checked;

  if (building === "HİÇBİRİ" && !lineNo && !machineCode) {
    alert("Lütfen Bina, Hat Numarası veya Makine Kodu alanlarından en az birini belirtin.");
    return;
  }
  if (!jobDesc) {
    alert("Lütfen Yapılan İşlemler alanını doldurun.");
    return;
  }

  const btn = document.getElementById("btnSubmitServerExcel");
  const origBtnText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Server'a Yazılıyor...</span>`;
  if (window.lucide) lucide.createIcons();

  const parts = [];
  if (building && building !== "HİÇBİRİ") parts.push(building);
  if (lineNo) parts.push(lineNo);
  if (machineCode) parts.push(machineCode);
  const combinedLineMach = parts.length > 0 ? parts.join(" - ") : (building !== "HİÇBİRİ" ? building : "GENEL");

  const dateVal = document.getElementById("formDateInput")?.value || "";

  const payload = {
    area_line: combinedLineMach,
    building: building,
    line_no: lineNo,
    machine_code: machineCode,
    job_description: jobDesc,
    criterion_no: critNo,
    time_spent_minutes: timeSpent,
    operator_name: operatorName,
    shift: shift,
    date_str: dateVal,
    include_timestamp: includeTs,
    sync_to_doruk: !!document.getElementById("tab-doruk-sync"),
    user_id: currentUser ? currentUser.id : null
  };

  try {
    const res = await fetch("/api/server-excel/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      alert(`✅ BAŞARIYLA KAYDEDİLDİ!\n\n📁 Server Dosyası: ${data.file_name}\n📄 Sayfa: ${data.sheet_name}\n📍 Satır: ${data.row}\n⏰ Saat: ${data.timestamp}\n\nKayıt iş yeri sunucusundaki güncel Excel dosyasına işlendi.`);
      
      // Formu temizle ve yeni satıra hazırla
      document.getElementById("formJobDescription").value = "";
      document.getElementById("voiceLiveOutput").innerText = "";
      updatePreviewRow();
      
      // Sunucu tablosunu ve kayıtları güncelle
      loadServerExcelStatus(dateVal);
      loadRecentLogs();
    } else {
      const err = await res.json();
      alert(`Hata: ${err.detail || 'Server Excel dosyasına yazılamadı!'}`);
    }
  } catch (e) {
    console.error("Kayıt hatası:", e);
    alert("Sunucuya bağlanılamadı. Lütfen sunucu veya ağ bağlantınızı kontrol edin.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origBtnText;
    if (window.lucide) lucide.createIcons();
  }
}

// ----------------- VARDİYA DEVİR SAATLERİ (08:15 - 16:15 - 00:15) VE FİLTRELEME -----------------
let onlyActiveShift = true; // Varsayılan: Aktif vardiya filtresi devrede (devir saatlerinden sonra boş başlar)
let cachedServerExcelData = null;

function getCurrentShiftCutoffInfo(dateObj = new Date()) {
  const h = dateObj.getHours();
  const m = dateObj.getMinutes();
  const currentMinutes = h * 60 + m;

  // 08:15 = 495 dk
  // 16:15 = 975 dk
  // 00:15 = 15 dk
  if (currentMinutes >= 495 && currentMinutes < 975) {
    return {
      shiftName: "1. Vardiya (08:15 - 16:15)",
      cutoffTimeStr: "08:15",
      cutoffMinutes: 495,
      sheetKey: "08.00",
      nextCutoffStr: "16:15"
    };
  } else if (currentMinutes >= 975) {
    return {
      shiftName: "2. Vardiya (16:15 - 00:15)",
      cutoffTimeStr: "16:15",
      cutoffMinutes: 975,
      sheetKey: "16.00",
      nextCutoffStr: "00:15"
    };
  } else if (currentMinutes >= 15 && currentMinutes < 495) {
    return {
      shiftName: "3. Vardiya (00:15 - 08:15)",
      cutoffTimeStr: "00:15",
      cutoffMinutes: 15,
      sheetKey: "24.00",
      nextCutoffStr: "08:15"
    };
  } else {
    // 00:00 - 00:15 arası
    return {
      shiftName: "2. Vardiya Devir (16:15 - 00:15)",
      cutoffTimeStr: "16:15",
      cutoffMinutes: 975,
      sheetKey: "16.00",
      nextCutoffStr: "00:15"
    };
  }
}

function isRecordInActiveShift(record, shiftInfo, isToday) {
  if (!isToday) return true; // Başka bir gün seçilmişse tüm kayıtları göster

  // Sayfa kontrolü: Kayıt o vardiyanın sheet'inde mi?
  if (record.sheet && !record.sheet.includes(shiftInfo.sheetKey)) {
    return false;
  }

  // Saat kontrolü
  let recMinutes = null;
  const timeStr = record.time_str || (record.description ? (record.description.match(/\[(\d{1,2}):(\d{2})\]/) || [])[1] : null);
  if (timeStr) {
    const parts = timeStr.split(":");
    if (parts.length === 2) {
      recMinutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
  }

  if (recMinutes !== null) {
    if (shiftInfo.cutoffTimeStr === "08:15") {
      return recMinutes >= 495 && recMinutes < 975;
    } else if (shiftInfo.cutoffTimeStr === "16:15") {
      return recMinutes >= 975;
    } else if (shiftInfo.cutoffTimeStr === "00:15") {
      return recMinutes >= 15 && recMinutes < 495;
    }
  }

  return true;
}

function toggleServerExcelShiftFilter() {
  onlyActiveShift = !onlyActiveShift;
  renderServerExcelTable();
}

function downloadCurrentServerExcel() {
  const dateVal = document.getElementById("formDateInput")?.value || "";
  const url = dateVal ? `/api/server-excel/download?date_str=${encodeURIComponent(dateVal)}` : "/api/server-excel/download";
  window.open(url, "_blank");
}

// ----------------- SERVER EXCEL DURUMUNU YÜKLEME -----------------
async function loadServerExcelStatus(dateStr = null) {
  try {
    if (!dateStr) {
      dateStr = document.getElementById("formDateInput")?.value || null;
    }
    const url = dateStr ? `/api/server-excel/status?date_str=${encodeURIComponent(dateStr)}` : "/api/server-excel/status";
    const res = await fetch(url);
    const data = await res.json();
    cachedServerExcelData = data;
    renderServerExcelTable(dateStr);
  } catch (e) {
    console.error("Server Excel durumu alınamadı:", e);
  }
}

function renderServerExcelTable(dateStr = null) {
  if (!cachedServerExcelData) return;
  const data = cachedServerExcelData;
  const now = new Date();
  const todayIso = formatDateToIso(now);
  const selectedDate = dateStr || document.getElementById("formDateInput")?.value || todayIso;
  const isToday = selectedDate === todayIso;

  const shiftInfo = getCurrentShiftCutoffInfo(now);

  // Vardiya rozetini güncelle
  const badgeEl = document.getElementById("activeShiftBadge");
  if (badgeEl) {
    badgeEl.innerText = isToday ? shiftInfo.shiftName : "Seçili Gün";
  }

  // Buton metnini ve stilini güncelle
  const btnText = document.getElementById("shiftFilterBtnText");
  const btnToggle = document.getElementById("btnToggleShiftFilter");
  if (btnText && btnToggle) {
    if (onlyActiveShift && isToday) {
      btnText.innerText = `Sadece Aktif Vardiya (${shiftInfo.cutoffTimeStr} sonrası)`;
      btnToggle.className = "px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-xs";
    } else {
      btnText.innerText = "Günün Tüm Kayıtları";
      btnToggle.className = "px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-xs";
    }
  }

  // Kayıtları filtrele
  let displayRecords = data.records;
  if (onlyActiveShift && isToday) {
    displayRecords = data.records.filter(r => isRecordInActiveShift(r, shiftInfo, isToday));
  }

  const infoEl = document.getElementById("serverExcelInfo");
  if (infoEl) {
    infoEl.innerHTML = `Tarih: <b class="text-blue-700">${data.today_date_str}</b> | Dosya: <b class="text-slate-800">${data.month_folder} / ${data.file_name}</b> | Görüntülenen: <b class="text-blue-700">${displayRecords.length}</b> (Toplam: ${data.records.length})`;
  }

  const tbody = document.getElementById("serverExcelRowsBody");
  if (!tbody) return;

  if (displayRecords.length === 0) {
    if (onlyActiveShift && isToday) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400">
        <p class="font-bold text-slate-600">Bu vardiyada (${shiftInfo.shiftName}) henüz yeni bir kayıt girilmedi.</p>
        <p class="text-[11px] text-slate-400 mt-1">Saat 08:15, 16:15 ve 00:15 vardiya devirlerinden sonra bu ekran otomatik olarak boş başlar.</p>
        <button type="button" onclick="toggleServerExcelShiftFilter()" class="mt-2.5 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold">Günün tüm kayıtlarını göster (${data.records.length} adet)</button>
      </td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Bu tarihe (${data.today_date_str}) henüz bu dosyaya kayıt girilmedi.</td></tr>`;
    }
    if (window.lucide) lucide.createIcons();
    return;
  }

  tbody.innerHTML = displayRecords.map((r) => `
    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
      <td class="p-2.5 text-center font-bold text-slate-500">${r.row}</td>
      <td class="p-2.5 text-center font-medium text-slate-600 bg-slate-50/50">${r.sheet}</td>
      <td class="p-2.5 font-bold text-blue-900">${r.area || r.line_and_machine || '-'}</td>
      <td class="p-2.5 text-slate-700 font-medium">${r.description}</td>
      <td class="p-2.5 text-center font-bold text-purple-700">${r.criterion_no}</td>
      <td class="p-2.5 text-center font-bold text-slate-800">${r.time_spent} dk</td>
      <td class="p-2.5 text-center font-semibold text-slate-700">${r.operator}</td>
    </tr>
  `).join("");
}

// ----------------- SON KAYITLAR LİSTESİ -----------------
async function loadRecentLogs() {
  try {
    const res = await fetch("/api/logs?limit=20");
    const logs = await res.json();
    const container = document.getElementById("recentLogsList");
    if (!container) return;

    if (logs.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Henüz arıza kaydı bulunmuyor.</p>`;
      return;
    }

    container.innerHTML = logs.map(l => `
      <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <span class="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold text-xs rounded">${l.machine_code}</span>
            <span class="text-xs font-semibold text-slate-800">${l.failure_description}</span>
            <span class="text-[10px] text-slate-400">(${l.maintenance_type})</span>
          </div>
          <p class="text-xs text-slate-600"><b class="text-slate-700">Müdahale:</b> ${l.action_taken}</p>
          <div class="flex items-center space-x-3 text-[11px] text-slate-400">
            <span>⏱️ ${l.downtime_minutes} dk duruş</span>
            <span>🔧 Parça: ${l.parts_replaced}</span>
            <span>👤 ${l.user_name}</span>
            <span>📅 ${l.date_str}</span>
          </div>
        </div>

        ${document.getElementById("tab-doruk-sync") ? `
        <div class="flex items-center space-x-2 flex-shrink-0">
          ${l.is_doruk_synced
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800" title="Doruk MES Kayıt No: ${l.doruk_record_id || '-'}">
                <i data-lucide="check" class="w-3 h-3 mr-1"></i> Doruk'a Yazıldı
               </span>`
            : `<button onclick="pushToDorukManual(${l.id})" class="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded text-[10px] font-semibold flex items-center gap-1">
                <i data-lucide="upload-cloud" class="w-3 h-3"></i> Doruk'a Gönder
               </button>`
          }
        </div>
        ` : ""}
      </div>
    `).join("");

    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error("Kayıtlar yüklenemedi:", e);
  }
}

// ----------------- MAKİNELER & KLASÖRLER (A, B, C BİNASI LAYOUT KIRILIMI) -----------------
let currentBuildingFilter = "ALL";

async function loadMachines() {
  try {
    const res = await fetch("/api/machines");
    allMachines = await res.json();
    renderMachinesGrid(allMachines);
    updateFormDatalists();

    // Chatbot ve Excel dropdown'larını güncelle
    const chatSelect = document.getElementById("chatTargetMachine");
    const excelSelect = document.getElementById("excelFilterMachine");
    const optionsHtml = '<option value="">Tüm Makineler</option>' + allMachines.map(m => `
      <option value="${m.code}">${m.code} - ${m.name}</option>
    `).join("");

    if (chatSelect) chatSelect.innerHTML = optionsHtml;
    if (excelSelect) excelSelect.innerHTML = optionsHtml;
  } catch (e) {
    console.error("Makineler yüklenemedi:", e);
  }
}

function setBuildingFilter(bldg) {
  currentBuildingFilter = bldg;

  // Buton stillerini güncelle
  document.querySelectorAll(".bldg-filter-btn").forEach(btn => {
    btn.classList.remove("bg-slate-900", "text-white", "shadow-sm");
    btn.classList.add("bg-slate-100", "text-slate-700", "border", "border-slate-200");
  });

  const activeId = bldg === "ALL" ? "bfilter-ALL" : (bldg === "A BİNASI" ? "bfilter-A" : (bldg === "B BİNASI" ? "bfilter-B" : "bfilter-C"));
  const activeBtn = document.getElementById(activeId);
  if (activeBtn) {
    activeBtn.classList.remove("bg-slate-100", "text-slate-700", "border", "border-slate-200");
    activeBtn.classList.add("bg-slate-900", "text-white", "shadow-sm");
  }

  filterMachines();
}

function filterMachines() {
  const query = document.getElementById("machineSearchInput")?.value?.toLowerCase().trim() || "";

  let list = allMachines;
  if (currentBuildingFilter !== "ALL") {
    list = list.filter(m => (m.department || "").toUpperCase().includes(currentBuildingFilter.toUpperCase()));
  }

  if (query) {
    list = list.filter(m =>
      (m.code && m.code.toLowerCase().includes(query)) ||
      (m.name && m.name.toLowerCase().includes(query)) ||
      (m.line && m.line.toLowerCase().includes(query)) ||
      (m.department && m.department.toLowerCase().includes(query)) ||
      (m.model && m.model.toLowerCase().includes(query))
    );
  }

  renderMachinesGrid(list);
}

function renderMachinesGrid(machines) {
  const container = document.getElementById("machinesGrid");
  if (!container) return;

  // Rozet sayaçlarını güncelle
  const countAll = allMachines.length;
  const countA = allMachines.filter(m => (m.department || "").includes("A BİNASI")).length;
  const countB = allMachines.filter(m => (m.department || "").includes("B BİNASI")).length;
  const countC = allMachines.filter(m => (m.department || "").includes("C BİNASI")).length;

  const elAll = document.getElementById("badge-count-all");
  const elA = document.getElementById("badge-count-A");
  const elB = document.getElementById("badge-count-B");
  const elC = document.getElementById("badge-count-C");
  if (elAll) elAll.innerText = countAll;
  if (elA) elA.innerText = countA;
  if (elB) elB.innerText = countB;
  if (elC) elC.innerText = countC;

  if (machines.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
        <i data-lucide="search-x" class="w-10 h-10 text-slate-400 mx-auto mb-2"></i>
        <p class="text-sm font-bold text-slate-700">Aramanıza uygun makine bulunamadı.</p>
        <p class="text-xs text-slate-400 mt-1">Lütfen farklı bir makine kodu, hat adı veya bina filtresi deneyin.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Gruplama: Bina -> Hat Numarası
  const grouped = {};
  machines.forEach(m => {
    const bldg = m.department || "DİĞER BÖLGELER";
    const line = m.line || "GENEL HAT";
    if (!grouped[bldg]) grouped[bldg] = {};
    if (!grouped[bldg][line]) grouped[bldg][line] = [];
    grouped[bldg][line].push(m);
  });

  let html = "";
  for (const bldgName of Object.keys(grouped)) {
    const isA = bldgName.includes("A BİNASI");
    const isB = bldgName.includes("B BİNASI");
    const isC = bldgName.includes("C BİNASI");

    const bldgBadge = isA
      ? "bg-blue-600 text-white"
      : (isB ? "bg-emerald-600 text-white" : (isC ? "bg-purple-600 text-white" : "bg-slate-700 text-white"));
    const bldgBorder = isA
      ? "border-blue-300"
      : (isB ? "border-emerald-300" : (isC ? "border-purple-300" : "border-slate-300"));

    const totalInBldg = Object.values(grouped[bldgName]).reduce((a, b) => a + b.length, 0);

    html += `
      <div class="space-y-4">
        <!-- Bina Başlık Çubuğu -->
        <div class="flex items-center justify-between border-b-2 pb-2 ${bldgBorder}">
          <div class="flex items-center space-x-2.5">
            <span class="px-3.5 py-1 rounded-xl text-xs font-bold ${bldgBadge} uppercase tracking-wider shadow-xs">
              🏢 ${bldgName}
            </span>
            <span class="text-xs font-bold text-slate-600">
              (${Object.keys(grouped[bldgName]).length} Hat / ${totalInBldg} Makine)
            </span>
          </div>
        </div>
    `;

    for (const lineName of Object.keys(grouped[bldgName])) {
      const lineMachines = grouped[bldgName][lineName];
      html += `
        <div class="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs transition hover:border-slate-300">
          <!-- Hat Başlığı -->
          <div class="flex items-center justify-between pb-3 mb-3.5 border-b border-slate-100">
            <div class="flex items-center space-x-2">
              <span class="w-2.5 h-2.5 rounded-full ${isA ? 'bg-blue-500' : (isB ? 'bg-emerald-500' : 'bg-purple-500')}"></span>
              <h3 class="text-sm font-bold text-slate-900">${lineName}</h3>
            </div>
            <span class="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
              ${lineMachines.length} Makine
            </span>
          </div>

          <!-- Makineler Kart Grid'i -->
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            ${lineMachines.map(m => `
              <div class="bg-slate-50 hover:bg-white p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition flex flex-col justify-between group">
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-lg tracking-wider">
                      ${m.code}
                    </span>
                    <span class="text-[10px] font-bold ${m.status === 'CALISIYOR' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'} px-1.5 py-0.5 rounded border">
                      ${m.status === 'CALISIYOR' ? '● ÇALIŞIYOR' : '● ' + m.status}
                    </span>
                  </div>
                  <h4 class="text-xs font-bold text-slate-900 leading-snug group-hover:text-blue-600 transition" title="${m.name}">
                    ${m.name}
                  </h4>
                  <p class="text-[10px] text-slate-500 mt-0.5 truncate">${m.model || '-'}</p>
                </div>

                <div class="pt-2.5 border-t border-slate-200 mt-2.5 space-y-2">
                  <div class="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                    <span>⏱️ <b class="text-slate-800">${m.total_downtime_minutes || 0}</b> dk duruş</span>
                    <span class="text-slate-400 font-normal">🔧 ${m.log_count || 0} kayıt</span>
                  </div>
                  <div class="flex items-center gap-1.5 pt-1">
                    <button type="button" onclick="openMachineFolder('${m.code}')" class="flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition shadow-2xs active:scale-95">
                      <i data-lucide="folder" class="w-3.5 h-3.5 text-blue-600"></i>
                      <span>Klasör</span>
                    </button>
                    <button type="button" onclick="selectMachineForReport('${m.code}', '${m.department}', '${m.line}')" title="Bu makine için bakım formu aç" class="py-1.5 px-2.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-700 border border-blue-200 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition shadow-2xs active:scale-95">
                      <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                      <span>Rapor Yaz</span>
                    </button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }

    html += `</div>`;
  }

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function selectMachineForReport(code, building, line) {
  switchTab("voice-report");

  const bldgSelect = document.getElementById("formBuilding");
  if (bldgSelect && building) {
    let matched = false;
    for (const opt of bldgSelect.options) {
      if (opt.value === building) {
        bldgSelect.value = building;
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (building.includes("A BİNASI")) bldgSelect.value = "A BİNASI";
      else if (building.includes("B BİNASI")) bldgSelect.value = "B BİNASI";
      else if (building.includes("C BİNASI")) bldgSelect.value = "C BİNASI";
    }
  }

  const lineInput = document.getElementById("formLineNo");
  if (lineInput && line) {
    lineInput.value = line;
  }

  const codeInput = document.getElementById("formMachineCode");
  if (codeInput && code) {
    codeInput.value = code;
  }

  updateFormDatalists();
  updatePreviewRow();

  const descArea = document.getElementById("formJobDescription");
  if (descArea) {
    descArea.focus();
    descArea.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function onBuildingChange() {
  updateFormDatalists();
  updatePreviewRow();
}

function onMachineCodeInput() {
  const codeVal = document.getElementById("formMachineCode")?.value?.trim().toUpperCase();
  if (codeVal && allMachines.length > 0) {
    const match = allMachines.find(m => m.code.toUpperCase() === codeVal);
    if (match) {
      const bldgSelect = document.getElementById("formBuilding");
      if (bldgSelect && match.department) {
        for (const opt of bldgSelect.options) {
          if (opt.value === match.department || match.department.includes(opt.value)) {
            bldgSelect.value = opt.value;
            break;
          }
        }
      }
      const lineInput = document.getElementById("formLineNo");
      if (lineInput && !lineInput.value) {
        lineInput.value = match.line;
      }
    }
  }
  updatePreviewRow();
}

function updateFormDatalists() {
  const bldg = document.getElementById("formBuilding")?.value || "";
  const lineDatalist = document.getElementById("lineDatalist");
  const machDatalist = document.getElementById("machineCodeDatalist");

  let filtered = allMachines;
  if (bldg && bldg !== "HİÇBİRİ" && bldg !== "BÜTÜN BİNALAR") {
    filtered = allMachines.filter(m => (m.department || "").includes(bldg));
  }

  if (lineDatalist) {
    const lines = Array.from(new Set(filtered.map(m => m.line).filter(Boolean)));
    lineDatalist.innerHTML = lines.map(l => `<option value="${l}"></option>`).join("");
  }

  if (machDatalist) {
    machDatalist.innerHTML = filtered.map(m => `
      <option value="${m.code}">${m.name} (${m.line})</option>
    `).join("");
  }
}

// ----------------- MAKİNE KLASÖR DETAY MODALI -----------------
async function openMachineFolder(machineCode) {
  try {
    const res = await fetch(`/api/machines/${machineCode}/folder`);
    const data = await res.json();

    document.getElementById("modalMachineCode").innerText = data.machine.code;
    document.getElementById("modalMachineName").innerText = `${data.machine.name} (${data.machine.department} - ${data.machine.line})`;
    document.getElementById("modalTotalDowntime").innerText = `${data.machine.total_downtime} dk`;
    document.getElementById("modalInterventionCount").innerText = data.total_interventions;

    const list = document.getElementById("modalMachineHistoryList");
    if (data.history.length === 0) {
      list.innerHTML = `<p class="text-xs text-slate-400 py-3 text-center">Bu makine için henüz kayıt girilmemiş.</p>`;
    } else {
      list.innerHTML = data.history.map(item => `
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-800">${item.date} (${item.shift})</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${item.is_doruk_synced ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}">
              ${item.source === 'DORUK_SYNC' ? '🏭 Doruk Terminalinden' : '📱 Mobil Sesli Kayıt'}
            </span>
          </div>
          <p class="text-slate-700 font-medium"><b class="text-slate-900">Arıza:</b> ${item.failure}</p>
          <p class="text-slate-600"><b class="text-slate-800">Müdahale:</b> ${item.action}</p>
          <div class="flex items-center space-x-3 text-[11px] text-slate-400 pt-1">
            <span>⏱️ ${item.downtime} dk</span>
            <span>🔧 ${item.parts}</span>
            <span>👤 ${item.user}</span>
          </div>
        </div>
      `).join("");
    }

    document.getElementById("machineFolderModal").classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error("Klasör detayı açılamadı:", e);
  }
}

function closeMachineFolderModal() {
  document.getElementById("machineFolderModal").classList.add("hidden");
}

// ----------------- DORUK OTOMASYON & KEYPET İŞLEMLERİ -----------------
let activeDorukDate = "";

async function loadDorukRows(dateStr = null) {
  try {
    if (!dateStr) {
      const datePicker = document.getElementById("dorukFilterDate");
      dateStr = datePicker ? datePicker.value : "";
      if (!dateStr) {
        const today = new Date();
        dateStr = formatDateToIso(today);
        if (datePicker) datePicker.value = dateStr;
      }
    }
    activeDorukDate = dateStr;

    const res = await fetch(`/api/doruk/rows?date_str=${encodeURIComponent(dateStr)}`);
    if (!res.ok) return;
    const data = await res.json();

    // Bilgi çubuğu ve sayaç
    const infoText = document.getElementById("dorukFileInfoText");
    if (infoText) {
      if (data.file_exists) {
        infoText.innerHTML = `📁 Keypet Dosyası: <b class="text-blue-700">${data.file_name}</b> | Toplam: <b class="text-emerald-700">${data.total_records} Satır</b>`;
      } else {
        infoText.innerHTML = `Tarih: <b>${data.date_str}</b> (Bu tarihe ait henüz yeni kayıt oluşturulmadı)`;
      }
    }

    const dayCountEl = document.getElementById("statDorukDayCount");
    if (dayCountEl) dayCountEl.innerText = data.total_records || 0;

    const tbody = document.getElementById("dorukRowsTableBody");
    if (!tbody) return;

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="p-6 text-center text-slate-400">
            Bu tarihe (${data.date_str}) ait Doruk Keypet kaydı bulunamadı.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.records.map((r, idx) => `
      <tr class="hover:bg-blue-50/40 transition border-b border-slate-100 ${r.action && r.action !== '-' ? 'bg-amber-50/20' : ''}">
        <td class="p-2.5 text-center font-bold text-slate-400">${idx + 1}</td>
        <td class="p-2.5 font-bold text-blue-900 whitespace-nowrap">
          <span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">${r.machine}</span>
        </td>
        <td class="p-2.5 text-center text-slate-600 whitespace-nowrap">${r.shift || '-'}</td>
        <td class="p-2.5 text-center font-bold text-slate-800 whitespace-nowrap">${r.duration_min} dk</td>
        <td class="p-2.5 text-slate-600 whitespace-nowrap">${r.station || '-'}</td>
        <td class="p-2.5 text-slate-700 font-semibold whitespace-nowrap">${r.project_code || '-'}</td>
        <td class="p-2.5 text-slate-600 whitespace-nowrap">${r.operator || '-'}</td>
        <td class="p-2.5 text-slate-700 whitespace-nowrap">
          <span class="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-purple-100 text-purple-800">
            ${r.fault_name || r.fault_code || 'ARIZA'}
          </span>
        </td>
        <td class="p-2.5 text-slate-800 font-medium">
          ${r.action && r.action !== '-' 
            ? `<span class="font-bold text-slate-900 bg-amber-100/60 px-2 py-0.5 rounded">${r.action}</span>` 
            : `<span class="text-slate-400">-</span>`}
        </td>
        <td class="p-2.5 text-center font-bold text-emerald-800 whitespace-nowrap">
          ${r.entered_by && r.entered_by !== '-' 
            ? `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">${r.entered_by}</span>`
            : `<span class="text-slate-400">-</span>`}
        </td>
      </tr>
    `).join("");

  } catch (e) {
    console.error("Doruk satırları yüklenemedi:", e);
  }
}

function onDorukDateChanged() {
  const dateInput = document.getElementById("dorukFilterDate");
  if (dateInput && dateInput.value) {
    loadDorukRows(dateInput.value);
  }
}

function setDorukTodayDate() {
  const today = new Date();
  const iso = formatDateToIso(today);
  const dateInput = document.getElementById("dorukFilterDate");
  if (dateInput) {
    dateInput.value = iso;
    loadDorukRows(iso);
  }
}

function downloadDorukExcel() {
  const dateInput = document.getElementById("dorukFilterDate");
  const dateVal = dateInput && dateInput.value ? dateInput.value : formatDateToIso(new Date());
  window.open(`/api/doruk/export?date_str=${encodeURIComponent(dateVal)}`, "_blank");
}

async function submitDorukDirectRow(event) {
  event.preventDefault();

  const machineCode = document.getElementById("dorukFormMachineCode").value.trim().toUpperCase();
  const shift = document.getElementById("dorukFormShift").value;
  const duration = parseInt(document.getElementById("dorukFormDuration").value) || 15;
  const criterionSelect = document.getElementById("dorukFormCriterion");
  const criterionNo = criterionSelect.value;
  const criterionName = criterionSelect.options[criterionSelect.selectedIndex].getAttribute("data-name") || "MEKANİK ARIZA";
  const station = document.getElementById("dorukFormStation").value.trim();
  const project = document.getElementById("dorukFormProject").value.trim().toUpperCase();
  const rootCause = document.getElementById("dorukFormRootCause").value.trim().toUpperCase();
  const description = document.getElementById("dorukFormDescription").value.trim().toUpperCase();
  const technician = document.getElementById("dorukFormTechnician").value.trim().toUpperCase();

  const dateInput = document.getElementById("dorukFilterDate");
  const dateVal = dateInput && dateInput.value ? dateInput.value : formatDateToIso(new Date());

  if (!machineCode) {
    alert("Lütfen makine kodu giriniz.");
    return;
  }
  if (!description) {
    alert("Lütfen yapılan işlem açıklamasını (25. sütun) doldurunuz.");
    return;
  }
  if (!technician) {
    alert("Lütfen bilgi giren teknisyen adını doldurunuz.");
    return;
  }

  const btn = document.getElementById("btnSubmitDorukDirect");
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Doruk Satırına Yazılıyor...</span>`;
  if (window.lucide) lucide.createIcons();

  const payload = {
    machine_code: machineCode,
    job_description: description,
    technician_name: technician,
    time_spent_minutes: duration,
    criterion_no: criterionNo,
    criterion_name: criterionName,
    station: station || "-",
    project_code: project || "COMMON",
    project_name: "-",
    operator_name: technician,
    root_cause: rootCause || "-",
    shift: shift,
    date_str: dateVal,
    user_id: currentUser ? currentUser.id : null
  };

  try {
    const res = await fetch("/api/doruk/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      alert(`✅ DORUK SATIRINA BAŞARIYLA EKLENDİ!\n\n📁 Keypet Dosyası: ${data.file_name}\n📍 Eklenen Satır No: ${data.row}\n🆔 Kayıt No: ${data.record_id}\n\nKayıt bilgisayarınızdaki resmi 26 sütunlu Doruk Keypet dosyasına yazıldı.`);

      // Açıklama alanını temizle
      document.getElementById("dorukFormDescription").value = "";
      // Tabloyu ve logları yenile
      loadDorukRows(dateVal);
      loadRecentLogs();
      loadMachines();
    } else {
      const err = await res.json();
      alert(`Hata: ${err.detail || "Doruk dosyasına yazılamadı!"}`);
    }
  } catch (e) {
    console.error("Doruk kayıt hatası:", e);
    alert("Doruk servisine bağlanılamadı.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
    if (window.lucide) lucide.createIcons();
  }
}

// ----------------- DORUK OTOMASYON İŞLEMLERİ -----------------
async function triggerDorukPull() {
  try {
    const res = await fetch("/api/doruk/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days_back: 7 })
    });
    const data = await res.json();
    alert(`✅ Doruk Senkronizasyonu Tamamlandı!\n${data.message}`);
    loadRecentLogs();
    loadMachines();
    loadDorukSyncLogs();
  } catch (e) {
    alert("Doruk sistemiyle iletişim kurulamadı.");
  }
}

async function pushToDorukManual(logId) {
  try {
    const res = await fetch(`/api/doruk/push/${logId}`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Doruk'a başarıyla iletildi! (Kayıt No: ${data.doruk_id})`);
      loadRecentLogs();
      loadDorukSyncLogs();
    } else {
      alert(`İletim başarısız: ${data.message}`);
    }
  } catch (e) {
    alert("Hata oluştu.");
  }
}

async function loadDorukSyncLogs() {
  try {
    const res = await fetch("/api/doruk/sync-logs");
    const logs = await res.json();
    const table = document.getElementById("dorukSyncLogsTable");
    if (!table) return;

    // Sayaçları güncelle
    const pushCnt = logs.filter(l => l.direction === "PUSH_TO_DORUK").length;
    const pullCnt = logs.filter(l => l.direction === "PULL_FROM_DORUK").length;
    document.getElementById("statDorukPushCount").innerText = pushCnt;
    document.getElementById("statDorukPullCount").innerText = pullCnt;

    if (logs.length === 0) {
      table.innerHTML = `<p class="text-xs text-slate-400 p-4 text-center">Henüz senkronizasyon kaydı yok.</p>`;
      return;
    }

    table.innerHTML = `
      <div class="bg-slate-100 font-semibold px-3 py-2 grid grid-cols-4 text-slate-600 text-[11px]">
        <div>Yön</div>
        <div>Makine</div>
        <div>Durum</div>
        <div>Zaman / Mesaj</div>
      </div>
      <div class="divide-y divide-slate-100 max-h-60 overflow-y-auto">
        ${logs.map(l => `
          <div class="px-3 py-2 grid grid-cols-4 text-[11px] items-center">
            <span class="font-bold ${l.direction === 'PUSH_TO_DORUK' ? 'text-blue-600' : 'text-emerald-600'}">
              ${l.direction === 'PUSH_TO_DORUK' ? '⬆️ Sahadan Doruk\'a' : '⬇️ Doruk\'tan Sahaya'}
            </span>
            <span>${l.machine_code || '-'}</span>
            <span class="text-emerald-600 font-semibold">${l.status}</span>
            <span class="text-slate-500 truncate" title="${l.response_message}">${l.response_message || '-'}</span>
          </div>
        `).join("")}
      </div>
    `;
  } catch (e) {
    console.error("Doruk logları yüklenemedi:", e);
  }
}

// ----------------- BAKIMCI CHATBOT -----------------
async function handleChatSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  const query = input.value.trim();
  if (!query) return;

  const targetMachine = document.getElementById("chatTargetMachine").value;
  input.value = "";

  appendChatMessage("USER", query);
  await askChatbot(query, targetMachine);
}

async function askChatbot(query, machineCode = null) {
  const container = document.getElementById("chatMessages");

  // Kullanıcı mesajı eklenmemişse ekle
  const lastMsg = container.lastElementChild;
  if (!lastMsg || !lastMsg.innerText.includes(query)) {
    appendChatMessage("USER", query);
  }

  // Yükleniyor göstergesi
  const loadingId = "bot-loading-" + Date.now();
  container.insertAdjacentHTML("beforeend", `
    <div id="${loadingId}" class="flex items-start space-x-2.5 max-w-2xl">
      <div class="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center flex-shrink-0 animate-spin">
        <i data-lucide="loader" class="w-4 h-4"></i>
      </div>
      <div class="bg-slate-100 rounded-2xl rounded-tl-none p-3.5 text-xs text-slate-500">
        Geçmiş arıza kayıtları ve Doruk logları taranıyor...
      </div>
    </div>
  `);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query,
        machine_code: machineCode,
        user_id: currentUser ? currentUser.id : null
      })
    });
    const data = await res.json();

    const loader = document.getElementById(loadingId);
    if (loader) loader.remove();

    appendChatMessage("ASSISTANT", data.answer);
  } catch (e) {
    const loader = document.getElementById(loadingId);
    if (loader) loader.remove();
    appendChatMessage("ASSISTANT", "Üzgünüm, arıza veritabanına erişirken bir hata oluştu.");
  }
}

function appendChatMessage(sender, message) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const isUser = sender === "USER";
  const formattedMsg = message.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");

  const html = isUser ? `
    <div class="flex items-end justify-end space-x-2">
      <div class="bg-blue-600 text-white rounded-2xl rounded-br-none p-3 text-xs sm:text-sm max-w-md shadow-sm">
        ${formattedMsg}
      </div>
      <div class="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
        ${currentUser && currentUser.full_name ? currentUser.full_name[0] : "U"}
      </div>
    </div>
  ` : `
    <div class="flex items-start space-x-2.5 max-w-2xl">
      <div class="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
        <i data-lucide="bot" class="w-4 h-4"></i>
      </div>
      <div class="bg-slate-100 rounded-2xl rounded-tl-none p-3.5 text-slate-800 text-xs sm:text-sm leading-relaxed shadow-sm">
        ${formattedMsg}
      </div>
    </div>
  `;

  container.insertAdjacentHTML("beforeend", html);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) lucide.createIcons();
}

// ----------------- TAB 5: YAPILAN İŞLER & TAKVİME GÖRE EXCEL İNDİRME -----------------
async function onDoneJobsDateChanged() {
  const dateInput = document.getElementById("excelFilterDate");
  if (!dateInput) return;
  const dateVal = dateInput.value || formatDateToIso(new Date());
  const machineFilter = document.getElementById("excelFilterMachine")?.value || "";

  const titleEl = document.getElementById("doneJobsTableTitle");
  const badgeEl = document.getElementById("doneJobsBadgeInfo");
  const tbody = document.getElementById("doneJobsTableBody");

  if (titleEl) titleEl.innerText = `${dateVal} Tarihinde Yapılan İşler`;
  if (badgeEl) badgeEl.innerText = "Yükleniyor...";

  try {
    const res = await fetch(`/api/server-excel/status?date_str=${encodeURIComponent(dateVal)}`);
    if (!res.ok) throw new Error("Sunucudan veri alınamadı");
    const data = await res.json();

    let records = data.records || [];
    if (machineFilter) {
      records = records.filter(r => (r.area || "").toUpperCase().includes(machineFilter.toUpperCase()));
    }

    const totalMinutes = records.reduce((sum, r) => sum + (parseInt(r.time_spent) || 0), 0);
    if (badgeEl) {
      badgeEl.innerHTML = `Toplam: <b class="text-blue-700 font-bold">${records.length} İşlem</b> | Toplam Süre: <b class="text-emerald-700 font-bold">${totalMinutes} dk</b>`;
    }

    if (!tbody) return;
    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400">Bu tarihte (${dateVal}) henüz yapılan bir iş kaydı bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map((r, idx) => `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100">
        <td class="p-2.5 text-center font-bold text-slate-500">${idx + 1}</td>
        <td class="p-2.5 text-center font-medium text-slate-600 bg-slate-50/50">${r.sheet}</td>
        <td class="p-2.5 font-bold text-blue-900">${r.area || '-'}</td>
        <td class="p-2.5 text-slate-700 font-medium">${r.description}</td>
        <td class="p-2.5 text-center font-bold text-purple-700">${r.criterion_no}</td>
        <td class="p-2.5 text-center font-bold text-slate-800">${r.time_spent} dk</td>
        <td class="p-2.5 text-center font-semibold text-slate-700">${r.operator}</td>
      </tr>
    `).join("");
  } catch (e) {
    console.error("Yapılan işler listesi yüklenemedi:", e);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-500">Kayıtlar yüklenirken hata oluştu.</td></tr>`;
    }
  }
}

function setExportDateQuick(type) {
  const dateInput = document.getElementById("excelFilterDate");
  if (!dateInput) return;
  const d = new Date();
  if (type === 'yesterday') {
    d.setDate(d.getDate() - 1);
  }
  dateInput.value = formatDateToIso(d);
  onDoneJobsDateChanged();
}

function downloadSelectedDateServerExcel() {
  const dateInput = document.getElementById("excelFilterDate");
  const dateVal = dateInput?.value || formatDateToIso(new Date());
  window.open(`/api/server-excel/download?date_str=${encodeURIComponent(dateVal)}`, "_blank");
}

function downloadTodayExcel() {
  const today = formatDateToIso(new Date());
  window.open(`/api/server-excel/download?date_str=${encodeURIComponent(today)}`, "_blank");
}

function downloadFilteredExcel() {
  const dateInput = document.getElementById("excelFilterDate");
  const dateVal = dateInput?.value || formatDateToIso(new Date());
  const machine = document.getElementById("excelFilterMachine")?.value || "";
  let url = `/api/excel/export?report_date=${encodeURIComponent(dateVal)}`;
  if (machine) url += `&machine_code=${encodeURIComponent(machine)}`;
  window.open(url, "_blank");
}

// ----------------- KİMLİK DOĞRULAMA & ADMIN YÖNETİMİ -----------------
let allUsers = [];

function isAdminUser(user) {
  return user && ["ADMIN", "AMIR", "YONETICI"].includes((user.role || "").toUpperCase());
}

function setInputError(el, hasError) {
  if (!el) return;
  const errClasses = ["border-rose-500", "ring-2", "ring-rose-200", "bg-rose-50"];
  if (hasError) {
    el.classList.remove("border-slate-300", "bg-white");
    el.classList.add(...errClasses);
  } else {
    el.classList.remove(...errClasses);
    el.classList.add("border-slate-300", "bg-white");
  }
}

function clearInputError(el) {
  setInputError(el, false);
}

function showLoginOverlay(errorMsg = "") {
  const overlay = document.getElementById("loginOverlay");
  const errEl = document.getElementById("loginError");
  const sicilInput = document.getElementById("loginSicilNo");
  const pinInput = document.getElementById("loginPin");

  if (overlay) overlay.classList.remove("hidden");
  if (errEl) {
    if (errorMsg) {
      errEl.textContent = errorMsg;
      errEl.classList.remove("hidden");
      setInputError(sicilInput, true);
      setInputError(pinInput, true);
    } else {
      errEl.classList.add("hidden");
      setInputError(sicilInput, false);
      setInputError(pinInput, false);
    }
  }
  if (sicilInput && !errorMsg) sicilInput.focus();
}

function hideLoginOverlay() {
  const overlay = document.getElementById("loginOverlay");
  const errEl = document.getElementById("loginError");
  setInputError(document.getElementById("loginSicilNo"), false);
  setInputError(document.getElementById("loginPin"), false);
  if (overlay) overlay.classList.add("hidden");
  if (errEl) errEl.classList.add("hidden");
}

function applyAuthenticatedUser(user) {
  currentUser = user;
  const activeUserNameEl = document.getElementById("activeUserName");
  const activeUserRoleEl = document.getElementById("activeUserRole");
  if (activeUserNameEl) activeUserNameEl.innerText = user.full_name;
  if (activeUserRoleEl) activeUserRoleEl.innerText = `(${user.username} • ${user.role})`;

  const btnAdmin = document.getElementById("btnAdminUsers");
  if (btnAdmin) {
    if (isAdminUser(user)) {
      btnAdmin.classList.remove("hidden");
    } else {
      btnAdmin.classList.add("hidden");
    }
  }

  const opInput = document.getElementById("formOperatorName");
  if (opInput) opInput.value = user.full_name;

  updatePreviewRow();
}

async function checkAuthAndInit() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const user = await res.json();
      hideLoginOverlay();
      applyAuthenticatedUser(user);
      startAppAfterAuth();
    } else {
      showLoginOverlay();
    }
  } catch (e) {
    console.warn("Oturum kontrolü yapılamadı:", e);
    showLoginOverlay();
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const sicilNo = document.getElementById("loginSicilNo")?.value.trim() || "";
  const pinCode = document.getElementById("loginPin")?.value.trim() || "";
  const rememberMe = !!document.getElementById("loginRememberMe")?.checked;
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("btnLoginSubmit");

  if (errEl) errEl.classList.add("hidden");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: sicilNo,
        pin_code: pinCode,
        remember_me: rememberMe
      })
    });

    if (res.ok) {
      const user = await res.json();
      const pinInput = document.getElementById("loginPin");
      if (pinInput) pinInput.value = "";
      hideLoginOverlay();
      applyAuthenticatedUser(user);
      startAppAfterAuth();
    } else {
      const err = await res.json().catch(() => ({}));
      showLoginOverlay(err.detail || "Sicil numarası veya PIN hatalı!");
    }
  } catch (e) {
    showLoginOverlay("Sunucuya bağlanılamadı.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function logoutUser() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {
    console.warn(e);
  }
  currentUser = null;
  const btnAdmin = document.getElementById("btnAdminUsers");
  if (btnAdmin) btnAdmin.classList.add("hidden");
  showLoginOverlay();
}

async function loadUsers() {
  try {
    const res = await fetch("/api/auth/users");
    if (res.status === 401) {
      showLoginOverlay();
      return;
    }
    if (!res.ok) return;
    allUsers = await res.json();

    // Form operatör datalist'ini doldur (hızlı otomatik tamamlama için)
    const datalist = document.getElementById("operatorDatalist");
    if (datalist && Array.isArray(allUsers)) {
      datalist.innerHTML = allUsers
        .filter(u => u.is_active)
        .map(u => `<option value="${u.full_name}">${u.username} - ${u.department}</option>`)
        .join("");
    }

    renderAdminUsersList();
  } catch (e) {
    console.warn("Kullanıcılar yüklenemedi:", e);
  }
}

function openAdminUsersModal() {
  if (!isAdminUser(currentUser)) return;
  const modal = document.getElementById("adminUsersModal");
  if (modal) {
    modal.classList.remove("hidden");
    loadUsers();
    if (window.lucide) lucide.createIcons();
  }
}

function closeAdminUsersModal() {
  const modal = document.getElementById("adminUsersModal");
  if (modal) modal.classList.add("hidden");
}

function renderAdminUsersList() {
  const listEl = document.getElementById("adminUsersList");
  if (!listEl || !Array.isArray(allUsers)) return;

  if (allUsers.length === 0) {
    listEl.innerHTML = `<div class="p-4 text-center text-slate-400">Kayıtlı kullanıcı yok.</div>`;
    return;
  }

  listEl.innerHTML = allUsers.map(u => `
    <div class="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${u.is_active ? 'bg-white' : 'bg-slate-50 opacity-70'}">
      <div>
        <div class="flex items-center space-x-2">
          <span class="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono font-bold rounded">${u.username}</span>
          <span class="font-bold text-slate-900">${u.full_name}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isAdminUser(u) ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">${u.role}</span>
          ${!u.is_active ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">PASİF</span>` : ''}
        </div>
        <div class="text-[11px] text-slate-500 mt-0.5">${u.department}</div>
      </div>
      <div class="flex items-center space-x-1.5">
        <button type="button" onclick="resetUserPin(${u.id}, '${u.username}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition">
          Şifre Sıfırla
        </button>
        ${currentUser && u.id !== currentUser.id ? `
          <button type="button" onclick="toggleUserActive(${u.id}, ${!u.is_active})" class="px-2.5 py-1 ${u.is_active ? 'bg-rose-50 hover:bg-rose-100 text-rose-700' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'} rounded-lg font-semibold transition">
            ${u.is_active ? 'Pasife Al' : 'Aktif Et'}
          </button>
        ` : ''}
      </div>
    </div>
  `).join("");
}

function showAdminFormFeedback(message, isError = true) {
  const fb = document.getElementById("adminUserFormFeedback");
  if (!fb) return;
  if (!message) {
    fb.classList.add("hidden");
    fb.textContent = "";
    return;
  }
  fb.textContent = message;
  fb.classList.remove("hidden", "bg-rose-50", "border-rose-200", "text-rose-700", "bg-emerald-50", "border-emerald-200", "text-emerald-700", "border");
  if (isError) {
    fb.classList.add("bg-rose-50", "border", "border-rose-200", "text-rose-700");
  } else {
    fb.classList.add("bg-emerald-50", "border", "border-emerald-200", "text-emerald-700");
  }
}

async function submitAdminCreateUser(event) {
  event.preventDefault();
  const sicilEl = document.getElementById("newUserSicil");
  const nameEl = document.getElementById("newUserFullName");
  const deptEl = document.getElementById("newUserDept");
  const roleEl = document.getElementById("newUserRole");
  const pinEl = document.getElementById("newUserPin");

  [sicilEl, nameEl, pinEl].forEach(el => setInputError(el, false));
  showAdminFormFeedback("");

  const payload = {
    username: sicilEl.value.trim(),
    full_name: nameEl.value.trim(),
    department: deptEl.value.trim() || "Mekanik Bakım",
    role: roleEl.value,
    pin_code: pinEl.value.trim()
  };

  try {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      document.getElementById("adminCreateUserForm").reset();
      deptEl.value = "Mekanik Bakım";
      await loadUsers();
      showAdminFormFeedback("✅ Yeni personel başarıyla eklendi.", false);
    } else {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail || "Kullanıcı eklenemedi.";
      if (detail.toLowerCase().includes("sicil")) {
        setInputError(sicilEl, true);
        sicilEl.focus();
      } else if (detail.toLowerCase().includes("şifre")) {
        setInputError(pinEl, true);
        pinEl.focus();
      } else {
        setInputError(sicilEl, true);
        setInputError(nameEl, true);
        setInputError(pinEl, true);
      }
      showAdminFormFeedback(detail, true);
    }
  } catch (e) {
    showAdminFormFeedback("Sunucuya bağlanılamadı.", true);
  }
}

async function toggleUserActive(userId, newState) {
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: newState })
    });
    if (res.ok) {
      await loadUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "İşlem başarısız."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

async function resetUserPin(userId, sicilNo) {
  const newPin = prompt(`${sicilNo} sicil numaralı personel için yeni şifreyi girin\n(En az 6 karakter, büyük harf, küçük harf ve özel karakter):`);
  if (!newPin || !newPin.trim()) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin_code: newPin.trim() })
    });
    if (res.ok) {
      alert(`✅ ${sicilNo} için şifre güncellendi.`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Şifre güncellenemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

// ----------------- OPERATÖR SEÇİMİ & ÇOKLU OPERATÖR DESTEĞİ -----------------
let selectedOperators = new Set();
let operatorModalTargetInput = "formOperatorName";

function openOperatorSelectModal(targetInputId) {
  operatorModalTargetInput = targetInputId || "formOperatorName";
  const modal = document.getElementById("operatorSelectModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  // Mevcut formOperatorName veya hedef input içindeki isimleri parse et
  selectedOperators.clear();
  const currentVal = document.getElementById(operatorModalTargetInput)?.value || "";
  if (currentVal.trim()) {
    currentVal.split(/[,/]/).forEach(item => {
      const trimmed = item.trim().toUpperCase();
      if (trimmed) selectedOperators.add(trimmed);
    });
  }

  const searchInput = document.getElementById("opSearchInput");
  if (searchInput) searchInput.value = "";

  if (!allUsers || allUsers.length === 0) {
    loadUsers().then(() => {
      renderOperatorModalList();
      updateSelectedChips();
    });
  } else {
    renderOperatorModalList();
    updateSelectedChips();
  }

  if (window.lucide) lucide.createIcons();
}

function openHandoverOperatorModal() {
  openOperatorSelectModal("handoverPerson");
}

function openUserModal() {
  openOperatorSelectModal();
}

function closeOperatorSelectModal() {
  const modal = document.getElementById("operatorSelectModal");
  if (modal) modal.classList.add("hidden");
}

function renderOperatorModalList() {
  const listEl = document.getElementById("opModalUserList");
  if (!listEl) return;

  const q = (document.getElementById("opSearchInput")?.value || "").trim().toLowerCase();
  const activeUsers = (allUsers || []).filter(u => u.is_active);

  const filtered = activeUsers.filter(u => {
    if (!q) return true;
    return (
      (u.full_name && u.full_name.toLowerCase().includes(q)) ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q))
    );
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">Aradığınız kriterde personel bulunamadı.</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(u => {
    const isSelected = selectedOperators.has((u.full_name || "").toUpperCase());
    const safeName = (u.full_name || "").replace(/'/g, "\\'");
    return `
      <div onclick="toggleOperatorSelection('${safeName}')" class="p-2.5 hover:bg-slate-50 rounded-xl cursor-pointer flex items-center justify-between transition ${isSelected ? 'bg-blue-50/70 border border-blue-200' : ''}">
        <div class="flex items-center space-x-3">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleOperatorSelection('${safeName}')" class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-800">${u.full_name}</span>
              <span class="px-1.5 py-0.2 bg-slate-100 text-slate-600 font-mono text-[10px] rounded font-semibold">${u.username}</span>
            </div>
            <p class="text-[11px] text-slate-500 mt-0.5">${u.department || 'Bakım'} • ${u.role || 'TEKNISYEN'}</p>
          </div>
        </div>
        <span class="text-[11px] font-semibold ${isSelected ? 'text-blue-600' : 'text-slate-400'}">
          ${isSelected ? '✓ Seçildi' : 'Seç'}
        </span>
      </div>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();
}

function filterOperatorList() {
  renderOperatorModalList();
}

function toggleOperatorSelection(name) {
  if (!name) return;
  const upper = name.trim().toUpperCase();
  if (selectedOperators.has(upper)) {
    selectedOperators.delete(upper);
  } else {
    selectedOperators.add(upper);
  }
  renderOperatorModalList();
  updateSelectedChips();
}

function selectOnlyMeOperator() {
  selectedOperators.clear();
  if (currentUser && currentUser.full_name) {
    selectedOperators.add(currentUser.full_name.trim().toUpperCase());
  }
  renderOperatorModalList();
  updateSelectedChips();
}

function clearSelectedOperators() {
  selectedOperators.clear();
  renderOperatorModalList();
  updateSelectedChips();
}

function removeSelectedOperatorChip(name) {
  if (!name) return;
  selectedOperators.delete(name.trim().toUpperCase());
  renderOperatorModalList();
  updateSelectedChips();
}

function updateSelectedChips() {
  const container = document.getElementById("opSelectedChipsContainer");
  const badge = document.getElementById("opSelectedCountBadge");
  const btnApply = document.getElementById("btnApplyOpSelection");
  const count = selectedOperators.size;

  if (badge) {
    badge.innerText = `${count} kişi seçildi`;
  }
  if (btnApply) {
    btnApply.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Seçimi Uygula (${count})</span>`;
    if (window.lucide) lucide.createIcons();
  }

  if (!container) return;
  if (count === 0) {
    container.innerHTML = `<span class="text-[11px] text-slate-400 italic">Henüz operatör seçilmedi.</span>`;
    return;
  }

  const chipsHtml = Array.from(selectedOperators).map(name => `
    <span class="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 rounded-lg text-xs font-bold">
      <span>${name}</span>
      <button type="button" onclick="event.stopPropagation(); removeSelectedOperatorChip('${name.replace(/'/g, "\\'")}')" class="text-blue-600 hover:text-blue-900 rounded-full p-0.5">
        <i data-lucide="x" class="w-3 h-3"></i>
      </button>
    </span>
  `).join("");

  container.innerHTML = chipsHtml;
  if (window.lucide) lucide.createIcons();
}

function applyOperatorSelection() {
  const targetId = operatorModalTargetInput || "formOperatorName";
  const opInput = document.getElementById(targetId);
  if (!opInput) return;

  const names = Array.from(selectedOperators);
  if (names.length === 0) {
    alert("Lütfen en az bir operatör seçin.");
    return;
  }

  const formatted = names.join(", ");
  opInput.value = formatted;
  if (targetId === "formOperatorName") {
    onOperatorNameInput();
  }
  closeOperatorSelectModal();
}

function onOperatorNameInput() {
  const opInput = document.getElementById("formOperatorName");
  if (opInput) {
    const val = opInput.value.trim().toUpperCase();
    if (val) {
      localStorage.setItem("saved_operator_name", val);
    }
  }
  updatePreviewRow();
}

// ----------------- FORM VE CANLI TABLO ÖNİZLEMESİ -----------------
function updatePreviewRow() {
  const dateInput = document.getElementById("formDateInput");
  const shiftSelect = document.getElementById("formShift");
  const buildingSelect = document.getElementById("formBuilding");
  const lineNoInput = document.getElementById("formLineNo");
  const machineCodeInput = document.getElementById("formMachineCode");
  const descTextarea = document.getElementById("formJobDescription");
  const critSelect = document.getElementById("formCriterionSelect");
  const timeInput = document.getElementById("formTimeSpent");
  const opNameInput = document.getElementById("formOperatorName");
  const tsCheck = document.getElementById("includeTimestampCheck");

  // A - Tarih
  const colA = document.getElementById("previewColA");
  if (colA && dateInput && dateInput.value) {
    const parts = dateInput.value.split("-");
    if (parts.length === 3) {
      colA.innerText = `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
  }

  // B - Vardiya
  const colB = document.getElementById("previewColB");
  if (colB && shiftSelect) {
    colB.innerText = shiftSelect.value || "-";
  }

  // C - Hat / Makine
  const colC = document.getElementById("previewColC");
  if (colC) {
    const bld = buildingSelect ? buildingSelect.value : "HİÇBİRİ";
    const line = lineNoInput ? lineNoInput.value.trim().toUpperCase() : "";
    const mach = machineCodeInput ? machineCodeInput.value.trim().toUpperCase() : "";

    const parts = [];
    if (bld && bld !== "HİÇBİRİ") parts.push(bld);
    if (line) parts.push(line);
    if (mach) parts.push(mach);

    colC.innerText = parts.length > 0 ? parts.join(" - ") : "-";
  }

  // D..W - Yapılan İşlemler
  const colD = document.getElementById("previewColD");
  if (colD) {
    const text = descTextarea ? descTextarea.value.trim() : "";
    if (!text) {
      colD.innerText = "-";
    } else {
      if (tsCheck && tsCheck.checked) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        colD.innerText = `[${hh}:${mm}] ${text}`;
      } else {
        colD.innerText = text;
      }
    }
  }

  // X - Kriter
  const colX = document.getElementById("previewColX");
  if (colX && critSelect) {
    colX.innerText = critSelect.value || "-";
  }

  // Y - Harcanan Süre
  const colY = document.getElementById("previewColY");
  if (colY && timeInput) {
    const val = timeInput.value.trim();
    colY.innerText = val ? `${val} dk` : "- dk";
  }

  // Z - İşi Yapan (Operatör)
  const colZ = document.getElementById("previewColZ");
  if (colZ) {
    const op = opNameInput ? opNameInput.value.trim().toUpperCase() : "";
    colZ.innerText = op || (currentUser ? currentUser.full_name : "-");
  }
}

function clearMaintenanceForm() {
  const buildingSelect = document.getElementById("formBuilding");
  if (buildingSelect) buildingSelect.value = "HİÇBİRİ";

  const lineNoInput = document.getElementById("formLineNo");
  if (lineNoInput) lineNoInput.value = "";

  const machineCodeInput = document.getElementById("formMachineCode");
  if (machineCodeInput) machineCodeInput.value = "";

  const descTextarea = document.getElementById("formJobDescription");
  if (descTextarea) descTextarea.value = "";

  const critSelect = document.getElementById("formCriterionSelect");
  if (critSelect) critSelect.value = "4";

  const timeInput = document.getElementById("formTimeSpent");
  if (timeInput) timeInput.value = "30";

  // Operatör ismini koru
  const savedOp = localStorage.getItem("saved_operator_name") || (currentUser ? currentUser.full_name : "");
  const opInput = document.getElementById("formOperatorName");
  if (opInput && savedOp) {
    opInput.value = savedOp;
  }

  updatePreviewRow();
}

function speakCurrentRow() {
  if (!('speechSynthesis' in window)) {
    alert("Tarayıcınız sesli okuma özelliğini desteklemiyor.");
    return;
  }
  const date = document.getElementById("previewColA")?.innerText || "";
  const shift = document.getElementById("previewColB")?.innerText || "";
  const lineMach = document.getElementById("previewColC")?.innerText || "";
  const desc = document.getElementById("previewColD")?.innerText || "";
  const crit = document.getElementById("previewColX")?.innerText || "";
  const time = document.getElementById("previewColY")?.innerText || "";
  const op = document.getElementById("previewColZ")?.innerText || "";

  const textToRead = `${date}, ${shift} vardiyası, ${lineMach} için kayıt. Kriter: ${crit}. Süre: ${time}. İşi yapan: ${op}. Yapılan işlemler: ${desc}`;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(textToRead);
  utterance.lang = "tr-TR";
  window.speechSynthesis.speak(utterance);
}

function openNewMachineModal() {
  const code = prompt("Yeni Makine Kodu (örn: PRES-02):");
  if (!code) return;
  const name = prompt("Makine Adı (örn: 200 Ton Eksantrik Pres):");
  if (!name) return;
  alert(`Yeni makine (${code.toUpperCase()} - ${name}) için sistem yöneticisine bildirim iletildi.`);
}

function initSpeechRecognition() {}
function initDescSpeechRecognition() {}
function stopDescRecording() {
  const statusDiv = document.getElementById("descRecordingStatus");
  if (statusDiv) statusDiv.classList.add("hidden");
}

// ----------------- YARDIMCI GÜVENLİK METODLARI -----------------
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ================= VARDİYA İŞ AKTARIM FORMU (FR-PE-0658) =================

async function loadHandoverTasks() {
  const dateInput = document.getElementById("handoverDateFilter");
  if (!dateInput) return;
  let dateStr = dateInput.value;
  if (!dateStr) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.value = today;
    dateStr = today;
  }

  try {
    const res = await fetch(`/api/handover/tasks?date_str=${encodeURIComponent(dateStr)}`);
    if (!res.ok) throw new Error("İş aktarım görevleri yüklenemedi");
    const tasks = await res.json();

    // Vardiyalara göre grupla
    const s1 = []; // 08:00 - 16:00
    const s2 = []; // 16:00 - 24:00
    const s3 = []; // 24:00 - 08:00

    tasks.forEach(t => {
      const s = (t.shift || "").replace(/ /g, "").replace(/:/g, ".");
      if (s.includes("08") && s.includes("16")) {
        s1.push(t);
      } else if (s.includes("16") && s.includes("24")) {
        s2.push(t);
      } else {
        s3.push(t);
      }
    });

    renderHandoverShiftList("list-handover-s1", "badge-handover-s1", s1, "08:00 - 16:00");
    renderHandoverShiftList("list-handover-s2", "badge-handover-s2", s2, "16:00 - 24:00");
    renderHandoverShiftList("list-handover-s3", "badge-handover-s3", s3, "24:00 - 08:00");

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error("loadHandoverTasks error:", err);
  }
}

function renderHandoverShiftList(containerId, badgeId, tasks, shiftName) {
  const container = document.getElementById(containerId);
  const badge = document.getElementById(badgeId);
  if (badge) {
    badge.innerText = `${tasks.length} İş`;
  }
  if (!container) return;

  if (tasks.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-xs text-slate-400">Bu vardiyada kayıt bulunmuyor.</div>`;
    return;
  }

  const getStatusBadge = (st) => {
    switch (st) {
      case "Tamamlandı":
        return `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[10px] font-bold border border-emerald-200">✅ Tamamlandı</span>`;
      case "Malzeme Bekleniyor":
        return `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md text-[10px] font-bold border border-amber-200">📦 Malzeme Bekleniyor</span>`;
      case "Sonraki Vardiyaya Devir":
        return `<span class="px-2 py-0.5 bg-purple-100 text-purple-800 rounded-md text-[10px] font-bold border border-purple-200">🔄 Sonraki Vardiyaya Devir</span>`;
      case "İptal":
        return `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-md text-[10px] font-bold border border-rose-200">❌ İptal</span>`;
      default:
        return `<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-bold border border-blue-200">⏳ Devam Ediyor</span>`;
    }
  };

  container.innerHTML = tasks.map(t => `
    <div class="bg-slate-50 hover:bg-slate-100/80 p-3 rounded-xl border border-slate-200/70 transition space-y-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1">
          <p class="text-xs font-semibold text-slate-800 leading-snug">${escapeHtml(t.task_description)}</p>
          ${t.notes ? `<p class="text-[11px] text-slate-500 mt-1 italic"><i data-lucide="info" class="w-3 h-3 inline mr-1 text-slate-400"></i>${escapeHtml(t.notes)}</p>` : ''}
        </div>
        <button type="button" onclick="deleteHandoverTask(${t.id})" class="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition" title="Görevi Sil">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/50">
        <div class="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium">
          <i data-lucide="user" class="w-3.5 h-3.5 text-slate-400"></i>
          <span>${escapeHtml(t.assigned_person)}</span>
        </div>
        <div class="flex items-center gap-2">
          ${getStatusBadge(t.status)}
          <select onchange="updateHandoverStatus(${t.id}, this.value)" class="text-[10px] font-semibold bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-600 focus:outline-none">
            <option value="Devam Ediyor" ${t.status === 'Devam Ediyor' ? 'selected' : ''}>Devam Ediyor</option>
            <option value="Tamamlandı" ${t.status === 'Tamamlandı' ? 'selected' : ''}>Tamamlandı</option>
            <option value="Malzeme Bekleniyor" ${t.status === 'Malzeme Bekleniyor' ? 'selected' : ''}>Malzeme Bekleniyor</option>
            <option value="Sonraki Vardiyaya Devir" ${t.status === 'Sonraki Vardiyaya Devir' ? 'selected' : ''}>Sonraki Vardiyaya Devir</option>
            <option value="İptal" ${t.status === 'İptal' ? 'selected' : ''}>İptal</option>
          </select>
        </div>
      </div>
    </div>
  `).join("");
}

async function handleHandoverSubmit(e) {
  e.preventDefault();
  const dateStr = document.getElementById("handoverDateFilter")?.value || new Date().toISOString().split("T")[0];
  const shift = document.getElementById("handoverShift")?.value;
  const person = document.getElementById("handoverPerson")?.value?.trim();
  const status = document.getElementById("handoverStatus")?.value;
  const taskDesc = document.getElementById("handoverTaskDesc")?.value?.trim();
  const notes = document.getElementById("handoverNotes")?.value?.trim() || null;

  if (!taskDesc || !person) {
    alert("Lütfen yapılacak işi ve sorumlu kişiyi doldurun.");
    return;
  }

  const btn = document.getElementById("btnSubmitHandover");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/handover/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date_str: dateStr,
        shift: shift,
        assigned_person: person,
        status: status,
        task_description: taskDesc,
        notes: notes
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Kayıt eklenemedi");
    }

    document.getElementById("handoverTaskDesc").value = "";
    document.getElementById("handoverNotes").value = "";

    await loadHandoverTasks();
    if (window.showToast) {
      showToast("İş aktarımı başarıyla kaydedildi!", "success");
    } else {
      alert("İş aktarımı başarıyla kaydedildi!");
    }
  } catch (err) {
    alert("Hata: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updateHandoverStatus(taskId, newStatus) {
  try {
    const res = await fetch(`/api/handover/${taskId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error("Durum güncellenemedi");
    await loadHandoverTasks();
  } catch (err) {
    alert("Hata: " + err.message);
  }
}

async function deleteHandoverTask(taskId) {
  if (!confirm("Bu iş aktarım kaydını silmek istediğinize emin misiniz?")) return;
  try {
    const res = await fetch(`/api/handover/${taskId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Görev silinemedi");
    await loadHandoverTasks();
  } catch (err) {
    alert("Hata: " + err.message);
  }
}

function downloadHandoverExcel() {
  const dateInput = document.getElementById("handoverDateFilter");
  const dateStr = dateInput?.value || new Date().toISOString().split("T")[0];
  window.location.href = `/api/handover/export?date_str=${encodeURIComponent(dateStr)}`;
}

// ESC tuşu ile açık tüm modalları kapatma
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (typeof closeVoiceDictationModal === "function") closeVoiceDictationModal();
    if (typeof closeOperatorSelectModal === "function") closeOperatorSelectModal();
    if (typeof closeCriteriaModal === "function") closeCriteriaModal();
    if (typeof closeAdminUsersModal === "function") closeAdminUsersModal();
  }
});
