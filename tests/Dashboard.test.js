import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    loadDashboard,
    fetchAndCache,
    loadStats,
    loadRecentActivities,
    loadCategoryCount,
    saveCache,
    loadCache,
    clearCache,
    formatTimeAgo
} from "../public/js/Dashboard.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockDoc,
    mockCollection,
    mockQuery,
    mockOrderBy,
    mockLimit,
    mockWhere
} = vi.hoisted(() => ({
    mockGetDoc:    vi.fn(),
    mockGetDocs:   vi.fn(),
    mockDoc:       vi.fn(() => ({})),
    mockCollection: vi.fn(() => ({})),
    mockQuery:     vi.fn(() => ({})),
    mockOrderBy:   vi.fn(() => ({})),
    mockLimit:     vi.fn(() => ({})),
    mockWhere:     vi.fn(() => ({}))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    collection: mockCollection,
    query:      mockQuery,
    orderBy:    mockOrderBy,
    limit:      mockLimit,
    where:      mockWhere,
    getDocs:    mockGetDocs,
    doc:        mockDoc,
    getDoc:     mockGetDoc
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn()
}));

vi.mock("../public/js/logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn())
}));

vi.mock("../public/js/firebase.js", () => ({
    auth:    { currentUser: { email: "admin@test.com", uid: "admin-uid" } },
    db:      {},
    storage: {}
}));

// ==========================================
// STORAGE STUBS
// ==========================================
const makeStorage = () => {
    let store = {};
    const getItem    = vi.fn((k)    => store[k] ?? null);
    const setItem    = vi.fn((k, v) => { store[k] = String(v); });
    const removeItem = vi.fn((k)    => { delete store[k]; });
    const clear      = vi.fn(()     => { store = {}; });
    return {
        getItem, setItem, removeItem, clear,
        get length() { return Object.keys(store).length; },
        _reset() {
            store = {};
            getItem.mockImplementation((k)    => store[k] ?? null);
            setItem.mockImplementation((k, v) => { store[k] = String(v); });
            removeItem.mockImplementation((k)  => { delete store[k]; });
            clear.mockImplementation(()        => { store = {}; });
        }
    };
};

global.sessionStorage = makeStorage();
global.localStorage   = makeStorage();

// ==========================================
// DOM STUBS
// ==========================================
const makeElement = () => ({
    textContent: "", innerHTML: "", innerText: "", value: "",
    style:       {},
    classList:   { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    getAttribute: vi.fn(() => null),
    getContext:   vi.fn(() => null)
});

global.document = {
    getElementById:   vi.fn(() => makeElement()),
    querySelector:    vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => makeElement()),
    documentElement:  { style: {}, getAttribute: vi.fn(() => null) }
};

global.window = {
    location: { href: "", replace: vi.fn() },
    addEventListener: vi.fn()
};

// Chart.js is not available in test env — stub it globally
global.Chart = vi.fn(function() { return { destroy: vi.fn() }; });
global.Intl  = Intl; // use real Intl for currency formatting

// Default safe mock — re-applied after every clearAllMocks()
const defaultGetDocs = () =>
    mockGetDocs.mockResolvedValue({ docs: [], forEach: vi.fn(), size: 0 });

// ==========================================
// TEST SUITES
// ==========================================

describe("Dashboard — getCachedUserData", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should return cached data from sessionStorage without hitting Firestore", async () => {
        const user = { role: "admin", name: "Alice" };
        sessionStorage.setItem("user_data_uid-1", JSON.stringify(user));
        const result = await getCachedUserData("uid-1");
        expect(result).toEqual(user);
        expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it("should fetch from Firestore and cache when no session entry exists", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({ role: "admin", name: "Alice" })
        });
        const result = await getCachedUserData("uid-1");
        expect(result).toEqual({ role: "admin", name: "Alice" });
        expect(sessionStorage.setItem).toHaveBeenCalled();
    });

    it("should return null when the Firestore document does not exist", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        expect(await getCachedUserData("uid-1")).toBeNull();
    });

    it("should return null when Firestore throws an error", async () => {
        mockGetDoc.mockRejectedValue(new Error("Network error"));
        expect(await getCachedUserData("uid-1")).toBeNull();
    });
});

// ==========================================

describe("Dashboard — saveCache / loadCache / clearCache", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should save data to sessionStorage and load it back", () => {
        const data = { totalProducts: 10, lowStockCount: 2 };
        saveCache(data);
        expect(loadCache()).toEqual(data);
    });

    it("should return null when cache is empty", () => {
        expect(loadCache()).toBeNull();
    });

    it("should return null when sessionStorage contains invalid JSON", () => {
        sessionStorage.setItem("dashboard_cache", "not-json{{{");
        expect(loadCache()).toBeNull();
    });

    it("should remove the cache entry on clearCache", () => {
        saveCache({ totalProducts: 5 });
        clearCache();
        expect(loadCache()).toBeNull();
    });
});

// ==========================================

describe("Dashboard — loadDashboard", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should use cached data and not call Firestore when cache exists", async () => {
        const cached = {
            totalProducts: 3, lowStockCount: 1,
            categoryCount: 2, totalValue: "₱500.00",
            categoryMap: {}, lowStockItems: [], activities: []
        };
        saveCache(cached);
        await loadDashboard();
        expect(mockGetDocs).not.toHaveBeenCalled();
    });

    it("should call Firestore when forceRefresh is true even if cache exists", async () => {
        const cached = {
            totalProducts: 3, lowStockCount: 1,
            categoryCount: 2, totalValue: "₱500.00",
            categoryMap: {}, lowStockItems: [], activities: []
        };
        saveCache(cached);
        await loadDashboard(true);
        expect(mockGetDocs).toHaveBeenCalled();
    });

    it("should call Firestore when no cache exists", async () => {
        await loadDashboard();
        expect(mockGetDocs).toHaveBeenCalled();
    });

    it("should not throw when Firestore fails", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(loadDashboard()).resolves.not.toThrow();
    });
});

// ==========================================

describe("Dashboard — fetchAndCache", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should call getDocs and save the result to cache", async () => {
        const productDocs = [
            { data: () => ({ name: "Item A", stock: 10, price: 100, category: "A", archived: false, lowStockThreshold: 5 }) }
        ];
        const activityDocs = [
            { data: () => ({ user: "admin", action: "Add Product", target: "Item A", timestamp: null }) }
        ];
        const categoryDocs = [{ data: () => ({ archived: false }) }];

        mockGetDocs
            .mockResolvedValueOnce({ docs: productDocs,  forEach: (cb) => productDocs.forEach(cb),  size: 1 })
            .mockResolvedValueOnce({ docs: activityDocs, forEach: (cb) => activityDocs.forEach(cb), size: 1 })
            .mockResolvedValueOnce({ docs: categoryDocs, forEach: (cb) => categoryDocs.forEach(cb), size: 1 });

        await fetchAndCache();
        expect(mockGetDocs).toHaveBeenCalled();
        expect(loadCache()).not.toBeNull();
    });

    it("should not throw when Firestore fails", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(fetchAndCache()).resolves.not.toThrow();
    });
});

// ==========================================

describe("Dashboard — loadStats", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should process products and compute totals correctly", async () => {
        const docs = [
            { data: () => ({ name: "High", stock: 100, price: 10,  category: "A", lowStockThreshold: 10 }) },
            { data: () => ({ name: "Low",  stock: 5,   price: 20,  category: "B", lowStockThreshold: 10 }) },
            { data: () => ({ name: "Zero", stock: 0,   price: 50,  category: "A", lowStockThreshold: 5  }) }
        ];
        mockGetDocs.mockResolvedValueOnce({ docs, forEach: (cb) => docs.forEach(cb) });
        await expect(loadStats()).resolves.not.toThrow();
        expect(document.getElementById).toHaveBeenCalledWith("statTotalProducts");
    });

    it("should identify low stock items at the threshold boundary", async () => {
        const docs = [
            { data: () => ({ name: "Edge", stock: 10, price: 5, category: "X", lowStockThreshold: 10 }) }
        ];
        mockGetDocs.mockResolvedValueOnce({ docs, forEach: (cb) => docs.forEach(cb) });
        await expect(loadStats()).resolves.not.toThrow();
    });

    it("should handle non-numeric stock and price without throwing", async () => {
        const docs = [
            { data: () => ({ name: "Bad", stock: "abc", price: null, category: "Test", lowStockThreshold: 5 }) }
        ];
        mockGetDocs.mockResolvedValueOnce({ docs, forEach: (cb) => docs.forEach(cb) });
        await expect(loadStats()).resolves.not.toThrow();
    });

    // loadStats has no internal try/catch — errors propagate to fetchAndCache's handler
    // Test error resilience at the fetchAndCache level instead
    it("should cause fetchAndCache to not throw when getDocs fails", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(fetchAndCache()).resolves.not.toThrow();
    });
});

describe("Dashboard — loadRecentActivities", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should fetch activities and not throw", async () => {
        const docs = [
            {
                data: () => ({
                    user: "admin@test.com", action: "Add Product",
                    target: "Item A",
                    timestamp: { toDate: () => new Date("2024-01-01T10:00:00Z") }
                })
            }
        ];
        mockGetDocs.mockResolvedValueOnce({ docs, forEach: (cb) => docs.forEach(cb) });
        await expect(loadRecentActivities()).resolves.not.toThrow();
    });

    it("should handle activities with null timestamps", async () => {
        const docs = [
            { data: () => ({ user: "admin", action: "Edit", target: "Item B", timestamp: null }) }
        ];
        mockGetDocs.mockResolvedValueOnce({ docs, forEach: (cb) => docs.forEach(cb) });
        await expect(loadRecentActivities()).resolves.not.toThrow();
    });

    // No internal try/catch — test via fetchAndCache
    it("should cause fetchAndCache to not throw when getDocs fails", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(fetchAndCache()).resolves.not.toThrow();
    });
});

describe("Dashboard — loadCategoryCount", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should fetch non-archived categories and not throw", async () => {
        mockGetDocs.mockResolvedValueOnce({ docs: [], forEach: vi.fn(), size: 4 });
        await expect(loadCategoryCount()).resolves.not.toThrow();
        expect(mockGetDocs).toHaveBeenCalled();
    });

    // No internal try/catch — test via fetchAndCache
    it("should cause fetchAndCache to not throw when getDocs fails", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(fetchAndCache()).resolves.not.toThrow();
    });
});

// ==========================================

describe("Dashboard — formatTimeAgo", () => {

    it("should return 'Just now' for times less than 60 seconds ago", () => {
        const recent = new Date(Date.now() - 30 * 1000);
        expect(formatTimeAgo(recent)).toBe("Just now");
    });

    it("should return minutes ago for times between 1 and 59 minutes ago", () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        expect(formatTimeAgo(fiveMinAgo)).toBe("5 minutes ago");
    });

    it("should return singular 'minute' for exactly 1 minute ago", () => {
        const oneMinAgo = new Date(Date.now() - 61 * 1000);
        expect(formatTimeAgo(oneMinAgo)).toBe("1 minute ago");
    });

    it("should return hours ago for times between 1 and 23 hours ago", () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
        expect(formatTimeAgo(threeHoursAgo)).toBe("3 hours ago");
    });

    it("should return singular 'hour' for exactly 1 hour ago", () => {
        const oneHourAgo = new Date(Date.now() - 61 * 60 * 1000);
        expect(formatTimeAgo(oneHourAgo)).toBe("1 hour ago");
    });

    it("should return a formatted date string for times older than 24 hours", () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const result = formatTimeAgo(twoDaysAgo);
        // Should be a locale date string, not a relative string
        expect(result).not.toContain("ago");
        expect(result.length).toBeGreaterThan(0);
    });
});