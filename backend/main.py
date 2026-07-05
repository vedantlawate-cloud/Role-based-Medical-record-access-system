"""
main.py
---------
Flask backend for the Decentralized Access Management Framework
for Medical Record Sharing.

Holds:
  - Flask app + routes
  - Database models (SQLAlchemy)
  - Two-tier access logic:
      1. Hospital Admin Layer -> registers doctors (identity/role management)
      2. Patient Consent Layer -> patients grant/revoke access to their records

Every grant/revoke/access attempt is written to the AccessLog table
AND (eventually) mirrored on-chain via blockchain.py + AuditLog.sol.
"""

from datetime import datetime
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from blockchain import BlockchainError, get_blockchain
from flask_cors import CORS

# ---------------------------------------------------------------------------
# App + DB setup
# ---------------------------------------------------------------------------


app = Flask(__name__)
CORS(app, origins=["http://localhost:5173"])
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///medical_access.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

@app.errorhandler(BlockchainError)
def handle_blockchain_error(error):
    db.session.rollback()
    return jsonify({
        "error": "Blockchain operation failed",
        "details": str(error),
    }), 502


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Patient(db.Model):
    __tablename__ = "patients"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    wallet_address = db.Column(db.String(42), unique=True, nullable=False)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "wallet_address": self.wallet_address}


class Doctor(db.Model):
    __tablename__ = "doctors"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    specialty = db.Column(db.String(120), nullable=True)
    wallet_address = db.Column(db.String(42), unique=True, nullable=False)
    # registered_by = hospital admin who added this doctor (identity layer)
    registered_by = db.Column(db.String(120), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "specialty": self.specialty,
            "wallet_address": self.wallet_address,
            "registered_by": self.registered_by,
        }


class AccessGrant(db.Model):
    """
    Represents a patient's authorization for a specific doctor
    to view a specific category of their records.
    This is the Patient Consent Layer.
    """
    __tablename__ = "access_grants"

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=False)
    doctor_id = db.Column(db.Integer, db.ForeignKey("doctors.id"), nullable=False)
    record_category = db.Column(db.String(80), nullable=False)  # e.g. "cardiac_history"
    is_active = db.Column(db.Boolean, default=True)
    granted_at = db.Column(db.DateTime, default=datetime.utcnow)
    revoked_at = db.Column(db.DateTime, nullable=True)

    patient = db.relationship("Patient")
    doctor = db.relationship("Doctor")

    def to_dict(self):
        return {
            "id": self.id,
            "patient_id": self.patient_id,
            "doctor_id": self.doctor_id,
            "record_category": self.record_category,
            "is_active": self.is_active,
            "granted_at": self.granted_at.isoformat(),
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
        }


class AccessLog(db.Model):
    """
    Immutable-style audit trail of every access attempt
    (granted, denied, or emergency override).
    """
    __tablename__ = "access_logs"

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=False)
    doctor_id = db.Column(db.Integer, db.ForeignKey("doctors.id"), nullable=False)
    record_category = db.Column(db.String(80), nullable=False)
    action = db.Column(db.String(20), nullable=False)  # "granted" | "denied" | "emergency_override"
    justification = db.Column(db.String(255), nullable=True)  # required for emergency_override
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "patient_id": self.patient_id,
            "doctor_id": self.doctor_id,
            "record_category": self.record_category,
            "action": self.action,
            "justification": self.justification,
            "timestamp": self.timestamp.isoformat(),
        }


# ---------------------------------------------------------------------------
# Hospital Admin routes (Identity Layer)
# ---------------------------------------------------------------------------

@app.route("/admin/register_doctor", methods=["POST"])
def register_doctor():
    data = request.get_json()

    required = ["name", "wallet_address", "registered_by"]
    if not data or not all(field in data for field in required):
        return jsonify({"error": f"Missing fields, required: {required}"}), 400

    existing = Doctor.query.filter_by(
        wallet_address=data["wallet_address"]
    ).first()

    if existing:
        return jsonify({"error": "Doctor wallet already registered"}), 409

    blockchain_result = get_blockchain().register_doctor(
        doctor_address=data["wallet_address"],
        role=data.get("role", "doctor"),
        specialty=data.get("specialty", ""),
    )

    doctor = Doctor(
        name=data["name"],
        specialty=data.get("specialty"),
        wallet_address=data["wallet_address"],
        registered_by=data["registered_by"],
    )

    db.session.add(doctor)
    db.session.commit()

    response = doctor.to_dict()
    response["blockchain"] = blockchain_result

    return jsonify(response), 201


@app.route("/admin/doctors", methods=["GET"])
def list_doctors():
    doctors = Doctor.query.all()
    return jsonify([d.to_dict() for d in doctors])


# ---------------------------------------------------------------------------
# Patient routes (Consent Layer)
# ---------------------------------------------------------------------------

@app.route("/patient/register", methods=["POST"])
def register_patient():
    data = request.get_json()

    required = ["name", "wallet_address"]
    if not all(field in data for field in required):
        return jsonify({"error": f"Missing fields, required: {required}"}), 400

    patient = Patient(name=data["name"], wallet_address=data["wallet_address"])
    db.session.add(patient)
    db.session.commit()

    return jsonify(patient.to_dict()), 201


@app.route("/patient/grant_access", methods=["POST"])
def grant_access():
    data = request.get_json()

    required = ["patient_id", "doctor_id", "record_category"]
    if not data or not all(field in data for field in required):
        return jsonify({"error": f"Missing fields, required: {required}"}), 400

    patient = db.session.get(Patient, data["patient_id"])
    doctor = db.session.get(Doctor, data["doctor_id"])

    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404

    existing = AccessGrant.query.filter_by(
        patient_id=patient.id,
        doctor_id=doctor.id,
        record_category=data["record_category"],
        is_active=True,
    ).first()

    if existing:
        return jsonify({"error": "Access is already granted"}), 409

    blockchain_result = get_blockchain().grant_access(
        patient.wallet_address,
        doctor.wallet_address,
        data["record_category"],
    )

    grant = AccessGrant(
        patient_id=patient.id,
        doctor_id=doctor.id,
        record_category=data["record_category"],
        is_active=True,
    )

    log_entry = AccessLog(
        patient_id=patient.id,
        doctor_id=doctor.id,
        record_category=data["record_category"],
        action="consent_granted",
    )

    db.session.add(grant)
    db.session.add(log_entry)
    db.session.commit()

    response = grant.to_dict()
    response["blockchain"] = blockchain_result

    return jsonify(response), 201


@app.route("/patient/revoke_access/<int:grant_id>", methods=["POST"])
def revoke_access(grant_id):
    grant = db.session.get(AccessGrant, grant_id)

    if not grant:
        return jsonify({"error": "Access grant not found"}), 404

    if not grant.is_active:
        return jsonify({"error": "Access already revoked"}), 400

    blockchain_result = get_blockchain().revoke_access(
        grant.patient.wallet_address,
        grant.doctor.wallet_address,
        grant.record_category,
    )

    grant.is_active = False
    grant.revoked_at = datetime.utcnow()

    log_entry = AccessLog(
        patient_id=grant.patient_id,
        doctor_id=grant.doctor_id,
        record_category=grant.record_category,
        action="consent_revoked",
    )

    db.session.add(log_entry)
    db.session.commit()

    response = grant.to_dict()
    response["blockchain"] = blockchain_result

    return jsonify(response)

@app.route("/patients", methods=["GET"])
def list_patients():
    patients = Patient.query.all()
    return jsonify([patient.to_dict() for patient in patients])


@app.route("/patient/<int:patient_id>/grants", methods=["GET"])
def list_patient_grants(patient_id):
    patient = db.session.get(Patient, patient_id)

    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    grants = AccessGrant.query.filter_by(
        patient_id=patient_id
    ).order_by(AccessGrant.granted_at.desc()).all()

    return jsonify([grant.to_dict() for grant in grants])


# ---------------------------------------------------------------------------
# Doctor / access-check routes
# ---------------------------------------------------------------------------
# granted | denied | emergency_override | consent_granted | consent_revoked

@app.route("/doctor/request_access", methods=["POST"])
def request_access():
    data = request.get_json()

    required = ["patient_id", "doctor_id", "record_category"]
    if not data or not all(field in data for field in required):
        return jsonify({"error": f"Missing fields, required: {required}"}), 400

    patient = db.session.get(Patient, data["patient_id"])
    doctor = db.session.get(Doctor, data["doctor_id"])

    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404

    blockchain_result = get_blockchain().request_access(
        patient.wallet_address,
        doctor.wallet_address,
        data["record_category"],
    )

    granted = blockchain_result["granted"]
    action = "granted" if granted else "denied"

    log_entry = AccessLog(
        patient_id=patient.id,
        doctor_id=doctor.id,
        record_category=data["record_category"],
        action=action,
    )

    db.session.add(log_entry)
    db.session.commit()

    response = {
        "access": action,
        "blockchain": blockchain_result,
    }

    return jsonify(response), 200 if granted else 403


@app.route("/doctor/emergency_override", methods=["POST"])
def emergency_override():
    data = request.get_json()

    required = [
        "patient_id",
        "doctor_id",
        "record_category",
        "justification",
    ]

    if not data or not all(field in data for field in required):
        return jsonify({"error": f"Missing fields, required: {required}"}), 400

    if not str(data["justification"]).strip():
        return jsonify({"error": "Justification cannot be empty"}), 400

    patient = db.session.get(Patient, data["patient_id"])
    doctor = db.session.get(Doctor, data["doctor_id"])

    if not patient:
        return jsonify({"error": "Patient not found"}), 404

    if not doctor:
        return jsonify({"error": "Doctor not found"}), 404

    blockchain_result = get_blockchain().emergency_override(
        patient.wallet_address,
        doctor.wallet_address,
        data["record_category"],
        data["justification"],
    )

    log_entry = AccessLog(
        patient_id=patient.id,
        doctor_id=doctor.id,
        record_category=data["record_category"],
        action="emergency_override",
        justification=data["justification"],
    )

    db.session.add(log_entry)
    db.session.commit()

    return jsonify({
        "access": "granted_via_override",
        "log": log_entry.to_dict(),
        "blockchain": blockchain_result,
    })


# ---------------------------------------------------------------------------
# Audit trail route
# ---------------------------------------------------------------------------

@app.route("/audit/patient/<int:patient_id>", methods=["GET"])
def patient_audit_trail(patient_id):
    """Full access history for a given patient — the public/audit-facing view."""
    logs = AccessLog.query.filter_by(patient_id=patient_id).order_by(AccessLog.timestamp.desc()).all()
    return jsonify([log.to_dict() for log in logs])


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
