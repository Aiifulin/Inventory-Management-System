// tests/Settings.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
    checkAdminAccess, 
    updateUserRoleLogic, 
    saveSettingsLogic,
    loadUsersLogic
} from "./Settings.js";

// --- HOISTED MOCKS ---
const { mockGetDoc, mockUpdateDoc, mockSetDoc, mockGetDocs, mockDoc, mockCollection } = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockSetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn()
}));

// --- MOCK FIREBASE ---
vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    doc: mockDoc,
    getDoc: mockGetDoc,
    updateDoc: mockUpdateDoc,
    setDoc: mockSetDoc,
    collection: mockCollection,
    getDocs: mockGetDocs
}));

describe("Settings / Admin Page Logic", () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // TEST 1: Admin Access Check
    describe("checkAdminAccess", () => {
        it("should return true if user role is 'admin'", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'admin' })
            });
            const result = await checkAdminAccess("uid_admin", {});
            expect(result).toBe(true);
        });

        it("should return false if user role is 'user'", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'user' })
            });
            const result = await checkAdminAccess("uid_user", {});
            expect(result).toBe(false);
        });

        it("should return true for hardcoded fallback ID even if doc missing", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            // Using the specific ID from your source code
            const result = await checkAdminAccess("eisTKTAY9LfdMpXZ7ebo0spRDAN2", {});
            expect(result).toBe(true);
        });
    });

    // TEST 2: Update User Role
    describe("updateUserRoleLogic", () => {
        it("should call updateDoc with new role", async () => {
            await updateUserRoleLogic("target_user_id", "admin", {});
            
            expect(mockUpdateDoc).toHaveBeenCalled();
            // Verify arguments passed to updateDoc (2nd arg is the data)
            const updateCallArgs = mockUpdateDoc.mock.calls[0];
            expect(updateCallArgs[1]).toEqual({ role: "admin" });
        });
    });

    // TEST 3: Save Settings
    describe("saveSettingsLogic", () => {
        it("should save valid threshold to global_config", async () => {
            await saveSettingsLogic(15, "admin_uid", {});

            expect(mockSetDoc).toHaveBeenCalled();
            const setCallArgs = mockSetDoc.mock.calls[0];
            const data = setCallArgs[1];
            const options = setCallArgs[2];

            expect(data.defaultLowStockThreshold).toBe(15);
            expect(data.updatedBy).toBe("admin_uid");
            expect(options.merge).toBe(true);
        });

        it("should throw error for negative threshold", async () => {
            await expect(saveSettingsLogic(-5, "uid", {}))
                .rejects.toThrow("Please enter a valid Low Stock Threshold");
            
            expect(mockSetDoc).not.toHaveBeenCalled();
        });
    });

    // TEST 4: Load Users Table
    describe("loadUsersLogic", () => {
        it("should fetch all users and format them", async () => {
            const mockData = [
                { id: "u1", data: () => ({ name: "Alice", role: "admin" }) },
                { id: "u2", data: () => ({ name: "Bob", role: "user" }) }
            ];

            mockGetDocs.mockResolvedValue({
                empty: false,
                forEach: (cb) => mockData.forEach(cb)
            });

            const users = await loadUsersLogic({});
            
            expect(users.length).toBe(2);
            expect(users[0].name).toBe("Alice");
            expect(users[1].role).toBe("user");
        });
    });

});