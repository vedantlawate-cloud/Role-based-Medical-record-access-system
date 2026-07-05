"""
Blockchain service used by the Flask application.

Loads deployed contract information from build/deployed_contracts.json
and communicates with Sepolia or another configured RPC provider.

This version matches the admin/head-doctor assignment AccessControl contract:
- Admin/deployer signs doctor registration.
- Admin/deployer signs doctor-patient assignment and revocation.
- Admin/deployer records doctor access attempts and emergency overrides
  on behalf of the selected doctor.
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3
from web3.exceptions import ContractLogicError


PROJECT_ROOT = Path(__file__).resolve().parent
DEPLOYMENT_FILE = PROJECT_ROOT / "build" / "deployed_contracts.json"
ENV_FILE = PROJECT_ROOT / ".env"

load_dotenv(ENV_FILE)

WEB3_PROVIDER_URI = os.getenv("WEB3_PROVIDER_URI")
GANACHE_URL = os.getenv("GANACHE_URL", "http://127.0.0.1:7545")
DEPLOYER_PRIVATE_KEY = os.getenv("DEPLOYER_PRIVATE_KEY")
CHAIN_ID = os.getenv("CHAIN_ID")


class BlockchainError(Exception):
    """Raised when a blockchain operation fails."""


class BlockchainService:
    def __init__(self):
        provider_url = WEB3_PROVIDER_URI or GANACHE_URL

        self.web3 = Web3(Web3.HTTPProvider(provider_url))

        if not self.web3.is_connected():
            raise BlockchainError(
                f"Could not connect to blockchain RPC at {provider_url}"
            )

        if not DEPLOYMENT_FILE.exists():
            raise BlockchainError(
                "Deployment information was not found. "
                "Run: python scripts/deploy.py"
            )

        deployment = json.loads(
            DEPLOYMENT_FILE.read_text(encoding="utf-8")
        )

        deployed_chain_id = int(deployment["network"]["chain_id"])
        current_chain_id = int(self.web3.eth.chain_id)

        if CHAIN_ID and int(CHAIN_ID) != current_chain_id:
            raise BlockchainError(
                f"CHAIN_ID mismatch. .env says {CHAIN_ID}, "
                f"but connected network is {current_chain_id}."
            )

        if deployed_chain_id != current_chain_id:
            raise BlockchainError(
                "Connected network does not match deployed contracts. "
                "Redeploy contracts or update WEB3_PROVIDER_URI."
            )

        self.deployer = self._checksum(
            deployment["network"]["deployer"]
        )

        if not DEPLOYER_PRIVATE_KEY:
            raise BlockchainError(
                "DEPLOYER_PRIVATE_KEY is required for Sepolia transactions."
            )

        self.signing_account = (
            self.web3.eth.account.from_key(DEPLOYER_PRIVATE_KEY)
        )
        self.signing_address = self._checksum(
            self.signing_account.address
        )

        if self.signing_address.lower() != self.deployer.lower():
            raise BlockchainError(
                "DEPLOYER_PRIVATE_KEY does not match the deployer address "
                "saved in build/deployed_contracts.json."
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

    def _build_transaction_options(self, nonce):
        transaction = {
            "from": self.signing_address,
            "nonce": nonce,
            "chainId": self.web3.eth.chain_id,
        }

        try:
            latest_block = self.web3.eth.get_block("latest")
            base_fee = latest_block.get("baseFeePerGas")

            if base_fee is not None:
                priority_fee = self.web3.to_wei(2, "gwei")
                transaction["maxPriorityFeePerGas"] = priority_fee
                transaction["maxFeePerGas"] = base_fee * 2 + priority_fee
            else:
                transaction["gasPrice"] = self.web3.eth.gas_price
        except Exception:
            transaction["gasPrice"] = self.web3.eth.gas_price

        return transaction

    def _estimate_with_buffer(self, transaction):
        estimated_gas = self.web3.eth.estimate_gas(transaction)
        return int(estimated_gas * 1.25)

    def _send_transaction(self, function):
        try:
            nonce = self.web3.eth.get_transaction_count(
                self.signing_address,
                "pending",
            )

            transaction = function.build_transaction(
                self._build_transaction_options(nonce)
            )
            transaction["gas"] = self._estimate_with_buffer(transaction)

            signed = self.signing_account.sign_transaction(transaction)
            raw_transaction = getattr(signed, "rawTransaction", None)

            if raw_transaction is None:
                raw_transaction = signed.raw_transaction

            transaction_hash = self.web3.eth.send_raw_transaction(
                raw_transaction
            )

            receipt = self.web3.eth.wait_for_transaction_receipt(
                transaction_hash
            )

            if receipt.status != 1:
                raise BlockchainError("Blockchain transaction failed")

            return {
                "transaction_hash": transaction_hash.hex(),
                "block_number": receipt.blockNumber,
                "gas_used": receipt.gasUsed,
                "from": self.signing_address,
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
        doctor_address = self._checksum(doctor_address)

        function = self.identity_registry.functions.registerDoctor(
            doctor_address,
            role,
            specialty or "",
        )

        return self._send_transaction(function)

    def set_doctor_active(
        self,
        doctor_address,
        active,
        admin_address=None,
    ):
        doctor_address = self._checksum(doctor_address)

        function = self.identity_registry.functions.setDoctorActive(
            doctor_address,
            bool(active),
        )

        return self._send_transaction(function)

    def is_active_doctor(self, doctor_address):
        doctor_address = self._checksum(doctor_address)

        return self.identity_registry.functions.isActiveDoctor(
            doctor_address
        ).call()

    def get_doctor(self, doctor_address):
        doctor_address = self._checksum(doctor_address)

        doctor = self.identity_registry.functions.getDoctor(
            doctor_address
        ).call()

        return {
            "exists": doctor[0],
            "active": doctor[1],
            "role": doctor[2],
            "specialty": doctor[3],
            "registered_by": doctor[4],
            "registered_at": doctor[5],
        }

    # ------------------------------------------------------------------
    # Admin/head-doctor assignment operations
    # ------------------------------------------------------------------

    def grant_access(
        self,
        patient_address,
        doctor_address,
        record_category,
    ):
        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        function = self.access_control.functions.assignDoctor(
            patient_address,
            doctor_address,
            record_category,
        )

        return self._send_transaction(function)

    def revoke_access(
        self,
        patient_address,
        doctor_address,
        record_category,
    ):
        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        function = self.access_control.functions.revokeDoctorAssignment(
            patient_address,
            doctor_address,
            record_category,
        )

        return self._send_transaction(function)

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

        granted = self.has_access(
            patient_address,
            doctor_address,
            record_category,
        )

        function = self.access_control.functions.requestAccess(
            patient_address,
            doctor_address,
            record_category,
        )

        transaction = self._send_transaction(function)

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
            raise BlockchainError("Emergency justification is required")

        patient_address = self._checksum(patient_address)
        doctor_address = self._checksum(doctor_address)

        function = self.access_control.functions.emergencyOverride(
            patient_address,
            doctor_address,
            record_category,
            justification.strip(),
        )

        return self._send_transaction(function)

    # ------------------------------------------------------------------
    # Audit operations
    # ------------------------------------------------------------------

    def get_audit_log_count(self):
        return self.audit_log.functions.getLogCount().call()

    def get_patient_logs(self, patient_address):
        patient_address = self._checksum(patient_address)

        logs = self.audit_log.functions.getPatientLogs(
            patient_address
        ).call()

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
    """Lazily creates the blockchain connection."""

    global _blockchain_service

    if _blockchain_service is None:
        _blockchain_service = BlockchainService()

    return _blockchain_service
