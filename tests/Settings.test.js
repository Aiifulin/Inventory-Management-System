import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    checkAdminAccess,
    updateUserRoleLogic,
    saveSettingsLogic,
    loadUsersLogic
} from "./Settings.js";

const { mockGetDoc, mockUpdateDoc, mockSetDoc, mockGetDocs, mockDoc, mockCollection } = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockSetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    doc: mockDoc,
    getDoc: mockGetDoc,
    updateDoc: mockUpdateDoc,
    setDoc: mockSetDoc,
    collection: mockCollection,
    getDocs: mockGetDocs
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

describe("Settings / Admin Page Logic", () => {

    beforeEach(() => vi.clearAllMocks());

    // ─── checkAdminAccess ─────────────────────────────────────────────────────
    describe("checkAdminAccess", () => {
        it("should return true if user role is 'admin'", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'admin' }) });
            expect(await checkAdminAccess("uid_admin", {})).toBe(true);
        });

        it("should return false if user role is 'user'", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'user' }) });
            expect(await checkAdminAccess("uid_user", {})).toBe(false);
        });

        it("should return true for hardcoded fallback ID even if doc missing", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            expect(await checkAdminAccess("eisTKTAY9LfdMpXZ7ebo0spRDAN2", {})).toBe(true);
        });

        it("should return false for unknown UID with no document", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            expect(await checkAdminAccess("unknown_uid", {})).toBe(false);
        });

        it("should return false on Firestore error", async () => {
            mockGetDoc.mockRejectedValue(new Error("error"));
            expect(await checkAdminAccess("uid1", {})).toBe(false);
        });
    });

    // ─── updateUserRoleLogic ──────────────────────────────────────────────────
    describe("updateUserRoleLogic", () => {
        it("should call updateDoc with the new role", async () => {
            await updateUserRoleLogic("target_uid", "admin", {});
            expect(mockUpdateDoc).toHaveBeenCalled();
            const updateCallArgs = mockUpdateDoc.mock.calls[0];
            expect(updateCallArgs[1]).toEqual({ role: "admin" });
        });

        it("should call updateDoc with 'user' role", async () => {
            await updateUserRoleLogic("target_uid", "user", {});
            const updateCallArgs = mockUpdateDoc.mock.calls[0];
            expect(updateCallArgs[1]).toEqual({ role: "user" });
        });

        it("should throw an error when userId is missing", async () => {
            await expect(updateUserRoleLogic("", "admin", {}))
                .rejects.toThrow("Invalid parameters");
        });

        it("should throw an error when newRole is missing", async () => {
            await expect(updateUserRoleLogic("uid123", "", {}))
                .rejects.toThrow("Invalid parameters");
        });
    });

    // ─── saveSettingsLogic ────────────────────────────────────────────────────
    describe("saveSettingsLogic", () => {
        it("should save a valid threshold to global_config", async () => {
            await saveSettingsLogic(15, "admin_uid", {});
            expect(mockSetDoc).toHaveBeenCalled();

            const setCallArgs = mockSetDoc.mock.calls[0];
            const data    = setCallArgs[1];
            const options = setCallArgs[2];

            expect(data.defaultLowStockThreshold).toBe(15);
            expect(data.updatedBy).toBe("admin_uid");
            expect(options.merge).toBe(true);
        });

        it("should save a threshold of zero (valid edge case)", async () => {
            await saveSettingsLogic(0, "uid", {});
            const data = mockSetDoc.mock.calls[0][1];
            expect(data.defaultLowStockThreshold).toBe(0);
        });

        it("should throw for a negative threshold", async () => {
            await expect(saveSettingsLogic(-5, "uid", {}))
                .rejects.toThrow("Please enter a valid Low Stock Threshold");
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it("should throw for NaN threshold", async () => {
            await expect(saveSettingsLogic(NaN, "uid", {}))
                .rejects.toThrow("Please enter a valid Low Stock Threshold");
        });
    });

    // ─── loadUsersLogic ───────────────────────────────────────────────────────
    describe("loadUsersLogic", () => {
        it("should fetch all users and format them", async () => {
            const mockData = [
                { id: "u1", data: () => ({ name: "Alice", role: "admin" }) },
                { id: "u2", data: () => ({ name: "Bob",   role: "user"  }) }
            ];
            mockGetDocs.mockResolvedValue({
                empty: false,
                forEach: (cb) => mockData.forEach(cb)
            });

            const users = await loadUsersLogic({});
            expect(users).toHaveLength(2);
            expect(users[0].name).toBe("Alice");
            expect(users[1].role).toBe("user");
        });

        it("should return an empty array when no users exist", async () => {
            mockGetDocs.mockResolvedValue({
                empty: true,
                forEach: () => {}
            });
            const users = await loadUsersLogic({});
            expect(users).toHaveLength(0);
        });

        it("should include user IDs in the returned objects", async () => {
            const mockData = [{ id: "u1", data: () => ({ name: "Alice" }) }];
            mockGetDocs.mockResolvedValue({ empty: false, forEach: (cb) => mockData.forEach(cb) });
            const users = await loadUsersLogic({});
            expect(users[0].id).toBe("u1");
        });
    });
});