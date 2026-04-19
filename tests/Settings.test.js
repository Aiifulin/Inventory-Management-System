// tests/Settings.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCachedUserData, checkAndRunBackup } from "../public/js/Settings.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockSetDoc,
    mockUpdateDoc,
    mockDoc,
    mockCollection,
    mockAddDoc,
} = vi.hoisted(() => ({
    mockGetDoc:    vi.fn(),
    mockGetDocs:   vi.fn(),
    mockSetDoc:    vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockDoc:       vi.fn(() => ({})),
    mockCollection: vi.fn(() => ({})),
    mockAddDoc:    vi.fn(),
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    doc:             mockDoc,
    getDoc:          mockGetDoc,
    getDocs:         mockGetDocs,
    setDoc:          mockSetDoc,
    updateDoc:       mockUpdateDoc,
    addDoc:          mockAddDoc,
    collection:      mockCollection,
    serverTimestamp: vi.fn(() => ({ _seconds: Date.now() / 1000 })),
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn(),
}));

vi.mock("../public/js/firebase.js", () => ({
    auth:    { currentUser: { email: "admin@test.com", uid: "admin-uid" } },
    db:      {},
    storage: {},
}));

vi.mock("../public/js/logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn()),
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

global.document = {
    getElementById:   vi.fn(() => ({
        textContent: '',
        style: {},
        innerHTML: '',
        checked: false,
        value: '10',
        classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
        appendChild: vi.fn(),
        addEventListener: vi.fn(),
        querySelector: vi.fn(() => null),
    })),
    querySelector:    vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => ({
        className: '', innerHTML: '', style: {}, appendChild: vi.fn(),
    })),
    documentElement: { style: {}, setAttribute: vi.fn() },
};

global.window = {
    location:         { href: '', replace: vi.fn() },
    addEventListener: vi.fn(),
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

describe("Settings — getCachedUserData", () => {
    const uid      = "user-abc";
    const cacheKey = `user_data_${uid}`;
    const fakeUser = { name: "Alice", role: "admin" };

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
        expect(consoleSpy).toHaveBeenCalledWith(
            "Error fetching user data:",
            expect.any(Error),
        );
        consoleSpy.mockRestore();
    });
});


describe("Settings — checkAndRunBackup", () => {

    function daysAgo(n) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return d;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        defaultGetDocsMock();
    });

    it("should trigger a backup when days elapsed equals intervalDays (boundary)", async () => {
        mockGetDocs.mockResolvedValue({ forEach: vi.fn() });

        await checkAndRunBackup(7, daysAgo(7));

        expect(mockGetDocs).toHaveBeenCalledOnce();
    });

    it("should trigger a backup when days elapsed exceeds intervalDays", async () => {
        mockGetDocs.mockResolvedValue({ forEach: vi.fn() });

        await checkAndRunBackup(7, daysAgo(10));

        expect(mockGetDocs).toHaveBeenCalledOnce();
    });

    it("should NOT trigger a backup when days elapsed is less than intervalDays", async () => {
        await checkAndRunBackup(7, daysAgo(3));

        expect(mockGetDocs).not.toHaveBeenCalled();
    });
});