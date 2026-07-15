import { Component, useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000";

const USERS_KEY = "damf_users";
const SESSION_KEY = "damf_session";
const RECORDS_KEY = "damf_patient_records";

const RECORD_CATEGORIES = [
  "cardiac_history",
  "mental_health",
  "allergies",
  "medications",
  "lab_results",
  "radiology",
  "surgery_notes",
  "billing_records",
];

const EMPTY_RECORD = {
  condition: "",
  medicines: "",
  allergies: "",
  surgeries: "",
  bills: "",
  dosageComfort: "",
  bloodType: "",
  height: "",
  weight: "",
  notes: "",
};

function apiUrl(path) {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

async function safeGet(url, params = {}) {
  try {
    const response = await axios.get(apiUrl(url), { params });
    return response.data ?? null;
  } catch {
    return null;
  }
}

async function safePost(url, body = {}) {
  try {
    const response = await axios.post(apiUrl(url), body);
    return { ok: true, data: response.data };
  } catch (error) {
    const message =
      error?.response?.data?.details ||
      error?.response?.data?.error ||
      error?.message ||
      "Request failed.";

    return { ok: false, msg: message };
  }
}

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function getStoredRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveStoredRecords(records) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

function categoryLabel(category = "") {
  return category.replaceAll("_", " ");
}

function shortWallet(wallet = "") {
  if (!wallet) return "No wallet";
  return `${wallet.slice(0, 8)}…${wallet.slice(-4)}`;
}

function walletEquals(left = "", right = "") {
  return left.toLowerCase() === right.toLowerCase();
}

function useStatus() {
  const [status, setStatus] = useState("");

  function msg(text) {
    setStatus(text);
    window.clearTimeout(msg.timer);
    msg.timer = window.setTimeout(() => setStatus(""), 6000);
  }

  return [status, msg];
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[MedChain] Render error:", error, info);
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="crash-screen">
          <span className="crash-icon">⚕</span>
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message || "Unexpected frontend error."}</p>
          <button
            className="btn-primary"
            onClick={() => {
              clearSession();
              this.setState({ crashed: false, error: null });
              this.props.onReset?.();
            }}
          >
            Return to Login
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function EcgLine() {
  return (
    <svg className="ecg-line" viewBox="0 0 400 50" xmlns="http://www.w3.org/2000/svg">
      <polyline
        points="0,25 60,25 75,10 85,40 95,5 110,45 120,25 180,25 195,20 205,25 260,25 275,10 285,40 295,5 310,45 320,25 400,25"
        fill="none"
        stroke="#00B4D8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    fullName: "",
    role: "Patient",
    walletAddress: "",
    specialty: "",
    password: "",
  });
  const [error, setError] = useState("");

  const showSpecialty =
    form.role === "Doctor" || form.role === "Admin/Head Doctor";

  function handleChange(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
    setError("");
  }

  function handleLogin(event) {
    event.preventDefault();

    if (!form.walletAddress || !form.password) {
      setError("Please enter wallet address and password.");
      return;
    }

    const user = getUsers().find(
      (item) =>
        walletEquals(item.walletAddress, form.walletAddress) &&
        item.password === form.password,
    );

    if (!user) {
      setError("Invalid wallet address or password.");
      return;
    }

    saveSession(user);
    onLogin(user);
  }

  function handleSignup(event) {
    event.preventDefault();

    if (!form.fullName || !form.walletAddress || !form.password) {
      setError("Please fill in all required fields.");
      return;
    }

    const users = getUsers();
    const exists = users.some((item) =>
      walletEquals(item.walletAddress, form.walletAddress),
    );

    if (exists) {
      setError("A user with this wallet address already exists.");
      return;
    }

    const newUser = {
      id: Date.now(),
      fullName: form.fullName.trim(),
      role: form.role,
      walletAddress: form.walletAddress.trim(),
      specialty: form.specialty.trim(),
      password: form.password,
    };

    saveUsers([...users, newUser]);
    saveSession(newUser);
    onLogin(newUser);
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-card-header">
          <EcgLine />
          <div className="auth-logo">
            <span className="auth-logo-icon">⚕</span>
            <div>
              <p className="auth-logo-title">MedChain</p>
              <p className="auth-logo-sub">Decentralized Access Framework</p>
            </div>
          </div>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setError("");
            }}
            type="button"
          >
            Login
          </button>
          <button
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
            type="button"
          >
            Sign Up
          </button>
        </div>

        <form
          className="auth-form"
          onSubmit={mode === "login" ? handleLogin : handleSignup}
        >
          {mode === "signup" && (
            <>
              <label className="field-label">
                Full Name <span className="req">*</span>
              </label>
              <input
                className="field-input"
                name="fullName"
                placeholder="Dr. Jane Smith"
                value={form.fullName}
                onChange={handleChange}
                autoComplete="off"
              />

              <label className="field-label">
                Role <span className="req">*</span>
              </label>
              <select
                className="field-input field-select"
                name="role"
                value={form.role}
                onChange={handleChange}
              >
                <option>Patient</option>
                <option>Doctor</option>
                <option>Admin/Head Doctor</option>
              </select>

              {showSpecialty && (
                <>
                  <label className="field-label">Specialty</label>
                  <input
                    className="field-input"
                    name="specialty"
                    placeholder="Cardiology, Neurology, Emergency Medicine"
                    value={form.specialty}
                    onChange={handleChange}
                  />
                </>
              )}
            </>
          )}

          <label className="field-label">
            Wallet Address <span className="req">*</span>
          </label>
          <input
            className="field-input field-mono"
            name="walletAddress"
            placeholder="0x..."
            value={form.walletAddress}
            onChange={handleChange}
            autoComplete="off"
          />

          <label className="field-label">
            Password <span className="req">*</span>
          </label>
          <input
            className="field-input"
            type="password"
            name="password"
            placeholder="••••••••"
            value={form.password}
            onChange={handleChange}
          />

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit">
            {mode === "login" ? "Login" : "Create Account"}
          </button>
        </form>

        <p className="auth-footer">
          Demo authentication stores users locally. Blockchain writes are handled by the Flask backend.
        </p>
      </div>
    </div>
  );
}

function DashboardShell({ user, onLogout, children }) {
  const roleClass =
    user?.role === "Admin/Head Doctor"
      ? "admin"
      : user?.role === "Doctor"
        ? "doctor"
        : "patient";

  return (
    <div className="dashboard-root">
      <nav className="dash-nav">
        <div className="dash-nav-left">
          <span className="dash-logo-icon">⚕</span>
          <span className="dash-logo-text">MedChain</span>
          <span className={`dash-role-badge ${roleClass}`}>{user?.role}</span>
        </div>

        <div className="dash-nav-right">
          <div className="dash-user-info">
            <p className="dash-user-name">{user?.fullName}</p>
            <p className="dash-user-wallet">{shortWallet(user?.walletAddress)}</p>
          </div>
          <button className="logout-btn" onClick={onLogout} type="button">
            Logout
          </button>
        </div>
      </nav>

      <main className="dash-main">{children}</main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="section-card">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <article className="stat-card">
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </article>
  );
}

function EmptyState({ children }) {
  return <p className="empty-state">{children}</p>;
}

function AdminDashboard({ user, onLogout }) {
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [status, msg] = useStatus();

  const [newDoctor, setNewDoctor] = useState({
    name: "",
    wallet_address: "",
    specialty: "",
    role: "doctor",
  });

  const [newPatient, setNewPatient] = useState({
    name: "",
    wallet_address: "",
  });

  const [selectedSignupDoctor, setSelectedSignupDoctor] = useState("");
  const [selectedSignupPatient, setSelectedSignupPatient] = useState("");
  const [assign, setAssign] = useState({
    patient_id: "",
    doctor_id: "",
    record_category: RECORD_CATEGORIES[0],
  });

  const signupUsers = getUsers();
  const signupDoctors = signupUsers.filter(
    (item) => item.role === "Doctor" || item.role === "Admin/Head Doctor",
  );
  const signupPatients = signupUsers.filter((item) => item.role === "Patient");

  const doctorById = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor])),
    [doctors],
  );

  const patientById = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient])),
    [patients],
  );

  async function fetchData() {
    const [doctorData, patientData] = await Promise.all([
      safeGet("/admin/doctors"),
      safeGet("/patients"),
    ]);

    const loadedDoctors = Array.isArray(doctorData) ? doctorData : [];
    const loadedPatients = Array.isArray(patientData) ? patientData : [];

    setDoctors(loadedDoctors);
    setPatients(loadedPatients);

    const grantResponses = await Promise.all(
      loadedPatients.map((patient) => safeGet(`/patient/${patient.id}/grants`)),
    );

    const loadedAssignments = grantResponses.flatMap((item) =>
      Array.isArray(item) ? item : [],
    );

    setAssignments(loadedAssignments);

    const logResponses = await Promise.all(
      loadedPatients.map((patient) => safeGet(`/audit/patient/${patient.id}`)),
    );

    const loadedLogs = logResponses.flatMap((item) =>
      Array.isArray(item) ? item : [],
    );

    setAuditLogs(loadedLogs);

    setAssign((current) => ({
      ...current,
      patient_id: current.patient_id || String(loadedPatients[0]?.id || ""),
      doctor_id: current.doctor_id || String(loadedDoctors[0]?.id || ""),
    }));
  }

  useEffect(() => {
    fetchData();
  }, []);

  function useSignupDoctor(id) {
    setSelectedSignupDoctor(id);
    const selected = signupDoctors.find((item) => String(item.id) === String(id));
    if (!selected) return;

    setNewDoctor({
      name: selected.fullName || "",
      wallet_address: selected.walletAddress || "",
      specialty: selected.specialty || "",
      role: selected.role === "Admin/Head Doctor" ? "head_doctor" : "doctor",
    });
  }

  function useSignupPatient(id) {
    setSelectedSignupPatient(id);
    const selected = signupPatients.find((item) => String(item.id) === String(id));
    if (!selected) return;

    setNewPatient({
      name: selected.fullName || "",
      wallet_address: selected.walletAddress || "",
    });
  }

  async function registerDoctor(event) {
    event.preventDefault();

    const response = await safePost("/admin/register_doctor", {
      name: newDoctor.name,
      wallet_address: newDoctor.wallet_address,
      specialty: newDoctor.specialty,
      role: newDoctor.role,
      registered_by: user?.walletAddress || "admin",
    });

    if (response.ok) {
      msg("Doctor registered on backend and blockchain.");
      setNewDoctor({ name: "", wallet_address: "", specialty: "", role: "doctor" });
      setSelectedSignupDoctor("");
      fetchData();
    } else {
      msg(`Doctor registration failed: ${response.msg}`);
    }
  }

  async function registerPatient(event) {
    event.preventDefault();

    const response = await safePost("/patient/register", {
      name: newPatient.name,
      wallet_address: newPatient.wallet_address,
    });

    if (response.ok) {
      msg("Patient registered.");
      setNewPatient({ name: "", wallet_address: "" });
      setSelectedSignupPatient("");
      fetchData();
    } else {
      msg(`Patient registration failed: ${response.msg}`);
    }
  }

  async function assignDoctor(event) {
    event.preventDefault();

    const response = await safePost("/patient/grant_access", {
      patient_id: Number(assign.patient_id),
      doctor_id: Number(assign.doctor_id),
      record_category: assign.record_category,
    });

    if (response.ok) {
      msg("Doctor assigned to patient. Blockchain audit updated.");
      fetchData();
    } else {
      msg(`Assignment failed: ${response.msg}`);
    }
  }

  async function revokeAccess(grantId) {
    const response = await safePost(`/patient/revoke_access/${grantId}`);

    if (response.ok) {
      msg("Doctor access revoked. Blockchain audit updated.");
      fetchData();
    } else {
      msg(`Revocation failed: ${response.msg}`);
    }
  }

  function doctorName(id) {
    return doctorById.get(id)?.name || `Doctor ${id}`;
  }

  function patientName(id) {
    return patientById.get(id)?.name || `Patient ${id}`;
  }

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <div className="dash-header-bar">
        <h1 className="dash-page-title">Administration Panel</h1>
        <p className="dash-page-sub">
          Register identities and assign doctors by name. Wallet addresses are saved once in each profile.
        </p>
      </div>

      {status && <div className="status-banner">{status}</div>}

      <div className="stat-row">
        <StatCard label="Registered Doctors" value={doctors.length} icon="👨‍⚕️" />
        <StatCard label="Registered Patients" value={patients.length} icon="🏥" />
        <StatCard
          label="Active Assignments"
          value={assignments.filter((item) => item.is_active).length}
          icon="🔗"
        />
        <StatCard label="Audit Events" value={auditLogs.length} icon="📋" />
      </div>

      <div className="two-col">
        <Section title="Register Doctor">
          <form onSubmit={registerDoctor} className="dash-form">
            <label className="field-label">Use signed-up doctor</label>
            <select
              className="field-input field-select"
              value={selectedSignupDoctor}
              onChange={(event) => useSignupDoctor(event.target.value)}
            >
              <option value="">Select doctor signup...</option>
              {signupDoctors.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName} · {item.specialty || item.role}
                </option>
              ))}
            </select>

            <input
              className="field-input"
              placeholder="Full Name"
              value={newDoctor.name}
              onChange={(event) =>
                setNewDoctor((current) => ({ ...current, name: event.target.value }))
              }
              required
            />

            <input
              className="field-input field-mono"
              placeholder="Wallet address from signup"
              value={newDoctor.wallet_address}
              onChange={(event) =>
                setNewDoctor((current) => ({
                  ...current,
                  wallet_address: event.target.value,
                }))
              }
              required
            />

            <input
              className="field-input"
              placeholder="Specialty"
              value={newDoctor.specialty}
              onChange={(event) =>
                setNewDoctor((current) => ({
                  ...current,
                  specialty: event.target.value,
                }))
              }
            />

            <button className="btn-primary" type="submit">
              Register Doctor
            </button>
          </form>
        </Section>

        <Section title="Register Patient">
          <form onSubmit={registerPatient} className="dash-form">
            <label className="field-label">Use signed-up patient</label>
            <select
              className="field-input field-select"
              value={selectedSignupPatient}
              onChange={(event) => useSignupPatient(event.target.value)}
            >
              <option value="">Select patient signup...</option>
              {signupPatients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName}
                </option>
              ))}
            </select>

            <input
              className="field-input"
              placeholder="Full Name"
              value={newPatient.name}
              onChange={(event) =>
                setNewPatient((current) => ({ ...current, name: event.target.value }))
              }
              required
            />

            <input
              className="field-input field-mono"
              placeholder="Wallet address from signup"
              value={newPatient.wallet_address}
              onChange={(event) =>
                setNewPatient((current) => ({
                  ...current,
                  wallet_address: event.target.value,
                }))
              }
              required
            />

            <button className="btn-primary" type="submit">
              Register Patient
            </button>
          </form>
        </Section>

        <Section title="Assign Doctor to Patient">
          <form onSubmit={assignDoctor} className="dash-form">
            <label className="field-label">Patient</label>
            <select
              className="field-input field-select"
              value={assign.patient_id}
              onChange={(event) =>
                setAssign((current) => ({
                  ...current,
                  patient_id: event.target.value,
                }))
              }
              required
            >
              <option value="">Select patient...</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                </option>
              ))}
            </select>

            <label className="field-label">Doctor</label>
            <select
              className="field-input field-select"
              value={assign.doctor_id}
              onChange={(event) =>
                setAssign((current) => ({
                  ...current,
                  doctor_id: event.target.value,
                }))
              }
              required
            >
              <option value="">Select doctor...</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name} · {doctor.specialty || "General"}
                </option>
              ))}
            </select>

            <label className="field-label">Record category</label>
            <select
              className="field-input field-select"
              value={assign.record_category}
              onChange={(event) =>
                setAssign((current) => ({
                  ...current,
                  record_category: event.target.value,
                }))
              }
            >
              {RECORD_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category)}
                </option>
              ))}
            </select>

            <button className="btn-primary" type="submit">
              Assign Doctor
            </button>
          </form>
        </Section>

        <Section title="Assignments">
          {assignments.length === 0 ? (
            <EmptyState>No assignments yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Doctor</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((grant) => (
                    <tr key={grant.id}>
                      <td>{patientName(grant.patient_id)}</td>
                      <td>{doctorName(grant.doctor_id)}</td>
                      <td>{categoryLabel(grant.record_category)}</td>
                      <td>{grant.is_active ? "Active" : "Revoked"}</td>
                      <td>
                        {grant.is_active ? (
                          <button
                            className="btn-danger"
                            onClick={() => revokeAccess(grant.id)}
                            type="button"
                          >
                            Revoke
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Section title="Audit Log">
        {auditLogs.length === 0 ? (
          <EmptyState>No audit events recorded yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Category</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <span className="badge-event">{log.action}</span>
                    </td>
                    <td>{patientName(log.patient_id)}</td>
                    <td>{doctorName(log.doctor_id)}</td>
                    <td>{categoryLabel(log.record_category)}</td>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </DashboardShell>
  );
}

function DoctorDashboard({ user, onLogout }) {
  const [doctor, setDoctor] = useState(null);
  const [patients, setPatients] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedGrantId, setSelectedGrantId] = useState("");
  const [emergencyJustification, setEmergencyJustification] = useState("");
  const [records, setRecords] = useState(getStoredRecords);
  const [status, msg] = useStatus();

  const selectedAssignment = assignments.find(
    (item) => String(item.id) === String(selectedGrantId),
  );

  async function fetchData() {
    const [doctorData, patientData] = await Promise.all([
      safeGet("/admin/doctors"),
      safeGet("/patients"),
    ]);

    const loadedDoctors = Array.isArray(doctorData) ? doctorData : [];
    const loadedPatients = Array.isArray(patientData) ? patientData : [];
    const currentDoctor = loadedDoctors.find((item) =>
      walletEquals(item.wallet_address, user?.walletAddress),
    );

    setDoctor(currentDoctor || null);
    setPatients(loadedPatients);

    if (!currentDoctor) {
      setAssignments([]);
      return;
    }

    const grantResponses = await Promise.all(
      loadedPatients.map((patient) => safeGet(`/patient/${patient.id}/grants`)),
    );

    const doctorAssignments = grantResponses
      .flatMap((item) => (Array.isArray(item) ? item : []))
      .filter((grant) => grant.doctor_id === currentDoctor.id && grant.is_active);

    setAssignments(doctorAssignments);

    if (!selectedGrantId && doctorAssignments.length) {
      setSelectedGrantId(String(doctorAssignments[0].id));
    }
  }

  useEffect(() => {
    fetchData();
    setRecords(getStoredRecords());
  }, []);

  function patientName(id) {
    return patients.find((patient) => patient.id === id)?.name || `Patient ${id}`;
  }

  function patientWallet(id) {
    return patients.find((patient) => patient.id === id)?.wallet_address || "";
  }

  function selectedPatientRecord() {
    if (!selectedAssignment) return EMPTY_RECORD;
    const wallet = patientWallet(selectedAssignment.patient_id);
    return records[wallet] || EMPTY_RECORD;
  }

  async function requestAccess(event) {
    event.preventDefault();

    if (!selectedAssignment || !doctor) {
      msg("Select an assigned patient first.");
      return;
    }

    const response = await safePost("/doctor/request_access", {
      patient_id: selectedAssignment.patient_id,
      doctor_id: doctor.id,
      record_category: selectedAssignment.record_category,
    });

    if (response.ok) {
      msg(`Access ${response.data.access}. Blockchain audit updated.`);
    } else {
      msg(`Access request failed: ${response.msg}`);
    }
  }

  async function emergencyOverride(event) {
    event.preventDefault();

    if (!selectedAssignment || !doctor) {
      msg("Select an assigned patient first.");
      return;
    }

    if (!emergencyJustification.trim()) {
      msg("Emergency justification is required.");
      return;
    }

    const response = await safePost("/doctor/emergency_override", {
      patient_id: selectedAssignment.patient_id,
      doctor_id: doctor.id,
      record_category: selectedAssignment.record_category,
      justification: emergencyJustification,
    });

    if (response.ok) {
      msg("Emergency override logged to blockchain.");
      setEmergencyJustification("");
    } else {
      msg(`Emergency override failed: ${response.msg}`);
    }
  }

  const record = selectedPatientRecord();

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <div className="dash-header-bar">
        <h1 className="dash-page-title">Doctor Portal</h1>
        <p className="dash-page-sub">
          {doctor
            ? `Specialty: ${doctor.specialty || user?.specialty || "General"}`
            : "Your wallet is not registered as a doctor yet."}
        </p>
      </div>

      {status && <div className="status-banner">{status}</div>}

      <div className="stat-row">
        <StatCard label="Assigned Patients" value={assignments.length} icon="🧑‍🤝‍🧑" />
        <StatCard label="Doctor Status" value={doctor ? "Registered" : "Pending"} icon="🩺" />
      </div>

      <div className="two-col">
        <Section title="My Assigned Patients">
          {!doctor ? (
            <EmptyState>Ask an admin to register your signup wallet as a doctor.</EmptyState>
          ) : assignments.length === 0 ? (
            <EmptyState>No patient assignments yet.</EmptyState>
          ) : (
            <ul className="patient-list">
              {assignments.map((grant) => (
                <li
                  key={grant.id}
                  className={`patient-item ${String(grant.id) === String(selectedGrantId) ? "active" : ""}`}
                  onClick={() => setSelectedGrantId(String(grant.id))}
                >
                  <div>
                    <p className="patient-name">{patientName(grant.patient_id)}</p>
                    <p className="patient-specialty">
                      {categoryLabel(grant.record_category)}
                    </p>
                  </div>
                  <span className="mono-cell">{shortWallet(patientWallet(grant.patient_id))}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Patient Medical Snapshot">
          {!selectedAssignment ? (
            <EmptyState>Select a patient to view uploaded profile details.</EmptyState>
          ) : (
            <div className="records-list">
              <div className="record-item">
                <div className="record-row">
                  <span className="record-key">Patient</span>
                  <span>{patientName(selectedAssignment.patient_id)}</span>
                </div>
                <div className="record-row">
                  <span className="record-key">Condition</span>
                  <span>{record.condition || "Not updated"}</span>
                </div>
                <div className="record-row">
                  <span className="record-key">Medicines</span>
                  <span>{record.medicines || "Not updated"}</span>
                </div>
                <div className="record-row">
                  <span className="record-key">Allergies</span>
                  <span>{record.allergies || "Not updated"}</span>
                </div>
                <div className="record-row">
                  <span className="record-key">Notes</span>
                  <span>{record.notes || "Not updated"}</span>
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section title="Request Record Access">
          <form onSubmit={requestAccess} className="dash-form">
            <p className="section-note">
              Access requests are submitted for the selected assigned patient and record category.
            </p>
            <button className="btn-primary" type="submit" disabled={!selectedAssignment}>
              Request Access
            </button>
          </form>
        </Section>

        <Section title="Emergency Override">
          <p className="section-note">
            Use only for critical conditions. Every override is permanently logged on-chain.
          </p>
          <form onSubmit={emergencyOverride} className="dash-form">
            <textarea
              className="field-input field-textarea"
              placeholder="Clinical justification for emergency access..."
              value={emergencyJustification}
              onChange={(event) => setEmergencyJustification(event.target.value)}
              required
            />
            <button className="btn-danger" type="submit" disabled={!selectedAssignment}>
              Activate Emergency Override
            </button>
          </form>
        </Section>
      </div>
    </DashboardShell>
  );
}

function PatientDashboard({ user, onLogout }) {
  const [patient, setPatient] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [grants, setGrants] = useState([]);
  const [logs, setLogs] = useState([]);
  const [record, setRecord] = useState(() => {
    const stored = getStoredRecords();
    return { ...EMPTY_RECORD, ...(stored[user?.walletAddress] || {}) };
  });
  const [status, msg] = useStatus();

  async function fetchData() {
    const [patientData, doctorData] = await Promise.all([
      safeGet("/patients"),
      safeGet("/admin/doctors"),
    ]);

    const loadedPatients = Array.isArray(patientData) ? patientData : [];
    const loadedDoctors = Array.isArray(doctorData) ? doctorData : [];
    const currentPatient = loadedPatients.find((item) =>
      walletEquals(item.wallet_address, user?.walletAddress),
    );

    setPatient(currentPatient || null);
    setDoctors(loadedDoctors);

    if (!currentPatient) {
      setGrants([]);
      setLogs([]);
      return;
    }

    const [grantData, logData] = await Promise.all([
      safeGet(`/patient/${currentPatient.id}/grants`),
      safeGet(`/audit/patient/${currentPatient.id}`),
    ]);

    setGrants(Array.isArray(grantData) ? grantData : []);
    setLogs(Array.isArray(logData) ? logData : []);
  }

  useEffect(() => {
    fetchData();
  }, []);

  function doctorName(id) {
    return doctors.find((doctor) => doctor.id === id)?.name || `Doctor ${id}`;
  }

  function saveRecord(event) {
    event.preventDefault();

    const records = getStoredRecords();
    const updatedRecord = {
      ...record,
      updatedAt: new Date().toISOString(),
    };

    records[user.walletAddress] = updatedRecord;
    saveStoredRecords(records);
    setRecord(updatedRecord);
    msg("Medical profile saved locally for this demo.");
  }

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <div className="dash-header-bar">
        <h1 className="dash-page-title">My Health Portal</h1>
        <p className="dash-page-sub">
          Update your health details and view assigned doctors.
        </p>
      </div>

      {status && <div className="status-banner">{status}</div>}

      <div className="stat-row">
        <StatCard label="Registration" value={patient ? "Active" : "Pending"} icon="🏥" />
        <StatCard
          label="Assigned Doctors"
          value={grants.filter((grant) => grant.is_active).length}
          icon="👨‍⚕️"
        />
        <StatCard label="My Wallet" value={shortWallet(user?.walletAddress)} icon="🔐" />
      </div>

      <div className="two-col">
        <Section title="My Medical Record">
          <form onSubmit={saveRecord} className="dash-form">
            <label className="field-label">Current Condition / Diagnosis</label>
            <input
              className="field-input"
              placeholder="Type 2 Diabetes, asthma, cardiac follow-up..."
              value={record.condition}
              onChange={(event) =>
                setRecord((current) => ({ ...current, condition: event.target.value }))
              }
            />

            <label className="field-label">Current Medicines</label>
            <input
              className="field-input"
              placeholder="Metformin 500mg, Atorvastatin..."
              value={record.medicines}
              onChange={(event) =>
                setRecord((current) => ({ ...current, medicines: event.target.value }))
              }
            />

            <label className="field-label">Known Allergies</label>
            <input
              className="field-input"
              placeholder="Penicillin, sulfa drugs..."
              value={record.allergies}
              onChange={(event) =>
                setRecord((current) => ({ ...current, allergies: event.target.value }))
              }
            />

            <label className="field-label">Past Surgeries</label>
            <input
              className="field-input"
              placeholder="Appendectomy 2019..."
              value={record.surgeries}
              onChange={(event) =>
                setRecord((current) => ({ ...current, surgeries: event.target.value }))
              }
            />

            <label className="field-label">Medical Bills / Insurance Notes</label>
            <input
              className="field-input"
              placeholder="Covered under XYZ insurance..."
              value={record.bills}
              onChange={(event) =>
                setRecord((current) => ({ ...current, bills: event.target.value }))
              }
            />

            <label className="field-label">Dosage Comfort Level</label>
            <select
              className="field-input field-select"
              value={record.dosageComfort}
              onChange={(event) =>
                setRecord((current) => ({
                  ...current,
                  dosageComfort: event.target.value,
                }))
              }
            >
              <option value="">Select...</option>
              <option>Low — sensitive to medications</option>
              <option>Normal — standard doses</option>
              <option>High — may need higher doses</option>
            </select>

            <div className="inline-fields">
              <input
                className="field-input"
                placeholder="Blood type"
                value={record.bloodType}
                onChange={(event) =>
                  setRecord((current) => ({ ...current, bloodType: event.target.value }))
                }
              />
              <input
                className="field-input"
                placeholder="Height"
                value={record.height}
                onChange={(event) =>
                  setRecord((current) => ({ ...current, height: event.target.value }))
                }
              />
              <input
                className="field-input"
                placeholder="Weight"
                value={record.weight}
                onChange={(event) =>
                  setRecord((current) => ({ ...current, weight: event.target.value }))
                }
              />
            </div>

            <textarea
              className="field-input field-textarea"
              placeholder="Additional notes..."
              value={record.notes}
              onChange={(event) =>
                setRecord((current) => ({ ...current, notes: event.target.value }))
              }
            />

            <button className="btn-primary" type="submit">
              Save Medical Profile
            </button>
          </form>
        </Section>

        <Section title="Doctors Assigned to Me">
          {!patient ? (
            <EmptyState>Ask an admin to register your signup wallet as a patient.</EmptyState>
          ) : grants.length === 0 ? (
            <EmptyState>No doctors assigned yet.</EmptyState>
          ) : (
            <ul className="patient-list">
              {grants.map((grant) => (
                <li className="patient-item no-hover" key={grant.id}>
                  <div>
                    <p className="patient-name">{doctorName(grant.doctor_id)}</p>
                    <p className="patient-specialty">
                      {categoryLabel(grant.record_category)}
                    </p>
                  </div>
                  <span className="badge-event">
                    {grant.is_active ? "Active" : "Revoked"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="My Audit Trail">
        {logs.length === 0 ? (
          <EmptyState>No audit events recorded yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Doctor</th>
                  <th>Category</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <span className="badge-event">{log.action}</span>
                    </td>
                    <td>{doctorName(log.doctor_id)}</td>
                    <td>{categoryLabel(log.record_category)}</td>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </DashboardShell>
  );
}

function AccessRestricted({ user, onLogout }) {
  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <div className="restricted-box">
        <span className="restricted-icon">⛔</span>
        <h2>Access restricted</h2>
        <p>This account role does not match any available dashboard.</p>
      </div>
    </DashboardShell>
  );
}

function AppContent() {
  const [user, setUser] = useState(getSession);

  function handleLogout() {
    clearSession();
    setUser(null);
  }

  if (!user) {
    return <AuthPage onLogin={setUser} />;
  }

  if (user.role === "Admin/Head Doctor") {
    return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  if (user.role === "Doctor") {
    return <DoctorDashboard user={user} onLogout={handleLogout} />;
  }

  if (user.role === "Patient") {
    return <PatientDashboard user={user} onLogout={handleLogout} />;
  }

  return <AccessRestricted user={user} onLogout={handleLogout} />;
}

export default function App() {
  const [resetKey, setResetKey] = useState(0);

  return (
    <ErrorBoundary
      key={resetKey}
      onReset={() => {
        clearSession();
        setResetKey((current) => current + 1);
      }}
    >
      <AppContent />
    </ErrorBoundary>
  );
}
