# Decentralized Access Management Framework for Medical Record Sharing

## Project Structure

```
medical-records-access-system/
│
├── contracts/                  # Solidity smart contracts (separate - different language, runs on EVM)
│   ├── AccessControl.sol           # Patient-authorized access logic
│   ├── IdentityRegistry.sol        # Hospital-managed doctor/role registration
│   └── AuditLog.sol                # Immutable access logging
│
├── main.py                     # Flask app: routes, DB models, all core backend logic
├── blockchain.py                # web3.py connection + contract calls (read/write)
├── event_listener.py            # Listens for on-chain events, syncs to DB
│
├── scripts/
│   └── deploy.py                 # Compiles + deploys contracts to local/testnet
│
├── data/
│   ├── generate_synthetic_data.py  # Generates fake patients/doctors/access logs (Faker)
│   └── synthetic/                   # Output CSVs from the generator
│
├── frontend/                    # Dashboard UI (React)
│   └── src/
│       ├── components/
│       ├── pages/                    # Patient view, Doctor view, Admin view
│       └── services/                  # API calls to Flask backend
│
├── docs/
│   └── proposal.md
│
├── requirements.txt
└── .env.example
```

## Why contracts/ is still separate
Solidity compiles to EVM bytecode, which is what actually runs on the blockchain.
This is unrelated to your backend language choice. `main.py` and `blockchain.py`
talk to these contracts using `web3.py`.

## Why everything else is consolidated
For a project this size, splitting Flask routes/models/DB across many files adds
overhead without real benefit. `main.py` holds the app, routes, and DB models in
one place; `blockchain.py` isolates the web3 logic so it's easy to test separately.

## Two-Tier Access Model
1. **Hospital Admin Layer** — registers doctors, assigns roles (identity management)
2. **Patient Consent Layer** — patients grant/revoke specific access to their records

Every access (granted, denied, or emergency override) is permanently logged via `AuditLog.sol`.

## Setup
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python scripts/deploy.py
python main.py
```
