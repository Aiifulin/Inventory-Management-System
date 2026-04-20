import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    logActivity
} from "../public/js/Edit_Categories.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockAddDoc,
    mockDoc,
    mockCollection,
    mockQuery,
    mockWhere,
    mockGetDocs,
    mockUpdateDoc
} = vi.hoisted(() => ({
    mockGetDoc:    vi.fn(),
    mockAddDoc:    vi.fn(),
    mockDoc:       vi.fn(() => ({})),
    mockCollection: vi.fn(() => ({})),
    mockQuery:     vi.fn(() => ({})),
    mockWhere:     vi.fn(() => ({})),
    mockGetDocs:   vi.fn(),
    mockUpdateDoc: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    doc:             mockDoc,
    getDoc:          mockGetDoc,
    updateDoc:       mockUpdateDoc,
    collection:      mockCollection,
    addDoc:          mockAddDoc,
    serverTimestamp: vi.fn(() => "MOCK_TIME"),
    query:           mockQuery,
    where:           mockWhere,
    getDocs:         mockGetDocs,
    initializeApp:   vi.fn()
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
    dataset:     {},
    classList:   { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    getAttribute: vi.fn(() => null)
});

global.document = {
    getElementById:   vi.fn(() => makeElement()),
    querySelector:    vi.fn(() => makeElement()),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => makeElement()),
    documentElement:  { style: {}, getAttribute: vi.fn(() => null) }
};

global.window = {
    location:         { href: "", replace: vi.fn() },
    addEventListener: vi.fn(),
    URLSearchParams:  class { get() { return "test-category-id"; } }
};

global.alert = vi.fn();

// Default safe mock
const defaultGetDocs = () =>
    mockGetDocs.mockResolvedValue({ docs: [], forEach: vi.fn() });

// ==========================================
// TEST SUITES
// ==========================================

describe("Edit_Categories — getCachedUserData", () => {

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

    it("should derive admin status correctly from cached data", async () => {
        const user = { role: "admin", name: "Alice" };
        sessionStorage.setItem("user_data_uid-1", JSON.stringify(user));
        const result = await getCachedUserData("uid-1");
        expect(result?.role?.toLowerCase()).toBe("admin");
    });

    it("should return false for admin check when role is 'user'", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data:   () => ({ role: "user" })
        });
        const result = await getCachedUserData("uid-1");
        expect(result?.role?.toLowerCase() === "admin").toBe(false);
    });
});

// ==========================================

describe("Edit_Categories — logActivity", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocs();
    });

    it("should call addDoc with correct action and target", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Category", "Electronics");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Updated Category",
                target: "Electronics"
            })
        );
    });

    it("should include the current user email in the log", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Category", "Electronics");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ user: "admin@test.com" })
        );
    });

    it("should include a timestamp in the log entry", async () => {
        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Category", "Electronics");
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ timestamp: expect.anything() })
        );
    });

    it("should not throw when addDoc fails", async () => {
        mockAddDoc.mockRejectedValue(new Error("Firestore error"));
        await expect(logActivity("Updated Category", "Electronics")).resolves.not.toThrow();
    });

    it("should log with 'Admin' fallback when no current user", async () => {
        // Temporarily override auth mock to simulate no current user
        const { db, auth } = await import("../public/js/firebase.js");
        const originalUser = auth.currentUser;
        auth.currentUser = null;

        mockAddDoc.mockResolvedValue();
        await logActivity("Updated Category", "Electronics");

        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ user: "Admin" })
        );

        auth.currentUser = originalUser; // restore
    });
});