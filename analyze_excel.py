import sys
import json
import argparse
import pandas as pd
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def analyze_file(file_path):
    """
    Analyze an Excel file and return its full structure dynamically.
    """
    try:
        # Determine file type by extension
        if file_path.endswith('.csv'):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)

        # Check for required columns
        has_response = 'response' in df.columns
        has_student_id = any(
            col.lower() in ['student_id', 'id', 'student id'] for col in df.columns)

        # Convert the entire dataframe to a list of dictionaries (full table format)
        preview_data = df.fillna("").to_dict(orient="records")

        result = {
            'total_rows': len(df),
            'columns': list(df.columns),  # Send all column names dynamically
            'has_response': has_response,
            'has_student_id': has_student_id,
            'preview_data': preview_data  # Send all row data
        }

        logger.info(f"Successfully analyzed Excel file: {file_path}")
        logger.info(f"Found {len(df)} rows and {len(df.columns)} columns")

        return result

    except Exception as e:
        logger.error(f"Error analyzing Excel file: {str(e)}")
        return {
            'error': str(e)
        }


def main():
    parser = argparse.ArgumentParser(
        description='Analyze Excel file structure')
    parser.add_argument('--file', required=True, help='Path to Excel file')
    args = parser.parse_args()

    result = analyze_file(args.file)

    # Make sure logging doesn't interfere with JSON output
    logging.getLogger().handlers = []  # Remove all handlers

    # Print clean JSON only to stdout
    print(json.dumps(result))


if __name__ == '__main__':
    main()
