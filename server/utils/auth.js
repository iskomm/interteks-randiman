'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET;

/**
 * Hashes a password using bcrypt.
 * @param {string} password - The password to hash.
 * @returns {Promise<string>} - The hashed password.
 */
const hashPassword = async (password) => {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
};

/**
 * Verifies if the provided password matches the hashed password.
 * @param {string} password - The password to verify.
 * @param {string} hashedPassword - The hashed password to check against.
 * @returns {Promise<boolean>} - True if the password matches, false otherwise.
 */
const verifyPassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
};

/**
 * Generates a JWT token for a user.
 * @param {Object} user - The user object containing user data.
 * @param {string} user.id - The user's ID.
 * @returns {string} - The generated JWT token.
 */
const generateToken = (user) => {
    return jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: '1h' });
};

module.exports = {
    hashPassword,
    verifyPassword,
    generateToken,
};
