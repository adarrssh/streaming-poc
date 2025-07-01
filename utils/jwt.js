const jwt = require('jsonwebtoken');

/**
 * Generate JWT token for user
 * @param {string} userId - User ID to include in token
 * @returns {string} JWT token
 */
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { 
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    }
  );
};

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {object} Decoded token payload or null if invalid
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null if not found
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove 'Bearer ' prefix
};

module.exports = {
  generateToken,
  verifyToken,
  extractTokenFromHeader
}; 