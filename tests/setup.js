// tests/setup.js
import { vi } from 'vitest';

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js", () => ({
    initializeApp: vi.fn(() => ({}))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    getFirestore:       vi.fn(() => ({})),
    collection:         vi.fn(() => ({})),
    doc:                vi.fn(() => ({})),
    getDoc:             vi.fn(),
    getDocs:            vi.fn(),
    updateDoc:          vi.fn(),
    deleteDoc:          vi.fn(),
    addDoc:             vi.fn(),
    query:              vi.fn(() => ({})),
    where:              vi.fn(() => ({})),
    orderBy:            vi.fn(() => ({})),
    limit:              vi.fn(() => ({})),
    startAfter:         vi.fn(() => ({})),
    serverTimestamp:    vi.fn(() => "MOCK_TIME"),
    getCountFromServer: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    getAuth:            vi.fn(() => ({})),
    onAuthStateChanged: vi.fn(),
    signOut:            vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js", () => ({
    getStorage:     vi.fn(() => ({})),
    ref:            vi.fn(() => ({})),
    deleteObject:   vi.fn(),
    uploadBytes:    vi.fn(),
    getDownloadURL: vi.fn()
}));    