"""
Compiles and deploys the Solidity contracts to a local Ganache blockchain.

Deployment order:
1. IdentityRegistry
2. AuditLog
3. AccessControl
4. Authorize AccessControl to write to AuditLog

The resulting addresses and ABIs are saved to:
build/deployed_contracts.json
"""

import json
import os
from pathlib import Path

from solcx import compile_standard, install_solc, set_solc_version
from web3 import Web3


SOLC_VERSION = "0.8.20"
GANACHE_URL = os.getenv("GANACHE_URL", "http://127.0.0.1:7545")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = PROJECT_ROOT / "contracts"
BUILD_DIR = PROJECT_ROOT / "build"
OUTPUT_FILE = BUILD_DIR / "deployed_contracts.json"

CONTRACT_FILES = [
    "IdentityRegistry.sol",
    "AuditLog.sol",
    "AccessControl.sol",
]


def read_contract_sources():
    """Read all Solidity source files."""

    sources = {}

    for filename in CONTRACT_FILES:
        file_path = CONTRACTS_DIR / filename

        if not file_path.exists():
            raise FileNotFoundError(
                f"Contract file not found: {file_path}"
            )

        sources[filename] = {
            "content": file_path.read_text(encoding="utf-8")
        }

    return sources


def compile_contracts():
    """Compile all Solidity contracts."""

    print(f"Installing/checking Solidity compiler {SOLC_VERSION}...")
    install_solc(SOLC_VERSION)
    set_solc_version(SOLC_VERSION)

    print("Compiling contracts...")

    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": read_contract_sources(),
            "settings": {
                "evmVersion": "paris",
                "optimizer": {
                    "enabled": True,
                    "runs": 200,
                },
                "outputSelection": {
                    "*": {
                        "*": [
                            "abi",
                            "evm.bytecode.object",
                        ]
                    }
                },
            },
        }
    )

    print("Compilation successful.")
    return compiled


def get_contract_data(compiled, source_file, contract_name):
    """Extract a contract's ABI and bytecode."""

    contract = compiled["contracts"][source_file][contract_name]

    abi = contract["abi"]
    bytecode = contract["evm"]["bytecode"]["object"]

    if not bytecode:
        raise RuntimeError(
            f"No deployable bytecode generated for {contract_name}"
        )

    return abi, bytecode


def deploy_contract(web3, deployer, abi, bytecode, arguments=None):
    """Deploy one contract and return its instance and receipt."""

    arguments = arguments or []

    contract_factory = web3.eth.contract(
        abi=abi,
        bytecode=bytecode,
    )

    transaction_hash = contract_factory.constructor(
        *arguments
    ).transact({"from": deployer})

    receipt = web3.eth.wait_for_transaction_receipt(
        transaction_hash
    )

    if receipt.status != 1:
        raise RuntimeError("Contract deployment transaction failed")

    deployed_contract = web3.eth.contract(
        address=receipt.contractAddress,
        abi=abi,
    )

    return deployed_contract, receipt


def main():
    compiled = compile_contracts()

    print(f"Connecting to Ganache at {GANACHE_URL}...")
    web3 = Web3(Web3.HTTPProvider(GANACHE_URL))

    if not web3.is_connected():
        raise ConnectionError(
            f"Could not connect to Ganache at {GANACHE_URL}. "
            "Make sure Ganache is running."
        )

    accounts = web3.eth.accounts

    if not accounts:
        raise RuntimeError("Ganache has no available accounts")

    deployer = accounts[0]
    web3.eth.default_account = deployer

    print(f"Connected. Deployer account: {deployer}")

    identity_abi, identity_bytecode = get_contract_data(
        compiled,
        "IdentityRegistry.sol",
        "IdentityRegistry",
    )

    audit_abi, audit_bytecode = get_contract_data(
        compiled,
        "AuditLog.sol",
        "AuditLog",
    )

    access_abi, access_bytecode = get_contract_data(
        compiled,
        "AccessControl.sol",
        "AccessControl",
    )

    print("Deploying IdentityRegistry...")
    identity_registry, identity_receipt = deploy_contract(
        web3,
        deployer,
        identity_abi,
        identity_bytecode,
    )
    print(
        f"IdentityRegistry deployed at "
        f"{identity_registry.address}"
    )

    print("Deploying AuditLog...")
    audit_log, audit_receipt = deploy_contract(
        web3,
        deployer,
        audit_abi,
        audit_bytecode,
    )
    print(f"AuditLog deployed at {audit_log.address}")

    print("Deploying AccessControl...")
    access_control, access_receipt = deploy_contract(
        web3,
        deployer,
        access_abi,
        access_bytecode,
        [
            identity_registry.address,
            audit_log.address,
        ],
    )
    print(
        f"AccessControl deployed at "
        f"{access_control.address}"
    )

    print("Authorizing AccessControl as an AuditLog writer...")

    authorization_hash = (
        audit_log.functions
        .setAuthorizedWriter(
            access_control.address,
            True,
        )
        .transact({"from": deployer})
    )

    authorization_receipt = (
        web3.eth.wait_for_transaction_receipt(
            authorization_hash
        )
    )

    if authorization_receipt.status != 1:
        raise RuntimeError(
            "Failed to authorize AccessControl as audit writer"
        )

    is_authorized = audit_log.functions.authorizedWriters(
        access_control.address
    ).call()

    if not is_authorized:
        raise RuntimeError(
            "AccessControl writer authorization was not saved"
        )

    print("AccessControl successfully authorized.")

    deployment_data = {
        "network": {
            "url": GANACHE_URL,
            "chain_id": web3.eth.chain_id,
            "deployer": deployer,
        },
        "IdentityRegistry": {
            "address": identity_registry.address,
            "abi": identity_abi,
            "deployment_block": identity_receipt.blockNumber,
        },
        "AuditLog": {
            "address": audit_log.address,
            "abi": audit_abi,
            "deployment_block": audit_receipt.blockNumber,
        },
        "AccessControl": {
            "address": access_control.address,
            "abi": access_abi,
            "deployment_block": access_receipt.blockNumber,
        },
    }

    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    OUTPUT_FILE.write_text(
        json.dumps(deployment_data, indent=2),
        encoding="utf-8",
    )

    print("\nDeployment completed successfully.")
    print(f"Contract information saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()