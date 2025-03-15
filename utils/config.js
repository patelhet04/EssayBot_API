require("dotenv").config();
const path = require("path");

// Define project root path for consistent directory resolution
const PROJECT_ROOT = path.resolve(__dirname, "..");

const config = {
  jwt: {
    secret: process.env.JWT_SECRET || "essay-bot-api", // In production, use environment variable
    expiresIn: "24h", // Token expiration time
  },
  mongodb: {
    uri:
      process.env.MONGODB_URI ||
      "mongodb+srv://patelhet04:45QbC0cN85RH478C@cluster0.gov16.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
  },
  port: process.env.PORT || 3001,

  // Project paths
  paths: {
    root: PROJECT_ROOT,
    uploads: path.join(PROJECT_ROOT, "uploads"),

    // Get uploads path for a specific professor and optional subdirectory
    getUploadsPath: function (professorUsername, subDir = "") {
      if (!professorUsername) {
        throw new Error("Professor username is required for path resolution");
      }

      const uploadsPath = path.join(this.uploads, professorUsername);

      // If subdirectory is specified, include it in the path
      return subDir ? path.join(uploadsPath, subDir) : uploadsPath;
    },

    // Get python scripts path
    getPythonScriptsPath: function () {
      return path.join(PROJECT_ROOT, "python");
    },
  },
};

module.exports = config;
