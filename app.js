import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const ADMIN_USERS = {
  "cha in cheon": { label: "Cha in Cheon", email: "cha-in-cheon@draft-team.com" },
  "lee yong un": { label: "Lee Yong un", email: "lee-yong-un@draft-team.com" },
  "ishizaki": { label: "Ishizaki", email: "ishizaki@draft-team.com" },
  "tezcat": { label: "Tezcat", email: "tezcat@draft-team.com" },
  "bai long": { label: "Bai long", email: "bai-long@draft-team.com" },
  "olivia aiku": { label: "Olivia Aiku", email: "olivia-aiku@draft-team.com" },
  "shidou ryusei": { label: "Shidou Ryusei", email: "shidou-ryusei@draft-team.com" },
  "ricardo rigo": { label: "Ricardo Rigo", email: "ricardo-rigo@draft-team.com" },
  "charles chevalier": { label: "Charles Chevalier", email: "charles-chevalier@draft-team.com" },
  "gabriel garcía": { label: "Gabriel García", email: "gabriel-garcia@draft-team.com" }
};

const ROLE_METRICS = {
  "Portero": [
    ["saves","Atajadas","goalie"],["conceded","Goles que le han hecho","goalie"],["matches","Partidas jugadas","matches"],["mvps","MVPs","mvp"],["yellow","Amarillas","yellow"],["red","Rojas","red"],["injury","Lesiones","injury"]
  ],
  "Defensor": [
    ["steals","Robos de balón","defense"],["recoveries","Recuperaciones","defense"],["clearances","Despejes","defense"],["mvps","MVPs","mvp"],["yellow","Amarillas","yellow"],["red","Rojas","red"]
  ],
  "Mediocampista": [
    ["steals","Robos de balón","defense"],["creation","Creación de juego","creation"],["mvps","MVPs","mvp"],["goals","Goles","goal"],["assists","Asistencias","assist"],["yellow","Amarillas","yellow"],["red","Rojas","red"]
  ],
  "Delantero": [
    ["steals","Robos de balón","defense"],["goals","Goles","goal"],["shots","Tiros al arco","shots"],["mvps","MVPs","mvp"],["assists","Asistencias","assist"],["yellow","Amarillas","yellow"],["red","Rojas","red"]
  ]
};

const ROLE_LABELS = { Portero: "GK", Defensor: "DEF", Mediocampista: "MID", Delantero: "FWD" };
const $ = id => document.getElementById(id);

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let currentAdmin = null;

let players = [];
let history = [];
let transfers = [];
let unsubscribers = [];

let editingId = null;
let editingTransferId = null;
let draftTimer = null;
let modalResolve = null;
let toastTimer = null;
let profileUnsubscribe = null;

const normalize = value => String(value || "").trim().toLocaleLowerCase("es");
const safe = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const num = id => Math.max(0, Number($(id)?.value || 0));
const money = value => Math.round(Number(value || 0)).toLocaleString("es-AR");

const dateText = value => {
  const d = value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Ahora";
};

const timestamp = p => p.updatedAt?.toMillis ? p.updatedAt.toMillis() : p.updatedAt ? new Date(p.updatedAt).getTime() : 0;

function showToast(message, kind = "success") {
  const el = $("toast");
  if (!el) { console.log(message); return; }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3200);
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.original = button.innerHTML;
    button.innerHTML = `<span class="spinner"></span> ${label || "PROCESANDO..."}`;
  } else if (button.dataset.original) {
    button.innerHTML = button.dataset.original;
    delete button.dataset.original;
  }
}

function logError(error) {
  console.error(error);
  const message = error?.code === "permission-denied" ? "Permisos insuficientes. Revisá las reglas de Firestore." :
    error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password" || error?.code === "auth/user-not-found" ? "Usuario o contraseña incorrectos." :
    error?.code === "auth/too-many-requests" ? "Demasiados intentos. Esperá un momento." :
    "No se pudo completar la acción. Revisá la conexión y la configuración de Firebase.";
  showToast(message, "error");
  return message;
}

/* =========================================
   GESTIÓN DE FOTO DE PERFIL
   ========================================= */
function renderProfilePhoto(photoData = "") {
  const avatar = $("user-avatar");
  if (!avatar) return;

  if (photoData) {
    avatar.style.backgroundImage = `url("${photoData}")`;
    avatar.textContent = "";
    avatar.style.color = "transparent";
  } else {
    avatar.style.backgroundImage = "";
    avatar.style.color = "";
    avatar.textContent = currentAdmin?.label?.charAt(0).toUpperCase() || "A";
  }
}

function loadProfilePhoto() {
  if (!currentUser || !db) return;
  if (profileUnsubscribe) { profileUnsubscribe(); profileUnsubscribe = null; }

  const profileRef = doc(db, "userProfiles", currentUser.uid);
  profileUnsubscribe = onSnapshot(profileRef, snapshot => {
    const photoData = snapshot.exists() ? snapshot.data().photoData || "" : "";
    renderProfilePhoto(photoData);
  }, error => {
    console.error("No se pudo cargar la foto de perfil:", error);
  });
}

function compressProfileImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Elegí un archivo de imagen válido."));
      return;
    }
    
    const isJps = file.name && file.name.toLowerCase().endsWith(".jps");
    if (!file.type.startsWith("image/") && !isJps) {
      reject(new Error("Elegí un archivo de imagen válido (incluyendo .jps)."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("La imagen no se pudo procesar."));
      image.onload = () => {
        const maxSide = 360;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("No se pudo comprimir la imagen.")); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function saveProfilePhoto(file) {
  if (!currentUser || !db || !file) return;
  try {
    const compressed = await compressProfileImage(file);
    await setDoc(doc(db, "userProfiles", currentUser.uid), {
      photoData: compressed,
      updatedAt: serverTimestamp()
    }, { merge: true });
    showToast("Foto de perfil actualizada.");
  } catch (error) {
    logError(error);
  } finally {
    const input = $("profile-photo-input");
    if (input) input.value = "";
  }
}

async function removeProfilePhoto() {
  if (!currentUser || !db) return;
  try {
    await setDoc(doc(db, "userProfiles", currentUser.uid), {
      photoData: "",
      updatedAt: serverTimestamp()
    }, { merge: true });
    showToast("Foto de perfil eliminada.");
  } catch (error) {
    logError(error);
  }
}

function calculateValuation(role, stats) {
  const weights = {
    Portero: [["saves", 1.25, 30], ["matches", 1.5, 15], ["mvps", 5, 20], ["conceded", -1.15, 0], ["yellow", -2, 0], ["red", -7, 0], ["injury", -3, 0]],
    Defensor: [["steals", 1.6, 25], ["recoveries", 1.25, 25], ["clearances", 1, 25], ["mvps", 5, 20], ["yellow", -2, 0], ["red", -7, 0]],
    Mediocampista: [["steals", 1, 20], ["creation", 1.6, 30], ["mvps", 5, 20], ["goals", 3, 20], ["assists", 2.5, 20], ["yellow", -2, 0], ["red", -7, 0]],
    Delantero: [["steals", 0.6, 10], ["goals", 3.2, 30], ["shots", 0.65, 30], ["mvps", 5, 20], ["assists", 2, 20], ["yellow", -2, 0], ["red", -7, 0]]
  };
  const config = weights[role] || [];
  let positive = 0, penalties = 0;
  config.forEach(([key, weight, cap]) => {
    const value = Number(stats[key] || 0);
    if (weight >= 0) positive += Math.min(value, cap) * weight;
    else penalties += Math.min(value, cap === 0 ? value : cap) * Math.abs(weight);
  });
  const raw = Math.max(0, Math.round(positive));
  const total = Math.max(0, Math.min(120, Math.round(raw - penalties)));
  return { raw, penalties: Math.round(penalties), total, marketValue: total };
}

function getMetricsFromForm() {
  const role = $("player-role")?.value || "";
  const stats = {};
  (ROLE_METRICS[role] || []).forEach(([key]) => { stats[key] = num(`metric-${key}`); });
  return stats;
}

function collectPlayer() {
  const role = $("player-role").value;
  const stats = getMetricsFromForm();
  const calculated = calculateValuation(role, stats);
  
  const manualCoinsInput = $("manual-market-coins");
  const finalValuationTotal = manualCoinsInput && manualCoinsInput.value !== "" ? Number(manualCoinsInput.value) : calculated.total;

  calculated.total = finalValuationTotal;
  calculated.marketValue = finalValuationTotal;

  return {
    name: $("player-name").value.trim(),
    role,
    team: $("player-team").value.trim(),
    stats,
    valuation: calculated,
    notes: $("player-notes").value.trim()
  };
}

function renderMetricFields(role, initial = {}) {
  const container = $("metrics-fields");
  if (!container) return;
  if (!ROLE_METRICS[role]) {
    container.innerHTML = '<div class="empty-state">Primero elegí un rol para cargar sus estadísticas.</div>';
    updatePreview();
    return;
  }
  container.innerHTML = ROLE_METRICS[role].map(([key, label]) => `
    <div class="field metric-field"><label for="metric-${key}">${safe(label.toUpperCase())}</label>
    <input id="metric-${key}" name="${key}" type="number" min="0" max="99999" step="1" value="${Number(initial[key] || 0)}" inputmode="numeric" required>
    <small>Ingresá un número igual o mayor a 0</small></div>`).join("");
  container.querySelectorAll("input").forEach(input => input.addEventListener("input", () => { updatePreview(); scheduleDraftSave(); }));
  updatePreview();
}

function updatePreview(overrideTotal = null) {
  if (!$("player-role")) return;
  const role = $("player-role").value;
  const name = $("player-name").value.trim() || "Nuevo jugador";
  const stats = getMetricsFromForm();
  const calculated = role ? calculateValuation(role, stats) : { raw: 0, penalties: 0, total: 0 };
  
  const manualCoinsInput = $("manual-market-coins");
  let displayTotal = overrideTotal !== null ? overrideTotal : (manualCoinsInput && manualCoinsInput.value !== "" ? Number(manualCoinsInput.value) : calculated.total);

  if ($("preview-role")) $("preview-role").textContent = role ? ROLE_LABELS[role] + " / " + role.toUpperCase() : "SIN POSICIÓN";
  if ($("preview-name")) $("preview-name").textContent = name;
  if ($("preview-value")) $("preview-value").textContent = money(displayTotal);
  if (manualCoinsInput && overrideTotal !== null) manualCoinsInput.value = displayTotal;
  if ($("value-meter-fill")) $("value-meter-fill").style.width = `${Math.min(120, displayTotal) / 120 * 100}%`;
  
  if ($("valuation-breakdown")) {
    $("valuation-breakdown").innerHTML = `<div><span>Valoración bruta</span><b>${money(calculated.raw)}</b></div><div><span>Penalizaciones</span><b>−${money(calculated.penalties)}</b></div><div><span>Valoración total</span><b>${money(displayTotal)} / 120</b></div>`;
  }
}

function getRoleClass(role) {
  return ({ Portero: "gk", Defensor: "def", Mediocampista: "mid", Delantero: "fwd" })[role] || "other";
}

function playerCard(p, rank) {
  return `<article class="player-card"><div class="player-card-top"><span class="role-chip ${getRoleClass(p.role)}">${safe(ROLE_LABELS[p.role] || "PLY")} · ${safe(p.role)}</span><span class="player-rank">#${String(rank || "—").padStart(2, "0")}</span></div><div class="player-initial">${safe((p.name || "?").trim().charAt(0).toUpperCase())}</div><h3>${safe(p.name)}</h3><p>${safe(p.team || "Club sin asignar")}</p><div class="player-card-bottom"><div><strong>${money(p.valuation?.total)}</strong><small>MON</small></div><button class="icon-button" data-edit="${safe(p.id)}" title="Editar jugador">↗</button></div></article>`;
}

function playerRow(p, index) {
  return `<tr><td><span class="table-rank">${String(index + 1).padStart(2, "0")}</span></td><td><div class="player-cell"><span class="mini-avatar ${getRoleClass(p.role)}">${safe((p.name || "?").charAt(0).toUpperCase())}</span><div><b>${safe(p.name)}</b><small>${safe(p.team || "Club sin asignar")}</small></div></div></td><td><span class="role-chip ${getRoleClass(p.role)}">${safe(p.role)}</span></td><td><b class="coin-value">${money(p.valuation?.total)}</b> <small>MON</small></td><td>${safe(dateText(p.updatedAt))}</td><td><div class="table-actions"><button class="icon-button" data-edit="${safe(p.id)}" title="Editar">✎</button><button class="icon-button danger-text" data-delete="${safe(p.id)}" title="Eliminar">×</button></div></td></tr>`;
}

function sortedPlayers(list = players, sort = "value-desc") {
  return [...list].sort((a, b) => sort === "value-asc" ? (a.valuation?.total || 0) - (b.valuation?.total || 0) :
    sort === "name-asc" ? a.name.localeCompare(b.name, "es") :
    sort === "updated-desc" ? timestamp(b) - timestamp(a) : (b.valuation?.total || 0) - (a.valuation?.total || 0));
}

function renderPlayers() {
  const search = normalize($("player-search")?.value);
  const role = $("role-filter")?.value || "";
  const sort = $("sort-filter")?.value || "value-desc";
  let list = sortedPlayers(players, sort).filter(p => (!search || normalize(p.name).includes(search) || normalize(p.team).includes(search)) && (!role || p.role === role));
  
  if ($("players-table-wrap")) {
    $("players-table-wrap").innerHTML = list.length ? `<div class="table-scroll"><table><thead><tr><th>#</th><th>JUGADOR</th><th>POSICIÓN</th><th>VALOR</th><th>ÚLTIMA EDICIÓN</th><th>ACCIONES</th></tr></thead><tbody>${list.map(playerRow).join("")}</tbody></table></div>` : '<div class="empty-state">No hay jugadores que coincidan con la búsqueda.</div>';
  }
  if ($("featured-players")) {
    $("featured-players").innerHTML = sortedPlayers().slice(0, 4).map((p, i) => playerCard(p, i + 1)).join("") || '<div class="empty-state">Agregá tu primer jugador para empezar.</div>';
  }
  if ($("stat-players")) $("stat-players").textContent = players.length;
  if ($("stat-value")) $("stat-value").textContent = money(players.reduce((s, p) => s + (p.valuation?.total || 0), 0));
  if ($("stat-average")) $("stat-average").textContent = players.length ? money(players.reduce((s, p) => s + (p.valuation?.total || 0), 0) / players.length) : "0";
  if ($("stat-history")) $("stat-history").textContent = history.length;
  
  const counts = Object.keys(ROLE_METRICS).map(r => ({ role: r, count: players.filter(p => p.role === r).length }));
  if ($("role-chart")) {
    $("role-chart").innerHTML = players.length ? counts.map(x => `<div class="role-bar-row"><div><span>${safe(x.role)}</span><b>${x.count}</b></div><div class="role-track"><i class="${getRoleClass(x.role)}" style="width:${x.count / players.length * 100}%"></i></div></div>`).join("") : '<div class="empty-state">Todavía no hay jugadores valorados.</div>';
  }
  if ($("transfer-player")) {
    $("transfer-player").innerHTML = '<option value="">Seleccioná un jugador</option>' + sortedPlayers(players, "name-asc").map(p => `<option value="${safe(p.id)}">${safe(p.name)} · ${safe(p.role)}</option>`).join("");
  }
  renderRanking(); renderRecentActivity(); renderTransfers();
}

function renderRanking() {
  const list = sortedPlayers();
  const podiumOrder = [list[1], list[0], list[2]].filter(Boolean);
  if ($("ranking-podium")) {
    $("ranking-podium").innerHTML = podiumOrder.length ? podiumOrder.map((p) => {
      const actualRank = list.indexOf(p) + 1;
      return `<article class="podium-card podium-${actualRank}"><div class="podium-medal">${actualRank === 1 ? "♛" : actualRank === 2 ? "②" : "③"}</div><div class="podium-avatar">${safe((p.name || "?").charAt(0).toUpperCase())}</div><span class="role-chip ${getRoleClass(p.role)}">${safe(p.role)}</span><h3>${safe(p.name)}</h3><div class="podium-value">${money(p.valuation?.total)} <small>MON</small></div><div class="podium-base">TOP ${actualRank}</div></article>`;
    }).join("") : '<div class="empty-state">El podio aparecerá cuando haya jugadores.</div>';
  }
  if ($("ranking-list")) {
    $("ranking-list").innerHTML = list.length ? `<div class="ranking-list-head"><span>POS.</span><span>JUGADOR</span><span>ROL</span><span>VALOR</span><span> </span></div>` + list.map((p, i) => `<div class="ranking-row"><b class="rank-number">${String(i + 1).padStart(2, "0")}</b><div class="player-cell"><span class="mini-avatar ${getRoleClass(p.role)}">${safe((p.name || "?").charAt(0).toUpperCase())}</span><div><b>${safe(p.name)}</b><small>${safe(p.team || "Club sin asignar")}</small></div></div><span class="role-chip ${getRoleClass(p.role)}">${safe(p.role)}</span><strong class="coin-value">${money(p.valuation?.total)} <small>MON</small></strong><button class="icon-button" data-edit="${safe(p.id)}">↗</button></div>`).join("") : '<div class="empty-state">Todavía no hay valoraciones.</div>';
  }
}

function actionVerb(action) {
  return ({ CREAR: "creó", EDITAR: "editó", ELIMINAR: "eliminó", FICHAJE: "registró un fichaje" })[action] || "realizó una acción";
}

function renderRecentActivity() {
  const list = history.slice(0, 5);
  if ($("recent-activity")) {
    $("recent-activity").innerHTML = list.length ? list.map(h => `<div class="activity-item"><span class="activity-dot ${safe((h.action || "").toLowerCase())}"></span><div><b>${safe(h.actor || "Administrador")} <span>${safe(actionVerb(h.action))}</span></b><p>${safe(h.targetName || h.details || "Registro")}</p><small>${safe(dateText(h.createdAt))}</small></div></div>`).join("") : '<div class="empty-state">Los cambios aparecerán aquí.</div>';
  }
}

function renderHistory() {
  const search = normalize($("history-search")?.value);
  const action = $("history-action-filter")?.value || "";
  const list = history.filter(h => (!search || normalize([h.actor, h.action, h.targetName, h.details].join(" ")).includes(search)) && (!action || h.action === action));
  if ($("history-list")) {
    $("history-list").innerHTML = list.length ? list.map(h => `<article class="history-item"><div class="history-icon ${safe((h.action || "").toLowerCase())}">${({ CREAR: "+", EDITAR: "✎", ELIMINAR: "×", FICHAJE: "⇄" })[h.action] || "◈"}</div><div class="history-detail"><div class="history-title"><b>${safe(h.actor || "Administrador")}</b><span class="action-pill ${safe((h.action || "").toLowerCase())}">${safe(h.action || "ACCIÓN")}</span></div><p>${safe(h.details || actionVerb(h.action))} <strong>${safe(h.targetName || "")}</strong></p><small>${safe(dateText(h.createdAt))}</small></div></article>`).join("") : '<div class="empty-state">No hay acciones que coincidan con la búsqueda.</div>';
  }
}

function renderTransfers() {
  const list = transfers.slice(0, 50);
  if ($("transfer-list")) {
    $("transfer-list").innerHTML = list.length ? list.map(t => `
      <article class="transfer-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; gap:12px; align-items:flex-start; flex:1; min-width:0;">
          <div class="transfer-icon">⇄</div>
          <div class="transfer-detail">
            <b>${safe(t.playerName || "Jugador")}</b>
            <p>${safe(t.from || "Origen no indicado")} <span>→</span> ${safe(t.to || "Destino no indicado")}</p>
            <small>${safe(t.type)} · ${safe(t.actor || "Admin")} · ${safe(dateText(t.createdAt))}</small>
            ${t.notes ? `<small class="transfer-notes">${safe(t.notes)}</small>` : ""}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <strong>${money(t.fee)} <small>MON</small></strong>
          <div class="table-actions">
            <button class="icon-button" data-edit-transfer="${safe(t.id)}" title="Editar fichaje">✎</button>
            <button class="icon-button danger-text" data-delete-transfer="${safe(t.id)}" title="Eliminar fichaje">×</button>
          </div>
        </div>
      </article>
    `).join("") : '<div class="empty-state">Todavía no hay fichajes registrados.</div>';
  }
}

function showView(view) {
  const targetSection = $(`view-${view}`);
  if (!targetSection) return;

  document.querySelectorAll(".view").forEach(el => el.classList.toggle("active-view", el.id === `view-${view}`));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  
  const labels = { overview: "CENTRO DE MANDO", players: "BASE DE JUGADORES", editor: "VALORAR JUGADOR", ranking: "TOP DE MERCADO", transfers: "FICHAJES", history: "HISTORIAL DE CAMBIOS" };
  if ($("crumb-title")) $("crumb-title").textContent = labels[view] || view.toUpperCase();
  if ($("sidebar")) $("sidebar").classList.remove("sidebar-open");
  if (view === "editor" && !editingId) resetEditor();
  if (view === "history") renderHistory();

  setTimeout(() => {
    targetSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

function openEditor(id = null) {
  editingId = id;
  const p = id ? players.find(x => x.id === id) : null;
  if ($("player-form")) $("player-form").reset();
  if ($("editor-title")) $("editor-title").innerHTML = p ? 'Editar jugador<span class="accent">.</span>' : 'Valorar jugador<span class="accent">.</span>';
  if ($("player-role")) $("player-role").value = p?.role || "";
  if ($("player-name")) $("player-name").value = p?.name || "";
  if ($("player-team")) $("player-team").value = p?.team || "";
  if ($("player-notes")) $("player-notes").value = p?.notes || "";
  
  renderMetricFields(p?.role || "", p?.stats || {});
  
  const manualCoinsInput = $("manual-market-coins");
  if (manualCoinsInput) {
    manualCoinsInput.value = p?.valuation?.total || "";
  }

  if ($("cancel-edit")) $("cancel-edit").classList.toggle("hidden", !p);
  if ($("save-player-button")) $("save-player-button").innerHTML = p ? 'GUARDAR CORRECCIONES <span>↗</span>' : 'GUARDAR VALORACIÓN <span>↗</span>';
  
  showView("editor");
  updatePreview(p?.valuation?.total);

  setTimeout(() => {
    const editorSec = $("view-editor");
    if (editorSec) {
      editorSec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 80);
}

function resetEditor() {
  editingId = null;
  if ($("player-form")) $("player-form").reset();
  if ($("editor-title")) $("editor-title").innerHTML = 'Valorar jugador<span class="accent">.</span>';
  if ($("metrics-fields")) $("metrics-fields").innerHTML = '<div class="empty-state">Primero elegí un rol para cargar sus estadísticas.</div>';
  const manualCoinsInput = $("manual-market-coins");
  if (manualCoinsInput) manualCoinsInput.value = "";
  if ($("cancel-edit")) $("cancel-edit").classList.add("hidden");
  if ($("save-player-button")) $("save-player-button").innerHTML = 'GUARDAR VALORACIÓN <span>↗</span>';
  if ($("preview-name")) updatePreview();
}

function openTransferEditor(transferId) {
  const t = transfers.find(x => x.id === transferId);
  if (!t) return;
  editingTransferId = transferId;
  if ($("transfer-player")) $("transfer-player").value = t.playerId || "";
  if ($("transfer-type")) $("transfer-type").value = t.type || "Traspaso";
  if ($("transfer-fee")) $("transfer-fee").value = t.fee || 0;
  if ($("transfer-from")) $("transfer-from").value = t.from || "";
  if ($("transfer-to")) $("transfer-to").value = t.to || "";
  if ($("transfer-notes")) $("transfer-notes").value = t.notes || "";
  if ($("transfer-form-title")) $("transfer-form-title").textContent = "Editar movimiento";
  if ($("submit-transfer-button")) $("submit-transfer-button").innerHTML = "GUARDAR CAMBIOS <span>↗</span>";
  if ($("cancel-transfer-edit")) $("cancel-transfer-edit").classList.remove("hidden");
  
  const formEl = $("transfer-form");
  if (formEl) formEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetTransferEditor() {
  editingTransferId = null;
  const form = $("transfer-form");
  if (form) form.reset();
  if ($("transfer-fee")) $("transfer-fee").value = "0";
  if ($("transfer-form-title")) $("transfer-form-title").textContent = "Registrar movimiento";
  if ($("submit-transfer-button")) $("submit-transfer-button").innerHTML = "CONFIRMAR MOVIMIENTO ↗";
  if ($("cancel-transfer-edit")) $("cancel-transfer-edit").classList.add("hidden");
}

function scheduleDraftSave() {
  if ($("autosave-state")) $("autosave-state").innerHTML = '<span class="pulse"></span> Borrador local guardándose...';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const data = { role: $("player-role")?.value, name: $("player-name")?.value, team: $("player-team")?.value, notes: $("player-notes")?.value, stats: getMetricsFromForm(), editingId };
    try {
      sessionStorage.setItem("striker-draft", JSON.stringify(data));
      if ($("autosave-state")) $("autosave-state").innerHTML = '<span class="pulse"></span> Borrador guardado en este navegador';
    } catch {
      if ($("autosave-state")) $("autosave-state").textContent = "Guardá para sincronizar";
    }
  }, 350);
}

function restoreDraft() {
  try {
    const raw = sessionStorage.getItem("striker-draft");
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.editingId && !players.some(p => p.id === d.editingId)) return;
    if (d.name || d.role || Object.keys(d.stats || {}).length) {
      if ($("player-role")) $("player-role").value = d.role || "";
      if ($("player-name")) $("player-name").value = d.name || "";
      if ($("player-team")) $("player-team").value = d.team || "";
      if ($("player-notes")) $("player-notes").value = d.notes || "";
      editingId = d.editingId || null;
      renderMetricFields(d.role || "", d.stats || {});
      updatePreview();
      if ($("autosave-state")) $("autosave-state").innerHTML = '<span class="pulse"></span> Borrador recuperado';
      showToast("Se recuperó el borrador local.");
    }
  } catch {}
}

async function writeAudit(action, targetName, details) {
  if (!currentUser || !currentAdmin) return;
  await addDoc(collection(db, "auditLogs"), { action, actor: currentAdmin.label, actorEmail: currentUser.email, targetName: String(targetName || ""), details: String(details || ""), createdAt: serverTimestamp() });
}

function startSubscriptions() {
  unsubscribers.forEach(fn => fn());
  unsubscribers = [];
  const subs = [
    [query(collection(db, "players"), orderBy("name")), snap => { players = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderPlayers(); }],
    [query(collection(db, "auditLogs"), orderBy("createdAt", "desc")), snap => { history = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderPlayers(); renderHistory(); }],
    [query(collection(db, "transfers"), orderBy("createdAt", "desc")), snap => { transfers = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTransfers(); }]
  ];
  subs.forEach(([q, cb]) => unsubscribers.push(onSnapshot(q, cb, error => logError(error))));
}

function enterApp(user, admin) {
  currentUser = user;
  currentAdmin = admin;
  if ($("login-screen")) $("login-screen").classList.add("hidden");
  if ($("app-shell")) $("app-shell").classList.remove("hidden");
  if ($("welcome-name")) $("welcome-name").textContent = admin.label;
  if ($("top-username")) $("top-username").textContent = admin.label;
  
  loadProfilePhoto();
  startSubscriptions();
  restoreDraft();
}

function leaveApp() {
  unsubscribers.forEach(fn => fn());
  unsubscribers = [];
  if (profileUnsubscribe) { profileUnsubscribe(); profileUnsubscribe = null; }
  currentUser = null;
  currentAdmin = null;
  players = []; history = []; transfers = [];
  if ($("app-shell")) $("app-shell").classList.add("hidden");
  if ($("login-screen")) $("login-screen").classList.remove("hidden");
  if ($("login-password")) $("login-password").value = "";
  if ($("login-error")) $("login-error").textContent = "";
}

function confirmAction(title, message, confirmLabel = "Confirmar") {
  if ($("modal-title")) $("modal-title").textContent = title;
  if ($("modal-message")) $("modal-message").textContent = message;
  if ($("modal-confirm")) $("modal-confirm").textContent = confirmLabel;
  if ($("confirm-modal")) $("confirm-modal").classList.remove("hidden");
  return new Promise(resolve => { modalResolve = resolve; });
}

function closeModal(result) {
  if ($("confirm-modal")) $("confirm-modal").classList.add("hidden");
  if (modalResolve) { modalResolve(result); modalResolve = null; }
}

function exportCSV(rows, filename) {
  const csv = rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  const togglePass = $("toggle-password");
  const loginPass = $("login-password");
  if (togglePass && loginPass) {
    togglePass.addEventListener("click", () => { loginPass.type = loginPass.type === "password" ? "text" : "password"; });
  }

  const loginForm = $("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async e => {
      e.preventDefault();
      const button = $("login-button");
      const username = normalize($("login-user")?.value);
      const password = loginPass?.value || "";
      const admin = ADMIN_USERS[username];
      if ($("login-error")) $("login-error").textContent = "";
      if (!admin) {
        if ($("login-error")) $("login-error").textContent = "Usuario no autorizado.";
        return;
      }
      setBusy(button, true, "VALIDANDO ACCESO...");
      try {
        const result = await signInWithEmailAndPassword(auth, admin.email, password);
        enterApp(result.user, admin);
      } catch (error) {
        if ($("login-error")) $("login-error").textContent = logError(error);
      } finally {
        setBusy(button, false);
      }
    });
  }

  const logoutBtn = $("logout-button");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try { await signOut(auth); leaveApp(); } catch (e) { logError(e); }
    });
  }

  const menuToggle = $("menu-toggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", () => $("sidebar")?.classList.toggle("sidebar-open"));
  }

  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.goto)));

  const userAvatar = $("user-avatar");
  const profileInput = $("profile-photo-input");
  if (userAvatar && profileInput) {
    userAvatar.addEventListener("click", () => profileInput.click());
    profileInput.addEventListener("change", e => {
      const file = e.target.files?.[0];
      if (file) saveProfilePhoto(file);
    });
  }

  const changePhotoBtn = $("change-profile-photo");
  if (changePhotoBtn && profileInput) {
    changePhotoBtn.addEventListener("click", () => profileInput.click());
  }

  const removePhotoBtn = $("remove-profile-photo");
  if (removePhotoBtn) {
    removePhotoBtn.addEventListener("click", removeProfilePhoto);
  }

  const playerRole = $("player-role");
  if (playerRole) {
    playerRole.addEventListener("change", () => { renderMetricFields(playerRole.value); updatePreview(); scheduleDraftSave(); });
  }

  ["player-name", "player-team", "player-notes"].forEach(id => {
    $(id)?.addEventListener("input", () => { updatePreview(); scheduleDraftSave(); });
  });

  const manualCoinsInput = $("manual-market-coins");
  if (manualCoinsInput) {
    manualCoinsInput.addEventListener("input", () => {
      const val = Number(manualCoinsInput.value || 0);
      updatePreview(val);
      scheduleDraftSave();
    });
  }

  ["player-search", "role-filter", "sort-filter"].forEach(id => {
    $(id)?.addEventListener(id === "player-search" ? "input" : "change", renderPlayers);
  });

  const playerForm = $("player-form");
  if (playerForm) {
    playerForm.addEventListener("submit", async e => {
      e.preventDefault();
      const button = $("save-player-button");
      const p = collectPlayer();
      if (!p.role || !p.name) { showToast("Completá el rol y el nombre del jugador.", "error"); return; }
      setBusy(button, true, "GUARDANDO...");
      try {
        if (editingId) {
          const old = players.find(x => x.id === editingId);
          await setDoc(doc(db, "players", editingId), { ...p, createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: currentAdmin.label }, { merge: true });
          await writeAudit("EDITAR", p.name, `Editó la valoración de ${p.name} (${p.role}). Valor: ${p.valuation.total} MON.`);
          showToast("Correcciones guardadas y sincronizadas.");
        } else {
          await addDoc(collection(db, "players"), { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: currentAdmin.label, updatedBy: currentAdmin.label });
          await writeAudit("CREAR", p.name, `Creó la valoración de ${p.name} (${p.role}). Valor: ${p.valuation.total} MON.`);
          showToast("Jugador agregado al mercado.");
        }
        sessionStorage.removeItem("striker-draft");
        resetEditor();
        showView("players");
      } catch (error) { logError(error); }
      finally { setBusy(button, false); }
    });
  }

  const cancelEditBtn = $("cancel-edit");
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => { resetEditor(); showView("players"); });
  }

  const playersTableWrap = $("players-table-wrap");
  if (playersTableWrap) {
    playersTableWrap.addEventListener("click", async e => {
      const edit = e.target.closest("[data-edit]");
      const del = e.target.closest("[data-delete]");
      if (edit) openEditor(edit.dataset.edit);
      if (del) {
        const p = players.find(x => x.id === del.dataset.delete);
        if (!p) return;
        if (await confirmAction("Eliminar jugador", `¿Eliminar a ${p.name} de la base? Esta acción no se puede deshacer.`, "Eliminar")) {
          try {
            await deleteDoc(doc(db, "players", p.id));
            await writeAudit("ELIMINAR", p.name, `Eliminó a ${p.name} del mercado.`);
            showToast("Jugador eliminado.");
          } catch (error) { logError(error); }
        }
      }
    });
  }

  document.querySelectorAll(".content").forEach(el => el.addEventListener("click", e => {
    const edit = e.target.closest("[data-edit]");
    if (edit && !e.target.closest("#players-table-wrap")) openEditor(edit.dataset.edit);
  }));

  const transferForm = $("transfer-form");
  if (transferForm) {
    transferForm.addEventListener("submit", async e => {
      e.preventDefault();
      const button = $("submit-transfer-button");
      const player = players.find(p => p.id === $("transfer-player")?.value);
      if (!player) { showToast("Elegí un jugador válido.", "error"); return; }
      
      const t = {
        playerId: player.id,
        playerName: player.name,
        type: $("transfer-type")?.value,
        fee: num("transfer-fee"),
        from: $("transfer-from")?.value.trim(),
        to: $("transfer-to")?.value.trim(),
        notes: $("transfer-notes")?.value.trim(),
        actor: currentAdmin.label
      };

      setBusy(button, true, editingTransferId ? "GUARDANDO..." : "REGISTRANDO...");
      try {
        if (editingTransferId) {
          const oldT = transfers.find(x => x.id === editingTransferId);
          await setDoc(doc(db, "transfers", editingTransferId), {
            ...t,
            createdAt: oldT?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp()
          }, { merge: true });
          await writeAudit("EDITAR", player.name, `Editó fichaje (${t.type}): ${player.name}, ${t.fee} MON.`);
          showToast("Fichaje actualizado correctamente.");
        } else {
          await addDoc(collection(db, "transfers"), {
            ...t,
            createdAt: serverTimestamp()
          });
          await writeAudit("FICHAJE", player.name, `${t.type}: ${player.name}, ${t.from || "origen sin indicar"} → ${t.to || "destino sin indicar"}, ${t.fee} MON.`);
          showToast("Movimiento registrado en el mercado.");
        }
        resetTransferEditor();
      } catch (error) { logError(error); }
      finally { setBusy(button, false); }
    });
  }

  const cancelTransferEditBtn = $("cancel-transfer-edit");
  if (cancelTransferEditBtn) {
    cancelTransferEditBtn.addEventListener("click", resetTransferEditor);
  }

  const transferListEl = $("transfer-list");
  if (transferListEl) {
    transferListEl.addEventListener("click", async e => {
      const editBtn = e.target.closest("[data-edit-transfer]");
      const delBtn = e.target.closest("[data-delete-transfer]");
      
      if (editBtn) {
        openTransferEditor(editBtn.dataset.editTransfer);
      }
      
      if (delBtn) {
        const tId = delBtn.dataset.deleteTransfer;
        const t = transfers.find(x => x.id === tId);
        if (!t) return;
        if (await confirmAction("Eliminar fichaje", `¿Eliminar el registro de fichaje de ${t.playerName}?`, "Eliminar")) {
          try {
            await deleteDoc(doc(db, "transfers", tId));
            await writeAudit("ELIMINAR", t.playerName, `Eliminó registro de fichaje (${t.type}) de ${t.playerName}.`);
            showToast("Fichaje eliminado.");
            if (editingTransferId === tId) resetTransferEditor();
          } catch (error) { logError(error); }
        }
      }
    });
  }

  ["history-search", "history-action-filter"].forEach(id => {
    $(id)?.addEventListener(id === "history-search" ? "input" : "change", renderHistory);
  });

  const exportHistoryBtn = $("export-history");
  if (exportHistoryBtn) {
    exportHistoryBtn.addEventListener("click", () => exportCSV([["Fecha", "Administrador", "Acción", "Jugador", "Detalle"], ...history.map(h => [dateText(h.createdAt), h.actor, h.action, h.targetName, h.details])], "striker-historial.csv"));
  }

  $("modal-cancel")?.addEventListener("click", () => closeModal(false));
  $("modal-confirm")?.addEventListener("click", () => closeModal(true));
  $("confirm-modal")?.addEventListener("click", e => { if (e.target.id === "confirm-modal") closeModal(false); });
  window.addEventListener("beforeunload", () => { unsubscribers.forEach(fn => fn()); });
}

function showSetupError() {
  if ($("login-error")) $("login-error").textContent = "Falta configurar Firebase. Seguí el archivo README.md y completá firebase-config.js.";
  if ($("login-button")) $("login-button").disabled = true;
}

if (Object.values(firebaseConfig).some(v => String(v).startsWith("REEMPLAZAR"))) {
  bindEvents();
  showSetupError();
} else {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    bindEvents();
    onAuthStateChanged(auth, user => {
      if (!user) { leaveApp(); return; }
      const admin = Object.values(ADMIN_USERS).find(a => a.email === user.email);
      if (!admin) { signOut(auth); leaveApp(); showToast("Esta cuenta no tiene acceso al panel.", "error"); return; }
      enterApp(user, admin);
    });
  } catch (error) {
    console.error(error);
    bindEvents();
    showSetupError();
  }
}