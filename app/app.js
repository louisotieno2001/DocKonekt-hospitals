require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const pgp = require('pg-promise')();
const port = 3000
const app = express();


app.use(
  session(
    {
      secret: '',
      resave: false,
      saveUninitialized: true,
    }
  )
)
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})