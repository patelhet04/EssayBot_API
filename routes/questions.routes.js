// routes/questions.routes.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const { verifyToken } = require("../utils/middleware");

const router = express.Router();

// Apply authentication middleware
router.use(verifyToken);

/**
 * Get question for the authenticated professor
 */
router.get("/question", (req, res) => {
  try {
    const professorUsername = req.user.username;

    // Path to central questions file
    const questionsFilePath = path.join(
      __dirname,
      "..",
      "data",
      "questions.json"
    );

    // Check if the questions file exists
    if (!fs.existsSync(questionsFilePath)) {
      return res.status(404).json({
        success: false,
        message: "Questions file not found",
      });
    }

    // Read questions from file
    const questionsContent = fs.readFileSync(questionsFilePath, "utf8");
    const allQuestions = JSON.parse(questionsContent);

    // Get question for this specific professor
    const professorQuestion = allQuestions[professorUsername];
    console.log(professorQuestion);

    if (!professorQuestion) {
      return res.status(404).json({
        success: false,
        message: "No question found for this professor",
      });
    }

    res.status(200).json({
      success: true,
      question: professorQuestion,
    });
  } catch (error) {
    logger.error("Error fetching professor question", {
      error: error.message,
      professor: req.user.username,
    });

    res.status(500).json({
      success: false,
      message: "Error fetching question",
      error: error.message,
    });
  }
});

module.exports = router;
