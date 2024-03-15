require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const port = 3001;
const bcrypt = require('bcrypt');
const app = express();
const saltRounds = 10;

app.use(bodyParser.json()); // Parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.static(path.join(__dirname, 'public')));

// Configure PostgreSQL database connection using environment variables
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false },
});

// Route for doctor verification
app.post('/api/verify-doctor', async (req, res) => {
  const { email, secretCode } = req.body;

  try {
    // Query the database for the doctor with the provided email and secret code
    const result = await pool.query('SELECT * FROM doctors WHERE email = $1 AND secret_code = $2', [email, secretCode]);

    if (result.rows.length > 0) {
      // Doctor verified successfully
      res.sendStatus(200);
    } else {
      // Doctor not found or invalid credentials
      res.sendStatus(401);
    }
  } catch (error) {
    console.error('Error verifying doctor:', error);
    res.sendStatus(500);
  }
});

app.get('/api/schedules', async (req, res) => {
  try {
    const result = await pool.query('SELECT doctor_name, speciality, time_available, general_price, booked_status FROM schedules');
    const schedules = result.rows;

    // console.log('Schedules:', schedules);
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching schedule data from PostgreSQL database:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/register', async (req, res) => {
  const { fullName, email, phone, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      'INSERT INTO users (name, email, phone, password) VALUES ($1, $2, $3, $4) RETURNING *',
      [fullName, email, phone, hashedPassword]
    );

    if (result.rows.length > 0) {
      res.status(201).json({ success: true, user: result.rows[0] });
    } else {
      // Handle the case when result.rows is undefined or empty
      res.status(500).json({ success: false, error: 'Registration failed' });
    }
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

      if (result.rows.length > 0) {
          const user = result.rows[0];
          const isPasswordMatch = await bcrypt.compare(password, user.password);

          if (isPasswordMatch) {
              res.json({ success: true, user });
          } else {
              res.status(401).json({ success: false, error: 'Invalid credentials' });
          }
      } else {
          res.status(401).json({ success: false, error: 'Invalid credentials' });
      }
  } catch (error) {
      console.error('Error during login:', error);
      res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.get('/messages', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'get_in_touch.html'));
});

app.post('/messages', async (req, res) => {
  try {
      // Extract data from the request body
      const { name, email, phone, message } = req.body;

      // Insert the data into the PostgreSQL database
      const query =
          'INSERT INTO messages (name, email, phone, message) VALUES ($1, $2, $3, $4) RETURNING id';
      const values = [name, email, phone, message];

      // Execute the query and get the inserted row's ID
      const result = await pool.query(query, values);
      const insertedRow = result.rows[0];

      console.log(result);

      // Send a response indicating successful insertion
      res.status(201).json({
          message: 'Data inserted successfully',
          insertedRowId: insertedRow.id,
      });
  } catch (error) {
      console.error('Error while inserting data:', error);
      res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/referrals', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'referral-form.html'));
});

app.post('/referrals', async (req, res) => {
  try {
      // Extract data from the request body
      const { patientName, emmergencyPhone, urgency, hospitalName, doctorName, doctorPhone, message } = req.body;

      // Insert the data into the PostgreSQL database
      const query =
          'INSERT INTO referrals (patient_name, emmergency_phone, urgency, hospital_name, doctor_name, doctor_phone, message) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id';
      const values = [patientName, emmergencyPhone, urgency, hospitalName, doctorName, doctorPhone, message];

      // Execute the query and get the inserted row's ID
      const result = await pool.query(query, values);
      const insertedRow = result.rows[0];

      console.log(result);

      // Send a response indicating successful insertion
      res.status(201).json({
          message: 'Data inserted successfully',
          insertedRowId: insertedRow.id,
      });
  } catch (error) {
      console.error('Error while inserting data:', error);
      res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.post('/bookings', async (req, res) => {
  try {
    const { doctor, time, phone, agreement } = req.body;

    // Convert doctor name to lower case (or upper case) for case-insensitive comparison
    const formattedDoctorName = doctor.toLowerCase(); // or doctor.toUpperCase()

    // Update the booked_status in the schedules table to 'Booked' for the matching schedule
    const updateQuery = 'UPDATE schedules SET booked_status = $1 WHERE LOWER(doctor_name) = $2 AND time_available = $3';
    const updateValues = ['Booked', formattedDoctorName, time]; // Use LOWER function for case-insensitive comparison
    const updateResult = await pool.query(updateQuery, updateValues);

    if (updateResult.rowCount === 0) {
      // If no matching schedule is found, consider it as a failed booking
      throw new Error('Doctor or time not found. Booking failed.');
    }

    // Insert the booking into the bookings table
    const bookingQuery = 'INSERT INTO bookings (doctors_name, time, phone, agreement) VALUES ($1, $2, $3, $4) RETURNING id';
    const bookingValues = [doctor, time, phone, agreement];
    const bookingResult = await pool.query(bookingQuery, bookingValues);
    const bookingId = bookingResult.rows[0].id;

    // Send response
    res.status(201).json({ message: 'Booking successful', bookingId });
  } catch (error) {
    console.error('Something went wrong', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/pharmacies', async (req, res) => {
  try {
    const result = await pool.query('SELECT pharmacy_name, pharmacy_location, pharmacy_specific_location, contact_info FROM pharmacies');
    const pharmacies = result.rows;

    // console.log('Pharmacies:', pharmacies);
    res.json(pharmacies);
  } catch (error) {
    console.error('Error fetching schedule data from PostgreSQL database:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});