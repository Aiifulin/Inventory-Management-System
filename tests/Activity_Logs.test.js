import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    saveLogsCache,
    loadLogsCache,
    fetchAndCacheLogs,
    applyFilterAndRender,
    renderPage,
    initLogs
} from "../public/js/Activity_Logs.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const { mockGetDocs, mockGetDoc, mockDoc, mockCollection, mockQuery, mockOrderBy, mockLimit } = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockGetDoc:  vi.fn(),
    mockDoc:     vi.fn(() => ({})),
    mockCollection: vi.fn(() => ({})),
    mockQuery:   vi.fn(),
    mockOrderBy: vi.fn(),
    mockLimit:   vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    collection: mockCollection,
    query:      mockQuery,
    orderBy:    mockOrderBy,
    limit:      mockLimit,
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
    auth:    {},
    db:      {},
    storage: {}
}));

global.localStorage = {
    store: {},
    getItem:    vi.fn(function(key)        { return this.store[key] ?? null; }),
    setItem:    vi.fn(function(key, value) { this.store[key] = value; }),
    removeItem: vi.fn(function(key)        { delete this.store[key]; }),
    clear:      vi.fn(function()           { this.store = {}; })
};

global.sessionStorage = {
    store: {},
    getItem:    vi.fn(function(key)        { return this.store[key] ?? null; }),
    setItem:    vi.fn(function(key, value) { this.store[key] = value; }),
    removeItem: vi.fn(function(key)        { delete this.store[key]; }),
    clear:      vi.fn(function()           { this.store = {}; })
};

global.document = {
    getElementById: vi.fn(() => ({
        value: '', textContent: '', style: {}, classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
        disabled: false, addEventListener: vi.fn()
    })),
    querySelector:    vi.fn(() => ({ addEventListener: vi.fn(), style: {}, classList: { toggle: vi.fn() } })),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn()
};

// ==========================================
// TEST SUITES
// ==========================================

describe("Activity Logs — Cache Helpers", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    describe("saveLogsCache", () => {
        it("should save logs to localStorage", () => {
            const logs = [{ id: "1", action: "Added Product", target: "Chair", user: "admin@test.com", timestamp: null }];
            saveLogsCache(logs);
            expect(localStorage.setItem).toHaveBeenCalledWith(
                'activity_logs_cache',
                expect.stringContaining("Added Product")
            );
        });

        it("should include cachedAt timestamp", () => {
            saveLogsCache([]);
            const call = localStorage.setItem.mock.calls[0][1];
            const parsed = JSON.parse(call);
            expect(parsed.cachedAt).toBeDefined();
            expect(typeof parsed.cachedAt).toBe("number");
        });
    });

    describe("loadLogsCache", () => {
        it("should return logs if cache is fresh", () => {
            const logs = [{ id: "1", action: "Test", target: "X", user: "u", timestamp: null }];
            localStorage.getItem.mockReturnValue(JSON.stringify({ logs, cachedAt: Date.now() }));
            const result = loadLogsCache();
            expect(result).toEqual(logs);
        });

        it("should return null if cache is expired", () => {
            const logs = [{ id: "1", action: "Test", target: "X", user: "u", timestamp: null }];
            const expiredTime = Date.now() - (6 * 60 * 1000); // 6 minutes ago
            localStorage.getItem.mockReturnValue(JSON.stringify({ logs, cachedAt: expiredTime }));
            expect(loadLogsCache()).toBeNull();
        });

        it("should return null if nothing in cache", () => {
            localStorage.getItem.mockReturnValue(null);
            expect(loadLogsCache()).toBeNull();
        });

        it("should return null if cache JSON is malformed", () => {
            localStorage.getItem.mockReturnValue("not-valid-json{{");
            expect(loadLogsCache()).toBeNull();
        });
    });
});

describe("Activity Logs — getCachedUserData", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it("should return cached data from sessionStorage", async () => {
        const mockUser = { role: "admin", name: "Alice" };
        sessionStorage.getItem.mockReturnValue(JSON.stringify(mockUser));
        const result = await getCachedUserData("uid-1");
        expect(result).toEqual(mockUser);
        expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it("should fetch from Firestore if not cached", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({ role: "admin", name: "Alice" })
        });
        const result = await getCachedUserData("uid-1");
        expect(result).toEqual({ role: "admin", name: "Alice" });
        expect(sessionStorage.setItem).toHaveBeenCalled();
    });

    it("should return null if user document does not exist", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({ exists: () => false });
        const result = await getCachedUserData("uid-1");
        expect(result).toBeNull();
    });

    it("should return null if Firestore throws", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockRejectedValue(new Error("Network error"));
        const result = await getCachedUserData("uid-1");
        expect(result).toBeNull();
    });
});

describe("Activity Logs — fetchAndCacheLogs", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it("should fetch logs and save to cache", async () => {
        const mockDocs = [
            {
                id:   "log1",
                data: () => ({
                    action:    "Added Product",
                    target:    "Chair",
                    user:      "admin@test.com",
                    timestamp: { toDate: () => new Date("2024-01-15T10:00:00Z") }
                })
            }
        ];
        mockGetDocs.mockResolvedValue({ forEach: (cb) => mockDocs.forEach(cb) });

        await fetchAndCacheLogs();

        expect(mockGetDocs).toHaveBeenCalled();
        expect(localStorage.setItem).toHaveBeenCalledWith(
            'activity_logs_cache',
            expect.stringContaining("Added Product")
        );
    });

    it("should handle null timestamps gracefully", async () => {
        const mockDocs = [{ id: "log1", data: () => ({ action: "Test", target: "X", user: "u", timestamp: null }) }];
        mockGetDocs.mockResolvedValue({ forEach: (cb) => mockDocs.forEach(cb) });
        await expect(fetchAndCacheLogs()).resolves.not.toThrow();
    });

    it("should default missing fields", async () => {
        const mockDocs = [{ id: "log1", data: () => ({}) }];
        mockGetDocs.mockResolvedValue({ forEach: (cb) => mockDocs.forEach(cb) });
        await fetchAndCacheLogs();
        expect(localStorage.setItem).toHaveBeenCalledWith(
            'activity_logs_cache',
            expect.stringContaining('"user":"Admin"')
        );
    });

    it("should not throw when Firestore fails", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(fetchAndCacheLogs()).resolves.not.toThrow();
    });
});

describe("Activity Logs — initLogs", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it("should use cache if available and not force refresh", async () => {
        const logs = [{ id: "1", action: "Cached", target: "X", user: "u", timestamp: null }];
        localStorage.getItem.mockReturnValue(JSON.stringify({ logs, cachedAt: Date.now() }));

        await initLogs(false);

        expect(mockGetDocs).not.toHaveBeenCalled();
    });

    it("should fetch from Firestore when forceRefresh is true", async () => {
        mockGetDocs.mockResolvedValue({ forEach: () => {} });
        await initLogs(true);
        expect(mockGetDocs).toHaveBeenCalled();
    });

    it("should fetch from Firestore when cache is empty", async () => {
        localStorage.getItem.mockReturnValue(null);
        mockGetDocs.mockResolvedValue({ forEach: () => {} });
        await initLogs(false);
        expect(mockGetDocs).toHaveBeenCalled();
    });
});