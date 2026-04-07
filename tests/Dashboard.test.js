import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAdminRole, calculateStats, loadDashboardStats } from "./Dashboard.js";

const { mockGetDocs, mockGetDoc, mockDoc, mockCollection } = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockGetDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    collection: mockCollection,
    getDocs: mockGetDocs,
    doc: mockDoc,
    getDoc: mockGetDoc,
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(),
    initializeApp: vi.fn()
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

describe("Dashboard Logic", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `
            <div id="statTotalProducts"></div>
            <div id="statTotalValue"></div>
            <div id="statLowStock"></div>
            <div id="statCategories"></div>
        `;
    });

    // ─── checkAdminRole ───────────────────────────────────────────────────────
    describe("checkAdminRole", () => {
        it("should return true if user is admin (case insensitive)", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'AdMin' })
            });
            expect(await checkAdminRole("uid123", {})).toBe(true);
        });

        it("should return false if user role is 'user'", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'user' })
            });
            expect(await checkAdminRole("uid123", {})).toBe(false);
        });

        it("should return false if user document does not exist", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            expect(await checkAdminRole("uid123", {})).toBe(false);
        });

        it("should return false if Firestore throws an error", async () => {
            mockGetDoc.mockRejectedValue(new Error("Network error"));
            expect(await checkAdminRole("uid123", {})).toBe(false);
        });

        it("should return false if role is missing from user document", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({})
            });
            expect(await checkAdminRole("uid123", {})).toBe(false);
        });
    });

    // ─── calculateStats ───────────────────────────────────────────────────────
    describe("calculateStats", () => {
        it("should correctly calculate totals, values, and low stock", () => {
            const products = [
                { name: "High Stock Item", stock: 100, price: 10, category: "A", lowStockThreshold: 10 },
                { name: "Low Stock Item",  stock: 5,   price: 20, category: "B", lowStockThreshold: 10 },
                { name: "Zero Stock Item", stock: 0,   price: 50, category: "A", lowStockThreshold: 5  }
            ];
            const stats = calculateStats(products);

            expect(stats.totalProducts).toBe(3);
            // (100*10) + (5*20) + (0*50) = 1100
            expect(stats.totalValue).toBe(1100);
            expect(stats.categoriesCount).toBe(2);
            // stock 5 <= threshold 10 AND stock 0 <= threshold 5
            expect(stats.lowStockCount).toBe(2);
        });

        it("should return zero stats for an empty product list", () => {
            const stats = calculateStats([]);
            expect(stats.totalProducts).toBe(0);
            expect(stats.totalValue).toBe(0);
            expect(stats.categoriesCount).toBe(0);
            expect(stats.lowStockCount).toBe(0);
            expect(stats.lowStockItems).toHaveLength(0);
        });

        it("should treat a product with stock exactly equal to threshold as low stock", () => {
            const products = [
                { name: "Edge Case", stock: 10, price: 5, category: "X", lowStockThreshold: 10 }
            ];
            const stats = calculateStats(products);
            expect(stats.lowStockCount).toBe(1);
        });

        it("should group products by category correctly", () => {
            const products = [
                { name: "A1", stock: 10, price: 5, category: "Electronics", lowStockThreshold: 5 },
                { name: "A2", stock: 20, price: 5, category: "Electronics", lowStockThreshold: 5 },
                { name: "B1", stock: 10, price: 5, category: "Furniture",   lowStockThreshold: 5 }
            ];
            const stats = calculateStats(products);
            expect(stats.categoriesCount).toBe(2);
            expect(stats.categoryMap["Electronics"].count).toBe(2);
            expect(stats.categoryMap["Furniture"].count).toBe(1);
        });

        it("should assign 'Uncategorized' for products missing a category", () => {
            const products = [
                { name: "Mystery Item", stock: 5, price: 10, lowStockThreshold: 3 }
            ];
            const stats = calculateStats(products);
            expect(stats.categoryMap["Uncategorized"]).toBeDefined();
        });

        it("should handle non-numeric stock/price gracefully", () => {
            const products = [
                { name: "Bad Data", stock: "abc", price: null, category: "Test", lowStockThreshold: 5 }
            ];
            const stats = calculateStats(products);
            expect(stats.totalValue).toBe(0);
        });
    });

    // ─── loadDashboardStats ───────────────────────────────────────────────────
    describe("loadDashboardStats", () => {
        it("should fetch data and update the DOM elements", async () => {
            const mockData = [
                { data: () => ({ name: "P1", stock: 10, price: 100 }) },
                { data: () => ({ name: "P2", stock: 5,  price: 50  }) }
            ];
            mockGetDocs.mockResolvedValue({
                forEach: (cb) => mockData.forEach(cb)
            });

            await loadDashboardStats({});

            expect(String(document.getElementById("statTotalProducts").innerText)).toBe("2");
            expect(document.getElementById("statTotalValue").innerText).not.toBe("");
        });

        it("should return null when Firestore throws", async () => {
            mockGetDocs.mockRejectedValue(new Error("Firestore unavailable"));
            const result = await loadDashboardStats({});
            expect(result).toBeNull();
        });

        it("should return stats object on success", async () => {
            mockGetDocs.mockResolvedValue({
                forEach: (cb) => [
                    { data: () => ({ name: "X", stock: 5, price: 10, category: "A", lowStockThreshold: 10 }) }
                ].forEach(cb)
            });
            const result = await loadDashboardStats({});
            expect(result).not.toBeNull();
            expect(result.totalProducts).toBe(1);
        });
    });
});