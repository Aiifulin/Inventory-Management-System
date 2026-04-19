import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCachedUserData,
    logActivity,
    fetchProducts,
    saveProductsCache,
    loadProductsCache,
    validateImportData,
    importProducts,
    readExcelFile,
    exportToExcel
} from "../public/js/Products.js";

// ==========================================
// HOISTED MOCKS
// ==========================================
const {
    mockGetDocs,
    mockAddDoc,
    mockDoc,
    mockCollection,
    mockGetDoc,
    mockQuery,
    mockWhere,
    mockUpdateDoc,
    mockServerTimestamp
} = vi.hoisted(() => ({
    mockGetDocs:         vi.fn(),
    mockAddDoc:          vi.fn(),
    mockDoc:             vi.fn(() => ({})),
    mockCollection:      vi.fn(() => ({})),
    mockGetDoc:          vi.fn(),
    mockQuery:           vi.fn((...args) => args[0]),
    mockWhere:           vi.fn(() => ({})),
    mockUpdateDoc:       vi.fn(),
    mockServerTimestamp: vi.fn(() => "MOCK_TIMESTAMP")
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    collection:      mockCollection,
    getDocs:         mockGetDocs,
    doc:             mockDoc,
    addDoc:          mockAddDoc,
    getDoc:          mockGetDoc,
    updateDoc:       mockUpdateDoc,
    query:           mockQuery,
    where:           mockWhere,
    serverTimestamp: mockServerTimestamp
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn()
}));

vi.mock("../public/js/firebase.js", () => ({
    auth:    { currentUser: { uid: "uid-test", email: "admin@test.com" } },
    db:      {},
    storage: {}
}));

vi.mock("../public/js/logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn())
}));

// ==========================================
// STORAGE STUBS
// ==========================================
const makeStorage = () => {
    let store = {};
    const stub = {
        getItem:    vi.fn((k)    => store[k] ?? null),
        setItem:    vi.fn((k, v) => { store[k] = String(v); }),
        removeItem: vi.fn((k)    => { delete store[k]; }),
        clear:      vi.fn(()     => { store = {}; }),
        get length() { return Object.keys(store).length; },
        _store: () => store,
        _reset() {
            store = {};
            this.getItem.mockImplementation((k)    => store[k] ?? null);
            this.setItem.mockImplementation((k, v) => { store[k] = String(v); });
            this.removeItem.mockImplementation((k)  => { delete store[k]; });
            this.clear.mockImplementation(()        => { store = {}; });
        }
    };
    return stub;
};

global.sessionStorage = makeStorage();
global.localStorage   = makeStorage();

// ==========================================
// DOM STUB — getElementById must ALWAYS return
// an object with addEventListener so module-level
// calls like getElementById('exportBtn').addEventListener(...)
// don't crash on import.
// ==========================================
const makeSafeEl = () => ({
    value:          "",
    innerHTML:      "",
    textContent:    "",
    style:          {},
    disabled:       false,
    classList:      { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    appendChild:    vi.fn(),
    addEventListener: vi.fn(),
    getAttribute:   vi.fn(),
    setAttribute:   vi.fn(),
    querySelector:  vi.fn(() => makeSafeEl()),
    closest:        vi.fn()
});

global.document = {
    getElementById:   vi.fn(() => makeSafeEl()),
    querySelector:    vi.fn(() => makeSafeEl()),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => makeSafeEl()),
    body:             { insertAdjacentHTML: vi.fn() },
    documentElement:  { style: {} }
};

global.window = { location: { href: "", replace: vi.fn() } };

global.XLSX = {
    utils: {
        json_to_sheet:    vi.fn(() => ({})),
        book_new:         vi.fn(() => ({})),
        book_append_sheet: vi.fn(),
        sheet_to_json:    vi.fn()
    },
    read:      vi.fn(),
    writeFile: vi.fn()
};

// ==========================================
// HELPERS
// ==========================================
function makeDocsSnapshot(rows) {
    return { forEach: (cb) => rows.forEach(cb) };
}

// ==========================================
// TESTS
// ==========================================

describe("Products — saveProductsCache / loadProductsCache", () => {

    beforeEach(() => {
        global.sessionStorage._reset();
        vi.clearAllMocks();
    });

    it("should save and reload products from cache", () => {
        const products = [{
            id: "1", name: "Widget",
            createdAt: { seconds: 1700000000, toDate: () => new Date(1700000000 * 1000) }
        }];
        saveProductsCache(products);

        expect(global.sessionStorage.setItem).toHaveBeenCalled();

        const loaded = loadProductsCache();
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].name).toBe("Widget");
    });

    it("should restore createdAt.toDate() as a callable function", () => {
        const products = [{ id: "1", name: "A", createdAt: { seconds: 1700000000, toDate: () => new Date(1700000000000) } }];
        saveProductsCache(products);
        const loaded = loadProductsCache();
        expect(typeof loaded[0].createdAt.toDate).toBe("function");
        expect(loaded[0].createdAt.toDate()).toBeInstanceOf(Date);
    });

    it("should return null when cache is empty", () => {
        expect(loadProductsCache()).toBeNull();
    });

    it("should return null when cache is expired (>5 minutes)", () => {
        const products = [{ id: "1", name: "Old", createdAt: null }];
        saveProductsCache(products);

        const raw = JSON.parse(global.sessionStorage._store()['products_cache']);
        raw.cachedAt = Date.now() - 6 * 60 * 1000;
        global.sessionStorage._store()['products_cache'] = JSON.stringify(raw);

        expect(loadProductsCache()).toBeNull();
    });

    it("should handle products with null createdAt gracefully", () => {
        const products = [{ id: "1", name: "NoDate", createdAt: null }];
        saveProductsCache(products);
        const loaded = loadProductsCache();
        expect(loaded[0].createdAt).toBeNull();
    });
});

// ==========================================

describe("Products — getCachedUserData", () => {

    beforeEach(() => {
        global.sessionStorage._reset();
        vi.clearAllMocks();
    });

    it("should return cached data without hitting Firestore on second call", async () => {
        const userData = { name: "Alice", role: "admin" };
        global.sessionStorage.setItem("user_data_uid-1", JSON.stringify(userData));

        const result = await getCachedUserData("uid-1");

        expect(result).toEqual(userData);
        expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it("should fetch from Firestore and cache when not cached", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: "Bob", role: "user" }) });

        const result = await getCachedUserData("uid-2");

        expect(result.name).toBe("Bob");
        expect(mockGetDoc).toHaveBeenCalledTimes(1);
        expect(global.sessionStorage.setItem).toHaveBeenCalledWith(
            "user_data_uid-2",
            JSON.stringify({ name: "Bob", role: "user" })
        );
    });

    it("should return null when user document does not exist", async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        const result = await getCachedUserData("uid-ghost");
        expect(result).toBeNull();
    });

    it("should return null on Firestore error", async () => {
        mockGetDoc.mockRejectedValue(new Error("Firestore down"));
        const result = await getCachedUserData("uid-err");
        expect(result).toBeNull();
    });
});

// ==========================================

describe("Products — logActivity", () => {

    beforeEach(() => vi.clearAllMocks());

    it("should add an activity document with correct fields", async () => {
        mockAddDoc.mockResolvedValue({});
        await logActivity("Added Product", "Widget Pro");

        expect(mockAddDoc).toHaveBeenCalledTimes(1);
        const logData = mockAddDoc.mock.calls[0][1];
        expect(logData.action).toBe("Added Product");
        expect(logData.target).toBe("Widget Pro");
        expect(logData.user).toBe("admin@test.com");
    });

    it("should not throw when addDoc fails", async () => {
        mockAddDoc.mockRejectedValue(new Error("write failed"));
        await expect(logActivity("X", "Y")).resolves.not.toThrow();
    });
});

// ==========================================

describe("Products — validateImportData", () => {

    beforeEach(() => vi.clearAllMocks());

    function makeValidRow(overrides = {}) {
        return {
            "Product Name": "Test Widget",
            "Category":     "Electronics",
            "Price":         99,
            "Stock":         10,
            "Size":         "M",
            "Color":        "Red",
            ...overrides
        };
    }

    function setupFirestoreMocks({ existingProducts = [], categories = ["Electronics"] } = {}) {
        mockGetDocs
            .mockResolvedValueOnce(makeDocsSnapshot(
                existingProducts.map(name => ({ data: () => ({ name }) }))
            ))
            .mockResolvedValueOnce(makeDocsSnapshot(
                categories.map(name => ({ data: () => ({ name }) }))
            ));
    }

    it("should pass a valid row with no errors", async () => {
        setupFirestoreMocks();
        const result = await validateImportData([makeValidRow()]);
        expect(result.errors).toHaveLength(0);
        expect(result.validProducts).toHaveLength(1);
    });

    it("should report error when Product Name is missing", async () => {
        setupFirestoreMocks();
        const result = await validateImportData([makeValidRow({ "Product Name": "" })]);
        expect(result.errors.some(e => e.includes("Product Name is required"))).toBe(true);
    });

    it("should report error when Category does not exist", async () => {
        setupFirestoreMocks({ categories: ["Furniture"] });
        const result = await validateImportData([makeValidRow({ "Category": "Electronics" })]);
        expect(result.errors.some(e => e.includes("does not exist"))).toBe(true);
    });

    it("should report error for negative price", async () => {
        setupFirestoreMocks();
        const result = await validateImportData([makeValidRow({ "Price": -5 })]);
        expect(result.errors.some(e => e.includes("Price must be a valid number"))).toBe(true);
    });

    it("should report error when Stock is missing", async () => {
        setupFirestoreMocks();
        const result = await validateImportData([makeValidRow({ "Stock": "" })]);
        expect(result.errors.some(e => e.includes("Stock is required"))).toBe(true);
    });

    it("should report error when Size is missing", async () => {
        setupFirestoreMocks();
        const result = await validateImportData([makeValidRow({ "Size": "" })]);
        expect(result.errors.some(e => e.includes("Size is required"))).toBe(true);
    });

    it("should report error when Color is missing", async () => {
        setupFirestoreMocks();
        const result = await validateImportData([makeValidRow({ "Color": "" })]);
        expect(result.errors.some(e => e.includes("Color is required"))).toBe(true);
    });

    it("should report error when product already exists in DB", async () => {
        setupFirestoreMocks({ existingProducts: ["Test Widget"] });
        const result = await validateImportData([makeValidRow()]);
        expect(result.errors.some(e => e.includes("already exists in database"))).toBe(true);
    });

    it("should report error for duplicate products within the same file", async () => {
        setupFirestoreMocks();
        const row = makeValidRow();
        const result = await validateImportData([row, { ...row }]);
        expect(result.errors.some(e => e.includes("Duplicate product"))).toBe(true);
    });
});

// ==========================================

describe("Products — importProducts", () => {

    beforeEach(() => vi.clearAllMocks());

    it("should call addDoc for each valid product", async () => {
        mockAddDoc.mockResolvedValue({});
        const products = [{
            "Product Name": "Gadget A", "Description": "Desc", "Category": "Electronics",
            "Price": 50, "Stock": 5, "Low Stock Threshold": 10,
            "Size": "S", "Color": "Blue", "Custom Variation": "",
            "Attribute Name": "", "Attribute Value": ""
        }];

        const result = await importProducts(products);

        expect(mockAddDoc).toHaveBeenCalled();
        expect(result.imported).toBe(1);
        expect(result.errors).toHaveLength(0);
    });

    it("should record product attributes when provided", async () => {
        mockAddDoc.mockResolvedValue({});
        const products = [{
            "Product Name": "Gadget B", "Description": "", "Category": "Electronics",
            "Price": 80, "Stock": 3, "Low Stock Threshold": 5,
            "Size": "M", "Color": "Green", "Custom Variation": "",
            "Attribute Name": "Material", "Attribute Value": "Plastic"
        }];

        await importProducts(products);

        const savedData = mockAddDoc.mock.calls[0][1];
        expect(savedData.attributes).toHaveLength(1);
        expect(savedData.attributes[0].name).toBe("Material");
        expect(savedData.attributes[0].value).toBe("Plastic");
    });

    it("should track errors per product without throwing", async () => {
        // importProducts calls addDoc TWICE per successful product:
        //   1. addDoc(collection, productData)  — save the product
        //   2. addDoc(collection, logData)       — logActivity
        // So "Good" consumes two resolves, then "Bad"'s first addDoc rejects.
        mockAddDoc
            .mockResolvedValueOnce({})   // "Good" — product write
            .mockResolvedValueOnce({})   // "Good" — logActivity write
            .mockRejectedValueOnce(new Error("write error")); // "Bad" — product write fails

        const row = (name) => ({
            "Product Name": name, "Category": "A", "Price": 10, "Stock": 1,
            "Size": "S", "Color": "R", "Low Stock Threshold": 5,
            "Description": "", "Custom Variation": "", "Attribute Name": "", "Attribute Value": ""
        });

        const result = await importProducts([row("Good"), row("Bad")]);
        expect(result.imported).toBe(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("Bad");
    });

    it("should return zero imported when all products fail", async () => {
        mockAddDoc.mockRejectedValue(new Error("fail"));
        const products = [{
            "Product Name": "X", "Category": "B", "Price": 5, "Stock": 1,
            "Size": "S", "Color": "R", "Low Stock Threshold": 5,
            "Description": "", "Custom Variation": "", "Attribute Name": "", "Attribute Value": ""
        }];
        const result = await importProducts(products);
        expect(result.imported).toBe(0);
        expect(result.errors).toHaveLength(1);
    });
});

// ==========================================

describe("Products — readExcelFile", () => {

    it("should parse a valid Excel file via FileReader", async () => {
        const fakeData = [{ "Product Name": "Test", "Price": 10 }];
        global.XLSX.read.mockReturnValue({
            SheetNames: ["Sheet1"],
            Sheets:     { Sheet1: {} }
        });
        global.XLSX.utils.sheet_to_json.mockReturnValue(fakeData);

        const file = new File([new Blob(["fake"])], "test.xlsx");
        const result = await readExcelFile(file);
        expect(result).toEqual(fakeData);
    });

    it("should reject with a descriptive error when XLSX.read throws", async () => {
        global.XLSX.read.mockImplementation(() => { throw new Error("bad file"); });

        const file = new File([new Blob(["bad"])], "bad.xlsx");
        await expect(readExcelFile(file)).rejects.toThrow("Failed to read file");
    });
});

// ==========================================

describe("Products — exportToExcel", () => {

    beforeEach(() => vi.clearAllMocks());

    it("should not call XLSX.writeFile when no products are loaded", () => {
        // allProducts is [] at module init — takes the early-exit path
        exportToExcel();
        expect(global.XLSX.writeFile).not.toHaveBeenCalled();
    });
});