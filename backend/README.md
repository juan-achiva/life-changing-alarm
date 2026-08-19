# backend

Firebase backend assets for `todaygrace`.

## Structure

- `functions/`: Cloud Functions source
- `firestore.rules`: Firestore security rules
- `firestore.indexes.json`: Firestore composite indexes
- `storage.rules`: Cloud Storage security rules
- `firebase.json`: Firebase project config

## Setup

```bash
cd functions
npm install
```

## Deploy

```bash
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
```
