require('dotenv').config();
const mongoose = require('mongoose');

// Load environment variables
const dbURI = process.env.DB_URI;

if (!dbURI) {
    console.error('DB_URI is not defined in the environment variables.');
    process.exit(1);
}

// Initialize database connection
mongoose.connect(dbURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log('Database connection established.');
    })
    .catch(err => {
        console.error('Database connection error:', err);
        process.exit(1);
    });

module.exports = mongoose;