# Rota Cobrança — Versão 100% Gratuita

## APIs utilizadas (todas gratuitas, sem cartão)

| Função | API | Custo |
|--------|-----|-------|
| Mapa | Leaflet + OpenStreetMap | Grátis |
| Busca de endereço | Nominatim (OSM) | Grátis |
| Cálculo de rota | OSRM | Grátis |
| Feriados nacionais | BrasilAPI | Grátis |
| Banco de dados + Auth | Firebase | Grátis (plano Spark) |

---

## Arquivos

```
rota-cobranca/
├── index.html          → Estrutura do app
├── style.css           → Estilos responsivos
├── app.js              → Lógica principal
├── firebase-config.js  → Suas credenciais Firebase
├── holidays.js         → Módulo de feriados
└── README.md           → Este arquivo
```

---

## 1. Firebase (único serviço que precisa configurar)

### Criar projeto
1. Acesse https://console.firebase.google.com
2. Clique em "Adicionar projeto" e crie

### Ativar Authentication
1. Build → Authentication → Começar
2. Ative o provedor **E-mail/senha**

### Criar Firestore
1. Build → Firestore Database → Criar banco
2. Escolha **Modo de produção**

### Regras do Firestore
Em Firestore → Regras, cole:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow read, write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.tipoUsuario == 'gerencial';
    }
    match /routes/{routeId} {
      allow read, write: if request.auth != null && resource.data.cobradorId == request.auth.uid;
      allow create: if request.auth != null;
      allow read, write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.tipoUsuario == 'gerencial';
    }
    match /routeStops/{stopId} {
      allow read, write: if request.auth != null;
    }
    match /locations/{locId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Obter credenciais
1. ⚙️ Configurações → Configurações gerais → Seus apps → `</>`
2. Registre o app, copie o objeto `firebaseConfig`

### Inserir no projeto
Abra `firebase-config.js` e substitua os valores:

```javascript
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO_ID",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};
```

---

## 2. Criar primeiro usuário gerencial

1. Firebase Console → Authentication → Usuários → Adicionar usuário
2. Informe e-mail e senha, copie o UID gerado
3. Firestore → Coleção `users` → Novo documento com ID = UID:
```json
{
  "nome": "Seu Nome",
  "email": "seu@email.com",
  "tipoUsuario": "gerencial",
  "ativo": true
}
```

Depois disso, o gerencial pode criar outros usuários direto pelo app.

---

## 3. Como rodar

**VS Code + Live Server** (recomendado)
1. Instale a extensão "Live Server"
2. Clique em "Go Live"
3. Acesse http://localhost:5500

**Python**
```bash
python3 -m http.server 8080
# Acesse: http://localhost:8080
```

> ⚠️ Não abra o index.html diretamente pelo Explorer/Finder (file://).
> Os módulos JavaScript não funcionam assim. Use sempre um servidor local.

---

## 4. Deploy gratuito

**Firebase Hosting**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

**Vercel ou Netlify**
Arraste a pasta em https://vercel.com ou https://netlify.com — pronto.

---

## Observações sobre as APIs gratuitas

**Nominatim (busca de endereços)**
- Limite: 1 requisição por segundo
- O app já respeita esse limite automaticamente
- Qualidade: ótima para endereços no Brasil

**OSRM (cálculo de rota)**
- Servidor público gratuito
- Sem limite rígido para uso normal
- Calcula rotas reais de carro

**BrasilAPI (feriados)**
- Feriados nacionais: automático
- Feriados municipais: requer confirmação manual (aviso exibido)
