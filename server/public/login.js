const loginForm = document.getElementById("login-form");
const loginUser = document.getElementById("login-user");
const loginPass = document.getElementById("login-pass");
const loginStatus = document.getElementById("login-status");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: loginUser.value.trim(),
        password: loginPass.value.trim()
      }),
      credentials: "same-origin"
    });
    if (!res.ok) throw new Error("Giris basarisiz");
    await res.json();
    window.location.href = "/";
  } catch (err) {
    loginStatus.textContent = "Giris basarisiz.";
  }
});
