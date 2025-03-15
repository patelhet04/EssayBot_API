// utils/rubric-handler.js
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

/**
 * Get the rubric file path for a specific professor
 * @param {string} professorUsername - The professor's username
 * @returns {string} - The path to the professor's rubric file
 */
function getProfessorRubricPath(professorUsername) {
  const rubricFilePath = path.join(
    __dirname,
    "..",
    "uploads",
    professorUsername,
    "rubrics",
    "rubric.json"
  );

  return rubricFilePath;
}

/**
 * Get the current rubric for a professor
 * @param {string} professorUsername - The professor's username
 * @returns {Object|null} - The professor's rubric or null if none exists
 */
function getProfessorRubric(professorUsername) {
  const rubricPath = getProfessorRubricPath(professorUsername);

  if (fs.existsSync(rubricPath)) {
    try {
      const rubricContent = fs.readFileSync(rubricPath, "utf8");
      return JSON.parse(rubricContent);
    } catch (error) {
      logger.error(`Error reading rubric for professor ${professorUsername}`, {
        error: error.message,
      });
      return null;
    }
  } else {
    return null;
  }
}

/**
 * Save a rubric for a professor
 * @param {string} professorUsername - The professor's username
 * @param {Object} rubric - The rubric to save
 * @returns {boolean} - Success status
 */
function saveProfessorRubric(professorUsername, rubric) {
  try {
    const rubricPath = getProfessorRubricPath(professorUsername);
    const rubricDir = path.dirname(rubricPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(rubricDir)) {
      fs.mkdirSync(rubricDir, { recursive: true });
    }

    // Write the rubric file
    fs.writeFileSync(rubricPath, JSON.stringify(rubric, null, 2));

    logger.info(`Saved rubric for professor ${professorUsername}`);
    return true;
  } catch (error) {
    logger.error(`Error saving rubric for professor ${professorUsername}`, {
      error: error.message,
    });
    return false;
  }
}

/**
 * Update agent grading distribution for a professor
 * @param {string} professorUsername - The professor's username
 * @param {Object} criteria - Updated criteria with weights
 * @returns {boolean} - Success status
 */
function updateAgentGradingDistribution(professorUsername, criteria) {
  try {
    // First check for professor-specific agents file
    const professorScriptsDir = path.join(
      __dirname,
      "..",
      "uploads",
      professorUsername,
      "scripts"
    );

    // Ensure the directory exists
    if (!fs.existsSync(professorScriptsDir)) {
      fs.mkdirSync(professorScriptsDir, { recursive: true });
    }

    // Professor-specific agents file path
    const professorAgentsPath = path.join(professorScriptsDir, "agents.py");

    // Default agents file path
    const defaultAgentsPath = path.join(__dirname, "..", "python", "agents.py");

    // If professor-specific agents file doesn't exist, copy the default one
    if (!fs.existsSync(professorAgentsPath)) {
      fs.copyFileSync(defaultAgentsPath, professorAgentsPath);
      logger.info(
        `Created professor-specific agents.py for ${professorUsername}`
      );
    }

    // Now read the professor-specific agents file
    let agentsContent = fs.readFileSync(professorAgentsPath, "utf8");

    // Dynamically map criteria to agent numbers based on criteria order
    // This ensures it works with any criteria names from the professor's rubric
    const criteriaToAgentMap = {};
    criteria.forEach((criterion, index) => {
      // Agent numbers are 1-based
      criteriaToAgentMap[criterion.name] = index + 1;
    });

    logger.info(
      `Dynamic criteria mapping for professor ${professorUsername}:`,
      criteriaToAgentMap
    );

    // Update each agent prompt based on the criteria
    criteria.forEach((criterion) => {
      const agentNumber = criteriaToAgentMap[criterion.name];

      if (!agentNumber || agentNumber > 4) {
        logger.warn(
          `No matching agent found for criterion: ${criterion.name} or agent number ${agentNumber} exceeds 4`
        );
        return; // Skip this criterion if no mapping or agent number > 4
      }

      // Update agent header with correct points
      const agentHeaderPattern = new RegExp(
        `(### \\*\\*Agent ${agentNumber}:[^\\(]*?)\\(\\d+\\s*Points\\)`,
        "i"
      );
      if (agentHeaderPattern.test(agentsContent)) {
        agentsContent = agentsContent.replace(
          agentHeaderPattern,
          `$1(${criterion.weight} Points)`
        );
        logger.info(
          `Updated agent ${agentNumber} header with ${criterion.weight} points`
        );
      }

      // Update JSON output format with correct points
      const jsonFormatPattern = new RegExp(
        `(json_output_format.replace\\('30', ')(\\d+)('\\))`,
        "g"
      );
      if (agentNumber === 4 && jsonFormatPattern.test(agentsContent)) {
        agentsContent = agentsContent.replace(
          jsonFormatPattern,
          `$1${criterion.weight}$3`
        );
        logger.info(`Updated JSON output format for agent ${agentNumber}`);
      }

      // Update points in evaluation criteria sections
      const evaluationPattern = new RegExp(
        `(#### \\*\\*Evaluation Criteria\\*\\*[\\s\\S]*?worth\\s+)\\d+(\\.\\d+)?\\s*(marks|points)`,
        "i"
      );
      if (evaluationPattern.test(agentsContent)) {
        const pointsPerItem = criterion.weight / 4; // Assuming 4 items in criteria
        agentsContent = agentsContent.replace(
          evaluationPattern,
          `$1${pointsPerItem.toFixed(1)} $3`
        );
        logger.info(
          `Updated evaluation criteria points for agent ${agentNumber}`
        );
      }
    });

    // Write the updated content back to the professor-specific file
    fs.writeFileSync(professorAgentsPath, agentsContent);
    logger.info(
      `Successfully updated agent prompts for professor ${professorUsername}`
    );

    return true;
  } catch (error) {
    logger.error(
      `Error updating agent grading distribution for professor ${professorUsername}`,
      {
        error: error.message,
      }
    );
    return false;
  }
}

module.exports = {
  getProfessorRubric,
  saveProfessorRubric,
//   updateAgentGradingDistribution,
};
