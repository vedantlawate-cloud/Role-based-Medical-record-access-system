"""
Compiles and deploys the Solidity contracts.

Supports:
- Sepolia / hosted RPC deployment using WEB3_PROVIDER_URI + DEPLOYER_PRIVATE_KEY
- Local Ganache fallback using GANACHE_URL + unlocked accounts

Deployment order:
1. IdentityRegistry
2. AuditLog
3. AccessControl
4. Authorize AccessControl to write to AuditLog

The resulting addresses and ABIs are saved to:
backend/build/deployed_contracts.json
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from solcx import compile_standard, install_solc, set_solc_version
from web3 import Web3


SOLC_VERSION = "0.8.20"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = PROJECT_ROOT / "contracts"
BUILD_DIR = PROJECT_ROOT / "build"
OUTPUT_FILE = BUILD_DIR / "deployed_contracts.json"

ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(ENV_FILE)

WEB3_PROVIDER_URI = os.getenv("WEB3_PROVIDER_URI")
GANACHE_URL = os.getenv("GANACHE_URL", "http://127.0.0.1:7545")
DEPLOYER_PRIVATE_KEY = os.getenv("DEPLOYER_PRIVATE_KEY")
CHAIN_ID = os.getenv("CHAIN_ID")

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
            raise FileNotFoundError(f"Contract file not found: {file_path}")

        sources[filename] = {"content": file_path.read_text(encoding="utf-8")}

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
                # Keeps bytecode compatible with Ganache versions that do not
                # support newer PUSH0 opcodes.
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
        raise RuntimeError(f"No deployable bytecode generated for {contract_name}")

    return abi, bytecode


def connect_web3():
    """Connect to Sepolia if WEB3_PROVIDER_URI is set; otherwise Ganache."""

    provider_url = WEB3_PROVIDER_URI or GANACHE_URL
    network_label = "configured RPC" if WEB3_PROVIDER_URI else "Ganache"

    print(f"Connecting to {network_label} at {provider_url}...")
    web3 = Web3(Web3.HTTPProvider(provider_url))

    if not web3.is_connected():
        raise ConnectionError(f"Could not connect to RPC provider: {provider_url}")

    actual_chain_id = web3.eth.chain_id

    if CHAIN_ID and int(CHAIN_ID) != actual_chain_id:
        raise RuntimeError(
            f"CHAIN_ID mismatch. .env says {CHAIN_ID}, "
            f"but connected network is {actual_chain_id}."
        )

    print(f"Connected. Chain ID: {actual_chain_id}")
    return web3, provider_url, actual_chain_id


def get_deployer(web3):
    """
    Return deployment account information.

    Sepolia/testnet mode:
      DEPLOYER_PRIVATE_KEY is required and every transaction is signed locally.

    Ganache fallback:
      If no private key is provided, use the first unlocked Ganache account.
    """

    if DEPLOYER_PRIVATE_KEY:
        account = web3.eth.account.from_key(DEPLOYER_PRIVATE_KEY)
        print(f"Deployer account: {account.address}")

        balance_wei = web3.eth.get_balance(account.address)
        balance_eth = web3.from_wei(balance_wei, "ether")
        print(f"Deployer balance: {balance_eth} ETH")

        if balance_wei == 0:
            raise RuntimeError(
                "Deployer wallet has 0 ETH. Fund it with Sepolia test ETH first."
            )

        return {
            "address": account.address,
            "account": account,
            "uses_private_key": True,
        }

    accounts = web3.eth.accounts

    if not accounts:
        raise RuntimeError(
            "No DEPLOYER_PRIVATE_KEY found and no unlocked local accounts exist."
        )

    deployer = accounts[0]
    web3.eth.default_account = deployer
    print(f"Using unlocked local deployer account: {deployer}")

    return {
        "address": deployer,
        "account": None,
        "uses_private_key": False,
    }


def build_transaction_options(web3, deployer_address, nonce):
    """Create common transaction fields for deployment and setup calls."""

    transaction = {
        "from": deployer_address,
        "nonce": nonce,
        "chainId": web3.eth.chain_id,
    }

    # Use EIP-1559 style fees when possible. Fall back to gasPrice if the RPC
    # does not expose fee history cleanly.
    try:
        latest_block = web3.eth.get_block("latest")
        base_fee = latest_block.get("baseFeePerGas")

        if base_fee is not None:
            priority_fee = web3.to_wei(2, "gwei")
            transaction["maxPriorityFeePerGas"] = priority_fee
            transaction["maxFeePerGas"] = base_fee * 2 + priority_fee
        else:
            transaction["gasPrice"] = web3.eth.gas_price
    except Exception:
        transaction["gasPrice"] = web3.eth.gas_price

    return transaction


def send_signed_transaction(web3, account, transaction):
    """Sign and broadcast one transaction."""

    signed = account.sign_transaction(transaction)

    raw_transaction = getattr(signed, "rawTransaction", None)
    if raw_transaction is None:
        raw_transaction = signed.raw_transaction

    transaction_hash = web3.eth.send_raw_transaction(raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(transaction_hash)

    if receipt.status != 1:
        raise RuntimeError(f"Transaction failed: {transaction_hash.hex()}")

    return receipt


def send_transaction(web3, deployer, transaction):
    """Send a signed Sepolia transaction or unlocked Ganache transaction."""

    if deployer["uses_private_key"]:
        return send_signed_transaction(web3, deployer["account"], transaction)

    transaction_hash = web3.eth.send_transaction(transaction)
    receipt = web3.eth.wait_for_transaction_receipt(transaction_hash)

    if receipt.status != 1:
        raise RuntimeError(f"Transaction failed: {transaction_hash.hex()}")

    return receipt


def estimate_with_buffer(web3, transaction):
    """Estimate gas and add a safety buffer."""

    estimated_gas = web3.eth.estimate_gas(transaction)
    return int(estimated_gas * 1.25)


def deploy_contract(web3, deployer, abi, bytecode, arguments=None):
    """Deploy one contract and return its instance and receipt."""

    arguments = arguments or []

    contract_factory = web3.eth.contract(
        abi=abi,
        bytecode=bytecode,
    )

    nonce = web3.eth.get_transaction_count(deployer["address"], "pending")
    transaction = contract_factory.constructor(*arguments).build_transaction(
        build_transaction_options(web3, deployer["address"], nonce)
    )
    transaction["gas"] = estimate_with_buffer(web3, transaction)

    receipt = send_transaction(web3, deployer, transaction)

    deployed_contract = web3.eth.contract(
        address=receipt.contractAddress,
        abi=abi,
    )

    return deployed_contract, receipt


def call_contract_transaction(web3, deployer, contract_function):
    """Send one state-changing contract function call."""

    nonce = web3.eth.get_transaction_count(deployer["address"], "pending")
    transaction = contract_function.build_transaction(
        build_transaction_options(web3, deployer["address"], nonce)
    )
    transaction["gas"] = estimate_with_buffer(web3, transaction)

    return send_transaction(web3, deployer, transaction)


def main():
    compiled = compile_contracts()
    web3, provider_url, chain_id = connect_web3()
    deployer = get_deployer(web3)

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
    print(f"IdentityRegistry deployed at {identity_registry.address}")

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
    print(f"AccessControl deployed at {access_control.address}")

    print("Authorizing AccessControl as an AuditLog writer...")
    authorization_receipt = call_contract_transaction(
        web3,
        deployer,
        audit_log.functions.setAuthorizedWriter(
            access_control.address,
            True,
        ),
    )

    if authorization_receipt.status != 1:
        raise RuntimeError("Failed to authorize AccessControl as audit writer")

    is_authorized = audit_log.functions.authorizedWriters(
        access_control.address
    ).call()

    if not is_authorized:
        raise RuntimeError("AccessControl writer authorization was not saved")

    print("AccessControl successfully authorized.")

    deployment_data = {
        "network": {
            "url": provider_url,
            "chain_id": chain_id,
            "deployer": deployer["address"],
        },
        "IdentityRegistry": {
            "address": identity_registry.address,
            "abi": identity_abi,
            "deployment_block": identity_receipt.blockNumber,
            "transaction_hash": identity_receipt.transactionHash.hex(),
        },
        "AuditLog": {
            "address": audit_log.address,
            "abi": audit_abi,
            "deployment_block": audit_receipt.blockNumber,
            "transaction_hash": audit_receipt.transactionHash.hex(),
        },
        "AccessControl": {
            "address": access_control.address,
            "abi": access_abi,
            "deployment_block": access_receipt.blockNumber,
            "transaction_hash": access_receipt.transactionHash.hex(),
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
