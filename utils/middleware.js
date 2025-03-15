const authService = require("../services/authService");

const verifyToken = (req, res, next) => {
  // Get auth header
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Authorization header missing",
    });
  }

  // Check if auth header has Bearer token
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({
      success: false,
      message: "Invalid authorization format. Use Bearer {token}",
    });
  }

  const token = parts[1];

  // Verify token
  const verification = authService.verifyToken(token);
  if (!verification.success) {
    return res.status(401).json({
      success: false,
      message: verification.message,
    });
  }

  // Add user data to request
  req.user = verification.data;

  // Continue to next middleware
  next();
};

module.exports = {
  verifyToken,
};
