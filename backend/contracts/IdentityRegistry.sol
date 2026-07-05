// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IdentityRegistry
 * @notice Hospital-admin identity layer.
 *
 * Hospital admins may register and deactivate doctors and assign roles.
 * This contract does NOT grant access to patient medical records.
 */
contract IdentityRegistry {
    address public owner;

    struct Doctor {
        bool exists;
        bool active;
        string role;
        string specialty;
        address registeredBy;
        uint256 registeredAt;
    }

    mapping(address => bool) public hospitalAdmins;
    mapping(address => Doctor) private doctors;

    event HospitalAdminAdded(
        address indexed admin,
        address indexed addedBy
    );

    event HospitalAdminRemoved(
        address indexed admin,
        address indexed removedBy
    );

    event DoctorRegistered(
        address indexed doctor,
        string role,
        string specialty,
        address indexed registeredBy,
        uint256 timestamp
    );

    event DoctorUpdated(
        address indexed doctor,
        string role,
        string specialty,
        address indexed updatedBy,
        uint256 timestamp
    );

    event DoctorStatusChanged(
        address indexed doctor,
        bool active,
        address indexed changedBy,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    modifier onlyHospitalAdmin() {
        require(
            hospitalAdmins[msg.sender],
            "Only hospital admin can perform this action"
        );
        _;
    }

    modifier validAddress(address account) {
        require(account != address(0), "Invalid zero address");
        _;
    }

    constructor() {
        owner = msg.sender;
        hospitalAdmins[msg.sender] = true;

        emit HospitalAdminAdded(msg.sender, msg.sender);
    }

    /**
     * @notice Adds another hospital administrator.
     * Only the contract owner may add administrators.
     */
    function addHospitalAdmin(address admin)
        external
        onlyOwner
        validAddress(admin)
    {
        require(!hospitalAdmins[admin], "Address is already an admin");

        hospitalAdmins[admin] = true;
        emit HospitalAdminAdded(admin, msg.sender);
    }

    /**
     * @notice Removes a hospital administrator.
     */
    function removeHospitalAdmin(address admin)
        external
        onlyOwner
        validAddress(admin)
    {
        require(admin != owner, "Owner cannot be removed as admin");
        require(hospitalAdmins[admin], "Address is not an admin");

        hospitalAdmins[admin] = false;
        emit HospitalAdminRemoved(admin, msg.sender);
    }

    /**
     * @notice Registers a doctor's blockchain identity and role.
     * This does not grant access to any patient's records.
     */
    function registerDoctor(
        address doctorAddress,
        string calldata role,
        string calldata specialty
    )
        external
        onlyHospitalAdmin
        validAddress(doctorAddress)
    {
        require(!doctors[doctorAddress].exists, "Doctor already registered");
        require(bytes(role).length > 0, "Role is required");

        doctors[doctorAddress] = Doctor({
            exists: true,
            active: true,
            role: role,
            specialty: specialty,
            registeredBy: msg.sender,
            registeredAt: block.timestamp
        });

        emit DoctorRegistered(
            doctorAddress,
            role,
            specialty,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @notice Updates identity information without changing data access.
     */
    function updateDoctor(
        address doctorAddress,
        string calldata role,
        string calldata specialty
    )
        external
        onlyHospitalAdmin
        validAddress(doctorAddress)
    {
        require(doctors[doctorAddress].exists, "Doctor is not registered");
        require(bytes(role).length > 0, "Role is required");

        doctors[doctorAddress].role = role;
        doctors[doctorAddress].specialty = specialty;

        emit DoctorUpdated(
            doctorAddress,
            role,
            specialty,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @notice Activates or deactivates a registered doctor.
     * Historical identity information remains available.
     */
    function setDoctorActive(address doctorAddress, bool active)
        external
        onlyHospitalAdmin
        validAddress(doctorAddress)
    {
        require(doctors[doctorAddress].exists, "Doctor is not registered");
        require(
            doctors[doctorAddress].active != active,
            "Doctor already has this status"
        );

        doctors[doctorAddress].active = active;

        emit DoctorStatusChanged(
            doctorAddress,
            active,
            msg.sender,
            block.timestamp
        );
    }

    function isRegisteredDoctor(address doctorAddress)
        external
        view
        returns (bool)
    {
        return doctors[doctorAddress].exists;
    }

    function isActiveDoctor(address doctorAddress)
        external
        view
        returns (bool)
    {
        return doctors[doctorAddress].exists &&
            doctors[doctorAddress].active;
    }

    function getDoctor(address doctorAddress)
        external
        view
        returns (Doctor memory)
    {
        require(doctors[doctorAddress].exists, "Doctor is not registered");
        return doctors[doctorAddress];
    }
}