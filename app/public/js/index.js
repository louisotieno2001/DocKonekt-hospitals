const patientBtn = document.getElementById('patient-btn');
const doctorBtn = document.getElementById('doctor-btn');

patientBtn.addEventListener("click", async(e) => {
    e.preventDefault();
    window.location.href = "patient-registration.html";
});

doctorBtn.addEventListener("click", async(e) => {
    e.preventDefault();
    window.location.href = "doctor-authentication.html";
});


