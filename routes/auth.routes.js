const express = require("express");
const router = express.Router();
const authService = require("../services/authService");

/**
 * @route POST /api/auth/register
 * @desc Register a new user
 * @access Public
 */
router.post("/register", async (req, res) => {
  const { username, password } = req.body;

  // Validate request
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required",
    });
  }

  // Register user
  const regResult = await authService.register(username, password);

  if (!regResult.success) {
    return res.status(400).json(regResult);
  }

  res.status(201).json(regResult);
});

/**
 * @route POST /api/auth/login
 * @desc Authenticate user and get token
 * @access Public
 */
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  // Validate request
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required",
    });
  }

  // Authenticate user
  const authResult = await authService.authenticate(username, password);

  if (!authResult.success) {
    return res.status(401).json(authResult);
  }

  res.json(authResult);
});

module.exports = router