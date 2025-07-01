const User = require('../models/User');
const { verifyToken, extractTokenFromHeader } = require('../utils/jwt');

/**
 * Authentication middleware to protect routes
 * Verifies JWT token and attaches user to request object
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // Verify token
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    // Get user from database
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated.'
      });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.'
    });
  }
};

/**
 * Optional authentication middleware
 * Similar to authenticate but doesn't return error if no token
 * Useful for routes that can work with or without authentication
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await User.findById(decoded.id).select('-password');
        if (user && user.isActive) {
          req.user = user;
        }
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication if there's an error
    next();
  }
};

module.exports = {
  authenticate,
  optionalAuth
}; 