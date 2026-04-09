import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    checkAdminRole,
    fetchProductsLogic,
    deleteProductLogic,
    filterProductsLogic,
    sortProductsLogic,
    doSignOut
} from "./Products.js";

import { signOut } from "firebase/auth";

const { mockGetDocs, mockDeleteDoc, mockAddDoc, mockDoc, mockCollection, mockGetDoc } = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockDeleteDoc: vi.fn(),
    mockAddDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockGetDoc: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    collection: mockCollection,
    getDocs: mockGetDocs,
    deleteDoc: mockDeleteDoc,
    doc: mockDoc,
    addDoc: mockAddDoc,
    getDoc: mockGetDoc,
    serverTimestamp: () => "MOCK_TIME"
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

describe("Product List Logic", () => {

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
            mockGetDoc.mockRejectedValue(new Error("error"));
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });
    });

    // ─── fetchProductsLogic ───────────────────────────────────────────────────
    describe("fetchProductsLogic", () => {
        it("should fetch and format products with IDs", async () => {
            const mockData = [
                { id: "1", data: () => ({ name: "Apple", price: 10 }) },
                { id: "2", data: () => ({ name: "Banana", price: 5  }) }
            ];
            mockGetDocs.mockResolvedValue({ forEach: (cb) => mockData.forEach(cb) });

            const products = await fetchProductsLogic({});
            expect(products).toHaveLength(2);
            expect(products[0].name).toBe("Apple");
            expect(products[0].id).toBe("1");
        });

        it("should return an empty array when no products exist", async () => {
            mockGetDocs.mockResolvedValue({ forEach: () => {} });
            const products = await fetchProductsLogic({});
            expect(products).toHaveLength(0);
        });
    });

    // ─── deleteProductLogic ───────────────────────────────────────────────────
    describe("deleteProductLogic", () => {
        it("should delete doc and log activity", async () => {
            const allProducts = [{ id: "123", name: "Old Phone" }];
            const mockAuth = { currentUser: { email: "admin@test.com" } };

            await deleteProductLogic("123", allProducts, {}, mockAuth);

            expect(mockDeleteDoc).toHaveBeenCalled();
            expect(mockAddDoc).toHaveBeenCalled();

            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Deleted Product");
            expect(logData.target).toBe("Old Phone");
        });

        it("should log 'Unknown Product' if ID is not found in allProducts", async () => {
            await deleteProductLogic("999", [], {}, { currentUser: { email: "a@b.com" } });
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.target).toBe("Unknown Product");
        });
    });

    // ─── filterProductsLogic ─────────────────────────────────────────────────
    describe("filterProductsLogic", () => {
        const products = [
            { name: "Gaming Mouse",  category: "Electronics", price: 75,  stock: 20, lowStockThreshold: 5  },
            { name: "Office Chair",  category: "Furniture",   price: 300, stock: 3,  lowStockThreshold: 5  },
            { name: "USB Hub",       category: "Electronics", price: 25,  stock: 0,  lowStockThreshold: 5  },
            { name: "Standing Desk", category: "Furniture",   price: 1200,stock: 10, lowStockThreshold: 5  }
        ];

        it("should filter by search text (name)", () => {
            const result = filterProductsLogic(products, { searchVal: "mouse", catVal: "", priceRangeVal: "", statusVal: "" });
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Gaming Mouse");
        });

        it("should filter by category", () => {
            const result = filterProductsLogic(products, { searchVal: "", catVal: "Furniture", priceRangeVal: "", statusVal: "" });
            expect(result).toHaveLength(2);
        });

        it("should filter by out-of-stock status", () => {
            const result = filterProductsLogic(products, { searchVal: "", catVal: "", priceRangeVal: "", statusVal: "out-of-stock" });
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("USB Hub");
        });

        it("should filter by low-stock status", () => {
            const result = filterProductsLogic(products, { searchVal: "", catVal: "", priceRangeVal: "", statusVal: "low-stock" });
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Office Chair");
        });

        it("should filter by price range", () => {
            const result = filterProductsLogic(products, { searchVal: "", catVal: "", priceRangeVal: "51-100", statusVal: "" });
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Gaming Mouse");
        });

        it("should filter by price range 1000+", () => {
            const result = filterProductsLogic(products, { searchVal: "", catVal: "", priceRangeVal: "1000+", statusVal: "" });
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Standing Desk");
        });

        it("should return all products when no filters are applied", () => {
            const result = filterProductsLogic(products, { searchVal: "", catVal: "", priceRangeVal: "", statusVal: "" });
            expect(result).toHaveLength(4);
        });

        it("should return empty array when nothing matches", () => {
            const result = filterProductsLogic(products, { searchVal: "zzznomatch", catVal: "", priceRangeVal: "", statusVal: "" });
            expect(result).toHaveLength(0);
        });
    });

    // ─── sortProductsLogic ────────────────────────────────────────────────────
    describe("sortProductsLogic", () => {
        const products = [
            { name: "Banana", price: 100, stock: 50 },
            { name: "Apple",  price: 50,  stock: 10 },
            { name: "Cherry", price: 200, stock: 30 }
        ];

        it("should sort by price ascending", () => {
            const sorted = sortProductsLogic(products, 'price', 'asc');
            expect(sorted[0].price).toBe(50);
            expect(sorted[2].price).toBe(200);
        });

        it("should sort by price descending", () => {
            const sorted = sortProductsLogic(products, 'price', 'desc');
            expect(sorted[0].price).toBe(200);
            expect(sorted[2].price).toBe(50);
        });

        it("should sort by name ascending (alphabetical)", () => {
            const sorted = sortProductsLogic(products, 'name', 'asc');
            expect(sorted[0].name).toBe("Apple");
            expect(sorted[2].name).toBe("Cherry");
        });

        it("should sort by stock ascending", () => {
            const sorted = sortProductsLogic(products, 'stock', 'asc');
            expect(sorted[0].stock).toBe(10);
            expect(sorted[2].stock).toBe(50);
        });

        it("should not mutate the original array", () => {
            const original = [...products];
            sortProductsLogic(products, 'price', 'desc');
            expect(products[0].name).toBe(original[0].name);
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