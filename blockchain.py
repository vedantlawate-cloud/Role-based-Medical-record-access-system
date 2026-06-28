"""
Blockchain service used by the Flask application.

Loads deployed contract information from build/deployed_contracts.json
and communicates with the local Ganache blockchain.
"""

import json
import os
from pathlib import Path

from web3 import Web3
from web3.exceptions import ContractLogicError


PROJECT_ROOT = Path(__file__).resolve().parent
DEPLOYMENT_FILE = PROJECT_ROOT / "build" / "deployed_contracts.json"

GANACHE_URL = os.getenv(
    "GANACHE_URL",
    "http://127.0.0.1:7545",
)


class BlockchainError(Exception):
    """Raised when a blockchain operation fails."""


class BlockchainService:
    def __init__(self):
        self.web3 = Web3(
            Web3.HTTPProvider(GANACHE_URL)
        )

        if not self.web3.is_connected():
            raise BlockchainError(
                f"Could not connect to Ganache at {GANACHE_URL}"
            )

        if not DEPLOYMENT_FILE.exists():
            raise BlockchainError(
                "Deployment information was not found. "
                "Run: python scripts/deploy.py"
            )

        deployment = json.loads(
            DEPLOYMENT_FILE.read_text(encoding="utf-8")
        )

        deployed_chain_id = deployment["network"]["chain_id"]
        current_chain_id = self.web3.eth.chain_id

        if deployed_chain_id != current_chain_id:
            raise BlockchainError(
                "Ganache network has changed. Redeploy the contracts."
            )

        self.deployer = self._checksum(
            deployment["network"]["deployer"]
        )

        self.identity_registry = self._load_contract(
            deployment["IdentityRegistry"]
        )

        self.audit_log = self._load_contract(
            deployment["AuditLog"]
        )

        self.access_control = self._load_contract(
            deployment["AccessControl"]
        )

    def _load_contract(self, contract_data):
        return self.web3.eth.contract(
            address=self._checksum(contract_data["address"]),
            abi=contract_data["abi"],
        )

    def _checksum(self, address):
        try:
            return Web3.to_checksum_address(address)
        except (TypeError, ValueError) as error:
            raise BlockchainError(
                f"Invalid wallet address: {address}"
            ) from error

    def _validate_sender(self, address):
        address = self._checksum(address)

        ganache_accounts = {
            account.lower()
            for account in self.web3.eth.accounts
        }

        if address.lower() not in ganache_accounts:
            raise BlockchainError(
                f"Wallet {address} is not an unlocked Ganache account"
            )

        return address

    def _send_transaction(self, function, sender):
        sender = self._validate_sender(sender)

        try:
            transaction_hash = function.transact(
                {"from": sender}
            )

            receipt = (
                self.web3.eth.wait_for_transaction_receipt(
                    transaction_hash
                )
            )

            if receipt.status != 1:
                raise BlockchainError(
                    "Blockchain transaction failed"
                )

            return {
                "transaction_hash": transaction_hash.hex(),
                "block_number": receipt.blockNumber,
                "gas_used": receipt.gasUsed,
            }

        except ContractLogicError as error:
            raise BlockchainError(
                f"Smart contract rejected the transaction: {error}"
            ) from error

        except ValueError as error:
            message = self._extract_rpc_error(error)
            raise BlockchainError(message) from error

    @staticmethod
    def _extract_rpc_error(error):
        if error.args and isinstance(error.args[0], dict):
            return error.args[0].get(
                "message",
                "Blockchain RPC error",
            )

        return str(error)

    # ------------------------------------------------------------------
    # IdentityRegistry operations
    # ------------------------------------------------------------------

    def register_doctor(
        self,
        doctor_address,
        role,
        specialty="",
        admin_address=None,
    ):
        """
        Registers a doctor through the hospital-admin identity layer.

        admin_address defaults to the account that deployed the contracts.
        """

        doctor_address = self._checksum(doctor_address)
        admin_address = admin_address or self.deployer

        function = (
            self.identity_registry.functions.registerDoctor(
                doctor_address,
                role,
                specialty or "",
            )
        )

        return self._send_transaction(
            function,
            admin_address,
        )

    def set_doctor_active(
        self,
        doctor_address,
        active,
        admin_address=None,
    ):
        doctor_address = self._checksum(doctor_address)
        admin_address = admin_address or self.deployer

        function = (
            self.identity_registry.functions.setDoctorActive(
                doctor_address,
                bool(active),
            )
        )

        return self._send_transaction(
            function,
            admin_address,
        )

    def is_active_doctor(self, doctor_address):
        doctor_address = self._checksum(doctor_address)

        return (
            self.identity_registry.functions.isActiveDoctor(
                doctor_address
            ).call()
        )

    def get_doctor(self, doctor_address):
        doctor_address = self._checksum(doctor_address)

        doctor = (
            self.identity_registry.functions.getDoctor(
                doctor_address
            ).call()
        )

        return {
            "exists": doctor[0],
            "active": doctor[1],
            "role": doctor[2],
            "specialty": doctor[3],
            "registered_by": doctor[4],
            "registered_at": doctor[5],
        }

    # ------------------------------------------------------------------
    # Patient consent operations
    # ------------------------------------------------------------------

    def grant_access(
        self,
        patient_address,
        doctor_address,
        record_category,
    ):
        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        function = (
            self.access_control.functions.grantAccess(
                doctor_address,
                record_category,
            )
        )

        return self._send_transaction(
            function,
            patient_address,
        )

    def revoke_access(
        self,
        patient_address,
        doctor_address,
        record_category,
    ):
        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        function = (
            self.access_control.functions.revokeAccess(
                doctor_address,
                record_category,
            )
        )

        return self._send_transaction(
            function,
            patient_address,
        )

    def has_access(
        self,
        patient_address,
        doctor_address,
        record_category,
    ):
        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        return self.access_control.functions.hasAccess(
            patient_address,
            doctor_address,
            record_category,
        ).call()

    # ------------------------------------------------------------------
    # Doctor access operations
    # ------------------------------------------------------------------

    def request_access(
        self,
        patient_address,
        doctor_address,
        record_category,
    ):
        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        # Read permission before submitting the logged access attempt.
        granted = self.has_access(
            patient_address,
            doctor_address,
            record_category,
        )

        function = (
            self.access_control.functions.requestAccess(
                patient_address,
                record_category,
            )
        )

        transaction = self._send_transaction(
            function,
            doctor_address,
        )

        return {
            "granted": granted,
            **transaction,
        }

    def emergency_override(
        self,
        patient_address,
        doctor_address,
        record_category,
        justification,
    ):
        if not justification or not justification.strip():
            raise BlockchainError(
                "Emergency justification is required"
            )

        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        function = (
            self.access_control.functions.emergencyOverride(
                patient_address,
                record_category,
                justification.strip(),
            )
        )

        return self._send_transaction(
            function,
            doctor_address,
        )

    # ------------------------------------------------------------------
    # Audit operations
    # ------------------------------------------------------------------

    def get_audit_log_count(self):
        return self.audit_log.functions.getLogCount().call()

    def get_patient_logs(self, patient_address):
        patient_address = self._checksum(patient_address)

        logs = (
            self.audit_log.functions.getPatientLogs(
                patient_address
            ).call()
        )

        action_names = [
            "access_granted",
            "access_denied",
            "emergency_override",
            "consent_granted",
            "consent_revoked",
        ]

        return [
            {
                "id": entry[0],
                "patient_address": entry[1],
                "doctor_address": entry[2],
                "record_category": entry[3],
                "action": action_names[entry[4]],
                "justification": entry[5],
                "timestamp": entry[6],
                "recorded_by": entry[7],
            }
            for entry in logs
        ]


_blockchain_service = None


def get_blockchain():
    """
    Lazily creates the blockchain connection.

    Lazy initialization allows Flask to start producing a useful error
    even when Ganache is temporarily unavailable.
    """

    global _blockchain_service

    if _blockchain_service is None:
        _blockchain_service = BlockchainService()

    return _blockchain_service