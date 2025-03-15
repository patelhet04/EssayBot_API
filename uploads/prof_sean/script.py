# Import required libraries
import pandas as pd
import json  # For JSON formatting
import re  # For cleaning JSON output
import logging  # For tracking and debugging
import requests  # For HTTP requests
import time
import argparse  # For parsing command-line arguments
import os  # For file path operations
# ✅ Import RAG functions
from rag_pipeline import initialize_rag_pipeline, retrieve_relevant_text
from agents import agent_1_prompt, agent_2_prompt, agent_3_prompt, agent_4_prompt
# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("grading_script.log"),  # Log to a file
        logging.StreamHandler()  # Log to the console
    ]
)
logger = logging.getLogger(__name__)

# Global configuration for API requests
session = requests.Session()  # Persistent HTTP session
API_URL = "http://localhost:5000/api/generate"
TIMEOUT = 60  # Timeout in seconds for API calls

# Default values for model parameters
DEFAULT_TEMPERATURE = 0.3
DEFAULT_TOP_P = 0.7
DEFAULT_MAX_TOKENS = 300

# Function to send POST request using a persistent session and timeout


def send_post_request(prompt, temperature=DEFAULT_TEMPERATURE, top_p=DEFAULT_TOP_P, max_tokens=DEFAULT_MAX_TOKENS, model="llama3.1:latest"):
    url = API_URL
    payload = {
        "model": model,  # Use the specified model
        "prompt": prompt,
        "stream": False,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": max_tokens
    }
    headers = {
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()  # Raise an error for bad status codes
        return response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to get response from server: {e}")
        return None

# Function to clean and pre-process raw response text from the model


def clean_response_text(text):
    """
    Cleans and pre-processes raw response text from the model to ensure valid JSON formatting.
    """
    if not isinstance(text, str):  # Ensure the input is a string
        logger.error("Received non-string input for response text.")
        return '{"score": 0, "feedback": "Invalid response format detected."}'

    cleaned = text.strip()

    # Handle function-based responses (if JSON is wrapped in a function structure)
    if "parameters" in cleaned:
        logger.warning(
            "Detected function response structure, extracting relevant text.")
        match = re.search(r'"(?:essay|text)":\s*"([^"]+)"', cleaned)
        if match:
            cleaned = match.group(1)

    # Ensure it's a valid JSON object
    if cleaned.startswith("{") and cleaned.endswith("}"):
        try:
            json_obj = json.loads(cleaned)  # Parse JSON
            if isinstance(json_obj, dict) and "score" in json_obj and "feedback" in json_obj:
                return json.dumps(json_obj)  # Return valid JSON
        except json.JSONDecodeError:
            pass  # Continue processing if JSON parsing fails

    # Attempt to fix double-encoded JSON strings
    try:
        # Try to decode one layer of JSON encoding
        cleaned = json.loads(cleaned)
        if isinstance(cleaned, str):  # If still a string, attempt another decoding pass
            cleaned = json.loads(cleaned)
    except json.JSONDecodeError:
        pass  # Continue processing if JSON decoding fails

    # **Ensure cleaned is a string before applying regex**
    if not isinstance(cleaned, str):
        # Convert back to a string if it's a dictionary
        cleaned = json.dumps(cleaned)

    # Fix unescaped double quotes inside JSON fields
    # Escape unescaped double quotes
    cleaned = re.sub(r'(?<!\\)"', '\\"', cleaned)

    # Remove trailing commas inside JSON objects
    cleaned = re.sub(r',\s*([\]}])', r'\1', cleaned)

    # Ensure final JSON is valid
    try:
        json_obj = json.loads(cleaned)  # Try loading as JSON
        return json.dumps(json_obj)  # Return properly formatted JSON string
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}. Raw text: {cleaned}")
        return '{"score": 0, "feedback": "Error parsing response."}'

# Function to run LLM agent with retry mechanism


def run_agent(prompt_template, essay, rag_context, model="llama3.1:latest"):
    logger.info("Running grading agent")

    prompt = prompt_template.format(essay=essay, rag_context=rag_context)
    max_retries = 3

    for attempt in range(max_retries):
        try:
            logger.info(f"Attempt {attempt + 1}: Generating feedback")
            response = send_post_request(
                prompt,
                temperature=DEFAULT_TEMPERATURE,
                top_p=DEFAULT_TOP_P,
                max_tokens=DEFAULT_MAX_TOKENS,
                model=model
            )
            # logger.info(f"Raw model response: {response}")
            if response is None or "response" not in response:
                raise ValueError("Invalid response from server")
            feedback_text = response.get("response", "").strip()
            feedback_text = clean_response_text(feedback_text)

            feedback_json = json.loads(feedback_text)
            if isinstance(feedback_json, dict) and "score" in feedback_json and "feedback" in feedback_json:
                logger.info("Feedback generated successfully")
                return feedback_json
            else:
                raise ValueError("Invalid JSON structure")
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                sleep_time = 2 ** attempt  # Exponential backoff
                logger.info(f"Retrying after {sleep_time} seconds...")
                time.sleep(sleep_time)
            else:
                return {"score": 0, "feedback": "Fallback response due to JSON error."}

# Function to augment essay with RAG-based retrieval


def augment_with_rag(essay, categories):
    """Retrieve RAG context for multiple categories."""
    logger.info("Augmenting essay with RAG context")

    relevant_docs = []

    # Retrieve relevant text for each identified category
    for category in categories:
        category_docs = retrieve_relevant_text(essay, category)
        relevant_docs.extend(category_docs)

    # Remove duplicates and join
    relevant_docs = list(set(relevant_docs))

    if relevant_docs:
        rag_context = "\n".join(relevant_docs)
    else:
        rag_context = "No relevant context found."

    logger.info(f"RAG context retrieved for categories: {categories}")
    return rag_context


def determine_categories(response):
    """Determine multiple relevant categories based on student response."""
    categories = set()

    if "segmentation" in response.lower():
        categories.add("Market Segmentation")
    if "targeting" in response.lower():
        categories.add("Targeting")
    if "differentiation" in response.lower() or "positioning" in response.lower():
        categories.add("Differentiation & Positioning")
    if "pricing" in response.lower() or "product" in response.lower():
        categories.add("Marketing Mix (4Ps)")

    # Default to "Marketing Strategy & Planning" if no specific category is found
    if not categories:
        categories.add("Marketing Strategy & Planning")

    return list(categories)  # Convert to list before returning


# Define grading function
def grade_response(response, model="llama3.1:latest"):
    logger.info("Grading response")

    # Determine category dynamically
    category = determine_categories(response)

    # ✅ Get relevant context using RAG
    rag_context = augment_with_rag(response, category)

    default_feedback = {"score": 0, "feedback": "No response generated."}

    feedback_1 = run_agent(agent_1_prompt, response,
                           rag_context, model) or default_feedback
    feedback_2 = run_agent(agent_2_prompt, response,
                           rag_context, model) or default_feedback
    feedback_3 = run_agent(agent_3_prompt, response,
                           rag_context, model) or default_feedback
    feedback_4 = run_agent(agent_4_prompt, response,
                           rag_context, model) or default_feedback

    final_feedback = {
        "feedback_1_score": feedback_1.get("score", 0),
        "feedback_1_feedback": feedback_1.get("feedback", "No feedback."),
        "feedback_2_score": feedback_2.get("score", 0),
        "feedback_2_feedback": feedback_2.get("feedback", "No feedback."),
        "feedback_3_score": feedback_3.get("score", 0),
        "feedback_3_feedback": feedback_3.get("feedback", "No feedback."),
        "feedback_4_score": feedback_4.get("score", 0),
        "feedback_4_feedback": feedback_4.get("feedback", "No feedback."),
    }

    final_feedback["total_score"] = final_feedback["feedback_1_score"] + final_feedback["feedback_2_score"] + \
        final_feedback["feedback_3_score"] + final_feedback["feedback_4_score"]
    logger.info("Response grading completed")
    return final_feedback


def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Grade essays with AI")

    # Required arguments
    parser.add_argument('--file', required=True,
                        help='Path to the Excel file containing essays')

    # Optional arguments
    parser.add_argument('--model', default='llama3.1:latest',
                        help='Model to use for grading')
    parser.add_argument(
        '--job-id', help='Job ID for tracking and output file naming')
    parser.add_argument('--output-dir', default='outputs',
                        help='Directory to save output files')
    parser.add_argument(
        '--professor', help='Professor username for multi-professor support')

    args = parser.parse_args()

    logger.info(f"Starting main function with file: {args.file}")

    # Create output directory if it doesn't exist
    if not os.path.exists(args.output_dir):
        os.makedirs(args.output_dir)

    # Define output file name
    output_filename = f"graded_responses_{args.job_id}.xlsx" if args.job_id else "graded_responses.xlsx"
    output_path = os.path.join(args.output_dir, output_filename)

    # Create status file to track progress
    if args.job_id:
        status_path = os.path.join(args.output_dir, f"{args.job_id}.status")
        with open(status_path, 'w') as f:
            json.dump({"status": "processing", "progress": 0}, f)

    # ✅ Load the student responses from the Excel file
    try:
        df = pd.read_excel(args.file)
        logger.info(f"Successfully loaded file with {len(df)} responses")

        # Update status
        if args.job_id:
            with open(status_path, 'w') as f:
                json.dump({"status": "processing",
                          "progress": 0, "rowCount": len(df)}, f)

        comment_columns = ["Comment1", "Comment2", "Comment3", "Comment4"]
        for col in comment_columns:
            if col not in df.columns:
                df[col] = ""
            df[col] = df[col].astype(str)

        total_rows = len(df)
        for index, row in df.iterrows():
            response = row["response"]

            # ✅ Grade response with model parameter only
            logger.info(f"Grading response {index + 1}/{total_rows}")
            final_feedback = grade_response(
                response,
                model=args.model
            )

            # ✅ Store feedback scores and comments in the dataframe
            df.at[index,
                  "Identification and Order of Steps (30)"] = final_feedback["feedback_1_score"]
            df.at[index, "Comment1"] = str(
                final_feedback["feedback_1_feedback"])
            df.at[index,
                  "Explanation of Steps (30)"] = final_feedback["feedback_2_score"]
            df.at[index, "Comment2"] = str(
                final_feedback["feedback_2_feedback"])
            df.at[index,
                  "Understanding the Goals of the steps(30)"] = final_feedback["feedback_3_score"]
            df.at[index, "Comment3"] = str(
                final_feedback["feedback_3_feedback"])
            df.at[index,
                  "Clarity and Organization(10)"] = final_feedback["feedback_4_score"]
            df.at[index, "Comment4"] = str(
                final_feedback["feedback_4_feedback"])
            df.at[index, "Total(100)"] = final_feedback["total_score"]

            # Update status file with progress
            if args.job_id:
                progress = int(((index + 1) / total_rows) * 100)
                with open(status_path, 'w') as f:
                    json.dump({
                        "status": "processing",
                        "progress": progress,
                        "rowCount": total_rows,
                        "completed": index + 1
                    }, f)

        # ✅ Save the graded responses to the output file
        df.to_excel(output_path, index=False)
        logger.info(f"Grading completed and results saved to {output_path}")

        # Update status to complete
        if args.job_id:
            with open(status_path, 'w') as f:
                json.dump({
                    "status": "complete",
                    "progress": 100,
                    "rowCount": total_rows,
                    "outputFile": output_path
                }, f)

    except Exception as e:
        logger.error(f"Error processing file: {e}")
        # Update status to error
        if args.job_id:
            with open(status_path, 'w') as f:
                json.dump({"status": "error", "message": str(e)}, f)
        raise


if __name__ == "__main__":
    main()
