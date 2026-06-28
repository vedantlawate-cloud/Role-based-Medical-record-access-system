"""
Generate synthetic doctors, patients, consent grants, access attempts,
emergency overrides, and revocations.

Ganache and Flask must be running before executing this file.
"""

import os
import random
import sys
from pathlib import Path

import requests
from faker import Faker


PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from blockchain import get_blockchain
from main import AccessGrant, Doctor, Patient, app


API_URL = os.getenv("API_URL", "http://127.0.0.1:5000")

TARGET_DOCTORS = 3
TARGET_PATIENTS = 4

SPECIALTIES = [
    "Cardiology",
    "Neurology",
    "Emergency Medicine",
    "Oncology",
    "Pediatrics",
]

RECORD_CATEGORIES = [
    "cardiac_history",
    "mental_health",
    "allergies",
    "medications",
    "lab_results",
    "radiology",
]

fake = Faker()
Faker.seed(42)
random.seed(42)


def api_request(method, path, payload=None, allowed_statuses=(200, 201)):
    response = requests.request(
        method,
        f"{API_URL}{path}",
        json=payload,
        timeout=30,
    )

    if response.status_code not in allowed_statuses:
        try:
            details = response.json()
        except ValueError:
            details = response.text

        raise RuntimeError(
            f"{method} {path} failed with HTTP "
            f"{response.status_code}: {details}"
        )

    return response.json()


def database_snapshot():
    with app.app_context():
        doctors = [
            {
                "id": doctor.id,
                "wallet_address": doctor.wallet_address,
            }
            for doctor in Doctor.query.all()
        ]

        patients = [
            {
                "id": patient.id,
                "wallet_address": patient.wallet_address,
            }
            for patient in Patient.query.all()
        ]

    return doctors, patients


def register_missing_people(accounts, admin_address):
    doctors, patients = database_snapshot()

    used_wallets = {
        person["wallet_address"].lower()
        for person in doctors + patients
    }

    available_wallets = [
        address
        for address in accounts[1:]
        if address.lower() not in used_wallets
    ]

    while len(doctors) < TARGET_DOCTORS:
        if not available_wallets:
            raise RuntimeError(
                "Not enough unused Ganache accounts for more doctors"
            )

        wallet = available_wallets.pop(0)
        specialty = random.choice(SPECIALTIES)

        result = api_request(
            "POST",
            "/admin/register_doctor",
            {
                "name": f"Dr. {fake.name()}",
                "specialty": specialty,
                "wallet_address": wallet,
                "registered_by": admin_address,
                "role": "doctor",
            },
        )

        doctors.append(result)
        used_wallets.add(wallet.lower())

        print(
            f"Registered doctor: {result['name']} "
            f"({specialty})"
        )

    while len(patients) < TARGET_PATIENTS:
        if not available_wallets:
            raise RuntimeError(
                "Not enough unused Ganache accounts for more patients"
            )

        wallet = available_wallets.pop(0)

        result = api_request(
            "POST",
            "/patient/register",
            {
                "name": fake.name(),
                "wallet_address": wallet,
            },
        )

        patients.append(result)
        used_wallets.add(wallet.lower())

        print(f"Registered patient: {result['name']}")

    return database_snapshot()


def find_active_grant(patient_id, doctor_id, category):
    with app.app_context():
        grant = AccessGrant.query.filter_by(
            patient_id=patient_id,
            doctor_id=doctor_id,
            record_category=category,
            is_active=True,
        ).first()

        return grant.id if grant else None


def generate_activity(doctors, patients):
    created_grants = []

    for index, patient in enumerate(patients):
        doctor = doctors[index % len(doctors)]
        category = RECORD_CATEGORIES[
            index % len(RECORD_CATEGORIES)
        ]

        grant_id = find_active_grant(
            patient["id"],
            doctor["id"],
            category,
        )

        if grant_id is None:
            grant = api_request(
                "POST",
                "/patient/grant_access",
                {
                    "patient_id": patient["id"],
                    "doctor_id": doctor["id"],
                    "record_category": category,
                },
            )

            grant_id = grant["id"]
            created_grants.append(grant_id)

            print(
                f"Granted {category}: patient {patient['id']} "
                f"to doctor {doctor['id']}"
            )

        api_request(
            "POST",
            "/doctor/request_access",
            {
                "patient_id": patient["id"],
                "doctor_id": doctor["id"],
                "record_category": category,
            },
        )

        print(
            f"Successful access: patient {patient['id']}, "
            f"doctor {doctor['id']}, {category}"
        )

        denied_category = RECORD_CATEGORIES[
            (index + 3) % len(RECORD_CATEGORIES)
        ]

        api_request(
            "POST",
            "/doctor/request_access",
            {
                "patient_id": patient["id"],
                "doctor_id": doctor["id"],
                "record_category": denied_category,
            },
            allowed_statuses=(403,),
        )

        print(
            f"Denied access: patient {patient['id']}, "
            f"doctor {doctor['id']}, {denied_category}"
        )

    first_patient = patients[0]
    first_doctor = doctors[0]

    api_request(
        "POST",
        "/doctor/emergency_override",
        {
            "patient_id": first_patient["id"],
            "doctor_id": first_doctor["id"],
            "record_category": "emergency_summary",
            "justification": (
                "Synthetic emergency: patient unconscious and "
                "immediate treatment required"
            ),
        },
    )

    print("Created emergency override")

    if created_grants:
        revoked_grant_id = created_grants[0]

        api_request(
            "POST",
            f"/patient/revoke_access/{revoked_grant_id}",
        )

        print(f"Revoked synthetic grant {revoked_grant_id}")


def main():
    print("Checking Flask API...")

    api_request("GET", "/admin/doctors")

    blockchain = get_blockchain()
    accounts = blockchain.web3.eth.accounts

    if len(accounts) < 3:
        raise RuntimeError(
            "Ganache must provide at least three accounts"
        )

    admin_address = accounts[0]

    print(f"Using administrator wallet: {admin_address}")

    doctors, patients = register_missing_people(
        accounts,
        admin_address,
    )

    print(
        f"Using {len(doctors)} doctors and "
        f"{len(patients)} patients"
    )

    generate_activity(doctors, patients)

    print("\nSynthetic data generation completed successfully.")
    print("View the audit trail at:")
    print(f"{API_URL}/audit/patient/{patients[0]['id']}")


if __name__ == "__main__":
    main()