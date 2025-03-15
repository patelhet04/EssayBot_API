const jwt = require("jsonwebtoken");
const config = require("../utils/config");
const User = require("../models/User");

/**
 * Authenticate a user and generate JWT token
 * @param {string} username - The username to authenticate
 * @param {string} password - The password to authenticate
 * @returns {Promise<Object>} Authentication result with token if successful
 */
const authenticate = async (username, password) => {
  try {
    // Find user in MongoDB
    const user = await User.findOne({ username });

    // Check if user exists
    if (!user) {
      return { success: false, message: "Invalid username or password" };
    }

    // Check if password matches
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return { success: false, message: "Invalid username or password" };
    }

    // Generate JWT token
    const payload = {
      userId: user._id,
      username: user.username,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    return {
      success: true,
      message: "Authentication successful",
      token: token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Authentication failed",
      error: error.message,
    };
  }
};

/**
 * Register a new user
 * @param {string} username - The username to register
 * @param {string} password - The password for the new user
 * @returns {Promise<Object>} Registration result
 */
const register = async (username, password) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return { success: false, message: "Username already exists" };
    }

    // Create new user
    const newUser = new User({
      username,
      password,
    });

    // Save user to database
    await newUser.save();

    return {
      success: true,
      message: "User registered successfully",
      user: {
        id: newUser._id,
        username: newUser.username,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Registration failed",
      error: error.message,
    };
  }
};

/**
 * Verify a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Object} Verification result
 */
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return {
      success: true,
      data: decoded,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};

module.exports = {
  authenticate,
  register,
  verifyToken,
};
