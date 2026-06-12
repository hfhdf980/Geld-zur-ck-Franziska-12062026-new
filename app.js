// App State
let state = {
  campaigns: [], // Wird in DOMContentLoaded geladen
  filters: {
    search: "",
    category: "all",
    retailer: "all",
    sort: "default"
  },
  communityReports: [],
  monitorData: {}, // Live-Daten vom Monitor-Service (campaignName -> {status, checkedAt, responseTimeMs})
  // Store Locator State
  locator: {
    userCoords: null,
    searchRadius: 10, // Default 10km
    cityName: "",
    stores: [], // Generated mock stores
    activeFilters: [], // List of active store types
    cache: {} // Geocoding cache: query -> {lat, lon, cityName}
  }
};

/* ==========================================================================
   MONITOR SERVICE INTEGRATION
   ========================================================================== */
const MONITOR_API_URL = 'http://localhost:8082/api/limits';
const MONITOR_POLL_INTERVAL_MS = 60 * 1000; // 60 Sekunden

// Mappt Campaign-IDs aus data.js auf Monitor-Namen
const MONITOR_CAMPAIGN_MAP = {
  'axe-duschgel':                    'Axe Fine Fragrance',
  'somat-excellence':                 'Somat',
  'cottonelle-feucht':                'Cottonelle',
  'nivea-derma-control':              'Nivea',
  'deli-reform-omega3':               'Deli Reform',
  'cillit-bang-cillit-bang-expert-k': 'Cillit Bang',
  'calgon-calgon-4in1-wasseren':      'Calgon',
  'ben-s-original-ben-s-original-stree': "Ben's Original",
  'zott-zott-pure-joy-joghur':      'Zott Pure Joy',
  'zott-zott-monte-ice-cream':       'Zott Monte',
  'andros-andros-be-nuts':           'Andros',
  'whiskas-geld-zurueck':            'Whiskas',
  'rockstar-mocktail':               'Rockstar',
  'purina-purina-gourmet-revel':     'Purina Gourmet',
  'cheez-it-cheez-it-double-chee':   'Cheez It',
  'nescafe-frappe':                  'Nescafe Frappe',
  'tony-s-chocolonely-tony-s-chocolonely-9': "Tony's Chocolonely"
};

/**
 * Ruft die Live-Daten vom Monitor-Service ab und speichert sie im State.
 * Re-rendert die Karten bei Änderungen.
 */
async function fetchMonitorData() {
  try {
    const response = await fetch(MONITOR_API_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const data = await response.json();

    let changed = false;
    const newMonitorData = {};
    if (data && Array.isArray(data.campaigns)) {
      data.campaigns.forEach(c => {
        newMonitorData[c.name] = {
          status: c.status,
          checkedAt: c.checkedAt,
          responseTimeMs: c.responseTimeMs,
          error: c.error
        };
        // Prüfe ob sich ein Status geändert hat
        if (!state.monitorData[c.name] || state.monitorData[c.name].status !== c.status) {
          changed = true;
        }
      });
    }
    state.monitorData = newMonitorData;
    if (changed) {
      renderCampaigns();
    }
    // Stats-Karte immer aktualisieren (auch wenn sich nur Timestamps ändern)
    updateStats();
    // Aktualisiere Live-Badge Timestamps ohne Neurendern
    updateMonitorTimestamps();
  } catch (e) {
    // Kein Monitor-Service erreichbar – stille Ignorierung
  }
}

/**
 * Aktualisiert nur die Zeitstempel in bereits gerenderten Live-Badges.
 */
function updateMonitorTimestamps() {
  document.querySelectorAll('[data-monitor-time]').forEach(el => {
    const iso = el.getAttribute('data-monitor-time');
    if (iso) {
      el.textContent = formatRelativeTime(iso);
    }
  });
}

/**
 * Gibt eine lesbare relative Zeit zurück ("Vor 2 Min.", "Vor 1 Std.", etc.)
 */
function formatRelativeTime(isoString) {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return 'Gerade eben';
    if (diff < 3600) return `Vor ${Math.floor(diff / 60)} Min.`;
    return `Vor ${Math.floor(diff / 3600)} Std.`;
  } catch {
    return '';
  }
}

/**
 * Gibt das HTML für das Live-Status-Badge zurück.
 * @param {string} campaignId - Die ID der Kampagne aus data.js
 * @returns {string} HTML-String
 */
function getLiveMonitorBadge(campaignId) {
  const monitorName = MONITOR_CAMPAIGN_MAP[campaignId];
  if (!monitorName) return ''; // Kein Monitoring für diese Aktion

  const data = state.monitorData[monitorName];

  // Service noch nicht geantwortet
  if (!data) {
    return `
      <div class="live-monitor-badge live-monitor-loading">
        <span class="live-dot live-dot-gray"></span>
        <span>Live-Status wird geladen…</span>
      </div>`;
  }

  let dotClass = 'live-dot-gray';
  let label = 'Unbekannt';
  let badgeClass = 'live-monitor-unknown';

  switch (data.status) {
    case 'open':
      dotClass = 'live-dot-green';
      label = '✓ Jetzt offen – Teilnahme möglich';
      badgeClass = 'live-monitor-open';
      break;
    case 'daily_limit_reached': {
      dotClass = 'live-dot-red';
      badgeClass = 'live-monitor-limit';
      // Pick the right label based on the campaign's limitType
      const campaignData = state.campaigns.find(c => c.id === campaignId);
      const limitType = campaignData ? campaignData.limitType : 'daily';
      if (limitType === 'weekly') {
        label = '✕ Wochenlimit erreicht';
      } else if (limitType === 'total') {
        label = '✕ Gesamtkontingent erschöpft';
      } else {
        label = '✕ Tageslimit heute erreicht';
      }
      break;
    }
    case 'prestart':
      dotClass = 'live-dot-yellow';
      label = '⏳ Aktion noch nicht gestartet';
      badgeClass = 'live-monitor-prestart';
      break;
    case 'ended':
      dotClass = 'live-dot-gray';
      label = 'Aktion beendet';
      badgeClass = 'live-monitor-ended';
      break;
    case 'error':
      dotClass = 'live-dot-gray';
      label = 'Status nicht abrufbar';
      badgeClass = 'live-monitor-error';
      break;
    default:
      dotClass = 'live-dot-gray';
      label = 'Status unbekannt';
      badgeClass = 'live-monitor-unknown';
  }

  const timeStr = data.checkedAt ? formatRelativeTime(data.checkedAt) : '';

  return `
    <div class="live-monitor-badge ${badgeClass}">
      <span class="live-dot ${dotClass}"></span>
      <span class="live-monitor-label">${label}</span>
      ${timeStr ? `<span class="live-monitor-time" data-monitor-time="${data.checkedAt}">${timeStr}</span>` : ''}
    </div>`;
}

// Beliebte deutsche Händler für den Abgleich
const POPULAR_RETAILERS = [
  { id: "REWE", name: "REWE", type: "supermarket" },
  { id: "Edeka", name: "EDEKA", type: "supermarket" },
  { id: "Kaufland", name: "Kaufland", type: "supermarket" },
  { id: "dm-drogerie markt", name: "dm Drogerie", type: "drogerie" },
  { id: "Rossmann", name: "Rossmann", type: "drogerie" },
  { id: "Müller", name: "Müller", type: "drogerie" },
  { id: "Aldi", name: "Aldi (Nord/Süd)", type: "discounter" },
  { id: "Lidl", name: "Lidl", type: "discounter" }
];

// Standard-Meldungen für den Live-Ticker (Echtzeiteindruck)
const DEFAULT_REPORTS = [
  {
    id: 1,
    user: "SparFuchs94",
    productName: "Die Limo von Granini (1,0l PET oder Dose)",
    productId: "die-limo-granini",
    retailer: "REWE",
    status: "ok",
    text: "Kassenzettel am Vormittag hochgeladen. Bestätigung über 1,79 € Erstattung kam am nächsten Tag. Hat wunderbar geklappt! Das wöchentliche Limit von 7.078 Plätzen ist meist über die ganze Woche gut verfügbar.",
    timestamp: "Vor 12 Minuten"
  },
  {
    id: 2,
    user: "DrogerieQueen",
    productName: "Axe Fine Fragrance Body Wash gratis testen",
    productId: "axe-duschgel",
    retailer: "dm-drogerie markt",
    status: "danger",
    text: "Das tägliche Limit von 2.500 Plätzen war heute leider schon um 11:30 Uhr voll. Probiere es morgen früh direkt ab 08:00 Uhr wieder!",
    timestamp: "Vor 45 Minuten"
  },
  {
    id: 3,
    user: "SparHase",
    productName: "Deli Reform Omega-3 Daily (225g)",
    productId: "deli-reform-omega3",
    retailer: "EDEKA",
    status: "danger",
    text: "Das tägliche Limit von 100 Uploads für die Deli Reform Margarine war heute Morgen schon nach 5 Minuten komplett aufgebraucht! Bitte den Bon direkt um 08:00 Uhr hochladen.",
    timestamp: "Vor 2 Stunden"
  },
  {
    id: 4,
    user: "Sparguru",
    productName: "Somat Gel gratis testen",
    productId: "somat-excellence",
    retailer: "Kaufland",
    status: "danger",
    text: "Das tägliche Kontingent von 1.208 Teilnahmen bei Somat war heute um 14:00 Uhr leider komplett voll. Schade. Probiere es morgen früh direkt um 09:00 Uhr wieder!",
    timestamp: "Vor 3 Stunden"
  },
  {
    id: 5,
    user: "SchnaeppchenKönig",
    productName: "Air Wick, Calgon & Cillit Bang (3 € ab 10 € Einkauf)",
    productId: "airwick-calgon-cillit",
    retailer: "Rossmann",
    status: "ok",
    text: "Habe gestern meinen Kassenbon über 11,50 € hochgeladen (Air Wick & Calgon). Die 3 € Erstattung wurden nach wenigen Stunden per E-Mail bestätigt. Keine Probleme!",
    timestamp: "Vor 5 Stunden"
  },
  {
    id: 6,
    user: "NiveaFan",
    productName: "Nivea Deo Derma Control (Clinical)",
    productId: "nivea-derma-control",
    retailer: "Rossmann",
    status: "danger",
    text: "Habe versucht meinen Bon hochzuladen, aber das tägliche Limit von 4.000 Teilnahmen ist für heute bereits komplett erreicht.",
    timestamp: "Vor 1 Stunde"
  },
  {
    id: 7,
    user: "SauberMann",
    productName: "Cottonelle Feuchtes Toilettenpapier Ultimativ Frisch gratis testen",
    productId: "cottonelle-feucht",
    retailer: "dm-drogerie markt",
    status: "danger",
    text: "Das tägliche Limit von 604 Uploads für Cottonelle war heute leider schon um 08:25 Uhr voll. Man muss wirklich direkt um 08:00 Uhr morgens hochladen, um einen Platz zu bekommen!",
    timestamp: "Vor 15 Minuten"
  },
  {
    id: 8,
    user: "SchokoFuchs",
    productName: "Tony's Chocolonely 90g oder 180g Tafel",
    productId: "tony-s-chocolonely-tony-s-chocolonely-9",
    retailer: "REWE",
    status: "danger",
    text: "Das wöchentliche Limit von 1.300 Plätzen für Tony's Schokolade ist für diese Woche leider bereits komplett voll. Nächste Woche ab Montag 09:00 Uhr wieder!",
    timestamp: "Vor 10 Minuten"
  }
];

/* ==========================================================================
   INITIALISIERUNG & EVENT LISTENERS
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  try {
    if (window.CAMPAIGNS) {
      state.campaigns = JSON.parse(JSON.stringify(window.CAMPAIGNS));
    } else {
      throw new Error("Fehler: Aktionen konnten nicht geladen werden (data.js fehlt oder ist fehlerhaft).");
    }
    initCommunityReports();
    initFormSelects();
    setupEventListeners();
    renderApp();
    
    // Simuliere Live-Traffic, um den Prototypen zum Leben zu erwecken (WOW-Effekt)
    startLiveTrafficSimulation();

    // Monitor-Service Live-Daten laden und alle 60s aktualisieren
    fetchMonitorData();
    setInterval(fetchMonitorData, MONITOR_POLL_INTERVAL_MS);
    // Timestamps jede Minute frisch rendern
    setInterval(updateMonitorTimestamps, 60 * 1000);
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin', '<div style="background:red;color:white;padding:20px;z-index:99999;position:fixed;top:0;left:0;width:100%;">' + e.toString() + '</div>');
  }
});

// Initialisiert die Community-Meldungen (aus LocalStorage oder Default-Werten)
function initCommunityReports() {
  const saved = localStorage.getItem("gratis_testen_reports_v2.3");
  let parsed = null;
  try { parsed = saved ? JSON.parse(saved) : null; } catch(e) {}
  
  // Falls das LocalStorage veraltete Aktionen enthält, überschreiben wir es mit den neuen Defaults
  const hasInvalidProduct = parsed && parsed.some(r => !state.campaigns.some(c => c.id === r.productId));
  
  if (parsed && !hasInvalidProduct) {
    state.communityReports = parsed;
  } else {
    state.communityReports = [...DEFAULT_REPORTS];
    localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
  }
}

// Füllt die Auswahllisten im Community-Formular dynamisch
function initFormSelects() {
  const productSelect = document.getElementById("report-product");
  productSelect.innerHTML = "";
  const now = new Date();
  
  state.campaigns.forEach(c => {
    const isExpired = new Date(c.deadline) < now;
    if (isExpired) return;
    
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    productSelect.appendChild(opt);
  });
}

// Registriert alle UI-Event-Listeners
function setupEventListeners() {
  // Suche
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    renderApp();
  });
  
  // Kategorie-Dropdown
  document.getElementById("filter-category").addEventListener("change", (e) => {
    state.filters.category = e.target.value;
    updateCategoryChips(e.target.value);
    renderApp();
  });
  
  // Händler-Dropdown (Direkter Händlerabgleich - User Request)
  document.getElementById("filter-retailer").addEventListener("change", (e) => {
    state.filters.retailer = e.target.value;
    renderApp();
  });
  
  // Sortierung
  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.filters.sort = e.target.value;
    renderApp();
  });
  
  // Kategorie-Chips (Klickbare Filter-Schaltflächen)
  document.querySelectorAll(".category-chips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".category-chips .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      
      const cat = chip.dataset.category;
      state.filters.category = cat;
      document.getElementById("filter-category").value = cat;
      renderApp();
    });
  });
  
  // Community-Formular Absenden
  document.getElementById("report-form").addEventListener("submit", handleReportSubmit);
  
  // Modal Schließen
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("detail-modal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("detail-modal")) {
      closeModal();
    }
  });
  
  // ESC Taste schließt Modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// Passt die aktiven Chips an, wenn das Dropdown geändert wird
function updateCategoryChips(activeCategory) {
  document.querySelectorAll(".category-chips .chip").forEach(chip => {
    if (chip.dataset.category === activeCategory) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });
}

/* ==========================================================================
   APP-RENDERING LOGIK
   ========================================================================== */
function renderApp() {
  updateStats();
  renderCampaigns();
  renderReportsFeed();
}

// Berechnet und aktualisiert die Dashboard-Statistiken
function updateStats() {
  const now = new Date();

  const activeCount = state.campaigns.filter(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    return !isExpired && !isUpcoming;
  }).length;

  const totalPotential = state.campaigns
    .filter(c => {
      const isExpired = new Date(c.deadline) < now;
      const isUpcoming = c.startDate && new Date(c.startDate) > now;
      return !isExpired && !isUpcoming;
    })
    .reduce((sum, c) => sum + c.cashbackVal, 0);

  // Tageslimit-Zähler: Live aus dem Monitor-Service
  // Zähle alle aktiven Kampagnen, für die der Monitor "daily_limit_reached" meldet
  const monitorDailyReached = Object.values(state.monitorData)
    .filter(d => d.status === 'daily_limit_reached').length;

  // Fallback auf Community-Reports wenn Monitor noch keine Daten hat
  const communityDailyReached = state.campaigns.filter(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    return !isExpired && !isUpcoming &&
      (c.limitType === "daily" || c.limitType === "weekly") &&
      state.communityReports.some(r => r.productId === c.id && r.status === "danger");
  }).length;

  const dailyReachedCount = monitorDailyReached > 0 ? monitorDailyReached : communityDailyReached;

  // Gesamtlimit erreicht: abgelaufene Aktionen + komplett erschöpfte (total)
  const totalReachedCount = state.campaigns.filter(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    const monitorEntry = state.monitorData[MONITOR_CAMPAIGN_MAP[c.id]];
    const isMonitorEnded = monitorEntry && monitorEntry.status === 'ended';
    const isTotalFull = state.communityReports.some(r =>
      r.productId === c.id && r.status === "danger" && c.limitType === "total"
    );
    return (isExpired && !isUpcoming) || (isTotalFull && !isUpcoming) || (isMonitorEnded && !isUpcoming);
  }).length;

  // DOM-Befüllung
  document.getElementById("val-active").textContent = activeCount;
  document.getElementById("val-potential").textContent = totalPotential.toFixed(2);

  const dailyReachedEl = document.getElementById("val-daily-reached");
  if (dailyReachedEl) dailyReachedEl.textContent = dailyReachedCount;

  const totalReachedEl = document.getElementById("val-total-reached");
  if (totalReachedEl) totalReachedEl.textContent = totalReachedCount;
}


// Filtert, sortiert und rendert das Aktions-Grid
function renderCampaigns() {
  const grid = document.getElementById("campaign-grid");
  grid.innerHTML = "";
  const now = new Date();
  
  // 1. Filtern
  let filtered = state.campaigns.filter(c => {
    // Exclude expired campaigns automatically (User Request)
    const isExpired = new Date(c.deadline) < now;
    if (isExpired) return false;
    
    // Suche
    const searchMatch = 
      c.name.toLowerCase().includes(state.filters.search.toLowerCase()) ||
      c.brand.toLowerCase().includes(state.filters.search.toLowerCase());
      
    // Kategorie
    const catMatch = state.filters.category === "all" || c.category === state.filters.category;
    
    // Händler (Core-Feature für User-Abgleich)
    let retailerMatch = true;
    if (state.filters.retailer !== "all") {
      const selected = state.filters.retailer;
      // Überprüfe Händlerausschluss
      const isExcluded = c.excludedRetailers.some(r => 
        r.toLowerCase().includes(selected.toLowerCase()) || 
        (selected === "Aldi" && r.toLowerCase().includes("aldi"))
      );
      
      const isAllRetailersAllowed = c.allowedRetailers.length === 0;
      
      const isAllowed = isAllRetailersAllowed || c.allowedRetailers.some(r => 
        r.toLowerCase().includes(selected.toLowerCase()) || 
        (selected === "Aldi" && r.toLowerCase().includes("aldi"))
      );
      
      retailerMatch = isAllowed && !isExcluded;
    }
    
    return searchMatch && catMatch && retailerMatch;
  });
  
  // 2. Sortieren
  filtered.sort((a, b) => {
    const sortVal = state.filters.sort;
    if (sortVal === "cashback-desc") {
      return b.cashbackVal - a.cashbackVal;
    } else if (sortVal === "deadline-asc") {
      return new Date(a.deadline) - new Date(b.deadline);
    }
    
    // Default: Beliebte & Noch offene Aktionen zuerst, dann Vorschau-Aktionen, abgelaufene ganz nach hinten
    const aExpired = new Date(a.deadline) < now ? 1 : 0;
    const bExpired = new Date(b.deadline) < now ? 1 : 0;
    if (aExpired !== bExpired) return aExpired - bExpired;
    
    const aUpcoming = a.startDate && new Date(a.startDate) > now ? 1 : 0;
    const bUpcoming = b.startDate && new Date(b.startDate) > now ? 1 : 0;
    if (aUpcoming !== bUpcoming) return aUpcoming - bUpcoming;
    
    if (aUpcoming && bUpcoming) {
      return new Date(a.startDate) - new Date(b.startDate);
    }
    
    return (b.isPopular ? 1 : 0) - (a.isPopular ? 1 : 0);
  });
  
  // 3. Fehlermeldung bei leeren Ergebnissen
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 48px; background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--border-radius-md);">
        <p style="color: var(--text-secondary); font-size: 1.1rem; margin-bottom: 8px;">Keine passenden Aktionen gefunden.</p>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Passe deine Such- oder Händlerfilter an, um mehr Aktionen zu sehen.</p>
      </div>
    `;
    return;
  }
  
  // 4. Rendern
  filtered.forEach(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    
    // Monitor-Status für diese Kampagne abrufen (hat Vorrang vor Community-Reports)
    const monitorName = MONITOR_CAMPAIGN_MAP[c.id];
    const monitorEntry = monitorName ? state.monitorData[monitorName] : null;
    const monitorStatus = monitorEntry ? monitorEntry.status : null;

    // Status-Klassen bestimmen – Monitor hat Vorrang
    let limitStatusClass = "success-limit";
    if (isExpired) {
      limitStatusClass = "expired-campaign";
    } else if (isUpcoming) {
      limitStatusClass = "upcoming-campaign";
    } else if (monitorStatus === 'daily_limit_reached') {
      limitStatusClass = "danger-limit";
    } else if (monitorStatus === 'ended') {
      limitStatusClass = "expired-campaign";
    } else if (monitorStatus === 'open') {
      limitStatusClass = "success-limit";
    } else {
      // Fallback: Community-Reports
      const productReports = state.communityReports.filter(r => r.productId === c.id);
      if (productReports.length > 0) {
        const latestReport = productReports[productReports.length - 1];
        if (latestReport.status === "danger") {
          limitStatusClass = "danger-limit";
        } else if (latestReport.status === "warning") {
          limitStatusClass = "warning-limit";
        }
      } else {
        if (c.limitType === "daily" && (c.id === "deli-reform-omega3" || c.id === "cottonelle-feucht")) {
          limitStatusClass = "warning-limit";
        }
      }
    }
    
    const card = document.createElement("article");
    card.className = `campaign-card ${limitStatusClass}`;
    
    const brandColor = isExpired ? "#475569" : getBrandColor(c.brand);
    const formattedDeadline = new Date(c.deadline).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
    
    let formattedStartDate = "";
    if (c.startDate) {
      formattedStartDate = new Date(c.startDate).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
    }
    
    // Retailer badges
    let allowedBadges = c.allowedRetailers.slice(0, 3).map(r => `<span class="retailer-preview-badge allowed">${r}</span>`).join("");
    if (c.allowedRetailers.length > 3) {
      allowedBadges += `<span class="retailer-preview-badge">+${c.allowedRetailers.length - 3}</span>`;
    }
    if (c.allowedRetailers.length === 0) {
      // Nur stationär, wenn Online-Shops in den Ausschlüssen stehen, oder der Händlertext "stationär" enthält, ohne "online" (wie Online-Handel) zu erlauben
      const hasOnlineExclusion = c.excludedRetailers.includes("Online-Shops");
      const isStationaryOnlyText = c.allowedRetailersText.toLowerCase().includes("stationär") && 
                                    !c.allowedRetailersText.toLowerCase().includes("und online") && 
                                    !c.allowedRetailersText.toLowerCase().includes("online-handel");
      
      if (hasOnlineExclusion || isStationaryOnlyText) {
        allowedBadges = `<span class="retailer-preview-badge allowed">✓ Alle Händler (stationär)</span>`;
      } else {
        allowedBadges = `<span class="retailer-preview-badge allowed">✓ Alle Händler erlaubt</span>`;
      }
    }
    
    let cardBadge = "";
    if (isExpired) {
      cardBadge = `<span class="cashback-badge expired">Abgelaufen</span>`;
    } else if (isUpcoming) {
      cardBadge = `
        <div class="card-badges" style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
          <span class="cashback-badge upcoming">Vorschau</span>
          <span class="cashback-badge" style="background: hsla(var(--success-hsl), 0.04); border-color: hsla(var(--success-hsl), 0.12);">${c.cashbackVal.toFixed(2)} € Erstattung</span>
        </div>
      `;
    } else if (limitStatusClass === "danger-limit") {
      let limitLabel = "Limit erreicht";
      if (c.limitType === "daily") {
        limitLabel = "Tageslimit voll";
      } else if (c.limitType === "weekly") {
        limitLabel = "Wochenlimit voll";
      } else if (c.limitType === "total") {
        limitLabel = "Aktion beendet";
      }
      cardBadge = `
        <div class="card-badges" style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
          <span class="cashback-badge danger">${limitLabel}</span>
          <span class="cashback-badge" style="background: hsla(var(--success-hsl), 0.04); border-color: hsla(var(--success-hsl), 0.12);">${c.cashbackVal.toFixed(2)} € Erstattung</span>
        </div>
      `;
    } else {
      cardBadge = `<span class="cashback-badge">${c.cashbackVal.toFixed(2)} € Erstattung</span>`;
    }

    const isMonitorLimitReached = monitorStatus === 'daily_limit_reached' || monitorStatus === 'ended';
    const actionButton = isExpired ?
      `<button class="btn btn-secondary" onclick="openCampaignDetail('${c.id}')">Einreichen &amp; Infos</button>` :
      (isUpcoming ?
        `<button class="btn btn-secondary" onclick="openCampaignDetail('${c.id}')">Details &amp; Infos</button>` :
        (isMonitorLimitReached ?
          `<button class="btn btn-secondary" onclick="openCampaignDetail('${c.id}')">Infos &amp; Details</button>` :
          `<button class="btn btn-primary" onclick="openCampaignDetail('${c.id}')">✓ Produkt &amp; Händler prüfen</button>`
        )
      );
      
    let deadlineBadgeHtml = "";
    if (isExpired) {
      deadlineBadgeHtml = `Beendet am ${formattedDeadline}`;
    } else if (isUpcoming) {
      deadlineBadgeHtml = `Startet am ${formattedStartDate}`;
    } else {
      deadlineBadgeHtml = `Bis ${formattedDeadline}`;
    }
    
    const deadlineClass = isExpired ? 'expired-deadline' : (isUpcoming ? 'upcoming-deadline' : '');
    
    card.innerHTML = `
      <div class="card-header">
        <div class="brand-info">
          <img src="${c.imageUrl}" alt="${c.brand}" class="brand-avatar-img" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://placehold.co/200x200/f1f5f9/64748b?text=Kein+Bild';">
          <div class="brand-names">
            <span class="brand-label" style="color: ${brandColor};">${c.brand}</span>
            <h3 class="product-name">${c.name}</h3>
          </div>
        </div>
        ${cardBadge}
      </div>
      
      <div class="availability-section">
        <div class="availability-info">
          <span class="availability-title">${isExpired ? 'Aktions-Status' : (isUpcoming ? 'Vorschau-Status' : (c.limitType === 'daily' ? 'Tageslimit' : (c.limitType === 'weekly' ? 'Wöchentliches Limit' : 'Gesamtlimit')))}</span>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">
            ${c.limitNote}
          </div>
        </div>
      </div>

      ${MONITOR_CAMPAIGN_MAP[c.id] ? getLiveMonitorBadge(c.id) : ''}
      
      <div class="retailer-preview">
        <div class="retailer-preview-title">Einkauf möglich bei:</div>
        <div class="retailer-preview-list">
          ${allowedBadges}
        </div>
      </div>
      
      <div class="card-footer">
        <span class="deadline-badge ${deadlineClass}">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
          </svg>
          ${deadlineBadgeHtml}
        </span>
        ${actionButton}
      </div>
    `;
    
    grid.appendChild(card);
  });
}

// Rendert den Community Live-Ticker
function renderReportsFeed() {
  const feed = document.getElementById("reports-feed");
  feed.innerHTML = "";
  
  // Neueste Meldungen zuerst anzeigen
  const sortedReports = [...state.communityReports].reverse();
  
  sortedReports.forEach(r => {
    let statusClass = "status-ok";
    let statusLabel = "Erfolgreich eingelöst";
    if (r.status === "warning") {
      statusClass = "status-warning";
      statusLabel = "Bestand knapp";
    } else if (r.status === "danger") {
      statusClass = "status-danger";
      statusLabel = "Aktion fehlgeschlagen";
    }
    
    const div = document.createElement("div");
    div.className = "report-item";
    div.innerHTML = `
      <div class="report-meta">
        <span class="report-user">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path>
          </svg>
          ${r.user}
        </span>
        <span>${r.timestamp || 'Gerade eben'}</span>
      </div>
      <p class="report-text">${r.text}</p>
      <div class="report-tags">
        <span class="report-tag">${r.productName}</span>
        <span class="report-tag">Gekauft bei: ${r.retailer}</span>
        <span class="report-badge ${statusClass}">${statusLabel}</span>
      </div>
    `;
    feed.appendChild(div);
  });
}

/* ==========================================================================
   DETAIL-MODAL & INTERACTIVE RETAILER MATCHING (User Request Core Feature)
   ========================================================================== */
let currentActiveCampaign = null;

function openCampaignDetail(campaignId) {
  const c = state.campaigns.find(item => item.id === campaignId);
  if (!c) return;
  currentActiveCampaign = c;
  
  const modal = document.getElementById("detail-modal");
  const bodyContent = document.getElementById("modal-body-content");
  const brandColor = getBrandColor(c.brand);
  
  const now = new Date();
  const isUpcoming = c.startDate && new Date(c.startDate) > now;
  const upcomingNoticeHtml = isUpcoming ? `
        <div class="modal-card-block" style="margin-bottom: 24px; border-left: 4px solid var(--warning); background: rgba(245, 158, 11, 0.07); padding-top: 16px; padding-bottom: 16px;">
          <h3 style="color: var(--warning); display: flex; align-items: center; gap: 8px; font-weight: 700; border-left: none; padding-left: 0; margin-bottom: 8px;">
            ⚠️ Vorschau: Aktion startet erst am ${new Date(c.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
          </h3>
          <p style="font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); margin-top: 8px;">
            Diese Aktion ist aktuell noch nicht aktiv. Einkäufe und Kassenbon-Einreichungen vor dem <strong>${new Date(c.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</strong> werden vom Veranstalter abgelehnt. Du kannst dich aber bereits hier über die Teilnahmebedingungen informieren.
          </p>
        </div>
  ` : "";
  
  // 1. Erzeuge Händler-Checkliste (Direkter Abgleich mit Bedingungen)
  const checklistHtml = POPULAR_RETAILERS.map(retailer => {
    // Finde heraus, ob Händler in den Teilnahmebedingungen ausgeschlossen ist
    const isExcluded = c.excludedRetailers.some(ex => 
      retailer.id.toLowerCase().includes(ex.toLowerCase()) ||
      ex.toLowerCase().includes(retailer.id.toLowerCase()) ||
      (retailer.id === "Aldi" && ex.toLowerCase().includes("aldi"))
    );
    
    // Finde heraus, ob der Händler explizit oder implizit erlaubt ist
    const isAllRetailersAllowed = c.allowedRetailers.length === 0;
    
    const isAllowed = (isAllRetailersAllowed || c.allowedRetailers.some(al => 
      retailer.id.toLowerCase().includes(al.toLowerCase()) ||
      al.toLowerCase().includes(retailer.id.toLowerCase()) ||
      (retailer.id === "Aldi" && al.toLowerCase().includes("aldi"))
    )) && !isExcluded;
    
    const statusClass = isAllowed ? "allowed" : "excluded";
    const statusIcon = isAllowed ? "✓" : "✗";
    const statusText = isAllowed ? "Erlaubt" : "Ausgeschlossen";
    
    return `
      <div class="retailer-status-box ${statusClass}">
        <span class="retailer-status-icon">${statusIcon}</span>
        <span class="retailer-status-name">${retailer.name}</span>
        <span style="font-size: 0.7rem; opacity: 0.8;">${statusText}</span>
      </div>
    `;
  }).join("");

  // 2. Erzeuge Händler-Dropdown-Optionen für den Simulator
  const simulatorRetailerOptions = POPULAR_RETAILERS.map(retailer => {
    return `<option value="${retailer.id}">${retailer.name}</option>`;
  }).join("");
  
  // 2.b. Erzeuge Insider-Tipps
  const tipsHtml = c.tips && c.tips.length > 0 ? `
        <div class="modal-card-block" style="margin-bottom: 24px; border-left: 4px solid var(--warning); background: rgba(245, 158, 11, 0.07); padding-top: 16px; padding-bottom: 16px;">
          <h3 style="color: var(--warning); display: flex; align-items: center; gap: 8px; font-weight: 700;">
            💡 Insider-Tipps &amp; Stolperfallen
          </h3>
          <ul style="margin-top: 12px; font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); padding-left: 20px; list-style-type: disc;">
            ${c.tips.map(tip => `<li style="margin-bottom: 8px;">${tip}</li>`).join("")}
          </ul>
        </div>
  ` : "";
  
  // 3. Fülle das Modal mit dem dynamischen Inhalt
  bodyContent.innerHTML = `
    <div class="modal-campaign-header">
      <img src="${c.imageUrl}" alt="${c.brand}" class="brand-avatar-img modal-avatar-img" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\' viewBox=\'0 0 200 200\'><rect width=\'200\' height=\'200\' fill=\'%23f1f5f9\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'12\' fill=\'%2364748b\'>Kein Bild</text></svg>';">
      <div>
        <span class="brand-label" style="font-size: 0.9rem; font-weight: 700; color: ${brandColor};">${c.brand}</span>
        <h2>${c.name}</h2>
      </div>
    </div>
    
    <div class="modal-grid">
      <!-- LINKE SEITE: Regeln & Händlerabgleich -->
      <div class="modal-main-section">
        ${upcomingNoticeHtml}
        ${tipsHtml}
        
        <div class="modal-card-block" style="margin-bottom: 24px;">
          <h3>🛍️ Kassenbon-Abgleich: Wo kaufen?</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
            Laut offiziellen Teilnahmebedingungen ist das Produkt bei folgenden Händlern zulässig bzw. ausgeschlossen:
          </p>
          <div class="retailers-grid">
            ${checklistHtml}
          </div>
          <div style="margin-top: 14px; font-size: 0.85rem; padding: 8px 12px; background: rgba(99, 102, 241, 0.05); border-radius: 4px; border-left: 3px solid var(--primary);">
            <strong>Offizielle Händlerregel:</strong> ${c.allowedRetailersText}
          </div>
        </div>

        <div class="modal-card-block store-locator-wrapper" style="margin-bottom: 24px;">
          <h3>📍 Filialen in deiner Nähe finden</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
            Gib deine Adresse ein, um teilnehmende Geschäfte in deiner Umgebung zu finden.
          </p>
          
          <div class="locator-search-container">
            <div class="locator-input-group">
              <span class="locator-search-icon" style="position: absolute; left: 14px; top: 12px; color: var(--text-muted);">🔍</span>
              <input type="text" id="locator-search-input" class="locator-search-input" placeholder="Adresse, Ort oder PLZ eingeben...">
            </div>
            
            <div class="radius-selector">
              <span class="radius-label">Radius:</span>
              <div class="radius-segments" id="radius-segments">
                <button class="radius-segment-btn" data-radius="5">5 km</button>
                <button class="radius-segment-btn active" data-radius="10">10 km</button>
                <button class="radius-segment-btn" data-radius="15">15 km</button>
              </div>
            </div>
            
            <div class="locator-action-btns">
              <button class="btn btn-secondary" onclick="useCurrentLocation('${c.id}')" style="justify-content: center; font-weight: 600;">
                📍 Standort verwenden
              </button>
              <button class="btn btn-primary" onclick="searchStores('${c.id}')" style="justify-content: center; font-weight: 700;">
                Standorte finden
              </button>
              <button id="gmaps-search-btn" class="btn" onclick="openSearchInGoogleMaps('${c.id}')" style="display: none; justify-content: center; font-weight: 600; grid-column: span 2; background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; margin-top: 4px;">
                🗺️ In Google Maps anzeigen
              </button>
            </div>
          </div>
          
          <!-- Map container -->
          <div id="locator-map" class="store-map" style="display: none;"></div>
          
          <!-- Filter chips -->
          <div id="locator-filter-container" class="locator-filter-container" style="display: none;">
            <div class="locator-filter-title">Händler filtern:</div>
            <div id="locator-filter-chips" class="locator-filter-chips"></div>
          </div>
          
          <!-- Results list -->
          <div id="locator-results-container" style="display: none;">
            <div id="locator-results-title" class="store-results-title">Gefundene Filialen:</div>
            <div id="locator-results-list" class="store-results-list"></div>
          </div>
        </div>

        <div class="modal-card-block" style="margin-bottom: 24px;">
          <h3>📦 Teilnehmende Aktionsartikel</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
            Folgende Artikel und Sorten nehmen offiziell an der Aktion teil:
          </p>
          <div class="participating-products-list">
            ${c.participatingProducts.map(prod => `
              <div class="participating-product-item">
                <img src="${prod.imageUrl}" alt="${prod.name}" class="product-item-img" style="${prod.imageStyle || ''}" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://placehold.co/200x200/f1f5f9/64748b?text=Kein+Bild';">
                <span class="product-item-name">${prod.name}</span>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="modal-card-block">
          <h3>📋 Teilnahmebedingungen</h3>
          <ul class="conditions-list" style="margin-top: 12px;">
            ${c.conditions.map(cond => `<li>${cond}</li>`).join("")}
          </ul>
        </div>
      </div>
      
      <!-- RECHTE SEITE: Händler- und Produktprüfer & Aktionen -->
      <div>
        <div class="simulator-box" id="scanner-box">
          <h3 style="border-left: 3px solid var(--accent-cyan); padding-left: 8px;">✓ Produkt &amp; Händler prüfen</h3>
          <p style="font-size: 0.85rem; margin-bottom: 12px; line-height: 1.4; color: var(--text-muted);">
            Überprüfe vor dem Kauf, ob dein Wunschprodukt und der Händler für diese Cashback-Aktion zulässig sind.
          </p>
          
          <!-- Schritt 1: Händler auswählen -->
          <div class="form-group" style="margin-bottom: 12px;">
            <label for="checker-retailer" style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; display:block;">
              📍 Schritt 1: Händler auswählen
            </label>
            <select id="checker-retailer" class="filter-select" style="background: rgba(255, 255, 255, 0.9); color: var(--text-primary);" onchange="onCheckerRetailerChange()">
              <option value="none">-- Bitte Händler wählen --</option>
              ${simulatorRetailerOptions}
            </select>
          </div>

          <!-- Schritt 2: Händler-Prüfung Statusbox -->
          <div id="checker-retailer-status-box" class="checker-retailer-status-box" style="display: none;"></div>

          <!-- Schritt 2: Barcode eingeben -->
          <div id="checker-barcode-input-container" class="form-group" style="margin-bottom: 12px;">
            <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; display:block;">
              🏷️ Schritt 2: EAN / Barcode eingeben
            </label>
            <div class="checker-input-row">
              <input type="text" id="checker-manual-ean" placeholder="EAN (z.B. 8712561234567)" class="filter-select" style="background: rgba(255, 255, 255, 0.9); color: var(--text-primary); margin: 0;" disabled>
              <button class="btn btn-primary" id="checker-manual-btn" onclick="checkManualEan()" style="padding: 0 16px;" disabled>Prüfen</button>
            </div>
            <button class="btn btn-secondary" id="checker-scanner-toggle-btn" onclick="toggleCameraScanner()" style="width: 100%; justify-content: center; margin-top: 4px; font-size: 0.85rem; padding: 8px 12px;" disabled>
              📷 Barcode scannen
            </button>
          </div>

          <div id="checker-scanner-container" style="display: none; margin-top: 10px;">
            <div id="reader" style="width: 100%;"></div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; text-align: center;">
              Hinweis: Für Kamerazugriff muss die Seite über eine sichere Verbindung (HTTPS/localhost) aufgerufen werden.
            </div>
          </div>

          <!-- Spinner & API Abfrage-Text -->
          <div id="checker-spinner" class="spinner" style="margin: 15px auto 10px auto; display: none;"></div>
          <div id="checker-api-text" style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; display: none; text-align: center;">
            Prüfe Barcode...
          </div>

          <!-- Ergebniskarte -->
          <div id="checker-result-card" class="checker-result-card" style="display: none;"></div>
        </div>

        <div style="text-align: center; margin-top: 20px; display: flex; flex-direction: column; gap: 8px;">
          ${c.websiteUrls ? c.websiteUrls.map(link => `
            <a href="${link.url}" target="_blank" class="btn" style="width: 100%; justify-content: center; background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.2); color: var(--primary);">
              ${link.label} ↗
            </a>
          `).join("") : `
            <a href="${c.websiteUrl}" target="_blank" class="btn" style="width: 100%; justify-content: center; background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.2); color: var(--primary);">
              Zur offiziellen Aktionsseite ↗
            </a>
          `}
        </div>

        <div class="alert-signup-box">
          <h4>🔔 Limit-Wecker aktivieren</h4>
          <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.3; margin-top: 4px;">
            Lasse dich benachrichtigen, sobald das Tageslimit für dieses Produkt zu 80% voll ist.
          </p>
          <div class="alert-input-group">
            <input type="email" id="alert-email" placeholder="deine-mail@web.de">
            <button class="btn btn-primary" style="font-size: 0.8rem; padding: 6px 12px;" onclick="registerAlert('${c.name}')">Aktivieren</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  modal.classList.add("active");

  // Setup radius segment button event listeners
  const segments = document.querySelectorAll("#radius-segments .radius-segment-btn");
  segments.forEach(btn => {
    btn.addEventListener("click", () => {
      segments.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.locator.searchRadius = parseInt(btn.dataset.radius);
      // If we already have geocoded location, search again with new radius
      if (state.locator.userCoords) {
        searchStores(campaignId, true);
      }
    });
  });

  // Reset locator state for new campaign details view
  state.locator.userCoords = null;
  state.locator.stores = [];
  state.locator.activeFilters = [];
}

function closeModal() {
  document.getElementById("detail-modal").classList.remove("active");
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(e => console.error(e));
    html5QrcodeScanner = null;
  }
  // Clear map instance to prevent leaks and re-initialization error
  if (window.locatorMap) {
    window.locatorMap.remove();
    window.locatorMap = null;
    window.locatorMarkerGroup = null;
  }
}

/* ==========================================================================
   SIMULATION LOGICS (Receipt analysis, Konfetti, real-time feedback)
   ========================================================================== */
function simulateReceiptUpload(campaignId) {
  const c = state.campaigns.find(item => item.id === campaignId);
  const selectedRetailer = document.getElementById("sim-retailer").value;
  const overlay = document.getElementById("upload-processing");
  const zone = document.getElementById("upload-zone");
  
  if (!c) return;
  
  // Starte optische OCR-Simulation
  overlay.innerHTML = `
    <div class="spinner"></div>
    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">OCR-Texterkennung läuft...</div>
    <div style="font-size: 0.75rem; color: var(--text-muted);">Prüfe Händler: "${selectedRetailer}"</div>
  `;
  overlay.classList.add("active");
  
  setTimeout(() => {
    // 2. Abgleich mit Händlerausschlüssen (Direkte Regelauswertung)
    const isExcluded = c.excludedRetailers.some(ex => 
      ex.toLowerCase().includes(selectedRetailer.toLowerCase()) ||
      (selectedRetailer === "Aldi" && ex.toLowerCase().includes("aldi"))
    );
    
    const isAllAllowed = c.allowedRetailers.length === 0;
    const isAllowed = (isAllAllowed || c.allowedRetailers.some(al => 
      al.toLowerCase().includes(selectedRetailer.toLowerCase()) ||
      (selectedRetailer === "Aldi" && al.toLowerCase().includes("aldi"))
    )) && !isExcluded;
    
    if (!isAllowed) {
      // Fehlermeldung bei falschem Händler (Einhaltung der Teilnahmebedingungen bewiesen!)
      overlay.innerHTML = `
        <span class="success-icon-animated" style="color: var(--danger)">✗</span>
        <div style="font-size: 0.9rem; font-weight: 700; color: var(--danger);">Bon abgelehnt!</div>
        <div style="font-size: 0.75rem; color: var(--text-primary); text-align: center; padding: 0 10px; line-height: 1.3;">
          "${selectedRetailer}" ist laut Teilnahmebedingungen ausgeschlossen!
        </div>
        <button class="btn" style="margin-top: 10px; font-size: 0.75rem; padding: 4px 8px;" onclick="resetUploadZone(event)">Erneut versuchen</button>
      `;
      return;
    }
    
    // 3. Erfolgs-Fall
    
    overlay.innerHTML = `
      <span class="success-icon-animated">✓</span>
      <div style="font-size: 0.9rem; font-weight: 700; color: var(--success);">Erstattung genehmigt!</div>
      <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; line-height: 1.3;">
        +${c.cashbackVal.toFixed(2)} € werden auf Ihr Bankkonto überwiesen.
      </div>
    `;
    
    // Konfetti-Effekt & Dashboard-Aktualisierung
    triggerConfetti();
    
    // Erstelle automatischen Erfolgsbericht in der Community
    const newReport = {
      id: Date.now(),
      user: "Du (Simulator)",
      productName: c.name,
      productId: c.id,
      retailer: selectedRetailer,
      status: "ok",
      text: `Bon-Upload erfolgreich simuliert! Gekauft bei ${selectedRetailer}. Die Prüfung der Teilnahmebedingungen war einwandfrei.`,
      timestamp: "Gerade eben"
    };
    
    state.communityReports.push(newReport);
    localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
    
    // Re-Rendern aller Ansichten
    renderApp();
    
    // Nach 3 Sekunden schließt sich das Overlay wieder für weitere Uploads
    setTimeout(() => {
      resetUploadZoneDirect(zone);
    }, 3500);
    
  }, 1800); // 1.8 Sekunden künstliche OCR-Ladezeit
}

// Setzt die Upload-Zone nach einem Fehler zurück
function resetUploadZone(event) {
  event.stopPropagation();
  const overlay = document.getElementById("upload-processing");
  overlay.classList.remove("active");
}

function resetUploadZoneDirect(zone) {
  const overlay = zone.querySelector(".processing-overlay");
  if (overlay) overlay.classList.remove("active");
}

// Melde-Wecker Mockup
function registerAlert(productName) {
  const email = document.getElementById("alert-email").value;
  if (!email || !email.includes("@")) {
    alert("Bitte gib eine gültige E-Mail-Adresse ein!");
    return;
  }
  
  alert(`Erfolgreich eingetragen!\n\nWir senden eine Benachrichtigung an "${email}", sobald das Limit für "${productName}" knapp wird.`);
  document.getElementById("alert-email").value = "";
}

/* ==========================================================================
   COMMUNITY FORM SUBMISSION LOGIC
   ========================================================================== */
function handleReportSubmit(e) {
  e.preventDefault();
  
  const userVal = document.getElementById("report-user").value.trim();
  const productSelect = document.getElementById("report-product");
  const productId = productSelect.value;
  const productName = productSelect.options[productSelect.selectedIndex].text;
  const retailerVal = document.getElementById("report-retailer").value;
  const statusVal = document.getElementById("report-status").value;
  const textVal = document.getElementById("report-text").value.trim();
  
  if (!userVal || !textVal) return;
  
  const newReport = {
    id: Date.now(),
    user: userVal,
    productName: productName,
    productId: productId,
    retailer: retailerVal,
    status: statusVal,
    text: textVal,
    timestamp: "Gerade eben"
  };
  
  // Zum State hinzufügen
  state.communityReports.push(newReport);
  localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
  
  // Formular zurücksetzen
  document.getElementById("report-user").value = "";
  document.getElementById("report-text").value = "";
  
  // Dashboard & Feed aktualisieren
  renderApp();
  
  // Sanftes Scrollen zum Ticker
  document.getElementById("reports-feed").firstElementChild.scrollIntoView({
    behavior: "smooth"
  });
}

/* ==========================================================================
   VISUAL EFFECTS & LIVE BACKGROUND SHOOPER TRAFFIC
   ========================================================================== */
// Konfetti-Effekt bei erfolgreicher Einlösung
function triggerConfetti() {
  const colors = ["#6366f1", "#06b6d4", "#10b981", "#a855f7", "#fbbf24"];
  for (let i = 0; i < 40; i++) {
    const confetti = document.createElement("div");
    confetti.style.position = "fixed";
    confetti.style.width = `${Math.random() * 8 + 6}px`;
    confetti.style.height = `${Math.random() * 15 + 8}px`;
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.top = `-20px`;
    confetti.style.left = `${Math.random() * 100}vw`;
    confetti.style.opacity = Math.random();
    confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
    confetti.style.zIndex = "2000";
    confetti.style.borderRadius = "2px";
    
    document.body.appendChild(confetti);
    
    // Animations-Flugbahn
    const destinationY = window.innerHeight + 20;
    const destinationX = parseFloat(confetti.style.left) + (Math.random() * 20 - 10);
    const duration = Math.random() * 2 + 1.5;
    
    confetti.animate([
      { top: "-20px", left: confetti.style.left, transform: confetti.style.transform },
      { top: `${destinationY}px`, left: `${destinationX}vw`, transform: `rotate(${Math.random() * 720}deg)` }
    ], {
      duration: duration * 1000,
      easing: "cubic-bezier(0.1, 0.8, 0.3, 1)",
      fill: "forwards"
    });
    
    setTimeout(() => {
      confetti.remove();
    }, duration * 1000);
  }
}

// Hintergrund Traffic deaktiviert, da keine Fake Limits mehr.
function startLiveTrafficSimulation() {
  // Leere Funktion
}

// Generiert zufällige, sehr realistische Community-Meldungen im Hintergrund
function generateMockCommunityReport(campaign) {
  const names = ["SparBiene", "SchnaeppchenJaeger", "BioKaeufer", "PfennigFuchser", "Mimi_Maunzt", "DrogerieFan", "KuechenChef"];
  const name = names[Math.floor(Math.random() * names.length)];
  
  const retailers = campaign.allowedRetailers.filter(r => !campaign.excludedRetailers.includes(r));
  const retailer = retailers.length > 0 ? retailers[Math.floor(Math.random() * retailers.length)] : "Supermarkt";
  
  const texts = [
    `Habe heute den Bon hochgeladen, Erstattung für ${campaign.name} wurde direkt vorgemerkt! Geiler Deal.`,
    `War eben bei ${retailer}, da gab es noch gut Auswahl im Regal. Lasst uns die Aktion leeren!`,
    `Achtung, das Limit bei ${campaign.brand} wird heute wohl recht früh voll sein, da es aktuell super viele hochladen.`
  ];
  const text = texts[Math.floor(Math.random() * texts.length)];
  
  const newReport = {
    id: Date.now(),
    user: name,
    productName: campaign.name,
    productId: campaign.id,
    retailer: retailer,
    status: "ok",
    text: text,
    timestamp: "Gerade eben"
  };
  
  state.communityReports.push(newReport);
  // Begrenze Verlauf auf max. 10 Berichte im LocalStorage, damit es nicht überläuft
  if (state.communityReports.length > 10) {
    state.communityReports.shift();
  }
  
  localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
  renderReportsFeed();
}

/* ==========================================================================
   FEATURE: LIVE-SCANNER & BARCODEPRÜFER
   ========================================================================== */

let html5QrcodeScanner = null;

// WICHTIGER ENTWICKLER-HINWEIS:
// Die getUserMedia() / Kamera-API wird in modernen Browsern (Chrome, iOS Safari) aus Sicherheitsgründen
// oft blockiert, wenn die index.html nur lokal über das file:// Protokoll geöffnet wird.
// -> Die App muss zwingend über einen lokalen Webserver (z. B. http://localhost) gestartet werden, 
// damit die Kamera für den Barcode-Scanner funktioniert!

function onCheckerRetailerChange() {
  const select = document.getElementById('checker-retailer');
  const statusBox = document.getElementById('checker-retailer-status-box');
  const eanInput = document.getElementById('checker-manual-ean');
  const checkBtn = document.getElementById('checker-manual-btn');
  const scanBtn = document.getElementById('checker-scanner-toggle-btn');
  const resultCard = document.getElementById('checker-result-card');
  
  if (!select || !currentActiveCampaign) return;
  
  // Hide previous results
  if (resultCard) resultCard.style.display = 'none';
  
  const selectedRetailerId = select.value;
  
  if (selectedRetailerId === 'none') {
    if (statusBox) statusBox.style.display = 'none';
    if (eanInput) { eanInput.disabled = true; eanInput.value = ''; }
    if (checkBtn) checkBtn.disabled = true;
    if (scanBtn) scanBtn.disabled = true;
    return;
  }
  
  const isRetailerAllowed = isCampaignAllowedAtRetailer(currentActiveCampaign, selectedRetailerId);
  
  if (statusBox) {
    statusBox.style.display = 'block';
    if (isRetailerAllowed) {
      statusBox.className = 'checker-retailer-status-box success';
      statusBox.innerHTML = '✅ Händler nimmt an dieser Aktion teil';
      
      // Enable barcode inputs
      if (eanInput) eanInput.disabled = false;
      if (checkBtn) checkBtn.disabled = false;
      if (scanBtn) scanBtn.disabled = false;
    } else {
      statusBox.className = 'checker-retailer-status-box danger';
      statusBox.innerHTML = '❌ Dieser Händler ist laut Teilnahmebedingungen ausgeschlossen';
      
      // Disable barcode inputs
      if (eanInput) { eanInput.disabled = true; eanInput.value = ''; }
      if (checkBtn) checkBtn.disabled = true;
      if (scanBtn) scanBtn.disabled = true;
    }
  }
}

function toggleCameraScanner() {
  const container = document.getElementById('checker-scanner-container');
  const toggleBtn = document.getElementById('checker-scanner-toggle-btn');
  if (!container) return;
  
  if (container.style.display === 'none') {
    container.style.display = 'block';
    if (toggleBtn) toggleBtn.innerHTML = '⏹️ Kamera schließen';
    initCheckerScanner();
  } else {
    stopCheckerScanner();
  }
}

function stopCheckerScanner() {
  const container = document.getElementById('checker-scanner-container');
  const toggleBtn = document.getElementById('checker-scanner-toggle-btn');
  if (container) container.style.display = 'none';
  if (toggleBtn) {
    toggleBtn.innerHTML = '📷 Barcode scannen';
  }
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(e => console.error(e));
    html5QrcodeScanner = null;
  }
}

function initCheckerScanner() {
  if (html5QrcodeScanner) return;
  
  // Zeige file:// Warnung, falls zutreffend
  const readerDiv = document.getElementById('reader');
  if (readerDiv && window.location.protocol === 'file:') {
    if (!document.getElementById('file-protocol-warning')) {
      const warningDiv = document.createElement('div');
      warningDiv.id = 'file-protocol-warning';
      warningDiv.style.background = 'rgba(239, 68, 68, 0.1)';
      warningDiv.style.borderLeft = '3px solid #ef4444';
      warningDiv.style.padding = '12px';
      warningDiv.style.marginBottom = '12px';
      warningDiv.style.borderRadius = '4px';
      warningDiv.innerHTML = `
        <h4 style="color: #ef4444; font-size: 0.9rem; margin-bottom: 4px; margin-top: 0;">⚠️ Kamerazugriff blockiert</h4>
        <p style="color: var(--text-primary); font-size: 0.8rem; line-height: 1.4; margin: 0;">
          Moderne Browser blockieren den Kamerazugriff über das <code>file://</code> Protokoll. 
          Bitte nutze die manuelle Eingabe oben oder starte einen lokalen Server (z.B. <code>http://localhost:8081</code>).
        </p>
      `;
      readerDiv.parentNode.insertBefore(warningDiv, readerDiv);
    }
  }

  try {
    html5QrcodeScanner = new Html5QrcodeScanner(
      "reader",
      { 
        fps: 10, 
        qrbox: { width: 250, height: 150 },
        formatsToSupport: [ Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8 ]
      },
      /* verbose= */ false
    );
    html5QrcodeScanner.render(onCheckerScanSuccess, onCheckerScanFailure);
  } catch (e) {
    console.error("Scanner init error:", e);
  }
}

function onCheckerScanSuccess(decodedText, decodedResult) {
  stopCheckerScanner();
  const eanInput = document.getElementById('checker-manual-ean');
  if (eanInput) {
    eanInput.value = decodedText;
  }
  runProductCheck(decodedText);
}

function onCheckerScanFailure(error) {
  // Ignoriert, um Konsolen-Spam zu vermeiden
}

function checkManualEan() {
  const eanInput = document.getElementById('checker-manual-ean');
  if (!eanInput) return;
  const ean = eanInput.value.replace(/\s+/g, "").trim();
  if (!ean) {
    alert("Bitte gib eine EAN-Nummer ein.");
    return;
  }
  runProductCheck(ean);
}

function runProductCheck(ean) {
  if (!currentActiveCampaign) return;
  
  const spinner = document.getElementById('checker-spinner');
  const apiText = document.getElementById('checker-api-text');
  const resultCard = document.getElementById('checker-result-card');
  
  if (resultCard) resultCard.style.display = 'none';
  if (spinner) spinner.style.display = 'block';
  if (apiText) {
    apiText.style.display = 'block';
    apiText.innerText = `Prüfe Barcode ${ean}...`;
  }
  
  const selectedRetailerId = document.getElementById('checker-retailer').value;
  
  // Abfrage Open Food Facts als Anreicherung (Produktname)
  fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json`)
    .then(response => response.json())
    .then(data => {
      renderValidationResult(ean, selectedRetailerId, data);
    })
    .catch(error => {
      console.warn('OFF API failed, checking local database:', error);
      renderValidationResult(ean, selectedRetailerId, null);
    });
}

function renderValidationResult(ean, selectedRetailerId, apiData) {
  const spinner = document.getElementById('checker-spinner');
  const apiText = document.getElementById('checker-api-text');
  const resultCard = document.getElementById('checker-result-card');
  
  if (spinner) spinner.style.display = 'none';
  if (apiText) apiText.style.display = 'none';
  
  if (!resultCard) return;
  resultCard.style.display = 'block';
  resultCard.className = 'checker-result-card';
  
  // 1. Produkt-Gültigkeit bestimmen (Strict EAN Database Check mit Brand Fallback)
  const validBarcodes = currentActiveCampaign.validBarcodes || [];
  let isProductValid = false;
  
  if (validBarcodes.length > 0) {
    isProductValid = validBarcodes.includes(ean);
  } else {
    // Fallback: Markenprüfung falls keine Barcodes hinterlegt sind
    const brands = (apiData && apiData.status === 1 && (apiData.product.brands || apiData.product.brand || '')) ? 
      (apiData.product.brands || apiData.product.brand || '').toLowerCase() : '';
    const campaignBrand = currentActiveCampaign.brand || '';
    const productName = (apiData && apiData.status === 1 && (apiData.product.product_name_de || apiData.product.product_name || '')) ?
      (apiData.product.product_name_de || apiData.product.product_name || '').toLowerCase() : '';
    
    isProductValid = campaignBrand && (
      brands.includes(campaignBrand.toLowerCase()) || 
      campaignBrand.toLowerCase().includes(brands) ||
      productName.includes(campaignBrand.toLowerCase())
    );
  }
  
  // 2. Produktname ermitteln
  let productName = '';
  if (apiData && apiData.status === 1) {
    const product = apiData.product;
    productName = product.product_name_de || product.product_name || product.generic_name_de || product.generic_name || 'Unbekanntes Produkt';
  } else {
    // Lokaler Fallback
    if (currentActiveCampaign.participatingProducts && currentActiveCampaign.participatingProducts.length > 0) {
      productName = currentActiveCampaign.participatingProducts[0].name;
    } else {
      productName = (currentActiveCampaign.brand || '') + " Aktionsprodukt";
    }
  }
  
  // 3. Händler-Gültigkeit bestimmen
  const isRetailerAllowed = isCampaignAllowedAtRetailer(currentActiveCampaign, selectedRetailerId);
  const matchedRetailer = POPULAR_RETAILERS.find(r => r.id === selectedRetailerId);
  const retailerName = matchedRetailer ? matchedRetailer.name : selectedRetailerId;
  
  // 4. Anzeige rendern
  let cardHtml = '';
  
  if (isProductValid && isRetailerAllowed) {
    // Kombination gültig!
    resultCard.classList.add('success');
    cardHtml = `
      <div class="checker-result-header">✅ Teilnahme möglich</div>
      
      <div style="margin: 12px 0; font-size: 0.9rem; line-height: 1.5; color: var(--text-primary); text-align: left;">
        <div class="checker-result-row"><strong>Händler:</strong> ${retailerName}</div>
        <div class="checker-result-row"><strong>Produkt:</strong> ${productName}</div>
        <div class="checker-result-row"><strong>Barcode:</strong> ${ean}</div>
      </div>
      
      <div style="font-size: 0.85rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-weight: 700; margin-bottom: 12px; text-align: left;">
        Cashback voraussichtlich gültig
      </div>
      
      <button class="btn btn-primary" onclick="openStoreLocatorForRetailer()" style="width: 100%; justify-content: center; margin-bottom: 8px; gap: 8px;">
        📍 Wo kann ich dieses Produkt kaufen?
      </button>
      
      <button class="btn btn-secondary" onclick="resetChecker()" style="width: 100%; justify-content: center; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: inherit;">
        Erneut prüfen
      </button>
    `;
  } else if (isProductValid && !isRetailerAllowed) {
    // Produkt gültig, aber falscher Händler
    resultCard.classList.add('warning');
    cardHtml = `
      <div class="checker-result-header" style="color: var(--warning); margin-bottom: 12px;">⚠️ Kombination ungültig</div>
      
      <div style="margin: 12px 0; font-size: 0.9rem; line-height: 1.5; text-align: left;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="color: var(--success);">✅</span> <span style="color: var(--text-primary);">Produkt ist gültig</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; color: var(--danger); font-weight: 600;">
          <span>❌</span> <span>Händler nimmt nicht an der Aktion teil</span>
        </div>
      </div>
      
      <button class="btn btn-secondary" onclick="resetChecker()" style="width: 100%; justify-content: center; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: inherit; margin-top: 12px;">
        Erneut prüfen
      </button>
    `;
  } else if (!isProductValid && isRetailerAllowed) {
    // Händler erlaubt, aber falsches Produkt
    resultCard.classList.add('danger');
    cardHtml = `
      <div class="checker-result-header" style="color: var(--danger); margin-bottom: 12px;">❌ Kombination ungültig</div>
      
      <div style="margin: 12px 0; font-size: 0.9rem; line-height: 1.5; text-align: left;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="color: var(--success);">✅</span> <span style="color: var(--text-primary);">Händler ist zugelassen</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; color: var(--danger); font-weight: 600;">
          <span>❌</span> <span>Barcode gehört nicht zu einem Aktionsprodukt</span>
        </div>
      </div>
      
      <button class="btn btn-secondary" onclick="resetChecker()" style="width: 100%; justify-content: center; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: inherit; margin-top: 12px;">
        Erneut prüfen
      </button>
    `;
  } else {
    // Beide ungültig
    resultCard.classList.add('danger');
    cardHtml = `
      <div class="checker-result-header" style="color: var(--danger); margin-bottom: 12px;">❌ Kombination ungültig</div>
      
      <div style="margin: 12px 0; font-size: 0.9rem; line-height: 1.5; text-align: left;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: var(--danger);">
          <span>❌</span> <span>Händler nimmt nicht teil</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; color: var(--danger);">
          <span>❌</span> <span>Barcode gehört nicht zu einem Aktionsprodukt</span>
        </div>
      </div>
      
      <button class="btn btn-secondary" onclick="resetChecker()" style="width: 100%; justify-content: center; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: inherit; margin-top: 12px;">
        Erneut prüfen
      </button>
    `;
  }
  
  resultCard.innerHTML = cardHtml;
}

function openStoreLocatorForRetailer() {
  const select = document.getElementById('checker-retailer');
  if (!select) return;
  const selectedRetailerId = select.value;
  if (selectedRetailerId === 'none') return;
  
  // Setze den Händler-Filter aktiv im Locator
  state.locator.activeFilters = [selectedRetailerId];
  
  // Scrolle zum Store-Finder
  const wrapper = document.querySelector('.store-locator-wrapper');
  if (wrapper) {
    wrapper.scrollIntoView({ behavior: 'smooth' });
  }
  
  // Suche auslösen, falls noch nicht geschehen, andernfalls Liste aktualisieren
  if (state.locator.stores.length === 0) {
    searchStores(currentActiveCampaign.id, false);
  } else {
    renderLocatorFilterChips(currentActiveCampaign.id);
    renderLocatorStoresList();
  }
}

function resetChecker() {
  const select = document.getElementById('checker-retailer');
  if (select) select.value = 'none';
  
  const statusBox = document.getElementById('checker-retailer-status-box');
  if (statusBox) statusBox.style.display = 'none';
  
  const eanInput = document.getElementById('checker-manual-ean');
  if (eanInput) {
    eanInput.value = '';
    eanInput.disabled = true;
  }
  
  const checkBtn = document.getElementById('checker-manual-btn');
  if (checkBtn) checkBtn.disabled = true;
  
  const scanBtn = document.getElementById('checker-scanner-toggle-btn');
  if (scanBtn) scanBtn.disabled = true;
  
  const resultCard = document.getElementById('checker-result-card');
  if (resultCard) resultCard.style.display = 'none';
  
  const spinner = document.getElementById('checker-spinner');
  if (spinner) spinner.style.display = 'none';
  
  const apiText = document.getElementById('checker-api-text');
  if (apiText) apiText.style.display = 'none';
  
  stopCheckerScanner();
}

// Hilfsfunktion: Markenfarbe
function getBrandColor(brand) {
  const colors = {
    "Axe": "#1a1a2e",
    "Nivea": "#003087",
    "Granini": "#0f7d45",
    "Deli Reform": "#e87722",
    "Air Wick": "#832f91",
    "Lenor": "#0057a8",
    "Whiskas": "#8b0000",
    "Somat": "#c0392b",
    "NESCAFÉ": "#c8102e",
    "Rockstar": "#f49d1a",
    "tetesept": "#008b8b",
    "Cottonelle": "#06b6d4"
  };
  return colors[brand] || "#3b82f6";
}

/* ==========================================================================
   STORE LOCATOR JAVASCRIPT LOGIC (Händler-Standortsuche)
   ========================================================================== */

/**
 * Hilfsfunktion: Berechnet die Entfernung zweier Koordinaten per Haversine-Formel in km.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Erdradius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Geocoding über die freie Nominatim-Schnittstelle von OpenStreetMap.
 * Ergebnisse werden gecached, um API-Limits einzuhalten.
 */
async function geocodeAddress(query) {
  const cacheKey = query.toLowerCase().trim();
  if (state.locator.cache[cacheKey]) {
    return state.locator.cache[cacheKey];
  }
  
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'CashbackRadar-App-StoreLocator-v1.0'
    }
  });
  if (!response.ok) throw new Error("Der Server für die Adresssuche antwortet nicht.");
  
  const data = await response.json();
  if (data && data.length > 0) {
    const res = data[0];
    const lat = parseFloat(res.lat);
    const lon = parseFloat(res.lon);
    
    // Versuche den Stadtnamen aus den Adressdetails zu extrahieren
    const addr = res.address || {};
    const cityName = addr.city || addr.town || addr.village || addr.municipality || addr.state || query;
    
    const result = { lat, lon, cityName };
    state.locator.cache[cacheKey] = result;
    return result;
  }
  return null;
}

/**
 * Startet die Filialsuche basierend auf der eingetippten Adresse.
 */
async function searchStores(campaignId, skipGeocoding = false) {
  const searchInput = document.getElementById("locator-search-input");
  const searchBtn = document.querySelector(".locator-action-btns .btn-primary");
  const c = state.campaigns.find(item => item.id === campaignId);
  if (!c) return;
  
  let coords = state.locator.userCoords;
  let cityName = state.locator.cityName;
  
  if (!skipGeocoding) {
    const query = searchInput.value.trim();
    if (!query) {
      alert("Bitte gib eine Adresse, einen Ort oder eine Postleitzahl ein!");
      return;
    }
    
    // UI auf Laden setzen
    const originalText = searchBtn.textContent;
    searchBtn.disabled = true;
    searchBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px; display:inline-block; vertical-align: middle;"></span> Suche läuft...';
    
    try {
      const geoResult = await geocodeAddress(query);
      if (geoResult) {
        coords = { lat: geoResult.lat, lon: geoResult.lon };
        cityName = geoResult.cityName;
        state.locator.userCoords = coords;
        state.locator.cityName = cityName;
      } else {
        alert("Adresse oder Ort konnte nicht gefunden werden. Bitte prüfe deine Eingabe.");
        return;
      }
    } catch (err) {
      alert("Fehler bei der Adresssuche: " + err.message);
      return;
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = originalText;
    }
  }
  
  if (!coords) return;
  
  // UI laden für Filialen
  const originalSearchText = searchBtn.textContent;
  searchBtn.disabled = true;
  searchBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px; display:inline-block; vertical-align: middle;"></span> Lade Filialen...';
  
  try {
    console.log(`Versuche reale Filialen von Overpass API abzurufen für ${coords.lat}, ${coords.lon} im Radius ${state.locator.searchRadius}km`);
    const elements = await fetchRealStoresFromOverpass(coords.lat, coords.lon, state.locator.searchRadius, c.allowedRetailers, cityName);
    const realStores = parseOverpassElements(elements, coords.lat, coords.lon, c.allowedRetailers, cityName);
    
    if (realStores.length > 0) {
      state.locator.stores = realStores;
      const uniqueGeneratedRetailers = [...new Set(state.locator.stores.map(s => s.retailer))];
      // If the campaign has an explicit allowedRetailers list, pre-select only those;
      // otherwise pre-select all retailers found in the results.
      if (c.allowedRetailers && c.allowedRetailers.length > 0) {
        const normalizedAllowed = c.allowedRetailers.map(r => r.toLowerCase());
        state.locator.activeFilters = uniqueGeneratedRetailers.filter(r =>
          normalizedAllowed.some(a => r.toLowerCase().includes(a) || a.includes(r.toLowerCase()))
        );
        // Fallback: if nothing matched, show all
        if (state.locator.activeFilters.length === 0) {
          state.locator.activeFilters = [...uniqueGeneratedRetailers];
        }
      } else {
        state.locator.activeFilters = [...uniqueGeneratedRetailers];
      }
      console.log(`${realStores.length} reale Filialen erfolgreich geladen.`);
    } else {
      console.log("Keine realen Filialen gefunden. Verwende simulierte Standorte.");
      generateMockStores(coords.lat, coords.lon, state.locator.searchRadius, c.allowedRetailers, cityName);
    }
  } catch (err) {
    console.warn("Fehler beim Abrufen der realen Filialdaten (Timeout oder Server ausgelastet). Nutze Simulation als Fallback:", err.message);
    generateMockStores(coords.lat, coords.lon, state.locator.searchRadius, c.allowedRetailers, cityName);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = originalSearchText;
  }
  
  // Google Maps Button einblenden
  const gmapsBtn = document.getElementById("gmaps-search-btn");
  if (gmapsBtn) {
    gmapsBtn.style.display = "flex";
  }
  
  // Karte anzeigen & initialisieren
  document.getElementById("locator-map").style.display = "block";
  initLocatorMap(coords.lat, coords.lon);
  
  // Filter und Ergebnisliste rendern
  renderLocatorFilterChips(campaignId);
  renderLocatorResults(campaignId);
}

/**
 * Nutzt die HTML5 Geolocation API, um den aktuellen Standort des Benutzers abzufragen.
 */
function useCurrentLocation(campaignId) {
  const btn = document.querySelector(".locator-action-btns .btn-secondary");
  const originalText = btn.textContent;
  
  if (!navigator.geolocation) {
    alert("Geolokalisierung wird von deinem Browser nicht unterstützt.");
    return;
  }
  
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px; display:inline-block; vertical-align: middle;"></span> Ortung...';
  
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      
      state.locator.userCoords = { lat, lon };
      
      // Versuche über Reverse-Geocoding den Stadtnamen für die Filialadressen zu ermitteln
      let cityName = "dein Standort";
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'CashbackRadar-App-StoreLocator-v1.0'
          }
        });
        if (response.ok) {
          const data = await response.json();
          const addr = data.address || {};
          cityName = addr.city || addr.town || addr.village || addr.suburb || "dein Standort";
        }
      } catch (e) {
        // Stille Ignorierung bei Fehlern - Fallback aktiv
      }
      
      state.locator.cityName = cityName;
      
      const searchInput = document.getElementById("locator-search-input");
      if (searchInput) {
        searchInput.value = "📍 Aktueller Standort";
      }
      
      btn.disabled = false;
      btn.textContent = originalText;
      
      // Suche direkt mit den ermittelten Koordinaten starten
      searchStores(campaignId, true);
    },
    (error) => {
      btn.disabled = false;
      btn.textContent = originalText;
      
      let msg = "Standort konnte nicht ermittelt werden.";
      if (error.code === error.PERMISSION_DENIED) {
        msg = "Zugriff auf den Standort verweigert. Bitte gib die Adresse manuell ein.";
      }
      alert(msg);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/**
 * Generiert realistische simulierte Filialstandorte im Umkreis des Nutzers.
 */
function generateMockStores(lat, lon, radius, allowedRetailers, cityName) {
  state.locator.stores = [];
  
  // Wenn keine Händler vorgegeben sind, sind alle Händler erlaubt
  const retailers = allowedRetailers.length > 0 ? allowedRetailers : ["REWE", "Edeka", "Kaufland", "dm-drogerie markt", "Rossmann", "Müller", "Aldi", "Lidl", "Netto"];
  
  const streetNames = ["Hauptstraße", "Bahnhofstraße", "Marktplatz", "Schillerstraße", "Goethestraße", "Kaiserstraße", "Lindenstraße", "Poststraße", "Mühlenweg", "Feldstraße", "Parkstraße", "Schulstraße", "Gartenstraße", "Ringstraße", "Rathausplatz", "Kanalstraße"];
  const openingHoursOptions = [
    "Mo-Sa: 08:00 - 20:00 Uhr, So: Geschlossen",
    "Mo-Sa: 07:00 - 22:00 Uhr, So: Geschlossen",
    "Mo-Sa: 08:00 - 21:00 Uhr, So: Geschlossen",
    "Mo-Sa: 07:00 - 20:00 Uhr, So: Geschlossen"
  ];
  
  retailers.forEach((retailer, index) => {
    // Generiere 1 bis 3 Filialen pro Händler im Radius
    const numStores = Math.floor(Math.random() * 3) + 1;
    
    for (let i = 0; i < numStores; i++) {
      // Abstand zufällig zwischen 0.3 km und der maximalen Grenze generieren
      const dist = 0.3 + Math.random() * (radius - 0.3);
      const angle = Math.random() * 2 * Math.PI;
      
      // Geografische Koordinaten berechnen (1 Breitengrad ~= 111km)
      const latOffset = (dist / 111.0) * Math.sin(angle);
      const lonOffset = (dist / (111.0 * Math.cos(lat * Math.PI / 180))) * Math.cos(angle);
      
      const storeLat = lat + latOffset;
      const storeLon = lon + lonOffset;
      
      const street = streetNames[Math.floor(Math.random() * streetNames.length)];
      const houseNumber = Math.floor(Math.random() * 120) + 1;
      const postcode = Math.floor(10000 + Math.random() * 89999);
      
      const cleanName = retailer.replace("dm-drogerie markt", "dm");
      const storeName = `${cleanName} ${cityName || 'Innenstadt'}`;
      const storeAddress = `${street} ${houseNumber}, ${postcode} ${cityName || 'Musterstadt'}`;
      const storeHours = openingHoursOptions[Math.floor(Math.random() * openingHoursOptions.length)];
      
      state.locator.stores.push({
        id: `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${index}-${i}`,
        retailer: retailer,
        name: storeName,
        address: storeAddress,
        lat: storeLat,
        lon: storeLon,
        distance: dist,
        hours: storeHours
      });
    }
  });
  
  // Alle generierten Händler als aktiv vorfiltern
  const uniqueGeneratedRetailers = [...new Set(state.locator.stores.map(s => s.retailer))];
  state.locator.activeFilters = [...uniqueGeneratedRetailers];
}

/**
 * Initialisiert die Leaflet-Karte.
 */
function initLocatorMap(lat, lon) {
  if (window.locatorMap) {
    window.locatorMap.setView([lat, lon], 13);
    return;
  }
  
  window.locatorMap = L.map('locator-map').setView([lat, lon], 13);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(window.locatorMap);
  
  window.locatorMarkerGroup = L.layerGroup().addTo(window.locatorMap);
  
  // Leaflet-Darstellung korrigieren (Behebt graue Karten-Kacheln)
  setTimeout(() => {
    window.locatorMap.invalidateSize();
  }, 100);
}

/**
 * Rendert die Filter-Chips für die verschiedenen Händler.
 */
function renderLocatorFilterChips(campaignId) {
  const container = document.getElementById("locator-filter-chips");
  if (!container) return;
  container.innerHTML = "";
  
  // Einzigartige Händler unter den generierten Filialen finden
  const uniqueGeneratedRetailers = [...new Set(state.locator.stores.map(s => s.retailer))];
  
  uniqueGeneratedRetailers.forEach(retailer => {
    const isActive = state.locator.activeFilters.includes(retailer);
    const chip = document.createElement("button");
    chip.className = `locator-chip ${isActive ? 'active' : ''}`;
    chip.innerHTML = `
      <span class="locator-chip-checkbox"></span>
      <span>${retailer.replace("dm-drogerie markt", "dm")}</span>
    `;
    chip.onclick = () => toggleLocatorFilter(retailer, campaignId);
    container.appendChild(chip);
  });
  
  const filterSection = document.getElementById("locator-filter-container");
  if (uniqueGeneratedRetailers.length > 0) {
    filterSection.style.display = "block";
  } else {
    filterSection.style.display = "none";
  }
}

/**
 * Schaltet den Händler-Filter an oder aus.
 */
function toggleLocatorFilter(retailer, campaignId) {
  const index = state.locator.activeFilters.indexOf(retailer);
  if (index > -1) {
    state.locator.activeFilters.splice(index, 1);
  } else {
    state.locator.activeFilters.push(retailer);
  }
  
  renderLocatorFilterChips(campaignId);
  renderLocatorResults(campaignId);
}

/**
 * Filtert, sortiert und rendert die Filialen in Liste und Karte.
 */
function renderLocatorResults(campaignId) {
  const listContainer = document.getElementById("locator-results-list");
  const resultsContainer = document.getElementById("locator-results-container");
  if (!listContainer || !resultsContainer) return;
  listContainer.innerHTML = "";
  
  // Filter nach Händlern anwenden
  const filteredStores = state.locator.stores.filter(store => 
    state.locator.activeFilters.includes(store.retailer)
  );
  
  // Nach Distanz aufsteigend sortieren
  filteredStores.sort((a, b) => a.distance - b.distance);
  
  // Karten-Marker neu aufbauen
  if (window.locatorMarkerGroup && window.locatorMap) {
    window.locatorMarkerGroup.clearLayers();
    
    // User-Standort-Marker (Blauer Punkt)
    const userIcon = L.divIcon({
      className: 'user-location-marker',
      iconSize: [14, 14]
    });
    L.marker([state.locator.userCoords.lat, state.locator.userCoords.lon], {icon: userIcon})
      .bindPopup('<b>Dein Standort</b>')
      .addTo(window.locatorMarkerGroup);
      
    // Leaflet Bounds initialisieren
    const bounds = L.latLngBounds([state.locator.userCoords.lat, state.locator.userCoords.lon]);
    
    filteredStores.forEach(store => {
      const gMapsDirUrl = `https://www.google.com/maps/dir/?api=1&origin=${state.locator.userCoords.lat},${state.locator.userCoords.lon}&destination=${store.lat},${store.lon}`;
      const gMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.name + ' ' + store.address)}`;
      
      const popupHtml = `
        <div style="font-family: inherit; font-size: 0.8rem; line-height: 1.4; min-width: 160px;">
          <b style="font-size: 0.85rem; display: block; margin-bottom: 2px;">${store.name}</b>
          <span style="color: var(--text-secondary); display:block; margin-bottom: 4px;">${store.address}</span>
          <span style="color: #047857; font-weight: 700; display:block; margin-bottom: 4px;">📍 ${store.distance.toFixed(1)} km entfernt</span>
          <span style="color: var(--text-muted); font-size: 0.75rem; display:block; margin-bottom: 8px;">${store.hours}</span>
          <div style="display: flex; gap: 4px;">
            <a href="${gMapsDirUrl}" target="_blank" class="btn btn-primary" style="font-size: 0.7rem; padding: 4px 6px; text-decoration: none; color: white;">Route</a>
            <a href="${gMapsSearchUrl}" target="_blank" class="btn" style="font-size: 0.7rem; padding: 4px 6px; text-decoration: none;">Maps</a>
          </div>
        </div>
      `;
      
      const marker = L.marker([store.lat, store.lon])
        .bindPopup(popupHtml)
        .addTo(window.locatorMarkerGroup);
        
      bounds.extend([store.lat, store.lon]);
    });
    
    // Zoom an alle Marker anpassen
    if (filteredStores.length > 0) {
      window.locatorMap.fitBounds(bounds, { padding: [40, 40] });
    }
  }
  
  // Ergebnisliste rendern
  if (filteredStores.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem;">
        Keine Filialen für die ausgewählten Filter innerhalb des Radius gefunden.
      </div>
    `;
    resultsContainer.style.display = "block";
    return;
  }
  
  filteredStores.forEach(store => {
    const gMapsDirUrl = `https://www.google.com/maps/dir/?api=1&origin=${state.locator.userCoords.lat},${state.locator.userCoords.lon}&destination=${store.lat},${store.lon}`;
    const gMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.name + ' ' + store.address)}`;
    
    const card = document.createElement("div");
    card.className = "store-result-card";
    card.innerHTML = `
      <div class="store-result-header">
        <span class="store-result-name">${store.name}</span>
        <span class="store-distance-badge">📍 ${store.distance.toFixed(1)} km</span>
      </div>
      <div class="store-result-address">${store.address}</div>
      <div class="store-result-hours">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.6;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>${store.hours}</span>
      </div>
      <div class="store-result-actions">
        <a href="${gMapsDirUrl}" target="_blank" class="btn btn-primary" style="text-decoration: none; justify-content: center; font-size: 0.8rem; font-weight:700;">Route starten</a>
        <a href="${gMapsSearchUrl}" target="_blank" class="btn btn-secondary" style="text-decoration: none; justify-content: center; font-size: 0.8rem;">In Google Maps öffnen</a>
      </div>
    `;
    listContainer.appendChild(card);
  });
  
  resultsContainer.style.display = "block";
}

/**
 * Öffnet die aktuelle Standortsuche direkt in Google Maps in einem neuen Tab.
 */
function openSearchInGoogleMaps(campaignId) {
  const coords = state.locator.userCoords;
  if (!coords) return;
  const searchInput = document.getElementById("locator-search-input");
  const query = searchInput ? searchInput.value.trim() : "";
  
  let url = "";
  if (query && query !== "📍 Aktueller Standort") {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  } else {
    url = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}`;
  }
  window.open(url, '_blank');
}

/**
 * Holt reale Filialdaten über die OpenStreetMap Overpass-API.
 */
async function fetchRealStoresFromOverpass(lat, lon, radius, allowedRetailers, cityName) {
  const osmRadius = radius * 1000; // Radius in Metern
  const query = `[out:json][timeout:10];
(
  node["shop"~"supermarket|chemist|variety_store|pet|discount|convenience"](around:${osmRadius},${lat},${lon});
  way["shop"~"supermarket|chemist|variety_store|pet|discount|convenience"](around:${osmRadius},${lat},${lon});
);
out center;`;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'CashbackRadar-App-StoreLocator-v1.0'
    },
    signal: AbortSignal.timeout(6000) // 6 Sekunden Timeout
  });
  
  if (!response.ok) {
    throw new Error(`Overpass API responded with HTTP status ${response.status}`);
  }
  
  const data = await response.json();
  if (!data || !Array.isArray(data.elements)) {
    throw new Error("Invalid response format from Overpass API");
  }
  
  return data.elements;
}

/**
 * Mappt die Namen aus OpenStreetMap auf unsere Standard-Händlernamen.
 */
function matchRetailerName(name, brand) {
  const n = (name || "").toLowerCase();
  const b = (brand || "").toLowerCase();
  
  if (n.includes("rewe") || b.includes("rewe")) return "REWE";
  if (n.includes("edeka") || b.includes("edeka")) return "Edeka";
  if (n.includes("kaufland") || b.includes("kaufland")) return "Kaufland";
  if (n.includes("dm-") || n === "dm" || b.includes("dm")) return "dm-drogerie markt";
  if (n.includes("rossmann") || b.includes("rossmann")) return "Rossmann";
  if (n.includes("müller") || n.includes("mueller") || b.includes("müller") || b.includes("mueller")) return "Müller";
  if (n.includes("aldi") || b.includes("aldi")) {
    if (n.includes("süd") || b.includes("süd")) return "Aldi Süd";
    if (n.includes("nord") || b.includes("nord")) return "Aldi Nord";
    return "Aldi";
  }
  if (n.includes("lidl") || b.includes("lidl")) return "Lidl";
  if (n.includes("penny") || b.includes("penny")) return "Penny";
  if (n.includes("netto") || b.includes("netto")) {
    if (n.includes("hund") || n.includes("schwarzer") || b.includes("dog") || b.includes("schwarzer")) return "Netto (mit Hund)";
    return "Netto";
  }
  if (n.includes("globus") || b.includes("globus")) return "Globus";
  if (n.includes("citti") || b.includes("citti")) return "Citti";
  if (n.includes("tegut") || b.includes("tegut")) return "Tegut";
  if (n.includes("norma") || b.includes("norma")) return "Norma";
  if (n.includes("famila") || b.includes("famila")) return "Famila";
  if (n.includes("fressnapf") || b.includes("fressnapf")) return "Fressnapf";
  if (n.includes("budni") || n.includes("budnikowsky") || b.includes("budni")) return "Budni";
  
  return null;
}

/**
 * Parsed die Overpass-Rohdaten in unser Filialdatenmodell.
 */
function parseOverpassElements(elements, lat, lon, allowedRetailers, defaultCityName) {
  const parsedStores = [];
  const normalizedAllowed = allowedRetailers.map(r => r.replace("dm-drogerie markt", "dm").toLowerCase());
  const hasAllowedList = allowedRetailers.length > 0;
  
  elements.forEach((el, index) => {
    const tags = el.tags || {};
    const name = tags.name || tags.brand || "";
    if (!name) return;
    
    const matchedRetailer = matchRetailerName(name, tags.brand);
    if (!matchedRetailer) return;
    
    if (hasAllowedList) {
      const cleanRetailer = matchedRetailer.replace("dm-drogerie markt", "dm").toLowerCase();
      const isAllowed = normalizedAllowed.some(r => cleanRetailer.includes(r) || r.includes(cleanRetailer));
      if (!isAllowed) return;
    }
    
    const storeLat = el.lat || (el.center ? el.center.lat : null);
    const storeLon = el.lon || (el.center ? el.center.lon : null);
    if (!storeLat || !storeLon) return;
    
    const dist = calculateDistance(lat, lon, storeLat, storeLon);
    
    const street = tags["addr:street"] || "";
    const housenumber = tags["addr:housenumber"] || "";
    const postcode = tags["addr:postcode"] || "";
    const city = tags["addr:city"] || defaultCityName || "";
    
    let address = "";
    if (street) {
      address = `${street} ${housenumber}`.trim();
      if (postcode || city) {
        address += `, ${postcode} ${city}`.trim();
      }
    } else {
      address = tags["addr:full"] || `${defaultCityName || 'Adresse unbekannt'}`;
    }
    
    const openingHours = tags.opening_hours || "Mo-Sa: 08:00 - 20:00 Uhr";
    
    const cleanName = matchedRetailer.replace("dm-drogerie markt", "dm");
    const storeName = `${cleanName} ${city || defaultCityName || 'Filiale'}`;
    
    parsedStores.push({
      id: `real-${el.id || index}`,
      retailer: matchedRetailer,
      name: storeName,
      address: address,
      lat: storeLat,
      lon: storeLon,
      distance: dist,
      hours: openingHours
    });
  });
  
  return parsedStores;
}

/**
 * Verarbeitet die Tastatureingabe im KI-Bot Suchfeld (Senden bei Enter).
 */
function handleKiBotKeydown(event) {
  if (event.key === "Enter") {
    sendKiBotMessage();
  }
}

/**
 * Sendet die Benutzernachricht an den KI-Bot und steuert den Antwortverlauf.
 */
function sendKiBotMessage() {
  const inputEl = document.getElementById("ki-bot-input");
  if (!inputEl) return;
  
  const text = inputEl.value.trim();
  if (!text) return;
  
  // 1. Benutzer-Nachricht im Chat anzeigen
  addChatMessage("user", text);
  inputEl.value = "";
  
  // 2. Tipp-Indikator des Bots anzeigen
  showBotTyping();
  
  // 3. Antwort nach einer kleinen Verzögerung generieren (erzeugt natürlichere Interaktion)
  setTimeout(() => {
    removeBotTyping();
    const result = processBotQuery(text);
    addChatMessage("bot", result.text, result.htmlContent);
  }, 800 + Math.random() * 400);
}

/**
 * Fügt eine Nachrichtenkugel im Chatverlauf hinzu und scrollt nach unten.
 */
function addChatMessage(sender, text, htmlContent = "") {
  const chatArea = document.getElementById("ki-bot-chat-area");
  if (!chatArea) return;
  
  const msgEl = document.createElement("div");
  msgEl.className = `ki-bot-msg ${sender}`;
  
  // Text sicher in HTML/Text einfügen (text ist reiner Text oder sicheres HTML)
  msgEl.innerHTML = text;
  
  if (htmlContent) {
    msgEl.innerHTML += htmlContent;
  }
  
  chatArea.appendChild(msgEl);
  
  // Sanft nach unten scrollen
  chatArea.scrollTo({
    top: chatArea.scrollHeight,
    behavior: "smooth"
  });
}

/**
 * Zeigt einen animierten Tipp-Indikator (drei Punkte) für den Bot an.
 */
function showBotTyping() {
  const chatArea = document.getElementById("ki-bot-chat-area");
  if (!chatArea) return;
  
  // Verhindere mehrfache Indikatoren
  if (document.getElementById("ki-bot-typing-indicator")) return;
  
  const typingEl = document.createElement("div");
  typingEl.id = "ki-bot-typing-indicator";
  typingEl.className = "ki-bot-typing";
  typingEl.innerHTML = `
    <span class="ki-bot-dot"></span>
    <span class="ki-bot-dot"></span>
    <span class="ki-bot-dot"></span>
  `;
  
  chatArea.appendChild(typingEl);
  chatArea.scrollTo({
    top: chatArea.scrollHeight,
    behavior: "smooth"
  });
}

/**
 * Entfernt den Tipp-Indikator aus dem Chatverlauf.
 */
function removeBotTyping() {
  const indicator = document.getElementById("ki-bot-typing-indicator");
  if (indicator) {
    indicator.remove();
  }
}

/**
 * NLP- & Keyword-Matching-Algorithmus zur Erkennung der Benutzerabsicht.
 */
// Hilfsfunktion zur Deaktivierung von Sonderzeichen in regulären Ausdrücken
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Prüft, ob ein Begriff am Anfang einer Wortgrenze im Text steht (unterstützt deutsche Komposita)
function checkPrefixMatch(word, text) {
  const pattern = new RegExp("(^|[^a-z0-9äöüß])" + escapeRegExp(word), "i");
  return pattern.test(text);
}

// Prüft, ob eine Kampagne bei einem bestimmten Händler erlaubt ist
function isCampaignAllowedAtRetailer(c, retailerId) {
  const selected = retailerId.toLowerCase();
  
  // Exkludierte Händler prüfen
  const excluded = c.excludedRetailers || [];
  const isExcluded = excluded.some(r => {
    const term = r.toLowerCase();
    return term.includes(selected) || (selected === "aldi" && term.includes("aldi"));
  });
  if (isExcluded) return false;
  
  // Erlaubte Händler prüfen
  const allowed = c.allowedRetailers || [];
  const isAllAllowed = allowed.length === 0;
  if (isAllAllowed) return true;
  
  return allowed.some(r => {
    const term = r.toLowerCase();
    return term.includes(selected) || (selected === "aldi" && term.includes("aldi"));
  });
}

// Hilfsfunktion zur Formatierung des Datums ins deutsche Format (TT.MM.JJJJ)
function formatDate(dStr) {
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (e) {
    return dStr;
  }
}

/**
 * NLP- & Keyword-Matching-Algorithmus zur Erkennung der Benutzerabsicht.
 * Miteinbezieht alle Informationen der gesamten Webseite (conditions, tips, participatingProducts).
 * Unterstützt Händlerspezifische Filterung, intelligente Kategorie-Empfehlungen und gezielte Fragen zu Fristen & Gültigkeiten.
 */
function processBotQuery(query) {
  const q = query.toLowerCase().trim();
  if (!q) return { text: "Bitte gib eine Frage ein!" };
  
  // 1. Einfache Begrüßungen abfangen
  if (q === "hallo" || q === "hi" || q === "hey" || q.includes("guten tag") || q.includes("moin")) {
    return {
      text: "Hallo! 😊 Wie kann ich dir heute helfen? Du kannst mich nach Produkten fragen, z. B.: <i>„Gibt es gerade Duschgel kostenlos?“</i> oder nach Händlern: <i>„Welche Aktionen kann ich bei dm mitnehmen?“</i>"
    };
  }
  
  // Danksagungen abfangen
  if (q.includes("danke") || q.includes("super") || q.includes("vielen dank") || q.includes("cool") || q.includes("toll")) {
    return {
      text: "Sehr gerne! Frag mich einfach, wenn du noch etwas suchen möchtest. Sparen macht Spaß! 💰"
    };
  }
  
  // Stop-Wörter, die bei der fuzzy Wortsuche ignoriert werden
  const stopWords = new Set([
    "suche", "suchen", "such", "nach", "einer", "eine", "eines", "einem", "einen", "ein", 
    "für", "mit", "und", "oder", "aber", "aktion", "aktionen", "haben", "hast", "gibt", "gerade", 
    "jetzt", "kostenlos", "gratis", "umsonst", "testen", "test", "danke", "vielen", "bitte", "frage",
    "fragen", "hallo", "guten", "morgen", "tag", "abend", "dass", "weil", "wenn", "ist",
    "sind", "war", "waren", "wird", "werden", "kann", "kannst", "können", "ich", "du", "er", "sie", "es",
    "welche", "welcher", "welchem", "welches", "mitnehmen", "kaufen", "grad", "bei", "im", "am",
    "wann", "bis", "wo", "wer", "wie", "was", "endet", "ende", "frist", "laufzeit", "gültig", 
    "geht", "gehe", "einkaufen", "laden", "geschäft", "supermarkt", "drogerie"
  ]);

  // Keyword-Matching-Tabelle (Synonyme ohne Markennamen)
  const keywordMap = {
    "shampoo": ["shampoo", "haare", "head", "haarwäsche", "haarpflege", "haar"],
    "duschgel": ["duschgel", "dusche", "body wash", "bodywash", "duschbad", "duschpflege", "dusch"],
    "deo": ["deo", "deospray", "roll-on", "rollon", "geruch", "antiperspirant", "deodorant", "achsel"],
    "waschmittel": ["waschmittel", "reinigung", "clean", "spüler", "pulver", "flüssigwaschmittel", "weichspüler", "waschmaschine"],
    "spülmittel": ["spülmittel", "geschirr", "spülen", "tabs", "spülmaschine", "maschinengeschirrspülmittel", "klarspüler"],
    "toilettenpapier": ["toilettenpapier", "klopapier", "feucht", "wc-papier", "wc", "hygiene"],
    "margarine": ["margarine", "butter", "brotaufstrich", "streichfett", "omega"],
    "reiniger": ["reiniger", "kalk", "schmutz", "kraftreiniger", "badreiniger", "allzweckreiniger"],
    "raumduft": ["raumduft", "duftstecker", "duft", "düfte", "active fresh"],
    "reis": ["reis", "street food", "streetfood", "fertiggericht", "schnellgericht"],
    "limo": ["limo", "limonade", "getränk", "softdrink", "brause"],
    "snack": ["snack", "riegel", "milchschnitte", "dessert", "zott", "monte"],
    "sauce": ["sauce", "saucen", "ketchup", "dip", "veggies"],
    "bier": ["bier", "alkohol", "pils", "radler", "trinken"],
    "schokolade": ["schokolade", "tafel", "tony", "chocolonely"],
    "eis": ["eis", "ice", "cream", "icecream"],
    "hund": ["hund", "hunde", "hundefutter", "welpen"],
    "katze": ["katze", "katzen", "katzenfutter", "kitten"]
  };

  // Unterstützte Händler für die direkte Standort-/Aktionsfilterung
  const retailerKeywords = {
    "dm": ["dm-drogerie markt", "dm"],
    "rossmann": ["Rossmann", "Rossmann"],
    "müller": ["Müller", "Müller"],
    "rewe": ["REWE", "REWE"],
    "edeka": ["Edeka", "EDEKA"],
    "kaufland": ["Kaufland", "Kaufland"],
    "aldi": ["Aldi", "Aldi"],
    "lidl": ["Lidl", "Lidl"],
    "fressnapf": ["Fressnapf", "Fressnapf"],
    "netto": ["Netto", "Netto"],
    "penny": ["Penny", "Penny"],
    "budni": ["Budni", "Budni"]
  };

  // Intent-Erkennung (Fragen nach Fristen oder Einkaufsorten)
  const isAskingDeadline = checkPrefixMatch("wann", q) || checkPrefixMatch("endet", q) || checkPrefixMatch("frist", q) || checkPrefixMatch("laufzeit", q) || q.includes("bis wann");
  const isAskingLocation = checkPrefixMatch("wo", q) || checkPrefixMatch("gültig", q) || checkPrefixMatch("händler", q) || checkPrefixMatch("laden", q) || checkPrefixMatch("geschäft", q) || checkPrefixMatch("kaufen", q) || q.includes("wo einkaufen");

  // 1. Händlererkennung in der Suchanfrage
  let queriedRetailerId = null;
  let queriedRetailerName = null;
  for (const [key, [fullId, displayName]] of Object.entries(retailerKeywords)) {
    if (checkPrefixMatch(key, q)) {
      queriedRetailerId = fullId;
      queriedRetailerName = displayName;
      break;
    }
  }

  // 2. Prüfen, ob die Anfrage konkrete Produkt-Suchwörter enthält
  let hasProductKeywords = false;
  
  // Marken prüfen
  for (const c of state.campaigns) {
    const brand = (c.brand || "").toLowerCase();
    if (brand && checkPrefixMatch(brand, q)) {
      hasProductKeywords = true;
      break;
    }
  }
  // Kategorien prüfen
  const categoriesList = ["drogerie", "lebensmittel", "haushalt", "haustiere"];
  for (const cat of categoriesList) {
    if (checkPrefixMatch(cat, q)) {
      hasProductKeywords = true;
      break;
    }
  }
  // Synonyme prüfen
  if (!hasProductKeywords) {
    for (const [key, synonyms] of Object.entries(keywordMap)) {
      const allSyns = [...synonyms, key];
      if (allSyns.some(syn => checkPrefixMatch(syn, q))) {
        hasProductKeywords = true;
        break;
      }
    }
  }

  // 3. Kampagnensuche über den state.campaigns
  const matches = [];
  
  state.campaigns.forEach(c => {
    // Führe alle Informationstexte der Kampagne zusammen (ganze Webseite einbeziehen)
    const textParts = [
      c.name || "",
      c.brand || "",
      c.category || "",
      c.infoText || "",
      c.limitNote || "",
      c.allowedRetailersText || ""
    ];
    if (c.conditions && Array.isArray(c.conditions)) {
      textParts.push(...c.conditions);
    }
    if (c.tips && Array.isArray(c.tips)) {
      textParts.push(...c.tips);
    }
    if (c.participatingProducts && Array.isArray(c.participatingProducts)) {
      c.participatingProducts.forEach(p => {
        textParts.push(p.name || "");
      });
    }
    const campaignText = textParts.join(" ").toLowerCase();
    
    const brand = (c.brand || "").toLowerCase();
    const cat = (c.category || "").toLowerCase();
    
    let retailerScore = 0;
    let searchScore = 0;
    
    // Händler-Gültigkeit prüfen
    if (queriedRetailerId) {
      if (!isCampaignAllowedAtRetailer(c, queriedRetailerId)) {
        return; // Händler schließt diese Kampagne aus -> Überspringen
      }
      retailerScore += 15;
      
      // Händlerspezifische Kategorie-Boosts anwenden
      const isDrogerieStore = ["dm", "rossmann", "müller", "budni"].includes(queriedRetailerName.toLowerCase());
      const isPetStore = queriedRetailerName.toLowerCase() === "fressnapf";
      
      if (isDrogerieStore) {
        if (cat === "drogerie") {
          retailerScore += 5;
        } else if (cat === "haushalt") {
          retailerScore += 3;
        }
      } else if (isPetStore) {
        if (cat === "haustiere") {
          retailerScore += 10;
        }
      } else { // Supermarkt
        if (cat === "lebensmittel") {
          retailerScore += 5;
        } else if (cat === "haushalt") {
          retailerScore += 3;
        }
      }
    }
    
    // 1. Direkter Markenmatch in der Anfrage
    if (brand && checkPrefixMatch(brand, q)) {
      searchScore += 15; // Erhöhter Boost für direkte Markensuche
    }
    
    // 2. Direkter Kategoriematch in der Anfrage
    if (cat && checkPrefixMatch(cat, q)) {
      searchScore += 5;
    }
    
    // 3. Keyword-Synonyme prüfen (symmetrisch über word boundaries)
    for (const [key, synonyms] of Object.entries(keywordMap)) {
      const allSyns = [...synonyms, key];
      const queryHasKeyword = allSyns.some(syn => checkPrefixMatch(syn, q));
      if (queryHasKeyword) {
        const campaignHasKeyword = allSyns.some(syn => checkPrefixMatch(syn, campaignText));
        if (campaignHasKeyword) {
          searchScore += 8;
        }
      }
    }
    
    // 4. Unscharfe Wortsuchen (Wörter mit mehr als 3 Buchstaben, keine Stoppwörter/Händlernamen)
    const rawWords = q.split(/\s+/);
    const queryWords = rawWords.filter(w => w.length > 3 && !stopWords.has(w) && !retailerKeywords[w]);
    queryWords.forEach(word => {
      if (checkPrefixMatch(word, campaignText)) {
        searchScore += 3;
      }
    });
    
    // Falls die Anfrage Produktsuchwörter enthielt, aber diese Kampagne darauf nicht gematcht hat, ignorieren
    if (hasProductKeywords && searchScore === 0) {
      return;
    }
    
    const totalScore = retailerScore + searchScore;
    if (totalScore > 0) {
      matches.push({ campaign: c, score: totalScore });
    }
  });
  
  // Sortiere Matches nach Relevanz-Score (absteigend)
  matches.sort((a, b) => b.score - a.score);
  
  if (matches.length > 0) {
    const topMatches = matches.slice(0, 3).map(m => m.campaign);
    
    let replyText = "";
    
    if (isAskingDeadline && !isAskingLocation) {
      if (topMatches.length === 1) {
        const c = topMatches[0];
        replyText = `Die Aktion **${c.name}** von **${c.brand}** läuft bis zum **${formatDate(c.deadline)}**.<br><i>Tipp: ${c.limitNote || ''}</i>`;
      } else {
        replyText = `Hier sind die Laufzeiten für die passenden Aktionen:`;
        topMatches.forEach(c => {
          replyText += `<br>- **${c.brand}**: läuft bis zum **${formatDate(c.deadline)}** (${c.limitNote || ''})`;
        });
      }
    } else if (isAskingLocation && !isAskingDeadline) {
      if (topMatches.length === 1) {
        const c = topMatches[0];
        replyText = `Die Aktion **${c.name}** von **${c.brand}** ist hier gültig:<br>**${c.allowedRetailersText}**`;
      } else {
        replyText = `Hier sind die Einkaufsorte für die passenden Aktionen:`;
        topMatches.forEach(c => {
          replyText += `<br>- **${c.brand}**: ${c.allowedRetailersText}`;
        });
      }
    } else {
      // Default: Kombinierte Infos ausgeben
      if (queriedRetailerName) {
        if (topMatches.length === 1) {
          const c = topMatches[0];
          replyText = `Ja! Ich habe eine passende Aktion für dich bei **${queriedRetailerName}** gefunden: <b>${c.name}</b> (${c.brand}).<br>📅 **Laufzeit:** bis ${formatDate(c.deadline)}<br>🛒 **Einkaufsort:** ${c.allowedRetailersText}`;
        } else {
          replyText = `Ja! Bei **${queriedRetailerName}** kannst du folgende Aktionen mitnehmen:`;
          topMatches.forEach(c => {
            replyText += `<br>- **${c.brand}** (${c.name}): bis ${formatDate(c.deadline)} bei ${c.allowedRetailersText}`;
          });
        }
      } else {
        if (topMatches.length === 1) {
          const c = topMatches[0];
          replyText = `Ja! Ich habe eine passende Aktion für dich gefunden: <b>${c.name}</b> (${c.brand}).<br>📅 **Laufzeit:** bis ${formatDate(c.deadline)}<br>🛒 **Einkaufsort:** ${c.allowedRetailersText}`;
        } else {
          replyText = `Ja! Ich habe ${topMatches.length} passende Aktionen für dich gefunden:`;
          topMatches.forEach(c => {
            replyText += `<br>- **${c.brand}** (${c.name}): bis ${formatDate(c.deadline)} bei ${c.allowedRetailersText}`;
          });
        }
      }
    }
    
    // Generiere direkt klickbare Händler-Buttons im Chatverlauf
    let htmlContent = `<div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;">`;
    topMatches.forEach(c => {
      htmlContent += `
        <button class="ki-bot-suggestion-btn" onclick="openCampaignDetail('${c.id}')">
          🛍️ ${c.brand} anzeigen
        </button>
      `;
    });
    htmlContent += `</div>`;
    
    return {
      text: replyText,
      htmlContent: htmlContent
    };
  } else {
    // Standard-Antwort wenn nichts gefunden wurde
    if (queriedRetailerName) {
      return {
        text: `Entschuldigung, ich konnte keine direkte Gratis-Aktion für "${query}" bei **${queriedRetailerName}** finden. 🔍<br>Gültige Aktionen bei Drogerien sind z. B. <b>Duschgel</b> (Axe) oder <b>Deo</b> (Nivea)!`,
        htmlContent: ""
      };
    }
    return {
      text: `Entschuldigung, ich konnte keine direkte Gratis-Aktion für "${query}" finden. 🔍<br>Frag mich gerne nach Produkten wie <b>Duschgel</b>, <b>Bier</b>, <b>Schokolade</b> oder <b>Waschmittel</b>!`,
      htmlContent: ""
    };
  }
}

// Global window bindings to support inline HTML event attributes
window.handleKiBotKeydown = handleKiBotKeydown;
window.sendKiBotMessage = sendKiBotMessage;


