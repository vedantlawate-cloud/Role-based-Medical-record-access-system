// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IIdentityRegistry {
    function isActiveDoctor(address doctor)
        external
        view
        returns (bool);
}

interface IAuditLog {
    enum Action {
        ACCESS_GRANTED,
        ACCESS_DENIED,
        EMERGENCY_OVERRIDE,
        CONSENT_GRANTED,
        CONSENT_REVOKED
    }

    function recordLog(
        address patient,
        address doctor,
        string calldata recordCategory,
        Action action,
        string calldata justification
    ) external returns (uint256);
}

/**
 * @title AccessControl
 * @notice Patient-controlled authorization layer.
 *
 * Hospital administrators manage doctor identities through
 * IdentityRegistry, but only patients can grant or revoke access
 * to their own medical-record categories.
 */
contract AccessControl {
    IIdentityRegistry public identityRegistry;
    IAuditLog public auditLog;

    /*
     * patient => doctor => category hash => permission status
     *
     * The category string is converted to a hash so it can be used
     * efficiently as a mapping key.
     */
    mapping(address =>
        mapping(address =>
            mapping(bytes32 => bool)
        )
    ) private permissions;

    event AccessGranted(
        address indexed patient,
        address indexed doctor,
        string recordCategory,
        uint256 timestamp
    );

    event AccessRevoked(
        address indexed patient,
        address indexed doctor,
        string recordCategory,
        uint256 timestamp
    );

    event AccessAttempted(
        address indexed patient,
        address indexed doctor,
        string recordCategory,
        bool granted,
        uint256 timestamp
    );

    event EmergencyAccessUsed(
        address indexed patient,
        address indexed doctor,
        string recordCategory,
        string justification,
        uint256 timestamp
    );

    modifier validAddress(address account) {
        require(account != address(0), "Invalid zero address");
        _;
    }

    modifier onlyActiveDoctor(address doctor) {
        require(
            identityRegistry.isActiveDoctor(doctor),
            "Doctor is not registered or active"
        );
        _;
    }

    constructor(
        address identityRegistryAddress,
        address auditLogAddress
    ) {
        require(
            identityRegistryAddress != address(0),
            "Invalid identity registry address"
        );

        require(
            auditLogAddress != address(0),
            "Invalid audit log address"
        );

        identityRegistry =
            IIdentityRegistry(identityRegistryAddress);

        auditLog = IAuditLog(auditLogAddress);
    }

    /**
     * @notice Patient grants a doctor access to one record category.
     *
     * msg.sender is the patient, meaning the transaction must be signed
     * using the patient's wallet.
     */
    function grantAccess(
        address doctor,
        string calldata recordCategory
    )
        external
        validAddress(doctor)
        onlyActiveDoctor(doctor)
    {
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        bytes32 categoryHash = hashCategory(recordCategory);

        require(
            !permissions[msg.sender][doctor][categoryHash],
            "Access is already granted"
        );

        permissions[msg.sender][doctor][categoryHash] = true;

        auditLog.recordLog(
            msg.sender,
            doctor,
            recordCategory,
            IAuditLog.Action.CONSENT_GRANTED,
            ""
        );

        emit AccessGranted(
            msg.sender,
            doctor,
            recordCategory,
            block.timestamp
        );
    }

    /**
     * @notice Patient revokes a doctor's access to one category.
     *
     * msg.sender must be the same patient who granted access.
     */
    function revokeAccess(
        address doctor,
        string calldata recordCategory
    )
        external
        validAddress(doctor)
    {
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        bytes32 categoryHash = hashCategory(recordCategory);

        require(
            permissions[msg.sender][doctor][categoryHash],
            "No active permission exists"
        );

        permissions[msg.sender][doctor][categoryHash] = false;

        auditLog.recordLog(
            msg.sender,
            doctor,
            recordCategory,
            IAuditLog.Action.CONSENT_REVOKED,
            ""
        );

        emit AccessRevoked(
            msg.sender,
            doctor,
            recordCategory,
            block.timestamp
        );
    }

    /**
     * @notice Checks whether a patient has granted access.
     *
     * This read-only function does not create an audit entry.
     */
    function hasAccess(
        address patient,
        address doctor,
        string calldata recordCategory
    )
        public
        view
        returns (bool)
    {
        if (!identityRegistry.isActiveDoctor(doctor)) {
            return false;
        }

        return permissions[patient][doctor][
            hashCategory(recordCategory)
        ];
    }

    /**
     * @notice Doctor attempts to access a patient's record category.
     *
     * The doctor's own wallet must sign the transaction. Both successful
     * and denied attempts are permanently recorded.
     */
    function requestAccess(
        address patient,
        string calldata recordCategory
    )
        external
        validAddress(patient)
        onlyActiveDoctor(msg.sender)
        returns (bool)
    {
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        bool granted = hasAccess(
            patient,
            msg.sender,
            recordCategory
        );

        IAuditLog.Action action = granted
            ? IAuditLog.Action.ACCESS_GRANTED
            : IAuditLog.Action.ACCESS_DENIED;

        auditLog.recordLog(
            patient,
            msg.sender,
            recordCategory,
            action,
            ""
        );

        emit AccessAttempted(
            patient,
            msg.sender,
            recordCategory,
            granted,
            block.timestamp
        );

        return granted;
    }

    /**
     * @notice Active doctor obtains emergency access without consent.
     *
     * Emergency access does not create a permanent consent permission.
     * It only records this individual override.
     */
    function emergencyOverride(
        address patient,
        string calldata recordCategory,
        string calldata justification
    )
        external
        validAddress(patient)
        onlyActiveDoctor(msg.sender)
        returns (bool)
    {
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        require(
            bytes(justification).length > 0,
            "Emergency justification is required"
        );

        auditLog.recordLog(
            patient,
            msg.sender,
            recordCategory,
            IAuditLog.Action.EMERGENCY_OVERRIDE,
            justification
        );

        emit EmergencyAccessUsed(
            patient,
            msg.sender,
            recordCategory,
            justification,
            block.timestamp
        );

        return true;
    }

    function hashCategory(string memory recordCategory)
        public
        pure
        returns (bytes32)
    {
        return keccak256(bytes(recordCategory));
    }
}