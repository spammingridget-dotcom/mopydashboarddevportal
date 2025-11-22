// ====== YOUR SUPABASE KEYS ============
const SUPABASE_URL = "https://lzsopkzlifwjdhtxtrkt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6c29wa3psaWZ3amRodHh0cmt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjIzNzMsImV4cCI6MjA3OTM5ODM3M30.owsfr2JR_a5DH76TMvh1JX4atPGznmZz1ikQ60nwT8k";

// Initialize Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================================
// LOGIN
// ================================
async function login() {
  const email = document.getElementById("email").value;

  const { error } = await supabaseClient.auth.signInWithOtp({ email });

  if (error) {
    alert("Login error: " + error.message);
  } else {
    alert("Magic link sent! Check your email.");
  }
}

// ================================
// CHECK AUTH ON DASHBOARD
// ================================
async function loadDashboard() {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  document.getElementById("userEmail").innerText = user.email;

  loadTasks();
}

// ================================
// LOAD TASKS
// ================================
async function loadTasks() {
  const { data, error } = await supabaseClient.from("tasks").select("*");

  if (error) {
    alert("Error loading tasks");
    return;
  }

  const list = document.getElementById("taskList");
  list.innerHTML = "";

  data.forEach(t => {
    const div = document.createElement("div");
    div.className = "task-box";
    div.innerHTML = `<h3>${t.title}</h3>`;
    list.appendChild(div);
  });
}

// ================================
// LOGOUT
// ================================
async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}
