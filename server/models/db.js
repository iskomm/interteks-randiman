const { Pool } = require('pg');

// PostgreSQL connection pool
const pool = new Pool({
  user: 'your_username', // replace with your DB username
  host: 'localhost', // replace with your DB host
  database: 'your_database', // replace with your DB name
  password: 'your_password', // replace with your DB password
  port: 5432, // replace with your DB port
});

// Function to save production data
async function saveProductionData(data) {
  const query = 'INSERT INTO production_table(column1, column2) VALUES($1, $2) RETURNING *';
  const values = [data.column1, data.column2]; // adjust based on your data structure
  try {
    const res = await pool.query(query, values);
    return res.rows[0];
  } catch (err) {
    console.error('Error saving production data:', err);
    throw err;
  }
}

// Function to retrieve production data
async function getProductionData(id) {
  const query = 'SELECT * FROM production_table WHERE id = $1';
  const values = [id];
  try {
    const res = await pool.query(query, values);
    return res.rows[0];
  } catch (err) {
    console.error('Error retrieving production data:', err);
    throw err;
  }
}

module.exports = { saveProductionData, getProductionData };