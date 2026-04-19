// tests/Stock_Transactions.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    logActivity,
    formatDate,
    escHtml,
    updateSummaryStats,
} from "../public/js/Stock_Transactions.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockAddDoc,
    mockUpdateDoc,
    mockSetDoc,
    mockDeleteDoc,
    mockDoc,
    mockCollection,
    mockQuery,
    mockWhere,
    mockOrderBy,
    mockLimit,
    mockServerTimestamp,
} = vi.hoisted(() => ({
    mockGetDoc:          vi.fn(),
    mockGetDocs:         vi.fn(),
    mockAddDoc:          vi.fn(),
    mockUpdateDoc:       vi.fn(),
    mockSetDoc:          vi.fn(),
    mockDeleteDoc:       vi.fn(),
    mockDoc:             vi.fn(() => ({})),
    mockCollection:      vi.fn(() => ({})),
    mockQuery:           vi.fn(() => ({})),
    mockWhere:           vi.fn(() => ({})),
    mockOrderBy:         vi.fn(() => ({})),
    mockLimit:           vi.fn(() => ({})),
    mockServerTimestamp: vi.fn(() => ({ _seconds: Date.now() / 1000 })),
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    collection:      mockCollection,
    doc:             mockDoc,
    getDoc:          mockGetDoc,
    getDocs:         mockGetDocs,
    addDoc:          mockAddDoc,
    updateDoc:       mockUpdateDoc,
    setDoc:          mockSetDoc,
    deleteDoc:       mockDeleteDoc,
    query:           mockQuery,
    where:           mockWhere,
    orderBy:         mockOrderBy,
    limit:           mockLimit,
    serverTimestamp: mockServerTimestamp,
    Timestamp:       { fromDate: vi.fn() },
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn(),
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js", () => ({
    ref:          vi.fn(() => ({})),
    deleteObject: vi.fn(),
}));

vi.mock("../public/js/logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn()),
}));

vi.mock("../public/js/firebase.js", () => ({
    auth:    { currentUser: { email: "admin@test.com", uid: "admin-uid" } },
    db:      {},
    storage: {},
}));

// ==========================================
// GLOBALS
// ==========================================
global.sessionStorage = {
    store: {},
    getItem:    vi.fn(function (key)        { return this.store[key] ?? null; }),
    setItem:    vi.fn(function (key, value) { this.store[key] = value; }),
    removeItem: vi.fn(function (key)        { delete this.store[key]; }),
    clear:      vi.fn(function ()           { this.store = {}; }),
};

global.localStorage = {
    store: {},
    getItem:    vi.fn(function (key)        { return this.store[key] ?? null; }),
    setItem:    vi.fn(function (key, value) { this.store[key] = value; }),
    removeItem: vi.fn(function (key)        { delete this.store[key]; }),
    clear:      vi.fn(function ()           { this.store = {}; }),
};

const makeFakeEl = () => ({
    textContent:     "",
    innerHTML:       "",
    value:           "",
    style:           {},
    disabled:        false,
    checked:         false,
    tomselect:       null,
    classList:       { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    appendChild:     vi.fn(),
    addEventListener: vi.fn(),
    querySelector:   vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
});

global.document = {
    getElementById:   vi.fn(() => makeFakeEl()),
    querySelector:    vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => makeFakeEl()),
    documentElement:  { style: {}, setAttribute: vi.fn() },
};

global.window = {
    location:         { href: "", replace: vi.fn() },
    addEventListener: vi.fn(),
    scrollTo:         vi.fn(),
};

// ==========================================
// HELPER
// ==========================================
const defaultGetDocsMock = () =>
    mockGetDocs.mockResolvedValue({
        empty: true,
        docs: [],
        forEach: vi.fn(),
    });

// ==========================================
// TEST SUITES
// ==========================================

describe("Stock_Transactions — getCachedUserData", () => {
    const uid      = "user-xyz";
    const cacheKey = `user_data_${uid}`;
    const fakeUser = { name: "Bob", role: "admin" };

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock();
        sessionStorage.clear();
    });

    it("should return cached data from sessionStorage without calling Firestore", async () => {
        sessionStorage.getItem.mockReturnValue(JSON.stringify(fakeUser));

        const result = await getCachedUserData(uid);

        expect(result).toEqual(fakeUser);
        expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it("should fetch from Firestore and cache the result when cache is empty", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => fakeUser,
        });

        const result = await getCachedUserData(uid);

        expect(result).toEqual(fakeUser);
        expect(mockGetDoc).toHaveBeenCalledOnce();
        expect(sessionStorage.setItem).toHaveBeenCalledWith(
            cacheKey,
            JSON.stringify(fakeUser),
        );
    });

    it("should return null when the Firestore document does not exist", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({ exists: () => false });

        const result = await getCachedUserData(uid);

        expect(result).toBeNull();
        expect(sessionStorage.setItem).not.toHaveBeenCalled();
    });

    it("should return null and log an error when Firestore throws", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        mockGetDoc.mockRejectedValue(new Error("Network error"));

        const result = await getCachedUserData(uid);

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
        consoleSpy.mockRestore();
    });
});


describe("Stock_Transactions — logActivity", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock();
    });

    it("should call addDoc with correct action, target, and user fields", async () => {
        mockAddDoc.mockResolvedValue({});

        await logActivity("Stock In", "Laptop (Qty: +10)");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Stock In",
                target: "Laptop (Qty: +10)",
                user:   expect.any(String),
            }),
        );
    });

    it("should include a serverTimestamp in the logged document", async () => {
        mockAddDoc.mockResolvedValue({});

        await logActivity("Sold", "Monitor (Qty: -2)");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ timestamp: expect.anything() }),
        );
    });

    it("should not throw when addDoc fails", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        mockAddDoc.mockRejectedValue(new Error("Firestore error"));

        await expect(logActivity("Test", "Target")).resolves.not.toThrow();

        consoleSpy.mockRestore();
    });
});


describe("Stock_Transactions — formatDate", () => {

    it("should return an empty string when timestamp is null", () => {
        expect(formatDate(null)).toBe("");
    });

    it("should return an empty string when timestamp has no seconds", () => {
        expect(formatDate({})).toBe("");
        expect(formatDate({ seconds: undefined })).toBe("");
    });

    it("should format a valid Firestore timestamp into a readable date string", () => {
        // 2024-06-15 12:00:00 UTC
        const ts     = { seconds: 1718452800 };
        const result = formatDate(ts);

        // Must be a non-empty string containing the year
        expect(result).toBeTruthy();
        expect(result).toContain("2024");
    });

    it("should include month, day, and time components in the output", () => {
        const ts     = { seconds: 1718452800 };
        const result = formatDate(ts);
        // en-US locale output contains comma-separated components
        expect(result).toMatch(/\w+ \d+, \d{4}/);
    });
});


describe("Stock_Transactions — escHtml", () => {

    it("should escape ampersands", () => {
        expect(escHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    });

    it("should escape less-than signs", () => {
        expect(escHtml("<script>")).toBe("&lt;script&gt;");
    });

    it("should escape double quotes", () => {
        expect(escHtml('"quoted"')).toBe("&quot;quoted&quot;");
    });

    it("should escape all special characters together", () => {
        expect(escHtml('<a href="x&y">link</a>')).toBe(
            "&lt;a href=&quot;x&amp;y&quot;&gt;link&lt;/a&gt;",
        );
    });

    it("should return an empty string for null or undefined input", () => {
        expect(escHtml(null)).toBe("");
        expect(escHtml(undefined)).toBe("");
    });

    it("should convert non-string values to string before escaping", () => {
        expect(escHtml(42)).toBe("42");
    });

    it("should return the original string unchanged when no special characters exist", () => {
        expect(escHtml("Hello World")).toBe("Hello World");
    });
});


describe("Stock_Transactions — updateSummaryStats", () => {

    function makeEl(id) {
        const el = makeFakeEl();
        return el;
    }

    // We capture what gets set on each stat element
    let statElements;

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock();

        statElements = {
            statTotal:   makeFakeEl(),
            statStockIn: makeFakeEl(),
            statSold:    makeFakeEl(),
            statOther:   makeFakeEl(),
        };

        // Wire getElementById to return the right element per id
        document.getElementById.mockImplementation((id) => statElements[id] ?? makeFakeEl());
    });

    it("should set all stat elements to zero when txCache for the active year is empty", () => {
        // txCache is module-internal; updateSummaryStats reads txCache[activeYear]
        // With no transactions loaded the cache for the current year is [] or missing
        updateSummaryStats();

        expect(statElements.statTotal.textContent).toBe("0");
        expect(statElements.statStockIn.textContent).toBe("0");
        expect(statElements.statSold.textContent).toBe("0");
        expect(statElements.statOther.textContent).toBe("0");
    });
});