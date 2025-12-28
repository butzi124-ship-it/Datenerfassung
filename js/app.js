// ==========================
//  Datenerfassung Pro – APP
// ==========================

const STORAGE_KEY = "datenerfassung_pro_v33_pdf_times";

// Globaler App-State
let appState = {
  departments: [],
  machines: [],
  orders: [],
  globalEmployees: [],
  currentView: "login", // 'login' | 'dashboard' | 'production'
  activeMachineId: null,
  activeOrderId: null,
  currentUser: null,
};

// Login-Auswahl
let loginSelectedDeptId = null;

// QS-Checkliste (ohne Vorgabezeit – separater Zeit-Dialog)
const CHECKLIST_ITEMS = [
  "Stückzahl gezählt?",
  "Auftrag fertig gemeldet?",
  "Lagerort eingetragen?",
  "Hilfsmittel eingeräumt?",
  "Werkzeuge eingeräumt?",
  "Teile eingeölt?",
  "Doku ergänzt?",
  "Excel eingetragen?",
  "Doku-Fehler notiert?",
  "Doku abgelegt?",
];

let clockInterval = null;
let qaDialogResolve = null; // für Scrap/Abklärung-Mitarbeiterwahl
let pendingFinishContext = null; // für Abschluss + Zeitdialog
let currentOpDialogOrderId = null; // OP-Dialog

// NEU: Ursache-Dialog
let qaCauseResolve = null;

// 6M-Ursachen-Struktur
const QA_CAUSE_GROUPS = [
  {
    id: "mensch",
    label: "Mensch",
    reasons: [
      { id: "falsche_entscheidung", label: "Falsche Entscheidung" },
      { id: "ablesefehler", label: "Ablesefehler" },
      { id: "falsche_korrektur", label: "Falsche Korrektur" },
      { id: "falsche_bedienung", label: "Falsche Bedienung" },
      { id: "unkonzentriert", label: "Unkonzentriert" },
      { id: "falsch_eingestiegen", label: "Falsch eingestiegen" },
      { id: "falsch_gespannt", label: "Falsch gespannt" },
      { id: "nicht_bekannt", label: "Nicht bekannt" },
    ],
  },
  {
    id: "maschine",
    label: "Maschine",
    reasons: [
      { id: "werkzeugbruch", label: "Werkzeugbruch" },
      { id: "maschinenfehler", label: "Maschinenfehler" },
      { id: "nicht_bekannt", label: "Nicht bekannt" },
    ],
  },
  {
    id: "organisation",
    label: "Organisation",
    reasons: [
      { id: "programm_falsch", label: "Programm falsch" },
      { id: "arbeitsanweisung_falsch", label: "Falsche Arbeitsanweisung" },
      { id: "operationsplan_falsch", label: "Operationsplan falsch" },
      { id: "aufspannung_nio", label: "Aufspannung n.i.O." },
    ],
  },
  {
    id: "material",
    label: "Material",
    reasons: [
      { id: "lunker", label: "Lunker" },
      { id: "rohmasse_nio", label: "Rohmasse n.i.O." },
      { id: "falsches_material", label: "Falsches Material" },
    ],
  },
  {
    id: "methode",
    label: "Methode",
    reasons: [
      { id: "falsches_werkzeug", label: "Falsches Werkzeug" },
      { id: "kann_nicht_bearbeitet", label: "Kann nicht bearbeitet werden" },
      {
        id: "materialabmasse_ungeeignet",
        label: "Materialabmasse nicht geeignet",
      },
    ],
  },
  {
    id: "messung",
    label: "Messung",
    reasons: [
      { id: "temperatur", label: "Temperatur" },
      { id: "messmittel_nio", label: "Messmittel n.i.O." },
      { id: "messtaster_nicht_kalb", label: "Messtaster nicht kalibriert" },
      { id: "messmaschine_nio", label: "Messmaschine n.i.O." },
      { id: "erststueck_fehl", label: "Erststückkontrolle fehlerhaft" },
    ],
  },
];

// ==========================
//   HILFSFUNKTIONEN
// ==========================

function safeHide(id, hide) {
  const el = document.getElementById(id);
  if (!el) return;
  if (hide) el.classList.add("hidden");
  else el.classList.remove("hidden");
}

function showToast() {
  const t = document.getElementById("saveToast");
  if (!t) return;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 1200);
}

function saveData(showToastFlag = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    if (showToastFlag) showToast();
  } catch (e) {
    console.warn("Speichern fehlgeschlagen:", e);
  }
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    appState = {
      ...appState,
      ...parsed,
    };

    if (!Array.isArray(appState.departments)) appState.departments = [];
    if (!Array.isArray(appState.machines)) appState.machines = [];
    if (!Array.isArray(appState.orders)) appState.orders = [];
    if (!Array.isArray(appState.globalEmployees)) appState.globalEmployees = [];

    appState.machines.forEach((m) => {
      if (!Array.isArray(m.activeOrderIds)) m.activeOrderIds = [];
    });

    appState.orders.forEach((o) => {
      if (!Array.isArray(o.stations)) o.stations = [];
      if (!Array.isArray(o.employees)) o.employees = [];
      if (!Array.isArray(o.history)) o.history = [];

      // Standardmäßig Kettenlogik aktiv
      if (typeof o.useChainLogic === "undefined") {
        o.useChainLogic = true;
      }

      // Paletten-Infos (allgemein)
      if (typeof o.palletCount !== "number") o.palletCount = 0;
      if (typeof o.piecesPerPallet !== "number") o.piecesPerPallet = 0;

      // Maschine-50-Lagerstruktur (bleibt vorhanden, Logik aktuell deaktiviert)
      if (o.machineId === "50") {
        if (!o.machine50Storage) {
          o.machine50Storage = {
            totalPallets: o.palletCount || 0,
            piecesPerPallet: o.piecesPerPallet || 2,
            usedPallets: 0,
            currentMode: null, // "1er" | "2er" oder null
            currentPiecesOnPallet: 0, // 0 oder 1
            pallets: [], // {index, mode, pieces, rack, place}
            twoOneMode: false,
          };
        } else {
          if (typeof o.machine50Storage.usedPallets !== "number") {
            o.machine50Storage.usedPallets = 0;
          }
          if (typeof o.machine50Storage.currentPiecesOnPallet !== "number") {
            o.machine50Storage.currentPiecesOnPallet = 0;
          }
          if (!Array.isArray(o.machine50Storage.pallets)) {
            o.machine50Storage.pallets = [];
          }
          if (typeof o.machine50Storage.twoOneMode !== "boolean") {
            o.machine50Storage.twoOneMode = false;
          }
        }
      }

      o.stations.forEach((s) => {
        if (!s.counts) s.counts = {};
        if (!s.scrap) s.scrap = {};
        if (!s.clarify) s.clarify = {};
        if (!Array.isArray(s.scrapLog)) s.scrapLog = [];
        if (!Array.isArray(s.clarifyLog)) s.clarifyLog = [];
        if (typeof s.scrapTotal !== "number") s.scrapTotal = 0;
        if (typeof s.clarifyTotal !== "number") s.clarifyTotal = 0;

        // Lebensdauer-Ausschuss / Abklärung
        if (typeof s.scrapLifetime !== "number") {
          s.scrapLifetime = s.scrapTotal || 0;
        }
        if (typeof s.clarifyLifetime !== "number") {
          s.clarifyLifetime = s.clarifyTotal || 0;
        }

        // Vorgabezeit-Infos pro Spannung
        if (!s.timeStatus) s.timeStatus = null; // "ok" | "changed" | null
        if (typeof s.actualTimeMinutes !== "number") s.actualTimeMinutes = null;

        // OP-Nummer
        if (typeof s.opNumber === "undefined") s.opNumber = null;
      });
    });

    const allowedViews = ["login", "dashboard", "production"];
    if (!allowedViews.includes(appState.currentView)) {
      appState.currentView = "login";
    }
  } catch (e) {
    console.warn("Laden fehlgeschlagen:", e);
  }
}

function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  const el = document.getElementById("clock");
  const update = () => {
    if (!el) return;
    el.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };
  update();
  clockInterval = setInterval(update, 1000);
}

// OFFEN-Zähler oben rechts:
// Zielmenge - (fertige Teile letzte Spannung + Ausschuss aller Spannungen)
function recalculateOpenCounter() {
  const headerEl = document.getElementById("grandTotal");
  if (!headerEl) return;

  const order = appState.orders.find((o) => o.id === appState.activeOrderId);

  if (!order) {
    headerEl.textContent = "0";
    return;
  }

  const target = Number(order.targetQuantity) || 0;
  if (!target || target <= 0) {
    headerEl.textContent = "0";
    return;
  }

  let finishedLast = 0;
  if (order.stations && order.stations.length > 0) {
    const lastId = order.stations.reduce(
      (max, s) => (s.id > max ? s.id : max),
      0
    );
    const lastStation = order.stations.find((s) => s.id === lastId);
    if (lastStation && lastStation.counts) {
      Object.values(lastStation.counts).forEach((v) => {
        finishedLast += Number(v) || 0;
      });
    }
  }

  let scrapAll = 0;
  if (order.stations && Array.isArray(order.stations)) {
    order.stations.forEach((s) => {
      scrapAll += Number(s.scrapTotal) || 0;
    });
  }

  const remaining = target - (finishedLast + scrapAll);
  headerEl.textContent =
    remaining > 0 ? remaining.toLocaleString("de-DE") : "0";
}

// Bild als DataURL laden (für PDF-Logo / BG)
function loadImageAsDataUrl(src, alpha = 1) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        resolve({
          dataUrl,
          width: canvas.width,
          height: canvas.height,
        });
      } catch (e) {
        console.warn("Fehler beim Konvertieren des Bildes:", e);
        resolve(null);
      }
    };
    img.onerror = () => {
      console.warn("Bild konnte nicht geladen werden:", src);
      resolve(null);
    };
    img.src = src;
  });
}

// Logo oben links
async function loadPdfLogo() {
  return loadImageAsDataUrl("images/humbel.png", 1);
}

// Hintergrund-Logo (Wasserzeichen, sehr hell)
async function loadPdfBackground() {
  return loadImageAsDataUrl("images/humbel_background.jpg", 0.06);
}

// ==========================
//   INITIALISIERUNG
// ==========================

window.addEventListener("load", init);

function init() {
  loadData();

  if (appState.departments.length === 0) {
    appState.departments = [
      { id: "d1", name: "Fräserei" },
      { id: "d2", name: "Dreherei" },
    ];
  }

  if (!Array.isArray(appState.machines)) appState.machines = [];
  appState.machines.forEach((m) => {
    if (!Array.isArray(m.activeOrderIds)) m.activeOrderIds = [];
  });

  startClock();
  initChecklist();

  if (appState.currentUser) {
    renderView();
  } else {
    showLoginScreen();
  }
}

// ==========================
//   LOGIN / BENUTZER
// ==========================

function showLoginScreen() {
  safeHide("loginView", false);
  safeHide("dashboardView", true);
  safeHide("productionView", true);
  safeHide("productionFooter", true);

  const deptContainer = document.getElementById("loginDeptList");
  const empContainer = document.getElementById("loginEmployeeList");
  const info = document.getElementById("loginInfoText");

  if (deptContainer) {
    deptContainer.innerHTML = "";
    appState.departments.forEach((d) => {
      const btn = document.createElement("button");
      btn.className =
        "px-4 py-2 rounded-full border-2 text-sm font-bold mr-2 mb-2 " +
        (loginSelectedDeptId === d.id
          ? "bg-brand text-white border-brand"
          : "bg-white text-brand border-brand hover:bg-brandLight");
      btn.textContent = d.name;
      btn.onclick = () => {
        loginSelectedDeptId = d.id;
        showLoginScreen();
      };
      deptContainer.appendChild(btn);
    });
  }

  if (empContainer) {
    empContainer.innerHTML = "";
    if (!loginSelectedDeptId) {
      empContainer.innerHTML =
        '<div class="text-sm text-slate-400 italic">Bitte zuerst eine Abteilung wählen.</div>';
    } else {
      const list = appState.globalEmployees.filter(
        (e) => e.deptId === loginSelectedDeptId
      );
      if (list.length === 0) {
        empContainer.innerHTML =
          '<div class="text-sm text-slate-400 italic">Keine Mitarbeiter in dieser Abteilung.</div>';
      } else {
        list.forEach((e) => {
          const d = appState.departments.find((x) => x.id === e.deptId);
          const btn = document.createElement("button");
          btn.className =
            "w-full bg-white border-2 border-slate-200 hover:border-brand text-slate-700 py-3 rounded-lg font-bold transition text-left px-4 flex justify-between mb-2 shadow-sm";
          btn.innerHTML = `<span>${
            e.name
          }</span><span class="text-xs text-slate-400">${
            d ? d.name : ""
          }</span>`;
          btn.onclick = () => loginAsWorker(e.id);
          empContainer.appendChild(btn);
        });
      }
    }
  }

  if (info) {
    info.textContent =
      "Mitarbeiter werden im Menü Stammdaten vom Admin angelegt.";
  }
}

function openAdminLogin() {
  safeHide("adminLoginDialog", false);
  const u = document.getElementById("loginUser");
  if (u) u.focus();
}

function closeAdminLogin() {
  safeHide("adminLoginDialog", true);
}

function performAdminLogin() {
  const u = document.getElementById("loginUser");
  const p = document.getElementById("loginPass");
  const user = (u && u.value.trim()) || "";
  const pass = (p && p.value.trim()) || "";

  // Fester Admin Login
  if (user === "admin" && pass === "1234") {
    finalizeLogin({
      id: "admin",
      name: "Master Admin",
      role: "admin",
      deptId: null,
      persId: null,
    });
    return;
  }

  // Abteilungsleiter: Name + Personalnummer
  const emp = appState.globalEmployees.find(
    (e) => e.name === user && e.isDeptHead
  );
  if (emp && emp.persId === pass) {
    finalizeLogin({
      id: emp.id,
      name: emp.name,
      role: "admin",
      deptId: emp.deptId || null,
      persId: emp.persId || null,
    });
    return;
  }

  alert("Zugangsdaten falsch.");
}

function loginAsWorker(id) {
  const emp = appState.globalEmployees.find((x) => x.id === id);
  if (!emp) return;
  finalizeLogin({
    id: emp.id,
    name: emp.name,
    role: "worker",
    deptId: emp.deptId || null,
    persId: emp.persId || null,
  });
}

function finalizeLogin(user) {
  appState.currentUser = user;
  appState.currentView = "dashboard";
  appState.activeMachineId = null;
  appState.activeOrderId = null;

  safeHide("loginView", true);
  safeHide("adminLoginDialog", true);

  const greet = document.getElementById("userGreeting");
  if (greet) {
    greet.textContent = `Angemeldet: ${user.name}`;
  }

  const isAdmin = user.role === "admin";
  const ac = document.getElementById("adminControls");
  if (ac) ac.style.display = isAdmin ? "flex" : "none";

  saveData(false);
  renderView();
}

function logout() {
  appState.currentUser = null;
  appState.currentView = "login";
  appState.activeMachineId = null;
  appState.activeOrderId = null;
  loginSelectedDeptId = null;
  saveData(false);
  showLoginScreen();
}

// ==========================
//   VIEW-STEUERUNG
// ==========================

function renderView() {
  if (!appState.currentUser) {
    showLoginScreen();
    return;
  }

  const machine = appState.machines.find(
    (m) => m.id === appState.activeMachineId
  );

  if (
    appState.currentView === "production" &&
    machine &&
    machine.activeOrderIds.length > 0
  ) {
    if (
      !appState.activeOrderId ||
      !machine.activeOrderIds.includes(appState.activeOrderId)
    ) {
      appState.activeOrderId = machine.activeOrderIds[0];
    }
    showProductionScreen(machine);
  } else {
    showDashboardScreen();
  }
}

// ==========================
//   DASHBOARD
// ==========================

function showDashboardScreen() {
  appState.currentView = "dashboard";

  safeHide("loginView", true);
  safeHide("dashboardView", false);
  safeHide("productionView", true);
  safeHide("productionFooter", true);
  safeHide("totalDisplay", true);

  const headerNav = document.getElementById("headerNav");
  if (headerNav) {
    headerNav.innerHTML = `
            <button onclick="goToDashboard()"
                    class="flex items-center gap-2 bg-brand text-white border border-brand px-3 py-2 rounded font-bold text-xs sm:text-sm uppercase tracking-wide hover:bg-brandDark transition">
                ÜBERSICHT
            </button>
        `;
  }

  const container = document.getElementById("dashboardContent");
  const emptyState = document.getElementById("emptyState");
  if (!container) return;

  container.innerHTML = "";

  const canViewAll =
    appState.currentUser &&
    (appState.currentUser.role === "admin" || !appState.currentUser.deptId);

  let hasMachines = false;

  appState.departments.forEach((dept) => {
    if (!canViewAll && dept.id !== appState.currentUser.deptId) return;

    const machines = appState.machines.filter((m) => m.deptId === dept.id);
    if (machines.length === 0 && !canViewAll) return;

    const section = document.createElement("div");
    section.innerHTML = `
            <h3 class="text-lg font-bold text-brand border-b border-brand/30 mb-3 pb-1 uppercase">
                ${dept.name}
            </h3>
        `;

    const grid = document.createElement("div");
    grid.className =
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4";

    if (machines.length === 0) {
      grid.innerHTML =
        '<div class="text-slate-400 text-sm italic">Keine Maschinen</div>';
    } else {
      hasMachines = true;
      machines.forEach((m) => {
        const activeCount = (m.activeOrderIds && m.activeOrderIds.length) || 0;
        const div = document.createElement("div");
        div.className =
          "p-5 rounded-xl border-2 transition cursor-pointer relative group flex flex-col justify-between min-h-[160px] " +
          (activeCount > 0
            ? "bg-white border-brand shadow-md hover:-translate-y-1"
            : "bg-white border-slate-300 hover:border-slate-400");

        div.onclick = function () {
          if (activeCount > 0) {
            appState.activeMachineId = m.id;
            appState.activeOrderId = m.activeOrderIds[0];
            appState.currentView = "production";
            saveData(false);
            renderView();
          } else {
            openNewOrderDialog(m.id);
          }
        };

        const statusHtml =
          activeCount > 0
            ? `<span class="bg-brandLight text-brand text-xs font-bold px-2 py-1 rounded border border-brand">${activeCount} Auftrag</span>`
            : `<span class="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded border border-slate-300">Leerlauf</span>`;

        let preview = "";
        if (activeCount > 0) {
          const ordersPreview = m.activeOrderIds
            .slice(0, 2)
            .map((oid) => {
              const o = appState.orders.find((x) => x.id === oid);
              if (!o)
                return '<div class="text-sm text-slate-400">Unbekannter Auftrag</div>';
              return `<div class="text-xs font-mono font-bold text-slate-600">BA ${o.baNumber}</div>`;
            })
            .join("");
          preview = `<div class="mt-4 pt-2 border-t border-slate-100">${ordersPreview}</div>`;
        } else {
          preview = `
                        <div class="flex-grow flex items-center justify-center opacity-30">
                            <svg class="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                            </svg>
                        </div>
                    `;
        }

        div.innerHTML = `
                    <div class="flex justify-between items-start">
                        <h3 class="text-2xl font-black text-slate-800 truncate pr-2">${m.id}</h3>
                        ${statusHtml}
                    </div>
                    ${preview}
                `;
        grid.appendChild(div);
      });
    }

    section.appendChild(grid);
    container.appendChild(section);
  });

  if (emptyState) {
    emptyState.classList.toggle("hidden", hasMachines);
  }
}

// ==========================
//   PRODUCTION VIEW
// ==========================

function showProductionScreen(machine) {
  safeHide("loginView", true);
  safeHide("dashboardView", true);
  safeHide("productionView", false);
  safeHide("productionFooter", false);
  safeHide("totalDisplay", false);

  const order = appState.orders.find((o) => o.id === appState.activeOrderId);

  // HEADER LINKS (Übersicht + Maschine + BA-Stückzahl/Diff)
  const headerNav = document.getElementById("headerNav");
  if (headerNav) {
    const baInfoHtml = buildBaInfoHtml(order);

    headerNav.innerHTML = `
            <button onclick="goToDashboard()"
                    class="flex items-center gap-2 bg-white text-brand border border-brand px-3 py-2 rounded font-bold text-xs sm:text-sm uppercase tracking-wide hover:bg-brandLight transition">
                ÜBERSICHT
            </button>
            <div class="h-8 w-px bg-slate-300 mx-1 hidden sm:block"></div>
            <div class="flex flex-col">
                <span class="text-[10px] uppercase font-bold text-slate-500 leading-none">Maschine</span>
                <span class="text-2xl font-black text-brand leading-none truncate max-w-[120px]">
                    ${machine.id}
                </span>
            </div>
            ${baInfoHtml}
        `;
  }

  // Tabs (BA ...)
  const tabs = document.getElementById("orderTabs");
  if (tabs) {
    tabs.innerHTML = "";
    machine.activeOrderIds.forEach((oid) => {
      const o = appState.orders.find((x) => x.id === oid);
      if (!o) return;
      const btn = document.createElement("button");
      const active = oid === appState.activeOrderId;
      btn.className =
        "flex-shrink-0 px-5 py-2 rounded-t-lg text-sm font-bold transition border-t-2 border-x-2 " +
        (active
          ? "bg-white text-brand border-brand relative top-[2px] z-10"
          : "bg-slate-200 text-slate-500 border-transparent hover:bg-slate-300");
      btn.textContent = `BA ${o.baNumber}`;
      btn.onclick = () => {
        appState.activeOrderId = oid;
        saveData(false);
        renderView();
      };
      tabs.appendChild(btn);
    });
  }

  if (order) {
    const dBA = document.getElementById("displayBA");
    const dArt = document.getElementById("displayArt");
    if (dBA) dBA.textContent = order.baNumber || "--";
    if (dArt) dArt.textContent = order.articleNumber || "--";

    renderStations(order);
    refreshTotals(order);
    renderMachine50StorageOverview(order);
    updateChainButton(order); // Icon passend setzen
  } else {
    updateChainButton(null);
  }
}

function toggleChainLogic() {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;

  order.useChainLogic = order.useChainLogic === false ? true : false;

  saveData();
  updateChainButton(order);
}

function goToDashboard() {
  appState.currentView = "dashboard";
  appState.activeMachineId = null;
  appState.activeOrderId = null;
  saveData(false);
  renderView();
}

// ==========================
//   STATIONEN / ZÄHLER
// ==========================

// Hilfsfunktionen für Stückzahlen / Restmengen

// Gesamtzahl fertig produzierter Teile (aktuelle Zähler + Historie)
function computeGrandTotal(order) {
  if (!order || !Array.isArray(order.stations)) return 0;

  let total = 0;

  order.stations.forEach((s) => {
    if (s.counts) {
      Object.values(s.counts).forEach((v) => {
        total += Number(v) || 0;
      });
    }
  });

  if (Array.isArray(order.history)) {
    order.history.forEach((h) => {
      total += Number(h.count) || 0;
    });
  }

  return total;
}

// Wert für die Anzeige oben rechts:
// - wenn targetQuantity > 0: Restmenge = Ziel - produziert
// - sonst: produzierte Menge (wie früher)
function getHeaderDisplayTotal(order, producedTotal) {
  if (!order) return 0;

  const produced =
    typeof producedTotal === "number"
      ? producedTotal
      : computeGrandTotal(order);

  const target = Number(order.targetQuantity) || 0;

  if (!target || target <= 0) {
    return produced;
  }

  const remaining = target - produced;
  return remaining >= 0 ? remaining : 0;
}

// Hilfsfunktion, damit alte Aufrufe weiter funktionieren
function updateHeaderAndFooter(order) {
  refreshTotals(order);
}

// HTML-Block für BA-Stückzahl + Differenz im Header
function buildBaInfoHtml(order) {
  if (!order || !order.baQuantity || order.baQuantity <= 0) return "";

  const baQty = order.baQuantity;
  const target = order.targetQuantity || 0;

  let diffHtml = "";
  if (target > 0) {
    const diff = target - baQty;

    if (diff > 0) {
      diffHtml = ` <span class="text-[10px] text-emerald-600 font-bold">(+${diff})</span>`;
    } else if (diff < 0) {
      diffHtml = ` <span class="text-[10px] text-red-600 font-bold">(${Math.abs(
        diff
      )}-)</span>`;
    }
  }

  return `
        <div class="hidden sm:flex flex-col ml-4">
            <span class="text-[10px] uppercase font-bold text-slate-500 leading-none">
                BA Stückzahl
            </span>
            <span class="text-sm font-bold text-slate-800 leading-none">
                ${baQty.toLocaleString("de-DE")}${diffHtml}
            </span>
        </div>
    `;
}

function renderStations(order) {
  const grid = document.getElementById("stationGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!order || !order.stations) return;

  const lastStationId =
    order.stations.length > 0
      ? order.stations[order.stations.length - 1].id
      : null;

  order.stations.forEach((s) => {
    let total = 0;
    if (s.counts) Object.values(s.counts).forEach((v) => (total += v || 0));

    const isLastStation = s.id === lastStationId;

    const div = document.createElement("div");
    div.className =
      "bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden";

    const canRename =
      appState.currentUser &&
      appState.currentUser.role === "admin" &&
      !s.lockName;

    const nameHtml = canRename
      ? `<button onclick="openNameDialog(${s.id})" class="font-black text-slate-800 hover:text-brand text-lg">Spannung ${s.id}</button>`
      : `<span class="font-black text-slate-800 text-lg">Spannung ${s.id}</span>`;

    const canDelete = canDeleteStation(order, s.id);
    let deleteHtml = "";
    if (canDelete) {
      deleteHtml = `
                <button onclick="removeStation(${s.id})"
                        class="w-8 h-8 flex items-center justify-center rounded-full border-2 border-red-200 text-red-500 hover:bg-red-50"
                        title="Spannung löschen (nur wenn keine Stücke / Ausschuss / Abklärung)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18" stroke-linecap="round"/>
                        <path d="M8 6V4h8v2" stroke-linecap="round"/>
                        <path d="M10 11v6" stroke-linecap="round"/>
                        <path d="M14 11v6" stroke-linecap="round"/>
                        <rect x="6" y="6" width="12" height="14" rx="1" ry="1"/>
                    </svg>
                </button>
            `;
    }

    const scrapTotal = typeof s.scrapTotal === "number" ? s.scrapTotal : 0;
    const clarTotal = typeof s.clarifyTotal === "number" ? s.clarifyTotal : 0;

    const headerTop = `
            <div class="bg-slate-50 px-3 py-2 border-b border-slate-200">
                <div class="flex justify-between items-start gap-4">
                    <div class="flex flex-col gap-1">
                        <div>${nameHtml}</div>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="flex flex-col gap-1 min-w-[180px]">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[10px] uppercase font-bold text-amber-600 tracking-wide">
                                    IN ABKLÄRUNG (${clarTotal})
                                </span>
                                <div class="flex items-center gap-1">
                                    <button onclick="changeClarify(${s.id}, -1)"
                                            class="w-7 h-7 rounded-full border border-amber-400 text-amber-500 flex items-center justify-center text-lg font-bold hover:bg-amber-50">
                                        -
                                    </button>
                                    <button onclick="changeClarify(${s.id}, 1)"
                                            class="w-7 h-7 rounded-full border border-amber-400 text-amber-500 flex items-center justify-center text-lg font-bold hover:bg-amber-50">
                                        +
                                    </button>
                                </div>
                            </div>
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[10px] uppercase font-bold text-red-600 tracking-wide">
                                    AUSSCHUSS (${scrapTotal})
                                </span>
                                <div class="flex items-center gap-1">
                                    <button onclick="changeScrap(${s.id}, -1)"
                                            class="w-7 h-7 rounded-full border border-red-400 text-red-500 flex items-center justify-center text-lg font-bold hover:bg-red-50">
                                        -
                                    </button>
                                    <button onclick="changeScrap(${s.id}, 1)"
                                            class="w-7 h-7 rounded-full border border-red-400 text-red-500 flex items-center justify-center text-lg font-bold hover:bg-red-50">
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>
                        ${deleteHtml}
                    </div>
                </div>
            </div>
        `;

    let rows = `<div class="p-2 space-y-2 bg-white">`;

    if (order.employees && order.employees.length > 0) {
      order.employees.forEach((e, idx) => {
        const c = (s.counts && s.counts[e.id]) || 0;

        const showChain = isLastStation && idx === 0;

        rows += `
                    <div class="flex justify-between items-center bg-white rounded border border-slate-200 p-2">
                        <div class="min-w-0 flex-1">
                            <div class="font-bold text-sm text-slate-700">${
                              e.name
                            }</div>
                        </div>
                        <div class="flex items-center gap-2">
                            ${
                              showChain
                                ? `
                            <button id="chainToggleButton"
                                    onclick="toggleChainLogic()"
                                    class="flex items-center justify-center w-9 h-9 rounded-full border text-xs">
                            </button>
                            `
                                : ""
                            }
                            <button onclick="changeCount(${s.id}, '${
          e.id
        }', -1)"
                                    class="w-9 h-9 bg-slate-100 border border-slate-300 rounded hover:border-red-400 hover:text-red-500 font-bold">
                                -
                            </button>
                            <span class="w-10 text-center font-mono font-bold text-lg">${c}</span>
                            <button onclick="changeCount(${s.id}, '${e.id}', 1)"
                                    class="w-9 h-9 bg-brand text-white border border-brand rounded hover:bg-brandDark font-bold">
                                +
                            </button>
                        </div>
                    </div>
                `;
      });
    } else {
      rows += `
                <div class="text-sm text-slate-400 italic px-2 py-4">
                    Noch keine Mitarbeiter zugeordnet.
                </div>
            `;
    }

    rows += `</div>`;

    div.innerHTML = headerTop + rows;
    grid.appendChild(div);
  });

  updateChainButton(order);
}

function canDeleteStation(order, stationId) {
  if (!order || !order.stations) return false;
  const idx = order.stations.findIndex((s) => s.id === stationId);
  if (idx === -1) return false;

  if (idx !== order.stations.length - 1) return false;

  const s = order.stations[idx];
  let sumCounts = 0;
  if (s.counts) Object.values(s.counts).forEach((v) => (sumCounts += v || 0));

  const scrap = typeof s.scrapTotal === "number" ? s.scrapTotal : 0;
  const clarify = typeof s.clarifyTotal === "number" ? s.clarifyTotal : 0;

  return sumCounts === 0 && scrap === 0 && clarify === 0;
}

function removeStation(stationId) {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;

  const can = canDeleteStation(order, stationId);
  if (!can) {
    alert(
      "Spannung kann nur gelöscht werden, wenn sie die letzte ist und keine Stücke / Ausschuss / Abklärung enthält."
    );
    return;
  }

  if (
    !confirm(
      `Spannung ${stationId} wirklich entfernen? Es dürfen noch keine Stücke gezählt sein.`
    )
  ) {
    return;
  }

  order.stations = order.stations.filter((s) => s.id !== stationId);

  saveData();
  renderStations(order);
  refreshTotals(order);
}

// Hilfsfunktion: benutzt für die Limits auf Basis "Stückzahl zu fertigen"
function getTotalsForLimits(order) {
  const target = Number(order.targetQuantity) || 0;
  const perStation = {};
  let globalUsed = 0;

  if (!order || !order.stations) {
    return { target, globalUsed: 0, perStation };
  }

  order.stations.forEach((s) => {
    let good = 0;
    if (s.counts) {
      Object.values(s.counts).forEach((v) => {
        good += Number(v) || 0;
      });
    }
    const scrap = Number(s.scrapTotal) || 0;
    const clarify = Number(s.clarifyTotal) || 0;

    const used = good + scrap + clarify;
    perStation[s.id] = { good, scrap, clarify, used };
    globalUsed += used;
  });

  return { target, globalUsed, perStation };
}

// Liefert pro Spannung die Gesamtzahl der Gutteile (aktuelle Zähler + Historie)
function computePerStationGood(order) {
  const result = {};
  if (!order || !Array.isArray(order.stations)) return result;

  const historyByStation = {};
  if (Array.isArray(order.history)) {
    order.history.forEach((h) => {
      const sid = h.stationId;
      const val = Number(h.count) || 0;
      if (!historyByStation[sid]) historyByStation[sid] = 0;
      historyByStation[sid] += val;
    });
  }

  order.stations.forEach((s) => {
    let good = 0;

    if (s.counts) {
      Object.values(s.counts).forEach((v) => {
        good += Number(v) || 0;
      });
    }

    if (historyByStation[s.id]) {
      good += historyByStation[s.id];
    }

    result[s.id] = good;
  });

  return result;
}

function changeCount(stationId, empId, delta) {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;
  const station = order.stations.find((s) => s.id === stationId);
  if (!station) return;

  if (!station.counts) station.counts = {};
  const oldVal = Number(station.counts[empId]) || 0;

  if (delta < 0 && oldVal <= 0) {
    return;
  }

  const { target, globalUsed, perStation } = getTotalsForLimits(order);
  const perStationGood = computePerStationGood(order);
  const info = perStation[stationId] || { used: 0 };
  const currentGood = perStationGood[stationId] || 0;
  const idx = order.stations.findIndex((s) => s.id === stationId);
  const inc = delta > 0 ? delta : 0;
  const deltaUsed = delta;
  const useChain = order.useChainLogic !== false;

  // 1) PLUS
  if (inc > 0) {
    // a) Kettenlogik (nur wenn aktiv)
    if (useChain && idx > 0) {
      const prevStation = order.stations[idx - 1];
      const prevGood = perStationGood[prevStation.id] || 0;

      if (info.used + inc > prevGood) {
        alert(
          `In Spannung ${stationId} können nicht mehr Teile erfasst werden, ` +
            `als in Spannung ${prevStation.id} gut gemeldet wurden.`
        );
        return;
      }
    }

    // b) Ziel-Stückzahl (immer, aber nur pro Spannung)
    if (target > 0) {
      if (info.used + inc > target) {
        alert(
          "In dieser Spannung können nicht mehr Teile erfasst werden " +
            "als die zu fertigende Stückzahl."
        );
        return;
      }
      // Keine globale Begrenzung mehr über alle Spannungen:
      // Jede Spannung darf bis zur Zielstückzahl zählen,
      // begrenzt nur durch die Verkettungslogik.
    }
  }

  // 2) MINUS – nur Kettenlogik prüfen, falls aktiv
  if (deltaUsed < 0 && useChain) {
    const newGood = currentGood + delta; // delta ist negativ

    if (idx < order.stations.length - 1) {
      let maxUsedAfter = 0;
      for (let i = idx + 1; i < order.stations.length; i++) {
        const sid = order.stations[i].id;
        const inf = perStation[sid] || { used: 0 };
        if (inf.used > maxUsedAfter) maxUsedAfter = inf.used;
      }

      if (newGood < maxUsedAfter) {
        alert(
          `In Spannung ${stationId} können aktuell keine Teile abgezogen werden, ` +
            `weil nachfolgende Spannungen bereits mehr Teile erfasst haben.`
        );
        return;
      }
    }
  }

  let newVal = oldVal + delta;
  if (newVal < 0) newVal = 0;
  station.counts[empId] = newVal;

  saveData(false);

  renderStations(order);
  updateHeaderAndFooter(order);

  // Lagerort-/Palettenlogik für Maschine 50 ist vorerst deaktiviert
}

// ==========================
//   QA-Mitarbeiter-Dialog
// ==========================

function getOrCreateQaDialog() {
  let dlg = document.getElementById("qaEmployeeDialog");
  if (dlg) return dlg;

  dlg = document.createElement("div");
  dlg.id = "qaEmployeeDialog";
  dlg.className =
    "fixed inset-0 bg-black/40 z-[999] hidden items-center justify-center";

  dlg.innerHTML = `
        <div class="bg-white rounded-xl shadow-soft max-w-sm w-full p-6 mx-3">
            <h3 id="qaDialogTitle" class="text-lg font-black text-slate-800 mb-4">
                Mitarbeiter wählen
            </h3>
            <div id="qaDialogBody" class="space-y-2 max-h-64 overflow-y-auto"></div>
            <div class="flex justify-end mt-4">
                <button id="qaDialogCancel"
                        class="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">
                    Abbrechen
                </button>
            </div>
        </div>
    `;

  document.body.appendChild(dlg);

  const cancelBtn = dlg.querySelector("#qaDialogCancel");
  cancelBtn.onclick = () => {
    dlg.classList.add("hidden");
    dlg.classList.remove("flex");
    if (qaDialogResolve) {
      qaDialogResolve(null);
      qaDialogResolve = null;
    }
  };

  return dlg;
}

// ==========================
//   URSACHEN-DIALOG (6M, 2-stufig)
// ==========================

// ==========================
//   URSACHEN-DIALOG (6M, 2-stufig)
// ==========================

function getOrCreateCauseDialog() {
  let dlg = document.getElementById("qaCauseDialog");
  if (dlg) return dlg;

  dlg = document.createElement("div");
  dlg.id = "qaCauseDialog";
  dlg.className =
    "fixed inset-0 bg-black/40 z-[999] hidden items-center justify-center";

  dlg.innerHTML = `
        <div class="bg-white rounded-xl shadow-soft max-w-sm w-full p-6 mx-3">
            <h3 id="qaCauseTitle" class="text-lg font-black text-slate-800 mb-4">
                Ursache auswählen
            </h3>
            <div id="qaCauseBody" class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4"></div>
            <div class="flex justify-between items-center">
                <button id="qaCauseBack"
                        class="px-3 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 hidden">
                    ← Zurück
                </button>
                <button id="qaCauseCancel"
                        class="ml-auto px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">
                    Abbrechen
                </button>
            </div>
        </div>
    `;

  document.body.appendChild(dlg);
  return dlg;
}

/**
 * Wählt erst eine 6M-Kategorie (Mensch, Maschine, ...),
 * dann einen konkreten Fehlergrund.
 */
function pickCauseForQA(mode) {
  return new Promise((resolve) => {
    const dlg = getOrCreateCauseDialog();
    const titleEl = dlg.querySelector("#qaCauseTitle");
    const bodyEl = dlg.querySelector("#qaCauseBody");
    const btnCancel = dlg.querySelector("#qaCauseCancel");
    const btnBack = dlg.querySelector("#qaCauseBack");

    const modeLabel = mode === "scrap" ? "Ausschuss" : "Abklärung";

    function close(result) {
      dlg.classList.add("hidden");
      dlg.classList.remove("flex");
      qaCauseResolve = null;
      resolve(result);
    }

    function showCategoryStep() {
      titleEl.textContent = `Ursache für ${modeLabel} wählen`;
      btnBack.classList.add("hidden");

      bodyEl.innerHTML = "";
      QA_CAUSE_GROUPS.forEach((grp) => {
        const btn = document.createElement("button");
        btn.className =
          "w-full text-left px-3 py-2 rounded border border-slate-200 " +
          "hover:bg-brandLight text-sm font-bold";
        btn.innerHTML = `
                    <span>${grp.label}</span>
                `;
        btn.onclick = () => showReasonStep(grp);
        bodyEl.appendChild(btn);
      });
    }

    function showReasonStep(group) {
      titleEl.textContent = `${group.label} – Fehler auswählen`;
      btnBack.classList.remove("hidden");

      bodyEl.innerHTML = "";
      group.reasons.forEach((r) => {
        const btn = document.createElement("button");
        btn.className =
          "w-full text-left px-3 py-2 rounded border border-slate-200 " +
          "hover:bg-brandLight text-sm";
        btn.innerHTML = `
                    <span class="font-bold">${r.label}</span>
                `;
        btn.onclick = () => {
          close({
            categoryId: group.id,
            categoryLabel: group.label,
            reasonId: r.id,
            reasonLabel: r.label,
          });
        };
        bodyEl.appendChild(btn);
      });

      btnBack.onclick = () => {
        showCategoryStep();
      };
    }

    btnCancel.onclick = () => {
      close(null);
    };

    qaCauseResolve = resolve;
    showCategoryStep();

    dlg.classList.remove("hidden");
    dlg.classList.add("flex");
  });
}

function pickEmployeeForQA(order, stationId, mode) {
  return new Promise((resolve) => {
    const empList = order.employees || [];
    if (empList.length === 0) {
      alert("Keine Mitarbeiter im Auftrag hinterlegt.");
      resolve(null);
      return;
    }

    const dlg = getOrCreateQaDialog();
    const titleEl = dlg.querySelector("#qaDialogTitle");
    const bodyEl = dlg.querySelector("#qaDialogBody");

    const title =
      mode === "scrap"
        ? `Ausschuss melden (Spannung ${stationId})`
        : `Teil in Abklärung (Spannung ${stationId})`;

    titleEl.textContent = title;
    bodyEl.innerHTML = "";

    empList.forEach((e) => {
      const btn = document.createElement("button");
      btn.className =
        "w-full text-left px-3 py-2 rounded border border-slate-200 " +
        "hover:bg-brandLight text-sm flex justify-between items-center";
      btn.innerHTML = `
                <span class="font-bold">${e.name}</span>
                <span class="text-xs text-slate-400">${e.persId || ""}</span>
            `;
      btn.onclick = () => {
        dlg.classList.add("hidden");
        dlg.classList.remove("flex");
        if (qaDialogResolve) {
          qaDialogResolve(e);
          qaDialogResolve = null;
        }
      };
      bodyEl.appendChild(btn);
    });

    qaDialogResolve = resolve;
    dlg.classList.remove("hidden");
    dlg.classList.add("flex");
  });
}

// ==========================
//   AUSSCHUSS
// ==========================

async function changeScrap(stationId, delta) {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;
  const station = order.stations.find((s) => s.id === stationId);
  if (!station) return;

  const emp = await pickEmployeeForQA(order, stationId, "scrap");
  if (!emp) return;

  let causeInfo = null;
  if (delta > 0 && typeof pickCauseForQA === "function") {
    try {
      const picked = await pickCauseForQA("scrap");
      if (!picked) return;
      causeInfo = picked;
    } catch (e) {
      console.warn("Fehler im Ursachen-Dialog (Ausschuss):", e);
    }
  }

  try {
    const { target, perStation } = getTotalsForLimits(order);
    const info = perStation[stationId] || { used: 0 };
    const inc = delta > 0 ? delta : 0;

    if (inc > 0 && target > 0) {
      if (info.used + inc > target) {
        alert(
          "In dieser Spannung können nicht mehr Teile (inkl. Ausschuss) erfasst werden als die zu fertigende Stückzahl."
        );
        return;
      }
    }
  } catch (e) {
    console.warn("Limit-Prüfung Ausschuss fehlgeschlagen:", e);
  }

  // Kettenlogik auch für Ausschuss/Abklärung: In Spannung X darf (Gut+Abklärung+Ausschuss) nicht größer sein
  // als die Gutteile der vorherigen Spannung.
  try {
    const useChain = order.useChainLogic !== false;
    if (delta > 0 && useChain) {
      const idx = order.stations.findIndex((s) => s.id === stationId);
      if (idx > 0) {
        const prevStation = order.stations[idx - 1];
        const perGood = computePerStationGood(order);
        const prevGood = Number(perGood[prevStation.id]) || 0;

        const totals = getTotalsForLimits(order);
        const thisInfo =
          totals && totals.perStation && totals.perStation[stationId]
            ? totals.perStation[stationId]
            : { used: 0 };
        const thisUsed = Number(thisInfo.used) || 0;

        if (thisUsed + (Number(delta) || 0) > prevGood) {
          alert(
            `In Spannung ${stationId} kann kein Teil erfasst werden, ` +
              `weil in Spannung ${prevStation.id} noch keine Gutteile vorhanden sind.`
          );
          return;
        }
      }
    }
  } catch (e) {
    console.warn("Kettenlogik-Prüfung fehlgeschlagen:", e);
  }

  if (!station.scrap) station.scrap = {};
  if (!Array.isArray(station.scrapLog)) station.scrapLog = [];
  if (typeof station.scrapTotal !== "number") station.scrapTotal = 0;

  const newTotal = (station.scrapTotal || 0) + delta;
  if (newTotal < 0) {
    alert("Negativer Ausschuss nicht möglich.");
    return;
  }

  const newEmpVal = (station.scrap[emp.id] || 0) + delta;
  if (newEmpVal < 0) {
    alert("Negativer Ausschuss pro Mitarbeiter nicht möglich.");
    return;
  }

  station.scrap[emp.id] = newEmpVal;
  station.scrapTotal = newTotal;

  station.scrapLog.push({
    empId: emp.id,
    delta,
    timestamp: new Date().toISOString(),
    causeCategory: causeInfo ? causeInfo.categoryId : null,
    causeCategoryLabel: causeInfo ? causeInfo.categoryLabel : null,
    causeReason: causeInfo ? causeInfo.reasonId : null,
    causeReasonLabel: causeInfo ? causeInfo.reasonLabel : null,
  });

  saveData(false);
  renderStations(order);
  updateHeaderAndFooter(order);
}

// ==========================
//   IN ABKLÄRUNG
// ==========================

async function changeClarify(stationId, delta) {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;
  const station = order.stations.find((s) => s.id === stationId);
  if (!station) return;

  if (!station.clarify) station.clarify = {};
  if (!Array.isArray(station.clarifyLog)) station.clarifyLog = [];
  if (typeof station.clarifyTotal !== "number") station.clarifyTotal = 0;

  const emp = await pickEmployeeForQA(order, stationId, "clarify");
  if (!emp) return;

  let causeInfo = null;
  if (delta > 0 && typeof pickCauseForQA === "function") {
    try {
      const picked = await pickCauseForQA("clarify");
      if (!picked) return;
      causeInfo = picked;
    } catch (e) {
      console.warn("Fehler im Ursachen-Dialog (Abklärung):", e);
    }
  }

  try {
    const { target, perStation } = getTotalsForLimits(order);
    const info = perStation[stationId] || { used: 0 };
    const inc = delta > 0 ? delta : 0;

    if (inc > 0 && target > 0) {
      if (info.used + inc > target) {
        alert(
          "In dieser Spannung können nicht mehr Teile (inkl. Abklärung) erfasst werden als die zu fertigende Stückzahl."
        );
        return;
      }
    }
  } catch (e) {
    console.warn("Limit-Prüfung Abklärung fehlgeschlagen, zähle trotzdem:", e);
  }

  // Kettenlogik auch für Ausschuss/Abklärung: In Spannung X darf (Gut+Abklärung+Ausschuss) nicht größer sein
  // als die Gutteile der vorherigen Spannung.
  try {
    const useChain = order.useChainLogic !== false;
    if (delta > 0 && useChain) {
      const idx = order.stations.findIndex((s) => s.id === stationId);
      if (idx > 0) {
        const prevStation = order.stations[idx - 1];
        const perGood = computePerStationGood(order);
        const prevGood = Number(perGood[prevStation.id]) || 0;

        const totals = getTotalsForLimits(order);
        const thisInfo =
          totals && totals.perStation && totals.perStation[stationId]
            ? totals.perStation[stationId]
            : { used: 0 };
        const thisUsed = Number(thisInfo.used) || 0;

        if (thisUsed + (Number(delta) || 0) > prevGood) {
          alert(
            `In Spannung ${stationId} kann kein Teil erfasst werden, ` +
              `weil in Spannung ${prevStation.id} noch keine Gutteile vorhanden sind.`
          );
          return;
        }
      }
    }
  } catch (e) {
    console.warn("Kettenlogik-Prüfung fehlgeschlagen:", e);
  }

  if (delta > 0) {
    if (
      !confirm(
        `Teil für Abklärung von ${emp.name} (PersNr ${emp.persId}) markieren?`
      )
    ) {
      return;
    }
    station.clarify[emp.id] = (station.clarify[emp.id] || 0) + 1;
    station.clarifyTotal += 1;

    station.clarifyLog.push({
      empId: emp.id,
      delta: +1,
      timestamp: new Date().toISOString(),
      causeCategory: causeInfo ? causeInfo.categoryId : null,
      causeCategoryLabel: causeInfo ? causeInfo.categoryLabel : null,
      causeReason: causeInfo ? causeInfo.reasonId : null,
      causeReasonLabel: causeInfo ? causeInfo.reasonLabel : null,
    });
  } else if (delta < 0) {
    if (station.clarify[emp.id] > 0) {
      if (!confirm(`Abklärungs-Teil von ${emp.name} als Gutteil buchen?`)) {
        return;
      }

      station.clarify[emp.id] -= 1;
      station.clarifyTotal -= 1;

      station.clarifyLog.push({
        empId: emp.id,
        delta: -1,
        timestamp: new Date().toISOString(),
        causeCategory: null,
        causeCategoryLabel: null,
        causeReason: null,
        causeReasonLabel: null,
      });

      if (!station.counts) station.counts = {};
      station.counts[emp.id] = (station.counts[emp.id] || 0) + 1;
    } else {
      alert(
        "Keine Teile in Abklärung für diesen Mitarbeiter, die zurückgebucht werden können."
      );
      return;
    }
  }

  saveData(false);
  renderStations(order);
  updateHeaderAndFooter(order);
}

// ==========================
//   FOOTER-ZÄHLER
// ==========================

function renderFooterTotals(order, grandTotalValue) {
  const container = document.getElementById("footerCounters");
  if (!container) return;

  if (!order || !order.stations) {
    container.innerHTML = "";
    return;
  }

  const historyByStation = {};
  if (order.history && Array.isArray(order.history)) {
    order.history.forEach((h) => {
      const sid = h.stationId;
      if (!historyByStation[sid]) historyByStation[sid] = {};
      if (!historyByStation[sid][h.empId]) historyByStation[sid][h.empId] = 0;
      historyByStation[sid][h.empId] += h.count || 0;
    });
  }

  const perStationTotals = order.stations.map((s) => {
    let sum = 0;

    if (s.counts) {
      Object.values(s.counts).forEach((v) => (sum += v || 0));
    }

    if (historyByStation[s.id]) {
      Object.values(historyByStation[s.id]).forEach((v) => (sum += v || 0));
    }

    const scrap = Number(s.scrapTotal) || 0;

    const clarify = Number(s.clarifyTotal) || 0;

    return { id: s.id, total: sum, scrap, clarify };
  });

  let html = '<div class="flex items-end gap-6">';

  perStationTotals.forEach((sTot) => {
    html += `
            <div class="flex flex-col items-center">
                <span class="text-[11px] uppercase font-bold text-slate-400 tracking-wide">SP_${sTot.id}</span>
                <div class="flex items-baseline gap-2">
                    <span class="text-3xl font-bold text-slate-700 leading-none">${sTot.total}</span>
                    <div class="flex items-baseline gap-1 text-xs font-bold">
                        <span class="text-amber-500 leading-none">${sTot.clarify}</span>
                        <span class="text-red-600 leading-none">${sTot.scrap}</span>
                    </div>
                </div>
            </div>
        `;
  });

  html += `
        <div class="flex flex-col items-end pl-4 border-l border-slate-200">
            <span class="text-[11px] uppercase font-bold text-slate-500 tracking-wide">Gesamt</span>
            <span class="text-4xl font-black text-brand leading-none">
                ${(grandTotalValue || 0).toLocaleString("de-DE")}
            </span>
        </div>
    `;

  html += "</div>";
  html += "</div>";

  // Letzte Ausschussmeldung (wie früher in der Fußzeile)

  container.innerHTML = html;
}

// Restzähler oben rechts (OFFEN) – berücksichtigt Gutteile letzte Spannung + Ausschuss aller Spannungen
function refreshTotals(order) {
  const grandEl = document.getElementById("grandTotal");

  if (!order) {
    if (grandEl) grandEl.textContent = "0";
    renderFooterTotals(null, 0);
    updateChainButton(null);
    return;
  }

  // letzte Spannung ermitteln
  let lastStation = null;
  if (Array.isArray(order.stations) && order.stations.length > 0) {
    lastStation = order.stations[order.stations.length - 1];
  }

  // Gutteile in der letzten Spannung (inkl. Historie)
  let goodTotalLast = 0;
  if (lastStation) {
    const lastId = lastStation.id;

    if (lastStation.counts) {
      Object.values(lastStation.counts).forEach((v) => {
        goodTotalLast += Number(v) || 0;
      });
    }

    if (Array.isArray(order.history)) {
      order.history.forEach((h) => {
        if (h.stationId === lastId) {
          goodTotalLast += Number(h.count) || 0;
        }
      });
    }
  }

  // Ausschuss über ALLE Spannungen summieren
  let scrapAll = 0;
  if (Array.isArray(order.stations)) {
    order.stations.forEach((s) => {
      scrapAll +=
        Number(typeof s.scrapTotal === "number" ? s.scrapTotal : 0) || 0;
    });
  }

  const targetRaw = order.targetQuantity || order.baQuantity || 0;
  const target = Number(targetRaw) || 0;

  // verarbeitet = Gutteile letzte Spannung + Ausschuss alle Spannungen
  const processed = goodTotalLast + scrapAll;

  let headerVal;
  if (target > 0) {
    const remaining = target - processed;
    headerVal = remaining > 0 ? remaining : 0;
  } else {
    headerVal = processed;
  }

  if (grandEl) {
    grandEl.textContent = headerVal.toLocaleString("de-DE");
  }

  // Fußzeile: weiterhin Gesamt-Gutteile der letzten Spannung anzeigen
  renderFooterTotals(order, goodTotalLast);
  updateChainButton(order);
}

function updateChainButton(order) {
  const btn = document.getElementById("chainToggleButton");
  if (!btn) return;

  const active = order ? order.useChainLogic !== false : true;

  btn.title = active
    ? "Verkettungslogik aktiv"
    : "Verkettungslogik deaktiviert";

  btn.className =
    "flex items-center justify-center w-9 h-9 rounded-full border text-xs " +
    (active
      ? "border-emerald-500 text-emerald-700 bg-emerald-100"
      : "border-red-400 text-red-600 bg-red-100");

  btn.innerHTML = active
    ? `
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4"
             viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 7l3-3a4 4 0 015.7 5.7L14 12" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 10l-3 3a4 4 0 105.7 5.7L14 18" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
    : `
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4"
             viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 7l3-3a4 4 0 015.7 5.7L14 12" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 10l-3 3a4 4 0 005.7 5.7L14 18" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 2v3" stroke-linecap="round"/>
            <path d="M12 19v3" stroke-linecap="round"/>
        </svg>`;
}

// ==========================
//   AUFTRAG LÖSCHEN
// ==========================

function deleteOrder(orderId) {
  if (!orderId) {
    alert("Kein Auftrag ausgewählt.");
    return;
  }

  const order = appState.orders.find((o) => o.id === orderId);
  if (!order) {
    alert("Auftrag nicht gefunden.");
    return;
  }

  const ba = order.baNumber || "-";

  if (
    !confirm(`Auftrag BA ${ba} wirklich löschen? 
Alle Zähler, Ausschussdaten und Protokolleinträge zu diesem Auftrag gehen dauerhaft verloren.`)
  ) {
    return;
  }

  const machine = appState.machines.find((m) => m.id === order.machineId);
  if (machine && Array.isArray(machine.activeOrderIds)) {
    machine.activeOrderIds = machine.activeOrderIds.filter(
      (id) => id !== orderId
    );
  }

  appState.orders = appState.orders.filter((o) => o.id !== orderId);

  if (appState.activeOrderId === orderId) {
    appState.activeOrderId = null;

    if (machine && machine.activeOrderIds.length > 0) {
      appState.activeOrderId = machine.activeOrderIds[0];
      appState.activeMachineId = machine.id;
      appState.currentView = "production";
    } else {
      appState.activeMachineId = null;
      appState.currentView = "dashboard";
    }
  }

  saveData();
  renderView();
}

function deleteActiveOrder() {
  if (!appState.activeOrderId) {
    alert("Kein aktiver Auftrag zum Löschen ausgewählt.");
    return;
  }
  deleteOrder(appState.activeOrderId);
}

// ==========================
//   ORDERS & DIALOGE
// ==========================

function openNewOrderDialog(machineId) {
  const sel = document.getElementById("selectInitialEmployee");
  if (sel) {
    sel.innerHTML = '<option value="">--Wählen--</option>';

    let deptIdForOrder = null;

    if (machineId) {
      const mach = appState.machines.find((m) => m.id === machineId);
      if (mach && mach.deptId) {
        deptIdForOrder = mach.deptId;
      }
    }

    if (
      !deptIdForOrder &&
      appState.currentUser &&
      appState.currentUser.deptId
    ) {
      deptIdForOrder = appState.currentUser.deptId;
    }

    const candidates = appState.globalEmployees.filter((e) => {
      if (deptIdForOrder) {
        return e.deptId === deptIdForOrder;
      }
      return true;
    });

    candidates.forEach((e) => {
      sel.innerHTML += `<option value="${e.id}">${e.name}</option>`;
    });

    if (appState.currentUser && appState.currentUser.role === "worker") {
      const existsInList = candidates.some(
        (e) => e.id === appState.currentUser.id
      );
      if (existsInList) {
        sel.value = appState.currentUser.id;
      }
    }
  }

  const mInput = document.getElementById("inputMachineId");
  if (mInput) {
    mInput.value = machineId || "";
    if (machineId) {
      mInput.readOnly = true;
      mInput.classList.add("bg-slate-100");
    } else {
      mInput.readOnly = false;
      mInput.classList.remove("bg-slate-100");
    }
  }

  const dl = document.getElementById("machineSuggestions");
  if (dl) {
    dl.innerHTML = "";
    appState.machines.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      dl.appendChild(opt);
    });
  }

  // Checkbox & Teile/Palette initialisieren (UI-Seite)
  const piecesInput = document.getElementById("inputPiecesPerPallet");
  const twoOneCheckbox = document.getElementById("twoOneSpecialCheckbox");

  if (piecesInput) {
    piecesInput.disabled = false;
    piecesInput.classList.remove("bg-slate-100", "cursor-not-allowed");
  }

  if (twoOneCheckbox) {
    twoOneCheckbox.checked = false;
  }

  safeHide("newOrderDialog", false);
}

function setStationCount(count) {
  const input = document.getElementById("inputStationCount");
  if (input) {
    input.value = String(count);
  }

  const container = document.getElementById("stationCountButtons");
  if (!container) return;

  const buttons = container.querySelectorAll("button[data-count]");
  buttons.forEach((btn) => {
    const c = parseInt(btn.dataset.count, 10);
    if (c === count) {
      btn.classList.remove("bg-white", "text-slate-700");
      btn.classList.add("bg-brand", "text-white");
    } else {
      btn.classList.remove("bg-brand", "text-white");
      btn.classList.add("bg-white", "text-slate-700");
    }
  });
}

// NEU: 2/1-Checkbox steuert Feld "Teile pro Palette"
function handleTwoOneCheckboxChange() {
  const cb = document.getElementById("twoOneSpecialCheckbox");
  const inp = document.getElementById("inputPiecesPerPallet");
  if (!inp) return;

  if (cb && cb.checked) {
    inp.value = "";
    inp.disabled = true;
    inp.classList.add("bg-slate-100", "cursor-not-allowed");
  } else {
    inp.disabled = false;
    inp.classList.remove("bg-slate-100", "cursor-not-allowed");
  }
}

function closeNewOrderDialog() {
  safeHide("newOrderDialog", true);
}

function submitNewOrder() {
  try {
    const mInputEl = document.getElementById("inputMachineId");
    const baEl = document.getElementById("inputBA");
    const artEl = document.getElementById("inputArt");
    const baQtyEl = document.getElementById("inputBaQty");
    const targetQtyEl = document.getElementById("inputTargetQty");
    const stationCountEl = document.getElementById("inputStationCount");
    const selEmpEl = document.getElementById("selectInitialEmployee");

    const mId = mInputEl ? mInputEl.value.trim() : "";
    const ba = baEl ? baEl.value.trim() : "";
    const art = artEl ? artEl.value.trim() : "";
    const baQty = baQtyEl ? parseInt(baQtyEl.value.trim(), 10) || 0 : 0;
    const targetQty = targetQtyEl
      ? parseInt(targetQtyEl.value.trim(), 10) || 0
      : 0;

    let cnt = 6;
    if (stationCountEl && stationCountEl.value) {
      cnt = parseInt(stationCountEl.value, 10) || 6;
    } else {
      const btnActive = document.querySelector(
        "#stationCountButtons button.bg-brand"
      );
      if (btnActive && btnActive.dataset && btnActive.dataset.count) {
        cnt = parseInt(btnActive.dataset.count, 10) || 6;
      }
    }

    let empId = "";
    if (selEmpEl) {
      empId = selEmpEl.value || "";
      if (!empId) {
        const selText = selEmpEl.options[selEmpEl.selectedIndex]
          ? selEmpEl.options[selEmpEl.selectedIndex].text
          : "";
        if (selText) {
          const found = appState.globalEmployees.find(
            (e) => e.name === selText
          );
          if (found) empId = found.id;
        }
      }
    }

    if (!mId) {
      alert("Bitte Maschine angeben.");
      return;
    }
    if (!ba) {
      alert("Bitte BA-Nummer angeben.");
      return;
    }
    if (!art) {
      alert("Bitte Artikel angeben.");
      return;
    }
    if (!baQty || baQty <= 0) {
      alert("Bitte gültige BA-Stückzahl angeben (> 0).");
      return;
    }
    if (!targetQty || targetQty <= 0) {
      alert("Bitte gültige Ziel-Stückzahl angeben (> 0).");
      return;
    }
    if (!empId) {
      if (appState.currentUser && appState.currentUser.role === "worker") {
        empId = appState.currentUser.id;
      } else {
        alert("Bitte einen Mitarbeiter auswählen.");
        return;
      }
    }

    const gEmp = appState.globalEmployees.find((e) => e.id === empId) || null;

    // Paletten-/Lagerlogik vorerst komplett deaktiviert
    const twoOneMode = false;
    const palletCount = 0;
    const piecesPerPallet = 0;

    let machine = appState.machines.find((m) => m.id === mId);
    if (!machine) {
      machine = {
        id: mId,
        deptId: (appState.currentUser && appState.currentUser.deptId) || "d1",
        activeOrderIds: [],
      };
      appState.machines.push(machine);
    } else {
      if (!Array.isArray(machine.activeOrderIds)) machine.activeOrderIds = [];
    }

    const stations = [];
    const countStations = isNaN(cnt) || cnt <= 0 ? 6 : cnt;
    for (let i = 1; i <= countStations; i++) {
      stations.push({
        id: i,
        name: `Spannung ${i}`,
        counts: {},
        scrap: {},
        scrapTotal: 0,
        scrapLifetime: 0,
        scrapLog: [],
        clarify: {},
        clarifyTotal: 0,
        clarifyLifetime: 0,
        clarifyLog: [],
        timeStatus: null,
        actualTimeMinutes: null,
        opNumber: null,
      });
    }

    const order = {
      id: "ord-" + Date.now(),
      machineId: mId,
      baNumber: ba,
      articleNumber: art,
      baQuantity: baQty,
      targetQuantity: targetQty,
      startTime: new Date().toISOString(),
      stations,
      employees: gEmp
        ? [
            {
              id: gEmp.id,
              name: gEmp.name,
              persId: gEmp.persId,
            },
          ]
        : [],
      history: [],
      finishChecklist: {
        items: [],
      },
      useChainLogic: true,
      palletCount,
      piecesPerPallet,
      machine50Storage: null,
    };

    // Maschine-50-Struktur wird zwar vorbereitet, aber keine Logik aktiv
    if (mId === "50") {
      order.machine50Storage = {
        totalPallets: palletCount || 0,
        piecesPerPallet: twoOneMode ? 2 : piecesPerPallet || 2,
        usedPallets: 0,
        currentMode: null,
        currentPiecesOnPallet: 0,
        pallets: [],
        twoOneMode: twoOneMode,
      };
    }

    appState.orders.push(order);
    machine.activeOrderIds.push(order.id);

    appState.activeMachineId = mId;
    appState.activeOrderId = order.id;
    appState.currentView = "production";

    saveData();
    closeNewOrderDialog();
    renderView();

    if (typeof openOpDialog === "function") {
      try {
        openOpDialog(order);
      } catch (e) {
        console.warn("openOpDialog failed:", e);
      }
    }
  } catch (err) {
    console.error("submitNewOrder error:", err);
    alert("Fehler beim Starten des Auftrags. Konsole prüfen.");
  }
}

function openOpDialog(order) {
  if (!order) return;
  currentOpDialogOrderId = order.id;

  const dlg = document.getElementById("opDialog");
  const body = document.getElementById("opDialogBody");
  if (!dlg || !body) return;

  body.innerHTML = "";

  order.stations.forEach((s) => {
    const val = s.opNumber || "";

    body.innerHTML += `
            <div class="flex items-center gap-3">
                <div class="w-32 text-sm font-bold text-slate-700">
                    Spannung ${s.id}
                </div>
                <div class="flex items-center gap-1 flex-1">
                    <span class="text-xs font-mono text-slate-500">OP_</span>
                    <input type="number"
                           min="0"
                           id="opInput_${s.id}"
                           class="border rounded px-2 py-1 text-sm w-full"
                           placeholder="z.B. 20"
                           value="${val}">
                </div>
            </div>
        `;
  });

  safeHide("opDialog", false);
}

function closeOpDialog() {
  safeHide("opDialog", true);
  currentOpDialogOrderId = null;
}

function saveOpDialog() {
  if (!currentOpDialogOrderId) {
    closeOpDialog();
    return;
  }

  const order = appState.orders.find((o) => o.id === currentOpDialogOrderId);
  if (!order) {
    closeOpDialog();
    return;
  }

  let allEmpty = true;

  order.stations.forEach((s) => {
    const input = document.getElementById(`opInput_${s.id}`);
    if (!input) return;
    const raw = input.value.trim();
    if (raw) {
      s.opNumber = raw;
      allEmpty = false;
    } else {
      s.opNumber = null;
    }
  });

  if (allEmpty) {
    if (
      !confirm("Es wurden keine OP-Nummern eingetragen. Trotzdem fortfahren?")
    ) {
      return;
    }
  }

  saveData();
  closeOpDialog();
}

// Dialog "Mitarbeiter zum Auftrag hinzufügen" öffnen
function openAddEmployeeDialog() {
  const dlg = document.getElementById("addEmployeeDialog");
  const sameDeptSelect = document.getElementById("selectAdditionalEmployee");
  const otherDeptSelect = document.getElementById("selectOtherEmpDept");
  const otherEmpSelect = document.getElementById("selectOtherDeptEmployee");

  if (!dlg || !sameDeptSelect || !otherDeptSelect || !otherEmpSelect) {
    alert("Der Mitarbeiter-Dialog ist im HTML nicht korrekt definiert.");
    return;
  }

  const activeOrder = getActiveOrder();
  if (!activeOrder) {
    alert("Kein aktiver Auftrag ausgewählt.");
    return;
  }

  // Maschine + zugehörige Abteilung ermitteln
  const machine = appState.machines.find((m) => m.id === activeOrder.machineId);
  const machineDeptId = machine ? machine.deptId : null;

  const employees = appState.employees || appState.globalEmployees || [];
  const sameDeptEmployees = machineDeptId
    ? employees.filter((e) => e.deptId === machineDeptId)
    : employees;

  const otherDeptEmployees = machineDeptId
    ? employees.filter((e) => e.deptId !== machineDeptId)
    : [];

  // Same-dept Liste
  sameDeptSelect.innerHTML = "";
  sameDeptSelect.appendChild(new Option("-- Mitarbeiter wählen --", ""));
  sameDeptEmployees.forEach((emp) => {
    sameDeptSelect.appendChild(
      new Option(
        `${emp.name}${emp.persId ? " (" + emp.persId + ")" : ""}`,
        emp.id
      )
    );
  });
  sameDeptSelect.disabled = sameDeptEmployees.length === 0;

  // Other-dept Dept-Auswahl
  otherDeptSelect.innerHTML = "";
  otherDeptSelect.appendChild(new Option("-- Abteilung wählen --", ""));
  const departments = appState.departments || [];
  const deptIdsWithOtherEmps = new Set(otherDeptEmployees.map((e) => e.deptId));
  departments
    .filter((d) => deptIdsWithOtherEmps.has(d.id))
    .forEach((d) => {
      otherDeptSelect.appendChild(new Option(d.name, d.id));
    });

  // Other-dept Employee-Auswahl (initial disabled)
  otherEmpSelect.innerHTML = "";
  otherEmpSelect.appendChild(new Option("-- Mitarbeiter wählen --", ""));
  otherEmpSelect.disabled = true;

  otherDeptSelect.onchange = () => {
    const did = otherDeptSelect.value;
    otherEmpSelect.innerHTML = "";
    otherEmpSelect.appendChild(new Option("-- Mitarbeiter wählen --", ""));
    if (!did) {
      otherEmpSelect.disabled = true;
      return;
    }
    otherDeptEmployees
      .filter((e) => e.deptId === did)
      .forEach((emp) => {
        otherEmpSelect.appendChild(
          new Option(
            `${emp.name}${emp.persId ? " (" + emp.persId + ")" : ""}`,
            emp.id
          )
        );
      });
    otherEmpSelect.disabled = false;
  };

  // Dialog anzeigen
  safeHide("addEmployeeDialog", false);
}

// Mitarbeiter-Liste für gewählte "andere Abteilung" füllen
function populateOtherDeptEmployees() {
  const otherDeptSelect = document.getElementById("selectOtherEmpDept");
  const otherEmpSelect = document.getElementById("selectOtherEmp");

  if (!otherDeptSelect || !otherEmpSelect) return;

  const deptId = otherDeptSelect.value;
  otherEmpSelect.innerHTML = "";

  if (!deptId) {
    otherEmpSelect.disabled = true;
    return;
  }

  const employees = appState.employees || [];
  const empsOfDept = employees.filter((e) => e.deptId === deptId);

  if (empsOfDept.length === 0) {
    otherEmpSelect.appendChild(
      new Option("-- Keine Mitarbeiter in dieser Abteilung --", "")
    );
    otherEmpSelect.disabled = true;
    return;
  }

  otherEmpSelect.appendChild(new Option("-- Mitarbeiter wählen --", ""));
  empsOfDept.forEach((emp) => {
    otherEmpSelect.appendChild(new Option(`${emp.name} (${emp.id})`, emp.id));
  });
  otherEmpSelect.disabled = false;
}

// Ausgewählten Mitarbeiter zum Auftrag hinzufügen
function addEmployeeToOrder() {
  const sameDeptSelect = document.getElementById("selectAdditionalEmployee");
  const otherEmpSelect = document.getElementById("selectOtherEmp");

  if (!sameDeptSelect || !otherEmpSelect) return;

  // Priorität:
  // 1) Auswahl aus Maschinen-Abteilung
  // 2) falls leer, Auswahl aus "andere Abteilung"
  let empId = sameDeptSelect.value;
  if (!empId) {
    empId = otherEmpSelect.value;
  }

  if (!empId) {
    alert("Bitte einen Mitarbeiter auswählen.");
    return;
  }

  const activeOrder = getActiveOrder();
  if (!activeOrder) {
    alert("Kein aktiver Auftrag ausgewählt.");
    return;
  }

  if (!Array.isArray(activeOrder.additionalEmployees)) {
    activeOrder.additionalEmployees = [];
  }

  // Mitarbeiter nicht doppelt hinzufügen
  if (!activeOrder.additionalEmployees.includes(empId)) {
    activeOrder.additionalEmployees.push(empId);
  }

  // Oberfläche neu aufbauen, damit die Mitarbeiter an den Spannungen sichtbar sind
  saveAppState();
  renderProductionView();

  safeHide("addEmployeeDialog", true);
}

function updateAdditionalEmployeeListForDept() {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;

  const deptSel = document.getElementById("selectEmpDeptForOrder");
  const empSel = document.getElementById("selectAdditionalEmployee");
  if (!deptSel || !empSel) return;

  const deptId = deptSel.value;
  empSel.innerHTML = "";

  if (!Array.isArray(order.employees)) {
    order.employees = [];
  }
  const alreadyIds = new Set(order.employees.map((e) => e.id));

  // Kandidaten: alle Mitarbeiter der GEWÄHLTEN Abteilung, die noch nicht im Auftrag sind
  const candidates = appState.globalEmployees.filter((e) => {
    if (!deptId) return false;
    if (e.deptId !== deptId) return false;
    if (alreadyIds.has(e.id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    empSel.innerHTML =
      '<option value="">-- Keine verfügbaren Mitarbeiter in dieser Abteilung --</option>';
    return;
  }

  candidates.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.persId ? `${e.name} (${e.persId})` : e.name;
    empSel.appendChild(opt);
  });
}

function addEmployeeToOrder() {
  const sel = document.getElementById("selectAdditionalEmployee");
  if (!sel) {
    console.warn("selectAdditionalEmployee nicht gefunden.");
    return;
  }

  const eid = sel.value;
  if (!eid) {
    alert("Bitte einen Mitarbeiter auswählen.");
    return;
  }

  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) {
    alert("Kein aktiver Auftrag ausgewählt.");
    return;
  }

  const gEmp = appState.globalEmployees.find((e) => e.id === eid);
  if (!gEmp) {
    alert("Ausgewählter Mitarbeiter nicht gefunden.");
    return;
  }

  if (!Array.isArray(order.employees)) {
    order.employees = [];
  }

  if (order.employees.some((e) => e.id === gEmp.id)) {
    alert("Dieser Mitarbeiter ist bereits im Auftrag.");
    safeHide("addEmployeeDialog", true);
    return;
  }

  order.employees.push({
    id: gEmp.id,
    name: gEmp.name,
    persId: gEmp.persId || null,
  });

  saveData();
  renderStations(order);
  refreshTotals(order);
  safeHide("addEmployeeDialog", true);
}

function einlagernForActiveOrder() {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) {
    alert("Kein aktiver Auftrag ausgewählt.");
    return;
  }

  const toInt = (v) => {
    const n = parseInt(String(v || "").trim(), 10);
    return Number.isFinite(n) ? n : NaN;
  };

  const lastRec =
    Array.isArray(order.storageRecords) && order.storageRecords.length
      ? order.storageRecords[order.storageRecords.length - 1]
      : null;

  const totalDefault =
    (lastRec && lastRec.totalPallets) ||
    order.palletCount ||
    order.totalPallets ||
    "";

  const totalRaw = prompt(
    "Aus wie vielen Paletten besteht der Auftrag?",
    totalDefault
  );
  if (totalRaw === null) return;
  const totalPallets = toInt(totalRaw);
  if (!Number.isFinite(totalPallets) || totalPallets <= 0) {
    alert("Ungültige Gesamtpalettenzahl.");
    return;
  }

  const alreadyStored = Array.isArray(order.storageRecords)
    ? order.storageRecords.reduce(
        (sum, r) => sum + (Number(r?.palletsStored) || 0),
        0
      )
    : 0;

  const remaining = Math.max(0, totalPallets - alreadyStored);

  const storeRaw = prompt(
    `Wie viele Paletten sollen eingelagert werden? (noch möglich: ${remaining})`,
    remaining || 0
  );
  if (storeRaw === null) return;
  const palletsStored = toInt(storeRaw);
  if (!Number.isFinite(palletsStored) || palletsStored <= 0) {
    alert("Ungültige Zahl für einzulagernde Paletten.");
    return;
  }
  if (palletsStored > remaining) {
    alert(`Zu viele Paletten. Maximal möglich: ${remaining}.`);
    return;
  }

  const partsDefault =
    (lastRec && lastRec.partsPerPallet) || order.piecesPerPallet || 2;

  const partsRaw = prompt(
    "Wie viele Teile befinden sich auf der Palette?",
    partsDefault
  );
  if (partsRaw === null) return;
  const partsPerPallet = toInt(partsRaw);
  if (!Number.isFinite(partsPerPallet) || partsPerPallet <= 0) {
    alert("Ungültige Teilezahl pro Palette.");
    return;
  }

  const racks = ["U", "DR", "FR", "G", "S", "Q", "KA", "SC"];

  // pro Palette Regal/Platz abfragen
  if (!Array.isArray(order.storageRecords)) order.storageRecords = [];

  let lastRack =
    lastRec && lastRec.rack ? String(lastRec.rack).toUpperCase() : "G";
  let lastPlace = lastRec && lastRec.place ? String(lastRec.place).trim() : "";

  for (let i = 1; i <= palletsStored; i++) {
    const rackRaw = prompt(
      `Palette ${i}/${palletsStored} – Regal (z. B. ${racks.join(", ")}):`,
      lastRack
    );
    if (rackRaw === null) return;
    const rack = String(rackRaw || "")
      .trim()
      .toUpperCase();
    if (!rack) {
      alert("Bitte ein Regal angeben (z. B. G).");
      return;
    }

    const placeRaw = prompt(
      `Palette ${i}/${palletsStored} – Platz / Nummer (z. B. 78):`,
      lastPlace
    );
    if (placeRaw === null) return;
    const place = String(placeRaw || "").trim();
    if (!place) {
      alert("Bitte einen Platz / eine Nummer angeben (z. B. 78).");
      return;
    }

    order.storageRecords.push({
      totalPallets,
      palletsStored: 1, // wichtig: pro Datensatz eine Palette
      partsPerPallet,
      rack,
      place,
      ts: Date.now(),
    });

    lastRack = rack;
    lastPlace = place;
  }

  // optional: fürs nächste Mal merken
  order.palletCount = totalPallets;
  order.piecesPerPallet = partsPerPallet;

  saveData(false);
  alert("Einlagerung gespeichert.");
}

// Sicherheit: global für onclick verfügbar
window.einlagernForActiveOrder = einlagernForActiveOrder;

function addStationToOrder() {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;
  const maxId = order.stations.reduce((max, s) => (s.id > max ? s.id : max), 0);
  const nextId = maxId + 1;
  order.stations.push({
    id: nextId,
    name: `Spannung ${nextId}`,
    counts: {},
    scrap: {},
    scrapTotal: 0,
    scrapLifetime: 0,
    scrapLog: [],
    clarify: {},
    clarifyTotal: 0,
    clarifyLifetime: 0,
    clarifyLog: [],
    timeStatus: null,
    actualTimeMinutes: null,
    opNumber: null,
  });

  saveData();
  renderStations(order);
  refreshTotals(order);
}

function openNameDialog(id) {
  const dlg = document.getElementById("nameDialog");
  if (!dlg) return;
  dlg.dataset.id = id;
  const input = document.getElementById("nameInput");
  if (input) {
    const order = appState.orders.find((o) => o.id === appState.activeOrderId);
    const s = order.stations.find((st) => st.id === id);
    input.value = s.name || `Spannung ${id}`;
  }
  safeHide("nameDialog", false);
}

function saveName() {
  const dlg = document.getElementById("nameDialog");
  if (!dlg) return;
  const id = parseInt(dlg.dataset.id, 10);
  const input = document.getElementById("nameInput");
  const val = input && input.value.trim();
  if (!val) {
    alert("Name darf nicht leer sein.");
    return;
  }

  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;
  const s = order.stations.find((st) => st.id === id);
  if (!s) return;

  s.name = val;
  s.lockName = true;

  saveData();
  renderStations(order);
  safeHide("nameDialog", true);
}

function closeNameDialog() {
  safeHide("nameDialog", true);
}

// ==========================
//   STAMMDATEN
// ==========================

function openMasterDataDialog(tab = "dept") {
  safeHide("masterDataDialog", false);
  switchMasterTab(tab);
}

function closeMasterDataDialog() {
  safeHide("masterDataDialog", true);
  if (appState.currentUser) {
    showDashboardScreen();
  } else {
    showLoginScreen();
  }
}

function switchMasterTab(t) {
  ["dept", "mach", "emp"].forEach((x) => {
    const view = document.getElementById(`view-${x}`);
    const tab = document.getElementById(`tab-${x}`);
    if (view) view.classList.add("hidden");
    if (tab) {
      tab.classList.remove("bg-white", "text-brand");
      tab.classList.add("text-slate-500");
    }
  });
  const v = document.getElementById(`view-${t}`);
  const tb = document.getElementById(`tab-${t}`);
  if (v) v.classList.remove("hidden");
  if (tb) {
    tb.classList.add("bg-white", "text-brand");
    tb.classList.remove("text-slate-500");
  }

  if (t === "dept") renderDeptList();
  if (t === "mach") renderMachList();
  if (t === "emp") renderEmpList();
}

function renderDeptList() {
  const l = document.getElementById("listDepartments");
  if (!l) return;
  l.innerHTML = "";
  appState.departments.forEach((d) => {
    l.innerHTML += `
            <div class="flex justify-between bg-white border p-3 rounded font-bold text-slate-700">
                <span>${d.name}</span>
                <button onclick="deleteDept('${d.id}')" class="text-red-500">X</button>
            </div>
        `;
  });
}

function addDepartment() {
  const n = document.getElementById("newDeptName").value.trim();
  if (!n) return;
  appState.departments.push({ id: "d" + Date.now(), name: n });
  document.getElementById("newDeptName").value = "";
  saveData();
  renderDeptList();
}

function deleteDept(id) {
  if (!confirm("Abteilung wirklich löschen?")) return;
  appState.departments = appState.departments.filter((d) => d.id !== id);
  saveData();
  renderDeptList();
}

function renderMachList() {
  const s = document.getElementById("newMachDept");
  if (!s) return;
  s.innerHTML = "";
  appState.departments.forEach((d) => {
    s.innerHTML += `<option value="${d.id}">${d.name}</option>`;
  });

  const l = document.getElementById("listMachines");
  if (!l) return;
  l.innerHTML = "";
  appState.machines.forEach((m) => {
    const d = appState.departments.find((x) => x.id === m.deptId);
    l.innerHTML += `
            <div class="flex justify-between bg-white border p-3 rounded text-sm">
                <div>
                    <b>${m.id}</b>
                    <span class="text-slate-400">(${d ? d.name : "-"})</span>
                </div>
                <button onclick="deleteMachine('${
                  m.id
                }')" class="text-red-500 font-bold">X</button>
            </div>
        `;
  });
}

function addMachine() {
  const n = document.getElementById("newMachName").value.trim();
  const d = document.getElementById("newMachDept").value;
  if (!n || !d) return;
  appState.machines.push({ id: n, deptId: d, activeOrderIds: [] });
  document.getElementById("newMachName").value = "";
  saveData();
  renderMachList();
}

function deleteMachine(id) {
  if (!confirm("Maschine wirklich löschen?")) return;
  appState.machines = appState.machines.filter((m) => m.id !== id);
  saveData();
  renderMachList();
}

function renderEmpList() {
  const s = document.getElementById("newEmpDept");
  if (!s) return;
  s.innerHTML = "";
  appState.departments.forEach((d) => {
    s.innerHTML += `<option value="${d.id}">${d.name}</option>`;
  });

  const l = document.getElementById("listEmployees");
  if (!l) return;
  l.innerHTML = "";
  appState.globalEmployees.forEach((e) => {
    const d = appState.departments.find((x) => x.id === e.deptId);
    l.innerHTML += `
            <div class="flex justify-between bg-white border p-3 rounded text-sm">
                <div>
                    <b>${e.name}</b> ${e.isDeptHead ? "(AL)" : ""}
                    <span class="text-slate-400">(${d ? d.name : "-"})</span>
                </div>
                <button onclick="deleteEmployee('${
                  e.id
                }')" class="text-red-500 font-bold">X</button>
            </div>
        `;
  });
}

function addEmployee() {
  const n = document.getElementById("newEmpName").value.trim();
  const i = document.getElementById("newEmpId").value.trim();
  const d = document.getElementById("newEmpDept").value;
  const h = document.getElementById("newEmpHead").checked;
  if (!n) return;
  appState.globalEmployees.push({
    id: "e" + Date.now(),
    name: n,
    persId: i,
    deptId: d,
    isDeptHead: h,
  });
  document.getElementById("newEmpName").value = "";
  document.getElementById("newEmpId").value = "";
  saveData();
  renderEmpList();
}

function deleteEmployee(id) {
  if (!confirm("Mitarbeiter wirklich löschen?")) return;
  appState.globalEmployees = appState.globalEmployees.filter(
    (e) => e.id !== id
  );
  saveData();
  renderEmpList();
}

// ==========================
//   BACKUP / PROTOKOLL
// ==========================

function openBackupDialog() {
  safeHide("backupDialog", false);
}

function downloadBackup() {
  const a = document.createElement("a");
  a.href =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(appState));
  a.download = "backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function restoreBackup(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    try {
      appState = JSON.parse(ev.target.result);
      saveData(false);
      location.reload();
    } catch (x) {
      alert("Backup konnte nicht geladen werden.");
    }
  };
  r.readAsText(f);
}

function openProtocol() {
  const dlg = document.getElementById("protocolDialog");
  const body = document.getElementById("protocolTableBody");
  if (!dlg || !body) return;
  body.innerHTML = "";

  let empty = true;
  appState.orders.forEach((o) => {
    if (!o.history) return;
    o.history.forEach((h) => {
      empty = false;
      const opLabel = h.opNumber
        ? `OP_${h.opNumber}`
        : h.stationName || `Spg ${h.stationId}`;

      body.innerHTML += `
                <tr class="border-b border-slate-100">
                    <td class="py-3 text-xs font-mono">${new Date(
                      h.date
                    ).toLocaleDateString()}</td>
                    <td class="font-bold text-slate-700">${o.baNumber}</td>
                    <td class="text-slate-600">${h.empName}</td>
                    <td class="text-slate-600">${opLabel}</td>
                    <td class="text-right font-black text-brand">${h.count}</td>
                </tr>
            `;
    });
  });

  if (empty) {
    body.innerHTML = `
            <tr>
                <td colspan="5" class="py-4 text-center text-slate-400 text-xs">
                    Noch keine Tages-Resets durchgeführt.
                </td>
            </tr>
        `;
  }

  safeHide("protocolDialog", false);
}

function closeProtocol() {
  safeHide("protocolDialog", true);
  const input = document.querySelector("#backupDialog input[type='file']");
  if (input) input.value = "";
}

// ==========================
//   TAGES-RESET
// ==========================

function performDayReset() {
  if (
    !confirm(
      "Tag abschließen? Zähler werden in die Historie geschrieben und auf 0 gesetzt."
    )
  ) {
    return;
  }

  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) return;

  if (!order.history) order.history = [];
  const now = new Date().toISOString();

  order.stations.forEach((s) => {
    if (typeof s.scrapLifetime !== "number") {
      s.scrapLifetime = s.scrapTotal || 0;
    }
    if (typeof s.clarifyLifetime !== "number") {
      s.clarifyLifetime = s.clarifyTotal || 0;
    }

    if (s.counts) {
      Object.keys(s.counts).forEach((eid) => {
        const val = s.counts[eid];
        if (val > 0) {
          const emp = order.employees
            ? order.employees.find((e) => e.id === eid)
            : null;

          order.history.push({
            date: now,
            stationId: s.id,
            stationName: s.name,
            opNumber: s.opNumber || null,
            empId: emp ? emp.id : eid,
            empName: emp ? emp.name : "",
            persId: emp ? emp.persId : "",
            count: val,
          });

          s.counts[eid] = 0;
        }
      });
    }

    if (!s.scrap) s.scrap = {};
    if (typeof s.scrapTotal !== "number") s.scrapTotal = 0;
    if (!Array.isArray(s.scrapLog)) s.scrapLog = [];

    Object.keys(s.scrap).forEach((empId) => {
      s.scrap[empId] = 0;
    });
    s.scrapTotal = 0;

    if (!s.clarify) s.clarify = {};
    if (typeof s.clarifyTotal !== "number") s.clarifyTotal = 0;
    if (!Array.isArray(s.clarifyLog)) s.clarifyLog = [];

    Object.keys(s.clarify).forEach((empId) => {
      s.clarify[empId] = 0;
    });
    s.clarifyTotal = 0;
  });

  saveData();
  renderStations(order);
  refreshTotals(order);
}

// ==========================
//   MASCHINE 50 – LAGERLOGIK
// ==========================
// Logik ist aktuell komplett deaktiviert (keine Aufrufe in changeCount).
// Funktionen bleiben für späteren Ausbau bestehen.

function handleMachine50StorageAfterCount(order, stationId) {
  if (!order || order.machineId !== "50") return;

  if (!Array.isArray(order.stations) || order.stations.length === 0) return;
  const lastStationId = order.stations[order.stations.length - 1].id;
  if (stationId !== lastStationId) return;

  if (!order.machine50Storage) {
    order.machine50Storage = {
      totalPallets: order.palletCount || 0,
      piecesPerPallet: order.piecesPerPallet || 2,
      usedPallets: 0,
      currentMode: null,
      currentPiecesOnPallet: 0,
      pallets: [],
      twoOneMode: false,
    };
  }
  const st = order.machine50Storage;

  if (!st.totalPallets || st.totalPallets < 0) st.totalPallets = 0;
  if (!st.piecesPerPallet || st.piecesPerPallet <= 0) st.piecesPerPallet = 2;
  if (!Array.isArray(st.pallets)) st.pallets = [];
  if (typeof st.twoOneMode !== "boolean") st.twoOneMode = false;

  // Aktuell keine automatische Paletten-/Lagerort-Interaktion
  renderMachine50StorageOverview(order);
  saveData(false);
}

function pickPaletteModeMachine50() {
  const res = window.prompt(
    "Maschine 50 – Palette-Typ wählen:\n1 = 1er Palette (1 Teil)\n2 = 2er Palette (2 Teile)",
    "2"
  );
  if (res === null) return null;
  const t = res.trim();
  if (t === "1") return "1er";
  if (t === "2") return "2er";
  return null;
}

function pickStorageLocationMachine50() {
  const rackRaw = window.prompt(
    "Lagerort – Regal wählen (U, DR, FR, G, S, Q, KA, SC):",
    "U"
  );
  if (rackRaw === null) return null;
  const rack = rackRaw.trim().toUpperCase();
  if (!rack) return null;

  const placeRaw = window.prompt(
    `Lagerort – Platz / Nummer im Regal ${rack}:`,
    ""
  );
  if (placeRaw === null) return null;
  const place = placeRaw.trim();
  if (!place) return null;

  return { rack, place };
}

function renderMachine50StorageOverview(order) {
  const container = document.getElementById("storageOverview");
  if (!container) return;

  const st = order.machine50Storage;
  container.innerHTML = "";

  if (!st || !Array.isArray(st.pallets) || st.pallets.length === 0) return;

  let html = '<div class="flex flex-wrap gap-2 justify-end mt-3">';
  st.pallets.forEach((p) => {
    if (!p.rack || !p.place) return;
    html += `
            <div class="px-3 py-1 border-2 border-slate-800 rounded-lg text-sm font-bold">
                Palette ${p.index}: ${p.rack} ${p.place} (${p.mode})
            </div>
        `;
  });
  html += "</div>";
  container.innerHTML = html;
}

function getStorageLocationStrings(order) {
  const out = [];

  // Neue, einfache Einlagerung (für alle Maschinen)
  if (order && Array.isArray(order.storageRecords)) {
    order.storageRecords.forEach((r) => {
      if (!r) return;
      const rack = (r.rack || "").toString().trim().toUpperCase();
      const place = (r.place || "").toString().trim();
      const parts = Number(r.partsPerPallet);
      if (!rack || !place) return;

      if (Number.isFinite(parts) && parts > 0) {
        out.push(`${rack} ${place} / ${parts} Teile`);
      } else {
        out.push(`${rack} ${place}`);
      }
    });
  }

  // Bestehende Maschine-50-Struktur (falls genutzt)
  if (
    order &&
    order.machine50Storage &&
    Array.isArray(order.machine50Storage.pallets)
  ) {
    order.machine50Storage.pallets.forEach((p) => {
      if (p && p.rack && p.place) {
        out.push(`${p.rack} ${p.place}`);
      }
    });
  }

  // Duplikate entfernen
  return Array.from(new Set(out));
}

// ==========================
//   PDF-EXPORT
// ==========================

async function exportPdf(isFinal = false, finisherEmpId = null) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("jsPDF konnte nicht geladen werden.");
    return;
  }

  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) {
    alert("Kein aktiver Auftrag ausgewählt.");
    return;
  }

  const machine = appState.machines.find((m) => m.id === order.machineId);

  const [logo, bg] = await Promise.all([loadPdfLogo(), loadPdfBackground()]);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 40;
  const right = pageWidth - marginLeft;

  if (bg && bg.dataUrl) {
    const maxBgHeight = pageHeight - 140;
    const scale = maxBgHeight / bg.height;
    const bgH = bg.height * scale;
    const bgW = bg.width * scale;
    const bgX = (pageWidth - bgW) / 2;
    const bgY = 70;
    doc.addImage(bg.dataUrl, "PNG", bgX, bgY, bgW, bgH, undefined, "FAST");
  }

  let y = 40;

  if (logo && logo.dataUrl) {
    const w = 110;
    const h = (logo.height / logo.width) * w;
    doc.addImage(
      logo.dataUrl,
      "PNG",
      marginLeft,
      y - 20,
      w,
      h,
      undefined,
      "FAST"
    );
  }

  const finishedAtStr = new Date().toLocaleString("de-DE");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  const dateLabel = isFinal ? "Abgeschlossen am: " : "Datum: ";
  const dateText = dateLabel + finishedAtStr;
  let headerY = y;

  doc.text(dateText, right, headerY, { align: "right" });
  headerY += 12;

  const baText = `BA: ${order.baNumber || "-"}`;
  const baTextWidth = doc.getTextWidth(baText);
  const baPadding = 4;
  const baRectWidth = baTextWidth + baPadding * 2;
  const baRectHeight = 12;
  const baRectX = right - baRectWidth;
  const baRectY = headerY - 8;

  if (isFinal) doc.setFillColor(0, 140, 0);
  else doc.setFillColor(255, 165, 0);

  doc.rect(baRectX, baRectY, baRectWidth, baRectHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(baText, right - baPadding, headerY, { align: "right" });
  doc.setTextColor(0, 0, 0);

  headerY += 12;
  doc.text(`Artikel: ${order.articleNumber || "-"}`, right, headerY, {
    align: "right",
  });

  if (isFinal && finisherEmpId) {
    const finisher =
      appState.globalEmployees.find((e) => e.id === finisherEmpId) ||
      (order.employees || []).find((e) => e.id === finisherEmpId) ||
      null;

    if (finisher) {
      const line = `Abgemeldet von: ${finisher.name}${
        finisher.persId ? " (PersNr " + finisher.persId + ")" : ""
      }`;
      doc.text(line, marginLeft, y + 20);
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Stückzahl Report", pageWidth / 2, y + 18, { align: "center" });

  doc.setLineWidth(1.0);
  doc.line(marginLeft, y + 32, pageWidth - marginLeft, y + 32);

  y = y + 62;

  const employees = order.employees || [];
  const stations = order.stations || [];
  const stationCount = stations.length;

  if (employees.length === 0 || stationCount === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      "Keine Daten vorhanden (keine Mitarbeiter oder Spannungen).",
      marginLeft,
      y
    );
    doc.save(
      `Stueckzahl_Report_BA_${order.baNumber || "unbekannt"}${
        isFinal ? "_final" : ""
      }.pdf`
    );
    return;
  }

  const colName = marginLeft;
  const colPers = colName + 140;
  const colSpWidth = 40;
  const totalSpWidth = stationCount * colSpWidth;
  const colSpStart = right - totalSpWidth;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);

  const headerY2 = y;
  doc.text("Name", colName, headerY2);
  doc.text("PersNr", colPers, headerY2);

  for (let i = 0; i < stationCount; i++) {
    const cx = colSpStart + colSpWidth * i + colSpWidth / 2;
    doc.text(`SP${i + 1}`, cx, headerY2, { align: "center" });
  }

  doc.setLineWidth(0.6);
  doc.line(marginLeft, headerY2 + 4, right, headerY2 + 4);

  y = headerY2 + 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  function getGoodForEmpStation(empId, stationId) {
    let sum = 0;
    const s = stations.find((st) => st.id === stationId);
    if (!s) return 0;

    if (s.counts && typeof s.counts[empId] === "number") {
      sum += s.counts[empId];
    }

    if (order.history && Array.isArray(order.history)) {
      order.history.forEach((h) => {
        if (h.empId === empId && h.stationId === stationId) {
          sum += h.count || 0;
        }
      });
    }
    return sum;
  }

  let lastStationIndex = stationCount - 1;
  let lastStationId = stations[lastStationIndex].id;
  let lastStationGoodTotals = 0;
  let grandScrapTotal = 0;

  employees.forEach((emp) => {
    const rowY = y;
    doc.text(emp.name || "-", colName, rowY);
    doc.text(emp.persId ? String(emp.persId) : "-", colPers, rowY);

    stations.forEach((s, idx) => {
      const val = getGoodForEmpStation(emp.id, s.id);

      if (s.id === lastStationId) {
        lastStationGoodTotals += val;
      }

      const cx = colSpStart + colSpWidth * idx + colSpWidth / 2;
      doc.text(String(val), cx, rowY, { align: "center" });

      const scrapForStation =
        typeof s.scrapTotal === "number" ? s.scrapTotal : 0;
      if (scrapForStation > 0) {
        doc.setFontSize(8);
        doc.setTextColor(200, 0, 0);
        doc.text(String(scrapForStation), cx + 6, rowY + 8, { align: "left" });
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
      }
    });

    y += 16;
  });

  stations.forEach((s) => {
    const scrap = typeof s.scrapTotal === "number" ? s.scrapTotal : 0;
    grandScrapTotal += scrap;
  });

  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  const label = "Gesamt";
  const labelWidth = doc.getTextWidth(label);
  const goodStr = String(lastStationGoodTotals);
  const goodWidth = doc.getTextWidth(goodStr);
  const scrapStr = grandScrapTotal > 0 ? String(grandScrapTotal) : "";
  const scrapWidth = scrapStr ? doc.getTextWidth(scrapStr) : 0;

  const spacingLabelToGood = 12;
  const spacingGoodToScrap = scrapStr ? 8 : 0;

  const scrapX = right - scrapWidth;
  const goodX = scrapX - spacingGoodToScrap - goodWidth;
  const labelX = goodX - spacingLabelToGood - labelWidth;

  doc.setLineWidth(0.6);
  doc.line(labelX, y, right, y);

  y += 14;

  doc.text(label, labelX, y);
  doc.text(goodStr, goodX, y);

  if (scrapStr) {
    doc.setTextColor(200, 0, 0);
    doc.setFontSize(9);
    doc.text(scrapStr, scrapX, y);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
  }

  // Lagerorte unten rechts (NICHT in der Fußzeile)
  const locStrings = getStorageLocationStrings(order);
  if (locStrings.length > 0) {
    const boxWidth = 220;
    const boxHeight = 40;
    const boxX = right - boxWidth;
    const boxY = pageHeight - 130; // etwas über der Fußzeile

    doc.setLineWidth(1.2);
    doc.setDrawColor(0, 0, 0);
    doc.rect(boxX, boxY, boxWidth, boxHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Lagerort(e)", boxX + 8, boxY + 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const joined = locStrings.join("   ");
    doc.text(joined, boxX + 8, boxY + 28);
  }

  // Trennstrich + Abweichungen
  const deviations = [];
  stations.forEach((s) => {
    if (s.timeStatus === "changed" && typeof s.actualTimeMinutes === "number") {
      const opPart = s.opNumber ? ` (OP_${s.opNumber})` : "";
      deviations.push(
        `Vorgabezeit Spannung ${s.id}${opPart} nicht i.O. – Ist-Zeit ${s.actualTimeMinutes} min`
      );
    }
  });

  const footerBaseY = pageHeight - 40;

  doc.setLineWidth(0.6);
  doc.line(marginLeft, footerBaseY - 10, right, footerBaseY - 10);

  if (deviations.length > 0) {
    let fy = footerBaseY;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(200, 0, 0);
    doc.text("Abweichungen:", marginLeft, fy);
    fy += 14;

    doc.setFont("helvetica", "normal");
    deviations.forEach((line) => {
      const wrapped = doc.splitTextToSize(
        `• ${line}`,
        pageWidth - marginLeft * 2
      );
      wrapped.forEach((wLine) => {
        doc.text(wLine, marginLeft, fy);
        fy += 12;
      });
    });

    doc.setTextColor(0, 0, 0);
  }

  const filename = `Stueckzahl_Report_BA_${order.baNumber || "unbekannt"}${
    isFinal ? "_final" : ""
  }.pdf`;
  doc.save(filename);
}

function exportPdfFromButton() {
  exportPdf(false, null);
}

// ==========================
//   CHECKLISTE / ABSCHLUSS
// ==========================

function initChecklist() {
  const c = document.getElementById("checklistContainer");
  if (!c) return;
  c.innerHTML = "";
  CHECKLIST_ITEMS.forEach((text) => {
    c.innerHTML += `
            <label class="flex gap-3 cursor-pointer group p-3 border-2 rounded hover:bg-brandLight">
                <input type="checkbox" class="peer hidden" onchange="validateChecklist()">
                <div class="w-6 h-6 border-2 border-slate-400 bg-white rounded flex items-center justify-center peer-checked:bg-brandLight peer-checked:border-brand">
                    <svg class="hidden w-4 h-4 text-brand peer-checked:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="M5 13l4 4L19 7"></path>
                    </svg>
                </div>
                <span class="font-bold text-slate-700 peer-checked:text-brand">${text}</span>
            </label>
        `;
  });
}

function initiateOrderFinish() {
  const boxes = document.querySelectorAll("#checklistContainer input");
  boxes.forEach((b) => (b.checked = false));
  validateChecklist();
  safeHide("checklistDialog", false);
}

function closeChecklistDialog() {
  safeHide("checklistDialog", true);
}

function validateChecklist() {
  const boxes = Array.from(
    document.querySelectorAll("#checklistContainer input")
  );
  const all = boxes.every((c) => c.checked);
  const b = document.getElementById("finishOrderBtn");
  if (!b) return;

  b.disabled = !all;
  if (all) {
    b.classList.remove("bg-slate-300", "cursor-not-allowed");
    b.classList.add("bg-emerald-500", "hover:bg-emerald-600");
  } else {
    b.classList.add("bg-slate-300", "cursor-not-allowed");
    b.classList.remove("bg-emerald-500", "hover:bg-emerald-600");
  }
}

function completeOrderFinal() {
  const order = appState.orders.find((o) => o.id === appState.activeOrderId);
  if (!order) {
    closeChecklistDialog();
    return;
  }

  let finisherEmpId = null;
  if (appState.currentUser && appState.currentUser.role === "worker") {
    finisherEmpId = appState.currentUser.id;
  }

  pendingFinishContext = {
    orderId: order.id,
    finisherEmpId,
  };

  closeChecklistDialog();
  openTimeDialog(order);
}

// ==========================
//   DIALOG VORGABEZEITEN
// ==========================

function getOrCreateTimeDialog() {
  let dlg = document.getElementById("timeDialog");
  if (dlg) return dlg;

  dlg = document.createElement("div");
  dlg.id = "timeDialog";
  dlg.className =
    "fixed inset-0 bg-black/40 z-[999] hidden items-center justify-center";

  dlg.innerHTML = `
        <div class="bg-white rounded-xl shadow-soft max-w-lg w-full p-6 mx-3">
            <h3 class="text-lg font-black text-slate-800 mb-4">
                Vorgabezeit je Spannung
            </h3>
            <div id="timeDialogBody" class="space-y-3 max-h-72 overflow-y-auto mb-4"></div>
            <div class="flex justify-end gap-2">
                <button id="timeDialogCancel"
                        class="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">
                    Abbrechen
                </button>
                <button id="timeDialogOk"
                        class="px-4 py-2 text-sm font-bold bg-brand text-white rounded hover:bg-brandDark">
                    Speichern & PDF
                </button>
            </div>
        </div>
    `;

  document.body.appendChild(dlg);
  return dlg;
}

function openTimeDialog(order) {
  const dlg = getOrCreateTimeDialog();
  const body = dlg.querySelector("#timeDialogBody");
  const btnCancel = dlg.querySelector("#timeDialogCancel");
  const btnOk = dlg.querySelector("#timeDialogOk");

  body.innerHTML = "";

  order.stations.forEach((s) => {
    const id = s.id;
    const status = s.timeStatus || "ok";
    const actual =
      typeof s.actualTimeMinutes === "number" ? s.actualTimeMinutes : "";

    body.innerHTML += `
            <div class="border rounded p-3">
                <div class="font-bold text-sm mb-2">Spannung ${id}</div>
                <div class="flex flex-wrap items-center gap-4 text-sm">
                    <label class="flex items-center gap-1">
                        <input type="radio" name="timeStatus_${id}" value="ok" ${
      status === "ok" || status === null ? "checked" : ""
    }>
                        <span>Vorgabezeit i.O.</span>
                    </label>
                    <label class="flex items-center gap-1">
                        <input type="radio" name="timeStatus_${id}" value="changed" ${
      status === "changed" ? "checked" : ""
    }>
                        <span>geändert</span>
                    </label>
                    <input type="number"
                           id="timeValue_${id}"
                           class="border rounded px-2 py-1 text-sm w-28"
                           placeholder="Ist-Zeit (min)"
                           value="${actual}"
                           ${status === "changed" ? "" : "disabled"}>
                </div>
            </div>
        `;
  });

  order.stations.forEach((s) => {
    const id = s.id;
    const radios = dlg.querySelectorAll(`input[name="timeStatus_${id}"]`);
    const input = dlg.querySelector(`#timeValue_${id}`);
    radios.forEach((r) => {
      r.addEventListener("change", () => {
        if (r.value === "changed" && r.checked) {
          input.disabled = false;
          input.focus();
        } else if (r.value === "ok" && r.checked) {
          input.disabled = true;
        }
      });
    });
  });

  btnCancel.onclick = () => {
    dlg.classList.add("hidden");
    dlg.classList.remove("flex");
    pendingFinishContext = null;
  };

  btnOk.onclick = () => {
    let valid = true;

    order.stations.forEach((s) => {
      const id = s.id;
      const radios = dlg.querySelectorAll(`input[name="timeStatus_${id}"]`);
      const input = dlg.querySelector(`#timeValue_${id}`);
      let chosen = "ok";
      radios.forEach((r) => {
        if (r.checked) chosen = r.value;
      });

      if (chosen === "changed") {
        const val = parseInt(input.value, 10);
        if (isNaN(val) || val <= 0) {
          valid = false;
        } else {
          s.timeStatus = "changed";
          s.actualTimeMinutes = val;
        }
      } else {
        s.timeStatus = "ok";
        s.actualTimeMinutes = null;
      }
    });

    if (!valid) {
      alert("Bitte alle geänderten Zeiten als ganze Minuten > 0 eintragen.");
      return;
    }

    saveData(false);

    dlg.classList.add("hidden");
    dlg.classList.remove("flex");

    finalizeOrderCompletionAfterTimes();
  };

  dlg.classList.remove("hidden");
  dlg.classList.add("flex");
}

async function finalizeOrderCompletionAfterTimes() {
  if (!pendingFinishContext) return;
  const { orderId, finisherEmpId } = pendingFinishContext;
  const order = appState.orders.find((o) => o.id === orderId);
  if (!order) {
    pendingFinishContext = null;
    return;
  }

  try {
    await exportPdf(true, finisherEmpId || null);
  } catch (e) {
    console.warn("PDF-Export (Abschluss) fehlgeschlagen:", e);
  }

  const machine = appState.machines.find((m) => m.id === order.machineId);
  if (machine) {
    machine.activeOrderIds = machine.activeOrderIds.filter(
      (id) => id !== order.id
    );
  }

  order.finishedAt = new Date().toISOString();

  saveData();
  pendingFinishContext = null;

  appState.activeOrderId = null;
  appState.currentView = "dashboard";
  renderView();
}

// ==========================
//   GLOBAL SCOPE (für HTML)
// ==========================

if (typeof window !== "undefined") {
  window.openAdminLogin = openAdminLogin;
  window.closeAdminLogin = closeAdminLogin;
  window.performAdminLogin = performAdminLogin;

  window.deleteOrder = deleteOrder;
  window.deleteActiveOrder = deleteActiveOrder;

  window.openNewOrderDialog = openNewOrderDialog;
  window.closeNewOrderDialog = closeNewOrderDialog;
  window.submitNewOrder = submitNewOrder;

  window.openAddEmployeeDialog = openAddEmployeeDialog;
  window.addEmployeeToOrder = addEmployeeToOrder;

  window.addStationToOrder = addStationToOrder;

  window.openMasterDataDialog = openMasterDataDialog;
  window.closeMasterDataDialog = closeMasterDataDialog;
  window.switchMasterTab = switchMasterTab;
  window.addDepartment = addDepartment;
  window.deleteDept = deleteDept;
  window.addMachine = addMachine;
  window.deleteMachine = deleteMachine;
  window.addEmployee = addEmployee;
  window.deleteEmployee = deleteEmployee;

  window.openBackupDialog = openBackupDialog;
  window.downloadBackup = downloadBackup;
  window.restoreBackup = restoreBackup;
  window.openProtocol = openProtocol;
  window.closeProtocol = closeProtocol;

  window.performDayReset = performDayReset;

  window.exportPdfFromButton = exportPdfFromButton;

  window.initiateOrderFinish = initiateOrderFinish;
  window.closeChecklistDialog = closeChecklistDialog;
  window.validateChecklist = validateChecklist;
  window.completeOrderFinal = completeOrderFinal;

  window.openOpDialog = openOpDialog;
  window.closeOpDialog = closeOpDialog;
  window.saveOpDialog = saveOpDialog;

  window.openNameDialog = openNameDialog;
  window.saveName = saveName;
  window.closeNameDialog = closeNameDialog;

  window.setStationCount = setStationCount;

  window.logout = logout;
  window.goToDashboard = goToDashboard;

  window.changeCount = changeCount;
  window.changeScrap = changeScrap;
  window.changeClarify = changeClarify;

  // Lagerort/Palette aktuell deaktiviert, aber Handler noch im Fenster
  window.handleTwoOneCheckboxChange = handleTwoOneCheckboxChange;
}
