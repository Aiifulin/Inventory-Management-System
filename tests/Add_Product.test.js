import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    checkAdminRole,
    sanitizeInput,
    logActivity,
    loadCategories,
    loadDefaultThreshold
} from "../public/js/Add_Product.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockAddDoc,
    mockDoc,
    mockCollection,
    mockQuery,
    mockWhere,
    mockServerTimestamp
} = vi.hoisted(() => ({
    mockGetDoc:          vi.fn(),
    mockGetDocs:         vi.fn(),
    mockAddDoc:          vi.fn(),
    mockDoc:             vi.fn(() => ({})),
    mockCollection:      vi.fn(() => ({})),
    mockQuery:           vi.fn(),
    mockWhere:           vi.fn(),
    mockServerTimestamp: vi.fn(() => ({ _seconds: Date.now() / 1000 }))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    collection:      mockCollection,
    addDoc:          mockAddDoc,
    setDoc:          vi.fn(),
    serverTimestamp: mockServerTimestamp,
    query:           mockQuery,
    where:           mockWhere,
    getDocs:         mockGetDocs,
    doc:             mockDoc,
    getDoc:          mockGetDoc
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js", () => ({
    ref:             vi.fn(),
    uploadBytes:     vi.fn(),
    getDownloadURL:  vi.fn()
}));

vi.mock("../public/js/logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn())
}));

vi.mock("../public/js/firebase.js", () => ({
    auth:    { currentUser: { email: "admin@test.com", uid: "admin-uid" } },
    db:      {},
    storage: {}
}));

global.sessionStorage = {
    store: {},
    getItem:    vi.fn(function(key)        { return this.store[key] ?? null; }),
    setItem:    vi.fn(function(key, value) { this.store[key] = value; }),
    removeItem: vi.fn(function(key)        { delete this.store[key]; }),
    clear:      vi.fn(function()           { this.store = {}; })
};

global.localStorage = {
    store: {},
    getItem:    vi.fn(function(key)        { return this.store[key] ?? null; }),
    setItem:    vi.fn(function(key, value) { this.store[key] = value; }),
    removeItem: vi.fn(function(key)        { delete this.store[key]; }),
    clear:      vi.fn(function()           { this.store = {}; })
};

global.alert = vi.fn();

global.document = {
    getElementById:   vi.fn(() => ({ value: '', textContent: '', style: {}, innerHTML: '', appendChild: vi.fn(), addEventListener: vi.fn() })),
    querySelector:    vi.fn(() => ({ addEventListener: vi.fn(), innerText: '', disabled: false, value: '' })),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => {
        return {
            _text: "",
            set innerText(val) {
                this._text = val;
                this.innerHTML = val.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            },
            get innerText() { return this._text; },
            innerHTML: "",
            value:     "",
            textContent: ""
        };
    })
};

global.window = {
    location:        { href: '', replace: vi.fn() },
    addEventListener: vi.fn()
};

// ==========================================
// TEST SUITES
// ==========================================

describe("Add Product — getCachedUserData", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it("should return cached data from sessionStorage", async () => {
        const mockUser = { role: "admin", email: "admin@test.com" };
        sessionStorage.getItem.mockReturnValue(JSON.stringify(mockUser));
        const result = await getCachedUserData("admin-uid");
        expect(result).toEqual(mockUser);
        expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it("should fetch from Firestore if not cached", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({ role: "admin", email: "admin@test.com" })
        });
        const result = await getCachedUserData("admin-uid");
        expect(result).toEqual({ role: "admin", email: "admin@test.com" });
        expect(sessionStorage.setItem).toHaveBeenCalled();
    });

    it("should return null if user does not exist", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({ exists: () => false });
        expect(await getCachedUserData("admin-uid")).toBeNull();
    });

    it("should return null if Firestore throws", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockRejectedValue(new Error("Network error"));
        expect(await getCachedUserData("admin-uid")).toBeNull();
    });
});

describe("Add Product — checkAdminRole", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it("should return true for admin role", async () => {
        sessionStorage.getItem.mockReturnValue(JSON.stringify({ role: "admin" }));
        expect(await checkAdminRole("admin-uid")).toBe(true);
    });

    it("should be case-insensitive", async () => {
        sessionStorage.getItem.mockReturnValue(JSON.stringify({ role: "AdMiN" }));
        expect(await checkAdminRole("admin-uid")).toBe(true);
    });

    it("should return false for non-admin role", async () => {
        sessionStorage.getItem.mockReturnValue(JSON.stringify({ role: "user" }));
        expect(await checkAdminRole("user-uid")).toBe(false);
    });

    it("should return false if user data is null", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({ exists: () => false });
        expect(await checkAdminRole("uid")).toBe(false);
    });
});

describe("Add Product — sanitizeInput", () => {

    it("should escape script tags", () => {
        const result = sanitizeInput("<script>alert('xss')</script>");
        expect(result).not.toContain("<script>");
        expect(result).toContain("&lt;script&gt;");
    });

    it("should return empty string for falsy input", () => {
        expect(sanitizeInput("")).toBe("");
        expect(sanitizeInput(null)).toBe("");
        expect(sanitizeInput(undefined)).toBe("");
    });

    it("should convert non-strings to strings", () => {
        expect(sanitizeInput(42)).toBe("42");
        expect(sanitizeInput(true)).toBe("true");
    });

    it("should preserve normal text", () => {
        expect(sanitizeInput("Normal product name")).toBe("Normal product name");
    });

    it("should escape img onerror attacks", () => {
        const result = sanitizeInput('<img src=x onerror="alert(1)">');
        expect(result).toContain("&lt;img");
    });
});

describe("Add Product — logActivity", () => {

    beforeEach(() => vi.clearAllMocks());

    it("should call addDoc with correct action and target", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Added Product", "Gaming Chair");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Added Product",
                target: "Gaming Chair"
            })
        );
    });

    it("should include a timestamp", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Added Product", "Gaming Chair");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ timestamp: expect.anything() })
        );
    });

    it("should not throw if addDoc fails", async () => {
        mockAddDoc.mockRejectedValue(new Error("Firestore error"));
        await expect(logActivity("Test", "Target")).resolves.not.toThrow();
    });
});

describe("Add Product — loadCategories", () => {

    beforeEach(() => vi.clearAllMocks());

    it("should not throw if categorySelect element is missing", async () => {
        global.document.getElementById = vi.fn(() => null);
        await expect(loadCategories()).resolves.not.toThrow();
    });

    it("should fetch categories from Firestore", async () => {
        const mockSelect = {
            innerHTML: '',
            appendChild: vi.fn(),
            addEventListener: vi.fn()
        };
        global.document.getElementById = vi.fn((id) =>
            id === "categorySelect" ? mockSelect : null
        );

        const mockDocs = [
            { data: () => ({ name: "Electronics", archived: false }) },
            { data: () => ({ name: "Archived Cat", archived: true }) }
        ];
        mockGetDocs.mockResolvedValue({ forEach: (cb) => mockDocs.forEach(cb) });

        await loadCategories();

        expect(mockGetDocs).toHaveBeenCalled();
        // Only the non-archived category should be appended
        expect(mockSelect.appendChild).toHaveBeenCalledTimes(1);
    });

    it("should not throw if Firestore fails", async () => {
        const mockSelect = { innerHTML: '', appendChild: vi.fn(), addEventListener: vi.fn() };
        global.document.getElementById = vi.fn(() => mockSelect);
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(loadCategories()).resolves.not.toThrow();
    });
});