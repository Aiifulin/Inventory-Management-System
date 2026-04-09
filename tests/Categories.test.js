import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    checkAdminRole,
    sanitizeCategoryInput,
    fetchCategoriesLogic,
    archiveCategoryLogic,
    filterCategoriesLogic,
    checkDuplicateCategoryName,
    doSignOut
} from "./Categories.js";

import { signOut } from "firebase/auth";

const { mockGetDoc, mockGetDocs, mockUpdateDoc, mockAddDoc, mockDoc, mockCollection, mockQuery, mockWhere } = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockUpdateDoc: vi.fn(),
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
    addDoc: mockAddDoc,
    collection: mockCollection,
    query: mockQuery,
    where: mockWhere,
    serverTimestamp: () => "MOCK_TIME"
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

describe("Categories Logic", () => {

    beforeEach(() => vi.clearAllMocks());

    // ─── checkAdminRole ───────────────────────────────────────────────────────
    describe("checkAdminRole", () => {
        it("should return true for admin role", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'admin' }) });
            expect(await checkAdminRole("uid1", {})).toBe(true);
        });

        it("should return false for user role", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'user' }) });
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });

        it("should return false when document does not exist", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });

        it("should return false on Firestore error", async () => {
            mockGetDoc.mockRejectedValue(new Error("Network error"));
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });
    });

    // ─── sanitizeCategoryInput ────────────────────────────────────────────────
    describe("sanitizeCategoryInput", () => {
        it("should escape < and > characters", () => {
            expect(sanitizeCategoryInput("<script>")).toBe("&lt;script&gt;");
        });

        it("should return empty string for falsy input", () => {
            expect(sanitizeCategoryInput("")).toBe("");
            expect(sanitizeCategoryInput(null)).toBe("");
        });

        it("should not alter safe input", () => {
            expect(sanitizeCategoryInput("Electronics")).toBe("Electronics");
        });

        it("should convert numbers to strings", () => {
            expect(sanitizeCategoryInput(42)).toBe("42");
        });
    });

    // ─── fetchCategoriesLogic ─────────────────────────────────────────────────
    describe("fetchCategoriesLogic", () => {
        it("should return only non-archived categories", async () => {
            const mockData = [
                { id: "1", data: () => ({ name: "Electronics", archived: false }) },
                { id: "2", data: () => ({ name: "Old Category",  archived: true  }) },
                { id: "3", data: () => ({ name: "Furniture"                       }) }
            ];
            mockGetDocs.mockResolvedValue({ forEach: (cb) => mockData.forEach(cb) });

            const cats = await fetchCategoriesLogic({});
            expect(cats).toHaveLength(2);
            expect(cats.map(c => c.name)).toContain("Electronics");
            expect(cats.map(c => c.name)).not.toContain("Old Category");
        });

        it("should return an empty array when all are archived", async () => {
            const mockData = [
                { id: "1", data: () => ({ name: "A", archived: true }) }
            ];
            mockGetDocs.mockResolvedValue({ forEach: (cb) => mockData.forEach(cb) });
            const cats = await fetchCategoriesLogic({});
            expect(cats).toHaveLength(0);
        });

        it("should include the document ID in each category", async () => {
            const mockData = [{ id: "cat_1", data: () => ({ name: "Kitchenware" }) }];
            mockGetDocs.mockResolvedValue({ forEach: (cb) => mockData.forEach(cb) });
            const cats = await fetchCategoriesLogic({});
            expect(cats[0].id).toBe("cat_1");
        });
    });

    // ─── archiveCategoryLogic ─────────────────────────────────────────────────
    describe("archiveCategoryLogic", () => {
        it("should mark category as archived and log the activity", async () => {
            const mockAuth = { currentUser: { email: "admin@test.com" } };

            await archiveCategoryLogic("cat_1", "Electronics", {}, mockAuth);

            expect(mockUpdateDoc).toHaveBeenCalled();
            expect(mockAddDoc).toHaveBeenCalled();

            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Archived Category");
            expect(logData.target).toBe("Electronics");
            expect(logData.user).toBe("admin@test.com");
        });

        it("should use 'Admin' when currentUser is null", async () => {
            await archiveCategoryLogic("cat_1", "Test", {}, { currentUser: null });
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.user).toBe("Admin");
        });
    });

    // ─── filterCategoriesLogic ────────────────────────────────────────────────
    describe("filterCategoriesLogic", () => {
        const categories = [
            { id: "1", name: "Electronics" },
            { id: "2", name: "Furniture"   },
            { id: "3", name: "Kitchenware" }
        ];

        it("should filter categories by name (case insensitive)", () => {
            const result = filterCategoriesLogic(categories, "elec");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Electronics");
        });

        it("should return all categories when search is empty", () => {
            expect(filterCategoriesLogic(categories, "")).toHaveLength(3);
        });

        it("should return empty array when nothing matches", () => {
            expect(filterCategoriesLogic(categories, "zzznomatch")).toHaveLength(0);
        });

        it("should match partial strings", () => {
            const result = filterCategoriesLogic(categories, "ware");
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Kitchenware");
        });
    });

    // ─── checkDuplicateCategoryName ───────────────────────────────────────────
    describe("checkDuplicateCategoryName", () => {
        it("should return true when an active duplicate exists", async () => {
            mockGetDocs.mockResolvedValue({
                docs: [{ data: () => ({ name: "Electronics", archived: false }) }]
            });
            const isDup = await checkDuplicateCategoryName("Electronics", {});
            expect(isDup).toBe(true);
        });

        it("should return false when the only match is archived", async () => {
            mockGetDocs.mockResolvedValue({
                docs: [{ data: () => ({ name: "Electronics", archived: true }) }]
            });
            const isDup = await checkDuplicateCategoryName("Electronics", {});
            expect(isDup).toBe(false);
        });

        it("should return false when no matching category exists", async () => {
            mockGetDocs.mockResolvedValue({ docs: [] });
            const isDup = await checkDuplicateCategoryName("New Category", {});
            expect(isDup).toBe(false);
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