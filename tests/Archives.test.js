import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    restoreProduct,
    permanentlyDeleteProduct,
    restoreCategory,
    permanentlyDeleteCategory,
    logActivity
} from "../public/js/Archives.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockUpdateDoc,
    mockDeleteDoc,
    mockAddDoc,
    mockDoc,
    mockCollection,
    mockQuery,
    mockWhere,
    mockOrderBy,
    mockLimit,
    mockStartAfter,
    mockRef,
    mockDeleteObject
} = vi.hoisted(() => ({
    mockGetDoc:       vi.fn(),
    mockGetDocs:      vi.fn(),
    mockUpdateDoc:    vi.fn(),
    mockDeleteDoc:    vi.fn(),
    mockAddDoc:       vi.fn(),
    mockDoc:          vi.fn(() => ({})),
    mockCollection:   vi.fn(() => ({})),
    mockQuery:        vi.fn(),
    mockWhere:        vi.fn(),
    mockOrderBy:      vi.fn(),
    mockLimit:        vi.fn(),
    mockStartAfter:   vi.fn(),
    mockRef:          vi.fn(),
    mockDeleteObject: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    collection:      mockCollection,
    query:           mockQuery,
    where:           mockWhere,
    orderBy:         mockOrderBy,
    limit:           mockLimit,
    startAfter:      mockStartAfter,
    getDocs:         mockGetDocs,
    doc:             mockDoc,
    getDoc:          mockGetDoc,
    updateDoc:       mockUpdateDoc,
    deleteDoc:       mockDeleteDoc,
    addDoc:          mockAddDoc,
    serverTimestamp: vi.fn(() => ({ _seconds: Date.now() / 1000 }))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js", () => ({
    ref:          mockRef,
    deleteObject: mockDeleteObject
}));

vi.mock("../public/js/logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn())
}));

vi.mock("../public/js/firebase.js", () => ({
    auth:    { currentUser: { email: "admin@test.com", uid: "admin-uid" } },
    db:      {},
    storage: {}
}));

beforeEach(() => {
    // Default: return a valid empty snapshot so loadArchived* doesn't crash
    mockGetDocs.mockResolvedValue({
        empty: true,
        docs: [],
        forEach: vi.fn()
    });
});

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

global.document = {
    getElementById:   vi.fn(() => ({ textContent: '', style: {}, innerHTML: '', classList: { toggle: vi.fn() }, appendChild: vi.fn(), addEventListener: vi.fn() })),
    querySelector:    vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => ({ className: '', innerHTML: '', style: {}, appendChild: vi.fn() })),
    documentElement:  { style: {} }
};

global.window = {
    location:        { href: '', replace: vi.fn() },
    addEventListener: vi.fn()
};

// ==========================================
// HELPER — DEFINE ONCE (TOP LEVEL)
// ==========================================
const defaultGetDocsMock = () =>
    mockGetDocs.mockResolvedValue({
        empty: true,
        docs: [],
        forEach: vi.fn()
    });


// ==========================================
// TEST SUITES
// ==========================================

describe("Archives — getCachedUserData", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock(); // ✅ FIX
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
            data: () => ({ role: "admin", name: "Alice" })
        });

        const result = await getCachedUserData("uid-1");

        expect(result).toEqual({ role: "admin", name: "Alice" });
        expect(sessionStorage.setItem).toHaveBeenCalled();
    });

    it("should return null if user does not exist", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockResolvedValue({ exists: () => false });

        expect(await getCachedUserData("uid-1")).toBeNull();
    });

    it("should return null if Firestore throws", async () => {
        sessionStorage.getItem.mockReturnValue(null);
        mockGetDoc.mockRejectedValue(new Error("Network error"));

        expect(await getCachedUserData("uid-1")).toBeNull();
    });
});


describe("Archives — restoreProduct", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock(); // ✅ FIX
    });

    it("should call updateDoc with archived: false", async () => {
        mockUpdateDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await restoreProduct("prod-1", "Laptop");

        expect(mockUpdateDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ archived: false, archivedAt: null })
        );
    });

    it("should log restore activity", async () => {
        mockUpdateDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await restoreProduct("prod-1", "Laptop");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Restore Product",
                target: "Laptop"
            })
        );
    });

    it("should not throw if updateDoc fails", async () => {
        mockUpdateDoc.mockRejectedValue(new Error("Firestore error"));

        await expect(
            restoreProduct("prod-1", "Laptop")
        ).resolves.not.toThrow();
    });
});


describe("Archives — permanentlyDeleteProduct", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock(); // ✅ FIX
    });

    it("should call deleteDoc", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ imageUrl: "" })
        });

        mockDeleteDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await permanentlyDeleteProduct("prod-1", "Old Laptop");

        expect(mockDeleteDoc).toHaveBeenCalled();
    });

    it("should log delete activity", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ imageUrl: "" })
        });

        mockDeleteDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await permanentlyDeleteProduct("prod-1", "Old Laptop");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Delete Product Permanently",
                target: "Old Laptop"
            })
        );
    });

    it("should delete Firebase Storage image if URL exists", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({
                imageUrl: "https://firebasestorage.googleapis.com/test.jpg"
            })
        });

        mockDeleteDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();
        mockDeleteObject.mockResolvedValue();

        await permanentlyDeleteProduct("prod-1", "Old Laptop");

        expect(mockDeleteObject).toHaveBeenCalled();
    });

    it("should not throw if deleteDoc fails", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        mockDeleteDoc.mockRejectedValue(new Error("Firestore error"));

        await expect(
            permanentlyDeleteProduct("prod-1", "Old Laptop")
        ).resolves.not.toThrow();
    });
});


describe("Archives — restoreCategory", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock(); // ✅ FIX
    });

    it("should update category to archived: false", async () => {
        mockUpdateDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await restoreCategory("cat-1", "Electronics");

        expect(mockUpdateDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ archived: false, archivedAt: null })
        );
    });

    it("should log restore category activity", async () => {
        mockUpdateDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await restoreCategory("cat-1", "Electronics");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Restore Category",
                target: "Electronics"
            })
        );
    });

    it("should bust dashboard cache", async () => {
        mockUpdateDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await restoreCategory("cat-1", "Electronics");

        expect(sessionStorage.removeItem)
            .toHaveBeenCalledWith("dashboard_cache");
    });

    it("should not throw if updateDoc fails", async () => {
        mockUpdateDoc.mockRejectedValue(new Error("Firestore error"));

        await expect(
            restoreCategory("cat-1", "Electronics")
        ).resolves.not.toThrow();
    });
});


describe("Archives — permanentlyDeleteCategory", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock(); // ✅ FIX
    });

    it("should call deleteDoc", async () => {
        mockDeleteDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await permanentlyDeleteCategory("cat-1", "Old Category");

        expect(mockDeleteDoc).toHaveBeenCalled();
    });

    it("should log delete category activity", async () => {
        mockDeleteDoc.mockResolvedValue();
        mockAddDoc.mockResolvedValue();

        await permanentlyDeleteCategory("cat-1", "Old Category");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Delete Category Permanently",
                target: "Old Category"
            })
        );
    });

    it("should not throw if deleteDoc fails", async () => {
        mockDeleteDoc.mockRejectedValue(new Error("Firestore error"));

        await expect(
            permanentlyDeleteCategory("cat-1", "Old Category")
        ).resolves.not.toThrow();
    });
});


describe("Archives — logActivity", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock(); // ✅ FIX
    });

    it("should call addDoc with correct fields", async () => {
        mockAddDoc.mockResolvedValue();

        await logActivity("Test Action", "Test Target");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Test Action",
                target: "Test Target"
            })
        );
    });

    it("should not throw if addDoc fails", async () => {
        mockAddDoc.mockRejectedValue(new Error("Firestore error"));

        await expect(
            logActivity("Test", "Target")
        ).resolves.not.toThrow();
    });
});