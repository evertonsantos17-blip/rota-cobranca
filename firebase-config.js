// ============================================
// firebase-config.js
// ============================================
// IMPORTANTE: Substitua os valores abaixo pelas
// credenciais do SEU projeto Firebase.
// Acesse: https://console.firebase.google.com
// → Configurações do projeto → Seus apps → SDK
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmUXSmaHUfrIhqKndS4TuXAjJC1-gT-OA",
  authDomain: "rota-cobranca.firebaseapp.com",
  projectId: "rota-cobranca",
  storageBucket: "rota-cobranca.firebasestorage.app",
  messagingSenderId: "557712604666",
  appId: "1:557712604666:web:bcc8fa283d8ebac53a3843"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
