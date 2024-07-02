require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);
const port = 3001;
const cors = require('cors');
const ejs = require('ejs');
const multer = require('multer');
const bcrypt = require('bcrypt');
const app = express();
const saltRounds = 10;
const token = process.env.TOKEN;
const url = process.env.DIRECTUS_URL

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ dest: __dirname + '/uploads/' });
app.use('/uploads', express.static('/'));

// Configure PostgreSQL database connection using environment variables
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false },
});

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
  }),
  secret: 'sqT_d_qxWqHyXS6Yk7Me8APygz3EjFE8',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

const checkSession = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/');
  }
};

async function getIp() {
  try {
    let res = await query(`/items/addresses/`, {
      method: 'GET',
    });

    if (!res.ok) {
      throw new Error('Failed to fetch addresses data.');
    }

    const responseData = await res.json();
    console.log(responseData);

    const ipAddresses = responseData.data.map(item => item.addresses); // Changed to 'addresses' instead of 'ip_address'

    return ipAddresses;
  } catch (error) {
    console.error('Error fetching addresses:', error);
    throw error;
  }
}

app.get('/staff/register', async (req, res) => {
  try {
    const addresses = await getIp();
    console.log(addresses);
    const requesterIp = req.ip;

    // Ensure requesterIp is defined and valid
    if (!requesterIp || typeof requesterIp !== 'string') {
      throw new Error('Requester IP is invalid.');
    }

    if (!Array.isArray(addresses)) {
      throw new Error('Addresses data is not an array.');
    }

    let isAllowed = addresses.some(address => {
      const normalizedAddress = normalizeIpAddress(address);
      const normalizedRequesterIp = normalizeIpAddress(requesterIp);
      return normalizedAddress === normalizedRequesterIp;
    });

    function normalizeIpAddress(ip) {
      return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    }

    if (isAllowed) {
      res.render('staff-register');
    } else {
      res.status(403).send(`Your IP address (${requesterIp}) is not allowed to access this route.`);
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Internal Server Error');
  }
});


/**
  @param path  {String}
  @param config {RequestInit}
*/

async function query(path, config) {
  const res = await fetch(encodeURI(`${url}${path}`), {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...config
  });
  return res;
}

app.get('/', async (req, res) => {
  res.render('index');
})

app.get('/login', async (req, res) => {
  res.render('login');
})

app.get('/register', async (req, res) => {
  res.render('register');
})

app.get('/staff', async (req, res) => {
  res.render('staff-login');
})

app.get('/staff/home', checkSession, async (req, res) => {
  const id = req.session.user.id;
  const hospitalId = req.session.user.hospital;
  const slots = await getSlots(hospitalId);
  const user = await getStaffProfile(id);
  const patients = await getPatients(hospitalId);
  res.render('staff-home', { user: user.data[0], slots: slots.data, patients: patients.data });
})

app.get('/home', checkSession, async (req, res) => {
  const hospitalId = req.session.user.hospital;
  const slots = await getSlots(hospitalId);
  const id = req.session.user.id;
  const users = await getProfile(id);
  // console.log(slots)
  res.render('home', { slots: slots.data, user: users.data[0] });
});

app.get('/messages', checkSession, async (req, res) => {
  const id = req.session.user.id;
  const users = await getProfile(id);
  res.render('messages', { user: users.data[0] });
})

async function registerUser(userData) {
  try {
    let res = await query(`/items/users/`, {
      method: 'POST',
      body: JSON.stringify(userData) // Send user data in the request body
    });
    return await res.json(); // Return parsed JSON response
  } catch (error) {
    console.error('Error registering user:', error);
    throw error; // Rethrow error for handling in the calling function
  }
}

app.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, hospital } = req.body;

    // console.log(req.body);

    // Validate required fields
    if (!fullName || !email || !phone || !password || !hospital) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Construct user data object
    const userData = {
      name: fullName,
      email: email,
      phone: phone,
      password: hashedPassword,
      hospital: hospital
    };

    // Register the user using the async function
    const newUser = await registerUser(userData);

    // Send response indicating success
    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function loginUser(email) {
  try {
    // console.log('Querying Directus for user with email:', email);
    const response = await query(`/items/users?filter[email][_eq]=${email}`, {
      method: 'SEARCH',
    });
    const users = await response.json(); // Extract JSON data from the response

    // Check if users array is empty or not
    if (!users || users.length === 0) {
      // console.log('No user found with email:', email);
    }

    return users;
  } catch (error) {
    console.error('Error querying user data:', error);
    throw new Error('Error querying user data');
  }
}

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // console.log(req.body);

    if (!email || !password) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Fetch user data from Directus
    const usersResponse = await loginUser(email);

    // If no user found, return invalid credentials error
    if (!usersResponse || !usersResponse.data || usersResponse.data.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = usersResponse.data[0]; // Extract the first user from the response

    // Compare provided password with the hashed password stored in the user's record
    const passwordMatch = await bcrypt.compare(password, user.password);

    // Handle invalid password
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.user = user;
    // console.log(user);
    return res.status(200).json({ message: 'Login successful', redirect: '/home' });
  } catch (error) {
    // Handle internal server error
    console.error('Error logging in user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function getFacilities() {
  let res = await query(`/items/hospitals/`, {
    method: 'GET',
  });
  return await res.json();
}

app.get('/facilities', async (req, res) => {
  try {
    // Fetch facilities data from the source (getFacilities function)
    const facilities = await getFacilities();
    res.json({ facilities: facilities.data });
  } catch (error) {
    console.error('Error fetching facilities:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function registerMessages(userData) {
  try {
    let res = await query(`/items/messages/`, {
      method: 'POST',
      body: JSON.stringify(userData) // Send user data in the request body
    });
    return await res.json(); // Return parsed JSON response
  } catch (error) {
    console.error('Error registering user:', error);
    throw error; // Rethrow error for handling in the calling function
  }
}

app.post('/messages', checkSession, async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    const hospital = req.session.user.hospital;
    // console.log(req.body);

    // Validate required fields
    if (!name || !email || !phone || !message) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Construct user data object
    const userData = {
      name: name,
      phone: phone,
      email: email,
      body: message,
      hospital: hospital
    };

    // Register the user using the async function
    const newMessage = await registerMessages(userData);

    // Send response indicating success
    res.status(201).json({ message: 'Message sent successfully', message: newMessage });
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function getProfile(userId) {
  try {
    const res = await query(`/items/users?filter[id][_eq]=${userId}`, {
      method: 'GET',
    });
    return await res.json();
  } catch (error) {
    console.error('Error fetching referrals:', error);
    throw new Error('Error fetching referrals');
  }
}

async function getStaffProfile(userId) {
  try {
    const res = await query(`/items/staff?filter[id][_eq]=${userId}`, {
      method: 'GET',
    });
    return await res.json();
  } catch (error) {
    console.error('Error fetching referrals:', error);
    throw new Error('Error fetching referrals');
  }
}

async function getMySlots(patientId) {
  let res = await query(`/items/appointments?patient_id=${encodeURIComponent(patientId)}&patient_id_ne=null`, {
    method: 'GET',
  });
  return await res.json();
}

app.get('/profile', async (req, res) => {
  const userId = req.session.user.id;
  const user = await getProfile(userId);
  const patientId = req.session.user.name;

  const appointments = await getMySlots(patientId);

  // Filter out appointments where patient_id is null
  const filteredAppointments = appointments.data.filter(appointment => appointment.patient_id !== null);
  // console.log(filteredAppointments);

  res.render('profile', { user: user.data[0], appointments: filteredAppointments });
});

async function registerStaff(userData) {
  try {
    let res = await query(`/items/staff/`, {
      method: 'POST',
      body: JSON.stringify(userData) // Send user data in the request body
    });
    return await res.json(); // Return parsed JSON response
  } catch (error) {
    console.error('Error registering user:', error);
    throw error; // Rethrow error for handling in the calling function
  }
}

app.post('/staff-register', async (req, res) => {
  try {
    const { fullName, email, phone, password, hospital, role } = req.body;
    // console.log(req.body);

    // console.log(req.body);

    // Validate required fields
    if (!fullName || !email || !phone || !password || !hospital || !role) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Construct user data object
    const userData = {
      name: fullName,
      email: email,
      phone: phone,
      password: hashedPassword,
      hospital: hospital,
      role: role
    };

    // console.log(userData);

    // Register the user using the async function
    const newUser = await registerStaff(userData);

    // Send response indicating success
    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function sendToPharmacy(userData) {
  try {
    let res = await query(`/items/diagnosis/`, {
      method: 'POST',
      body: JSON.stringify(userData)
    });
    return await res.json();
  } catch (error) {
    console.error('Error registering user:', error);
    throw error;
  }
}

app.post('/send-to-pharmacy', async (req, res) => {
  try {
    const { id, prescription, diagnosis } = req.body;
    const hospital = req.session.user.hospital;
    // console.log(req.body);

    // console.log(req.body);

    // Validate required fields
    if (!id || !prescription) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Construct user data object
    const userData = {
      patient_id: id,
      prescription: prescription,
      hospital: hospital,
      diagnosis: diagnosis
    };

    // console.log(userData);

    // Register the user using the async function
    const newUser = await sendToPharmacy(userData);

    // Send response indicating success
    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function loginStaff(email) {
  try {
    // console.log('Querying Directus for user with email:', email);
    const response = await query(`/items/staff?filter[email][_eq]=${email}`, {
      method: 'SEARCH',
    });
    const users = await response.json(); // Extract JSON data from the response

    // Check if users array is empty or not
    if (!users || users.length === 0) {
      // console.log('No user found with email:', email);
    }

    return users;
  } catch (error) {
    console.error('Error querying user data:', error);
    throw new Error('Error querying user data');
  }
}

app.post('/staff-login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // console.log(req.body);

    if (!email || !password) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Fetch user data from Directus
    const usersResponse = await loginStaff(email);

    // If no user found, return invalid credentials error
    if (!usersResponse || !usersResponse.data || usersResponse.data.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = usersResponse.data[0];
    // console.log(user.role);

    // Compare provided password with the hashed password stored in the user's record
    const passwordMatch = await bcrypt.compare(password, user.password);

    // Handle invalid password
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.role === "staff") {
      req.session.user = user;
      // console.log(user);
      return res.status(200).json({ message: 'Login successful', redirect: '/staff/home' });
    } else if (user.role === "doctor") {
      req.session.user = user;
      // console.log(user);
      return res.status(200).json({ message: 'Login successful', redirect: '/staff/doctor/home' });
    }
    else if (user.role === "pharmacist") {
      req.session.user = user;
      // console.log(user);
      return res.status(200).json({ message: 'Login successful', redirect: '/staff/pharmacy/home' });
    }
    else if (user.role === "admin") {
      req.session.user = user;
      // console.log(user);
      return res.status(200).json({ message: 'Login successful', redirect: '/admin/dashboard' });
    }


  } catch (error) {
    // Handle internal server error
    console.error('Error logging in user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/admin/dashboard', async(req, res)=>{
  const id = req.session.user.id;
  const hospital = req.session.user.hospital;
 
  const user = await getStaffProfile(id);
  const customers = await getCustomers(hospital);
  const patients = await getPatients(hospital);
  const staff = await getStaff(hospital);
  res.render('dashboard', {user: user.data[0], customers: customers.data, patients: patients.data, workers: staff.data });
})

app.get('/staff/doctor/home', checkSession, async (req, res) => {
  const id = req.session.user.id;
  const hospitalId = req.session.user.hospital;
  const slots = await getSlots(hospitalId);
  const user = await getStaffProfile(id);
  const patients = await getPatients(hospitalId);
  res.render('doctor-home', { user: user.data[0], slots: slots.data, patients: patients.data });
})

app.get('/staff/pharmacy/home', checkSession, async (req, res) => {
  const id = req.session.user.id;
  const hospitalId = req.session.user.hospital;
  const slots = await getPrescriptions(hospitalId);
  const user = await getStaffProfile(id);
  res.render('pharmacy-home', { user: user.data[0], patients: slots.data });
})

async function getFacilities() {
  let res = await query(`/items/hospitals/`, {
    method: 'GET',
  });
  return await res.json();
}

async function getStaff(hospitalId) {
  let res = await query(`/items/staff?hospital=${hospitalId}`, {
    method: 'GET',
  });
  return await res.json();
}

async function getCustomers(hospitalId) {
  let res = await query(`/items/users?hospital=${hospitalId}`, {
    method: 'GET',
  });
  return await res.json();
}

app.get('/staffer', async (req, res) => {
  try {
    const hospitalId = req.session.user.hospital; // Assuming hospital ID is stored in req.session.user.hospital
    const staff = await getStaff(hospitalId);
    // console.log(staff);
    res.json({ staff: staff.data });
  } catch (error) {
    console.error('Error fetching facilities:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function setAppointment(userData) {
  try {
    let res = await query(`/items/appointments/`, {
      method: 'POST',
      body: JSON.stringify(userData) // Send user data in the request body
    });
    return await res.json(); // Return parsed JSON response
  } catch (error) {
    console.error('Error registering user:', error);
    throw error; // Rethrow error for handling in the calling function
  }
}

app.post('/appointments', async (req, res) => {
  try {
    const { docName, date, time } = req.body;
    const hospital = req.session.user.hospital;
    const status = "Not booked";

    // console.log(req.body);

    // Validate required fields
    if (!docName || !time || !date) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Construct user data object
    const userData = {
      doctor_name: docName,
      date: date,
      time: time,
      hospital: hospital,
      status: status
    };

    // Register the user using the async function
    const newUser = await setAppointment(userData);

    // Send response indicating success
    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function getSlots(hospitalId) {
  let res = await query(`/items/appointments?hospital=${hospitalId}`, {
    method: 'GET',
  });
  return await res.json();
}

async function getPrescriptions(hospitalId) {
  let res = await query(`/items/diagnosis?hospital=${hospitalId}`, {
    method: 'GET',
  });
  return await res.json();
}


async function updateAppointments(userData) {
  try {
    // Use your custom query function to send the update query
    const res = await query(`/items/appointments/${userData.id}`, {
      method: 'PATCH', // Assuming you want to update an existing item
      body: JSON.stringify(userData) // Convert userData to JSON string
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/book', checkSession, async (req, res) => {
  try {
    const { id, phone, problem } = req.body;
    const patient = req.session.user.name;
    const status = "Booked";


    const userData = { id: id, patient_phone: phone, patient_problem: problem, patient_id: patient, status: status, cancel: null }

    const updatedData = await updateAppointments(userData);

    res.status(201).json({ message: 'Name updated successfully', updatedData });
  } catch (error) {
    console.error('Error updating name:', error);
    res.status(500).json({ message: 'Failed to update post. Please try again.' });
  }
});

async function updateDiagnosis(userData) {
  try {
    // Use your custom query function to send the update query
    const res = await query(`/items/diagnosis/${userData.id}`, {
      method: 'PATCH', // Assuming you want to update an existing item
      body: JSON.stringify(userData) // Convert userData to JSON string
    });
    const updatedData = await res.json();
    return updatedData; 
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/update-diagnosis', checkSession, async (req, res) => {
  try {
    const { slotId } = req.body;
    const status = "Completed";

    const userData = { id: slotId, status: status }
   
    const updatedData = await updateDiagnosis(userData);
   
    res.status(201).json({ message: 'Updated successfully', updatedData });
  } catch (error) {
    console.error('Error updating name:', error);
    res.status(500).json({ message: 'Failed to update post. Please try again.' });
  }
});

async function updatePatient(userData) {
  try {
    const res = await query(`/items/patients/${userData.id}`, {
      method: 'PATCH',
      body: JSON.stringify(userData)
    });
    const updatedData = await res.json();
    return updatedData;
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/send-to-lab', checkSession, async (req, res) => {
  try {
    const { id, tests } = req.body;

    const userData = { id: id, tests: tests }

    const updatedData = await updatePatient(userData);

    res.status(201).json({ message: 'Name updated successfully', updatedData });
  } catch (error) {
    console.error('Error updating name:', error);
    res.status(500).json({ message: 'Failed to update post. Please try again.' });
  }
});

async function cancelAppointments(userData) {
  try {
    // Use your custom query function to send the update query
    const res = await query(`/items/appointments/${userData.id}`, {
      method: 'PATCH', // Assuming you want to update an existing item
      body: JSON.stringify(userData) // Convert userData to JSON string
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/cancel', checkSession, async (req, res) => {
  try {
    const { id, reason } = req.body;
    const status = "Not booked";


    const userData = { id: id, patient_phone: null, patient_problem: null, patient_id: null, status: status, cancel: reason }

    const updatedData = await cancelAppointments(userData);

    res.status(201).json({ message: 'Cancelled successfully', updatedData });
  } catch (error) {
    console.error('Error updating name:', error);
    res.status(500).json({ message: 'Failed to update post. Please try again.' });
  }
});

// Function to update appointment status to "Attended"
async function attendedAppointments(userData) {
  try {
    // Assuming `query` is your custom function to send a PATCH request
    const res = await query(`/items/appointments/${userData.id}`, {
      method: 'PATCH',
      body: JSON.stringify(userData)
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/attend', async (req, res) => {
  try {
    const { slotId } = req.body;
    console.log(req.body)
    const attend = "Attended";

    const userData = {
      id: slotId,
      attended: attend
    };

    const updatedData = await attendedAppointments(userData);

    res.status(201).json({ message: 'Attended successfully', updatedData });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Failed to update appointment status. Please try again.' });
  }
});

async function followUps(userData) {
  try {
    // Assuming `query` is your custom function to send a PATCH request
    const res = await query(`/items/appointments/${userData.id}`, {
      method: 'PATCH',
      body: JSON.stringify(userData)
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/follow-up', async (req, res) => {
  try {
    const { id, date, time, description } = req.body;
    console.log(req.body)

    const userData = {
      id: id,
      followup_time: time,
      followup_date: date,
      followup_reason: description
    };

    const updatedData = await followUps(userData);

    res.status(201).json({ message: 'Attended successfully', updatedData });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Failed to update appointment status. Please try again.' });
  }
});

async function UpdateIp(userData) {
  try {
    // Assuming `query` is your custom function to send a PATCH request
    const res = await query(`/items/users/${userData.id}`, {
      method: 'PATCH',
      body: JSON.stringify(userData)
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/updateIp', async (req, res) => {
  try {
    const { number } = req.body;
    const id = req.session.user.id;
    const userData = {
      id: id,
      patient_number: number,
    };
    console.log(userData);

    const updatedData = await UpdateIp(userData);

    res.status(201).json({ message: 'Attended successfully', updatedData });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Failed to update appointment status. Please try again.' });
  }
});

async function updatePic(userData) {
  try {
    // Use your custom query function to send the update query
    const res = await query(`/items/users/${userData.id}`, {
      method: 'PATCH', // Assuming you want to update an existing item
      body: JSON.stringify(userData) // Convert userData to JSON string
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/update-pic', upload.single('profilePic'), async (req, res) => {
  try {
    // Ensure that req.file contains the expected file information
    const id = req.session.user.id;
    if (!req.file || !req.file.path) {
      return res.status(400).json({ message: 'No picture uploaded' });
    }

    // Use req.file.path or other relevant property to get the file path
    const picturePath = req.file.path;

    // Update userData object with profile_pic field
    const userData = {
      id: id, // Assuming req.user contains user information
      profile_pic: picturePath
    };

    // console.log(userData);

    // Update user data with the new profile pic path
    const updatedData = await updatePic(userData);

    res.status(201).json({ message: 'Profile picture updated successfully', updatedData });
  } catch (error) {
    console.error('Error updating profile picture:', error);
  }
});

async function deleteSlot(userData) {
  try {
    const res = await query(`/items/appointments/${userData.id}`, {
      method: 'DELETE',
      body: JSON.stringify(userData)
    });

    if (res.status === 204) {
      // 204 No Content response for successful deletion
      return { message: 'Deleted successfully' };
    } else {
      const updatedData = await res.json();
      return { message: 'Deleted successfully', updatedData };
    }
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to delete');
  }
}

app.post('/delete', async (req, res) => {
  try {
    const { slotId } = req.body;

    const userData = {
      id: slotId,
    };
    console.log(userData);

    const updatedData = await deleteSlot(userData);
    console.log(updatedData);
    res.status(201).json({ message: 'Deleted successfully', updatedData });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Failed to update appointment status. Please try again.' });
  }
});

async function removeStaff(userData) {
  try {
    const res = await query(`/items/staff/${userData.id}`, {
      method: 'DELETE',
      body: JSON.stringify(userData)
    });

    if (res.status === 204) {
      // 204 No Content response for successful deletion
      return { message: 'Deleted successfully' };
    } else {
      const updatedData = await res.json();
      return { message: 'Deleted successfully', updatedData };
    }
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to delete');
  }
}

app.post('/remove', async (req, res) => {
  try {
    const { slotId } = req.body;

    const userData = {
      id: slotId,
    };
    console.log(userData);

    const updatedData = await removeStaff(userData);
    console.log(updatedData);
    res.status(201).json({ message: 'Deleted successfully', updatedData });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Failed to update appointment status. Please try again.' });
  }
});

async function registerPatients(userData) {
  try {
    let res = await query(`/items/patients/`, {
      method: 'POST',
      body: JSON.stringify(userData) // Send user data in the request body
    });
    return await res.json(); // Return parsed JSON response
  } catch (error) {
    console.error('Error registering user:', error);
    throw error; // Rethrow error for handling in the calling function
  }
}

app.post('/patients', async (req, res) => {
  try {
    const {
      date,
      time,
      name,
      age,
      sex,
      ipop,
      weight,
      height,
      temp,
      resp,
      oxygen,
      pulse
    } = req.body;

    const hospital = req.session.user.hospital;


    if (!name || !time || !date) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    // Construct user data object
    const userData = {
      date: date,
      time: time,
      name: name,
      age: age,
      sex: sex,
      number: ipop,
      weight: weight,
      height: height,
      temp: temp,
      respiration: resp,
      oxygen: oxygen,
      pulse: pulse,
      hospital: hospital
    };

    const newUser = await registerPatients(userData);

    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function getPatients(hospitalId) {
  let res = await query(`/items/patients?hospital=${hospitalId}`, {
    method: 'GET',
  });
  return await res.json();
}

async function staffPic(userData) {
  try {
    // Use your custom query function to send the update query
    const res = await query(`/items/staff/${userData.id}`, {
      method: 'PATCH', // Assuming you want to update an existing item
      body: JSON.stringify(userData) // Convert userData to JSON string
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/staff-pic', upload.single('profilePic'), async (req, res) => {
  try {
    // Ensure that req.file contains the expected file information
    const id = req.session.user.id;
    if (!req.file || !req.file.path) {
      return res.status(400).json({ message: 'No picture uploaded' });
    }

    // Use req.file.path or other relevant property to get the file path
    const picturePath = req.file.path;

    // Update userData object with profile_pic field
    const userData = {
      id: id, // Assuming req.user contains user information
      profile_pic: picturePath
    };

    // console.log(userData);

    // Update user data with the new profile pic path
    const updatedData = await staffPic(userData);

    res.status(201).json({ message: 'Profile picture updated successfully', updatedData });
  } catch (error) {
    console.error('Error updating profile picture:', error);
  }
});

async function handlePatients(userData) {
  try {
    // Assuming `query` is your custom function to send a PATCH request
    const res = await query(`/items/patients/${userData.id}`, {
      method: 'PATCH',
      body: JSON.stringify(userData)
    });
    const updatedData = await res.json();
    return updatedData; // Return updated data
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to update');
  }
}

app.post('/handled', async (req, res) => {
  try {
    const { slotId } = req.body;
    console.log(req.body)
    const status = "Complete";

    const userData = {
      id: slotId,
      status: status
    };

    const updatedData = await handlePatients(userData);

    res.status(201).json({ message: 'Attended successfully', updatedData });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Failed to update appointment status. Please try again.' });
  }
});

app.listen(port, () => {
  console.log(`Portal listening on port ${port}`);
});