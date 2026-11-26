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

  // 45 dk hareketsizlik takibini başlat (adminler hariç)
  initInactivityTracker();

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

let userManuallyChangedShift = false;

function formatDateToIso(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getShiftValueByTime(dateObj = new Date()) {
  const mins = dateObj.getHours() * 60 + dateObj.getMinutes();
  // 08:15 (495 dk) ile 16:15 (975 dk) arası -> 08.00-16.00 (1. Vardiya)
  if (mins >= 495 && mins < 975) {
    return "08.00-16.00";
  }
  // 16:15 (975 dk) ile 00:15 (15 dk) arası -> 16.00-24.00 (2. Vardiya)
  else if (mins >= 975 || mins < 15) {
    return "16.00-24.00";
  }
  // 00:15 (15 dk) ile 08:15 (495 dk) arası -> 24.00 - 08.00 (3. Vardiya)
  else {
    return "24.00 - 08.00";
  }
}

function getHandoverShiftValueByTime(dateObj = new Date()) {
  const mins = dateObj.getHours() * 60 + dateObj.getMinutes();
  if (mins >= 495 && mins < 975) {
    return "08:00 - 16:00";
  } else if (mins >= 975 || mins < 15) {
    return "16:00 - 24:00";
  } else {
    return "24:00 - 08:00";
  }
}

function getDorukShiftValueByTime(dateObj = new Date()) {
  const mins = dateObj.getHours() * 60 + dateObj.getMinutes();
  if (mins >= 495 && mins < 975) {
    return "08:00-16:00";
  } else if (mins >= 975 || mins < 15) {
    return "16:00-24:00";
  } else {
    return "24:00-08:00";
  }
}

function syncHandoverShiftToCurrentTime(dateObj = new Date()) {
  const handoverShiftSelect = document.getElementById("handoverShift");
  if (handoverShiftSelect) {
    handoverShiftSelect.value = getHandoverShiftValueByTime(dateObj);
  }
}

function autoSyncShiftWithCurrentTime(force = false) {
  const now = new Date();
  if (!userManuallyChangedShift || force) {
    const shiftSelect = document.getElementById("formShift");
    const targetShift = getShiftValueByTime(now);
    if (shiftSelect && shiftSelect.value !== targetShift) {
      shiftSelect.value = targetShift;
      updatePreviewRow();
    }
  }

  syncHandoverShiftToCurrentTime(now);

  const dorukShift = document.getElementById("dorukFormShift");
  if (dorukShift) {
    dorukShift.value = getDorukShiftValueByTime(now);
  }
}

// Sayfa arka planda açık kalsa bile vardiya devir saatlerinde (08:15, 16:15, 00:15) otomatik geçiş sağla
setInterval(() => {
  autoSyncShiftWithCurrentTime(false);
}, 15000);

function initDateAndShift() {
  const now = new Date();
  setFormDate(now);

  autoSyncShiftWithCurrentTime(true);

  const shiftSelect = document.getElementById("formShift");
  if (shiftSelect && !shiftSelect.hasAttribute("data-shift-listener")) {
    shiftSelect.setAttribute("data-shift-listener", "true");
    shiftSelect.addEventListener("change", () => {
      userManuallyChangedShift = true;
    });
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
  if (dateInput) {
    loadServerExcelStatus(dateInput.value);
    loadRecentLogs(dateInput.value);
  }
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
  loadRecentLogs(dateInput.value);
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
    syncHandoverShiftToCurrentTime();
    loadHandoverTasks();
  }

  if (window.lucide) lucide.createIcons();
}

// ----------------- SESLİ DİKTE MODALI (MİKROFON PENCERESİ) -----------------
let modalSpeechRecognizer = null;
let isModalRecording = false;
let userWantsModalRecording = false;
let modalRestartTimer = null;
let modalFinalTranscript = "";
let voiceModalOpenedAt = 0;

function isMobileBrowser() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
}

function openVoiceDictationModal(e, keepCustomTarget = false) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!keepCustomTarget) {
    dorukSpeechTarget = null;
    handoverSpeechTarget = null;
  }
  const modal = document.getElementById("voiceDictationModal");
  if (!modal) return;

  voiceModalOpenedAt = Date.now();
  const currentDesc = document.getElementById("formJobDescription")?.value?.trim() || "";
  const output = document.getElementById("modalDictationOutput");
  if (output && !keepCustomTarget) output.value = currentDesc;

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
  modalFinalTranscript = output.value;
}

let dorukSpeechTarget = null;
let handoverSpeechTarget = null;

function openVoiceDictationModalForDoruk() {
  dorukSpeechTarget = document.getElementById("dorukFormDescription");
  handoverSpeechTarget = null;
  openVoiceDictationModal(null, true);
  const output = document.getElementById("modalDictationOutput");
  if (output && dorukSpeechTarget) {
    output.value = dorukSpeechTarget.value || "";
  }
}

function openVoiceDictationForHandover() {
  handoverSpeechTarget = document.getElementById("handoverTaskDesc");
  dorukSpeechTarget = null;
  openVoiceDictationModal(null, true);
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

function focusKeyboardDictation() {
  stopModalDictation();
  const output = document.getElementById("modalDictationOutput");
  if (output) {
    output.focus();
    const len = output.value.length;
    try { output.setSelectionRange(len, len); } catch (e) {}
  }
  const alertBox = document.getElementById("modalMicAlert");
  if (alertBox) {
    if (isMobileBrowser()) {
      alertBox.innerHTML = "📱 <b>TELEFON KLAVYESİ HAZIR!</b><br>Açılan telefon klavyenizin sağ üst / alt kısmındaki <b>🎙️ Mikrofon</b> simgesine dokunarak doğrudan konuşabilirsiniz (Tüm telefonlarda %100 kesintisiz çalışır).";
    } else {
      alertBox.innerHTML = "💻 <b>METİN KUTUSU SEÇİLDİ!</b><br>Şimdi klavyenizden <b>Windows Tuşu + H</b> (<b>Win + H</b>) tuşlarına basarak konuşmaya başlayabilirsiniz.";
    }
    alertBox.className = "p-3 rounded-xl text-xs bg-blue-50 border border-blue-200 text-blue-900 font-medium leading-relaxed block";
    alertBox.classList.remove("hidden");
  }
}

function activateWindowsDictation() {
  focusKeyboardDictation();
}

async function toggleModalDictation() {
  const alertBox = document.getElementById("modalMicAlert");

  if (userWantsModalRecording || isModalRecording) {
    stopModalDictation();
    return;
  }

  // HTTP (güvensiz bağlantı) kontrolü: Mobil tarayıcılar HTTPS olmadan mikrofon açmaz
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    if (alertBox) {
      const httpsUrl = `https://18.156.97.64.sslip.io${location.pathname}${location.search}`;
      alertBox.innerHTML = `🔒 <b>GÜVENLİ BAĞLANTI (HTTPS) GEREKLİ:</b><br>Telefon ve tarayıcılar güvenlik gereği yalnızca <b>https://</b> adresinde mikrofon izni verir.<br>👉 <a href="${httpsUrl}" class="underline font-bold text-blue-700"> Güvenli Adrese (HTTPS) Geçmek İçin Tıklayın</a><br><br>💡 <b>Veya Hemen Şimdi:</b> Metin kutusuna dokunup telefon klavyenizdeki <b>🎙️ Mikrofon</b> tuşuyla konuşabilirsiniz.`;
      alertBox.className = "p-3 rounded-xl text-xs bg-amber-50 border border-amber-200 text-amber-900 font-medium leading-relaxed block";
      alertBox.classList.remove("hidden");
    }
    const output = document.getElementById("modalDictationOutput");
    if (output) output.focus();
    return;
  }

  const SpeechRecognition = getSpeechRecognitionClass();
  if (!SpeechRecognition) {
    focusKeyboardDictation();
    return;
  }

  const output = document.getElementById("modalDictationOutput");
  modalFinalTranscript = output ? output.value.trim() : "";
  userWantsModalRecording = true;

  updateModalDictationUI(true);
  if (alertBox) {
    alertBox.innerHTML = "";
    alertBox.classList.add("hidden");
  }

  startModalRecognitionSession();
}

function startModalRecognitionSession() {
  if (!userWantsModalRecording) return;
  const SpeechRecognition = getSpeechRecognitionClass();
  if (!SpeechRecognition) return;

  const mobile = isMobileBrowser();
  const output = document.getElementById("modalDictationOutput");

  try {
    const recognizer = new SpeechRecognition();
    modalSpeechRecognizer = recognizer;
    // Mobil tarayıcılarda continuous=true kelime tekrarına ve kilitlenmeye yol açar;
    // mobilde continuous=false + otomatik yeniden başlatma en kararlı yöntemdir.
    recognizer.continuous = !mobile;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;
    recognizer.lang = "tr-TR";

    recognizer.onstart = () => {
      if (!userWantsModalRecording) {
        try { recognizer.stop(); } catch (e) {}
        return;
      }
      isModalRecording = true;
      updateModalDictationUI(true);
    };

    recognizer.onresult = (event) => {
      let sessionInterim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const res = event.results[i];
        const chunk = (res[0]?.transcript || "").trim();
        if (!chunk) continue;

        if (res.isFinal) {
          const upperChunk = chunk.toUpperCase();
          // Android Chrome bazen aynı final cümleyi üst üste gönderir; tekrarı önle
          if (!modalFinalTranscript.endsWith(upperChunk)) {
            modalFinalTranscript = modalFinalTranscript
              ? `${modalFinalTranscript} ${upperChunk}`
              : upperChunk;
          }
        } else {
          sessionInterim += chunk + " ";
        }
      }

      if (output) {
        const combined = [modalFinalTranscript, sessionInterim.trim().toUpperCase()]
          .filter(Boolean)
          .join(" ");
        output.value = combined;
      }
    };

    recognizer.onerror = (event) => {
      console.warn("Modal speech recognition error:", event.error);
      const alertBox = document.getElementById("modalMicAlert");

      // Konuşma arası sessizlik (no-speech) veya kullanıcı durdurması (aborted) kaydı kesmesin
      if (event.error === "no-speech") {
        const sub = document.getElementById("modalMicSubStatus");
        if (sub && userWantsModalRecording) {
          sub.innerText = "🎙️ Dinlemeye devam ediliyor, konuşabilirsiniz...";
        }
        return;
      }
      if (event.error === "aborted") {
        return;
      }

      // Kalıcı hatalarda kaydı durdur ve kullanıcıya net çözüm göster
      stopModalDictation();
      if (!alertBox) return;

      let errorHtml = "";
      if (event.error === "not-allowed" || event.error === "permission-denied" || event.error === "service-not-allowed") {
        errorHtml = isMobileBrowser()
          ? "❌ <b>MİKROFON İZNİ ENGELİ:</b><br>Tarayıcıda adres çubuğunun solundaki <b>Kilit / Site Ayarları</b> simgesinden <b>Mikrofon -> İzin Ver</b> yapınız.<br><br>👉 <b>En Pratik Çözüm:</b> Aşağıdaki metin kutusuna dokunup <b>telefon klavyenizin kendi 🎙️ Mikrofon tuşuna</b> basarak hemen konuşabilirsiniz."
          : "❌ <b>MİKROFON İZNİ GEREKİYOR:</b><br>Adres çubuğunun solundaki <b>Kilit / Site Ayarları</b> simgesine tıklayıp <b>Mikrofon</b> iznini <b>İzin Ver</b> yapınız.<br><br>💡 Alternatif: <b>⌨️ Klavye Mikrofonuyla Yaz</b> butonuna tıklayıp <b>Win + H</b> tuşlarını kullanabilirsiniz.";
      } else if (event.error === "network") {
        errorHtml = "⚠️ <b>AĞ / SUNUCU BAĞLANTI ENGELİ:</b><br>Tarayıcı ses sunucusuna erişemedi.<br><br>👉 <b>Hemen Çözüm:</b> <b>[⌨️ Klavye Mikrofonuyla Yaz]</b> butonuna dokunup telefon klavyenizdeki mikrofonu veya bilgisayarda <b>Win + H</b> tuşlarını kullanabilirsiniz.";
      } else if (event.error === "audio-capture") {
        errorHtml = "⚠️ <b>MİKROFON BULUNAMADI VEYA BAŞKA UYGULAMA KULLANIYOR:</b><br>Mikrofonunuzun takılı olduğundan emin olun veya <b>[⌨️ Klavye Mikrofonuyla Yaz]</b> butonunu kullanın.";
      } else {
        errorHtml = `⚠️ <b>Ses Tanıma Uyarısı (${event.error}):</b><br><b>[⌨️ Klavye Mikrofonuyla Yaz]</b> butonuna dokunarak telefon klavyesi mikrofonu veya <b>Win + H</b> ile sorunsuz dikte yapabilirsiniz.`;
      }

      alertBox.innerHTML = errorHtml;
      alertBox.className = "p-3 rounded-xl text-xs bg-amber-50 border border-amber-200 text-amber-900 font-medium leading-relaxed block";
      alertBox.classList.remove("hidden");
    };

    recognizer.onend = () => {
      // Kullanıcı durdurmadıysa (ör. nefes arası veya mobilde cümle sonu), otomatik devam et
      if (userWantsModalRecording) {
        if (modalRestartTimer) clearTimeout(modalRestartTimer);
        modalRestartTimer = setTimeout(() => {
          if (userWantsModalRecording) {
            startModalRecognitionSession();
          }
        }, mobile ? 250 : 120);
      } else {
        isModalRecording = false;
        updateModalDictationUI(false);
      }
    };

    recognizer.start();
  } catch (err) {
    console.error("Modal speech start error:", err);
    stopModalDictation();
    const alertBox = document.getElementById("modalMicAlert");
    if (alertBox) {
      alertBox.innerHTML = `⚠️ <b>Sesli Dikte Başlatılamadı:</b><br>👉 <b>[⌨️ Klavye Mikrofonuyla Yaz]</b> butonuna tıklayarak telefon klavyenizin mikrofonunu veya bilgisayarda <b>Win + H</b> tuşlarını kullanabilirsiniz.`;
      alertBox.className = "p-3 rounded-xl text-xs bg-amber-50 border border-amber-200 text-amber-900 font-medium leading-relaxed block";
      alertBox.classList.remove("hidden");
    }
  }
}

function stopModalDictation() {
  userWantsModalRecording = false;
  isModalRecording = false;
  if (modalRestartTimer) {
    clearTimeout(modalRestartTimer);
    modalRestartTimer = null;
  }
  updateModalDictationUI(false);
  if (modalSpeechRecognizer) {
    const rec = modalSpeechRecognizer;
    modalSpeechRecognizer = null;
    try { rec.onend = null; rec.stop(); } catch (e) {}
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
  btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Kayıt Ediliyor...</span>`;
  if (window.lucide) lucide.createIcons();

  const parts = [];
  if (building && building !== "HİÇBİRİ") parts.push(building);
  if (lineNo) parts.push(lineNo);
  if (machineCode) parts.push(machineCode);
  const combinedLineMach = parts.length > 0 ? parts.join(" - ") : (building !== "HİÇBİRİ" ? building : "GENEL");

  const dateVal = document.getElementById("formDateInput")?.value || "";
  const nowObj = new Date();
  const clientTime = `${String(nowObj.getHours()).padStart(2, "0")}:${String(nowObj.getMinutes()).padStart(2, "0")}`;

  // Kullanıcı vardiyayı elle değiştirmediyse, güncel saate göre vardiyayı kesinleştir
  if (!userManuallyChangedShift) {
    autoSyncShiftWithCurrentTime(true);
  }
  const effectiveShift = document.getElementById("formShift")?.value || getShiftValueByTime(nowObj);

  const payload = {
    area_line: combinedLineMach,
    building: building,
    line_no: lineNo,
    machine_code: machineCode,
    job_description: jobDesc,
    criterion_no: critNo,
    time_spent_minutes: timeSpent,
    operator_name: operatorName,
    shift: effectiveShift,
    shift_manually_selected: userManuallyChangedShift,
    date_str: dateVal,
    client_time: clientTime,
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
      alert(`✅ BAŞARIYLA KAYDEDİLDİ!\n\n📁 Dosya: ${data.file_name}\n📄 Sayfa: ${data.sheet_name}\n📍 Satır: ${data.row}\n⏰ Saat: ${data.timestamp}\n\nKayıt güncel Excel dosyasına işlendi.`);
      
      // Formu temizle ve yeni satıra hazırla (bina, hat no, makine kodu, kriter vb. defaulta döner)
      clearMaintenanceForm();
      
      // Sunucu tablosunu ve kayıtları güncelle
      loadServerExcelStatus(dateVal);
      loadRecentLogs(dateVal);
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
      shiftNumber: 1,
      shiftName: "1. Vardiya (08:15 - 16:15)",
      cutoffTimeStr: "08:15",
      cutoffMinutes: 495,
      sheetKey: "08.00",
      nextCutoffStr: "16:15"
    };
  } else if (currentMinutes >= 975) {
    return {
      shiftNumber: 2,
      shiftName: "2. Vardiya (16:15 - 00:15)",
      cutoffTimeStr: "16:15",
      cutoffMinutes: 975,
      sheetKey: "16.00",
      nextCutoffStr: "00:15"
    };
  } else if (currentMinutes >= 15 && currentMinutes < 495) {
    return {
      shiftNumber: 3,
      shiftName: "3. Vardiya (00:15 - 08:15)",
      cutoffTimeStr: "00:15",
      cutoffMinutes: 15,
      sheetKey: "24.00",
      nextCutoffStr: "08:15"
    };
  } else {
    // 00:00 - 00:15 arası
    return {
      shiftNumber: 2,
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

  // Sayfa kontrolü: Sayfa adı ile aktif vardiya eşleşmesi
  const sheet = (record.sheet || "").trim();
  if (shiftInfo.shiftNumber === 1 && !sheet.startsWith("08")) return false;
  if (shiftInfo.shiftNumber === 2 && !sheet.startsWith("16")) return false;
  if (shiftInfo.shiftNumber === 3 && !(sheet.startsWith("24") || sheet.startsWith("00"))) return false;

  // Saat kontrolü
  let recMinutes = null;
  const timeStr = record.time_str || (record.description ? (record.description.match(/\[(\d{1,2}:\d{2})\]/) || [])[1] : null);
  if (timeStr) {
    const parts = timeStr.split(":");
    if (parts.length === 2) {
      recMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
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

function downloadCurrentDateHandoverExcel() {
  const dateVal = document.getElementById("formDateInput")?.value || formatDateToIso(new Date());
  window.open(`/api/handover/export?date_str=${encodeURIComponent(dateVal)}`, "_blank");
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
let showAllRecentLogs = false;

async function loadRecentLogs(dateStr = null, toggleShowAll = null) {
  try {
    if (toggleShowAll !== null) {
      showAllRecentLogs = toggleShowAll;
    }

    const dateInput = document.getElementById("formDateInput");
    const selectedDate = dateStr || dateInput?.value || formatDateToIso(new Date());
    const now = new Date();
    const todayIso = formatDateToIso(now);
    const isToday = selectedDate === todayIso;

    // Başlık güncelleme
    const titleEl = document.getElementById("recentLogsTitle");
    if (titleEl) {
      if (showAllRecentLogs) {
        titleEl.innerText = "Son Girilen Bakım Kayıtları (Tümü)";
      } else if (isToday) {
        titleEl.innerText = "Bugün Girilen Bakım Kayıtları";
      } else {
        const parts = selectedDate.split("-");
        const formattedDate = parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : selectedDate;
        titleEl.innerText = `${formattedDate} Tarihinde Girilen Bakım Kayıtları`;
      }
    }

    let url = "/api/logs?limit=50";
    if (!showAllRecentLogs && selectedDate) {
      url += `&date_str=${encodeURIComponent(selectedDate)}`;
    }

    const res = await fetch(url);
    if (!res.ok) return;
    const logs = await res.json();
    const container = document.getElementById("recentLogsList");
    if (!container) return;

    if (logs.length === 0) {
      if (!showAllRecentLogs) {
        const dateLabel = isToday ? "Bugün" : `${selectedDate} tarihinde`;
        container.innerHTML = `
          <div class="py-6 text-center text-slate-400">
            <p class="font-semibold text-slate-600">${dateLabel} henüz bakım kaydı girilmedi.</p>
            <p class="text-[11px] text-slate-400 mt-1">Yeni bir arıza veya bakım kaydettiğinizde burada listelenecektir.</p>
            <button type="button" onclick="loadRecentLogs(null, true)" class="mt-2.5 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold">
              Tüm geçmiş kayıtları göster
            </button>
          </div>
        `;
      } else {
        container.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Henüz arıza kaydı bulunmuyor.</p>`;
      }
      if (window.lucide) lucide.createIcons();
      return;
    }

    const toggleBtnHtml = !showAllRecentLogs
      ? `<div class="pt-3 text-right"><button type="button" onclick="loadRecentLogs(null, true)" class="text-xs text-blue-600 hover:underline font-semibold">Tüm geçmiş kayıtları göster (${logs.length} adet gösteriliyor)</button></div>`
      : `<div class="pt-3 text-right"><button type="button" onclick="loadRecentLogs(null, false)" class="text-xs text-blue-600 hover:underline font-semibold">Sadece ${isToday ? 'bugünü' : selectedDate + ' tarihini'} göster</button></div>`;

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
            <span>🔧 Parça: ${l.parts_replaced || '-'}</span>
            <span>👤 ${l.user_name || '-'}</span>
            <span>📅 ${l.date_str}</span>
            ${l.shift ? `<span>🕒 ${l.shift}</span>` : ""}
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
    `).join("") + toggleBtnHtml;

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

    // Chatbot dropdown'unu güncelle
    const chatSelect = document.getElementById("chatTargetMachine");
    const optionsHtml = '<option value="">Tüm Makineler</option>' + allMachines.map(m => `
      <option value="${escapeHtml(m.code)}">${escapeHtml(m.code)} - ${escapeHtml(m.name)}</option>
    `).join("");

    if (chatSelect) chatSelect.innerHTML = optionsHtml;

    // Excel İndirme Merkezi FR-PE-0006 makine seçicisini güncelle
    const frPeSelect = document.getElementById("excelFrPe0006MachineSelect");
    if (frPeSelect) {
      const prevVal = frPeSelect.value;
      frPeSelect.innerHTML = '<option value="">-- Makine Seçin --</option>' + allMachines.map(m => `
        <option value="${escapeHtml(m.code)}">${escapeHtml(m.code)} - ${escapeHtml(m.name)} (${escapeHtml(m.department || '')})</option>
      `).join("");
      if (prevVal) frPeSelect.value = prevVal;
    }
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
                  </div>
                  <h4 class="text-xs font-bold text-slate-900 leading-snug group-hover:text-blue-600 transition" title="${m.name}">
                    ${m.name}
                  </h4>
                  <p class="text-[10px] text-slate-500 mt-0.5 truncate">${m.model || '-'}</p>
                </div>

                <div class="pt-2.5 border-t border-slate-200 mt-2.5">
                  <div class="flex items-center gap-1.5">
                    <button type="button" data-machine-code="${escapeHtml(m.code)}" onclick="openMachineFolder(this.dataset.machineCode)" class="flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition shadow-2xs active:scale-95">
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
let activeFolderMachineCode = null;
let activeFolderMachineInfo = null;
let activeScheduleRows = [];
let editingScheduleRowId = null;
let isAddingScheduleRow = false;

async function openMachineFolder(machineCode) {
  try {
    activeFolderMachineCode = machineCode;
    const res = await fetch(`/api/machines/${encodeURIComponent(machineCode)}/folder`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.machine) {
      alert(`Klasör açılamadı: ${data.detail || res.statusText || "Sunucu hatası"}`);
      return;
    }

    activeFolderMachineInfo = data.machine;
    activeScheduleRows = data.maintenance_rows || [];

    document.getElementById("modalMachineCode").innerText = data.machine.code;
    document.getElementById("modalMachineName").innerText = `${data.machine.name} (${data.machine.department} - ${data.machine.line})`;

    const downtimeEl = document.getElementById("modalTotalDowntime");
    if (downtimeEl) downtimeEl.innerText = `${data.machine.total_downtime} dk`;
    const intEl = document.getElementById("modalInterventionCount");
    if (intEl) intEl.innerText = data.total_interventions;

    const periodicBadge = document.getElementById("modalPeriodicCount");
    if (periodicBadge) periodicBadge.innerText = `${data.periodic_count || 0} kayıt`;
    const tcfBadge = document.getElementById("modalTcfCount");
    if (tcfBadge) tcfBadge.innerText = `${data.tcf_count || 0} kayıt`;
    const scheduleBadge = document.getElementById("modalScheduleRowCount");
    if (scheduleBadge) {
      scheduleBadge.innerText = `${activeScheduleRows.length} satır`;
    }

    const btnAddSub = document.getElementById("btnAddMachineSubfolder");
    if (btnAddSub) {
      if (canManageMachineFolders(currentUser)) {
        btnAddSub.classList.remove("hidden");
      } else {
        btnAddSub.classList.add("hidden");
      }
    }
    toggleMachineSubfolderForm(false);

    // Alt klasörleri listele
    const subList = document.getElementById("modalMachineSubfoldersList");
    if (subList) {
      const subfolders = data.subfolders || [];
      if (subfolders.length === 0) {
        subList.innerHTML = `<div class="col-span-full text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-3 text-center">Bu makine dosyasına henüz ek klasör tanımlanmamış.</div>`;
      } else {
        subList.innerHTML = subfolders.map(sf => `
          <div onclick="openMachineScheduleModal()" class="cursor-pointer bg-blue-50/50 hover:bg-blue-50 p-3 rounded-xl border border-blue-200/80 hover:border-blue-400 flex items-start justify-between gap-2 transition">
            <div class="flex items-start gap-2.5 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <i data-lucide="folder" class="w-4 h-4"></i>
              </div>
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-900 truncate">${escapeHtml(sf.folder_name)}</p>
                ${sf.description ? `<p class="text-[11px] text-slate-600 mt-0.5 break-words">${escapeHtml(sf.description)}</p>` : ''}
                <p class="text-[10px] text-slate-400 mt-1">👤 ${escapeHtml(sf.created_by)} • ${escapeHtml(sf.created_at)}</p>
              </div>
            </div>
            ${canManageMachineFolders(currentUser) ? `
              <button type="button" onclick="event.stopPropagation(); deleteMachineSubfolder(${sf.id})" class="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition shrink-0" title="Klasörü Sil">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
        `).join("");
      }
    }

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
    alert("Klasör detayı açılamadı: " + (e?.message || e));
  }
}

function toggleMachineSubfolderForm(forceState) {
  const form = document.getElementById("machineSubfolderForm");
  if (!form) return;
  const show = typeof forceState === "boolean" ? forceState : form.classList.contains("hidden");
  if (show) {
    form.classList.remove("hidden");
    document.getElementById("subfolderNameInput")?.focus();
  } else {
    form.classList.add("hidden");
    const nameIn = document.getElementById("subfolderNameInput");
    const descIn = document.getElementById("subfolderDescInput");
    if (nameIn) nameIn.value = "";
    if (descIn) descIn.value = "";
  }
}

async function submitMachineSubfolder(event) {
  event.preventDefault();
  if (!activeFolderMachineCode) return;
  const folderName = document.getElementById("subfolderNameInput")?.value.trim() || "";
  const description = document.getElementById("subfolderDescInput")?.value.trim() || "";
  if (!folderName) return;

  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/subfolders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_name: folderName, description: description || null })
    });
    if (res.ok) {
      toggleMachineSubfolderForm(false);
      await openMachineFolder(activeFolderMachineCode);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Klasör eklenemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

async function deleteMachineSubfolder(folderId) {
  if (!activeFolderMachineCode) return;
  if (!confirm("Bu klasörü silmek istediğinize emin misiniz?")) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/subfolders/${folderId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      await openMachineFolder(activeFolderMachineCode);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Klasör silinemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

function closeMachineFolderModal() {
  document.getElementById("machineFolderModal").classList.add("hidden");
  closeMachineScheduleModal();
  closeMachinePeriodicModal();
  closeMachineTcfModal();
}

// ----------------- PERİYODİK KONTROL MODALI -----------------
async function openMachinePeriodicModal() {
  if (!activeFolderMachineCode) return;
  if (!Array.isArray(allUsers) || allUsers.length === 0) {
    try { await loadUsers(); } catch (e) {}
  }

  const labelEl = document.getElementById("periodicMachineLabel");
  if (labelEl) {
    labelEl.innerText = activeFolderMachineInfo
      ? `${activeFolderMachineInfo.code} - ${activeFolderMachineInfo.name}`
      : activeFolderMachineCode;
  }

  const dateIn = document.getElementById("periodicDateInput");
  if (dateIn) dateIn.value = getTodayTrDateDot();
  const opSel = document.getElementById("periodicOperatorInput");
  if (opSel) opSel.innerHTML = buildScheduleOperatorOptions(currentUser?.full_name || "");

  document.getElementById("machinePeriodicModal").classList.remove("hidden");
  await refreshMachinePeriodicChecks();
}

function closeMachinePeriodicModal() {
  const modal = document.getElementById("machinePeriodicModal");
  if (modal) modal.classList.add("hidden");
}

async function refreshMachinePeriodicChecks() {
  if (!activeFolderMachineCode) return;
  const tbody = document.getElementById("machinePeriodicTableBody");
  if (!tbody) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/periodic-checks`);
    const rows = res.ok ? await res.json() : [];
    const badge = document.getElementById("modalPeriodicCount");
    if (badge) badge.innerText = `${rows.length} kayıt`;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">Henüz periyodik kontrol kaydı girilmemiş.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => `
        <tr class="hover:bg-slate-50">
          <td class="p-2.5 text-center font-semibold text-slate-800 whitespace-nowrap">${escapeHtml(r.date_str)}</td>
          <td class="p-2.5 text-center"><span class="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded font-bold text-[10px]">${escapeHtml(r.check_type)}</span></td>
          <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded font-bold text-[10px] ${r.status === 'UYGUN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${escapeHtml(r.status)}</span></td>
          <td class="p-2.5 text-slate-700 break-words">${escapeHtml(r.notes || '-')}</td>
          <td class="p-2.5 text-center text-slate-700">${escapeHtml(r.operator_name || '-')}</td>
          <td class="p-2.5 text-center">
            <button type="button" onclick="deleteMachinePeriodicCheck(${r.id})" class="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition" title="Sil">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </td>
        </tr>
      `).join("");
    }
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error("Periyodik kontroller yüklenemedi:", e);
  }
}

async function submitMachinePeriodicCheck(event) {
  event.preventDefault();
  if (!activeFolderMachineCode) return;
  const payload = {
    date_str: document.getElementById("periodicDateInput")?.value.trim() || getTodayTrDateDot(),
    check_type: document.getElementById("periodicTypeInput")?.value || "GÜNLÜK",
    status: document.getElementById("periodicStatusInput")?.value || "UYGUN",
    operator_name: document.getElementById("periodicOperatorInput")?.value || "",
    notes: document.getElementById("periodicNotesInput")?.value.trim() || ""
  };
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/periodic-checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const notesEl = document.getElementById("periodicNotesInput");
      if (notesEl) notesEl.value = "";
      await refreshMachinePeriodicChecks();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Kayıt eklenemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

async function deleteMachinePeriodicCheck(checkId) {
  if (!activeFolderMachineCode) return;
  if (!confirm("Bu periyodik kontrol kaydını silmek istediğinize emin misiniz?")) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/periodic-checks/${checkId}`, {
      method: "DELETE"
    });
    if (res.ok) await refreshMachinePeriodicChecks();
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

// ----------------- TCF MODALI -----------------
async function openMachineTcfModal() {
  if (!activeFolderMachineCode) return;
  const labelEl = document.getElementById("tcfMachineLabel");
  if (labelEl) {
    labelEl.innerText = activeFolderMachineInfo
      ? `${activeFolderMachineInfo.code} - ${activeFolderMachineInfo.name}`
      : activeFolderMachineCode;
  }
  document.getElementById("machineTcfModal").classList.remove("hidden");
  await refreshMachineTcfRecords();
}

function closeMachineTcfModal() {
  const modal = document.getElementById("machineTcfModal");
  if (modal) modal.classList.add("hidden");
}

async function refreshMachineTcfRecords() {
  if (!activeFolderMachineCode) return;
  const tbody = document.getElementById("machineTcfTableBody");
  if (!tbody) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/tcf`);
    const rows = res.ok ? await res.json() : [];
    const badge = document.getElementById("modalTcfCount");
    if (badge) badge.innerText = `${rows.length} kayıt`;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">Henüz TCF kaydı eklenmemiş.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => `
        <tr class="hover:bg-slate-50">
          <td class="p-2.5 text-center font-bold text-purple-700 whitespace-nowrap">${escapeHtml(r.doc_no || '-')}</td>
          <td class="p-2.5 font-semibold text-slate-900">${escapeHtml(r.title)}</td>
          <td class="p-2.5 text-center text-slate-600">${escapeHtml(r.revision || '-')}</td>
          <td class="p-2.5 text-slate-700 break-words">${escapeHtml(r.notes || '-')}</td>
          <td class="p-2.5 text-center text-slate-600">${escapeHtml(r.created_by || '-')}</td>
          <td class="p-2.5 text-center">
            <button type="button" onclick="deleteMachineTcfRecord(${r.id})" class="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition" title="Sil">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </td>
        </tr>
      `).join("");
    }
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error("TCF kayıtları yüklenemedi:", e);
  }
}

async function submitMachineTcfRecord(event) {
  event.preventDefault();
  if (!activeFolderMachineCode) return;
  const payload = {
    doc_no: document.getElementById("tcfDocNoInput")?.value.trim() || "",
    title: document.getElementById("tcfTitleInput")?.value.trim() || "",
    revision: document.getElementById("tcfRevisionInput")?.value.trim() || "",
    notes: document.getElementById("tcfNotesInput")?.value.trim() || ""
  };
  if (!payload.title) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/tcf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      ["tcfDocNoInput", "tcfTitleInput", "tcfRevisionInput", "tcfNotesInput"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      await refreshMachineTcfRecords();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "TCF kaydı eklenemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

async function deleteMachineTcfRecord(recordId) {
  if (!activeFolderMachineCode) return;
  if (!confirm("Bu TCF kaydını silmek istediğinize emin misiniz?")) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/tcf/${recordId}`, {
      method: "DELETE"
    });
    if (res.ok) await refreshMachineTcfRecords();
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

// ----------------- FR-PE-0006 MAKİNA VE TEÇHİZAT ARIZA, BAKIM ÇİZELGESİ -----------------
function getTodayTrDateDot() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

async function openMachineScheduleModal() {
  if (!activeFolderMachineCode) return;
  editingScheduleRowId = null;
  isAddingScheduleRow = false;

  if (!Array.isArray(allUsers) || allUsers.length === 0) {
    try {
      await loadUsers();
    } catch (e) {
      console.warn("Kullanıcı listesi yüklenemedi:", e);
    }
  }

  const labelEl = document.getElementById("scheduleMachineLabel");
  if (labelEl) {
    labelEl.innerText = activeFolderMachineInfo
      ? `${activeFolderMachineInfo.code} - ${activeFolderMachineInfo.name}`
      : activeFolderMachineCode;
  }

  document.getElementById("machineScheduleModal").classList.remove("hidden");
  await refreshMachineScheduleRows();
}

function buildScheduleOperatorOptions(selectedValue = "") {
  const cleanSelected = (selectedValue || "").trim();
  const activeNames = (allUsers || [])
    .filter(u => u && u.is_active !== false && u.full_name)
    .map(u => String(u.full_name).trim());

  const uniqueNames = Array.from(new Set(activeNames));
  if (cleanSelected && !uniqueNames.includes(cleanSelected)) {
    uniqueNames.unshift(cleanSelected);
  }

  let options = `<option value="">-- Personel Seçin --</option>`;
  options += uniqueNames.map(name => {
    const sel = name === cleanSelected ? " selected" : "";
    return `<option value="${escapeHtml(name)}"${sel}>${escapeHtml(name)}</option>`;
  }).join("");
  return options;
}

function downloadMachineScheduleExcel(machineCode = null) {
  const targetCode = (machineCode || activeFolderMachineCode || "").trim();
  if (!targetCode) return;
  const url = `/api/machines/${encodeURIComponent(targetCode)}/maintenance-rows/export`;
  window.location.href = url;
}

function downloadFrPe0006FromCenter() {
  const sel = document.getElementById("excelFrPe0006MachineSelect");
  const code = sel ? sel.value.trim() : "";
  if (!code) {
    alert("Lütfen çizelgesini indirmek istediğiniz makineyi seçin.");
    return;
  }
  downloadMachineScheduleExcel(code);
}

function closeMachineScheduleModal() {
  const modal = document.getElementById("machineScheduleModal");
  if (modal) modal.classList.add("hidden");
  editingScheduleRowId = null;
  isAddingScheduleRow = false;
}

async function refreshMachineScheduleRows() {
  if (!activeFolderMachineCode) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/maintenance-rows`);
    if (res.ok) {
      activeScheduleRows = await res.json();
    }
  } catch (e) {
    console.error("Çizelge satırları yüklenemedi:", e);
  }
  updateScheduleCountBadges();
  renderMachineScheduleTable();
}

function updateScheduleCountBadges() {
  const count = activeScheduleRows.length;
  const folderBadge = document.getElementById("modalScheduleRowCount");
  if (folderBadge) folderBadge.innerText = `${count} satır`;
  const modalBadge = document.getElementById("scheduleTotalRowsBadge");
  if (modalBadge) modalBadge.innerText = `${count} Kayıt`;
}

function renderMachineScheduleTable() {
  const tbody = document.getElementById("machineScheduleTableBody");
  if (!tbody) return;

  let html = "";

  if (activeScheduleRows.length === 0 && !isAddingScheduleRow) {
    html = `
      <tr>
        <td colspan="10" class="py-10 text-center text-slate-400">
          <div class="flex flex-col items-center gap-2">
            <p class="text-xs font-medium">Bu makinenin FR-PE-0006 çizelgesinde henüz kayıtlı satır bulunmuyor.</p>
            <button type="button" onclick="startAddScheduleRow()" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>İlk Satırı Ekle</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  } else {
    html = activeScheduleRows.map(row => {
      if (editingScheduleRowId === row.id) {
        return `
          <tr class="bg-amber-50/70">
            <td class="border border-slate-300 p-1.5"><input id="sched-edit-date" type="text" value="${escapeHtml(row.date_str || '')}" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white font-semibold"></td>
            <td class="border border-slate-300 p-1.5"><textarea id="sched-edit-title" rows="2" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white resize-y">${escapeHtml(row.fault_work_title || '')}</textarea></td>
            <td class="border border-slate-300 p-1.5"><textarea id="sched-edit-desc" rows="2" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white resize-y">${escapeHtml(row.work_description || '')}</textarea></td>
            <td class="border border-slate-300 p-1.5"><input id="sched-edit-part" type="text" value="${escapeHtml(row.replaced_part || '')}" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white"></td>
            <td class="border border-slate-300 p-1.5"><input id="sched-edit-mold" type="text" value="${escapeHtml(row.mold_shot_count || '')}" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white"></td>
            <td class="border border-slate-300 p-1.5"><input id="sched-edit-notif" type="text" value="${escapeHtml(row.notification_no || '')}" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white"></td>
            <td class="border border-slate-300 p-1.5"><input id="sched-edit-mat" type="text" value="${escapeHtml(row.used_material || '')}" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white"></td>
            <td class="border border-slate-300 p-1.5"><select id="sched-edit-perf" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white font-medium">${buildScheduleOperatorOptions(row.performed_by || '')}</select></td>
            <td class="border border-slate-300 p-1.5"><input id="sched-edit-appr" type="text" value="${escapeHtml(row.approved_by || '')}" class="w-full px-2 py-1 text-xs border border-amber-400 rounded bg-white"></td>
            <td class="border border-slate-300 p-1.5 text-center whitespace-nowrap">
              <div class="flex items-center justify-center gap-1">
                <button type="button" onclick="saveEditedScheduleRow(${row.id})" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold" title="Kaydet">Kaydet</button>
                <button type="button" onclick="cancelEditScheduleRow()" class="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px] font-bold" title="İptal">İptal</button>
              </div>
            </td>
          </tr>
        `;
      }

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="border border-slate-300 px-2 py-2 text-center font-semibold text-slate-800 whitespace-nowrap">${escapeHtml(row.date_str || '-')}</td>
          <td class="border border-slate-300 px-2 py-2 text-slate-800 whitespace-pre-wrap break-words">${escapeHtml(row.fault_work_title || '')}</td>
          <td class="border border-slate-300 px-2 py-2 text-slate-700 whitespace-pre-wrap break-words">${escapeHtml(row.work_description || '')}</td>
          <td class="border border-slate-300 px-2 py-2 text-slate-700 break-words">${escapeHtml(row.replaced_part || '')}</td>
          <td class="border border-slate-300 px-2 py-2 text-center text-slate-700">${escapeHtml(row.mold_shot_count || '')}</td>
          <td class="border border-slate-300 px-2 py-2 text-center text-slate-700">${escapeHtml(row.notification_no || '')}</td>
          <td class="border border-slate-300 px-2 py-2 text-slate-700 break-words">${escapeHtml(row.used_material || '')}</td>
          <td class="border border-slate-300 px-2 py-2 text-center font-medium text-slate-800">${escapeHtml(row.performed_by || '')}</td>
          <td class="border border-slate-300 px-2 py-2 text-center font-medium text-slate-700">${escapeHtml(row.approved_by || '')}</td>
          <td class="border border-slate-300 px-1.5 py-2 text-center whitespace-nowrap">
            <div class="flex items-center justify-center gap-1">
              <button type="button" onclick="startEditScheduleRow(${row.id})" class="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Satırı Düzenle">
                <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
              </button>
              <button type="button" onclick="deleteScheduleRow(${row.id})" class="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Satırı Sil">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  if (isAddingScheduleRow) {
    const defaultDate = getTodayTrDateDot();
    const defaultUser = currentUser?.full_name || "";
    html += `
      <tr id="scheduleNewRowTr" class="bg-emerald-50/70">
        <td class="border border-slate-300 p-1.5"><input id="sched-new-date" type="text" value="${escapeHtml(defaultDate)}" placeholder="GG.AA.YYYY" class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white font-semibold"></td>
        <td class="border border-slate-300 p-1.5"><textarea id="sched-new-title" rows="2" placeholder="Arıza / iş tanımı..." class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white resize-y"></textarea></td>
        <td class="border border-slate-300 p-1.5"><textarea id="sched-new-desc" rows="2" placeholder="Yapılan işin açıklaması..." class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white resize-y"></textarea></td>
        <td class="border border-slate-300 p-1.5"><input id="sched-new-part" type="text" placeholder="Değişen parça" class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white"></td>
        <td class="border border-slate-300 p-1.5"><input id="sched-new-mold" type="text" placeholder="Baskı sayısı" class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white"></td>
        <td class="border border-slate-300 p-1.5"><input id="sched-new-notif" type="text" placeholder="Bildirim no" class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white"></td>
        <td class="border border-slate-300 p-1.5"><input id="sched-new-mat" type="text" placeholder="A/S.Dahili" class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white"></td>
        <td class="border border-slate-300 p-1.5"><select id="sched-new-perf" class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white font-medium">${buildScheduleOperatorOptions(defaultUser)}</select></td>
        <td class="border border-slate-300 p-1.5"><input id="sched-new-appr" type="text" placeholder="Onay" class="w-full px-2 py-1 text-xs border border-emerald-400 rounded bg-white"></td>
        <td class="border border-slate-300 p-1.5 text-center whitespace-nowrap">
          <div class="flex items-center justify-center gap-1">
            <button type="button" onclick="saveNewScheduleRow()" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold">Kaydet</button>
            <button type="button" onclick="cancelAddScheduleRow()" class="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px] font-bold">Vazgeç</button>
          </div>
        </td>
      </tr>
    `;
  }

  tbody.innerHTML = html;
  if (window.lucide) lucide.createIcons();

  if (isAddingScheduleRow) {
    const titleEl = document.getElementById("sched-new-title");
    if (titleEl) {
      titleEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      titleEl.focus();
    }
  }
}

function startAddScheduleRow() {
  editingScheduleRowId = null;
  isAddingScheduleRow = true;
  renderMachineScheduleTable();
}

function cancelAddScheduleRow() {
  isAddingScheduleRow = false;
  renderMachineScheduleTable();
}

async function saveNewScheduleRow() {
  if (!activeFolderMachineCode) return;
  const payload = {
    date_str: document.getElementById("sched-new-date")?.value.trim() || getTodayTrDateDot(),
    fault_work_title: document.getElementById("sched-new-title")?.value.trim() || "",
    work_description: document.getElementById("sched-new-desc")?.value.trim() || "",
    replaced_part: document.getElementById("sched-new-part")?.value.trim() || "",
    mold_shot_count: document.getElementById("sched-new-mold")?.value.trim() || "",
    notification_no: document.getElementById("sched-new-notif")?.value.trim() || "",
    used_material: document.getElementById("sched-new-mat")?.value.trim() || "",
    performed_by: document.getElementById("sched-new-perf")?.value.trim() || "",
    approved_by: document.getElementById("sched-new-appr")?.value.trim() || ""
  };

  if (!payload.fault_work_title && !payload.work_description) {
    alert("Lütfen en azından 'Arıza ve Yapılan İşin Tanımı' veya 'Yapılan İşin Açıklaması' alanını doldurun.");
    return;
  }

  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/maintenance-rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      isAddingScheduleRow = false;
      await refreshMachineScheduleRows();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Satır kaydedilemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

function startEditScheduleRow(rowId) {
  isAddingScheduleRow = false;
  editingScheduleRowId = rowId;
  renderMachineScheduleTable();
}

function cancelEditScheduleRow() {
  editingScheduleRowId = null;
  renderMachineScheduleTable();
}

async function saveEditedScheduleRow(rowId) {
  if (!activeFolderMachineCode) return;
  const payload = {
    date_str: document.getElementById("sched-edit-date")?.value.trim() || "",
    fault_work_title: document.getElementById("sched-edit-title")?.value.trim() || "",
    work_description: document.getElementById("sched-edit-desc")?.value.trim() || "",
    replaced_part: document.getElementById("sched-edit-part")?.value.trim() || "",
    mold_shot_count: document.getElementById("sched-edit-mold")?.value.trim() || "",
    notification_no: document.getElementById("sched-edit-notif")?.value.trim() || "",
    used_material: document.getElementById("sched-edit-mat")?.value.trim() || "",
    performed_by: document.getElementById("sched-edit-perf")?.value.trim() || "",
    approved_by: document.getElementById("sched-edit-appr")?.value.trim() || ""
  };

  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/maintenance-rows/${rowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      editingScheduleRowId = null;
      await refreshMachineScheduleRows();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Satır güncellenemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

async function deleteScheduleRow(rowId) {
  if (!activeFolderMachineCode) return;
  if (!confirm("Bu çizelge satırını silmek istediğinize emin misiniz?")) return;
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(activeFolderMachineCode)}/maintenance-rows/${rowId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      await refreshMachineScheduleRows();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Satır silinemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
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
  const machineFilter = (document.getElementById("excelFilterMachine")?.value || "").trim().toUpperCase();

  const titleEl = document.getElementById("doneJobsTableTitle");
  const badgeEl = document.getElementById("doneJobsBadgeInfo");
  const tbody = document.getElementById("doneJobsTableBody");

  const hoTitleEl = document.getElementById("doneHandoverTableTitle");
  const hoBadgeEl = document.getElementById("doneHandoverBadgeInfo");
  const hoTbody = document.getElementById("doneHandoverTableBody");

  if (titleEl) titleEl.innerText = `${dateVal} Tarihinde Yapılan İşler`;
  if (badgeEl) badgeEl.innerText = "Yükleniyor...";
  if (hoTitleEl) hoTitleEl.innerText = `${dateVal} Tarihinde Vardiya İş Aktarım Kayıtları`;
  if (hoBadgeEl) hoBadgeEl.innerText = "Yükleniyor...";

  try {
    const res = await fetch(`/api/server-excel/status?date_str=${encodeURIComponent(dateVal)}`);
    if (!res.ok) throw new Error("Sunucudan veri alınamadı");
    const data = await res.json();

    let records = data.records || [];
    if (machineFilter) {
      records = records.filter(r =>
        (r.area || "").toUpperCase().includes(machineFilter) ||
        (r.description || "").toUpperCase().includes(machineFilter)
      );
    }

    const totalMinutes = records.reduce((sum, r) => sum + (parseInt(r.time_spent) || 0), 0);
    if (badgeEl) {
      badgeEl.innerHTML = `Toplam: <b class="text-blue-700 font-bold">${records.length} İşlem</b> | Toplam Süre: <b class="text-emerald-700 font-bold">${totalMinutes} dk</b>`;
    }

    if (tbody) {
      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400">Bu tarihte (${dateVal}) henüz yapılan bir iş kaydı bulunamadı.</td></tr>`;
      } else {
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
      }
    }
  } catch (e) {
    console.error("Yapılan işler listesi yüklenemedi:", e);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-500">Kayıtlar yüklenirken hata oluştu.</td></tr>`;
    }
  }

  try {
    const hoRes = await fetch(`/api/handover/tasks?date_str=${encodeURIComponent(dateVal)}`);
    if (!hoRes.ok) throw new Error("İş aktarım kayıtları alınamadı");
    const hoTasks = await hoRes.json();

    if (hoBadgeEl) {
      hoBadgeEl.innerHTML = `Toplam: <b class="text-purple-700 font-bold">${hoTasks.length} Devir Kaydı</b>`;
    }

    if (hoTbody) {
      if (hoTasks.length === 0) {
        hoTbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">Bu tarihte (${dateVal}) henüz vardiya iş aktarım kaydı bulunmuyor.</td></tr>`;
      } else {
        hoTbody.innerHTML = hoTasks.map((t, idx) => `
          <tr class="hover:bg-slate-50 transition border-b border-slate-100">
            <td class="p-2.5 text-center font-bold text-slate-500">${idx + 1}</td>
            <td class="p-2.5 text-center font-semibold text-slate-700 bg-slate-50/50">${escapeHtml(t.shift)}</td>
            <td class="p-2.5 text-slate-800 font-medium">
              ${escapeHtml(t.task_description)}
              ${t.notes ? `<span class="block text-[11px] text-slate-500 italic mt-0.5">Not: ${escapeHtml(t.notes)}</span>` : ''}
            </td>
            <td class="p-2.5 text-center font-bold text-blue-900">${escapeHtml(t.assigned_person)}</td>
            <td class="p-2.5 text-center font-semibold text-purple-700">
              ${escapeHtml(t.status)}
              ${t.status_updated_by ? `<span class="block text-[10px] text-slate-500 font-bold mt-0.5">(${escapeHtml(t.status_updated_by)})</span>` : ''}
            </td>
          </tr>
        `).join("");
      }
    }
  } catch (e) {
    console.error("İş aktarım listesi yüklenemedi:", e);
    if (hoTbody) {
      hoTbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-rose-500">İş aktarım kayıtları yüklenirken hata oluştu.</td></tr>`;
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

function downloadSelectedDateHandoverExcel() {
  const dateInput = document.getElementById("excelFilterDate");
  const dateVal = dateInput?.value || formatDateToIso(new Date());
  window.open(`/api/handover/export?date_str=${encodeURIComponent(dateVal)}`, "_blank");
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

// ----------------- HAREKETSİZLİK TAKİBİ (20 DK OTURUM KAPATMA - ADMİNLER HARİÇ) -----------------
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000; // 20 dakika (1.200.000 ms)
let lastUserActivityTimestamp = Date.now();
let lastThrottledActivityRecord = 0;
let inactivityTrackerInitialized = false;

function recordUserActivity() {
  const now = Date.now();
  if (now - lastThrottledActivityRecord > 2000) { // 2 saniyede bir sınırla
    lastThrottledActivityRecord = now;
    lastUserActivityTimestamp = now;
    try {
      localStorage.setItem("last_user_activity", String(now));
    } catch (e) {}
  }
}

function getLastUserActivityTimestamp() {
  try {
    const stored = parseInt(localStorage.getItem("last_user_activity") || "0", 10);
    if (stored && stored > lastUserActivityTimestamp) {
      lastUserActivityTimestamp = stored;
    }
  } catch (e) {}
  return lastUserActivityTimestamp;
}

function checkUserInactivity() {
  // Oturum açık değilse veya kullanıcı ADMIN ise 20 dk kuralı işletilmez (Adminler hariç)
  if (!currentUser || isAdminUser(currentUser)) {
    return false;
  }

  const lastActive = getLastUserActivityTimestamp();
  const elapsed = Date.now() - lastActive;

  if (elapsed >= INACTIVITY_TIMEOUT_MS) {
    console.warn(`[Güvenlik] Kullanıcı ${Math.round(elapsed / 60000)} dakikadır hareketsiz kaldı. Oturum kapatılıyor.`);
    logoutUser("20 dakika boyunca işlem yapılmadığı için oturumunuz otomatik olarak kapatıldı.", false);
    return true;
  }
  return false;
}

function initInactivityTracker() {
  if (inactivityTrackerInitialized) return;
  inactivityTrackerInitialized = true;

  const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click", "input"];
  activityEvents.forEach(evt => {
    window.addEventListener(evt, () => {
      if (checkUserInactivity()) return;
      recordUserActivity();
    }, { passive: true });
  });

  window.addEventListener("focus", () => {
    if (checkUserInactivity()) return;
    recordUserActivity();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (checkUserInactivity()) return;
      recordUserActivity();
    }
  });

  recordUserActivity();

  // Her 15 saniyede bir periyodik kontrol
  setInterval(checkUserInactivity, 15000);
}

function isAdminUser(user) {
  return user && (user.role || "").toUpperCase() === "ADMIN";
}

function canManageMachineFolders(user) {
  return user && ["ADMIN", "YONETICI", "YÖNETİCİ"].includes((user.role || "").toUpperCase());
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

function showLoginOverlay(errorMsg = "", isInputError = true) {
  const overlay = document.getElementById("loginOverlay");
  const errEl = document.getElementById("loginError");
  const sicilInput = document.getElementById("loginSicilNo");
  const pinInput = document.getElementById("loginPin");

  if (overlay) overlay.classList.remove("hidden");
  if (errEl) {
    if (errorMsg) {
      errEl.textContent = errorMsg;
      errEl.classList.remove("hidden");
      if (isInputError) {
        setInputError(sicilInput, true);
        setInputError(pinInput, true);
      } else {
        setInputError(sicilInput, false);
        setInputError(pinInput, false);
      }
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
  recordUserActivity();
  const activeUserNameEl = document.getElementById("activeUserName");
  if (activeUserNameEl) activeUserNameEl.innerText = user.full_name;

  const btnAdmin = document.getElementById("btnAdminUsers");
  if (btnAdmin) {
    if (isAdminUser(user)) {
      btnAdmin.classList.remove("hidden");
    } else {
      btnAdmin.classList.add("hidden");
    }
  }

  const btnNewMachine = document.getElementById("btnNewMachineFolder");
  if (btnNewMachine) {
    if (canManageMachineFolders(user)) {
      btnNewMachine.classList.remove("hidden");
    } else {
      btnNewMachine.classList.add("hidden");
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
      // Admin değilse ve son aktivite 20 dakikayı geçmişse oturumu kapat
      if (!isAdminUser(user)) {
        const lastActive = getLastUserActivityTimestamp();
        if (lastActive && (Date.now() - lastActive >= INACTIVITY_TIMEOUT_MS)) {
          console.warn("[Güvenlik] Son aktivite 20 dakikayı aştığı için oturum kapatıldı.");
          await logoutUser("20 dakika boyunca işlem yapılmadığı için oturumunuz otomatik olarak kapatıldı.", false);
          return;
        }
      }
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
        remember_me: false
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
      showLoginOverlay(err.detail || "Kullanıcı veya şifre hatalı!");
    }
  } catch (e) {
    showLoginOverlay("Sunucuya bağlanılamadı.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function logoutUser(reason = "", isInputError = false) {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {
    console.warn(e);
  }
  currentUser = null;
  const activeUserNameEl = document.getElementById("activeUserName");
  if (activeUserNameEl) activeUserNameEl.innerText = "-";
  const btnAdmin = document.getElementById("btnAdminUsers");
  if (btnAdmin) btnAdmin.classList.add("hidden");
  const btnNewMachine = document.getElementById("btnNewMachineFolder");
  if (btnNewMachine) btnNewMachine.classList.add("hidden");
  showLoginOverlay(reason, isInputError);
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

function getRoleBadgeHtml(u) {
  const r = (u.role || "").toUpperCase();
  if (r === "ADMIN") {
    return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">ADMIN</span>`;
  }
  if (r === "YONETICI" || r === "YÖNETİCİ") {
    return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">YÖNETİCİ</span>`;
  }
  return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">${u.role}</span>`;
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
          ${getRoleBadgeHtml(u)}
          ${!u.is_active ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">PASİF</span>` : ''}
        </div>
        <div class="text-[11px] text-slate-500 mt-0.5">${u.department}</div>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <select onchange="changeUserRole(${u.id}, this.value)" class="px-2 py-1 text-[11px] border border-slate-300 rounded-lg font-semibold bg-white text-slate-700 focus:outline-none">
          <option value="TEKNISYEN" ${(u.role || '').toUpperCase() === 'TEKNISYEN' ? 'selected' : ''}>Bakımcı (TEKNISYEN)</option>
          <option value="YONETICI" ${(u.role || '').toUpperCase() === 'YONETICI' ? 'selected' : ''}>Yönetici (YONETICI)</option>
          <option value="ADMIN" ${(u.role || '').toUpperCase() === 'ADMIN' ? 'selected' : ''}>Sistem Yöneticisi (ADMIN)</option>
        </select>
        <button type="button" onclick="resetUserPin(${u.id}, '${u.username}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition">
          Şifre Sıfırla
        </button>
        <button type="button" onclick="toggleUserActive(${u.id}, ${!u.is_active})" class="px-2.5 py-1 ${u.is_active ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'} rounded-lg font-semibold transition">
          ${u.is_active ? 'Pasife Al' : 'Aktif Et'}
        </button>
        <button type="button" onclick="deleteUserAccount(${u.id}, '${u.username.replace(/'/g, "\\'")}', '${(u.full_name || '').replace(/'/g, "\\'")}')" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold transition flex items-center gap-1" title="Kullanıcıyı Tamamen Sil">
          <span>Sil</span>
        </button>
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

  const sicilVal = sicilEl.value.trim();
  const payload = {
    username: sicilVal || null,
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
      if (detail.toLowerCase().includes("şifre")) {
        setInputError(pinEl, true);
        pinEl.focus();
      } else if (detail.toLowerCase().includes("ad soyad")) {
        setInputError(nameEl, true);
        nameEl.focus();
      } else if (detail.toLowerCase().includes("sicil")) {
        setInputError(sicilEl, true);
        sicilEl.focus();
      } else {
        setInputError(nameEl, true);
        setInputError(pinEl, true);
      }
      showAdminFormFeedback(detail, true);
    }
  } catch (e) {
    showAdminFormFeedback("Sunucuya bağlanılamadı.", true);
  }
}

async function changeUserRole(userId, newRole) {
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole })
    });
    if (res.ok) {
      await loadUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Rol güncellenemedi."}`);
      await loadUsers();
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
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
      showAdminFormFeedback(newState ? "✅ Kullanıcı hesabı aktif edildi." : "⚠️ Kullanıcı hesabı pasife alındı.", false);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "İşlem başarısız."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
}

async function deleteUserAccount(userId, sicilNo, fullName) {
  if (!confirm(`"${fullName} (${sicilNo})" adlı kullanıcıyı sistemden tamamen silmek istediğinize emin misiniz?\n\nBu işlem geri alınamaz.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      await loadUsers();
      showAdminFormFeedback(`🗑️ ${fullName} (${sicilNo}) sistemden tamamen silindi.`, false);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Kullanıcı silinemedi."}`);
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

  const voiceLiveOutEl = document.getElementById("voiceLiveOutput");
  if (voiceLiveOutEl) voiceLiveOutEl.innerText = "";

  // Vardiya seçimini default/otomatik durumuna döndür ve saate senkronize et
  userManuallyChangedShift = false;
  autoSyncShiftWithCurrentTime(true);

  // Operatör ismini koru
  const savedOp = localStorage.getItem("saved_operator_name") || (currentUser ? currentUser.full_name : "");
  const opInput = document.getElementById("formOperatorName");
  if (opInput && savedOp) {
    opInput.value = savedOp;
  }

  updateFormDatalists();
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
  if (!canManageMachineFolders(currentUser)) {
    alert("Yeni makine klasörü eklemek için Yönetici (YONETICI) veya Admin yetkisi gereklidir.");
    return;
  }
  const modal = document.getElementById("newMachineModal");
  if (modal) {
    modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
    document.getElementById("newMachineCode")?.focus();
  }
}

function closeNewMachineModal() {
  const modal = document.getElementById("newMachineModal");
  if (modal) modal.classList.add("hidden");
}

async function submitNewMachine(event) {
  event.preventDefault();
  const department = document.getElementById("newMachineDept")?.value || "A BİNASI (Montaj / Assembly)";
  const line = document.getElementById("newMachineLine")?.value.trim().toUpperCase() || "GENEL HAT";
  const code = document.getElementById("newMachineCode")?.value.trim().toUpperCase() || "";
  const name = document.getElementById("newMachineName")?.value.trim() || "";
  const model = document.getElementById("newMachineModel")?.value.trim() || "Standart İstasyon";

  if (!code || !name) {
    alert("Lütfen makine kodu ve adını doldurun.");
    return;
  }

  try {
    const res = await fetch("/api/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code,
        name: name,
        department: department,
        line: line,
        model: model,
        status: "CALISIYOR"
      })
    });
    if (res.ok) {
      document.getElementById("newMachineForm")?.reset();
      closeNewMachineModal();
      await loadMachines();
      alert(`✅ Yeni makine klasörü (${code} - ${name}) başarıyla eklendi!`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Hata: ${err.detail || "Makine klasörü eklenemedi."}`);
    }
  } catch (e) {
    alert("Sunucuya bağlanılamadı.");
  }
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
  let dateStr = dateInput ? dateInput.value : "";
  if (!dateStr) {
    const today = new Date().toISOString().split("T")[0];
    if (dateInput) dateInput.value = today;
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
    <div class="bg-slate-50 hover:bg-slate-100/80 p-3 rounded-xl border border-slate-200/70 transition space-y-2 overflow-hidden">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-slate-800 leading-snug break-words">${escapeHtml(t.task_description)}</p>
          ${t.notes ? `<p class="text-[11px] text-slate-500 mt-1 italic break-words"><i data-lucide="info" class="w-3 h-3 inline mr-1 text-slate-400"></i>${escapeHtml(t.notes)}</p>` : ''}
        </div>
        <button type="button" onclick="deleteHandoverTask(${t.id})" class="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition shrink-0" title="Görevi Sil">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-200/50">
        <div class="flex items-center gap-1 text-[11px] text-slate-600 font-medium min-w-0 truncate">
          <i data-lucide="user" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
          <span class="truncate">Sorumlu: <b>${escapeHtml(t.assigned_person)}</b></span>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          ${getStatusBadge(t.status)}
          ${t.status_updated_by ? `<span class="px-2 py-0.5 bg-slate-200/80 text-slate-700 rounded-md text-[10px] font-bold truncate max-w-[140px]" title="Son Durumu Değiştiren: ${escapeHtml(t.status_updated_by)}">✍️ ${escapeHtml(t.status_updated_by)}</span>` : ''}
        </div>
      </div>

      <div class="pt-2 border-t border-slate-200/60 space-y-1.5">
        <select id="ho-status-${t.id}" onchange="onHandoverStatusSelectChange(${t.id})" class="w-full text-[11px] font-semibold bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none">
          <option value="Devam Ediyor" ${t.status === 'Devam Ediyor' ? 'selected' : ''}>⏳ Devam Ediyor</option>
          <option value="Tamamlandı" ${t.status === 'Tamamlandı' ? 'selected' : ''}>✅ Tamamlandı</option>
          <option value="Malzeme Bekleniyor" ${t.status === 'Malzeme Bekleniyor' ? 'selected' : ''}>📦 Malzeme Bekleniyor</option>
          <option value="Sonraki Vardiyaya Devir" ${t.status === 'Sonraki Vardiyaya Devir' ? 'selected' : ''}>🔄 Sonraki Vardiyaya Devir</option>
          <option value="İptal" ${t.status === 'İptal' ? 'selected' : ''}>❌ İptal</option>
        </select>
        <div class="flex items-center gap-1.5 w-full">
          <input type="text" id="ho-updater-${t.id}" list="operatorDatalist" value="${escapeHtml(t.status_updated_by || '')}" oninput="clearInputError(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();submitHandoverStatusUpdate(${t.id});}" placeholder="Durumu Değiştiren Kişi *" class="flex-1 min-w-0 w-full text-[11px] font-semibold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 uppercase focus:ring-2 focus:ring-blue-500 focus:outline-none">
          <button type="button" onclick="submitHandoverStatusUpdate(${t.id})" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition shrink-0 whitespace-nowrap">
            Kaydet
          </button>
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

function onHandoverStatusSelectChange(taskId) {
  const updaterInput = document.getElementById(`ho-updater-${taskId}`);
  if (updaterInput) {
    updaterInput.focus();
    if (!updaterInput.value.trim()) {
      setInputError(updaterInput, true);
    }
  }
}

async function submitHandoverStatusUpdate(taskId) {
  const statusSelect = document.getElementById(`ho-status-${taskId}`);
  const updaterInput = document.getElementById(`ho-updater-${taskId}`);
  const newStatus = statusSelect ? statusSelect.value : "Devam Ediyor";
  const updatedBy = updaterInput ? updaterInput.value.trim().toUpperCase() : "";

  if (!updatedBy) {
    if (updaterInput) {
      setInputError(updaterInput, true);
      updaterInput.focus();
    }
    alert("Son durumu güncellemek için lütfen 'Durumu Değiştiren Kişi' kutucuğuna isim yazınız!");
    return;
  }

  try {
    const res = await fetch(`/api/handover/${taskId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, updated_by: updatedBy })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Durum güncellenemedi");
    }
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

function setHandoverDateQuick(type) {
  const dateInput = document.getElementById("handoverDateFilter");
  if (!dateInput) return;
  const d = new Date();
  if (type === "yesterday") {
    d.setDate(d.getDate() - 1);
  }
  dateInput.value = formatDateToIso(d);
  loadHandoverTasks();
}

function downloadHandoverExcel() {
  const dateInput = document.getElementById("handoverDateFilter");
  const dateStr = dateInput?.value || formatDateToIso(new Date());
  window.open(`/api/handover/export?date_str=${encodeURIComponent(dateStr)}`, "_blank");
}

// ESC tuşu ile açık tüm modalları kapatma
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (typeof closeVoiceDictationModal === "function") closeVoiceDictationModal();
    if (typeof closeOperatorSelectModal === "function") closeOperatorSelectModal();
    if (typeof closeCriteriaModal === "function") closeCriteriaModal();
    if (typeof closeAdminUsersModal === "function") closeAdminUsersModal();
    if (typeof closeMachineFolderModal === "function") closeMachineFolderModal();
    if (typeof closeNewMachineModal === "function") closeNewMachineModal();
  }
});
