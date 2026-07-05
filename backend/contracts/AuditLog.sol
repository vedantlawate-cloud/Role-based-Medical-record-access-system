// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AuditLog
 * @notice Immutable audit trail for consent changes, access attempts,
 *         and emergency overrides.
 *
 * Entries can be added but never modified or deleted.
 */
contract AuditLog {
    address public owner;
    mapping(address => bool) public authorizedWriters;

    enum Action {
        ACCESS_GRANTED,
        ACCESS_DENIED,
        EMERGENCY_OVERRIDE,
        CONSENT_GRANTED,
        CONSENT_REVOKED
    }

    struct LogEntry {
        uint256 id;
        address patient;
        address doctor;
        string recordCategory;
        Action action;
        string justification;
        uint256 timestamp;
        address recordedBy;
    }

    LogEntry[] private logEntries;

    event WriterAuthorizationChanged(
        address indexed writer,
        bool authorized
    );

    event AuditEntryCreated(
        uint256 indexed id,
        address indexed patient,
        address indexed doctor,
        string recordCategory,
        Action action,
        string justification,
        uint256 timestamp,
        address recordedBy
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    modifier onlyAuthorizedWriter() {
        require(
            authorizedWriters[msg.sender],
            "Caller is not authorized to write audit entries"
        );
        _;
    }

    modifier validAddresses(address patient, address doctor) {
        require(patient != address(0), "Invalid patient address");
        require(doctor != address(0), "Invalid doctor address");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedWriters[msg.sender] = true;

        emit WriterAuthorizationChanged(msg.sender, true);
    }

    /**
     * @notice Authorizes or removes a contract/account that may create logs.
     *
     * The deployed AccessControl contract will be authorized through this
     * function during deployment.
     */
    function setAuthorizedWriter(address writer, bool authorized)
        external
        onlyOwner
    {
        require(writer != address(0), "Invalid writer address");

        authorizedWriters[writer] = authorized;

        emit WriterAuthorizationChanged(writer, authorized);
    }

    /**
     * @notice Adds a permanent audit entry.
     *
     * Existing entries cannot be edited or removed.
     */
    function recordLog(
        address patient,
        address doctor,
        string calldata recordCategory,
        Action action,
        string calldata justification
    )
        external
        onlyAuthorizedWriter
        validAddresses(patient, doctor)
        returns (uint256)
    {
        require(
            bytes(recordCategory).length > 0,
            "Record category is required"
        );

        if (action == Action.EMERGENCY_OVERRIDE) {
            require(
                bytes(justification).length > 0,
                "Emergency justification is required"
            );
        }

        uint256 logId = logEntries.length;

        logEntries.push(
            LogEntry({
                id: logId,
                patient: patient,
                doctor: doctor,
                recordCategory: recordCategory,
                action: action,
                justification: justification,
                timestamp: block.timestamp,
                recordedBy: msg.sender
            })
        );

        emit AuditEntryCreated(
            logId,
            patient,
            doctor,
            recordCategory,
            action,
            justification,
            block.timestamp,
            msg.sender
        );

        return logId;
    }

    function getLog(uint256 logId)
        external
        view
        returns (LogEntry memory)
    {
        require(logId < logEntries.length, "Audit entry does not exist");
        return logEntries[logId];
    }

    function getLogCount() external view returns (uint256) {
        return logEntries.length;
    }

    /**
     * @notice Returns all logs involving a particular patient.
     * Suitable for the local coursework blockchain.
     */
    function getPatientLogs(address patient)
        external
        view
        returns (LogEntry[] memory)
    {
        uint256 count = 0;

        for (uint256 i = 0; i < logEntries.length; i++) {
            if (logEntries[i].patient == patient) {
                count++;
            }
        }

        LogEntry[] memory patientLogs = new LogEntry[](count);
        uint256 resultIndex = 0;

        for (uint256 i = 0; i < logEntries.length; i++) {
            if (logEntries[i].patient == patient) {
                patientLogs[resultIndex] = logEntries[i];
                resultIndex++;
            }
        }

        return patientLogs;
    }
}