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

let firestoreRefs = null;
let ensurePromise = null;
let usingFallback = !configReady;

if (!configReady) {
  console.info("Firebase 配置未设置，使用本地演示数据运行。请在 js/cloud-database.js 中填写配置。");
}

async function ensureFirestore() {
  if (!configReady) {
    usingFallback = true;
    return null;
  }
  if (firestoreRefs) {
    return firestoreRefs;
  }
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        const [appModule, firestoreModule] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js")
        ]);
        const app = appModule.initializeApp(firebaseConfig);
        const db = firestoreModule.getFirestore(app);
        firestoreRefs = {
          db,
          ...firestoreModule
        };
        usingFallback = false;
        return firestoreRefs;
      } catch (error) {
        console.warn("未能初始化 Firebase，已回退至本地演示数据。", error);
        firestoreRefs = null;
        usingFallback = true;
        return null;
      } finally {
        ensurePromise = null;
      }
    })();
  }
  return ensurePromise;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (error) {
      console.warn("无法转换时间戳", error);
    }
  }
  return null;
}

async function withFirestore(task, fallback, errorMessage = "云数据库访问失败，使用演示数据。") {
  const refs = await ensureFirestore();
  if (!refs) {
    usingFallback = true;
    return clone(fallback);
  }
  try {
    const result = await task(refs);
    usingFallback = false;
    return result;
  } catch (error) {
    console.warn(errorMessage, error);
    usingFallback = true;
    return clone(fallback);
  }
}

function createSubscription(callback, fallback, subscribeFactory, errorMessage) {
  if (typeof callback !== "function") {
    return () => {};
  }
  let unsubscribe = null;
  let active = true;

  const emitFallback = () => {
    if (!active) return;
    usingFallback = true;
    callback(clone(fallback));
  };

  const handleError = (error) => {
    if (errorMessage) {
      console.warn(errorMessage, error);
    }
    emitFallback();
  };

  ensureFirestore().then((refs) => {
    if (!active) return;
    if (!refs) {
      emitFallback();
      return;
    }
    try {
      const unsub = subscribeFactory(refs, callback, handleError);
      if (typeof unsub === "function") {
        unsubscribe = unsub;
      }
    } catch (error) {
      handleError(error);
    }
  });

  if (!configReady) {
    emitFallback();
  }

  return () => {
    active = false;
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  };
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
  return withFirestore(
    async ({ db, collection, getDocs }) => {
      const snap = await getDocs(collection(db, "monitoringSites"));
      return snap.docs.map(toMonitoringSite);
    },
    fallbackData.monitoringSites,
    "监测点获取失败，使用演示数据。"
  );
}

export function subscribeMonitoringSites(callback) {
  return createSubscription(
    callback,
    fallbackData.monitoringSites,
    ({ db, collection, onSnapshot }, next, handleError) =>
      onSnapshot(
        collection(db, "monitoringSites"),
        (snapshot) => {
          usingFallback = false;
          next(snapshot.docs.map(toMonitoringSite));
        },
        handleError
      ),
    "监测点订阅失败，使用演示数据。"
  );
}

export async function fetchRiskAreas() {
  return withFirestore(
    async ({ db, collection, getDocs }) => {
      const snap = await getDocs(collection(db, "riskAreas"));
      return snap.docs.map(toRiskArea);
    },
    fallbackData.riskAreas,
    "风险区域获取失败，使用演示数据。"
  );
}

export function subscribeRiskAreas(callback) {
  return createSubscription(
    callback,
    fallbackData.riskAreas,
    ({ db, collection, onSnapshot }, next, handleError) =>
      onSnapshot(
        collection(db, "riskAreas"),
        (snapshot) => {
          usingFallback = false;
          next(snapshot.docs.map(toRiskArea));
        },
        handleError
      ),
    "风险区域订阅失败，使用演示数据。"
  );
}

export async function fetchDashboardStats() {
  return withFirestore(
    async ({ db, doc, getDoc }) => {
      const snap = await getDoc(doc(db, "dashboard", "status"));
      if (!snap.exists()) return clone(fallbackData.dashboardStats);
      const data = snap.data();
      return {
        monitoring: Number(data?.monitoring ?? data?.monitoringCount ?? 0),
        warning: Number(data?.warning ?? data?.warningCount ?? 0),
        safe: Number(data?.safe ?? data?.safeCount ?? 0)
      };
    },
    fallbackData.dashboardStats,
    "仪表盘统计获取失败，使用演示数据。"
  );
}

export function subscribeDashboardStats(callback) {
  return createSubscription(
    callback,
    fallbackData.dashboardStats,
    ({ db, doc, onSnapshot }, next, handleError) =>
      onSnapshot(
        doc(db, "dashboard", "status"),
        (snapshot) => {
          if (!snapshot.exists()) {
            usingFallback = true;
            next(clone(fallbackData.dashboardStats));
            return;
          }
          usingFallback = false;
          const data = snapshot.data();
          next({
            monitoring: Number(data?.monitoring ?? data?.monitoringCount ?? 0),
            warning: Number(data?.warning ?? data?.warningCount ?? 0),
            safe: Number(data?.safe ?? data?.safeCount ?? 0)
          });
        },
        handleError
      ),
    "仪表盘统计订阅失败，使用演示数据。"
  );
}

export async function fetchWarningStats() {
  return withFirestore(
    async ({ db, doc, getDoc }) => {
      const snap = await getDoc(doc(db, "dashboard", "warningStats"));
      if (!snap.exists()) return clone(fallbackData.warningStats);
      const data = snap.data();
      return {
        highRisk: Number(data?.highRisk ?? data?.high ?? 0),
        mediumRisk: Number(data?.mediumRisk ?? data?.medium ?? 0),
        lowRisk: Number(data?.lowRisk ?? data?.low ?? 0),
        timelyRate: Number(data?.timelyRate ?? data?.timely ?? 0)
      };
    },
    fallbackData.warningStats,
    "预警统计获取失败，使用演示数据。"
  );
}

export function subscribeWarningStats(callback) {
  return createSubscription(
    callback,
    fallbackData.warningStats,
    ({ db, doc, onSnapshot }, next, handleError) =>
      onSnapshot(
        doc(db, "dashboard", "warningStats"),
        (snapshot) => {
          if (!snapshot.exists()) {
            usingFallback = true;
            next(clone(fallbackData.warningStats));
            return;
          }
          usingFallback = false;
          const data = snapshot.data();
          next({
            highRisk: Number(data?.highRisk ?? data?.high ?? 0),
            mediumRisk: Number(data?.mediumRisk ?? data?.medium ?? 0),
            lowRisk: Number(data?.lowRisk ?? data?.low ?? 0),
            timelyRate: Number(data?.timelyRate ?? data?.timely ?? 0)
          });
        },
        handleError
      ),
    "预警统计订阅失败，使用演示数据。"
  );
}

export async function fetchWarningEvents(limitCount = 20) {
  return withFirestore(
    async ({ db, collection, getDocs, limit, orderBy, query }) => {
      const q = query(
        collection(db, "warnings"),
        orderBy("issuedAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(toWarning);
    },
    fallbackData.warnings,
    "预警事件获取失败，使用演示数据。"
  );
}

export function subscribeWarningEvents(callback, limitCount = 20) {
  return createSubscription(
    callback,
    fallbackData.warnings,
    ({ db, collection, limit, onSnapshot, orderBy, query }, next, handleError) => {
      const q = query(
        collection(db, "warnings"),
        orderBy("issuedAt", "desc"),
        limit(limitCount)
      );
      return onSnapshot(
        q,
        (snapshot) => {
          usingFallback = false;
          next(snapshot.docs.map(toWarning));
        },
        handleError
      );
    },
    "预警事件订阅失败，使用演示数据。"
  );
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
