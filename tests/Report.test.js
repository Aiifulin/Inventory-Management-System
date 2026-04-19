import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    setDateRange,
    isInRange,
    formatRangeLabel,
    getTrendIndicator,
    convertToCSV,
    getDateStamp
} from "../public/js/Reports.js";

// ==========================================
// HOISTED MOCKS
// ==========================================
const { mockGetDoc, mockGetDocs, mockDoc, mockCollection, mockQuery, mockOrderBy, mockLimit, mockWhere } =
    vi.hoisted(() => ({
        mockGetDoc:    vi.fn(),
        mockGetDocs:   vi.fn(),
        mockDoc:       vi.fn(() => ({})),
        mockCollection: vi.fn(() => ({})),
        mockQuery:     vi.fn((...a) => a[0]),
        mockOrderBy:   vi.fn(() => ({})),
        mockLimit:     vi.fn(() => ({})),
        mockWhere:     vi.fn(() => ({}))
    }));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    collection: mockCollection,
    getDocs:    mockGetDocs,
    doc:        mockDoc,
    getDoc:     mockGetDoc,
    query:      mockQuery,
    orderBy:    mockOrderBy,
    limit:      mockLimit,
    where:      mockWhere
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn()
}));

vi.mock("../public/js/firebase.js", () => ({
    auth:    { currentUser: { uid: "uid-test", email: "admin@test.com" } },
    db:      {},
    storage: {}
}));

vi.mock("../public/js/logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn())
}));

// ==========================================
// STORAGE & DOM STUBS
// ==========================================
const makeStorage = () => {
    let store = {};
    const stub = {
        getItem:    vi.fn((k)    => store[k] ?? null),
        setItem:    vi.fn((k, v) => { store[k] = String(v); }),
        removeItem: vi.fn((k)    => { delete store[k]; }),
        clear:      vi.fn(()     => { store = {}; }),
        get length() { return Object.keys(store).length; },
        _store: () => store,
        _reset() {
            store = {};
            this.getItem.mockImplementation((k)    => store[k] ?? null);
            this.setItem.mockImplementation((k, v) => { store[k] = String(v); });
            this.removeItem.mockImplementation((k)  => { delete store[k]; });
            this.clear.mockImplementation(()        => { store = {}; });
        }
    };
    return stub;
};

global.sessionStorage = makeStorage();
global.localStorage   = makeStorage();

const makeSafeEl = () => ({
    value: "", textContent: "", innerHTML: "", style: { display: "" },
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    addEventListener: vi.fn(), getAttribute: vi.fn(), setAttribute: vi.fn(),
    querySelector: vi.fn(() => makeSafeEl()),
    dataset: {}
});

global.document = {
    getElementById:      vi.fn(() => makeSafeEl()),
    querySelector:       vi.fn(() => makeSafeEl()),
    querySelectorAll:    vi.fn(() => []),
    addEventListener:    vi.fn(),
    createElement:       vi.fn(() => makeSafeEl()),
    body:                { insertAdjacentHTML: vi.fn() },
    documentElement:     { getAttribute: vi.fn(() => null), style: {} }
};

global.window = { location: { href: "", replace: vi.fn() } };
global.Chart  = vi.fn(() => ({ destroy: vi.fn(), data: {} }));
global.XLSX   = {
    utils: { json_to_sheet: vi.fn(), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
    writeFile: vi.fn()
};
global.URL = { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() };
global.alert = vi.fn();

// ==========================================
// TESTS
// ==========================================

describe("Reports — getCachedUserData", () => {

    beforeEach(() => {
        global.sessionStorage._reset();
        vi.clearAllMocks();
    });

    it("should return cached data and skip Firestore when cache is warm", async () => {
        const userData = { name: "Alice", role: "admin" };
        global.sessionStorage.setItem("user_data_uid-1", JSON.stringify(userData));

        const result = await getCachedUserData("uid-1");

        expect(result).toEqual(userData);
        expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it("should fetch from Firestore and cache the result on a cold cache", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: "Bob", role: "user" }) });

        const result = await getCachedUserData("uid-2");

        expect(result.name).toBe("Bob");
        expect(mockGetDoc).toHaveBeenCalledTimes(1);
        expect(global.sessionStorage.setItem).toHaveBeenCalledWith(
            "user_data_uid-2",
            JSON.stringify({ name: "Bob", role: "user" })
        );
    });

    it("should return null when the user document does not exist", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        expect(await getCachedUserData("uid-ghost")).toBeNull();
    });

    it("should return null on a Firestore error", async () => {
        mockGetDoc.mockRejectedValue(new Error("network error"));
        expect(await getCachedUserData("uid-err")).toBeNull();
    });
});

// ==========================================

describe("Reports — setDateRange / isInRange", () => {

    // Reset to "all time" before each test so tests don't bleed into each other
    beforeEach(() => setDateRange(null, null));

    it("should return true for any timestamp when no range is set (all time)", () => {
        expect(isInRange({ seconds: 0 })).toBe(true);
        expect(isInRange({ seconds: 9999999999 })).toBe(true);
    });

    it("should return false for a null/missing timestamp when a range is active", () => {
        setDateRange(new Date("2024-01-01"), new Date("2024-12-31"));
        expect(isInRange(null)).toBe(false);
        expect(isInRange(undefined)).toBe(false);
    });

    it("should return true when timestamp falls within the range", () => {
        setDateRange(new Date("2024-01-01"), new Date("2024-12-31"));
        const mid = new Date("2024-06-15");
        expect(isInRange({ seconds: mid.getTime() / 1000 })).toBe(true);
    });

    it("should return false when timestamp is before the range start", () => {
        setDateRange(new Date("2024-06-01"), new Date("2024-12-31"));
        const before = new Date("2024-05-31");
        expect(isInRange({ seconds: before.getTime() / 1000 })).toBe(false);
    });

    it("should return false when timestamp is after the range end", () => {
        setDateRange(new Date("2024-01-01"), new Date("2024-06-30"));
        const after = new Date("2024-07-01");
        expect(isInRange({ seconds: after.getTime() / 1000 })).toBe(false);
    });

    it("should accept a plain numeric timestamp (milliseconds) as well as a seconds object", () => {
        setDateRange(new Date("2024-01-01"), new Date("2024-12-31"));
        const ts = new Date("2024-03-10").getTime(); // milliseconds
        expect(isInRange(ts)).toBe(true);
    });

    it("should apply only a from-bound when to is null", () => {
        setDateRange(new Date("2024-01-01"), null);
        const future = new Date("2099-01-01");
        expect(isInRange({ seconds: future.getTime() / 1000 })).toBe(true);

        const past = new Date("2023-12-31");
        expect(isInRange({ seconds: past.getTime() / 1000 })).toBe(false);
    });

    it("should apply only a to-bound when from is null", () => {
        setDateRange(null, new Date("2024-06-30"));
        const veryOld = new Date("1990-01-01");
        expect(isInRange({ seconds: veryOld.getTime() / 1000 })).toBe(true);

        const future = new Date("2024-07-01");
        expect(isInRange({ seconds: future.getTime() / 1000 })).toBe(false);
    });
});

// ==========================================

describe("Reports — formatRangeLabel", () => {

    it("should return 'All time' when both dates are null", () => {
        expect(formatRangeLabel(null, null)).toBe("All time");
    });

    it("should format both dates when both are provided", () => {
        const from = new Date("2024-01-15");
        const to   = new Date("2024-06-30");
        const label = formatRangeLabel(from, to);
        expect(label).toContain("Jan");
        expect(label).toContain("Jun");
        expect(label).toContain("–");
    });

    it("should use em-dash (—) for from when it is null", () => {
        const to = new Date("2024-06-30");
        expect(formatRangeLabel(null, to)).toMatch(/^—\s*–/);
    });

    it("should use 'Today' for to when it is null", () => {
        const from = new Date("2024-01-01");
        expect(formatRangeLabel(from, null)).toContain("Today");
    });

    it("should include the year in the formatted output", () => {
        const from = new Date("2023-03-01");
        const to   = new Date("2024-11-15");
        const label = formatRangeLabel(from, to);
        expect(label).toContain("2023");
        expect(label).toContain("2024");
    });
});

// ==========================================

describe("Reports — getTrendIndicator", () => {

    it("should return neutral when both current and previous are zero", () => {
        const result = getTrendIndicator(0, 0);
        expect(result.cls).toBe("trend-neutral");
        expect(result.text).toBe("—");
    });

    it("should return 'New' when previous is zero but current is positive", () => {
        const result = getTrendIndicator(10, 0);
        expect(result.text).toBe("New");
        expect(result.cls).toBe("trend-up");
    });

    it("should return trend-up with percentage when current > previous", () => {
        const result = getTrendIndicator(150, 100);
        expect(result.cls).toBe("trend-up");
        expect(result.text).toContain("↑");
        expect(result.text).toContain("50.0%");
    });

    it("should return trend-down with percentage when current < previous", () => {
        const result = getTrendIndicator(50, 100);
        expect(result.cls).toBe("trend-down");
        expect(result.text).toContain("↓");
        expect(result.text).toContain("50.0%");
    });

    it("should return trend-neutral → 0% when current equals previous", () => {
        const result = getTrendIndicator(75, 75);
        expect(result.cls).toBe("trend-neutral");
        expect(result.text).toBe("→ 0%");
    });

    it("should compute percentage to one decimal place", () => {
        const result = getTrendIndicator(1, 3); // 66.666...%
        expect(result.text).toContain("66.7%");
    });

    it("should include icon field consistent with direction", () => {
        expect(getTrendIndicator(10, 5).icon).toBe("↑");
        expect(getTrendIndicator(5, 10).icon).toBe("↓");
        expect(getTrendIndicator(5, 5).icon).toBe("→");
        expect(getTrendIndicator(1, 0).icon).toBe("↑");
        expect(getTrendIndicator(0, 0).icon).toBe("");
    });
});

// ==========================================

describe("Reports — convertToCSV", () => {

    it("should return empty string for an empty array", () => {
        expect(convertToCSV([])).toBe("");
    });

    it("should produce a header row followed by data rows", () => {
        const data = [{ Name: "Alice", Age: 30 }];
        const csv  = convertToCSV(data);
        const lines = csv.split("\n");
        expect(lines[0]).toBe("Name,Age");
        expect(lines[1]).toBe("Alice,30");
    });

    it("should wrap values containing commas in double quotes", () => {
        const data = [{ Name: "Smith, John", Value: 5 }];
        const csv  = convertToCSV(data);
        expect(csv).toContain('"Smith, John"');
    });

    it("should escape double quotes inside values", () => {
        const data = [{ Note: 'He said "hello"' }];
        const csv  = convertToCSV(data);
        expect(csv).toContain('"He said ""hello"""');
    });

    it("should wrap values containing newlines in double quotes", () => {
        const data = [{ Note: "line1\nline2" }];
        const csv  = convertToCSV(data);
        expect(csv).toContain('"line1\nline2"');
    });

    it("should handle null and undefined values as empty strings", () => {
        const data = [{ Name: null, Code: undefined }];
        const csv  = convertToCSV(data);
        expect(csv.split("\n")[1]).toBe(",");
    });

    it("should handle multiple rows correctly", () => {
        const data = [
            { Product: "Apple",  Qty: 10 },
            { Product: "Banana", Qty: 5  }
        ];
        const lines = convertToCSV(data).split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[1]).toBe("Apple,10");
        expect(lines[2]).toBe("Banana,5");
    });
});

// ==========================================

describe("Reports — getDateStamp", () => {

    it("should return today's date in YYYY-MM-DD format", () => {
        const stamp = getDateStamp();
        expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should match today's ISO date string", () => {
        const expected = new Date().toISOString().split("T")[0];
        expect(getDateStamp()).toBe(expected);
    });
});