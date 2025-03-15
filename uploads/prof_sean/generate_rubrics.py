import os
import sys
import json
import argparse
import logging
import random
import requests
from typing import List, Dict, Any

# Set up logging


def setup_logging(professor_username=None):
    """Configure logging with professor-specific log file if provided."""
    log_filename = f"generate_rubrics_{professor_username}.log" if professor_username else "generate_rubrics.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_filename),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)


# Create logger with default name initially
logger = logging.getLogger(__name__)

# Import RAG retrieval function from existing pipeline
try:
    from rag_pipeline import retrieve_relevant_text, get_indices_path
except ImportError:
    logger.warning(
        "Could not import from rag_pipeline, will use sample retrieval function")

    def retrieve_relevant_text(query, category, k=5, professor_username=None, project_root=None):
        """Mock retrieval function if rag_pipeline module is not available."""
        return [
            "Market segmentation is dividing a market into distinct groups of buyers with different needs, characteristics, or behaviors.",
            "Targeting involves evaluating each market segment's attractiveness and selecting one or more segments to enter.",
            "Differentiation is creating a distinctive place in the minds of potential customers.",
            "Positioning consists of arrangements to make a product occupy a clear, distinctive place relative to competing products."
        ]


def get_professor_directories(professor_username, project_root=None):
    """Get directory paths for a specific professor."""
    if not professor_username:
        logger.error("Professor username not provided")
        raise ValueError("Professor username not provided")
    if not project_root:
        logger.error("Project root not provided")
        raise ValueError("Project root not provided")
    logger.info(f"Using provided project root: {project_root}")
    professor_base_dir = os.path.join(
        project_root, "uploads", professor_username)
    logger.info(f"Professor base directory: {professor_base_dir}")
    directories = {
        "base": professor_base_dir,
        "materials": os.path.join(professor_base_dir, "materials"),
        "indices": os.path.join(professor_base_dir, "indices"),
        "rubrics": os.path.join(professor_base_dir, "rubrics")
    }
    for dir_path in directories.values():
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
            logger.info(f"Created directory: {dir_path}")
    return directories


def get_question_context(question: str, professor_username: str, project_root: str) -> List[str]:
    logger.info(f"Retrieving context for question: {question[:50]}...")
    categories = [
        "Market Segmentation",
        "Targeting",
        "Differentiation & Positioning",
        "Marketing Mix (4Ps)",
        "Marketing Strategy & Planning"
    ]
    all_contexts = []
    for category in categories:
        contexts = retrieve_relevant_text(
            query=question,
            category=category,
            k=3,
            professor_username=professor_username,
            project_root=project_root
        )
        all_contexts.extend(contexts)
    unique_contexts = list(set(all_contexts))
    logger.info(f"Retrieved {len(unique_contexts)} unique context chunks")
    return unique_contexts


# Local model configuration
API_URL = "http://localhost:5001/api/generate"
DEFAULT_TEMPERATURE = 0.3
DEFAULT_TOP_P = 0.9
DEFAULT_MAX_TOKENS = 4000


def send_post_request(prompt, temperature=DEFAULT_TEMPERATURE, top_p=DEFAULT_TOP_P, max_tokens=DEFAULT_MAX_TOKENS, model="llama3.1:8b"):
    """Send a request to the local LLM API"""
    url = API_URL
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": max_tokens
    }
    headers = {"Content-Type": "application/json"}
    logger.info(f"Sending request to local model: {model}")
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()["response"]
    except requests.exceptions.RequestException as e:
        logger.error(f"Error calling local model API: {str(e)}")
        raise


def generate_sample_rubrics(question: str, context: List[str], num_samples: int = 3, model: str = "llama3.1:8b") -> List[Dict[str, Any]]:
    """
    Generate sample rubrics based on the question and context from RAG.
    Each rubric iteration will have a different focus:
      1) Application-focused
      2) Theory-focused
      3) Mixed approach (balanced)
    """
    logger.info(
        f"Generating {num_samples} sample rubrics using model: {model}...")

    # Define different focus instructions for the three rubrics.
    focus_instructions = [
        "Focus primarily on the practical (application) aspects of the question.",
        "Focus primarily on the theoretical or conceptual understanding of the question.",
        "Provide a balanced approach that covers both theoretical understanding and practical application."
    ]

    sample_rubrics = []

    for i in range(num_samples):
        if i < len(focus_instructions):
            focus_text = focus_instructions[i]
        else:
            focus_text = focus_instructions[-1]

        logger.info(
            f"Generating sample rubric {i+1} of {num_samples} ({focus_text})")
        try:
            context_subset = random.sample(context, min(len(context), 5))
            prompt = f"""
            You are an expert educational assessment designer. Your task is to create a sample grading rubric 
            for the following question/assignment:
            
            QUESTION:
            {question}
            
            RELEVANT CONTEXT FROM COURSE MATERIALS:
            {' '.join(context_subset)}
            
            {focus_text}
            
            Create a sample grading rubric that assesses understanding of the subject matter and application of 
            concepts. The rubric should have 3-4 criteria that are tailored to this specific question.
            
            Return the rubric as a valid JSON object with the following structure:
            
            {{
              "criteria": [
                {{
                  "name": "Criterion Name",
                  "description": "Detailed description of what is being assessed",
                  "weight": number, // numerical weight where all weights add up to 100
                  "scoringLevels": {{
                    "full": "Description of full points performance",
                    "partial": "Description of partial points performance",
                    "minimal": "Description of minimal points performance"
                  }},
                  "subCriteria": []
                }},
                // more criteria...
              ]
            }}
            
            Each criterion should include:
            1. A clear name
            2. A detailed description
            3. A weight (numerical value where all weights add up to 100)
            4. Scoring levels with descriptions
            5. An empty subCriteria array
            
            Return ONLY the JSON object with no additional text before or after it.
            """

            response = send_post_request(
                prompt=prompt,
                temperature=0.3 + (i * 0.1),
                top_p=0.9,
                max_tokens=1000,
                model=model  # Use the model parameter passed to the function
            )
            response = response.strip()
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            if json_start != -1 and json_end > json_start:
                json_str = response[json_start:json_end]
                try:
                    rubric_json = json.loads(json_str)
                    if "criteria" not in rubric_json:
                        rubric_json = {"criteria": rubric_json}
                    for criterion in rubric_json["criteria"]:
                        if "subCriteria" not in criterion:
                            criterion["subCriteria"] = []
                        if "scoringLevels" not in criterion:
                            criterion["scoringLevels"] = {
                                "full": "Excellent performance in this criterion.",
                                "partial": "Satisfactory performance in this criterion.",
                                "minimal": "Minimal performance in this criterion."
                            }
                        if "weight" not in criterion or not isinstance(criterion["weight"], (int, float)):
                            criterion["weight"] = 100 // len(
                                rubric_json["criteria"])
                    total_weight = sum(c["weight"]
                                       for c in rubric_json["criteria"])
                    if total_weight != 100:
                        scale_factor = 100 / total_weight
                        for criterion in rubric_json["criteria"]:
                            criterion["weight"] = round(
                                criterion["weight"] * scale_factor)
                        diff = 100 - sum(c["weight"]
                                         for c in rubric_json["criteria"])
                        if diff != 0:
                            rubric_json["criteria"][0]["weight"] += diff
                    sample_rubrics.append(rubric_json)
                    logger.info(f"Successfully generated sample rubric {i+1}")
                except json.JSONDecodeError as e:
                    logger.error(
                        f"Error parsing JSON from model response: {str(e)}")
                    raise
            else:
                logger.error("Could not find valid JSON in model response")
                raise ValueError("No valid JSON found in response")
        except Exception as e:
            logger.error(f"Error generating rubric {i+1}: {str(e)}")
            sample_rubrics.append({
                "criteria": [
                    {
                        "name": f"Criterion {j+1}",
                        "description": "Auto-generated placeholder criterion",
                        "weight": 100 // (3 if i == 0 else 4),
                        "scoringLevels": {
                            "full": "Excellent performance in this criterion.",
                            "partial": "Satisfactory performance in this criterion.",
                            "minimal": "Minimal performance in this criterion."
                        },
                        "subCriteria": []
                    } for j in range(3 if i == 0 else 4)
                ]
            })
    return sample_rubrics


def main():
    """Main entry point for the script."""
    parser = argparse.ArgumentParser(description="Generate Sample Rubrics")
    parser.add_argument("--question", required=True,
                        help="The question to generate rubrics for")
    parser.add_argument("--professorUsername", required=True,
                        help="Username of the professor")
    parser.add_argument("--projectRoot", required=True,
                        help="Path to the project root")
    parser.add_argument("--numSamples", type=int, default=3,
                        help="Number of sample rubrics to generate")
    parser.add_argument("--outputFile", help="Path to save the output JSON")
    parser.add_argument("--model", default="llama3.1:8b",
                        help="LLM model to use for generation")
    args = parser.parse_args()

    global logger
    logger = setup_logging(args.professorUsername)

    try:
        context = get_question_context(
            args.question, args.professorUsername, args.projectRoot)
        sample_rubrics = generate_sample_rubrics(
            args.question,
            context,
            args.numSamples,
            args.model  # Pass the model parameter to generate_sample_rubrics
        )
        result = {
            "success": True,
            "message": f"Generated {len(sample_rubrics)} sample rubrics",
            "sampleRubrics": sample_rubrics
        }
        if args.outputFile:
            with open(args.outputFile, 'w') as f:
                json.dump(result, f, indent=2)
            logger.info(f"Saved sample rubrics to {args.outputFile}")
        print(json.dumps(result))
        return 0
    except Exception as e:
        logger.error(f"Error generating sample rubrics: {str(e)}")
        result = {
            "success": False,
            "message": f"Error generating sample rubrics: {str(e)}",
            "error": str(e)
        }
        print(json.dumps(result))
        return 1


if __name__ == "__main__":
    sys.exit(main())
