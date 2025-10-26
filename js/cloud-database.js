import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

const fallbackData = {
  monitoringSites: [
    { id: "wuping", name: "武平监测点", lon: 116.1, lat: 25.1 },
    { id: "taishun", name: "泰顺监测点", lon: 119.72, lat: 27.56 }
  ],
  riskAreas: [
    {
      id: "wuping-risk",
      name: "武平暴雨滑坡预警区",
      lon: 116.1,
      lat: 25.1,
      radius: 15000,
      level: "high"
    },
    {
      id: "taishun-risk",
      name: "泰顺滑坡潜势区",
      lon: 119.72,
      lat: 27.56,
      radius: 15000,
      level: "medium"
    }
  ],
  dashboardStats: {
    monitoring: 1203,
    warning: 3,
    safe: 152
  },
  warningStats: {
    highRisk: 3,
    mediumRisk: 8,
    lowRisk: 12,
    timelyRate: 98.5
  },
  warnings: [
    {
      id: "W001",
      title: "福建武平滑坡预警",
      level: "high",
      area: "福建省龙岩市武平县象洞镇",
      rainfall: 156,
      soilMoisture: 85,
      slope: 45,
      issuedAt: "2024-01-15T14:30:25+08:00",
      description: "连续强降雨导致土体含水率飙升，建议立即疏散受影响村落并开启应急巡查。"
    },
    {
      id: "W002",
      title: "浙江泰顺地质预警",
      level: "medium",
      area: "浙江省温州市泰顺县司前畲族镇",
      rainfall: 89,
      soilMoisture: 68,
      slope: 38,
      issuedAt: "2024-01-15T13:45:12+08:00",
      description: "雨势减弱但坡面仍处于塑性滑移阶段，需保持监测并准备交通管控。"
    },
    {
      id: "W003",
      title: "江西铅山山体滑坡预警",
      level: "low",
      area: "江西省上饶市铅山县葛仙山乡",
      rainfall: 62,
      soilMoisture: 54,
      slope: 32,
      issuedAt: "2024-01-15T12:58:47+08:00",
      description: "短时强降雨后趋势逐渐稳定，建议保持巡检并预置挡墙加固队伍。"
    }
  ]
};

const requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];

function isPlaceholder(value) {
  return typeof value === "string" && value.startsWith("YOUR_");
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

const configReady = requiredKeys.every((key) => {
  const value = firebaseConfig[key];
  return typeof value === "string" && value.trim() !== "" && !isPlaceholder(value);
});

let db = null;
let usingFallback = !configReady;

if (configReady) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    usingFallback = false;
  } catch (error) {
    console.warn("未能初始化 Firebase，已回退至本地演示数据。", error);
    db = null;
    usingFallback = true;
  }
} else {
  console.info("Firebase 配置未设置，使用本地演示数据运行。请在 js/cloud-database.js 中填写配置。");
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (error) {
      console.warn("无法转换时间戳", error);
    }
  }
  return null;
}

async function withFallback(asyncTask, fallback) {
  if (!db) {
    usingFallback = true;
    return clone(fallback);
  }
  try {
    const result = await asyncTask();
    usingFallback = false;
    return result;
  } catch (error) {
    console.warn("云数据库访问失败，回退至本地演示数据。", error);
    usingFallback = true;
    return clone(fallback);
  }
}

function toMonitoringSite(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    name: data?.name ?? "未知监测点",
    lon: Number(data?.lon ?? data?.longitude ?? 0),
    lat: Number(data?.lat ?? data?.latitude ?? 0)
  };
}

function toRiskArea(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    name: data?.name ?? "风险区域",
    lon: Number(data?.lon ?? data?.longitude ?? 0),
    lat: Number(data?.lat ?? data?.latitude ?? 0),
    radius: Number(data?.radius ?? 1000),
    level: data?.level ?? "medium"
  };
}

function toWarning(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    title: data?.title ?? "未命名预警",
    level: data?.level ?? "low",
    area: data?.area ?? data?.location ?? "",
    rainfall: data?.rainfall ?? null,
    soilMoisture: data?.soilMoisture ?? null,
    slope: data?.slope ?? null,
    issuedAt: normalizeTimestamp(data?.issuedAt) ?? new Date().toISOString(),
    description: data?.description ?? data?.summary ?? ""
  };
}

export async function fetchMonitoringSites() {
  return withFallback(async () => {
    const snap = await getDocs(collection(db, "monitoringSites"));
    return snap.docs.map(toMonitoringSite);
  }, fallbackData.monitoringSites);
}

export function subscribeMonitoringSites(callback) {
  if (!db) {
    callback(clone(fallbackData.monitoringSites));
    usingFallback = true;
    return () => {};
  }
  const unsubscribe = onSnapshot(
    collection(db, "monitoringSites"),
    (snapshot) => {
      usingFallback = false;
      callback(snapshot.docs.map(toMonitoringSite));
    },
    (error) => {
      console.warn("监测点订阅失败，使用演示数据。", error);
      usingFallback = true;
      callback(clone(fallbackData.monitoringSites));
    }
  );
  return unsubscribe;
}

export async function fetchRiskAreas() {
  return withFallback(async () => {
    const snap = await getDocs(collection(db, "riskAreas"));
    return snap.docs.map(toRiskArea);
  }, fallbackData.riskAreas);
}

export function subscribeRiskAreas(callback) {
  if (!db) {
    callback(clone(fallbackData.riskAreas));
    usingFallback = true;
    return () => {};
  }
  const unsubscribe = onSnapshot(
    collection(db, "riskAreas"),
    (snapshot) => {
      usingFallback = false;
      callback(snapshot.docs.map(toRiskArea));
    },
    (error) => {
      console.warn("风险区域订阅失败，使用演示数据。", error);
      usingFallback = true;
      callback(clone(fallbackData.riskAreas));
    }
  );
  return unsubscribe;
}

export async function fetchDashboardStats() {
  return withFallback(async () => {
    const snap = await getDoc(doc(db, "dashboard", "status"));
    if (!snap.exists()) return clone(fallbackData.dashboardStats);
    const data = snap.data();
    return {
      monitoring: Number(data?.monitoring ?? data?.monitoringCount ?? 0),
      warning: Number(data?.warning ?? data?.warningCount ?? 0),
      safe: Number(data?.safe ?? data?.safeCount ?? 0)
    };
  }, fallbackData.dashboardStats);
}

export function subscribeDashboardStats(callback) {
  if (!db) {
    callback(clone(fallbackData.dashboardStats));
    usingFallback = true;
    return () => {};
  }
  const unsubscribe = onSnapshot(
    doc(db, "dashboard", "status"),
    (snapshot) => {
      usingFallback = false;
      if (!snapshot.exists()) {
        callback(clone(fallbackData.dashboardStats));
        return;
      }
      const data = snapshot.data();
      callback({
        monitoring: Number(data?.monitoring ?? data?.monitoringCount ?? 0),
        warning: Number(data?.warning ?? data?.warningCount ?? 0),
        safe: Number(data?.safe ?? data?.safeCount ?? 0)
      });
    },
    (error) => {
      console.warn("仪表盘统计订阅失败，使用演示数据。", error);
      usingFallback = true;
      callback(clone(fallbackData.dashboardStats));
    }
  );
  return unsubscribe;
}

export async function fetchWarningStats() {
  return withFallback(async () => {
    const snap = await getDoc(doc(db, "dashboard", "warningStats"));
    if (!snap.exists()) return clone(fallbackData.warningStats);
    const data = snap.data();
    return {
      highRisk: Number(data?.highRisk ?? data?.high ?? 0),
      mediumRisk: Number(data?.mediumRisk ?? data?.medium ?? 0),
      lowRisk: Number(data?.lowRisk ?? data?.low ?? 0),
      timelyRate: Number(data?.timelyRate ?? data?.timely ?? 0)
    };
  }, fallbackData.warningStats);
}

export function subscribeWarningStats(callback) {
  if (!db) {
    callback(clone(fallbackData.warningStats));
    usingFallback = true;
    return () => {};
  }
  const unsubscribe = onSnapshot(
    doc(db, "dashboard", "warningStats"),
    (snapshot) => {
      usingFallback = false;
      if (!snapshot.exists()) {
        callback(clone(fallbackData.warningStats));
        return;
      }
      const data = snapshot.data();
      callback({
        highRisk: Number(data?.highRisk ?? data?.high ?? 0),
        mediumRisk: Number(data?.mediumRisk ?? data?.medium ?? 0),
        lowRisk: Number(data?.lowRisk ?? data?.low ?? 0),
        timelyRate: Number(data?.timelyRate ?? data?.timely ?? 0)
      });
    },
    (error) => {
      console.warn("预警统计订阅失败，使用演示数据。", error);
      usingFallback = true;
      callback(clone(fallbackData.warningStats));
    }
  );
  return unsubscribe;
}

export async function fetchWarningEvents(limitCount = 20) {
  return withFallback(async () => {
    const q = query(
      collection(db, "warnings"),
      orderBy("issuedAt", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(toWarning);
  }, fallbackData.warnings);
}

export function subscribeWarningEvents(callback, limitCount = 20) {
  if (!db) {
    callback(clone(fallbackData.warnings));
    usingFallback = true;
    return () => {};
  }
  const q = query(
    collection(db, "warnings"),
    orderBy("issuedAt", "desc"),
    limit(limitCount)
  );
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      usingFallback = false;
      callback(snapshot.docs.map(toWarning));
    },
    (error) => {
      console.warn("预警事件订阅失败，使用演示数据。", error);
      usingFallback = true;
      callback(clone(fallbackData.warnings));
    }
  );
  return unsubscribe;
}

export function getCloudStatus() {
  return {
    configured: configReady,
    usingFallback
  };
}

export function getFallbackData() {
  return clone(fallbackData);
}
