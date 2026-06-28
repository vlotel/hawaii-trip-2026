import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBuWNSuI_e6hskif_8wC1Q3nC4HyjIltbk",
  authDomain: "hawaii-trip-2026-62b56.firebaseapp.com",
  projectId: "hawaii-trip-2026-62b56",
  storageBucket: "hawaii-trip-2026-62b56.firebasestorage.app",
  messagingSenderId: "117801255420",
  appId: "1:117801255420:web:b83c363be041a4ce0c7279",
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const TRIP_DOC = doc(db, "trips", "hawaii-2026");

// テーマだけ即時適用のためlocalStorageからも読む(Firestoreロード前の画面ちらつき防止)
let state = {
  packing: {},
  todo: {},
  budget: {},
  drive: {},
  customPacking: [],
  packingDeleted: [],   // 削除済みの既定項目id
  packingText: {},      // 項目id → 編集後の文言(上書き)
  packingOrder: {},     // カテゴリ名 → 項目idの並び順
  packingBought: {},    // 項目id → 買い物済みフラグ(packing はパッキング済み)
  theme: localStorage.getItem("hawaii-theme") || "light",
};

// Firestoreへ保存(非同期・fire-and-forget)
let lastSaveTime = 0;
function saveState(s) {
  lastSaveTime = Date.now();
  if (s.theme) localStorage.setItem("hawaii-theme", s.theme);
  setDoc(TRIP_DOC, {
    packing: s.packing || {},
    todo: s.todo || {},
    budget: s.budget || {},
    drive: s.drive || {},
    customPacking: s.customPacking || [],
    packingDeleted: s.packingDeleted || [],
    packingText: s.packingText || {},
    packingOrder: s.packingOrder || {},
    packingBought: s.packingBought || {},
    theme: s.theme || "light",
  }).catch((e) => console.warn("Firestore保存エラー:", e));
}

// ---------- タブ切り替え ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "drive" && driveMap) {
      setTimeout(() => driveMap.invalidateSize(), 0);
    }
  });
});

// ---------- 行程表 ----------
function renderOverview() {
  const el = document.getElementById("trip-overview");
  el.innerHTML = `
    <h2>旅行概要</h2>
    <ul>
      <li>日程: ${TRIP_INFO.period}</li>
      <li>宿泊先: ${TRIP_INFO.hotel}</li>
      <li class="muted">${TRIP_INFO.hotelAddress}</li>
      <li>航空会社: ${TRIP_INFO.airline}</li>
    </ul>
    <h3>基本情報</h3>
    <ul class="muted">
      ${GENERAL_INFO.map((t) => `<li>${t}</li>`).join("")}
    </ul>
    <p class="muted">※交通事情その他の理由により行程内容は変更となる場合があります。</p>
  `;
}

function statusClass(status) {
  if (status === "予約済み") return "status-done";
  if (status === "未確定" || status === "未予約") return "status-undecided";
  return "";
}

function renderItinerary() {
  const el = document.getElementById("itinerary-list");
  el.innerHTML = ITINERARY.map((day) => {
    let tableHtml = "";
    if (day.items && day.items.length) {
      tableHtml = `
        <table>
          <thead><tr><th>時刻</th><th>内容</th><th>交通機関</th><th>予約状況</th></tr></thead>
          <tbody>
            ${day.items.map((i) => `
              <tr>
                <td>${i.time}</td>
                <td>${i.content}</td>
                <td>${i.transport}</td>
                <td class="${statusClass(i.status)}">${i.status}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }

    let freeTextHtml = "";
    if (day.freeText && day.freeText.length) {
      freeTextHtml = `<ul class="free-text-list">${day.freeText.map((t) => `<li>${t}</li>`).join("")}</ul>`;
    }

    let extraNotesHtml = "";
    if (day.extraNotes && day.extraNotes.length) {
      extraNotesHtml = `<ul class="extra-notes muted">${day.extraNotes.map((t) => `<li>${t}</li>`).join("")}</ul>`;
    }

    return `
      <div class="day-card">
        <h2><span class="date-badge">${day.date}</span>${day.title}</h2>
        ${tableHtml}
        ${freeTextHtml}
        ${extraNotesHtml}
        <div class="day-meta">
          食事: ${day.meals}${day.stay ? ` ／ 宿泊: ${day.stay}` : ""}
        </div>
        ${day.notes && day.notes.length ? `<div class="day-meta">${day.notes.join(" / ")}</div>` : ""}
      </div>
    `;
  }).join("");
}

function renderSummary() {
  const el = document.getElementById("summary-card");
  el.innerHTML = `
    <h2>確定/未確定の整理</h2>
    <ul>
      <li><strong>確定(予約済み)</strong>: ${CONFIRMED_SUMMARY.confirmed}</li>
      <li><strong>未確定・各自対応</strong>: ${CONFIRMED_SUMMARY.unconfirmed}</li>
      <li><strong>変更あり</strong>: ${CONFIRMED_SUMMARY.changed}</li>
      <li><strong>要確認</strong>: ${CONFIRMED_SUMMARY.toConfirm}</li>
    </ul>
  `;
}

// ---------- 予算管理 ----------
function getBudgetValue(item, field) {
  const override = state.budget[item.id];
  if (override && override[field] !== undefined) return override[field];
  return item[field];
}

function setBudgetValue(id, field, value) {
  state.budget[id] = state.budget[id] || {};
  state.budget[id][field] = value;
  saveState(state);
  renderBudgetTotal();
}

function renderBudget() {
  const el = document.getElementById("budget-table");
  el.innerHTML = `
    <table>
      <thead><tr><th>項目</th><th>金額(目安)</th><th>状況</th><th>メモ</th></tr></thead>
      <tbody>
        ${BUDGET_ITEMS.map((item) => {
          const estimate = getBudgetValue(item, "estimate");
          const status = getBudgetValue(item, "status");
          const memo = getBudgetValue(item, "memo");
          return `
            <tr>
              <td>${item.item}</td>
              <td><input type="text" data-id="${item.id}" data-field="estimate" value="${estimate.replace(/"/g, "&quot;")}" placeholder="金額を入力"></td>
              <td>
                <select data-id="${item.id}" data-field="status">
                  <option value="未確定" ${status === "未確定" ? "selected" : ""}>未確定</option>
                  <option value="確定" ${status === "確定" ? "selected" : ""}>確定</option>
                  <option value="不要" ${status === "不要" ? "selected" : ""}>不要</option>
                </select>
              </td>
              <td><input type="text" data-id="${item.id}" data-field="memo" value="${memo.replace(/"/g, "&quot;")}" placeholder="メモ"></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  el.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", (e) => {
      setBudgetValue(e.target.dataset.id, e.target.dataset.field, e.target.value);
    });
  });

  renderBudgetTotal();
}

// 「○○円/人」「○○円」のような文字列から数値を抜き出す(完全な計算式ではなく目安)
function parseAmount(text) {
  if (!text) return 0;
  const match = text.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

function renderBudgetTotal() {
  const el = document.getElementById("budget-total");
  let total = 0;
  let hasUnknown = false;
  BUDGET_ITEMS.forEach((item) => {
    const status = getBudgetValue(item, "status");
    if (status === "不要") return;
    const estimate = getBudgetValue(item, "estimate");
    if (estimate) {
      total += parseAmount(estimate);
    } else {
      hasUnknown = true;
    }
  });
  el.innerHTML = `見積り合計(金額入力分のみ): ${total.toLocaleString()} 円${hasUnknown ? "(金額未入力の項目あり)" : ""}`;
}

// ---------- 持ち物リスト ----------
// 編集中の項目id / 編集モード表示(いずれも永続化しない一時状態)
let editingPackingId = null;
let packingEditMode = false;
let packingSortables = [];

function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// 項目の表示テキスト(編集による上書きがあればそれを優先)
function getPackingText(id, fallback) {
  return state.packingText[id] !== undefined ? state.packingText[id] : fallback;
}

// カテゴリ内の項目を保存済みの並び順に並べ替える(順序未登録の新規項目は末尾)
function orderedCategoryItems(category, defaultItems, customItems) {
  const all = [
    ...defaultItems.filter((it) => !state.packingDeleted.includes(it.id)),
    ...customItems,
  ];
  const order = state.packingOrder[category];
  if (!order || !order.length) return all;
  const byId = new Map(all.map((it) => [it.id, it]));
  const result = [];
  order.forEach((id) => {
    if (byId.has(id)) { result.push(byId.get(id)); byId.delete(id); }
  });
  byId.forEach((it) => result.push(it)); // 並び順に無い項目は元の順で末尾へ
  return result;
}

function packingItemHtml(id, fallbackText) {
  const text = getPackingText(id, fallbackText);
  if (editingPackingId === id) {
    return `
      <div class="packing-item editing" data-id="${id}">
        <input type="text" class="packing-edit-input" data-id="${id}" value="${escAttr(text)}" maxlength="60">
        <button class="packing-edit-save" data-id="${id}">保存</button>
        <button class="packing-edit-cancel" data-id="${id}">取消</button>
      </div>
    `;
  }
  const bought = !!state.packingBought[id];
  const packed = !!state.packing[id];
  return `
    <div class="packing-item ${packed ? "checked" : ""}" data-id="${id}">
      <span class="packing-drag" aria-label="並べ替え" title="ドラッグで並べ替え">⠿</span>
      <div class="packing-main">
        <div class="packing-row1">
          <span class="packing-label">${text}</span>
          <button class="packing-edit" data-id="${id}" aria-label="編集">✏️</button>
          <button class="packing-delete" data-id="${id}" aria-label="削除">✕</button>
        </div>
        <div class="pack-toggles">
          <label class="pack-toggle bought ${bought ? "on" : ""}">
            <input type="checkbox" data-id="${id}" data-kind="bought" ${bought ? "checked" : ""}>
            <span>🛒 買い物済み</span>
          </label>
          <label class="pack-toggle packed ${packed ? "on" : ""}">
            <input type="checkbox" data-id="${id}" data-kind="packed" ${packed ? "checked" : ""}>
            <span>🎒 パッキング済み</span>
          </label>
        </div>
      </div>
    </div>
  `;
}

// カテゴリ内の項目をドラッグで並べ替え可能にする(編集モード時のみ)
function initPackingSortable() {
  packingSortables.forEach((s) => s.destroy());
  packingSortables = [];
  if (!window.Sortable) return;
  document.querySelectorAll("#packing-list .packing-items").forEach((container) => {
    const category = container.dataset.category;
    packingSortables.push(Sortable.create(container, {
      handle: ".packing-drag",
      animation: 150,
      onEnd: () => {
        const ids = [...container.querySelectorAll(".packing-item")].map((el) => el.dataset.id);
        state.packingOrder[category] = ids;
        saveState(state);
      },
    }));
  });
}

function renderPacking() {
  const el = document.getElementById("packing-list");
  el.classList.toggle("edit-mode", packingEditMode);
  const modeBtn = document.getElementById("packing-edit-mode-btn");
  if (modeBtn) {
    modeBtn.textContent = packingEditMode ? "完了" : "編集";
    modeBtn.classList.toggle("active", packingEditMode);
  }

  let html = "";
  let total = 0;
  let boughtCount = 0;
  let packedCount = 0;

  const countItem = (id) => {
    total++;
    if (state.packingBought[id]) boughtCount++;
    if (state.packing[id]) packedCount++;
  };

  // カテゴリ別にカスタムアイテムをまとめる
  const customByCategory = {};
  state.customPacking.forEach((item) => {
    (customByCategory[item.category] = customByCategory[item.category] || []).push(item);
  });

  // 1カテゴリ分のHTMLを生成(badge=true で「追加」バッジ付き)
  const renderCategory = (category, defaultItems, badge) => {
    const items = orderedCategoryItems(category, defaultItems, customByCategory[category] || []);
    if (!items.length) return "";
    let body = "";
    items.forEach((item) => {
      countItem(item.id);
      body += packingItemHtml(item.id, item.text);
    });
    return `<div class="packing-category">
      <h3>${category}${badge ? ` <span class="custom-category-badge">追加</span>` : ""}</h3>
      <div class="packing-items" data-category="${escAttr(category)}">${body}</div>
    </div>`;
  };

  // 既定カテゴリ
  Object.entries(PACKING_LIST).forEach(([category, items]) => {
    html += renderCategory(category, items, false);
    delete customByCategory[category];
  });

  // 既定にないカテゴリ(新規カテゴリ)
  Object.keys(customByCategory).forEach((category) => {
    html += renderCategory(category, [], true);
  });

  el.innerHTML = html;
  document.getElementById("packing-progress").textContent =
    `🛒 ${boughtCount}/${total} ・ 🎒 ${packedCount}/${total}`;

  el.querySelectorAll('.pack-toggle input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      if (e.target.dataset.kind === "bought") {
        state.packingBought[id] = e.target.checked;
      } else {
        state.packing[id] = e.target.checked;
      }
      saveState(state);
      renderPacking();
    });
  });

  // 削除(既定項目は packingDeleted に記録、カスタム項目は customPacking から除去)
  el.querySelectorAll(".packing-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.id;
      if (state.customPacking.some((i) => i.id === id)) {
        state.customPacking = state.customPacking.filter((i) => i.id !== id);
      } else if (!state.packingDeleted.includes(id)) {
        state.packingDeleted.push(id);
      }
      delete state.packing[id];
      delete state.packingBought[id];
      delete state.packingText[id];
      saveState(state);
      renderPacking();
    });
  });

  // 編集開始
  el.querySelectorAll(".packing-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      editingPackingId = e.currentTarget.dataset.id;
      renderPacking();
      const input = el.querySelector(".packing-edit-input");
      if (input) { input.focus(); input.select(); }
    });
  });

  // 編集の保存・取消
  const saveEdit = (id, value) => {
    const text = value.trim();
    if (text) {
      state.packingText[id] = text;
      saveState(state);
    }
    editingPackingId = null;
    renderPacking();
  };
  const cancelEdit = () => {
    editingPackingId = null;
    renderPacking();
  };
  el.querySelectorAll(".packing-edit-save").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.dataset.id;
      const input = el.querySelector(`.packing-edit-input[data-id="${id}"]`);
      saveEdit(id, input ? input.value : "");
    });
  });
  el.querySelectorAll(".packing-edit-cancel").forEach((btn) => {
    btn.addEventListener("click", cancelEdit);
  });
  el.querySelectorAll(".packing-edit-input").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveEdit(input.dataset.id, input.value); }
      if (e.key === "Escape") cancelEdit();
    });
  });

  // 並べ替え(編集モード時のみ有効化)
  if (packingEditMode) {
    initPackingSortable();
  } else {
    packingSortables.forEach((s) => s.destroy());
    packingSortables = [];
  }
}

function addCustomPackingItem(text, category) {
  const id = "custom-" + Date.now();
  state.customPacking.push({ id, category, text });
  saveState(state);
  renderPacking();
}

// カテゴリ選択肢(既定 + カスタムで追加済みのもの)
function getPackingCategories() {
  const defaults = Object.keys(PACKING_LIST);
  const custom = [...new Set(state.customPacking.map((i) => i.category))].filter((c) => !defaults.includes(c));
  return [...defaults, ...custom];
}

// 持ち物追加フォームの初期化
function initPackingAddForm() {
  const textEl = document.getElementById("packing-add-text");
  const catEl = document.getElementById("packing-add-category");
  const newCatEl = document.getElementById("packing-add-newcategory");
  const btn = document.getElementById("packing-add-btn");

  function refreshCategories() {
    const current = catEl.value;
    catEl.innerHTML = getPackingCategories()
      .map((c) => `<option value="${c}">${c}</option>`)
      .join("") + `<option value="__new__">＋ 新しいカテゴリ</option>`;
    if ([...catEl.options].some((o) => o.value === current)) catEl.value = current;
  }

  catEl.addEventListener("change", () => {
    const isNew = catEl.value === "__new__";
    newCatEl.style.display = isNew ? "block" : "none";
    if (isNew) newCatEl.focus();
  });

  btn.addEventListener("click", () => {
    const text = textEl.value.trim();
    if (!text) { textEl.focus(); return; }
    const category = catEl.value === "__new__"
      ? (newCatEl.value.trim() || "その他")
      : catEl.value;
    addCustomPackingItem(text, category);
    textEl.value = "";
    newCatEl.value = "";
    catEl.value = category;
    newCatEl.style.display = "none";
    refreshCategories();
    textEl.focus();
  });

  textEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btn.click();
  });

  // 編集モード(削除・編集・並べ替えハンドルの表示/非表示)切替
  const modeBtn = document.getElementById("packing-edit-mode-btn");
  if (modeBtn) {
    modeBtn.addEventListener("click", () => {
      packingEditMode = !packingEditMode;
      if (!packingEditMode) editingPackingId = null; // 編集モードを抜けたら個別編集も終了
      renderPacking();
    });
  }

  refreshCategories();
}

// ---------- ドライブ ----------
function googleMapsUrl(name) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " Oahu Hawaii")}`;
}

function getDriveState(id) {
  return state.drive[id] || { selected: false, memo: "" };
}

function setDriveState(id, field, value) {
  state.drive[id] = state.drive[id] || { selected: false, memo: "" };
  state.drive[id][field] = value;
  saveState(state);
  renderDrive();
}

let driveMap = null;
let driveLayers = [];

// 2点間の距離(km) — ハバーサイン公式
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function renderDriveMap() {
  if (!driveMap) {
    driveMap = L.map("drive-map").setView([21.45, -157.95], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(driveMap);
  }

  // 既存レイヤー(マーカー・ルート線)をクリア
  driveLayers.forEach((m) => driveMap.removeLayer(m));
  driveLayers = [];

  // DRIVE_SPOTS は時計回り順に並んでいるので、その順を訪問順とする
  const selectedSpots = DRIVE_SPOTS.filter((s) => getDriveState(s.id).selected);

  // ルート線: ホテル → 選択スポット(順) → ホテル
  if (selectedSpots.length) {
    const routePoints = [
      [DRIVE_START.lat, DRIVE_START.lng],
      ...selectedSpots.map((s) => [s.lat, s.lng]),
      [DRIVE_START.lat, DRIVE_START.lng],
    ];
    const line = L.polyline(routePoints, {
      color: "#f97316",
      weight: 3,
      opacity: 0.7,
      dashArray: "6 6",
    }).addTo(driveMap);
    driveLayers.push(line);
  }

  // 起点(ホテル)マーカー
  const startIcon = L.divIcon({
    className: "drive-start-icon",
    html: "🏨",
    iconSize: [24, 24],
  });
  const startMarker = L.marker([DRIVE_START.lat, DRIVE_START.lng], { icon: startIcon }).addTo(driveMap);
  startMarker.bindPopup(`<div class="drive-popup"><h4>${DRIVE_START.name}</h4><p class="muted">ドライブの起点・終点</p></div>`);
  driveLayers.push(startMarker);

  // 各スポットのマーカー(選択中は訪問順の番号付き)
  DRIVE_SPOTS.forEach((spot) => {
    const ds = getDriveState(spot.id);
    const order = ds.selected ? selectedSpots.indexOf(spot) + 1 : null;
    const icon = L.divIcon({
      className: `drive-marker-icon ${ds.selected ? "selected" : ""}`,
      html: order ? `<span>${order}</span>` : "",
      iconSize: ds.selected ? [24, 24] : [14, 14],
    });
    const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(driveMap);
    marker.spotId = spot.id;
    marker.bindPopup(`
      <div class="drive-popup">
        <h4>${order ? order + ". " : ""}${spot.name}</h4>
        <p class="muted">${spot.area}</p>
        <p>${spot.desc}</p>
        <button class="popup-toggle ${ds.selected ? "on" : ""}" onclick="toggleDriveSpot('${spot.id}')">
          ${ds.selected ? "✓ 行く(選択中)" : "+ 行くに追加"}
        </button>
        <a href="${googleMapsUrl(spot.name)}" target="_blank" rel="noopener">Google Mapsで見る</a>
      </div>
    `);
    driveLayers.push(marker);
  });

  // 概算ドライブ情報の表示
  renderDriveSummaryBar(selectedSpots);
}

// 地図下のドライブ概算バー(距離・時間の目安)
function renderDriveSummaryBar(selectedSpots) {
  const el = document.getElementById("drive-map-summary");
  if (!el) return;
  if (!selectedSpots.length) {
    el.innerHTML = `<span class="muted">スポットを「行く」に追加すると、ホテルを起点にしたおおよそのルートと走行距離の目安を表示します。</span>`;
    return;
  }
  // ホテル → 各スポット → ホテル の直線距離合計
  const points = [DRIVE_START, ...selectedSpots, DRIVE_START];
  let km = 0;
  for (let i = 0; i < points.length - 1; i++) {
    km += haversineKm(points[i], points[i + 1]);
  }
  // 直線距離→実走行距離は1.3倍程度、平均速度45km/h、各立寄り40分で概算
  const roadKm = km * 1.3;
  const driveMin = (roadKm / 45) * 60;
  const stopMin = selectedSpots.length * 40;
  const totalMin = driveMin + stopMin;
  const fmt = (m) => `${Math.floor(m / 60)}時間${Math.round(m % 60)}分`;
  el.innerHTML = `
    <strong>選択中 ${selectedSpots.length}箇所</strong>
    ／ ルート概算 約${Math.round(roadKm)}km
    ／ 運転 約${fmt(driveMin)}
    ＋ 各所滞在 約${fmt(stopMin)}
    = <strong>合計 約${fmt(totalMin)}</strong>
    <span class="muted">(直線距離からの粗い目安。1箇所40分滞在で試算)</span>
  `;
}

// 地図のポップアップから「行く」を切り替える(グローバル公開)
function toggleDriveSpot(id) {
  const ds = getDriveState(id);
  setDriveState(id, "selected", !ds.selected); // → renderDrive() → renderDriveMap() で再描画
  // 再描画でマーカーが作り直されるため、同じスポットのポップアップを開き直す
  const marker = driveLayers.find((m) => m.spotId === id);
  if (marker) marker.openPopup();
}
window.toggleDriveSpot = toggleDriveSpot;

function renderDrive() {
  const filterOnly = document.getElementById("drive-filter").checked;

  renderDriveMap();

  // 選択中のスポットまとめ
  const selectedSpots = DRIVE_SPOTS.filter((s) => getDriveState(s.id).selected);
  const selectedCard = document.getElementById("drive-selected");
  const selectedList = document.getElementById("drive-selected-list");
  if (selectedSpots.length) {
    selectedCard.style.display = "";
    selectedList.innerHTML = selectedSpots.map((s) => `<li>${s.name}<span class="muted">(${s.area})</span></li>`).join("");
  } else {
    selectedCard.style.display = "none";
  }

  // スポット一覧
  const el = document.getElementById("drive-list");
  const spotsToShow = filterOnly ? selectedSpots : DRIVE_SPOTS;

  let html = "";
  let lastArea = null;
  spotsToShow.forEach((spot) => {
    const ds = getDriveState(spot.id);
    if (spot.area !== lastArea) {
      html += `<h3 class="drive-area-heading">${spot.area}</h3>`;
      lastArea = spot.area;
    }
    html += `
      <div class="drive-spot ${ds.selected ? "selected" : ""}">
        <div class="drive-spot-header">
          <label class="drive-checkbox">
            <input type="checkbox" data-id="${spot.id}" data-field="selected" ${ds.selected ? "checked" : ""}>
            行く
          </label>
          <h3>${spot.name}</h3>
          <a class="maps-link" href="${googleMapsUrl(spot.name)}" target="_blank" rel="noopener">Google Mapsで見る</a>
        </div>
        <p class="drive-desc">${spot.desc}</p>
        <textarea class="drive-memo" data-id="${spot.id}" data-field="memo" placeholder="メモ(訪問順・営業時間・予約状況など)">${ds.memo}</textarea>
      </div>
    `;
  });

  if (filterOnly && spotsToShow.length === 0) {
    html = `<p class="muted">まだ「行く」を選択したスポットがありません。</p>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      setDriveState(e.target.dataset.id, e.target.dataset.field, e.target.checked);
    });
  });

  el.querySelectorAll("textarea").forEach((ta) => {
    ta.addEventListener("input", (e) => {
      setDriveState(e.target.dataset.id, e.target.dataset.field, e.target.value);
    });
  });
}

document.getElementById("drive-filter").addEventListener("change", renderDrive);

// ---------- メモ・候補地 ----------
function renderTodo() {
  const el = document.getElementById("todo-list");
  el.innerHTML = TODO_LIST.map((item) => {
    const isChecked = !!state.todo[item.id];
    return `
      <div class="todo-item ${isChecked ? "checked" : ""}">
        <input type="checkbox" id="todo-${item.id}" data-id="${item.id}" ${isChecked ? "checked" : ""}>
        <label for="todo-${item.id}">${item.text}</label>
      </div>
    `;
  }).join("");

  el.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      state.todo[e.target.dataset.id] = e.target.checked;
      saveState(state);
      renderTodo();
    });
  });
}

function renderInsurance() {
  const el = document.getElementById("insurance-info");
  if (!el) return;
  el.innerHTML = `
    <p class="muted">${INSURANCE_INFO.note}</p>
    ${INSURANCE_INFO.cards.map((c) => `
      <div class="insurance-card">
        <h3>${c.name} <span class="insurance-attach">${c.attach}</span></h3>
        <table class="insurance-table">
          <tbody>
            ${c.rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}
          </tbody>
        </table>
        <p class="muted insurance-extra">${c.extra}</p>
      </div>
    `).join("")}
    <div class="insurance-trip"><strong>このハワイ旅行では:</strong> ${INSURANCE_INFO.forThisTrip}</div>
    <p class="muted insurance-disclaimer">※${INSURANCE_INFO.disclaimer}</p>
  `;
}

function renderHotelInfo() {
  const el = document.getElementById("hotel-info");
  el.innerHTML = `
    <h3>${HOTEL_INFO.name}</h3>
    <ul>${HOTEL_INFO.details.map((t) => `<li>${t}</li>`).join("")}</ul>
    <h3>客室設備</h3>
    <ul class="muted">${HOTEL_INFO.rooms.map((t) => `<li>${t}</li>`).join("")}</ul>
    <h3>施設・サービス</h3>
    <ul class="muted">${HOTEL_INFO.facilities.map((t) => `<li>${t}</li>`).join("")}</ul>
  `;
}

function renderSpots() {
  const el = document.getElementById("spots-list");
  el.innerHTML = SPOTS.map((s) => `
    <div class="spot">
      <h3>${s.name}</h3>
      <p>${s.desc}</p>
    </div>
  `).join("");
}

function renderSources() {
  const el = document.getElementById("sources-list");
  el.innerHTML = SOURCES.map((s) => `<li>${s}</li>`).join("");
}

// ---------- テーマ(ダークモード)切替 ----------
function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  // 地図のタイル色味はそのままだが、再描画時のサイズ補正のため
  if (driveMap) setTimeout(() => driveMap.invalidateSize(), 0);
}

(function initTheme() {
  const saved = state.theme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(saved);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    state.theme = next;
    saveState(state);
    applyTheme(next);
  });
})();

// ---------- 出発カウントダウン ----------
(function renderCountdown() {
  const el = document.getElementById("countdown");
  if (!el) return;
  const start = new Date(2026, 8, 7); // 9/7
  const end = new Date(2026, 8, 11, 23, 59); // 9/11
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  if (today < start) {
    const days = Math.round((start - today) / dayMs);
    el.textContent = days === 0 ? "✈️ いよいよ明日出発!" : `✈️ 出発まで あと ${days} 日`;
  } else if (now <= end) {
    const n = Math.floor((today - start) / dayMs) + 1;
    el.textContent = `🌺 旅行中 ・ ${n}日目`;
  } else {
    el.textContent = "おかえりなさい 🌴";
  }
})();

// ---------- 初期描画 ----------
function renderAll() {
  renderOverview();
  renderItinerary();
  renderSummary();
  renderBudget();
  renderPacking();
  renderDrive();
  renderTodo();
  renderInsurance();
  renderHotelInfo();
  renderSpots();
  renderSources();
}

renderAll();
initPackingAddForm();

// Firestore リアルタイム同期
// hasPendingWrites=true は自分の書き込みのローカル反映なのでスキップ
// 自分の保存直後3秒以内のサーバー確認もスキップ(textarea入力中の再描画防止)
onSnapshot(TRIP_DOC, (snap) => {
  if (snap.metadata.hasPendingWrites) return;
  if (Date.now() - lastSaveTime < 3000) return;
  if (!snap.exists()) return;
  const d = snap.data();
  state.packing = d.packing || {};
  state.todo = d.todo || {};
  state.budget = d.budget || {};
  state.drive = d.drive || {};
  state.customPacking = d.customPacking || [];
  state.packingDeleted = d.packingDeleted || [];
  state.packingText = d.packingText || {};
  state.packingOrder = d.packingOrder || {};
  state.packingBought = d.packingBought || {};
  if (d.theme && d.theme !== state.theme) {
    state.theme = d.theme;
    applyTheme(d.theme);
  }
  renderAll();
});
