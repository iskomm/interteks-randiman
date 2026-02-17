'use strict';

/**
 * Error handling middleware for Express applications.
 *
 * This middleware captures errors from the application and sends a proper response to the client.
 * It can handle different types of errors, logging them as necessary.
 *
 * @param {Error} err - The error object
 * @param {Request} req - The request object
 * @param {Response} res - The response object
 * @param {Function} next - The next middleware function
 */
function errorHandler(err, req, res, next) {
    console.error(err.stack); // Log the error stack for debugging

    const statusCode = res.statusCode ? res.statusCode : 500; // Set default status code to 500 if not set
    res.status(statusCode);
    res.json({
        status: 'error',
        statusCode,
        message: err.message,
        // Optionally, you can include the error stack in development mode
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
}

module.exports = errorHandler;