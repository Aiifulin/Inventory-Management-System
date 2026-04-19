import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    checkAdminRole,
    sanitizeInput,
    addCategory,
    logActivity
} from "../public/js/Add_Categories.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockSetDoc,
    mockDoc,
    mockCollection,
    mockQuery,
    mockWhere,
    mockAddDoc,
    mockServerTimestamp
} = vi.hoisted(() => ({
    mockGetDoc:         vi.fn(),
    mockGetDocs:        vi.fn(),
    mockSetDoc:         vi.fn(),
    mockDoc:            vi.fn(() => ({})),
    mockCollection:     vi.fn(() => ({})),
    mockQuery:          vi.fn(),
    mockWhere:          vi.fn(),
    mockAddDoc:         vi.fn(),
    mockServerTimestamp: vi.fn(() => ({ _seconds: Date.now() / 1000 }))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    getFirestore:    vi.fn(),
    doc:             mockDoc,
    getDoc:          mockGetDoc,
    setDoc:          mockSetDoc,
    collection:      mockCollection,
    addDoc:          mockAddDoc,
    serverTimestamp: mockServerTimestamp,
    query:           mockQuery,
    where:           mockWhere,
    getDocs:         mockGetDocs,
    updateDoc:       vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    getAuth:           vi.fn(() => ({ currentUser: { email: "admin@test.com", uid: "admin-uid" } })),
    onAuthStateChanged: vi.fn(),
    signOut:           vi.fn()
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
    getElementById:  vi.fn(() => ({ value: '', textContent: '', style: {}, addEventListener: vi.fn() })),
    querySelector:   vi.fn(() => ({ addEventListener: vi.fn(), innerText: '', disabled: false })),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:   vi.fn(() => {
        return {
            _text: "",
            set innerText(val) {
                this._text = val;
                this.innerHTML = val.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            },
            get innerText() { return this._text; },
            innerHTML: ""
        };
    })
};

global.window = {
    location: { href: '', replace: vi.fn() },
    addEventListener: vi.fn()
};

// ==========================================
// TEST SUITES
// ==========================================

describe("Add Category — getCachedUserData", () => {

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

describe("Add Category — checkAdminRole", () => {

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

describe("Add Category — sanitizeInput", () => {

    it("should sanitize script tags", () => {
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
        expect(sanitizeInput(123)).toBe("123");
        expect(sanitizeInput(true)).toBe("true");
    });

    it("should preserve normal text", () => {
        expect(sanitizeInput("Normal text")).toBe("Normal text");
    });
});

describe("Add Category — addCategory", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mockDoc.mockReturnValue({});
    });

    it("should throw if category ID already exists", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => true });
        await expect(addCategory({ name: "Test" }, "cat-1")).rejects.toThrow('Category ID "cat-1" is already in use.');
    });

    it("should create category when ID is free", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        mockSetDoc.mockResolvedValue();
        const id = await addCategory({ name: "Electronics", normalizedName: "electronics" }, "cat-1");
        expect(mockSetDoc).toHaveBeenCalled();
        expect(id).toBe("cat-1");
    });

    it("should include archived: false and itemCount: 0", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        mockSetDoc.mockResolvedValue();
        await addCategory({ name: "Test" }, "cat-1");
        expect(mockSetDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ archived: false, itemCount: 0 })
        );
    });

    it("should include a createdAt timestamp", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        mockSetDoc.mockResolvedValue();
        await addCategory({ name: "Test" }, "cat-1");
        expect(mockSetDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ createdAt: expect.anything() })
        );
    });
});

describe("Add Category — logActivity", () => {

    beforeEach(() => vi.clearAllMocks());

    it("should log with correct action and target", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Added Category", "Electronics");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: "Added Category", target: "Electronics" })
        );
    });

    it("should include a timestamp", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Added Category", "Electronics");
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