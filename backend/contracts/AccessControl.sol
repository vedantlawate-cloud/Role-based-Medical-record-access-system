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
 * @notice Admin/head-doctor assignment authorization layer.
 *
 * Hospital administrators/head doctors assign or revoke doctor access
 * to patient record categories. Patients do not grant/revoke access.
 *
 * This model is better for hosted Sepolia deployment because the backend
 * only needs the admin/deployer wallet to sign assignment transactions.
 */
contract AccessControl {
    address public owner;
    IIdentityRegistry public identityRegistry;
    IAuditLog public auditLog;

    /*
     * patient => doctor => category hash => assignment status
     */
    mapping(address =>
        mapping(address =>
            mapping(bytes32 => bool)
        )
    ) private permissions;

    mapping(address => bool) public assignmentManagers;

    event AssignmentManagerChanged(
        address indexed manager,
        bool authorized
    );

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

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    modifier onlyAssignmentManager() {
        require(
            assignmentManagers[msg.sender],
            "Only assignment manager can perform this action"
        );
        _;
    }

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

        owner = msg.sender;
        assignmentManagers[msg.sender] = true;

        identityRegistry =
            IIdentityRegistry(identityRegistryAddress);

        auditLog = IAuditLog(auditLogAddress);

        emit AssignmentManagerChanged(msg.sender, true);
    }

    function setAssignmentManager(address manager, bool authorized)
        external
        onlyOwner
        validAddress(manager)
    {
        assignmentManagers[manager] = authorized;
        emit AssignmentManagerChanged(manager, authorized);
    }

    /**
     * @notice Admin/head doctor assigns a doctor to a patient record category.
     */
    function assignDoctor(
        address patient,
        address doctor,
        string calldata recordCategory
    )
        public
        onlyAssignmentManager
        validAddress(patient)
        validAddress(doctor)
        onlyActiveDoctor(doctor)
    {
        require(patient != doctor, "Patient and doctor cannot be same");
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        bytes32 categoryHash = hashCategory(recordCategory);

        require(
            !permissions[patient][doctor][categoryHash],
            "Access is already granted"
        );

        permissions[patient][doctor][categoryHash] = true;

        auditLog.recordLog(
            patient,
            doctor,
            recordCategory,
            IAuditLog.Action.CONSENT_GRANTED,
            ""
        );

        emit AccessGranted(
            patient,
            doctor,
            recordCategory,
            block.timestamp
        );
    }

    /**
     * @notice Admin/head doctor revokes a doctor's assignment.
     */
    function revokeDoctorAssignment(
        address patient,
        address doctor,
        string calldata recordCategory
    )
        public
        onlyAssignmentManager
        validAddress(patient)
        validAddress(doctor)
    {
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        bytes32 categoryHash = hashCategory(recordCategory);

        require(
            permissions[patient][doctor][categoryHash],
            "No active permission exists"
        );

        permissions[patient][doctor][categoryHash] = false;

        auditLog.recordLog(
            patient,
            doctor,
            recordCategory,
            IAuditLog.Action.CONSENT_REVOKED,
            ""
        );

        emit AccessRevoked(
            patient,
            doctor,
            recordCategory,
            block.timestamp
        );
    }

    /**
     * @notice Backend-compatible wrapper.
     *
     * The old Flask method is named grant_access. This Solidity wrapper keeps
     * the old function name available, but the signer is now an assignment
     * manager, not the patient.
     */
    function grantAccess(
        address patient,
        address doctor,
        string calldata recordCategory
    )
        external
    {
        assignDoctor(patient, doctor, recordCategory);
    }

    /**
     * @notice Backend-compatible wrapper for assignment revocation.
     */
    function revokeAccess(
        address patient,
        address doctor,
        string calldata recordCategory
    )
        external
    {
        revokeDoctorAssignment(patient, doctor, recordCategory);
    }

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
     * @notice Logs a doctor's access attempt.
     *
     * In hosted mode, the backend/admin signer records the attempt on behalf
     * of the doctor selected in the application.
     */
    function requestAccess(
        address patient,
        address doctor,
        string calldata recordCategory
    )
        external
        onlyAssignmentManager
        validAddress(patient)
        validAddress(doctor)
        onlyActiveDoctor(doctor)
        returns (bool)
    {
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        bool granted = hasAccess(patient, doctor, recordCategory);

        IAuditLog.Action action = granted
            ? IAuditLog.Action.ACCESS_GRANTED
            : IAuditLog.Action.ACCESS_DENIED;

        auditLog.recordLog(
            patient,
            doctor,
            recordCategory,
            action,
            ""
        );

        emit AccessAttempted(
            patient,
            doctor,
            recordCategory,
            granted,
            block.timestamp
        );

        return granted;
    }

    /**
     * @notice Logs emergency access on behalf of an active doctor.
     */
    function emergencyOverride(
        address patient,
        address doctor,
        string calldata recordCategory,
        string calldata justification
    )
        external
        onlyAssignmentManager
        validAddress(patient)
        validAddress(doctor)
        onlyActiveDoctor(doctor)
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
            doctor,
            recordCategory,
            IAuditLog.Action.EMERGENCY_OVERRIDE,
            justification
        );

        emit EmergencyAccessUsed(
            patient,
            doctor,
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
