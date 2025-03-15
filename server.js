// server.js - Main API server with modular structure
const express = require("express");
const cors = require("cors");
const path = require("path");
const logger = require("./utils/logger");
const { spawn } = require("child_process");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
// Import route modules
const courseRoutes = require("./routes/course.routes");
const rubricRoutes = require("./routes/rubric.routes");
const gradingRoutes = require("./routes/grading.routes");
const authRoutes = require("./routes/auth.routes");
const questionRoutes = require("./routes/questions.routes");
require("dotenv").config();
const config = require("./utils/config");

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3001;

// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get("User-Agent"),
  });
  next();
});

mongoose
  .connect(config.mongodb.uri)
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Register routes
app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/rubrics", rubricRoutes);
app.use("/api/grading", gradingRoutes);
app.use("/api/questions", questionRoutes);

app.get("/list-models", async (req, res) => {
  try {
    // Execute SSH command to list models
    const sshProcess = spawn("ssh", [
      "-L",
      "5001:localhost:5000",
      "het_p@129.10.157.62",
      "docker",
      "exec",
      "ollama-container",
      "ollama",
      "list",
    ]);

    let output = "";
    sshProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    sshProcess.on("close", (code) => {
      if (code !== 0) {
        return res
          .status(500)
          .json({ success: false, message: "Failed to list models" });
      }

      // Parse model list
      const models = output
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split(/\s+/);
          return {
            name: parts[0],
            version: parts[1] || "latest",
            size: parts[2] || "unknown",
          };
        });
      res.status(200).json({
        success: true,
        models,
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error listing models",
    });
  }
});

// General health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: err.message,
  });
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Graceful shutdown handling
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

function gracefulShutdown() {
  logger.info("Received shutdown signal, closing server gracefully");

  // Close any database connections or cleanup tasks here

  process.exit(0);
}
