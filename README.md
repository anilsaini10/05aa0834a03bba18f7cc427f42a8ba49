# FieldBook Backend API

Node.js · Express · TypeScript · PostgreSQL · Prisma · JWT · Zod

---

## Stack

| Tool | Purpose |
|---|---|
| Express | HTTP server |
| TypeScript | Type safety |
| Prisma | ORM + migrations |
| PostgreSQL | Database |
| JWT | Auth tokens |
| bcryptjs | Password hashing |
| Zod | Request validation |

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Generate JWT secrets
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Run twice — once for JWT_ACCESS_SECRET, once for JWT_REFRESH_SECRET
```

### 4. Create PostgreSQL database
```sql
CREATE DATABASE fieldbook;
```

### 5. Run migrations
```bash
npm run prisma:migrate
```

### 6. Generate Prisma client
```bash
npm run prisma:generate
```

### 7. Start dev server
```bash
npm run dev
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled JS |
| `npm run prisma:migrate` | Run DB migrations |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:studio` | Open Prisma Studio |

---

## API Endpoints

### Health
```
GET /health
```

### Auth
```
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me          ← requires Bearer token
```

---

## Request Examples

### Signup
```json
POST /api/auth/signup
{
  "name":     "Raj Sharma",
  "email":    "raj@fieldbook.com",
  "password": "secret123",
  "phone":    "9876543210",
  "role":     "OWNER"
}
```

### Login
```json
POST /api/auth/login
{
  "email":    "raj@fieldbook.com",
  "password": "secret123"
}
```

### Refresh
```json
POST /api/auth/refresh
{
  "refreshToken": "eyJ..."
}
```

### Logout
```json
POST /api/auth/logout
{
  "refreshToken": "eyJ..."
}
```

---

## Response Format

### Success
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "message": "Email already registered",
    "code":    "EMAIL_TAKEN"
  }
}
```

---

## Auth Usage in Routes

```typescript
import { authGuard }  from './middleware/authGuard';
import { roleGuard }  from './middleware/roleGuard';

// Protected route
router.get('/profile', authGuard, handler);

// Role restricted
router.get('/admin', authGuard, roleGuard('ADMIN'), handler);
router.get('/owner-or-admin', authGuard, roleGuard('OWNER', 'ADMIN'), handler);
```

---

## Roles

| Role | Description |
|---|---|
| `ADMIN` | Full access |
| `OWNER` | Contractor / owner |
| `STAFF` | Labour / mistri |
