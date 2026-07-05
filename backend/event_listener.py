"""
Polls AuditLog events and reconciles them with the SQLite audit trail.

Run separately while Ganache and Flask are active:

    python event_listener.py
"""

import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func

from blockchain import BlockchainError, get_blockchain
from main import AccessLog, Doctor, Patient, app, db


PROJECT_ROOT = Path(__file__).resolve().parent
STATE_FILE = PROJECT_ROOT / "build" / "event_listener_state.json"

POLL_INTERVAL_SECONDS = 2
BLOCK_BATCH_SIZE = 100

ACTION_NAMES = [
    "granted",
    "denied",
    "emergency_override",
    "consent_granted",
    "consent_revoked",
]


def load_next_block(deployment_block):
    """Load the next unprocessed block."""

    if not STATE_FILE.exists():
        return deployment_block

    try:
        state = json.loads(
            STATE_FILE.read_text(encoding="utf-8")
        )
        return int(state["next_block"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return deployment_block


def save_next_block(next_block):
    """Save listener progress so events are not processed twice."""

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)

    STATE_FILE.write_text(
        json.dumps({"next_block": next_block}, indent=2),
        encoding="utf-8",
    )


def find_patient(wallet_address):
    return Patient.query.filter(
        func.lower(Patient.wallet_address)
        == wallet_address.lower()
    ).first()


def find_doctor(wallet_address):
    return Doctor.query.filter(
        func.lower(Doctor.wallet_address)
        == wallet_address.lower()
    ).first()


def find_existing_log(
    patient_id,
    doctor_id,
    record_category,
    action,
    justification,
    blockchain_timestamp,
):
    """
    Find the database entry already created by Flask.

    A small time window is used because Flask and Ganache may record
    timestamps a few seconds apart.
    """

    earliest = blockchain_timestamp - timedelta(seconds=30)
    latest = blockchain_timestamp + timedelta(seconds=30)

    query = AccessLog.query.filter(
        AccessLog.patient_id == patient_id,
        AccessLog.doctor_id == doctor_id,
        AccessLog.record_category == record_category,
        AccessLog.action == action,
        AccessLog.timestamp.between(earliest, latest),
    )

    if justification:
        query = query.filter(
            AccessLog.justification == justification
        )

    return query.first()


def process_event(event):
    args = event["args"]

    patient_address = args["patient"]
    doctor_address = args["doctor"]
    record_category = args["recordCategory"]
    action_number = int(args["action"])
    justification = args["justification"] or None

    if action_number >= len(ACTION_NAMES):
        print(f"Unknown audit action number: {action_number}")
        return

    action = ACTION_NAMES[action_number]

    patient = find_patient(patient_address)
    doctor = find_doctor(doctor_address)

    if not patient:
        print(
            f"Skipped event: patient wallet is not in SQLite: "
            f"{patient_address}"
        )
        return

    if not doctor:
        print(
            f"Skipped event: doctor wallet is not in SQLite: "
            f"{doctor_address}"
        )
        return

    blockchain_timestamp = datetime.utcfromtimestamp(
        int(args["timestamp"])
    )

    existing = find_existing_log(
        patient.id,
        doctor.id,
        record_category,
        action,
        justification,
        blockchain_timestamp,
    )

    transaction_hash = event["transactionHash"].hex()
    log_id = int(args["id"])

    if existing:
        print(
            f"Reconciled audit #{log_id}: {action} "
            f"(already stored in SQLite)"
        )
        return

    log_entry = AccessLog(
        patient_id=patient.id,
        doctor_id=doctor.id,
        record_category=record_category,
        action=action,
        justification=justification,
        timestamp=blockchain_timestamp,
    )

    db.session.add(log_entry)
    db.session.commit()

    print(
        f"Synced audit #{log_id}: {action} | "
        f"transaction {transaction_hash}"
    )


def run_listener():
    blockchain = get_blockchain()

    deployment = json.loads(
        (
            PROJECT_ROOT
            / "build"
            / "deployed_contracts.json"
        ).read_text(encoding="utf-8")
    )

    deployment_block = int(
        deployment["AuditLog"]["deployment_block"]
    )

    next_block = load_next_block(deployment_block)

    print("Blockchain event listener started.")
    print(f"Watching from block {next_block}.")
    print("Press CTRL+C to stop.")

    with app.app_context():
        while True:
            try:
                latest_block = blockchain.web3.eth.block_number

                if next_block > latest_block:
                    time.sleep(POLL_INTERVAL_SECONDS)
                    continue

                end_block = min(
                    next_block + BLOCK_BATCH_SIZE - 1,
                    latest_block,
                )

                events = (
                    blockchain.audit_log
                    .events.AuditEntryCreated()
                    .get_logs(
                        from_block=next_block,
                        to_block=end_block,
                    )
                )

                for event in events:
                    process_event(event)

                next_block = end_block + 1
                save_next_block(next_block)

            except KeyboardInterrupt:
                print("\nEvent listener stopped.")
                break

            except Exception as error:
                db.session.rollback()
                print(f"Listener error: {error}")
                time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        run_listener()
    except BlockchainError as error:
        print(f"Blockchain connection failed: {error}")