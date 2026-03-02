# Rocca Wallet Sample

This project demonstrates an onboarding flow for a white-label identity solution providing rewards and fee delegation.

## White-Label Configuration

The application is designed as a white-label solution. You can customize the branding and features by modifying the `extra.provider` section in `app.json`:

```json
"extra": {
  "provider": {
    "name": "Aura",
    "primaryColor": "#3B82F6",
    "secondaryColor": "#E1EFFF",
    "accentColor": "#10B981",
    "welcomeMessage": "Your identity, rewarded.",
    "showRewards": true,
    "showFeeDelegation": true,
    "showIdentityManagement": true
  }
}
```

These values are consumed by the app via `expo-constants`.

## Screen Flow
1. **Uninitialized (`/uninitialized`)**: Welcome screen for new users (from image 620).
2. **Generate (`/generate`)**: DID and key generation screen with progress feedback (from image 417).
3. **Landing (`/landing`)**: Main dashboard for onboarded users.

## Suggested Extensions

To integrate with the identity primitives, the following extensions are suggested:

### 1. Keystore Extension
- **Purpose**: Securely manage private keys and cryptographic material.
- **Functionality**:
  - `generateKeyPair(type: KeyType)`: Create new keys (e.g., Ed25519 for DIDs).
  - `sign(keyId: string, data: Uint8Array)`: Sign transactions or challenges.
  - `exportPublicKey(keyId: string)`: Retrieve public keys for DID documents.

### 2. Accounts Extension
- **Purpose**: High-level wrapper around Keystore for identity management.
- **Functionality**:
  - `createAccount(alias: string)`: Associate a key pair with a user-friendly name.
  - `getAccounts()`: List available accounts.
  - `getActiveAccount()`: Get the current identity being used.

### 3. DID Extension (New Suggestion)
- **Purpose**: Handle Decentralized Identifier operations.
- **Functionality**:
  - `createDID(publicKey: string)`: Generate a DID string (e.g., `did:key:z...`).
  - `resolveDID(did: string)`: Fetch the DID Document associated with an identifier.
  - `updateDIDDocument(did: string, document: DIDDocument)`: Manage service endpoints and verification methods.

### 4. Provider Extension (New Suggestion)
- **Purpose**: Interface with the centralized "Provider" for rewards and fee delegation.
- **Functionality**:
  - `getRewards(account: string)`: Fetch pending rewards for the user.
  - `requestFeeDelegation(transaction: Transaction)`: Submit a transaction to the provider for co-signing/fee payment.
  - `onboard(did: string)`: Register the new DID with the provider's white-label system.

## Getting Started

1. Install dependencies
   ```bash
   npm install
   ```

2. Start the app
   ```bash
   npx expo start
   ```
