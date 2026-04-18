// firebase.js — single shared Firebase instance for the whole app
// Import this instead of calling initializeApp / initializeFirestore in each file.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
    initializeFirestore,
    getFirestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth }    from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

import { firebaseConfig } from "./config.js";

// Guard: only initialise once even if this module is evaluated more than once
const app = getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApp();

// Guard: initializeFirestore throws if called twice on the same app,
// so we fall back to getFirestore() when the instance already exists.
let db;
try {
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch {
    // Already initialised — just reuse the existing instance
    db = getFirestore(app);
}

const auth    = getAuth(app);
const storage = getStorage(app);

export { app, db, auth, storage };