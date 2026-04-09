import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    checkAdminRole,
    restoreItemLogic,
    permanentDeleteLogic,
    fetchArchivedItemsLogic,
    searchArchivedItems,
    doSignOut
} from "./Archives.js";

import { signOut } from "firebase/auth";

const { mockGetDoc, mockGetDocs, mockUpdateDoc, mockDeleteDoc, mockAddDoc, mockDoc, mockCollection, mockQuery, mockWhere } = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockDeleteDoc: vi.fn(),
    mockAddDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockQuery: vi.fn(),
    mockWhere: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    doc: mockDoc,
    getDoc: mockGetDoc,
    getDocs: mockGetDocs,
    updateDoc: mockUpdateDoc,
    deleteDoc: mockDeleteDoc,
    addDoc: mockAddDoc,
    collection: mockCollection,
    query: mockQuery,
    where: mockWhere,
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    serverTimestamp: () => "MOCK_TIME"
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

describe("Archives Logic", () => {

    beforeEach(() => vi.clearAllMocks());

    // ─── checkAdminRole ───────────────────────────────────────────────────────
    describe("checkAdminRole", () => {
        it("should return true for admin", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'admin' }) });
            expect(await checkAdminRole("uid1", {})).toBe(true);
        });

        it("should return false for non-admin", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'user' }) });
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });

        it("should return false when doc doesn't exist", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });

        it("should return false on error", async () => {
            mockGetDoc.mockRejectedValue(new Error("error"));
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });
    });

    // ─── restoreItemLogic ─────────────────────────────────────────────────────
    describe("restoreItemLogic", () => {
        const mockAuth = { currentUser: { email: "admin@test.com" } };

        it("should call updateDoc to set archived:false for a product", async () => {
            await restoreItemLogic("products", "prod_1", "Laptop", {}, mockAuth);

            expect(mockUpdateDoc).toHaveBeenCalled();
            const updateData = mockUpdateDoc.mock.calls[0][1];
            expect(updateData.archived).toBe(false);
            expect(updateData.archivedAt).toBeNull();
        });

        it("should log 'Restore Product' activity for products", async () => {
            await restoreItemLogic("products", "prod_1", "Laptop", {}, mockAuth);
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Restore Product");
            expect(logData.target).toBe("Laptop");
        });

        it("should log 'Restore Category' activity for categories", async () => {
            await restoreItemLogic("categories", "cat_1", "Electronics", {}, mockAuth);
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Restore Category");
        });

        it("should use 'Admin' as user when currentUser is null", async () => {
            await restoreItemLogic("products", "p1", "Item", {}, { currentUser: null });
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.user).toBe("Admin");
        });

        it("should return true on success", async () => {
            const result = await restoreItemLogic("products", "p1", "Item", {}, mockAuth);
            expect(result).toBe(true);
        });
    });

    // ─── permanentDeleteLogic ─────────────────────────────────────────────────
    describe("permanentDeleteLogic", () => {
        const mockAuth = { currentUser: { email: "admin@test.com" } };

        it("should call deleteDoc for the given item", async () => {
            await permanentDeleteLogic("products", "prod_1", "Old Laptop", {}, mockAuth);
            expect(mockDeleteDoc).toHaveBeenCalled();
        });

        it("should log 'Delete Product Permanently' for products", async () => {
            await permanentDeleteLogic("products", "prod_1", "Old Laptop", {}, mockAuth);
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Delete Product Permanently");
            expect(logData.target).toBe("Old Laptop");
        });

        it("should log 'Delete Category Permanently' for categories", async () => {
            await permanentDeleteLogic("categories", "cat_1", "Old Cat", {}, mockAuth);
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Delete Category Permanently");
        });

        it("should NOT call updateDoc (hard delete, not soft)", async () => {
            await permanentDeleteLogic("products", "p1", "Item", {}, mockAuth);
            expect(mockUpdateDoc).not.toHaveBeenCalled();
        });

        it("should return true on success", async () => {
            const result = await permanentDeleteLogic("products", "p1", "Item", {}, mockAuth);
            expect(result).toBe(true);
        });
    });

    // ─── fetchArchivedItemsLogic ──────────────────────────────────────────────
    describe("fetchArchivedItemsLogic", () => {
        it("should return all archived products", async () => {
            const mockData = [
                { id: "p1", data: () => ({ name: "Old Phone",  archived: true }) },
                { id: "p2", data: () => ({ name: "Old Tablet", archived: true }) }
            ];
            mockGetDocs.mockResolvedValue({ forEach: (cb) => mockData.forEach(cb) });

            const items = await fetchArchivedItemsLogic("products", {});
            expect(items).toHaveLength(2);
            expect(items[0].name).toBe("Old Phone");
            expect(items[0].id).toBe("p1");
        });

        it("should return an empty array when no archived items exist", async () => {
            mockGetDocs.mockResolvedValue({ forEach: () => {} });
            const items = await fetchArchivedItemsLogic("products", {});
            expect(items).toHaveLength(0);
        });
    });

    // ─── searchArchivedItems ──────────────────────────────────────────────────
    describe("searchArchivedItems", () => {
        const items = [
            { id: "1", name: "Old Laptop",   category: "Electronics" },
            { id: "2", name: "Broken Chair", category: "Furniture"   },
            { id: "3", name: "Dusty Mouse",  category: "Electronics" }
        ];

        it("should filter by name (case insensitive)", () => {
            const result = searchArchivedItems(items, "laptop");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Old Laptop");
        });

        it("should filter by category", () => {
            const result = searchArchivedItems(items, "electronics");
            expect(result).toHaveLength(2);
        });

        it("should return all items when search is empty", () => {
            expect(searchArchivedItems(items, "")).toHaveLength(3);
        });

        it("should return empty array when nothing matches", () => {
            expect(searchArchivedItems(items, "zzznomatch")).toHaveLength(0);
        });
    });

    describe("Sign Out", () => {
        it("should clear storage and call signOut", async () => {
            // Arrange
            localStorage.setItem("user_session", "test");
            localStorage.setItem("user_uid", "123");
            localStorage.setItem("user_role", "admin");
            sessionStorage.setItem("something", "value");
        
            signOut.mockResolvedValue(); // mock Firebase signOut
        
            // Act
            await doSignOut({}); // pass fake auth instance
        
            // Assert
            expect(localStorage.getItem("user_session")).toBeNull();
            expect(localStorage.getItem("user_uid")).toBeNull();
            expect(localStorage.getItem("user_role")).toBeNull();
            expect(sessionStorage.length).toBe(0);
        
            expect(signOut).toHaveBeenCalled();
        });
    });
});