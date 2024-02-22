require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const pgp = require('pg-promise')();
const port = 3001;
const app = express();

app.use(bodyParser.json()); // Parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.static(path.join(__dirname, 'public')));

// Configure PostgreSQL database connection using environment variables
const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT;
const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbConnection = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;
const db = pgp(dbConnection);

// Route for doctor verification
app.post('/api/verify-doctor', async (req, res) => {
  const { email, secretCode } = req.body;

  try {
    // Query the database for the doctor with the provided email and secret code
    const result = await db.oneOrNone('SELECT * FROM doctors WHERE email = $1 AND secret_code = $2', [email, secretCode]);

    if (result) {
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
    const result = await db.manyOrNone('SELECT doctor_name, speciality, time_available, general_price FROM schedules');
    const schedules = result;

    console.log('Schedules:', schedules);
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching schedule data from PostgreSQL database:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
      // Extract data from the request body
      const { name, email, phone, message } = req.body;

      // Insert the data into the PostgreSQL database
      const query =
          'INSERT INTO messages (name, email, phone, message) VALUES ($1, $2, $3, $4) RETURNING id';
      const values = [name, email, phone, message];

      // Execute the query and get the inserted row's ID
      const result = await db.query(query, values);
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

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});