# Security Specification — What do I Wear?

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document in `/users/{userId}` and its subcollections (`garments`, `combinations`, `savedOutfits`, `advisorMessages`) MUST have `ownerId == userId == request.auth.uid`. Cross-user reads, lists, writes, or deletes are unconditionally forbidden.
2. **Verified Authentication Gate**: All read/write access requires `request.auth != null && request.auth.token.email_verified == true`. Unauthenticated and unverified clients are denied.
3. **Master Gate Parent Existence**: Subcollection creates, updates, and deletes require the parent `/users/{userId}` document to exist.
4. **Strict Schema & No Ghost Fields**: Every create and update enforces exact allowed key sets (`hasAll` + `hasOnly`), type checks, enum bounds, `.size()` bounds on every string and array, and regex validation on document IDs (`^[a-zA-Z0-9_\-]+$`, max 128 chars) and hex colors (`^#[0-9A-Fa-f]{6}$`).
5. **Temporal & Identity Immutability**: `ownerId` and `createdAt` are immutable after creation; `createdAt` on create and `updatedAt` on create/update must strictly equal `request.time`.
6. **Immutable Chat Turns**: Documents in `advisorMessages` cannot be mutated after creation (`allow update: if false`).
7. **Query-Enforced Listing**: No blanket `allow list` on `/users`. All subcollection `allow list` rules explicitly enforce `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Profile Read**: `GET /users/alice` with `auth = null` → `PERMISSION_DENIED`.
2. **Unverified Email Write**: `CREATE /users/alice` with `auth.uid = 'alice', email_verified = false` → `PERMISSION_DENIED`.
3. **Cross-User Garment Read**: `GET /users/alice/garments/g1` as `bob` → `PERMISSION_DENIED`.
4. **Cross-User Owner Spoofing**: `CREATE /users/bob/garments/g1` as `bob` with `{ ownerId: 'alice', ... }` → `PERMISSION_DENIED`.
5. **Shadow Ghost Field Injection**: `CREATE /users/alice/garments/g1` with extra field `isAdmin: true` → `PERMISSION_DENIED`.
6. **ID Poisoning Attack**: `CREATE /users/alice/garments/bad$id..123` (or >128 char ID) → `PERMISSION_DENIED`.
7. **Denial-of-Wallet Oversized String**: `CREATE /users/alice/garments/g1` with `name` of 5,000 chars → `PERMISSION_DENIED`.
8. **Invalid Color Hex / Enum Value Poisoning**: `UPDATE /users/alice/garments/g1` with `colorHex: 'not-a-hex'` or `category: 'cars'` → `PERMISSION_DENIED`.
9. **Client-Forged Timestamp**: `CREATE /users/alice/garments/g1` with `createdAt: Timestamp(2020-01-01)` != `request.time` → `PERMISSION_DENIED`.
10. **Immutable Field Tampering**: `UPDATE /users/alice/garments/g1` attempting to modify `ownerId` or `createdAt` → `PERMISSION_DENIED`.
11. **Unbounded Vector Array Overflow**: `CREATE /users/alice/garments/g1` with `vector` array of 500 elements (> 256 cap) → `PERMISSION_DENIED`.
12. **Advisor Message Tampering**: `UPDATE /users/alice/advisorMessages/m1` attempting to rewrite chat history → `PERMISSION_DENIED`.
