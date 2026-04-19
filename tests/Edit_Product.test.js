import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    checkAdminRole,
    logActivity,
    sanitizeInput,
    loadCategories,
    getPathFromUrl,
    deleteImageByUrl
} from "../public/js/Edit_Product.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockUpdateDoc,
    mockAddDoc,
    mockDoc,
    mockCollection,
    mockQuery,
    mockWhere,
    mockRef,
    mockDeleteObject,
    mockUploadBytes,
    mockGetDownloadURL
} = vi.hoisted(() => ({
    mockGetDoc:         vi.fn(),
    mockGetDocs:        vi.fn(),
    mockUpdateDoc:      vi.fn(),
    mockAddDoc:         vi.fn(),
    mockDoc:            vi.fn(() => ({})),
    mockCollection:     vi.fn(() => ({})),
    mockQuery:          vi.fn(() => ({})),
    mockWhere:          vi.fn(() => ({})),
    mockRef:            vi.fn(() => ({})),
    mockDeleteObject:   vi.fn(),
    mockUploadBytes:    vi.fn(),
    mockGetDownloadURL: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    doc:             mockDoc,
    getDoc:          mockGetDoc,
    updateDoc:       mockUpdateDoc,
    collection:      mockCollection,
    getDocs:         mockGetDocs,
    addDoc:          mockAddDoc,
    query:           mockQuery,
    where:           mockWhere,
    serverTimestamp: vi.fn(() => "MOCK_TIME")
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js", () => ({
    ref:             mockRef,
    deleteObject:    mockDeleteObject,
    uploadBytes:     mockUploadBytes,
    getDownloadURL:  mockGetDownloadURL
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
const makeElement = () => {
    const el = {
        textContent:      "",
        innerHTML:        "",
        value:            "",
        style:            {},
        dataset:          {},
        options:          [],
        classList:        { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
        appendChild:      vi.fn(),
        addEventListener: vi.fn(),
        setAttribute:     vi.fn(),
        getAttribute:     vi.fn(() => null),
        querySelector:    vi.fn(() => makeElement()),
        querySelectorAll: vi.fn(() => []),
        set innerText(v) { this._innerText = v; this.innerHTML = escapeHtml(v); },
        get innerText()  { return this._innerText || ""; }
    };
    return el;
};

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

global.document = {
    getElementById:   vi.fn(() => makeElement()),
    querySelector:    vi.fn(() => makeElement()),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => makeElement()),
    documentElement:  { style: {}, getAttribute: vi.fn(() => null) },
    body:             { addEventListener: vi.fn() }
};

global.window = {
    location:         { href: "", replace: vi.fn(), search: "" },
    addEventListener: vi.fn(),
    URLSearchParams:  class { get() { return "test-product-id"; } }
};

global.alert   = vi.fn();
global.confirm = vi.fn(() => true);

// Default safe mock
const defaultGetDocs = () =>
    mockGetDocs.mockResolvedValue({ docs: [], forEach: vi.fn(), empty: true });

// ==========================================
// TEST SUITES
// ==========================================

describe("Edit_Product — getCachedUserData", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should return cached data without hitting Firestore", async () => {
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

    it("should return null when Firestore throws", async () => {
        mockGetDoc.mockRejectedValue(new Error("Network error"));
        expect(await getCachedUserData("uid-1")).toBeNull();
    });
});

// ==========================================

describe("Edit_Product — checkAdminRole", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
        sessionStorage._reset();
    });

    it("should return true when user role is admin", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({ role: "admin" })
        });
        expect(await checkAdminRole("uid-1")).toBe(true);
    });

    it("should return true for mixed-case role like 'Admin'", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({ role: "Admin" })
        });
        expect(await checkAdminRole("uid-1")).toBe(true);
    });

    it("should return false when user role is 'user'", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({ role: "user" })
        });
        expect(await checkAdminRole("uid-1")).toBe(false);
    });

    it("should return false when document does not exist", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        expect(await checkAdminRole("uid-1")).toBe(false);
    });

    it("should return false when Firestore throws", async () => {
        mockGetDoc.mockRejectedValue(new Error("Network error"));
        expect(await checkAdminRole("uid-1")).toBe(false);
    });

    it("should return false when role field is missing", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({})
        });
        expect(await checkAdminRole("uid-1")).toBe(false);
    });
});

// ==========================================

describe("Edit_Product — logActivity", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
    });

    it("should call addDoc with correct action and target", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Product", "Gaming Chair");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Updated Product",
                target: "Gaming Chair"
            })
        );
    });

    it("should include the current user email", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Product", "Gaming Chair");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ user: "admin@test.com" })
        );
    });

    it("should include a timestamp", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Product", "Gaming Chair");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ timestamp: expect.anything() })
        );
    });

    it("should use 'Admin' fallback when currentUser is null", async () => {
        const { auth } = await import("../public/js/firebase.js");
        const original = auth.currentUser;
        auth.currentUser = null;

        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Product", "Gaming Chair");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ user: "Admin" })
        );

        auth.currentUser = original;
    });

    it("should not throw when addDoc fails", async () => {
        mockAddDoc.mockRejectedValue(new Error("Firestore error"));
        await expect(logActivity("Updated Product", "Gaming Chair")).resolves.not.toThrow();
    });
});

// ==========================================

describe("Edit_Product — sanitizeInput", () => {

    it("should return empty string for falsy input", () => {
        expect(sanitizeInput("")).toBe("");
        expect(sanitizeInput(null)).toBe("");
        expect(sanitizeInput(undefined)).toBe("");
    });

    it("should convert non-string types to string", () => {
        expect(sanitizeInput(42)).toBe("42");
        expect(sanitizeInput(true)).toBe("true");
    });

    it("should escape < and > characters", () => {
        const result = sanitizeInput("<script>alert('xss')</script>");
        expect(result).not.toContain("<script>");
        expect(result).toContain("&lt;script&gt;");
    });

    it("should escape the entire tag so no HTML can execute", () => {
        const result = sanitizeInput('<img src=x onerror="alert(1)">');
        expect(result).not.toContain("<img");
        expect(result).toContain("&lt;img");
        expect(result).toContain("&gt;");
    });

    it("should preserve normal plain text unchanged", () => {
        expect(sanitizeInput("Gaming Chair")).toBe("Gaming Chair");
    });

    it("should handle multiple dangerous characters", () => {
        const result = sanitizeInput("<div><p>Test</p></div>");
        expect(result).not.toContain("<");
        expect(result).not.toContain(">");
    });
});

// ==========================================

describe("Edit_Product — loadCategories", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
    });

    it("should call getDocs to fetch categories", async () => {
        const docs = [
            { data: () => ({ name: "Electronics", archived: false }) },
            { data: () => ({ name: "Furniture",   archived: false }) }
        ];
        mockGetDocs.mockResolvedValue({ forEach: (cb) => docs.forEach(cb) });

        await loadCategories();
        expect(mockGetDocs).toHaveBeenCalled();
    });

    it("should not throw when getDocs fails", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        await expect(loadCategories()).resolves.not.toThrow();
    });

    it("should not throw when the category select element is missing", async () => {
        document.getElementById.mockReturnValueOnce(null);
        await expect(loadCategories()).resolves.not.toThrow();
        expect(mockGetDocs).not.toHaveBeenCalled();
    });
});

// ==========================================

describe("Edit_Product — getPathFromUrl", () => {

    it("should extract the storage path from a Firebase Storage URL", () => {
        const url = "https://firebasestorage.googleapis.com/v0/b/bucket/o/products%2Fimages%2Ftest.jpg?alt=media";
        expect(getPathFromUrl(url)).toBe("products/images/test.jpg");
    });

    it("should return null for a URL without /o/ segment", () => {
        expect(getPathFromUrl("https://example.com/image.jpg")).toBeNull();
    });

    it("should return null for an empty string", () => {
        expect(getPathFromUrl("")).toBeNull();
    });

    it("should handle paths with nested folders", () => {
        const url = "https://firebasestorage.googleapis.com/v0/b/bucket/o/a%2Fb%2Fc%2Ffile.png?token=xyz";
        expect(getPathFromUrl(url)).toBe("a/b/c/file.png");
    });
});

// ==========================================

describe("Edit_Product — deleteImageByUrl", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
    });

    it("should call deleteObject with the correct ref", async () => {
        mockDeleteObject.mockResolvedValue();
        const url = "https://firebasestorage.googleapis.com/v0/b/bucket/o/products%2Fimages%2Ftest.jpg?alt=media";

        await deleteImageByUrl(url);
        expect(mockDeleteObject).toHaveBeenCalled();
    });

    it("should not call deleteObject when URL has no /o/ segment", async () => {
        await deleteImageByUrl("https://example.com/image.jpg");
        expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("should not call deleteObject for an empty URL", async () => {
        await deleteImageByUrl("");
        expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("should not throw when the object is already deleted (object-not-found)", async () => {
        mockDeleteObject.mockRejectedValue({ code: "storage/object-not-found" });
        const url = "https://firebasestorage.googleapis.com/v0/b/bucket/o/products%2Fimages%2Ftest.jpg?alt=media";
        await expect(deleteImageByUrl(url)).resolves.not.toThrow();
    });

    it("should rethrow errors that are not object-not-found", async () => {
        mockDeleteObject.mockRejectedValue({ code: "storage/unauthorized" });
        const url = "https://firebasestorage.googleapis.com/v0/b/bucket/o/products%2Fimages%2Ftest.jpg?alt=media";
        await expect(deleteImageByUrl(url)).rejects.toMatchObject({ code: "storage/unauthorized" });
    });
});