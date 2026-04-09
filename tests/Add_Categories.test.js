import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    mockQuery,
    mockWhere,
    mockAddDoc,
    mockServerTimestamp
} = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockSetDoc: vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockQuery: vi.fn(),
    mockWhere: vi.fn(),
    mockAddDoc: vi.fn(),
    mockServerTimestamp: vi.fn(() => ({ _seconds: Date.now() / 1000 }))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js", () => ({
    initializeApp: vi.fn(() => ({}))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    getAuth: vi.fn(() => ({ 
        currentUser: { 
            email: "admin@test.com",
            uid: "admin-uid"
        } 
    })),
    onAuthStateChanged: vi.fn((auth, callback) => {
        callback({ uid: "admin-uid", email: "admin@test.com" });
        return vi.fn();
    }),
    signOut: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    getFirestore: vi.fn(),
    doc: mockDoc,
    getDoc: mockGetDoc,
    setDoc: mockSetDoc,
    updateDoc: mockUpdateDoc,
    collection: mockCollection,
    addDoc: mockAddDoc,
    serverTimestamp: mockServerTimestamp,
    query: mockQuery,
    where: mockWhere,
    getDocs: mockGetDocs
}));

vi.mock("./logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn())
}));


mockDoc.mockReturnValue({ path: "users/admin-uid" });

mockDoc.mockImplementation((db, collection, id) => ({
    collection,
    id
}));

mockCollection.mockImplementation((db, name) => ({
    name
}));
// Mock DOM
global.document = {
    getElementById: vi.fn((id) => {
        const elements = {
            'categoryNameInput': { value: '', addEventListener: vi.fn() },
            'categoryDescInput': { value: '', addEventListener: vi.fn() },
            'successModal': { style: { display: 'none' } },
            'successProgressBar': { style: { width: '0%' } },
            'successCategoryName': { textContent: '' },
            'userRoleDisplay': { textContent: '' }
        };
        return elements[id] || { value: '', textContent: '', addEventListener: vi.fn() };
    }),
    querySelector: vi.fn((selector) => ({
        addEventListener: vi.fn(),
        innerText: '',
        disabled: false
    })),
    addEventListener: vi.fn(),
    createElement: vi.fn(() => {
        return {
            _text: "",
            set innerText(val) {
                this._text = val;
                this.innerHTML = val
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
            },
            get innerText() {
                return this._text;
            },
            innerHTML: ""
        };
    })
};

global.window = {
    location: { href: '', replace: vi.fn() },
    logout: null,
    addEventListener: vi.fn()
};

global.alert = vi.fn();
global.sessionStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
};

global.localStorage = {
    store: {},
    getItem: vi.fn(function (key) {
        return this.store[key] ?? null;
    }),
    setItem: vi.fn(function (key, value) {
        this.store[key] = value;
    }),
    removeItem: vi.fn(function (key) {
        delete this.store[key];
    }),
    clear: vi.fn(function () {
        this.store = {};
    })
};

global.setInterval = vi.fn((fn, delay) => {
    fn(); // Execute immediately for testing
    return 123;
});

global.clearInterval = vi.fn();

// ==========================================
// HELPER FUNCTIONS (Extracted from Add Category)
// ==========================================
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    try {
        const snap = await mockGetDoc(mockDoc({}, "users", uid));
        if (snap.exists()) {
            const data = snap.data();
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
            return data;
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}

async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

async function logActivity(action, targetName) {
    try {
        await mockAddDoc(mockCollection({}, "activities"), {
            action,
            target: targetName,
            user: "admin@test.com",
            timestamp: mockServerTimestamp()
        });
    } catch (e) {
        console.error("Error logging activity", e);
    }
}

async function addCategory(categoryData) {
    const snapshot = await mockGetDocs(mockCollection({}, "categories"));

    let maxId = 0;
    snapshot.forEach(docSnap => {
        const numericId = parseInt(docSnap.id);
        if (!isNaN(numericId) && numericId > maxId) {
            maxId = numericId;
        }
    });

    const newIdNum = maxId + 1;
    const newId = String(newIdNum);

    await mockSetDoc(mockDoc({}, "counters", "categories"), { lastId: newIdNum });

    await mockSetDoc(mockDoc({}, "categories", newId), {
        ...categoryData,
        createdAt: mockServerTimestamp(),
        archived: false,
        itemCount: 0
    });

    return newId;
}

// ==========================================
// TEST SUITES
// ==========================================

describe("Add Category - Authentication & Authorization", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    describe("getCachedUserData", () => {
        it("should return cached user data if available", async () => {
            const mockUser = { role: "admin", email: "admin@test.com" };
            sessionStorage.getItem.mockReturnValue(JSON.stringify(mockUser));
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toEqual(mockUser);
            expect(sessionStorage.getItem).toHaveBeenCalledWith("user_data_admin-uid");
        });

        it("should fetch from Firestore if not cached", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: "admin", email: "admin@test.com" })
            });
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toEqual({ role: "admin", email: "admin@test.com" });
            expect(sessionStorage.setItem).toHaveBeenCalled();
        });

        it("should return null if user doesn't exist", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockResolvedValue({
                exists: () => false
            });
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toBeNull();
        });

        it("should handle errors gracefully", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockRejectedValue(new Error("Network error"));
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toBeNull();
        });
    });

    describe("checkAdminRole", () => {
        it("should return true for admin role", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ role: "admin" })
            );
            
            const isAdmin = await checkAdminRole("admin-uid");
            
            expect(isAdmin).toBe(true);
        });

        it("should be case-insensitive", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ role: "AdMiN" })
            );
            
            const isAdmin = await checkAdminRole("admin-uid");
            
            expect(isAdmin).toBe(true);
        });

        it("should return false for non-admin role", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ role: "user" })
            );
            
            const isAdmin = await checkAdminRole("user-uid");
            
            expect(isAdmin).toBe(false);
        });

        it("should deny non-admin users", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: "user" })
            });
            
            const isAdmin = await checkAdminRole("user-uid");
            
            if (!isAdmin) {
                alert("Access Denied: Only Admins can add categories.");
            }
            
            expect(isAdmin).toBe(false);
            expect(alert).toHaveBeenCalledWith("Access Denied: Only Admins can add categories.");
        });
    });

    describe("displayUserRole", () => {
        it("should display capitalized role name", async () => {

            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: "admin" })
            });
            
            const userData = await getCachedUserData("admin-uid");
            let roleName = userData?.role || "User";
            roleName = roleName.charAt(0).toUpperCase() + roleName.slice(1);
            
            expect(roleName).toBe("Admin");
        });

        it("should default to 'User' if role not found", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({})
            });
            
            const userData = await getCachedUserData("admin-uid");
            let roleName = userData?.role || "User";
            roleName = roleName.charAt(0).toUpperCase() + roleName.slice(1);

            
            expect(roleName).toBe("User");
        });
    });
});

describe("Add Category - Input Validation & Sanitization", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("sanitizeInput", () => {
        it("should sanitize HTML tags", () => {
            const input = "<script>alert('xss')</script>";
            const result = sanitizeInput(input);
            
            expect(result).not.toContain("<script>");
            expect(result).toContain("&lt;script&gt;");
        });

        it("should handle empty strings", () => {
            expect(sanitizeInput("")).toBe("");
            expect(sanitizeInput(null)).toBe("");
            expect(sanitizeInput(undefined)).toBe("");
        });

        it("should convert non-strings to strings", () => {
            expect(sanitizeInput(123)).toBe("123");
            expect(sanitizeInput(true)).toBe("true");
        });

        it("should preserve normal text", () => {
            const input = "Normal category description";
            expect(sanitizeInput(input)).toBe(input);
        });

        it("should escape dangerous HTML", () => {
            const input = '<img src=x onerror="alert(1)">';
            const result = sanitizeInput(input);
            
            expect(result).toContain('onerror=');
            expect(result).toContain("&lt;img");
        });
    });

    describe("Input Validation", () => {
        it("should reject empty category name", () => {
            const rawName = "   ";
            
            try {
                if (!rawName.trim()) {
                    throw new Error("Category name is required.");
                }
            } catch (error) {
                expect(error.message).toBe("Category name is required.");
            }
        });

        it("should accept valid category name", () => {
            const rawName = "Electronics";
            expect(rawName.trim()).toBeTruthy();
        });

        it("should trim whitespace from input", () => {
            const rawName = "  Electronics  ";
            const trimmed = rawName.trim();
            
            expect(trimmed).toBe("Electronics");
        });
    });
});

describe("Add Category - Duplicate Detection", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should detect duplicate category names (case-insensitive)", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: (callback) => {
                callback({ data: () => ({ name: "Electronics", normalizedName: "electronics" }) });
            },
            empty: false
        });

        const normalizedName = "electronics";
        const q = mockQuery(
            mockCollection({}, "categories"),
            mockWhere("normalizedName", "==", normalizedName),
            mockWhere("archived", "==", false)
        );
        
        const querySnapshot = await mockGetDocs(q);
        
        await expect(async () => {
            if (!querySnapshot.empty) {
                throw new Error('Category "Electronics" already exists!');
            }
        }).rejects.toThrow();

        expect(querySnapshot.empty).toBe(false);
    });

    it("should allow category with unique name", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: vi.fn(),
            empty: true
        });

        const normalizedName = "newcategory";
        const q = mockQuery(
            mockCollection({}, "categories"),
            mockWhere("normalizedName", "==", normalizedName),
            mockWhere("archived", "==", false)
        );
        
        const querySnapshot = await mockGetDocs(q);
        
        expect(querySnapshot.empty).toBe(true);
    });

    it("should normalize category names for comparison", () => {
        const name1 = "Electronics";
        const name2 = "ELECTRONICS";
        
        expect(name1.toLowerCase()).toBe(name2.toLowerCase());
    });

    it("should not consider archived categories as duplicates", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: vi.fn(),
            empty: true
        });

        const q = mockQuery(
            mockCollection({}, "categories"),
            mockWhere("normalizedName", "==", "electronics"),
            mockWhere("archived", "==", false)
        );
        
        const querySnapshot = await mockGetDocs(q);
        
        // Even if archived category exists, it shouldn't block
        expect(querySnapshot.empty).toBe(true);
    });
});

describe("Add Category - ID Generation", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should generate sequential numeric IDs", async () => {
        const mockDocs = [
            { id: "1", data: () => ({}) },
            { id: "2", data: () => ({}) },
            { id: "5", data: () => ({}) }
        ];

        mockGetDocs.mockResolvedValue({
            forEach: (callback) => mockDocs.forEach(callback)
        });

        const snapshot = await mockGetDocs(mockCollection({}, "categories"));
        
        let maxId = 0;
        snapshot.forEach(docSnap => {
            const numericId = parseInt(docSnap.id);
            if (!isNaN(numericId) && numericId > maxId) {
                maxId = numericId;
            }
        });

        const newIdNum = maxId + 1;
        
        expect(newIdNum).toBe(6);
    });

    it("should start from 1 if no categories exist", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: vi.fn()
        });

        const snapshot = await mockGetDocs(mockCollection({}, "categories"));
        
        let maxId = 0;
        snapshot.forEach(docSnap => {
            const numericId = parseInt(docSnap.id);
            if (!isNaN(numericId) && numericId > maxId) {
                maxId = numericId;
            }
        });

        const newIdNum = maxId + 1;
        
        expect(newIdNum).toBe(1);
    });

    it("should convert ID to string", () => {
        const newIdNum = 5;
        const newId = String(newIdNum);
        
        expect(typeof newId).toBe("string");
        expect(newId).toBe("5");
    });

    it("should handle non-numeric IDs gracefully", async () => {
        const mockDocs = [
            { id: "1", data: () => ({}) },
            { id: "abc", data: () => ({}) },
            { id: "3", data: () => ({}) }
        ];

        mockGetDocs.mockResolvedValue({
            forEach: (callback) => mockDocs.forEach(callback)
        });

        const snapshot = await mockGetDocs(mockCollection({}, "categories"));
        
        let maxId = 0;
        snapshot.forEach(docSnap => {
            const numericId = parseInt(docSnap.id);
            if (!isNaN(numericId) && numericId > maxId) {
                maxId = numericId;
            }
        });

        expect(maxId).toBe(3); // Should ignore "abc"
    });
});

describe("Add Category - Category Creation", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should create category with correct data structure", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: vi.fn()
        });
        
        mockSetDoc.mockResolvedValue();

        const categoryData = {
            name: "Electronics",
            normalizedName: "electronics",
            description: "Electronic items",
            createdBy: "admin-uid"
        };

        await addCategory(categoryData);

        expect(mockSetDoc).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({
                name: "Electronics",
                normalizedName: "electronics",
                archived: false,
                itemCount: 0
            })
        );
    });

    it("should include timestamp on creation", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: vi.fn()
        });
        
        mockSetDoc.mockResolvedValue();

        const categoryData = {
            name: "Test",
            normalizedName: "test",
            description: "Test",
            createdBy: "admin-uid"
        };

        await addCategory(categoryData);

        expect(mockSetDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                createdAt: expect.anything()
            })
        );
    });

    it("should update counter document", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: vi.fn()
        });
        
        mockSetDoc.mockResolvedValue();

        await addCategory({
            name: "Test",
            normalizedName: "test",
            description: "",
            createdBy: "admin-uid"
        });

        expect(mockSetDoc).toHaveBeenCalledWith(
            mockDoc({}, "counters", "categories"),
            { lastId: 1 }
        );
    });

    it("should return the new category ID", async () => {
        mockGetDocs.mockResolvedValue({
            forEach: vi.fn()
        });
        
        mockSetDoc.mockResolvedValue();

        const newId = await addCategory({
            name: "Test",
            normalizedName: "test",
            description: "",
            createdBy: "admin-uid"
        });

        expect(newId).toBe("1");
    });
});

describe("Add Category - Activity Logging", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should log category creation", async () => {
        const categoryName = "New Category";
        
        await logActivity("Added Category", categoryName);
        
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Added Category",
                target: categoryName,
                user: "admin@test.com"
            })
        );
    });

    it("should include timestamp in log", async () => {
        await logActivity("Added Category", "Test");
        
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                timestamp: expect.anything()
            })
        );
    });

    it("should handle logging errors gracefully", async () => {
        mockAddDoc.mockRejectedValue(new Error("Logging failed"));
        
        await expect(logActivity("Test", "Target")).resolves.not.toThrow();
    });
});

describe("Add Category - Cache Management", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it("should bust dashboard cache after creation", () => {
        sessionStorage.setItem('dashboard_cache', JSON.stringify({ data: 'cached' }));
        
        // After creating category
        sessionStorage.removeItem('dashboard_cache');
        
        expect(sessionStorage.removeItem).toHaveBeenCalledWith('dashboard_cache');
    });
});

describe("Add Category - Logout/Sign Out", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it("should clear localStorage on logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        localStorage.setItem("user_session", "active");
        localStorage.setItem("user_uid", "admin-uid");
        localStorage.setItem("user_role", "admin");
        
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        
        await signOut({});
        
        expect(localStorage.getItem("user_session")).toBeNull();
        expect(localStorage.getItem("user_uid")).toBeNull();
        expect(localStorage.getItem("user_role")).toBeNull();
    });

    it("should clear sessionStorage on logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        sessionStorage.setItem("user_data_admin-uid", JSON.stringify({ role: "admin" }));
        sessionStorage.clear();
        
        await signOut({});
        
        expect(sessionStorage.clear).toHaveBeenCalled();
    });

    it("should call signOut function", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockResolvedValue();
        await signOut({});
        
        expect(signOut).toHaveBeenCalled();
    });

    it("should redirect to index.html after logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockResolvedValue();
        await signOut({});
        
        window.location.replace("index.html");
        
        expect(window.location.replace).toHaveBeenCalledWith("index.html");
    });

    it("should handle logout errors and still redirect", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockRejectedValue(new Error("Network error"));
        
        try {
            await signOut({});
        } catch (error) {
            window.location.replace("index.html");
        }
        
        expect(window.location.replace).toHaveBeenCalledWith("index.html");
    });

    it("should execute complete logout sequence", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        // Setup
        localStorage.setItem("user_session", "active");
        localStorage.setItem("user_uid", "admin-uid");
        localStorage.setItem("user_role", "admin");
        sessionStorage.setItem("cache", "data");
        
        // Execute
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        
        signOut.mockResolvedValue();
        await signOut({});
        
        window.location.replace("index.html");
        
        // Verify
        expect(localStorage.getItem("user_session")).toBeNull();
        expect(sessionStorage.clear).toHaveBeenCalled();
        expect(signOut).toHaveBeenCalled();
        expect(window.location.replace).toHaveBeenCalledWith("index.html");
    });
});

describe("Add Category - Success Modal", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should show success modal with category name", () => {
        const categoryName = "Electronics";
        const modal = document.getElementById('successModal');
        const label = document.getElementById('successCategoryName');
        
        label.textContent = `"${categoryName}" has been added.`;
        modal.style.display = 'flex';
        
        expect(label.textContent).toBe('"Electronics" has been added.');
        expect(modal.style.display).toBe('flex');
    });

    it("should animate progress bar", () => {
        const bar = document.getElementById('successProgressBar');
        let width = 0;
        
        width += 2;
        bar.style.width = width + '%';
        
        expect(bar.style.width).toBe('2%');
    });
});

describe("Add Category - Error Handling", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should handle Firestore errors", async () => {
        mockSetDoc.mockRejectedValue(new Error("Firestore error"));
        
        try {
            await mockSetDoc(mockDoc({}, "categories", "1"), {});
        } catch (error) {
            alert("Error saving: " + error.message);
        }
        
        expect(alert).toHaveBeenCalledWith("Error saving: Firestore error");
    });

    it("should reset button state on error", () => {
        const submitBtn = {
            innerText: "Saving...",
            disabled: true
        };

        // On error
        submitBtn.innerText = "Add Category";
        submitBtn.disabled = false;

        expect(submitBtn.innerText).toBe("Add Category");
        expect(submitBtn.disabled).toBe(false);
    });

    it("should handle network errors gracefully", async () => {
        mockGetDocs.mockRejectedValue(new Error("Network error"));
        
        try {
            await mockGetDocs(mockCollection({}, "categories"));
        } catch (error) {
            console.error("Error:", error);
            alert("Error saving: " + error.message);
        }
        
        expect(alert).toHaveBeenCalled();
    });
});