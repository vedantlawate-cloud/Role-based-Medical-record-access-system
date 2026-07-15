"""
Polls AuditLog events and reconciles them with the SQLite audit trail.

Run separately while Flask is active:

    python event_listener.py

This version is Sepolia/Alchemy friendly:
- uses fromBlock/toBlock for get_logs
- polls in small batches
- starts from the deployed AuditLog block
- recovers if the saved state is behind the current deployment
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
DEPLOYMENT_FILE = PROJECT_ROOT / "build" / "deployed_contracts.json"

POLL_INTERVAL_SECONDS = 8
BLOCK_BATCH_SIZE = 1

ACTION_NAMES = [
    "granted",
    "denied",
    "emergency_override",
    "consent_granted",
    "consent_revoked",
]


def load_deployment():
    if not DEPLOYMENT_FILE.exists():
        raise BlockchainError(
            "Deployment information was not found. Run: python scripts/deploy.py"
        )

    return json.loads(DEPLOYMENT_FILE.read_text(encoding="utf-8"))


def load_next_block(deployment_block):
    """Load the next unprocessed block."""

    if not STATE_FILE.exists():
        return deployment_block

    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        saved_next_block = int(state["next_block"])

        # If contracts were redeployed, do not continue from an older
        # deployment's state file.
        return max(saved_next_block, deployment_block)
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
        func.lower(Patient.wallet_address) == wallet_address.lower()
    ).first()


def find_doctor(wallet_address):
    return Doctor.query.filter(
        func.lower(Doctor.wallet_address) == wallet_address.lower()
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

    A wider time window is useful on Sepolia because block confirmation time
    can be noticeably different from the local Flask commit time.
    """

    earliest = blockchain_timestamp - timedelta(minutes=10)
    latest = blockchain_timestamp + timedelta(minutes=10)

    query = AccessLog.query.filter(
        AccessLog.patient_id == patient_id,
        AccessLog.doctor_id == doctor_id,
        AccessLog.record_category == record_category,
        AccessLog.action == action,
        AccessLog.timestamp.between(earliest, latest),
    )

    if justification:
        query = query.filter(AccessLog.justification == justification)

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
        print(f"Skipped event: patient wallet is not in SQLite: {patient_address}")
        return

    if not doctor:
        print(f"Skipped event: doctor wallet is not in SQLite: {doctor_address}")
        return

    blockchain_timestamp = datetime.utcfromtimestamp(int(args["timestamp"]))

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

    print(f"Synced audit #{log_id}: {action} | transaction {transaction_hash}")


def run_listener():
    blockchain = get_blockchain()
    deployment = load_deployment()

    deployment_block = int(deployment["AuditLog"]["deployment_block"])
    next_block = load_next_block(deployment_block)

    print("Blockchain event listener started.")
    print(f"Watching AuditLog from block {next_block}.")
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
                print("Backing off before retrying...")
                time.sleep(POLL_INTERVAL_SECONDS * 2)


if __name__ == "__main__":
    try:
        run_listener()
    except BlockchainError as error:
        print(f"Blockchain connection failed: {error}")
