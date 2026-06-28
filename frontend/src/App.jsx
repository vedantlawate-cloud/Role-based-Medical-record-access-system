import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

const api = axios.create({
  baseURL: "http://127.0.0.1:5000",
});

const recordCategories = [
  "cardiac_history",
  "mental_health",
  "allergies",
  "medications",
  "lab_results",
  "radiology",
  "surgery_notes",
  "billing_records",
];

const categoryLabel = {
  cardiac_history: "Cardiac history",
  mental_health: "Mental health",
  allergies: "Allergies",
  medications: "Medications",
  lab_results: "Lab results",
  radiology: "Radiology",
  surgery_notes: "Surgery notes",
  billing_records: "Billing records",
};

const roleTabs = [
  {
    id: "admin",
    title: "Admin / Head Doctor",
    subtitle: "Assign doctors, revoke access, and review audit activity.",
  },
  {
    id: "doctor",
    title: "Doctor",
    subtitle: "View assigned patients and request category-based access.",
  },
  {
    id: "patient",
    title: "Patient",
    subtitle: "Maintain medical history, medication, allergies, and bills.",
  },
];

const emptyHealthRecord = {
  age: "",
  bloodGroup: "",
  condition: "",
  allergies: "",
  medications: "",
  dosageComfort: "",
  surgeries: "",
  operatedBy: "",
  medicalHistory: "",
  bills: "",
  notes: "",
  updatedAt: "",
};

function prettyCategory(category) {
  return categoryLabel[category] || String(category).replaceAll("_", " ");
}

function walletShort(address = "") {
  if (!address) return "No wallet";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function loadStoredRecords() {
  try {
    return JSON.parse(localStorage.getItem("medical-health-records") || "{}");
  } catch {
    return {};
  }
}

function App() {
  const [activeRole, setActiveRole] = useState("admin");
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [grants, setGrants] = useState([]);
  const [logs, setLogs] = useState([]);
  const [healthRecords, setHealthRecords] = useState(loadStoredRecords);

  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(recordCategories[0]);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const [doctorForm, setDoctorForm] = useState({
    name: "",
    specialty: "",
    wallet_address: "",
    registered_by: "",
    role: "doctor",
  });

  const [patientForm, setPatientForm] = useState({
    name: "",
    wallet_address: "",
  });

  const [emergencyJustification, setEmergencyJustification] = useState("");

  useEffect(() => {
    refreshSystem();
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "medical-health-records",
      JSON.stringify(healthRecords),
    );
  }, [healthRecords]);

  const patientMap = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient])),
    [patients],
  );

  const doctorMap = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor])),
    [doctors],
  );

  const selectedPatient = patientMap.get(Number(selectedPatientId));
  const selectedDoctor = doctorMap.get(Number(selectedDoctorId));

  const activeGrants = grants.filter((grant) => grant.is_active);
  const selectedPatientGrants = grants.filter(
    (grant) => grant.patient_id === Number(selectedPatientId),
  );
  const selectedPatientLogs = logs.filter(
    (log) => log.patient_id === Number(selectedPatientId),
  );
  const selectedDoctorAssignments = activeGrants.filter(
    (grant) => grant.doctor_id === Number(selectedDoctorId),
  );
  const selectedDoctorPatients = selectedDoctorAssignments.map((grant) => ({
    ...grant,
    patient: patientMap.get(grant.patient_id),
    record: healthRecords[grant.patient_id] || emptyHealthRecord,
  }));

  async function refreshSystem() {
    setIsBusy(true);
    try {
      const [patientResponse, doctorResponse] = await Promise.all([
        api.get("/patients"),
        api.get("/admin/doctors"),
      ]);

      const loadedPatients = patientResponse.data;
      const loadedDoctors = doctorResponse.data;

      const grantResponses = await Promise.allSettled(
        loadedPatients.map((patient) => api.get(`/patient/${patient.id}/grants`)),
      );

      const logResponses = await Promise.allSettled(
        loadedPatients.map((patient) => api.get(`/audit/patient/${patient.id}`)),
      );

      const loadedGrants = grantResponses.flatMap((result) =>
        result.status === "fulfilled" ? result.value.data : [],
      );

      const loadedLogs = logResponses.flatMap((result) =>
        result.status === "fulfilled" ? result.value.data : [],
      );

      setPatients(loadedPatients);
      setDoctors(loadedDoctors);
      setGrants(loadedGrants);
      setLogs(loadedLogs);

      if (!selectedPatientId && loadedPatients.length) {
        setSelectedPatientId(String(loadedPatients[0].id));
      }

      if (!selectedDoctorId && loadedDoctors.length) {
        setSelectedDoctorId(String(loadedDoctors[0].id));
      }
    } catch (error) {
      setMessage(
        error.response?.data?.error ||
          "Could not connect to Flask. Start the backend and try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function registerDoctor(event) {
    event.preventDefault();

    if (!doctorForm.name.trim() || !doctorForm.wallet_address.trim()) {
      setMessage("Doctor name and wallet address are required.");
      return;
    }

    setIsBusy(true);
    try {
      await api.post("/admin/register_doctor", doctorForm);
      setMessage("Doctor registered successfully.");
      setDoctorForm({
        name: "",
        specialty: "",
        wallet_address: "",
        registered_by: "",
        role: "doctor",
      });
      await refreshSystem();
    } catch (error) {
      setMessage(error.response?.data?.error || "Doctor registration failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function registerPatient(event) {
    event.preventDefault();

    if (!patientForm.name.trim() || !patientForm.wallet_address.trim()) {
      setMessage("Patient name and wallet address are required.");
      return;
    }

    setIsBusy(true);
    try {
      await api.post("/patient/register", patientForm);
      setMessage("Patient registered successfully.");
      setPatientForm({ name: "", wallet_address: "" });
      await refreshSystem();
    } catch (error) {
      setMessage(error.response?.data?.error || "Patient registration failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function assignDoctor(event) {
    event.preventDefault();

    if (!selectedPatientId || !selectedDoctorId || !selectedCategory) {
      setMessage("Choose a patient, doctor, and record category first.");
      return;
    }

    setIsBusy(true);
    try {
      await api.post("/patient/grant_access", {
        patient_id: Number(selectedPatientId),
        doctor_id: Number(selectedDoctorId),
        record_category: selectedCategory,
      });

      setMessage("Doctor assignment recorded successfully.");
      await refreshSystem();
    } catch (error) {
      setMessage(error.response?.data?.error || "Assignment failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function revokeAssignment(grantId) {
    setIsBusy(true);
    try {
      await api.post(`/patient/revoke_access/${grantId}`);
      setMessage("Doctor assignment revoked successfully.");
      await refreshSystem();
    } catch (error) {
      setMessage(error.response?.data?.error || "Revocation failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestDoctorAccess(grant) {
    setIsBusy(true);
    try {
      const response = await api.post("/doctor/request_access", {
        patient_id: grant.patient_id,
        doctor_id: grant.doctor_id,
        record_category: grant.record_category,
      });

      setMessage(`Access ${response.data.access}. Audit log updated.`);
      await refreshSystem();
    } catch (error) {
      if (error.response?.status === 403) {
        setMessage("Access denied. The denied attempt was logged.");
      } else {
        setMessage(error.response?.data?.error || "Access request failed.");
      }
      await refreshSystem();
    } finally {
      setIsBusy(false);
    }
  }

  async function emergencyOverride(event) {
    event.preventDefault();

    if (!selectedPatientId || !selectedDoctorId || !selectedCategory) {
      setMessage("Choose a patient, doctor, and record category first.");
      return;
    }

    if (!emergencyJustification.trim()) {
      setMessage("Emergency override requires a justification.");
      return;
    }

    setIsBusy(true);
    try {
      await api.post("/doctor/emergency_override", {
        patient_id: Number(selectedPatientId),
        doctor_id: Number(selectedDoctorId),
        record_category: selectedCategory,
        justification: emergencyJustification,
      });

      setMessage("Emergency override granted and permanently logged.");
      setEmergencyJustification("");
      await refreshSystem();
    } catch (error) {
      setMessage(error.response?.data?.error || "Emergency override failed.");
    } finally {
      setIsBusy(false);
    }
  }

  function saveHealthRecord(patientId, patch) {
    const current = healthRecords[patientId] || emptyHealthRecord;
    setHealthRecords({
      ...healthRecords,
      [patientId]: {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    });
    setMessage("Patient health record saved in the frontend workspace.");
  }

  function updateHealthField(field, value) {
    if (!selectedPatientId) return;
    const current = healthRecords[selectedPatientId] || emptyHealthRecord;
    setHealthRecords({
      ...healthRecords,
      [selectedPatientId]: {
        ...current,
        [field]: value,
      },
    });
  }

  const selectedHealthRecord =
    healthRecords[selectedPatientId] || emptyHealthRecord;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <span className="brand-icon">✦</span>
          <div>
            <p className="eyebrow">Blockchain medical records</p>
            <h1>Access Management</h1>
          </div>
        </div>

        <nav className="role-nav" aria-label="Role selection">
          {roleTabs.map((role) => (
            <button
              className={activeRole === role.id ? "role-tab active" : "role-tab"}
              key={role.id}
              onClick={() => setActiveRole(role.id)}
            >
              <strong>{role.title}</strong>
              <span>{role.subtitle}</span>
            </button>
          ))}
        </nav>

        <div className="network-card">
          <span className="pulse" />
          <div>
            <strong>Ganache local chain</strong>
            <small>Flask API: 127.0.0.1:5000</small>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Three-tier medical sharing framework</p>
            <h2>{roleTabs.find((role) => role.id === activeRole)?.title}</h2>
          </div>

          <button className="ghost-button" onClick={refreshSystem}>
            {isBusy ? "Syncing..." : "Refresh data"}
          </button>
        </header>

        {message && (
          <button className="notice" onClick={() => setMessage("")}>
            {message}
          </button>
        )}

        {activeRole === "admin" && (
          <AdminPanel
            doctors={doctors}
            patients={patients}
            grants={grants}
            logs={logs}
            selectedPatientId={selectedPatientId}
            selectedDoctorId={selectedDoctorId}
            selectedCategory={selectedCategory}
            setSelectedPatientId={setSelectedPatientId}
            setSelectedDoctorId={setSelectedDoctorId}
            setSelectedCategory={setSelectedCategory}
            doctorForm={doctorForm}
            setDoctorForm={setDoctorForm}
            patientForm={patientForm}
            setPatientForm={setPatientForm}
            registerDoctor={registerDoctor}
            registerPatient={registerPatient}
            assignDoctor={assignDoctor}
            revokeAssignment={revokeAssignment}
            doctorMap={doctorMap}
            patientMap={patientMap}
            selectedPatientGrants={selectedPatientGrants}
            selectedPatientLogs={selectedPatientLogs}
          />
        )}

        {activeRole === "doctor" && (
          <DoctorPanel
            doctors={doctors}
            patients={patients}
            selectedDoctorId={selectedDoctorId}
            setSelectedDoctorId={setSelectedDoctorId}
            selectedPatientId={selectedPatientId}
            setSelectedPatientId={setSelectedPatientId}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            selectedDoctor={selectedDoctor}
            assignments={selectedDoctorPatients}
            requestDoctorAccess={requestDoctorAccess}
            emergencyJustification={emergencyJustification}
            setEmergencyJustification={setEmergencyJustification}
            emergencyOverride={emergencyOverride}
            healthRecords={healthRecords}
            selectedHealthRecord={selectedHealthRecord}
          />
        )}

        {activeRole === "patient" && (
          <PatientPanel
            patients={patients}
            selectedPatientId={selectedPatientId}
            setSelectedPatientId={setSelectedPatientId}
            selectedPatient={selectedPatient}
            selectedHealthRecord={selectedHealthRecord}
            updateHealthField={updateHealthField}
            saveHealthRecord={saveHealthRecord}
            selectedPatientGrants={selectedPatientGrants}
            selectedPatientLogs={selectedPatientLogs}
            doctorMap={doctorMap}
          />
        )}
      </section>
    </main>
  );
}

function PeopleSelect({
  label,
  value,
  onChange,
  people,
  emptyText,
  describe,
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {people.length === 0 && <option value="">{emptyText}</option>}
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {describe(person)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CategorySelect({ value, onChange }) {
  return (
    <label className="field">
      <span>Record category</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {recordCategories.map((category) => (
          <option key={category} value={category}>
            {prettyCategory(category)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AdminPanel({
  doctors,
  patients,
  grants,
  logs,
  selectedPatientId,
  selectedDoctorId,
  selectedCategory,
  setSelectedPatientId,
  setSelectedDoctorId,
  setSelectedCategory,
  doctorForm,
  setDoctorForm,
  patientForm,
  setPatientForm,
  registerDoctor,
  registerPatient,
  assignDoctor,
  revokeAssignment,
  doctorMap,
  patientMap,
  selectedPatientGrants,
  selectedPatientLogs,
}) {
  const activeAssignmentCount = grants.filter((grant) => grant.is_active).length;

  return (
    <div className="page-grid">
      <section className="metric-grid">
        <Metric label="Registered patients" value={patients.length} />
        <Metric label="Registered doctors" value={doctors.length} />
        <Metric label="Active assignments" value={activeAssignmentCount} />
        <Metric label="Audit events" value={logs.length} />
      </section>

      <section className="card wide">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Admin authority layer</p>
            <h3>Assign or revoke doctor access</h3>
          </div>
          <span className="tag">Head doctor / admin only</span>
        </div>

        <form className="assignment-form" onSubmit={assignDoctor}>
          <PeopleSelect
            label="Patient"
            value={selectedPatientId}
            onChange={setSelectedPatientId}
            people={patients}
            emptyText="No patients registered"
            describe={(patient) => `${patient.name} · ${walletShort(patient.wallet_address)}`}
          />

          <PeopleSelect
            label="Doctor"
            value={selectedDoctorId}
            onChange={setSelectedDoctorId}
            people={doctors}
            emptyText="No doctors registered"
            describe={(doctor) => `${doctor.name} · ${doctor.specialty || "General"}`}
          />

          <CategorySelect
            value={selectedCategory}
            onChange={setSelectedCategory}
          />

          <button className="primary-button" type="submit">
            Assign doctor
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Identity management</p>
            <h3>Register doctor</h3>
          </div>
        </div>

        <form className="stacked-form" onSubmit={registerDoctor}>
          <input
            value={doctorForm.name}
            onChange={(event) =>
              setDoctorForm({ ...doctorForm, name: event.target.value })
            }
            placeholder="Doctor name"
          />
          <input
            value={doctorForm.specialty}
            onChange={(event) =>
              setDoctorForm({ ...doctorForm, specialty: event.target.value })
            }
            placeholder="Specialty, e.g. Cardiology"
          />
          <input
            value={doctorForm.wallet_address}
            onChange={(event) =>
              setDoctorForm({
                ...doctorForm,
                wallet_address: event.target.value,
              })
            }
            placeholder="Doctor Ganache wallet"
          />
          <input
            value={doctorForm.registered_by}
            onChange={(event) =>
              setDoctorForm({
                ...doctorForm,
                registered_by: event.target.value,
              })
            }
            placeholder="Admin / head doctor wallet"
          />
          <select
            value={doctorForm.role}
            onChange={(event) =>
              setDoctorForm({ ...doctorForm, role: event.target.value })
            }
          >
            <option value="doctor">Doctor</option>
            <option value="head_doctor">Head doctor</option>
            <option value="er_doctor">ER doctor</option>
          </select>
          <button className="primary-button" type="submit">
            Register doctor
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Patient onboarding</p>
            <h3>Register patient</h3>
          </div>
        </div>

        <form className="stacked-form" onSubmit={registerPatient}>
          <input
            value={patientForm.name}
            onChange={(event) =>
              setPatientForm({ ...patientForm, name: event.target.value })
            }
            placeholder="Patient name"
          />
          <input
            value={patientForm.wallet_address}
            onChange={(event) =>
              setPatientForm({
                ...patientForm,
                wallet_address: event.target.value,
              })
            }
            placeholder="Patient Ganache wallet"
          />
          <button className="primary-button" type="submit">
            Register patient
          </button>
        </form>
      </section>

      <section className="card wide">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current patient permissions</p>
            <h3>Assignments for selected patient</h3>
          </div>
        </div>

        <AssignmentTable
          grants={selectedPatientGrants}
          doctorMap={doctorMap}
          patientMap={patientMap}
          onRevoke={revokeAssignment}
          showPatient
        />
      </section>

      <section className="card wide">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Immutable audit trail</p>
            <h3>Selected patient activity</h3>
          </div>
        </div>

        <AuditTimeline
          logs={selectedPatientLogs}
          doctorMap={doctorMap}
          patientMap={patientMap}
        />
      </section>
    </div>
  );
}

function DoctorPanel({
  doctors,
  selectedDoctorId,
  setSelectedDoctorId,
  selectedPatientId,
  setSelectedPatientId,
  selectedCategory,
  setSelectedCategory,
  selectedDoctor,
  assignments,
  requestDoctorAccess,
  emergencyJustification,
  setEmergencyJustification,
  emergencyOverride,
  selectedHealthRecord,
}) {
  return (
    <div className="page-grid">
      <section className="card wide doctor-hero">
        <div>
          <p className="eyebrow">Doctor workspace</p>
          <h3>{selectedDoctor?.name || "Select a doctor"}</h3>
          <p>
            View assigned patients, confirm access permissions, and use emergency
            override only when the patient condition is critical.
          </p>
        </div>

        <PeopleSelect
          label="Active doctor"
          value={selectedDoctorId}
          onChange={setSelectedDoctorId}
          people={doctors}
          emptyText="No doctors registered"
          describe={(doctor) => `${doctor.name} · ${doctor.specialty || "General"}`}
        />
      </section>

      <section className="card wide">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Assigned patients</p>
            <h3>Treatment access queue</h3>
          </div>
          <span className="tag">{assignments.length} active</span>
        </div>

        {assignments.length === 0 ? (
          <EmptyState text="No patients are assigned to this doctor yet." />
        ) : (
          <div className="assignment-list">
            {assignments.map((assignment) => (
              <article className="assignment-card" key={assignment.id}>
                <div>
                  <strong>{assignment.patient?.name || "Unknown patient"}</strong>
                  <p>{prettyCategory(assignment.record_category)}</p>
                  <small>
                    Condition: {assignment.record.condition || "Not updated"}
                  </small>
                </div>

                <button
                  className="secondary-button"
                  onClick={() => requestDoctorAccess(assignment)}
                >
                  Request access
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Clinical snapshot</p>
            <h3>Selected patient record</h3>
          </div>
        </div>

        <div className="selectors-compact">
          <PeopleSelect
            label="Patient"
            value={selectedPatientId}
            onChange={setSelectedPatientId}
            people={assignments
              .map((assignment) => assignment.patient)
              .filter(Boolean)}
            emptyText="No assigned patients"
            describe={(patient) => patient.name}
          />

          <CategorySelect
            value={selectedCategory}
            onChange={setSelectedCategory}
          />
        </div>

        <HealthSummary record={selectedHealthRecord} />
      </section>

      <section className="card danger-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Critical access</p>
            <h3>Emergency override</h3>
          </div>
          <span className="tag danger">Always audited</span>
        </div>

        <form className="stacked-form" onSubmit={emergencyOverride}>
          <textarea
            value={emergencyJustification}
            onChange={(event) => setEmergencyJustification(event.target.value)}
            placeholder="Explain the life-threatening emergency..."
          />
          <button className="danger-button" type="submit">
            Use emergency override
          </button>
        </form>
      </section>
    </div>
  );
}

function PatientPanel({
  patients,
  selectedPatientId,
  setSelectedPatientId,
  selectedPatient,
  selectedHealthRecord,
  updateHealthField,
  saveHealthRecord,
  selectedPatientGrants,
  selectedPatientLogs,
  doctorMap,
}) {
  return (
    <div className="page-grid">
      <section className="card wide patient-hero">
        <div>
          <p className="eyebrow">Patient portal</p>
          <h3>{selectedPatient?.name || "Select a patient"}</h3>
          <p>
            Patients maintain their health profile and medical documents. They
            can view who currently has access, but cannot assign or revoke doctors.
          </p>
        </div>

        <PeopleSelect
          label="Patient profile"
          value={selectedPatientId}
          onChange={setSelectedPatientId}
          people={patients}
          emptyText="No patients registered"
          describe={(patient) => `${patient.name} · ${walletShort(patient.wallet_address)}`}
        />
      </section>

      <section className="card wide">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Health information upload</p>
            <h3>Medical profile</h3>
          </div>
          <span className="tag">Patient editable</span>
        </div>

        <form
          className="health-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveHealthRecord(selectedPatientId, selectedHealthRecord);
          }}
        >
          <input
            value={selectedHealthRecord.age}
            onChange={(event) => updateHealthField("age", event.target.value)}
            placeholder="Age"
          />
          <input
            value={selectedHealthRecord.bloodGroup}
            onChange={(event) =>
              updateHealthField("bloodGroup", event.target.value)
            }
            placeholder="Blood group"
          />
          <input
            value={selectedHealthRecord.condition}
            onChange={(event) =>
              updateHealthField("condition", event.target.value)
            }
            placeholder="Current health condition"
          />
          <input
            value={selectedHealthRecord.operatedBy}
            onChange={(event) =>
              updateHealthField("operatedBy", event.target.value)
            }
            placeholder="Operated / treated by"
          />
          <textarea
            value={selectedHealthRecord.medications}
            onChange={(event) =>
              updateHealthField("medications", event.target.value)
            }
            placeholder="Current medicines"
          />
          <textarea
            value={selectedHealthRecord.dosageComfort}
            onChange={(event) =>
              updateHealthField("dosageComfort", event.target.value)
            }
            placeholder="Dosage comfort / side effects"
          />
          <textarea
            value={selectedHealthRecord.allergies}
            onChange={(event) =>
              updateHealthField("allergies", event.target.value)
            }
            placeholder="Known allergies"
          />
          <textarea
            value={selectedHealthRecord.surgeries}
            onChange={(event) =>
              updateHealthField("surgeries", event.target.value)
            }
            placeholder="Surgeries / procedures"
          />
          <textarea
            value={selectedHealthRecord.medicalHistory}
            onChange={(event) =>
              updateHealthField("medicalHistory", event.target.value)
            }
            placeholder="Medical history and record notes"
          />
          <textarea
            value={selectedHealthRecord.bills}
            onChange={(event) => updateHealthField("bills", event.target.value)}
            placeholder="Medical bills / insurance notes"
          />
          <textarea
            value={selectedHealthRecord.notes}
            onChange={(event) => updateHealthField("notes", event.target.value)}
            placeholder="Other tracker details"
          />

          <button className="primary-button" type="submit">
            Save health profile
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Access visibility</p>
            <h3>Doctors assigned to me</h3>
          </div>
        </div>

        <AssignmentTable
          grants={selectedPatientGrants}
          doctorMap={doctorMap}
          patientMap={new Map()}
          showPatient={false}
          readOnly
        />
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Transparency</p>
            <h3>My audit trail</h3>
          </div>
        </div>

        <AuditTimeline
          logs={selectedPatientLogs}
          doctorMap={doctorMap}
          patientMap={new Map()}
        />
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function AssignmentTable({
  grants,
  doctorMap,
  patientMap,
  onRevoke,
  showPatient = false,
  readOnly = false,
}) {
  if (!grants.length) {
    return <EmptyState text="No assignments found yet." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showPatient && <th>Patient</th>}
            <th>Doctor</th>
            <th>Category</th>
            <th>Status</th>
            {!readOnly && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {grants.map((grant) => {
            const doctor = doctorMap.get(grant.doctor_id);
            const patient = patientMap.get(grant.patient_id);
            return (
              <tr key={grant.id}>
                {showPatient && <td>{patient?.name || `Patient ${grant.patient_id}`}</td>}
                <td>{doctor?.name || `Doctor ${grant.doctor_id}`}</td>
                <td>{prettyCategory(grant.record_category)}</td>
                <td>
                  <span className={grant.is_active ? "status-pill active" : "status-pill revoked"}>
                    {grant.is_active ? "Active" : "Revoked"}
                  </span>
                </td>
                {!readOnly && (
                  <td>
                    {grant.is_active ? (
                      <button
                        className="mini-danger"
                        onClick={() => onRevoke(grant.id)}
                      >
                        Revoke
                      </button>
                    ) : (
                      <span className="muted">No action</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AuditTimeline({ logs, doctorMap, patientMap }) {
  if (!logs.length) {
    return <EmptyState text="No audit activity recorded for this view." />;
  }

  return (
    <div className="timeline">
      {logs.map((log) => {
        const doctor = doctorMap.get(log.doctor_id);
        const patient = patientMap.get(log.patient_id);
        return (
          <article className="timeline-item" key={log.id}>
            <span className={`timeline-dot ${log.action}`} />
            <div>
              <strong>{String(log.action).replaceAll("_", " ")}</strong>
              <p>
                {patient?.name ? `${patient.name} · ` : ""}
                {doctor?.name || `Doctor ${log.doctor_id}`} ·{" "}
                {prettyCategory(log.record_category)}
              </p>
              {log.justification && <small>Reason: {log.justification}</small>}
            </div>
            <time>{new Date(log.timestamp).toLocaleString()}</time>
          </article>
        );
      })}
    </div>
  );
}

function HealthSummary({ record }) {
  return (
    <div className="health-summary">
      <SummaryItem label="Condition" value={record.condition || "Not updated"} />
      <SummaryItem label="Medicines" value={record.medications || "Not updated"} />
      <SummaryItem label="Allergies" value={record.allergies || "Not updated"} />
      <SummaryItem label="History" value={record.medicalHistory || "Not updated"} />
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <article>
      <span>{label}</span>
      <p>{value}</p>
    </article>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state">
      <span>⌁</span>
      <p>{text}</p>
    </div>
  );
}

export default App;
